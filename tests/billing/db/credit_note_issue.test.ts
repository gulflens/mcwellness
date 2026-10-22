import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PackagesResponse } from '../../../app/api/billing/ledger-schema';
import { requireDatabaseUrl } from '../../../db/runner/apply';
import { SEED_TODAY } from '../../../db/seed/generate';
import {
  creditableFor,
  type CreditableCredit,
  type CreditableInvoice,
} from '../../../domain/billing/creditNote';
import type { EntitlementStatus } from '../../../domain/billing/balance';
import { fils } from '../../../domain/shared';
import {
  SEEDED,
  setPracticePrices,
  setPracticeVatRegistration,
  silverInput,
  SILVER_CODE,
  startHarness,
  type Harness,
} from './support';

/**
 * Issuing a credit note (migration 417, docs/superpowers/specs/
 * 2026-10-22-credit-notes-design.md "Issuing" and "Credits").
 *
 * `app.issue_credit_note` is the one writer: it locks the invoice and the
 * credits behind it, works out what may be credited exactly as
 * `domain/billing/creditNote.ts`'s `creditableFor` does, numbers the note and
 * writes it with its lines, and closes the unused credits as `credited`. Every
 * call here is made the way the route will make it — as `app_role`, with the
 * request's settings stamped — so the function's own role check is what is
 * being exercised, not the table owner's reach.
 */

const NOW = () => new Date(`${SEED_TODAY}T09:00:00+04:00`);
const REASON = 'Invoiced to the wrong household by mistake.';
const INSUFFICIENT_PRIVILEGE = '42501';
const TINY_CODE = 'tiny-under-test';

let h: Harness;
let visitDay = '';
let keySeq = 0;

/** A fresh idempotency key, in the reserved fake range. */
function nextKey(): string {
  keySeq += 1;
  return `0000000c-0000-4000-8000-${String(keySeq).padStart(12, '0')}`;
}

/** Session-scoped settings on the owner connection, for writing fixtures. */
async function asPractice(roles = 'owner,admin,finance,lead_practitioner'): Promise<void> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', $3, false), " +
      "set_config('app.request_id', '00000000-0000-4000-8000-0000000000c7', false), " +
      "set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, roles],
  );
}

type Issued =
  { id: string; error?: undefined } | { id?: undefined; error: { code: string; message: string } };

/**
 * One call of the function, as the API role, in a transaction of its own that
 * commits — so the deferred checks (the note's lines, a package's allocation)
 * run and are part of what is being tested.
 */
async function issueOn(
  conn: pg.Client,
  invoiceId: string,
  options: { roles?: string; reason?: string; key?: string } = {},
): Promise<Issued> {
  const user = h.data.users[SEEDED.owner];
  const reason = options.reason ?? REASON;
  await conn.query('begin');
  try {
    await conn.query('set local role app_role');
    await conn.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', $3, true), " +
        "set_config('app.request_id', '00000000-0000-4000-8000-0000000000c8', true), " +
        "set_config('app.reason', $4, true)",
      [h.data.tenant.id, user?.id ?? null, options.roles ?? 'finance', reason],
    );
    const { rows } = await conn.query<{ id: string }>(
      'select app.issue_credit_note($1, $2, $3) as id',
      [invoiceId, reason, options.key ?? nextKey()],
    );
    await conn.query('commit');
    return { id: String(rows[0]?.id) };
  } catch (error) {
    await conn.query('rollback').catch(() => undefined);
    const e = error as { code?: string; message?: string };
    return { error: { code: e.code ?? 'unknown', message: e.message ?? '' } };
  }
}

async function issue(
  invoiceId: string,
  options: { roles?: string; reason?: string; key?: string } = {},
): Promise<Issued> {
  return issueOn(h.owner, invoiceId, options);
}

function issuedId(result: Issued): string {
  if (result.error)
    throw new Error(`expected a note, got ${result.error.code}: ${result.error.message}`);
  return result.id;
}

/** On a fresh connection, for the cases that need two at once. */
async function connection(): Promise<pg.Client> {
  const conn = new pg.Client({ connectionString: requireDatabaseUrl() });
  await conn.connect();
  return conn;
}

// ---------------------------------------------------------------------------
// Fixtures, each written the way the practice writes it.
// ---------------------------------------------------------------------------

