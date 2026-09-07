import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PostResponse, SettingsResponse } from '../../../app/api/accounting/schema';
import { buildActivity, type Activity } from './fixture';
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
