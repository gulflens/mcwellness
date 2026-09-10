import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PostResponse, SettingsResponse } from '../../../app/api/accounting/schema';
import type { SellSessionResponse } from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { buildActivity, eraseHousehold, type Activity } from './fixture';
import { FINANCE, SEEDED, seedFinanceUser, startHarness, type Harness } from './support';

/**
 * The identities of docs/SPEC/accounting.md section 7, proved on a month of the
 * practice's own trading. Everything here was written by billing's own routes
 * and triggers; nothing in the fixture knows what a journal is.
 */
// SEED_TODAY: the price route refuses a price dated before the day it is
// written, and the seed's own prices start on the day the seed calls today.
const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const REASON = { 'x-reason': 'Bringing the books up to date.' };

let h: Harness;
let activity: Activity;

/**
 * The books read straight out of the journal, in each account's own direction.
 *
 * Deliberately not through `GET /api/accounting/statements/trial-balance`,
 * which Task 13 of the plan builds: an identity proved by asking the same
 * TypeScript twice is weaker than one proved against the rows themselves, and
 * tests/accounting/db/statements.test.ts asserts the route's own figures
 * against these same books.
 */
const BALANCES_SQL =
  'select a.code, ' +
  "(case when a.type in ('asset', 'expense') " +
  'then coalesce(sum(l.debit_fils), 0) - coalesce(sum(l.credit_fils), 0) ' +
  'else coalesce(sum(l.credit_fils), 0) - coalesce(sum(l.debit_fils), 0) end)::text as balance, ' +
  'coalesce(sum(l.debit_fils), 0)::text as debit, coalesce(sum(l.credit_fils), 0)::text as credit ' +
  'from journal_line l ' +
  'join journal_entry e on e.tenant_id = l.tenant_id and e.id = l.entry_id ' +
  'join account a on a.tenant_id = l.tenant_id and a.id = l.account_id ' +
  'where l.tenant_id = $1 and e.entered_on <= $2 ' +
  'group by a.code, a.type order by a.code';

type Balances = {
  balanceOf: (code: string) => number;
  totalDebitFils: number;
  totalCreditFils: number;
};

type Summary = {
  cashCollectedFils: number;
  revenueRecognisedFils: number;
  deferredNetFils: number;
};

async function post(user: number = SEEDED.owner): Promise<PostResponse> {
  const res = await h.call('POST', '/api/accounting/post', user, {}, REASON);
  if (res.status !== 200) {
    throw new Error(`The poster answered ${res.status}.`);
  }
  return (await res.json()) as PostResponse;
}

async function balances(asOf = '2026-12-31'): Promise<Balances> {
  const { rows } = await h.owner.query<{
    code: string;
    balance: string;
    debit: string;
    credit: string;
  }>(BALANCES_SQL, [h.data.tenant.id, asOf]);
  return {
    balanceOf: (code) => Number(rows.find((row) => row.code === code)?.balance ?? 0),
    totalDebitFils: rows.reduce((sum, row) => sum + Number(row.debit), 0),
    totalCreditFils: rows.reduce((sum, row) => sum + Number(row.credit), 0),
  };
}

/** Income earned in a month, from the journal, by account code. */
async function incomeInMonth(month: string, code: string): Promise<number> {
  const { rows } = await h.owner.query<{ total: string }>(
    '(select coalesce(sum(l.credit_fils) - sum(l.debit_fils), 0)::text as total ' +
      'from journal_line l ' +
      'join journal_entry e on e.tenant_id = l.tenant_id and e.id = l.entry_id ' +
      'join account a on a.tenant_id = l.tenant_id and a.id = l.account_id ' +
      "where l.tenant_id = $1 and a.code = $2 and to_char(e.entered_on, 'YYYY-MM') = $3)",
    [h.data.tenant.id, code, month],
  );
  return Number(rows[0]?.total ?? 0);
}