let appointmentSeq = 0;
/** A visit tomorrow, called off inside the notice period: one call-out fee. */
async function callOutFee(clientIndex: number): Promise<string> {
  await asPractice('admin');
  appointmentSeq += 1;
  const practitioner = h.data.practitioners[0];
  const clientId = h.clientId(clientIndex);
  const client = h.data.clients.find((c) => c.id === clientId);
  const start = new Date(
    new Date(`${visitDay}T04:00:00.000Z`).getTime() + appointmentSeq * 3_600_000,
  ).toISOString();
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into appointment (tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status) values ($1, $2, $3, $4, $5, ' +
      "'home', $6::timestamptz, $6::timestamptz + interval '45 minutes', 'confirmed') returning id",
    [
      h.data.tenant.id,
      clientId,
      practitioner?.id,
      h.serviceTypeId('nf-session'),
      client?.primaryLocationId,
      start,
    ],
  );
  const appointmentId = String(rows[0]?.id);
  await h.owner.query(
    "update appointment set status = 'cancelled_late', cancellation_reason = 'client_request', " +
      'cancelled_at = now() where id = $1',
    [appointmentId],
  );
  const fee = await h.owner.query<{ id: string }>(
    'select id from invoice where appointment_id = $1',
    [appointmentId],
  );
  const id = fee.rows[0]?.id;
  if (!id) throw new Error('No call-out fee was written.');
  return id;
}

/**
 * A visit delivered for the client: the consumption trigger takes the oldest
 * credit for the service, or charges the visit on the spot when there is none.
 */
async function deliver(clientIndex: number, serviceCode = 'nf-session'): Promise<string> {
  await asPractice('practitioner');
  const practitioner = h.data.practitioners[0];
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values (gen_random_uuid(), $1, $2, $3, $4, 'home', " +
      "'in_progress', now()) " +
      'returning id',
    [h.data.tenant.id, h.clientId(clientIndex), practitioner?.id, h.serviceTypeId(serviceCode)],
  );
  const id = String(rows[0]?.id);
  await h.owner.query("update session set status = 'completed' where id = $1", [id]);
  return id;
}

/** The invoice a delivered visit with no credit to take was charged on. */
async function sessionInvoice(sessionId: string): Promise<string> {
  const { rows } = await h.owner.query<{ id: string }>(
    'select id from invoice where session_id = $1',
    [sessionId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('The visit was not charged.');
  return id;
}

/** One session sold ahead of its visit: a single_session invoice and one credit. */
async function sellSession(clientIndex: number): Promise<string> {
  const res = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, {
    clientId: h.clientId(clientIndex),
    serviceTypeId: h.serviceTypeId('nf-session'),
    purchasedOn: SEED_TODAY,
  });
  if (res.status !== 201) throw new Error(`The session could not be sold: ${res.status}`);
  return ((await res.json()) as { invoiceId: string }).invoiceId;
}

async function packageIdOf(code: string): Promise<string> {
  const list = await h.call('GET', '/api/billing/packages', SEEDED.owner);
  const found = ((await list.json()) as PackagesResponse).packages.find((p) => p.code === code);
  if (!found) throw new Error(`${code} is missing.`);
  return found.id;
}

/** A package sold to the client; returns its invoice and its purchase. */
async function sellPackage(
  clientIndex: number,
  code = SILVER_CODE,
): Promise<{ invoiceId: string; purchaseId: string }> {
  const sold = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
    packageId: await packageIdOf(code),
    clientId: h.clientId(clientIndex),
    purchasedOn: SEED_TODAY,
  });
  if (sold.status !== 201) throw new Error(`${code} could not be sold: ${sold.status}`);
  const body = (await sold.json()) as { purchase: { id: string; invoiceId: string | null } };
  return { invoiceId: String(body.purchase.invoiceId), purchaseId: body.purchase.id };
}

async function statementInvoice(clientIndex: number): Promise<string> {
  await asPractice();
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, ' +
      "gross_fils) values ($1, $2, app.next_invoice_number(), 'statement', $3, 10000, 0, 10000) " +
      'returning id',
    [h.data.tenant.id, h.clientId(clientIndex), SEED_TODAY],
  );
  return String(rows[0]?.id);
}

/**
 * A voided visit's credit given back, written as 969's
 * app.void_recorded_session writes it: the consumed credit is waived and an
 * available replacement points at the same invoice.
 */
