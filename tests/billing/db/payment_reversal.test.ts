import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_TODAY } from '../../../db/seed/generate';
import { IDS, seedClient, seedTenant } from '../../db/helpers';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * Reversing a payment recorded in error (migration 419, docs/superpowers/specs/
 * 2026-10-23-payment-reversal-design.md).
 *
 * `app.reverse_payment` is the one writer. Every call is made the way the
 * route will make it: as `app_role`, with the request's settings stamped, so
 * the function's own role check is what is exercised.
 */

const NOW = () => new Date(`${SEED_TODAY}T09:00:00+04:00`);
const REASON = 'Typed 5,000 instead of 500 by mistake.';
const INSUFFICIENT_PRIVILEGE = '42501';
const INVALID_PARAMETER = '22023';

let h: Harness;
let keySeq = 0;

function nextKey(): string {
  keySeq += 1;
  return `0000000e-0000-4000-8000-${String(keySeq).padStart(12, '0')}`;
}

async function asPractice(roles = 'owner,admin,finance'): Promise<void> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', $3, false), " +
      "set_config('app.request_id', '00000000-0000-4000-8000-0000000000e7', false), " +
      "set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, roles],
  );
}

type Reversed =
  { id: string; error?: undefined } | { id?: undefined; error: { code: string; message: string } };

/** One call, as the API role, in a transaction of its own that commits. */
async function reverse(
  paymentId: string,
  options: { roles?: string; reason?: string; key?: string | null } = {},
): Promise<Reversed> {
  const user = h.data.users[SEEDED.owner];
  const reason = options.reason ?? REASON;
  const key = options.key === undefined ? nextKey() : options.key;
  await h.owner.query('begin');
  try {
    await h.owner.query('set local role app_role');
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', $3, true), " +
        "set_config('app.request_id', '00000000-0000-4000-8000-0000000000e8', true), " +
        "set_config('app.reason', $4, true)",
      [h.data.tenant.id, user?.id ?? null, options.roles ?? 'finance', reason],
    );
    const { rows } = await h.owner.query<{ id: string }>(
      'select app.reverse_payment($1, $2, $3) as id',
      [paymentId, reason, key],
    );
    await h.owner.query('commit');
    return { id: String(rows[0]?.id) };
  } catch (error) {
    await h.owner.query('rollback').catch(() => undefined);
    const e = error as { code?: string; message?: string };
    return { error: { code: e.code ?? 'unknown', message: e.message ?? '' } };
  }
}

function reversedId(result: Reversed): string {
  if (result.error) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.id;
}

/** A payment recorded through the route, the way the drawer records it. */
async function record(clientIndex: number, amountFils: number): Promise<string> {
  const res = await h.call(
    'POST',
    '/api/billing/payments',
    SEEDED.owner,
    { clientId: h.clientId(clientIndex), method: 'transfer', amountFils },
    { 'idempotency-key': nextKey() },
  );
  if (res.status !== 201) throw new Error(`The payment could not be recorded: ${res.status}`);
  const { rows } = await h.owner.query<{ id: string }>(
    'select id from payment where client_id = $1 order by created_at desc limit 1',
    [h.clientId(clientIndex)],
  );
  return String(rows[0]?.id);
}

async function balance(clientIndex: number): Promise<number> {
  const { rows } = await h.owner.query<{ total: string }>(
    'select coalesce(sum(amount_fils), 0)::text as total from app.billing_ledger ' +
      'where client_id = $1',
    [h.clientId(clientIndex)],
  );
  return Number(rows[0]?.total);
}