async function figure(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await h.owner.query<{ total: string }>(sql, params);
  return Number(rows[0]?.total ?? 0);
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await seedFinanceUser(h);
  activity = await buildActivity(h);
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('the poster', () => {
  it('writes every outstanding event once, and nothing the second time', async () => {
    const first = await post(SEEDED.owner);
    expect(first.posted).toBeGreaterThanOrEqual(6);
    expect(first.unknown).toBe(0);
    const second = await post(SEEDED.owner);
    expect(second).toEqual({ posted: 0, unknown: 0 });
  });

  it('is run by finance as readily as by the owner, and by nobody else', async () => {
    const asFinance = await h.callAs('POST', '/api/accounting/post', FINANCE.authId, {}, REASON);
    expect(asFinance.status).toBe(200);
    const asAdmin = await h.call('POST', '/api/accounting/post', SEEDED.admin, {}, REASON);
    expect(asAdmin.status).toBe(403);
  });

  it('insists on a reason', async () => {
    const res = await h.call('POST', '/api/accounting/post', SEEDED.owner, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'reason_required' });
  });
});

describe('the identities of section 7', () => {
  it('ties the contract liability to what billing says is still owed', async () => {
    const summary = (await (
      await h.call('GET', `/api/billing/summary?month=${activity.month}`, SEEDED.owner)
    ).json()) as Summary;
    const books = await balances();
    expect(books.balanceOf('2400')).toBe(summary.deferredNetFils);
  });

  it('ties receivable to invoices issued less payments taken less fees forgiven', async () => {
    const invoiced = await figure(
      'select coalesce(sum(gross_fils), 0)::text as total from invoice where tenant_id = $1',
      [h.data.tenant.id],
    );
    const paid = await figure(
      'select coalesce(sum(amount_fils), 0)::text as total from payment where tenant_id = $1',
      [h.data.tenant.id],
    );
    const waived = await figure(
      'select coalesce(sum(gross_fils), 0)::text as total from invoice ' +
        'where tenant_id = $1 and waived_at is not null',
      [h.data.tenant.id],
    );
    const books = await balances();
    expect(books.balanceOf('1200')).toBe(invoiced - paid - waived);
  });

  it('ties VAT payable to the invoices’ own VAT less the waived VAT', async () => {
    const vat = await figure(
      'select coalesce(sum(vat_fils), 0)::text as total from invoice where tenant_id = $1',
      [h.data.tenant.id],
    );
    const waivedVat = await figure(
      'select coalesce(sum(vat_fils), 0)::text as total from invoice ' +
        'where tenant_id = $1 and waived_at is not null',
      [h.data.tenant.id],
    );
    const books = await balances();
    expect(books.balanceOf('2500')).toBe(vat - waivedVat);
  });

  it('ties each cash account to the payments taken by that method', async () => {
    const byMethod = async (method: string) =>
      figure(
        'select coalesce(sum(amount_fils), 0)::text as total from payment ' +
          'where tenant_id = $1 and method = $2',
        [h.data.tenant.id, method],
      );
    const books = await balances();
    expect(books.balanceOf('1010')).toBe(await byMethod('transfer'));
    expect(books.balanceOf('1020')).toBe(await byMethod('cash'));
    expect(books.balanceOf('1030')).toBe(await byMethod('link'));
  });

  it('ties income for the month to what billing recognised, and leaves the waived fee at nothing', async () => {
    const summary = (await (
      await h.call('GET', `/api/billing/summary?month=${activity.month}`, SEEDED.owner)
    ).json()) as Summary;
    const sessions = await incomeInMonth(activity.month, '4000');
    const assessments = await incomeInMonth(activity.month, '4100');
    expect(sessions + assessments).toBe(summary.revenueRecognisedFils);
    // Charged and then forgiven: the two entries cancel, whichever month each
    // fell in, so the account itself is at nothing.
    const books = await balances();
    expect(books.balanceOf('4300')).toBe(0);
  });

  it('agrees with itself: the journal’s two sides', async () => {
    const books = await balances();
    expect(books.totalDebitFils).toBe(books.totalCreditFils);
    expect(books.totalDebitFils).toBeGreaterThan(0);
  });
});