async function restoreAsAVoidWould(sessionId: string): Promise<void> {
  await asPractice();
  const user = h.data.users[SEEDED.owner];
  const { rows } = await h.owner.query<{ id: string }>(
    "update entitlement set status = 'waived', waiver_reason = 'The visit was recorded in error.', " +
      "waived_at = now(), waived_by = $2 where consumed_by_session_id = $1 and status = 'consumed' " +
      'returning id',
    [sessionId, user?.id ?? null],
  );
  await h.owner.query(
    'insert into entitlement (tenant_id, client_id, service_type_id, source_type, ' +
      'package_purchase_id, invoice_id, allocated_net_fils, vat_rate_basis_points, ' +
      'vat_setting_version, expires_on, replaces_entitlement_id, created_by) ' +
      'select tenant_id, client_id, service_type_id, source_type, package_purchase_id, invoice_id, ' +
      'allocated_net_fils, vat_rate_basis_points, vat_setting_version, expires_on, id, $2 ' +
      'from entitlement where id = $1',
    [rows[0]?.id, user?.id ?? null],
  );
}

// ---------------------------------------------------------------------------
// Reading what was written.
// ---------------------------------------------------------------------------

type NoteRow = {
  id: string;
  reference: string;
  invoice_id: string;
  client_id: string;
  issued_on: string;
  reason: string;
  net_fils: number;
  vat_fils: number;
  gross_fils: number;
  released_net_fils: number;
  locale: string | null;
  supplier_legal_name: string;
  supplier_vat_registered: boolean | null;
};

