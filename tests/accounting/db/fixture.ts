import { SEED_TODAY } from '../../../db/seed/generate';
import { SEEDED, setPracticePrices, silverInput, SILVER_CODE, type Harness } from './support';

/**
 * A month of the practice's own trading, built through billing's own routes and
 * its own triggers, so the identities of docs/SPEC/accounting.md section 7 are
 * proved against the platform's real rows and not against a fixture written to
 * agree with them.
 *
 * What it makes: a Silver programme sold to the first household and paid for by
 * transfer; two visits delivered, which billing's own trigger turns into
 * consumed credits; a second payment in cash; a visit called off late, which
 * billing's own trigger turns into a call-out fee, and then forgiven; and a
 * payment from a second household, which `eraseHousehold` below then really
 * erases — whose money the books must still hold, because the practice's
 * takings are a fact about the practice.
 */

const REQUEST_ID = '0000000e-0000-4000-8000-0000000000fa';
/** A second payment, in cash, off account. */
export const CASH_PAYMENT_FILS = 50_000;

export type Activity = {
  packageId: string;
  clientId: string;
  erasedClientId: string;
  feeInvoiceId: string;
  month: string;
};

let sessionSeq = 0;
let appointmentSeq = 0;

async function asPractitioner(h: Harness): Promise<void> {
  const user = h.data.users[SEEDED.practitioner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'practitioner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, REQUEST_ID],
  );
}

async function asOwner(h: Harness): Promise<void> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner,admin,finance,lead_practitioner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', 'a synthetic fixture', false)",
    [h.data.tenant.id, user?.id ?? null, REQUEST_ID],
  );
}

/** A completed visit, exactly as the session-capture stream writes one. */
async function deliverVisit(h: Harness, clientId: string): Promise<void> {
  sessionSeq += 1;
  const id = `0000000e-0000-4000-8000-00000000b${String(sessionSeq).padStart(3, '0')}`;
  await asPractitioner(h);
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', 'completed', now())",
    [id, h.data.tenant.id, clientId, h.data.practitioners[0]?.id, h.serviceTypeId('nf-session')],
  );
  await asOwner(h);
}

/** A visit on the calendar, exactly as the scheduling stream books one. */
async function bookAppointment(h: Harness, clientId: string): Promise<string> {
  appointmentSeq += 1;
  const id = `0000000e-0000-4000-8000-00000000c${String(appointmentSeq).padStart(3, '0')}`;
  const client = h.data.clients.find((c) => c.id === clientId);
  const start = new Date(Date.UTC(2026, 8, 10, 4 + appointmentSeq, 0, 0)).toISOString();
  await h.owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status) values ($1, $2, $3, $4, $5, $6, ' +
      "'home', $7::timestamptz, $7::timestamptz + interval '45 minutes', 'confirmed')",
    [
      id,
      h.data.tenant.id,
      clientId,
      h.data.practitioners[0]?.id,
      h.serviceTypeId('nf-session'),
      client?.primaryLocationId,
      start,
    ],
  );
  return id;
}

export async function buildActivity(h: Harness): Promise<Activity> {
  await asOwner(h);
  await setPracticePrices(h, SEED_TODAY);

  const created = await h.call(
    'POST',
    '/api/billing/packages',
    SEEDED.owner,
    silverInput(h, SEED_TODAY),
    {
      'x-reason': "The practice's own launch pricing.",
    },
  );
  if (created.status !== 201) {
    throw new Error(`Silver was not created: ${created.status}`);
  }
  const listed = await h.call('GET', '/api/billing/packages', SEEDED.owner);
  const packages = (await listed.json()) as {
    packages: { id: string; code: string; currentPrice: { grossFils: number } | null }[];
  };
  const silver = packages.packages.find((p) => p.code === SILVER_CODE);
  if (!silver?.currentPrice) {
    throw new Error('Silver was not in the catalogue with a price.');
  }

  const clientId = h.clientId(0);
  const sold = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
    packageId: silver.id,
    clientId,
    purchasedOn: SEED_TODAY,
    payment: { method: 'transfer', amountFils: silver.currentPrice.grossFils },
  });
  if (sold.status !== 201) {
    throw new Error(`The programme was not sold: ${sold.status}`);
  }

  await deliverVisit(h, clientId);
  await deliverVisit(h, clientId);

  const cash = await h.call('POST', '/api/billing/payments', SEEDED.owner, {
    clientId,
    method: 'cash',
    amountFils: CASH_PAYMENT_FILS,
  });
  if (cash.status !== 201) {
    throw new Error(`The cash payment was not recorded: ${cash.status}`);
  }

  // A visit called off too late: billing's own trigger posts the call-out fee.
  const appointmentId = await bookAppointment(h, clientId);
  await h.owner.query(
    "update appointment set status = 'cancelled_late', cancellation_reason = 'client_request', " +
      'cancelled_at = now() where id = $1',
    [appointmentId],
  );
  const fee = await h.owner.query<{ id: string }>(
    'select id from invoice where appointment_id = $1 order by number desc limit 1',
    [appointmentId],
  );
  const feeInvoiceId = fee.rows[0]?.id;
  if (!feeInvoiceId) {
    throw new Error('No call-out fee invoice was raised.');
  }
  const waived = await h.call(
    'POST',
    `/api/billing/invoices/${feeInvoiceId}/waiver`,
    SEEDED.owner,
    { reason: 'The practitioner had not set out yet.' },
    { 'x-reason': 'The practitioner had not set out yet.' },
  );
  if (waived.status !== 200 && waived.status !== 201) {
    throw new Error(`The call-out fee was not waived: ${waived.status}`);
  }

  // A second household, paid up and then erased. Its money stays in the books.
  const erasedClientId = h.clientId(1);
  const theirs = await h.call('POST', '/api/billing/payments', SEEDED.owner, {
    clientId: erasedClientId,
    method: 'link',
    amountFils: 30_000,
  });
  if (theirs.status !== 201) {
    throw new Error(`The second household's payment was not recorded: ${theirs.status}`);
  }

  return {
    packageId: silver.id,
    clientId,
    erasedClientId,
    feeInvoiceId,
    month: SEED_TODAY.slice(0, 7),
  };
}

/**
 * The erasure the platform really performs (docs/SPEC/client-record.md section
 * 8): the request is recorded and then carried out, through the routes a
 * coordinator uses, and not by an update to `client.status`. The books have no
 * step in it — no row here names a household — which is exactly what
 * `tests/accounting/db/posting.test.ts` asks the statements to prove.
 */
export async function eraseHousehold(h: Harness, clientId: string): Promise<void> {
  const asked = await h.call('POST', `/api/clients/${clientId}/erasure-requests`, SEEDED.admin, {
    reason: 'The household asked for their record to be removed.',
  });
  if (asked.status !== 201) {
    throw new Error(`The erasure was not recorded: ${asked.status}`);
  }
  const { id } = (await asked.json()) as { id: string };
  const done = await h.call(
    'POST',
    `/api/clients/${clientId}/erasure-requests/${id}/execute`,
    SEEDED.admin,
    {},
    { 'x-reason': 'Erasure requested by the household.' },
  );
  if (done.status !== 200) {
    throw new Error(`The erasure was not performed: ${done.status}`);
  }
}