describe('a session sold ahead of its visit posts like a package of one', () => {
  /**
   * Task 4 of the walk-fixes round, step 3: migration 411's own claim —
   * "the books already know what to do with it... nothing there changes" —
   * proved against a real sale through `POST /api/billing/session-purchases`
   * and a real run of the poster, not read off `postingsFor` in isolation.
   *
   * The identity that matters: the practice has been paid for a session it
   * has not yet delivered, so the money is a contract liability — a debt the
   * practice owes in a future visit — and only becomes income
   * (`domain/accounting/posting.ts`'s `credit.consumed` case) when the credit
   * is used up at that visit. Posting it to income now would count revenue
   * the practice has not yet earned.
   */
  it('debits receivable and credits contract liability for the net, never income', async () => {
    const clientId = h.clientId(2);
    const sold = await h.call('POST', '/api/billing/session-purchases', SEEDED.owner, {
      clientId,
      serviceTypeId: h.serviceTypeId('nf-session'),
      purchasedOn: SEED_TODAY,
    });
    expect(sold.status).toBe(201);
    const sale = (await sold.json()) as SellSessionResponse;

    const report = await post(SEEDED.owner);
    expect(report.posted).toBeGreaterThanOrEqual(1);

    const { rows } = await h.owner.query<{
      memo: string;
      code: string;
      debit_fils: string;
      credit_fils: string;
    }>(
      'select e.memo, a.code, l.debit_fils::text as debit_fils, l.credit_fils::text as credit_fils ' +
        'from journal_line l ' +
        'join journal_entry e on e.tenant_id = l.tenant_id and e.id = l.entry_id ' +
        'join account a on a.tenant_id = l.tenant_id and a.id = l.account_id ' +
        "where l.tenant_id = $1 and e.source_table = 'invoice' and e.source_id = $2 " +
        'order by a.code',
      [h.data.tenant.id, sale.invoiceId],
    );
    // Exactly the two lines a package sale's own invoice posts (no VAT line:
    // the seeded practice is not VAT-registered), and the same memo.
    expect(rows.map((row) => row.code)).toEqual(['1200', '2400']);
    expect(rows.every((row) => row.memo === 'Invoice issued')).toBe(true);

    const receivable = rows.find((row) => row.code === '1200');
    expect(Number(receivable?.debit_fils)).toBe(sale.grossFils);
    expect(Number(receivable?.credit_fils)).toBe(0);

    // 2400 is contract liability, not 4000 (session income): the claim this
    // step exists to prove or disprove.
    const liability = rows.find((row) => row.code === '2400');
    expect(Number(liability?.credit_fils)).toBe(sale.netFils);
    expect(Number(liability?.debit_fils)).toBe(0);

    const income = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from journal_line l ' +
        'join journal_entry e on e.tenant_id = l.tenant_id and e.id = l.entry_id ' +
        'join account a on a.tenant_id = l.tenant_id and a.id = l.account_id ' +
        "where l.tenant_id = $1 and e.source_table = 'invoice' and e.source_id = $2 " +
        "and a.code = '4000'",
      [h.data.tenant.id, sale.invoiceId],
    );
    expect(Number(income.rows[0]?.n)).toBe(0);
  });
});

describe('the books survive a real erasure', () => {
  /**
   * Done-when 3, through `app.erase_client` itself and not through an update
   * to `client.status`: the second household is really forgotten, and the
   * books are asked before and after, as the owner and as finance
   * (docs/SPEC/accounting.md section 11).
   *
   * `app.unposted_money_events()` steps past the erasure gate on purpose, so
   * finance sees the erased household's money in the books exactly as the
   * owner does; if it did not, the books would depend on who read them.
   */
  const ENTRIES = '/api/accounting/entries';
  const TRIAL_BALANCE = '/api/accounting/statements/trial-balance?asOf=2026-12-31';

  async function books(): Promise<{ owner: string[]; finance: string[] }> {
    const owner: string[] = [];
    const finance: string[] = [];
    for (const path of [ENTRIES, TRIAL_BALANCE]) {
      const asOwner = await h.call('GET', path, SEEDED.owner);
      expect(asOwner.status, path).toBe(200);
      owner.push(await asOwner.text());
      const asFinance = await h.callAs('GET', path, FINANCE.authId);
      expect(asFinance.status, path).toBe(200);
      finance.push(await asFinance.text());
    }
    return { owner, finance };
  }

  it('reads exactly the same before and after, for the owner and for finance', async () => {
    await post(SEEDED.owner);
    const before = await books();
    expect(before.finance).toEqual(before.owner);

    await eraseHousehold(h, activity.erasedClientId);
    const status = await h.owner.query<{ status: string }>(
      'select status from client where id = $1',
      [activity.erasedClientId],
    );
    expect(status.rows[0]?.status).toBe('erased');

    const after = await books();
    expect(after.owner).toEqual(before.owner);
    expect(after.finance).toEqual(before.finance);
    expect(after.finance).toEqual(after.owner);
  });
});