async function noteRow(id: string): Promise<NoteRow> {
  const { rows } = await h.owner.query<NoteRow>(
    "select id, reference, invoice_id, client_id, to_char(issued_on, 'YYYY-MM-DD') as issued_on, " +
      'reason, net_fils, vat_fils, gross_fils, released_net_fils, locale::text as locale, ' +
      'supplier_legal_name, supplier_vat_registered from credit_note where id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error('No credit note was written.');
  return row;
}

async function noteLines(id: string) {
  const { rows } = await h.owner.query<{
    invoice_line_id: string;
    net_fils: number;
    vat_fils: number;
    gross_fils: number;
  }>(
    'select invoice_line_id, net_fils, vat_fils, gross_fils from credit_note_line ' +
      'where credit_note_id = $1 order by line_no',
    [id],
  );
  return rows;
}

async function balanceOf(clientIndex: number): Promise<number> {
  const { rows } = await h.owner.query<{ total: string }>(
    'select coalesce(sum(amount_fils), 0)::text as total from app.billing_ledger where client_id = $1',
    [h.clientId(clientIndex)],
  );
  return Number(rows[0]?.total);
}

/** The same rows the function reads, handed to the pure rule. */
async function creditableInputs(
  invoiceId: string,
): Promise<{ invoice: CreditableInvoice; credits: CreditableCredit[] }> {
  const { rows } = await h.owner.query<{
    kind: CreditableInvoice['kind'];
    waived: boolean;
    already: boolean;
    erased: boolean;
    package_purchase_id: string | null;
  }>(
    'select i.kind::text as kind, i.waived_at is not null as waived, ' +
      'exists (select 1 from credit_note n where n.invoice_id = i.id) as already, ' +
      "c.status = 'erased' as erased, i.package_purchase_id " +
      'from invoice i join client c on c.id = i.client_id where i.id = $1',
    [invoiceId],
  );
  const head = rows[0];
  if (!head) throw new Error('No such invoice.');
  const lines = await h.owner.query<{ id: string; net_fils: number; vat_fils: number }>(
    'select id, net_fils, vat_fils from invoice_line where invoice_id = $1 order by line_no',
    [invoiceId],
  );
  const credits = await h.owner.query<{
    id: string;
    status: EntitlementStatus;
    allocated_net_fils: number;
  }>(
    'select id, status::text as status, allocated_net_fils from entitlement ' +
      'where invoice_id = $1 or (package_purchase_id is not null and package_purchase_id = $2) ' +
      'order by created_at, id',
    [invoiceId, head.package_purchase_id],
  );
  return {
    invoice: {
      id: invoiceId,
      kind: head.kind,
      waived: head.waived,
      alreadyCredited: head.already,
      clientErased: head.erased,
      lines: lines.rows.map((line) => ({
        id: line.id,
        netFils: fils(line.net_fils),
        vatFils: fils(line.vat_fils),
      })),
    },
    credits: credits.rows.map((credit) => ({
      id: credit.id,
      status: credit.status,
      allocatedNetFils: fils(credit.allocated_net_fils),
    })),
  };
}

beforeAll(async () => {
  h = await startHarness(NOW);
  const tomorrow = await h.owner.query<{ day: string }>(
    "select to_char((now() at time zone 'Asia/Dubai')::date + 1, 'YYYY-MM-DD') as day",
  );
  visitDay = tomorrow.rows[0]?.day ?? '';
  await setPracticePrices(h, SEED_TODAY);
  const silver = await h.call(
    'POST',
    '/api/billing/packages',
    SEEDED.owner,
    silverInput(h, SEED_TODAY),
  );
  if (silver.status !== 201) throw new Error('Silver could not be created.');
  const tiny = await h.call('POST', '/api/billing/packages', SEEDED.owner, {
    code: TINY_CODE,
    name: 'One session',
    listPriceFils: 70_000,
    term: null,
    components: [{ serviceTypeId: h.serviceTypeId('nf-session'), quantity: 1 }],
    price: { validFrom: SEED_TODAY, amendmentReason: 'A bundle of one, for the suite.' },
  });
  if (tiny.status !== 201)
    throw new Error(`The one-session bundle could not be created: ${tiny.status}`);
}, 120_000);

afterAll(async () => {
  await h.close();
});

// ---------------------------------------------------------------------------

describe('issuing a credit note', () => {
  it('issues a credit note for a call-out fee and the balance drops by its gross', async () => {
    const invoiceId = await callOutFee(0);
    const before = await balanceOf(0);

    const id = issuedId(await issue(invoiceId));
    const note = await noteRow(id);
    const invoice = await h.owner.query<{
      gross_fils: number;
      net_fils: number;
      vat_fils: number;
      client_id: string;
      locale: string | null;
      supplier_legal_name: string;
      supplier_vat_registered: boolean | null;
    }>(
      'select gross_fils, net_fils, vat_fils, client_id, locale::text as locale, ' +
        'supplier_legal_name, supplier_vat_registered from invoice where id = $1',
      [invoiceId],
    );
    const inv = invoice.rows[0];
    const today = await h.owner.query<{ day: string }>(
      "select to_char((now() at time zone 'Asia/Dubai')::date, 'YYYY-MM-DD') as day",
    );

    expect(note).toMatchObject({
      invoice_id: invoiceId,
      client_id: inv?.client_id,
      issued_on: today.rows[0]?.day,
      reason: REASON,
      net_fils: inv?.net_fils,
      vat_fils: inv?.vat_fils,
      gross_fils: inv?.gross_fils,
      released_net_fils: 0,
      locale: inv?.locale,
      supplier_legal_name: inv?.supplier_legal_name,
      supplier_vat_registered: inv?.supplier_vat_registered,
    });
    expect(note.reference).toMatch(/^CN-\d{6}$/);
    expect(before - (await balanceOf(0))).toBe(inv?.gross_fils);
  });

  it('the ledger shows the note as a credit of minus its gross', async () => {
    const invoiceId = await callOutFee(0);
    const id = issuedId(await issue(invoiceId));
    const note = await noteRow(id);
    const { rows } = await h.owner.query<{
      entry_kind: string;
      reference: string;
      detail: string;
      occurred_on: string;
      amount_fils: number;
      client_id: string;
    }>(
      "select entry_kind, reference, detail, to_char(occurred_on, 'YYYY-MM-DD') as occurred_on, " +
        'amount_fils, client_id from app.billing_ledger where source_id = $1',
      [id],
    );
    expect(rows).toEqual([
      {
        entry_kind: 'credit',
        reference: note.reference,
        detail: 'credit_note',
        occurred_on: note.issued_on,
        amount_fils: -note.gross_fils,
        client_id: h.clientId(0),
      },
    ]);
  });

  it('credits the unused credits of a package and marks them credited', async () => {
    const { invoiceId, purchaseId } = await sellPackage(1);
    await deliver(1);
    await deliver(1);

    const id = issuedId(await issue(invoiceId));
    const note = await noteRow(id);

    const credits = await h.owner.query<{
      status: string;
      credited_by: string | null;
      n: string;
      net: string;
    }>(
      'select status::text as status, credited_by, count(*)::text as n, ' +
        'sum(allocated_net_fils)::text as net from entitlement where package_purchase_id = $1 ' +
        'group by 1, 2 order by 1',
      [purchaseId],
    );
    // Silver is eighteen credits; two were used and stay used.
    expect(
      credits.rows.map((row) => ({
        status: row.status,
        credited_by: row.credited_by,
        n: Number(row.n),
      })),
    ).toEqual([
      { status: 'consumed', credited_by: null, n: 2 },
      { status: 'credited', credited_by: id, n: 16 },
    ]);
    // The note credits exactly what the sixteen were allocated, off sessions owed.
    const creditedNet = Number(credits.rows.find((row) => row.status === 'credited')?.net);
    expect(note.net_fils).toBe(creditedNet);
    expect(note.released_net_fils).toBe(creditedNet);

    // The allocation check still holds: a credited credit still counts.
    const allocation = await h.owner.query<{ paid: number; allocated: string }>(
      'select p.net_fils as paid, (select sum(allocated_net_fils) from entitlement e ' +
        "where e.package_purchase_id = p.id and e.status <> 'waived')::text as allocated " +
        'from package_purchase p where p.id = $1',
      [purchaseId],
    );
    expect(Number(allocation.rows[0]?.allocated)).toBe(allocation.rows[0]?.paid);

    const purchase = await h.owner.query<{ status: string }>(
      'select status::text as status from package_purchase where id = $1',
      [purchaseId],
    );
    expect(purchase.rows[0]?.status).toBe('completed');
  });

  it('cancels a package purchase none of whose credits were used', async () => {
    const { invoiceId, purchaseId } = await sellPackage(2);
    const id = issuedId(await issue(invoiceId));
    const purchase = await h.owner.query<{ status: string; paid: number }>(
      'select status::text as status, net_fils as paid from package_purchase where id = $1',
      [purchaseId],
    );
    expect(purchase.rows[0]?.status).toBe('cancelled');
    const note = await noteRow(id);
    expect(note.net_fils).toBe(purchase.rows[0]?.paid);
    const left = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from entitlement where package_purchase_id = $1 and status <> 'credited'",
      [purchaseId],
    );
    expect(Number(left.rows[0]?.n)).toBe(0);
  });

  it('returns the first note for a repeated key and takes no second number', async () => {
    const invoiceId = await callOutFee(3);
    const key = nextKey();
    const first = issuedId(await issue(invoiceId, { key }));
    const series = async () =>
      (
        await h.owner.query<{ next_number: number }>(
          'select next_number from credit_note_series where tenant_id = $1',
          [h.data.tenant.id],
        )
      ).rows[0]?.next_number;
    const numberAfterFirst = await series();
    const second = issuedId(await issue(invoiceId, { key }));
    expect(second).toBe(first);
    expect(await series()).toBe(numberAfterFirst);
  });
});

