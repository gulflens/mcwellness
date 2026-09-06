import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InvoicesResponse,
  type BalanceResponse,
  type PackagesResponse,
} from '../../../app/api/billing/ledger-schema';
import { callOutFeeDescription } from '../../../domain/billing/document';
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
 * One fee, never a session (the founder's decision of 2026-09-04,
 * docs/CHANGE-REQUESTS/billing-05.md, migration 408).
 *
 * Every case here is written the way the scheduling stream writes it — a plain
 * status update on `appointment`, with no billing statement anywhere near it.
 * That is the contract 404_billing_consumption.sql set and this round keeps:
 * calling a visit off is one transaction that touches no billing row, and the
 * ledger keeps up by itself.
 *
 * What changed is what the ledger does about it. It used to take one of the
 * family's prepaid sessions; now it takes nothing from the package and posts
 * the practice's call-out fee as a charge on the account.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-0000000000fe';
/** AED 150, `scheduling_setting.unfit_fee_fils` (202, the operator's figure). */
const FEE_FILS = 15_000;
/** What Postgres raises for a refusal, whether by a grant or by a role check. */
const INSUFFICIENT_PRIVILEGE = '42501';

let h: Harness;

/**
 * Stamps the same transaction settings the request-context middleware would,
 * as the seeded coordinator: calling a visit off is the office's act, and the
 * person doing it holds no billing role at all.
 */
async function asCoordinator(): Promise<void> {
  const user = h.data.users[SEEDED.admin];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'admin', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, REQUEST_ID],
  );
}

/**
 * Runs one statement as the API role — `app_role`, the role every request
 * connects as — with the roles the middleware would have stamped, and returns
 * the SQLSTATE it failed with, or null when it succeeded.
 *
 * This is how a definer door's own refusal is proved rather than the route's.
 * The route asks `mayWaive` and answers 403; the function underneath runs with
 * row security switched off, so what it asks for itself is the boundary, and
 * only a caller that is not the route can show it (tests/db/helpers.ts's
 * `asApiRole` is the same manoeuvre; this suite is not inside a transaction of
 * its own, so it opens one).
 */
async function refusalAsApiRole(
  sql: string,
  params: unknown[],
  roles: string,
): Promise<string | null> {
  const user = h.data.users[SEEDED.practitioner];
  await h.owner.query('begin');
  try {
    await h.owner.query('set local role app_role');
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', $3, true), set_config('app.reason', '', true)",
      [h.data.tenant.id, user?.id ?? null, roles],
    );
    await h.owner.query(sql, params);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  } finally {
    await h.owner.query('rollback');
  }
}