async function reversalCount(): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(
    'select count(*)::text as n from payment_reversal',
  );
  return Number(rows[0]?.n);
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await asPractice();
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('app.reverse_payment', () => {
  it('reverses a payment, and the ledger balance rises by its amount', async () => {
    const paymentId = await record(0, 50_000);
    const before = await balance(0);
    const id = reversedId(await reverse(paymentId));
    expect(await balance(0)).toBe(before + 50_000);

    const { rows } = await h.owner.query<{
      payment_id: string;
      client_id: string;
      reason: string;
      reversed_on: string;
    }>(
      "select payment_id, client_id, reason, to_char(reversed_on, 'YYYY-MM-DD') as reversed_on " +
        'from payment_reversal where id = $1',
      [id],
    );
    expect(rows[0]?.payment_id).toBe(paymentId);
    expect(rows[0]?.client_id).toBe(h.clientId(0));
    expect(rows[0]?.reason).toBe(REASON);
    // The practice's own day, not the server's or the browser's.
    const { rows: today } = await h.owner.query<{ today: string }>(
      "select to_char((now() at time zone timezone)::date, 'YYYY-MM-DD') as today " +
        'from tenant where id = $1',
      [h.data.tenant.id],
    );
    expect(rows[0]?.reversed_on).toBe(today[0]?.today);
  });

  it('shows the reversal in the ledger as a plus entry naming the payment', async () => {
    const paymentId = await record(1, 12_500);
    reversedId(await reverse(paymentId));
    const { rows } = await h.owner.query<{ entry_kind: string; amount_fils: number }>(
      'select entry_kind, amount_fils from app.billing_ledger where source_id = $1 ' +
        'order by amount_fils',
      [paymentId],
    );
    expect(rows.map((r) => [r.entry_kind, Number(r.amount_fils)])).toEqual([
      ['payment', -12_500],
      ['reversal', 12_500],
    ]);
  });

  it('refuses a second reversal of the same payment as already_reversed', async () => {
    const paymentId = await record(2, 20_000);
    reversedId(await reverse(paymentId));
    const again = await reverse(paymentId);
    expect(again.error?.message).toBe('reversal_refused:already_reversed');
  });

  it('answers the same key on the same payment with the same reversal and writes nothing new', async () => {
    const paymentId = await record(3, 30_000);
    const key = nextKey();
    const first = reversedId(await reverse(paymentId, { key }));
    const rows = await reversalCount();
    const balanceAfter = await balance(3);
    const second = reversedId(await reverse(paymentId, { key }));
    expect(second).toBe(first);
    expect(await reversalCount()).toBe(rows);
    expect(await balance(3)).toBe(balanceAfter);
  });

  it('refuses a key already used for another payment', async () => {
    const one = await record(4, 10_000);
    const two = await record(4, 11_000);
    const key = nextKey();
    reversedId(await reverse(one, { key }));
    const result = await reverse(two, { key });
    expect(result.error?.code).toBe(INVALID_PARAMETER);
    expect(
      (await h.owner.query('select 1 from payment_reversal where payment_id = $1', [two])).rowCount,
    ).toBe(0);
  });

  it('refuses a missing key and a reason under eight characters', async () => {
    const paymentId = await record(5, 10_000);
    expect((await reverse(paymentId, { key: null })).error?.code).toBe(INVALID_PARAMETER);
    expect((await reverse(paymentId, { reason: '  short  ' })).error?.code).toBe(INVALID_PARAMETER);
  });

  it('refuses a practitioner at the database', async () => {
    const paymentId = await record(6, 10_000);
    const result = await reverse(paymentId, { roles: 'practitioner' });
    expect(result.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('lets an admin and the owner reverse too', async () => {
    const a = await record(7, 10_000);
    const b = await record(7, 10_000);
    reversedId(await reverse(a, { roles: 'admin' }));
    reversedId(await reverse(b, { roles: 'owner' }));
  });

  it('finds no payment of another practice, and writes nothing', async () => {
    const paymentB = '00000000-0000-4000-8000-0000000000b4';
    await seedTenant(h.owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
    await seedClient(h.owner, IDS.tenantB, IDS.clientB, IDS.ownerB, 'Beta');
    await h.owner.query(
      'insert into payment (id, tenant_id, client_id, method, amount_fils, received_at, ' +
        "idempotency_key) values ($1, $2, $3, 'cash', 10000, now(), '0000000e-0000-4000-8000-0000000000b5')",
      [paymentB, IDS.tenantB, IDS.clientB],
    );
    const before = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from payment_reversal',
    );
    // Practice A's app_role, asking for practice B's real payment.
    const result = await reverse(paymentB);
    expect(result.error?.code).toBe('P0002');
    expect(result.error?.message).toBe('payment_not_found');
    const after = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from payment_reversal',
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    expect(
      (await h.owner.query('select 1 from payment_reversal where payment_id = $1', [paymentB]))
        .rowCount,
    ).toBe(0);
  });

  it("refuses an erased client's payment", async () => {
    const clientIndex = 16;
    const paymentId = await record(clientIndex, 40_000);
    const owner = h.data.users[SEEDED.owner];
    const { rows: requested } = await h.owner.query<{ id: string }>(
      'insert into erasure_request (tenant_id, client_id, reason, created_by) ' +
        "values ($1, $2, 'The household asked.', $3) returning id",
      [h.data.tenant.id, h.clientId(clientIndex), owner?.id],
    );
    await asPractice('owner');
    await h.owner.query("select set_config('app.reason', 'The household asked.', false)");
    await h.owner.query('select app.erase_client($1, $2)', [
      h.clientId(clientIndex),
      requested[0]?.id,
    ]);
    const result = await reverse(paymentId);
    expect(result.error?.message).toBe('reversal_refused:client_erased');
  });
});

/** Runs `fn` as the API role in a rolled-back transaction. */
async function asApp<T>(
  fn: (c: pg.Client) => Promise<T>,
  settings: { tenant?: string; actor?: string | null; roles: string },
): Promise<T> {
  await h.owner.query('begin');
  try {
    await h.owner.query('set local role app_role');
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', $3, true)",
      [settings.tenant ?? h.data.tenant.id, settings.actor ?? '', settings.roles],
    );
    return await fn(h.owner);
  } finally {
    await h.owner.query('rollback');
  }
}

describe('payment_reversal, as the API role', () => {
  it('cannot be inserted into directly', async () => {
    const paymentId = await record(8, 10_000);
    await asApp(
      async (c) => {
        await c.query('savepoint s');
        await expect(
          c.query(
            'insert into payment_reversal (tenant_id, client_id, payment_id, reversed_on, reason, ' +
              "idempotency_key) values ($1, $2, $3, current_date, 'a direct write', 'k')",
            [h.data.tenant.id, h.clientId(8), paymentId],
          ),
        ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      },
      { roles: 'owner,admin,finance' },
    );
  });

  it('is read by the office and by the household’s own contact, and by no other contact', async () => {
    const withLogin = h.data.contacts.filter((c) => c.userId !== null);
    const mine = withLogin[0];
    const other = withLogin.find((c) => c.clientId !== mine?.clientId);
    if (!mine || !other) throw new Error('The seed has no two portal households.');
    const clientIndex = h.data.clients.findIndex((c) => c.id === mine.clientId);
    const paymentId = await record(clientIndex, 25_000);
    reversedId(await reverse(paymentId));

    const count = (c: pg.Client) =>
      c.query<{ n: string }>('select count(*)::text as n from payment_reversal');
    await asApp(async (c) => expect(Number((await count(c)).rows[0]?.n)).toBeGreaterThan(0), {
      roles: 'owner,admin,finance',
    });
    await asApp(
      async (c) => {
        const { rows } = await c.query<{ payment_id: string; client_id: string }>(
          'select payment_id, client_id from payment_reversal',
        );
        expect(rows.map((r) => r.payment_id)).toContain(paymentId);
        expect(new Set(rows.map((r) => r.client_id))).toEqual(new Set([mine.clientId]));
      },
      { roles: 'client_contact', actor: mine.userId },
    );
    await asApp(async (c) => expect(Number((await count(c)).rows[0]?.n)).toBe(0), {
      roles: 'client_contact',
      actor: other.userId,
    });
  });

  it('is not read across practices', async () => {
    await asApp(
      async (c) =>
        expect(
          Number(
            (await c.query<{ n: string }>('select count(*)::text as n from payment_reversal'))
              .rows[0]?.n,
          ),
        ).toBe(0),
      { tenant: '00000000-0000-4000-8000-0000000000aa', roles: 'owner,admin,finance' },
    );
  });
});
