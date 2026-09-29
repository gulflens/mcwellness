import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SellSessionResponse } from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { deliverVisit } from './fixture';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * A year that holds a session given free can still be closed.
 *
 * Rule 11 of docs/SPEC/accounting.md closes a year only when nothing dated
 * inside it is still owed to the books. An event worth nothing is owed
 * nothing (rule 18): it posts no entry, so it is never in the journal, so
 * `app.unposted_money_events()` names it for ever. A close that counted every
 * row that function answers would therefore refuse such a year for ever, and
 * a practice that once gave a session free could never shut a year again.
 *
 * The clock here is one the test moves: the session is sold and used on the
 * seed's own day, and the year is closed from the January after it.
 */
let at = new Date(`${SEED_TODAY}T08:00:00.000Z`);
const NOW = () => at;
const REASON = { 'x-reason': 'Bringing the books up to date.' };

let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
});

afterAll(async () => {
  await h.close();
});

describe('closing a year that holds a session given free', () => {
  let sale: SellSessionResponse;

  it('holds a free session, used, and a payment that is in the books', async () => {
    const clientId = h.clientId(0);
    const sold = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, {
      clientId,
      serviceTypeId: h.serviceTypeId('nf-session'),
      purchasedOn: SEED_TODAY,
      extraDiscount: {
        discount: { kind: 'percent', basisPoints: 10_000 },
        reason: 'A first visit, given free.',
      },
    });
    expect(sold.status).toBe(201);
    sale = (await sold.json()) as SellSessionResponse;
    expect(sale.grossFils).toBe(0);

    await deliverVisit(h, clientId);
    const used = await h.owner.query<{ status: string }>(
      'select status::text as status from entitlement where id = $1',
      [sale.entitlementId],
    );
    expect(used.rows[0]?.status).toBe('consumed');

    // A payment, so that the year exists: a year is made by what is posted
    // into it.
    const paid = await h.call('POST', '/api/billing/payments', SEEDED.owner, {
      clientId,
      method: 'cash',
      amountFils: 10_000,
    });
    expect(paid.status).toBe(201);

    const posted = await h.call('POST', '/api/accounting/post', SEEDED.owner, {}, REASON);
    expect(posted.status).toBe(200);
    expect(((await posted.json()) as { posted: number }).posted).toBe(1);
  });

  it('is closed once it is over, for the free session is owed nothing', async () => {
    const listed = (await (await h.call('GET', '/api/accounting/years', SEEDED.owner)).json()) as {
      years: { id: string; startsOn: string }[];
    };
    const year = listed.years.find((row) => row.startsOn === `${SEED_TODAY.slice(0, 4)}-01-01`);
    expect(year).toBeTruthy();

    at = new Date(`${Number(SEED_TODAY.slice(0, 4)) + 1}-01-15T08:00:00.000Z`);
    const closed = await h.call(
      'POST',
      `/api/accounting/years/${year!.id}/close`,
      SEEDED.owner,
      {},
      { 'x-reason': 'The adviser has signed the year off.' },
    );
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ year: { status: 'closed' } });
  });

  it('still posts, before it closes, a payment the books were owed', async () => {
    const reopened = await h.call(
      'POST',
      `/api/accounting/years/${await yearId()}/reopen`,
      SEEDED.owner,
      {},
      { 'x-reason': 'A payment had been left out.' },
    );
    expect(reopened.status).toBe(200);

    // Taken on a day inside the year and not yet posted, so that the close
    // meets an event the books are owed and have not got: the close's own
    // posting run is what should carry it in, and the year then shut.
    at = new Date(`${SEED_TODAY}T09:00:00.000Z`);
    const paid = await h.call('POST', '/api/billing/payments', SEEDED.owner, {
      clientId: h.clientId(0),
      method: 'cash',
      amountFils: 12_000,
    });
    expect(paid.status).toBe(201);
    at = new Date(`${Number(SEED_TODAY.slice(0, 4)) + 1}-01-15T08:00:00.000Z`);

    const closed = await h.call(
      'POST',
      `/api/accounting/years/${await yearId()}/close`,
      SEEDED.owner,
      {},
      { 'x-reason': 'The adviser has signed the year off, again.' },
    );
    // The close posts first, so the payment goes in and the year shuts: what
    // this proves is that counting only what is owed did not stop the close
    // from seeing, and posting, what is.
    expect(closed.status).toBe(200);
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from journal_entry where tenant_id = $1 and source_table = 'payment'",
      [h.data.tenant.id],
    );
    expect(Number(rows[0]?.n)).toBe(2);
  });

  async function yearId(): Promise<string> {
    const listed = (await (await h.call('GET', '/api/accounting/years', SEEDED.owner)).json()) as {
      years: { id: string; startsOn: string }[];
    };
    const year = listed.years.find((row) => row.startsOn === `${SEED_TODAY.slice(0, 4)}-01-01`);
    if (!year) throw new Error('The year was not found.');
    return year.id;
  }
});