describe('the books name nobody', () => {
  it('holds the erased household’s payment like any other', async () => {
    const link = await figure(
      'select coalesce(sum(amount_fils), 0)::text as total from payment ' +
        "where tenant_id = $1 and method = 'link'",
      [h.data.tenant.id],
    );
    expect(link).toBeGreaterThan(0);
    const books = await balances();
    expect(books.balanceOf('1030')).toBe(link);
  });

  it('reads the same for finance as for the owner, to the fils', async () => {
    const asOwner = await (await h.call('GET', '/api/accounting/entries', SEEDED.owner)).text();
    const asFinance = await (
      await h.callAs('GET', '/api/accounting/entries', FINANCE.authId)
    ).text();
    expect(asFinance).toBe(asOwner);
  });

  it('returns no client id, no invoice number and no receipt reference anywhere', async () => {
    const settings = (await (
      await h.call('GET', '/api/accounting/settings', SEEDED.owner)
    ).json()) as SettingsResponse;
    expect(settings.entryCount).toBeGreaterThan(0);
    const paths = [
      '/api/accounting/settings',
      '/api/accounting/accounts',
      '/api/accounting/years',
      '/api/accounting/entries',
    ];
    for (const path of paths) {
      const body = await (await h.call('GET', path, SEEDED.owner)).text();
      expect(body, path).not.toContain(activity.clientId);
      expect(body, path).not.toContain(activity.erasedClientId);
      expect(body, path).not.toContain('clientId');
      expect(body, path).not.toContain('INV-');
      expect(body, path).not.toContain('RCP-');
    }
  });
});

describe('a late payment lands on the first open day', () => {
  /**
   * Rule 4 through the poster itself, and not only through `landingDayFor`:
   * an event the books could not take on its own day is posted on the first
   * day they can, and the memo says which day it really was
   * (docs/SPEC/accounting.md section 4.3, done-when 5).
   */
  type Landed = { entered_on: string; occurred_on: string | null; memo: string };

  async function payTo(clientId: string, receivedAt: string, amountFils: number): Promise<string> {
    const res = await h.call('POST', '/api/billing/payments', SEEDED.owner, {
      clientId,
      method: 'cash',
      amountFils,
      receivedAt,
    });
    if (res.status !== 201) {
      throw new Error(`The payment was not recorded: ${res.status}`);
    }
    return ((await res.json()) as { payment: { id: string } }).payment.id;
  }

  async function entryFor(paymentId: string): Promise<Landed> {
    const { rows } = await h.owner.query<Landed>(
      'select entered_on::text as entered_on, occurred_on::text as occurred_on, memo ' +
        "from journal_entry where tenant_id = $1 and source_table = 'payment' and source_id = $2",
      [h.data.tenant.id, paymentId],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('The payment did not reach the books.');
    }
    return row;
  }

  it('leaves an entry the books can take on its own day where it is, with no occurred day', async () => {
    const open = await payTo(activity.clientId, '2026-09-01T08:00:00.000Z', 28_000);
    expect((await post(SEEDED.owner)).posted).toBe(1);
    const landed = await entryFor(open);
    expect(landed.entered_on).toBe('2026-09-01');
    expect(landed.occurred_on).toBeNull();
    expect(landed.memo).toBe('Payment received');
  });

  it('posts a payment dated inside a closed year on the first day of the next', async () => {
    // The year must exist and hold its own trading before it can be closed,
    // so one payment is posted inside it and then the year is shut.
    await payTo(activity.clientId, '2025-06-15T08:00:00.000Z', 25_000);
    expect((await post(SEEDED.owner)).posted).toBe(1);

    const years = (await (await h.call('GET', '/api/accounting/years', SEEDED.owner)).json()) as {
      years: { id: string; startsOn: string }[];
    };
    const y2025 = years.years.find((year) => year.startsOn === '2025-01-01');
    expect(y2025).toBeTruthy();
    const closed = await h.call(
      'POST',
      `/api/accounting/years/${y2025!.id}/close`,
      SEEDED.owner,
      {},
      { 'x-reason': 'The adviser has signed 2025 off.' },
    );
    expect(closed.status).toBe(200);

    const late = await payTo(activity.clientId, '2025-07-20T08:00:00.000Z', 26_000);
    expect((await post(SEEDED.owner)).posted).toBe(1);
    const landed = await entryFor(late);
    expect(landed.entered_on).toBe('2026-01-01');
    expect(landed.occurred_on).toBe('2025-07-20');
    expect(landed.memo).toBe('Payment received (occurred 2025-07-20)');
  });

  it('posts a payment dated on or before the lock date on the day after it', async () => {
    const onTheLock = await payTo(activity.clientId, '2026-09-01T08:00:00.000Z', 27_000);
    const locked = await h.call(
      'POST',
      '/api/accounting/lock',
      SEEDED.owner,
      { lockedThrough: '2026-09-02' },
      { 'x-reason': 'The second quarter has been filed.' },
    );
    expect(locked.status).toBe(200);

    expect((await post(SEEDED.owner)).posted).toBe(1);
    const landed = await entryFor(onTheLock);
    expect(landed.entered_on).toBe('2026-09-03');
    expect(landed.occurred_on).toBe('2026-09-01');
    expect(landed.memo).toBe('Payment received (occurred 2026-09-01)');
  });
});

