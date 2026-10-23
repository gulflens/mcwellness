import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ledgerEntry, type LedgerDbRow } from '../../../app/api/billing/ledger-entries';
import { DebtorsResponse, type BalanceResponse } from '../../../app/api/billing/ledger-schema';
import { statementLines } from '../../../domain/billing';
import { SEED_TENANT_ID, SEED_TODAY } from '../../../db/seed/generate';
import { seedUser } from '../../db/helpers';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * The payment-reversal route, and the readers that follow it: the receipt
 * book, the balance, the debtors list and the statement (docs/superpowers/
 * specs/2026-10-23-payment-reversal-design.md). The rule is tested in
 * payment_reversal.test.ts and domain/billing/reversal.test.ts; this file is
 * about the door and about every reader agreeing once a payment is cancelled.
 */

const NOW = () => new Date(`${SEED_TODAY}T09:00:00+04:00`);
const REASON = 'Recorded against the wrong household by mistake.';
const FINANCE_ONLY = {
  userId: '0000000d-0000-4000-8000-0000000000a1',
  authId: '0000000d-0000-4000-8000-0000000000a2',
} as const;

let h: Harness;
let keySeq = 0;

function nextKey(): string {
  keySeq += 1;
  return `0000000d-0000-4000-8000-${String(keySeq + 500).padStart(12, '0')}`;
}

function daysBefore(days: number, from: string = SEED_TODAY): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function actAsOwner(): Promise<void> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner,admin,finance', false), " +
      "set_config('app.request_id', '00000000-0000-4000-8000-0000000000a9', false), " +
      "set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null],
  );
}

async function invoice(clientId: string, issuedOn: string, grossFils: number): Promise<string> {
  await actAsOwner();
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, ' +
      "gross_fils) values ($1, $2, app.next_invoice_number(), 'statement', $3, $4, 0, $4) " +
      'returning id',
    [h.data.tenant.id, clientId, issuedOn, grossFils],
  );
  return String(rows[0]?.id);
}

async function payment(clientId: string, onDay: string, amountFils: number): Promise<string> {
  await actAsOwner();
  const { rows } = await h.owner.query<{ id: string }>(
    'insert into payment (tenant_id, client_id, method, amount_fils, received_at) ' +
      "values ($1, $2, 'transfer', $3, ($4::date + time '12:00') at time zone 'Asia/Dubai') " +
      'returning id',
    [h.data.tenant.id, clientId, amountFils, onDay],
  );
  return String(rows[0]?.id);
}

/** Reverses and answers the day the database dated it: its own today, not the seed's. */
async function reversedOn(paymentId: string): Promise<string> {
  const res = await reverse(paymentId, { reason: REASON, idempotencyKey: nextKey() });
  expect(res.status).toBe(201);
  return ((await res.json()) as { reversal: { reversedOn: string } }).reversal.reversedOn;
}

function reverse(paymentId: string, body: Record<string, unknown>, user: number = SEEDED.owner) {
  return h.call('POST', `/api/billing/payments/${paymentId}/reversal`, user, body);
}

async function balance(clientId: string): Promise<BalanceResponse> {
  const res = await h.call('GET', `/api/billing/clients/${clientId}/balance`, SEEDED.owner);
  return (await res.json()) as BalanceResponse;
}

async function debtors(asOf: string) {
  const res = await h.call('GET', `/api/billing/debtors?asOf=${asOf}`, SEEDED.owner);
  expect(res.status).toBe(200);
  return DebtorsResponse.parse(await res.json());
}

