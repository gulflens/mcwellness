import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BalanceResponse,
  ExtendPurchaseResponse,
  PackagesResponse,
  SellPackageResponse,
} from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import {
  SEEDED,
  setPracticePrices,
  silverInput,
  SILVER_CODE,
  startHarness,
  type Harness,
} from './support';

/**
 * Extending a programme, and the double charge that used to follow it.
 *
 * The columns existed on `package_purchase`, `domain/billing/balance.ts`
 * honoured them, and `app.oldest_available_entitlement` did not. So a family
 * whose programme had been extended was shown their sessions as remaining,
 * and every visit delivered after the original date found no credit, was
 * charged at the single-visit price and invoiced — a second payment for
 * sessions they had already bought.
 *
 * The second half of this file is that scenario, refusing.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');

let h: Harness;
let silverId: string;
let purchaseId: string;
let expiredPurchaseId: string;

async function sellSilverTo(clientIndex: number): Promise<string> {
  const sale = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
    packageId: silverId,
    clientId: h.clientId(clientIndex),
    purchasedOn: SEED_TODAY,
  });
  if (sale.status !== 201) throw new Error('Silver could not be sold.');
  return ((await sale.json()) as SellPackageResponse).purchase.id;
}

let sessionSeq = 0;
/** A visit at the door and the one statement that closes it. */
async function deliverVisit(clientIndex: number): Promise<void> {
  sessionSeq += 1;
  const id = `00000000-0000-4000-8000-00000000a${String(sessionSeq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[0];
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', 'in_progress', now())",
    [
      id,
      h.data.tenant.id,
      h.clientId(clientIndex),
      practitioner?.id,
      h.serviceTypeId('nf-session'),
    ],
  );
  await h.owner.query("update session set status = 'completed' where id = $1", [id]);
}

async function sessionInvoiceCount(clientIndex: number): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(
    "select count(*)::text as n from invoice where kind = 'session' and client_id = $1",
    [h.clientId(clientIndex)],
  );
  return Number(rows[0]?.n);
}

async function remainingSessions(clientIndex: number): Promise<number> {
  const res = await h.call(
    'GET',
    `/api/billing/clients/${h.clientId(clientIndex)}/balance`,
    SEEDED.owner,
  );
  const body = (await res.json()) as BalanceResponse;
  return body.services.find((s) => s.serviceTypeCode === 'nf-session')?.remaining ?? 0;
}

/**
 * Counts the extension rows one person may see, as `app_role` — the role every
 * request actually connects as — with the roles the middleware would have
 * stamped. `h.owner` owns the tables and row security steps aside for an owner,
 * so a read taken through it proves nothing about a policy; this takes the read
 * through the role the policy is written for. A savepoint of its own, rolled
 * back, so the session's audit context survives untouched
 * (tests/db/helpers.ts's `asApiRole` is the same manoeuvre, for a suite that is
 * already inside one). A savepoint rather than a transaction because its only
 * caller reads rows it has just written inside a transaction of its own, and
 * a `begin` nested in that would end the caller's transaction, not its own.
 */
async function countExtensionsAs(roles: string, seededUser: number): Promise<number> {
  const user = h.data.users[seededUser];
  await h.owner.query('savepoint reading_as_role');
  try {
    await h.owner.query('set local role app_role');
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', $3, true), set_config('app.reason', '', true)",
      [h.data.tenant.id, user?.id ?? null, roles],
    );
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from package_extension',
    );
    return Number(rows[0]?.n);
  } finally {
    await h.owner.query('rollback to savepoint reading_as_role');
    await h.owner.query('release savepoint reading_as_role');
  }
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
  const created = await h.call(
    'POST',
    '/api/billing/packages',
    SEEDED.owner,
    silverInput(h, SEED_TODAY),
  );
  if (created.status !== 201) throw new Error('Silver could not be created.');
  const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
  const silver = ((await list.json()) as PackagesResponse).packages.find(
    (p) => p.code === SILVER_CODE,
  );
  if (!silver) throw new Error('Silver is missing.');
  silverId = silver.id;

  purchaseId = await sellSilverTo(0);
  expiredPurchaseId = await sellSilverTo(1);

  // The practice's own settings, as the request middleware would stamp them,
  // so the raw statements below are attributable in the trail.
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner', false), " +
      "set_config('app.request_id', '00000000-0000-4000-8000-0000000000f1', false), " +
      "set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null],
  );
});

afterAll(async () => {
  await h.close();
});

describe('migration 410: six months, and two extensions at most', () => {
  it('defaults a new package to six months', async () => {
    const { rows } = await h.owner.query<{ column_default: string }>(
      "select column_default from information_schema.columns where table_name = 'package' and column_name = 'expiry_months'",
    );
    expect(rows[0]?.column_default).toBe('6');
  });

  it('holds at most two extensions for one purchase, numbered one and two', async () => {
    const { rows } = await h.owner.query<{ conname: string }>(
      "select conname from pg_constraint where conrelid = 'public.package_extension'::regclass order by conname",
    );
    expect(rows.map((r) => r.conname)).toEqual(
      expect.arrayContaining([
        'package_extension_ordinal_is_one_or_two',
        'package_extension_purchase_id_ordinal_key',
        'package_extension_moves_forward',
        'package_extension_is_three_months',
      ]),
    );
  });

  it('refuses an extension of any length but three months', async () => {
    // The length is fixed at the database as well as in the rule
    // (domain/billing/extension.ts). Postgres clamps a date to the month's
    // end exactly as `expiryOn` does, so the two never disagree.
    await expect(
      h.owner.query(
        'insert into package_extension (tenant_id, client_id, purchase_id, ordinal, from_on, to_on, ' +
          'reason, created_by) values ($1, $2, $3, 1, $4, $5, $6, $7)',
        [
          h.data.tenant.id,
          h.clientId(0),
          purchaseId,
          '2027-09-02',
          '2027-11-02',
          'Two months, which is not what an extension is.',
          h.data.users[SEEDED.owner]?.id ?? null,
        ],
      ),
    ).rejects.toThrow('package_extension_is_three_months');
  });

  it('is audited with the household named', async () => {
    const { rows } = await h.owner.query<{ description: string }>(
      "select obj_description('public.package_extension'::regclass, 'pg_class') as description",
    );
    expect(rows[0]?.description?.startsWith('audited: client')).toBe(true);
  });

  it('is read no more widely than the purchase it extends', async () => {
    // A row naming a household and carrying a sentence about why they asked.
    // Written as the practice, so the office's own read below is the one the
    // policy admits rather than the table owner's, which row security skips.
    // Written and read inside a transaction that is rolled back: the route
    // cases below extend this same programme, and they must find it with the
    // two extensions it is allowed still untouched.
    await h.owner.query('begin');
    try {
      await h.owner.query(
        'insert into package_extension (tenant_id, client_id, purchase_id, ordinal, from_on, to_on, ' +
          'reason, created_by) values ($1, $2, $3, 1, $4, $5, $6, $7)',
        [
          h.data.tenant.id,
          h.clientId(0),
          purchaseId,
          '2027-09-02',
          '2027-12-02',
          'The family asked for longer.',
          h.data.users[SEEDED.owner]?.id ?? null,
        ],
      );

      // The practitioner is not on this client's schedule — no appointment was
      // ever booked for them here — so app.client_visible_to_practitioner
      // answers false and ledger_readers shuts the row out. Without that policy
      // tenant_isolation alone lets them count it, which is the fault.
      expect(await countExtensionsAs('practitioner', SEEDED.practitioner)).toBe(0);
      expect(await countExtensionsAs('owner', SEEDED.owner)).toBe(1);
    } finally {
      await h.owner.query('rollback');
    }
  });
});

describe('POST /api/billing/package-purchases/:id/extension', () => {
  it('refuses somebody who does not record money', async () => {
    const res = await h.call(
      'POST',
      `/api/billing/package-purchases/${purchaseId}/extension`,
      SEEDED.practitioner,
      { extendedTo: '2028-03-01', reason: 'A long hospital stay.' },
    );
    expect(res.status).toBe(403);
  });

  it('refuses an id that is not one', async () => {
    const res = await h.call(
      'POST',
      '/api/billing/package-purchases/not-a-uuid/extension',
      SEEDED.owner,
      { extendedTo: '2028-03-01', reason: 'A long hospital stay.' },
    );
    expect(res.status).toBe(400);
  });

  it('refuses an extension with no reason: discretion is not the same as silence', async () => {
    const res = await h.call(
      'POST',
      `/api/billing/package-purchases/${purchaseId}/extension`,
      SEEDED.owner,
      { extendedTo: '2028-03-01', reason: '   ' },
    );
    expect(res.status).toBe(400);
  });

  it('refuses a date no later than the one it replaces', async () => {
    const res = await h.call(
      'POST',
      `/api/billing/package-purchases/${purchaseId}/extension`,
      SEEDED.owner,
      { extendedTo: '2027-09-02', reason: 'Trying to keep the same date.' },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('not_later');
  });

  it('extends it, keeping the original date beside the new one', async () => {
    const res = await h.call(
      'POST',
      `/api/billing/package-purchases/${purchaseId}/extension`,
      SEEDED.owner,
      { extendedTo: '2028-03-01', reason: 'A long hospital stay over the winter.' },
    );
    expect(res.status).toBe(201);
    const { purchase } = (await res.json()) as ExtendPurchaseResponse;
    // What was agreed and what was granted, both legible a year later.
    expect(purchase.expiresOn).toBe('2027-09-02');
    expect(purchase.extendedTo).toBe('2028-03-01');
    expect(purchase.extensionReason).toBe('A long hospital stay over the winter.');
  });

  it('records why in the audit trail, not only in the column', async () => {
    const { rows } = await h.owner.query<{ reason: string | null }>(
      "select reason from audit_log where entity_type = 'package_purchase' and action = 'update' " +
        'and entity_id = $1 order by occurred_at desc limit 1',
      [purchaseId],
    );
    expect(rows[0]?.reason).toBe('A long hospital stay over the winter.');
  });
});

describe('the double charge an extension used to cause', () => {
  beforeAll(async () => {
    // A programme sold long ago and already out of time. Written directly
    // rather than by waiting a year: what matters is a purchase whose credits
    // expired before today, which is the only state in which the two readers
    // of an expiry could disagree.
    await h.owner.query(
      "update package_purchase set purchased_on = '2024-01-01', expires_on = '2025-01-01' " +
        'where id = $1',
      [expiredPurchaseId],
    );
    await h.owner.query(
      "update entitlement set expires_on = '2025-01-01' where package_purchase_id = $1",
      [expiredPurchaseId],
    );
  });

  it('holds nothing usable while the programme is out of time', async () => {
    expect(await remainingSessions(1)).toBe(0);
  });

  it('charges a visit delivered after it ran out, which is correct', async () => {
    expect(await sessionInvoiceCount(1)).toBe(0);
    await deliverVisit(1);
    // No credit, a price on the list: the visit is invoiced at the single
    // rate. This is the behaviour the extension is about to change.
    expect(await sessionInvoiceCount(1)).toBe(1);
  });

  it('gives the sessions back when the programme is extended', async () => {
    const res = await h.call(
      'POST',
      `/api/billing/package-purchases/${expiredPurchaseId}/extension`,
      SEEDED.owner,
      { extendedTo: '2027-06-01', reason: 'The family was abroad for a year.' },
    );
    expect(res.status).toBe(201);
    expect(await remainingSessions(1)).toBe(15);
  });

  it('and finds one of them when the next visit is delivered, invoicing nothing', async () => {
    // The fault, in one assertion. Before, the balance said fifteen and the
    // ledger charged for a sixteenth: app.oldest_available_entitlement read
    // entitlement.expires_on alone and never saw the extension, so it found
    // no credit and raised a fresh single-visit invoice every time.
    const before = await sessionInvoiceCount(1);
    await deliverVisit(1);
    expect(await sessionInvoiceCount(1)).toBe(before);
    expect(await remainingSessions(1)).toBe(14);
  });
});