describe('two posting runs at once', () => {
  /**
   * The page's opening `POST` beside the nightly job, or two tabs. Both read
   * the same event list; without the poster's own lock the loser's inserts
   * still fire the BEFORE trigger, which takes a journal number before the
   * unique key refuses the duplicate. Nothing double-posts — the key holds —
   * but the counter walks on, and the next entry written carries a number with
   * the burned ones missing behind it (docs/SPEC/accounting.md section 8).
   */
  async function payment(amountFils: number): Promise<void> {
    const recorded = await h.call('POST', '/api/billing/payments', SEEDED.owner, {
      clientId: activity.clientId,
      method: 'cash',
      amountFils,
    });
    expect(recorded.status).toBe(201);
  }

  it('writes each event once and leaves the journal’s numbers gapless', async () => {
    // The pool holds one connection until a second request asks for one, and
    // opening a fresh one outlasts a whole posting run: without this the two
    // calls below would queue rather than overlap, and the race the lock is
    // for would never be reached.
    await Promise.all([
      h.call('GET', '/api/accounting/settings', SEEDED.owner),
      h.call('GET', '/api/accounting/settings', SEEDED.owner),
    ]);

    // Two fresh events, so both runs have something to find.
    await payment(11_000);
    await payment(12_000);

    const [first, second] = await Promise.all([post(SEEDED.owner), post(SEEDED.owner)]);
    expect(first.posted + second.posted).toBe(2);

    const duplicates = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from (select source_table, source_id, source_event ' +
        'from journal_entry where tenant_id = $1 and source_table is not null ' +
        'group by 1, 2, 3 having count(*) > 1) as repeated',
      [h.data.tenant.id],
    );
    expect(Number(duplicates.rows[0]?.n)).toBe(0);

    // A number consumed and thrown away is a gap the counter carries forward,
    // so it is the counter that shows it first.
    const counter = await h.owner.query<{ next: string; highest: string }>(
      'select s.next_entry_number::text as next, ' +
        '(select coalesce(max(e.number), 0) from journal_entry e where e.tenant_id = s.tenant_id)::text ' +
        'as highest from accounting_setting s where s.tenant_id = $1',
      [h.data.tenant.id],
    );
    expect(counter.rows[0]?.next).toBe(String(Number(counter.rows[0]?.highest) + 1));

    // And then in the journal itself: one more event, and the count and the
    // highest number still agree.
    await payment(13_000);
    expect((await post(SEEDED.owner)).posted).toBe(1);
    const numbers = await h.owner.query<{ n: string; highest: string }>(
      'select count(*)::text as n, coalesce(max(number), 0)::text as highest ' +
        'from journal_entry where tenant_id = $1',
      [h.data.tenant.id],
    );
    expect(numbers.rows[0]?.n).toBe(numbers.rows[0]?.highest);
  });
});