/** A household with a 500-fils invoice paid in full on `paidOn`. */
async function paidHousehold(index: number, paidOn: string) {
  const clientId = h.clientId(index);
  await invoice(clientId, daysBefore(10), 50_000);
  const paymentId = await payment(clientId, paidOn, 50_000);
  return { clientId, paymentId };
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
  await seedUser(h.owner, {
    id: FINANCE_ONLY.userId,
    tenantId: SEED_TENANT_ID,
    authId: FINANCE_ONLY.authId,
    displayName: 'Synthetic Bookkeeper',
    roles: ['finance'],
  });
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('POST /api/billing/payments/:id/reversal', () => {
  it('reverses a payment for finance alone and answers 201', async () => {
    const { paymentId } = await paidHousehold(0, SEED_TODAY);
    const res = await h.callAs(
      'POST',
      `/api/billing/payments/${paymentId}/reversal`,
      FINANCE_ONLY.authId,
      { reason: REASON, idempotencyKey: nextKey() },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { reversal: { id: string; reversedOn: string } };
    expect(body.reversal.reversedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('refuses a practitioner with a 403', async () => {
    const { paymentId } = await paidHousehold(1, SEED_TODAY);
    const res = await reverse(
      paymentId,
      { reason: REASON, idempotencyKey: nextKey() },
      SEEDED.practitioner,
    );
    expect(res.status).toBe(403);
  });

  it('refuses a second reversal with a 409 already_reversed', async () => {
    const { paymentId } = await paidHousehold(2, SEED_TODAY);
    expect((await reverse(paymentId, { reason: REASON, idempotencyKey: nextKey() })).status).toBe(
      201,
    );
    const again = await reverse(paymentId, { reason: REASON, idempotencyKey: nextKey() });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({
      error: 'reversal_refused',
      refusal: 'already_reversed',
    });
  });

  it('answers a retry of the same key with the same reversal', async () => {
    const { paymentId } = await paidHousehold(3, SEED_TODAY);
    const key = nextKey();
    const first = await (await reverse(paymentId, { reason: REASON, idempotencyKey: key })).json();
    const retry = await reverse(paymentId, { reason: REASON, idempotencyKey: key });
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(first);
  });

  it('refuses a reason of seven characters with a 400', async () => {
    const { paymentId } = await paidHousehold(4, SEED_TODAY);
    const res = await reverse(paymentId, { reason: 'Too sho', idempotencyKey: nextKey() });
    expect(res.status).toBe(400);
  });

  it('answers 404 for a payment that does not exist', async () => {
    const res = await reverse('00000000-0000-4000-8000-00000000dead', {
      reason: REASON,
      idempotencyKey: nextKey(),
    });
    expect(res.status).toBe(404);
  });
});

describe('what follows a reversal', () => {
  it('shows it on the receipt, and raises the balance by the payment', async () => {
    const { clientId, paymentId } = await paidHousehold(5, SEED_TODAY);
    const before = await balance(clientId);
    expect(before.outstandingFils).toBe(0);

    const made = await reverse(paymentId, { reason: REASON, idempotencyKey: nextKey() });
    const { reversal } = (await made.json()) as { reversal: { id: string; reversedOn: string } };

    const mrn = (
      await h.owner.query<{ mrn: string }>('select mrn from client where id = $1', [clientId])
    ).rows[0]?.mrn;
    const book = await h.call('POST', '/api/billing/payments/search', SEEDED.owner, {
      search: mrn,
    });
    const rows = (
      (await book.json()) as {
        receipts: { id: string; reversedOn: string | null; reversalId: string | null }[];
      }
    ).receipts;
    const receipt = rows.find((row) => row.id === paymentId);
    expect(receipt?.reversedOn).toBe(reversal.reversedOn);
    expect(receipt?.reversalId).toBe(reversal.id);

    const after = await balance(clientId);
    expect(after.outstandingFils).toBe(50_000);
    expect(after.paidFils).toBe(50_000);
    expect(after.reversedFils).toBe(50_000);

    const stop = await h.call('GET', `/api/billing/clients/${clientId}/stop-balance`, SEEDED.owner);
    expect(((await stop.json()) as { outstandingFils: number }).outstandingFils).toBe(50_000);
  });

  it('puts the debtors list as at today in step with the balance', async () => {
    const { clientId, paymentId } = await paidHousehold(6, SEED_TODAY);
    expect((await debtors(SEED_TODAY)).rows.some((row) => row.clientId === clientId)).toBe(false);
    const day = await reversedOn(paymentId);
    const row = (await debtors(day)).rows.find((r) => r.clientId === clientId);
    expect(row?.owedFils).toBe((await balance(clientId)).outstandingFils);
    expect(row?.owedFils).toBe(50_000);
  });

  it('still counts the payment as at the day before the reversal', async () => {
    const { clientId, paymentId } = await paidHousehold(7, daysBefore(3));
    const day = await reversedOn(paymentId);
    const yesterday = await debtors(daysBefore(1, day));
    expect(yesterday.rows.some((r) => r.clientId === clientId)).toBe(false);
    const today = await debtors(day);
    expect(today.rows.find((r) => r.clientId === clientId)?.owedFils).toBe(50_000);
  });

  it('shows the payment and its reversal on the statement, and renders it', async () => {
    const { clientId, paymentId } = await paidHousehold(8, SEED_TODAY);
    const day = await reversedOn(paymentId);

    // The statement's own query, through the same mapping and the same sums.
    const { rows } = await h.owner.query<LedgerDbRow>(
      'select l.entry_kind, l.source_id, l.reference, ' +
        "to_char(l.occurred_on, 'YYYY-MM-DD') as occurred_on, l.amount_fils, " +
        'p.invoice_id from app.billing_ledger l ' +
        "left join payment p on p.id = l.source_id and l.entry_kind = 'payment' " +
        'where l.client_id = $1',
      [clientId],
    );
    const entries = rows.flatMap((row) => {
      const entry = ledgerEntry(row);
      return entry ? [entry] : [];
    });
    const statement = statementLines(entries, daysBefore(30), day);
    const kinds = statement.lines.map((line) => line.kind);
    expect(kinds).toContain('payment');
    expect(kinds).toContain('reversal');
    expect(statement.closingFils).toBe(50_000);

    const pdf = await h.call(
      'GET',
      `/api/billing/clients/${clientId}/statement.pdf?from=${daysBefore(30)}&to=${day}`,
      SEEDED.owner,
    );
    expect(pdf.status).toBe(200);
  });
});