let appointmentSeq = 0;
/** A visit on the calendar, exactly as the scheduling stream books one. */
async function bookAppointment(clientId: string, serviceCode = 'nf-session'): Promise<string> {
  appointmentSeq += 1;
  const id = `00000000-0000-4000-8000-00000000c${String(appointmentSeq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[0];
  const client = h.data.clients.find((c) => c.id === clientId);
  // Each visit an hour after the last, so the no-overlap constraints hold.
  const start = new Date(Date.UTC(2026, 8, 10, 4 + appointmentSeq, 0, 0)).toISOString();
  await h.owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status) values ($1, $2, $3, $4, $5, $6, ' +
      "'home', $7::timestamptz, $7::timestamptz + interval '45 minutes', 'confirmed')",
    [
      id,
      h.data.tenant.id,
      clientId,
      practitioner?.id,
      h.serviceTypeId(serviceCode),
      client?.primaryLocationId,
      start,
    ],
  );
  return id;
}

/**
 * The one statement the cancel route runs, reason and all. A `no_show` is
 * written the way the session-capture flow writes it — a status and nothing
 * else: nobody called it off, so it carries no reason and no cancelled_at
 * (`appointment_cancellation_belongs_to_a_cancellation`, migration 203).
 */
async function callOff(
  appointmentId: string,
  status: 'cancelled' | 'cancelled_late' | 'no_show',
  reason: string | null = null,
): Promise<void> {
  if (status === 'no_show') {
    await h.owner.query(
      'update appointment set status = $2, cancellation_reason = null, cancelled_at = null ' +
        'where id = $1',
      [appointmentId, status],
    );
    return;
  }
  await h.owner.query(
    'update appointment set status = $2, cancellation_reason = $3, cancelled_at = now() where id = $1',
    [appointmentId, status, reason],
  );
}

type FeeInvoice = {
  kind: string;
  reference: string;
  issued_on: string;
  supplied_on: string | null;
  net_fils: number;
  vat_fils: number;
  gross_fils: number;
  waived_at: Date | null;
};

async function feeInvoicesFor(appointmentId: string): Promise<FeeInvoice[]> {
  const { rows } = await h.owner.query<FeeInvoice>(
    "select kind::text as kind, reference, to_char(issued_on, 'YYYY-MM-DD') as issued_on, " +
      "to_char(supplied_on, 'YYYY-MM-DD') as supplied_on, net_fils, vat_fils, gross_fils, " +
      'waived_at from invoice where appointment_id = $1 order by number',
    [appointmentId],
  );
  return rows;
}

async function balanceOf(clientId: string): Promise<BalanceResponse> {
  const res = await h.call('GET', `/api/billing/clients/${clientId}/balance`, SEEDED.owner);
  return (await res.json()) as BalanceResponse;
}

async function creditsFor(clientId: string, serviceCode = 'nf-session') {
  const { rows } = await h.owner.query<{
    status: string;
    consumption_kind: string | null;
    n: string;
  }>(
    'select e.status, e.consumption_kind, count(*)::text as n from entitlement e ' +
      'where e.client_id = $1 and e.service_type_id = $2 group by 1, 2 order by 1, 2',
    [clientId, h.serviceTypeId(serviceCode)],
  );
  return rows.map((row) => ({ ...row, n: Number(row.n) }));
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

  const sale = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
    packageId: silver.id,
    clientId: h.clientId(0),
    purchasedOn: SEED_TODAY,
  });
  if (sale.status !== 201) throw new Error('Silver could not be sold.');

  await asCoordinator();
});

afterAll(async () => {
  await h.close();
});

describe('a visit called off inside the notice period', () => {
  let appointmentId: string;

  it('leaves the family’s package exactly as it was', async () => {
    // Fifteen sessions bought, none delivered, and a late cancellation takes
    // none of them. This is the whole of the founder's change.
    expect(await creditsFor(h.clientId(0))).toEqual([
      { status: 'available', consumption_kind: null, n: 15 },
    ]);

    appointmentId = await bookAppointment(h.clientId(0));
    await callOff(appointmentId, 'cancelled_late', 'client_request');

    expect(await creditsFor(h.clientId(0))).toEqual([
      { status: 'available', consumption_kind: null, n: 15 },
    ]);
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from entitlement where consumed_by_appointment_id = $1',
      [appointmentId],
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('writes one charge of fifteen thousand fils, and names the visit', async () => {
    const invoices = await feeInvoicesFor(appointmentId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      kind: 'call_out_fee',
      net_fils: FEE_FILS,
      // No VAT: the practice is not registered for it, so the charge is the
      // net fee and the gross is the same figure (migration 406).
      vat_fils: 0,
      gross_fils: FEE_FILS,
      waived_at: null,
    });
  });

  it('reads as the call-out fee, with the visit’s date, in both languages', async () => {
    const { rows } = await h.owner.query<{
      description: string;
      description_ar: string | null;
      quantity: number;
      unit_net_fils: number;
      service_type_id: string | null;
    }>(
      'select l.description, l.description_ar, l.quantity, l.unit_net_fils, l.service_type_id ' +
        'from invoice_line l join invoice i on i.id = l.invoice_id where i.appointment_id = $1',
      [appointmentId],
    );
    expect(rows).toHaveLength(1);
    // The trigger's own literals, tied to domain/billing/document/strings.ts:
    // the database is the only writer, so the words exist in both places and
    // this is what stops them drifting apart.
    const words = callOutFeeDescription('2026-09-10');
    expect(rows[0]?.description).toBe(words.en);
    expect(rows[0]?.description_ar).toBe(words.ar);
    expect(rows[0]?.quantity).toBe(1);
    expect(rows[0]?.unit_net_fils).toBe(FEE_FILS);
    // A call-out fee is not a service the practice sells, so it names none.
    expect(rows[0]?.service_type_id).toBeNull();
  });

  it('says the visit was the day of supply, not the day it was billed', async () => {
    // A trigger reads the database's clock, not the harness's, so the day of
    // issue is whatever today is; the day of supply is the visit's, and that
    // is the figure a UAE tax invoice has to carry separately (migration 406).
    const { rows } = await h.owner.query<{ today: string }>(
      "select to_char((now() at time zone 'Asia/Dubai')::date, 'YYYY-MM-DD') as today",
    );
    const invoices = await feeInvoicesFor(appointmentId);
    expect(invoices[0]?.issued_on).toBe(rows[0]?.today);
    expect(invoices[0]?.supplied_on).toBe('2026-09-10');
  });

  it('leaves the family owing the fee, and takes nothing from the package', async () => {
    // Measured as a difference, because this household also bought Silver and
    // that sale is a charge of its own.
    const before = await balanceOf(h.clientId(0));
    const another = await bookAppointment(h.clientId(0));
    await callOff(another, 'cancelled_late', 'client_request');
    const after = await balanceOf(h.clientId(0));

    expect(after.outstandingFils - before.outstandingFils).toBe(FEE_FILS);
    expect(after.chargedFils - before.chargedFils).toBe(FEE_FILS);
    const sessions = after.services.find((s) => s.serviceTypeCode === 'nf-session');
    expect(sessions?.delivered).toBe(0);
    expect(sessions?.forfeited).toBe(0);
    expect(sessions?.remaining).toBe(15);
  });

  it('charges nothing more when the same cancellation is written again', async () => {
    await callOff(appointmentId, 'cancelled_late', 'client_request');
    await callOff(appointmentId, 'cancelled_late', 'client_request');
    expect(await feeInvoicesFor(appointmentId)).toHaveLength(1);
  });

  it('charges nothing more when the visit moves on to another fee outcome', async () => {
    // cancelled_late to no_show fires the trigger a second time, on a genuine
    // transition rather than a replay. One journey, one fee.
    await callOff(appointmentId, 'no_show');
    expect(await feeInvoicesFor(appointmentId)).toHaveLength(1);
  });
});

describe('a visit that could not go ahead at the door', () => {
  it('carries the same fee and takes no session either', async () => {
    const appointmentId = await bookAppointment(h.clientId(0));
    await callOff(appointmentId, 'cancelled_late', 'unfit_to_attend');

    const invoices = await feeInvoicesFor(appointmentId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.gross_fils).toBe(FEE_FILS);
    expect(await creditsFor(h.clientId(0))).toEqual([
      { status: 'available', consumption_kind: null, n: 15 },
    ]);
  });
});

describe('a visit nobody was there for', () => {
  it('carries the same fee: a journey made and no session delivered', async () => {
    // Claude's default of 2026-09-06, for the founder to overrule
    // (docs/CHANGE-REQUESTS/billing-05.md).
    const appointmentId = await bookAppointment(h.clientId(0));
    await callOff(appointmentId, 'no_show');

    const invoices = await feeInvoicesFor(appointmentId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.gross_fils).toBe(FEE_FILS);
    expect(await creditsFor(h.clientId(0))).toEqual([
      { status: 'available', consumption_kind: null, n: 15 },
    ]);
  });
});

describe('a visit called off in time', () => {
  it('charges nothing and takes nothing', async () => {
    const appointmentId = await bookAppointment(h.clientId(0));
    await callOff(appointmentId, 'cancelled', 'client_request');

    expect(await feeInvoicesFor(appointmentId)).toEqual([]);
    expect(await creditsFor(h.clientId(0))).toEqual([
      { status: 'available', consumption_kind: null, n: 15 },
    ]);
  });
});

describe('a visit the practice called off itself', () => {
  it('is late for the record and free for the family', async () => {
    // The status still says cancelled_late, because who was at fault belongs
    // in the reason rather than in the status
    // (domain/scheduling/cancellation.ts). The fee is what follows the fault.
    const appointmentId = await bookAppointment(h.clientId(0));
    await callOff(appointmentId, 'cancelled_late', 'practice_request');

    const { rows } = await h.owner.query<{ status: string }>(
      'select status::text as status from appointment where id = $1',
      [appointmentId],
    );
    expect(rows[0]?.status).toBe('cancelled_late');
    expect(await feeInvoicesFor(appointmentId)).toEqual([]);
  });
});

describe('a consent withdrawn', () => {
  it('costs the person who withdrew it nothing', async () => {
    const appointmentId = await bookAppointment(h.clientId(0));
    await callOff(appointmentId, 'cancelled_late', 'consent_withdrawn');
    expect(await feeInvoicesFor(appointmentId)).toEqual([]);
  });
});

describe('waiving the fee', () => {
  let appointmentId: string;
  let invoiceId: string;

  beforeAll(async () => {
    appointmentId = await bookAppointment(h.clientId(0));
    await callOff(appointmentId, 'cancelled_late', 'client_request');
    const { rows } = await h.owner.query<{ id: string }>(
      'select id from invoice where appointment_id = $1',
      [appointmentId],
    );
    invoiceId = String(rows[0]?.id);
  });

  it('takes the fee off what the family owes, without rewriting what happened', async () => {
    const owedBefore = (await balanceOf(h.clientId(0))).outstandingFils;

    const res = await h.call('POST', `/api/billing/invoices/${invoiceId}/waiver`, SEEDED.owner, {
      reason: 'The family had an emergency; the practice let it go.',
    });
    expect(res.status).toBe(201);

    const owedAfter = (await balanceOf(h.clientId(0))).outstandingFils;
    expect(owedBefore - owedAfter).toBe(FEE_FILS);

    // The charge is still there, and still says which visit it was for. A
    // waiver forgives a fee; it does not pretend the visit went ahead.
    const invoices = await feeInvoicesFor(appointmentId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.gross_fils).toBe(FEE_FILS);
    expect(invoices[0]?.waived_at).not.toBeNull();
  });

  it('says why, in the column and in the audit trail', async () => {
    const { rows } = await h.owner.query<{ reason: string | null }>(
      'select waiver_reason as reason from invoice where id = $1',
      [invoiceId],
    );
    expect(rows[0]?.reason).toBe('The family had an emergency; the practice let it go.');

    // A waiver is a decision somebody made about money, and the trail is where
    // a decision lives (docs/SPEC/audit.md section 5). The route stamps the
    // reason itself rather than trusting a header the browser may not have sent.
    const { rows: trail } = await h.owner.query<{ reason: string | null }>(
      "select reason from audit_log where entity_type = 'invoice' and entity_id = $1 " +
        "and action = 'update' order by occurred_at desc limit 1",
      [invoiceId],
    );
    expect(trail[0]?.reason).toBe('The family had an emergency; the practice let it go.');
  });

  it('shows in the invoice book as waived, with the day it was', async () => {
    // The row keeps its number and its figures and stops counting in the
    // balance, so the book has to say which of its charges a family still
    // owes — otherwise the total and the list above it do not add up and
    // nobody can see why (compliance review of this pull request).
    const res = await h.call('GET', '/api/billing/invoices', SEEDED.owner);
    const book = InvoicesResponse.parse(await res.json());
    const row = book.invoices.find((invoice) => invoice.id === invoiceId);
    const { rows } = await h.owner.query<{ waived_on: string }>(
      "select to_char(waived_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as waived_on " +
        'from invoice where id = $1',
      [invoiceId],
    );
    expect(row?.waivedAt).toBe(rows[0]?.waived_on);
    // And every other invoice in the book stands.
    expect(book.invoices.filter((invoice) => invoice.waivedAt !== null)).toHaveLength(1);
  });

  it('refuses to waive the same fee twice', async () => {
    const res = await h.call('POST', `/api/billing/invoices/${invoiceId}/waiver`, SEEDED.owner, {
      reason: 'Asking a second time, in case it takes.',
    });
    expect(res.status).toBe(409);
  });

  it('refuses to waive an ordinary invoice', async () => {
    // The Silver sale this suite opens with, which is a bill for something the
    // family has: unwinding one of those is a credit note and a conversation,
    // not a switch. The package invoice rather than a session's, because the
    // harness delivers no session and a case that asserts nothing when its row
    // is missing asserts nothing at all (done-when review of this pull
    // request).
    const { rows } = await h.owner.query<{ id: string }>(
      "select id from invoice where kind = 'package' order by number limit 1",
    );
    const ordinary = rows[0]?.id;
    expect(ordinary).toBeTruthy();
    const res = await h.call('POST', `/api/billing/invoices/${ordinary}/waiver`, SEEDED.owner, {
      reason: 'A package invoice is not a fee to forgive.',
    });
    expect(res.status).toBe(409);
  });

  it('is not a practitioner’s to give', async () => {
    const appointment = await bookAppointment(h.clientId(0));
    await callOff(appointment, 'cancelled_late', 'client_request');
    const { rows } = await h.owner.query<{ id: string }>(
      'select id from invoice where appointment_id = $1',
      [appointment],
    );
    const res = await h.call(
      'POST',
      `/api/billing/invoices/${rows[0]?.id}/waiver`,
      SEEDED.practitioner,
      { reason: 'Not mine to forgive, and the route says so.' },
    );
    expect(res.status).toBe(403);

    // And the door says so too, with the route out of the way. A security
    // definer function runs with row security switched off, so `mayWaive` is
    // the courtesy and this is the boundary: the same three roles a credit's
    // waiver is held to by `ledger_amenders` (security review of this pull
    // request).
    expect(
      await refusalAsApiRole(
        'select waived from app.waive_call_out_fee($1, $2)',
        [rows[0]?.id, 'Reaching past the route, which is the point of the case.'],
        'practitioner',
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);

    // And the same call from a context that may forgive is not refused, so the
    // case above is about the role and not about the manoeuvre. Rolled back
    // with the transaction it ran in.
    expect(
      await refusalAsApiRole(
        'select waived from app.waive_call_out_fee($1, $2)',
        [rows[0]?.id, 'Finance may forgive a fee, and this proves the door lets them.'],
        'finance',
      ),
    ).toBeNull();

    // Nothing was forgiven by the attempt.
    const after = await h.owner.query<{ waived_at: Date | null }>(
      'select waived_at from invoice where id = $1',
      [rows[0]?.id],
    );
    expect(after.rows[0]?.waived_at).toBeNull();
  });
});

describe('the invoice counter, for a practice named by its caller', () => {
  it('is not the API role’s to call', async () => {
    // `app.next_invoice_number(uuid)` exists for the trigger, which fires on a
    // row that knows its own practice. Its two callers are security definer
    // and run as the owner, so neither needs a grant — and granting one would
    // let any session name another practice and burn that practice's gapless
    // sequence, which is the one property a tax invoice's number has
    // (security review of this pull request).
    expect(
      await refusalAsApiRole(
        'select app.next_invoice_number($1)',
        [h.data.tenant.id],
        'owner,admin,finance',
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('a practice that charges no fee at all', () => {
  it('writes no charge rather than a charge of nothing', async () => {
    await h.owner.query('update scheduling_setting set unfit_fee_fils = 0 where tenant_id = $1', [
      h.data.tenant.id,
    ]);
    const appointmentId = await bookAppointment(h.clientId(0));
    await callOff(appointmentId, 'cancelled_late', 'client_request');
    expect(await feeInvoicesFor(appointmentId)).toEqual([]);
    await h.owner.query('update scheduling_setting set unfit_fee_fils = $2 where tenant_id = $1', [
      h.data.tenant.id,
      FEE_FILS,
    ]);
  });
});

describe('a practice whose cancellation policy cannot be read', () => {
  it('queues one exception, and lets the visit move on to a second outcome', async () => {
    // No `scheduling_setting` row at all — a database mid-migration, or a
    // practice created before 202's trigger existed. The fee cannot be known,
    // so the trigger queues the question for the office instead of guessing at
    // a figure.
    //
    // The case is the *second* transition. `billing_exception_one_per_appointment`
    // allows one exception per visit, so without the trigger's own guard
    // looking for one, moving `cancelled_late` on to `no_show` would insert a
    // second, hit that constraint, and fail the appointment's status update —
    // a settings row nobody had filled in would stop a visit being called off
    // at all (schema review of this pull request).
    await h.owner.query('delete from scheduling_setting where tenant_id = $1', [h.data.tenant.id]);
    try {
      const appointmentId = await bookAppointment(h.clientId(0));
      await callOff(appointmentId, 'cancelled_late', 'client_request');
      await callOff(appointmentId, 'no_show');

      const { rows: status } = await h.owner.query<{ status: string }>(
        'select status::text as status from appointment where id = $1',
        [appointmentId],
      );
      expect(status[0]?.status).toBe('no_show');

      const { rows: exceptions } = await h.owner.query<{ kind: string; n: string }>(
        'select kind::text as kind, count(*)::text as n from billing_exception ' +
          'where appointment_id = $1 group by 1',
        [appointmentId],
      );
      expect(exceptions).toEqual([{ kind: 'uncharged_call_out_fee', n: '1' }]);
      expect(await feeInvoicesFor(appointmentId)).toEqual([]);
    } finally {
      await h.owner.query(
        'insert into scheduling_setting (tenant_id, unfit_fee_fils) values ($1, $2)',
        [h.data.tenant.id, FEE_FILS],
      );
    }
  });
});