describe('the SQL and creditableFor', () => {
  it('the SQL agrees with creditableFor on every seeded kind', async () => {
    // Registered, so every invoice carries VAT and the proportional
    // arithmetic has something to round.
    await setPracticeVatRegistration(h, true);
    try {
      const fee = await callOutFee(4);
      const delivered = await sessionInvoice(await deliver(5));
      const soldAhead = await sellSession(6);
      const soldAheadUsed = await sellSession(7);
      await deliver(7);
      const voidedSession = await deliver(8);
      const restored = await sessionInvoice(voidedSession);
      await restoreAsAVoidWould(voidedSession);
      const { invoiceId: pkg } = await sellPackage(9);
      await deliver(9);
      await deliver(9);
      await deliver(9, 'brain-map');
      const statement = await statementInvoice(10);

      const cases = { fee, delivered, soldAhead, soldAheadUsed, restored, pkg, statement };
      for (const [name, invoiceId] of Object.entries(cases)) {
        const { invoice, credits } = await creditableInputs(invoiceId);
        const expected = creditableFor(invoice, credits);
        const result = await issue(invoiceId);
        if (!expected.ok) {
          expect(result.error?.message, name).toBe(`credit_note_refused:${expected.refusal}`);
          continue;
        }
        const id = issuedId(result);
        const note = await noteRow(id);
        expect(
          {
            net: note.net_fils,
            vat: note.vat_fils,
            gross: note.gross_fils,
            released: note.released_net_fils,
          },
          name,
        ).toEqual({
          net: expected.plan.netFils,
          vat: expected.plan.vatFils,
          gross: expected.plan.grossFils,
          released: expected.plan.releasedNetFils,
        });
        expect(
          (await noteLines(id)).map((line) => ({
            invoiceLineId: line.invoice_line_id,
            netFils: line.net_fils,
            vatFils: line.vat_fils,
            grossFils: line.gross_fils,
          })),
          name,
        ).toEqual(expected.plan.lines);
        const credited = await h.owner.query<{ id: string }>(
          'select id from entitlement where credited_by = $1 order by id',
          [id],
        );
        expect(
          credited.rows.map((row) => row.id),
          name,
        ).toEqual([...expected.plan.creditedEntitlementIds].sort());
      }

      // And the cases are the ones they claim to be: VAT was charged, and the
      // restored and sold-ahead credits really came off sessions owed.
      const released = await h.owner.query<{
        invoice_id: string;
        released_net_fils: number;
        vat_fils: number;
      }>(
        'select invoice_id, released_net_fils, vat_fils from credit_note where invoice_id = any($1::uuid[])',
        [[soldAhead, restored, soldAheadUsed, pkg]],
      );
      const byInvoice = new Map(released.rows.map((row) => [row.invoice_id, row]));
      expect(byInvoice.get(soldAhead)?.released_net_fils).toBeGreaterThan(0);
      expect(byInvoice.get(restored)?.released_net_fils).toBeGreaterThan(0);
      expect(byInvoice.get(soldAheadUsed)?.released_net_fils).toBe(0);
      expect(byInvoice.get(pkg)?.vat_fils).toBeGreaterThan(0);
    } finally {
      await setPracticeVatRegistration(h, false);
    }
  });
});

describe('two things at once', () => {
  it('a visit closing while the note is issued leaves no credit both used and credited', async () => {
    const practitioner = h.data.users[SEEDED.practitioner];
    const context =
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
      "set_config('app.actor_roles', 'practitioner', true), " +
      "set_config('app.request_id', '00000000-0000-4000-8000-0000000000c9', true), " +
      "set_config('app.reason', '', true)";

    // Three ways round. Every audited write queues on the audit chain's one
    // row (070), so two writers serialise there; what this proves is that the
    // order they land in never leaves a credit both used and credited.
    //   - visit first: the visit holds its credit uncommitted while the note
    //     is asked for; the note waits on the credit's row lock, then reads it
    //     as used and credits the invoice to income.
    //   - note first: the note commits, then the visit closes, finds nothing
    //     and charges itself.
    //   - at once: both go together, and whichever wins, the other follows.
    const orders = ['visit-first', 'note-first', 'at-once'] as const;
    for (const [index, order] of orders.entries()) {
      const clientIndex = 11 + index;
      const invoiceId = await sellSession(clientIndex);
      await asPractice('practitioner');
      const opened = await h.owner.query<{ id: string }>(
        'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
          "delivery_mode, status, checked_in_at) values (gen_random_uuid(), $1, $2, $3, $4, 'home', " +
          "'in_progress', now()) returning id",
        [
          h.data.tenant.id,
          h.clientId(clientIndex),
          h.data.practitioners[1]?.id,
          h.serviceTypeId('nf-session'),
        ],
      );
      const sessionId = String(opened.rows[0]?.id);

      const noteSide = await connection();
      const visitSide = await connection();
      const closeVisit = async () => {
        await visitSide.query('begin');
        await visitSide.query(context, [h.data.tenant.id, practitioner?.id ?? null]);
        await visitSide.query("update session set status = 'completed' where id = $1", [sessionId]);
        await visitSide.query('commit');
      };
      try {
        if (order === 'visit-first') {
          await visitSide.query('begin');
          await visitSide.query(context, [h.data.tenant.id, practitioner?.id ?? null]);
          await visitSide.query("update session set status = 'completed' where id = $1", [
            sessionId,
          ]);
          const issued = issueOn(noteSide, invoiceId);
          // Long enough for the note to be waiting on the credit's lock.
          await new Promise((resolve) => setTimeout(resolve, 200));
          await visitSide.query('commit');
          issuedId(await issued);
        } else if (order === 'note-first') {
          issuedId(await issueOn(noteSide, invoiceId));
          await closeVisit();
        } else {
          const [issued] = await Promise.all([issueOn(noteSide, invoiceId), closeVisit()]);
          issuedId(issued);
        }
      } finally {
        await noteSide.end();
        await visitSide.end();
      }

      const both = await h.owner.query<{ n: string }>(
        'select count(*)::text as n from entitlement ' +
          "where status = 'consumed' and credited_by is not null",
      );
      expect(Number(both.rows[0]?.n), order).toBe(0);

      // And each side got a true answer: either the note credited the unused
      // credit off sessions owed and the visit charged itself, or the visit
      // used the credit and the note credited the invoice to income.
      const note = await h.owner.query<{ released_net_fils: number }>(
        'select released_net_fils from credit_note where invoice_id = $1',
        [invoiceId],
      );
      const charged = await h.owner.query<{ n: string }>(
        'select count(*)::text as n from invoice where session_id = $1',
        [sessionId],
      );
      const usedTheSoldCredit = await h.owner.query<{ n: string }>(
        'select count(*)::text as n from entitlement where consumed_by_session_id = $1 ' +
          'and invoice_id = $2',
        [sessionId, invoiceId],
      );
      const noteWon = (note.rows[0]?.released_net_fils ?? 0) > 0;
      if (order === 'visit-first') expect(noteWon, order).toBe(false);
      if (order === 'note-first') expect(noteWon, order).toBe(true);
      expect(Number(charged.rows[0]?.n), order).toBe(noteWon ? 1 : 0);
      expect(Number(usedTheSoldCredit.rows[0]?.n), order).toBe(noteWon ? 0 : 1);
    }
  });

  it('two issues on one invoice produce one note', async () => {
    const invoiceId = await callOutFee(13);
    const a = await connection();
    const b = await connection();
    try {
      const results = await Promise.all([issueOn(a, invoiceId), issueOn(b, invoiceId)]);
      const ok = results.filter((result) => !result.error);
      const refused = results.filter((result) => result.error);
      expect(ok).toHaveLength(1);
      expect(refused.map((result) => result.error?.message)).toEqual([
        'credit_note_refused:already_credited',
      ]);
    } finally {
      await a.end();
      await b.end();
    }
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from credit_note where invoice_id = $1',
      [invoiceId],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

describe('what is refused', () => {
  it('refuses a statement', async () => {
    const result = await issue(await statementInvoice(14));
    expect(result.error?.message).toBe('credit_note_refused:statement');
  });

  it('refuses a waived invoice', async () => {
    const invoiceId = await callOutFee(14);
    await asPractice('finance');
    await h.owner.query('select app.waive_call_out_fee($1, $2)', [
      invoiceId,
      'The family had an emergency; the practice let it go.',
    ]);
    const result = await issue(invoiceId);
    expect(result.error?.message).toBe('credit_note_refused:waived');
  });

  it('refuses an invoice already credited', async () => {
    const invoiceId = await callOutFee(14);
    issuedId(await issue(invoiceId));
    const result = await issue(invoiceId);
    expect(result.error?.message).toBe('credit_note_refused:already_credited');
  });

  it('refuses a package whose credits are all used', async () => {
    const { invoiceId } = await sellPackage(15, TINY_CODE);
    await deliver(15);
    const result = await issue(invoiceId);
    expect(result.error?.message).toBe('credit_note_refused:nothing_left');
  });

  it("refuses an erased client's invoice", async () => {
    const clientIndex = 16;
    const invoiceId = await sellSession(clientIndex);
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
    const result = await issue(invoiceId);
    expect(result.error?.message).toBe('credit_note_refused:client_erased');
  });

  it('refuses a practitioner, in the database and not only in the route', async () => {
    const invoiceId = await callOutFee(17);
    const result = await issue(invoiceId, { roles: 'practitioner' });
    expect(result.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    // And finance, from the same manoeuvre, may.
    issuedId(await issue(invoiceId, { roles: 'finance' }));
  });

  it('refuses a reason shorter than eight characters', async () => {
    const invoiceId = await callOutFee(17);
    const result = await issue(invoiceId, { reason: '  short  ' });
    expect(result.error?.code).toBe('22023');
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from credit_note where invoice_id = $1',
      [invoiceId],
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
