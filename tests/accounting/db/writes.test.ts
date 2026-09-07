import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AccountsResponse,
  EntryResponse,
  LockResponse,
  SettingsResponse,
  YearsResponse,
} from '../../../app/api/accounting/schema';
import { FINANCE, SEEDED, seedFinanceUser, startHarness, type Harness } from './support';

/**
 * Everything the books are written by hand with (docs/SPEC/accounting.md
 * sections 5.2, 5.3 and 5.5): a manual entry, an opening entry, a reversal, an
 * account, the settings, the lock date and a year's close. Every refusal has a
 * code the screen turns into a sentence, and every write carries a reason.
 */
const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const REASON = { 'x-reason': 'A synthetic bookkeeping test.' };

let h: Harness;
let accounts: AccountsResponse['accounts'];
let booksStartOn: string;
let firstEntryId: string;
let addedAccountId: string;

function idOf(code: string): string {
  const account = accounts.find((a) => a.code === code);
  if (!account) {
    throw new Error(`No account ${code} in the chart.`);
  }
  return account.id;
}

async function loadAccounts(): Promise<void> {
  const res = await h.call('GET', '/api/accounting/accounts', SEEDED.owner);
  accounts = ((await res.json()) as AccountsResponse).accounts;
}

async function settings(): Promise<SettingsResponse> {
  const res = await h.call('GET', '/api/accounting/settings', SEEDED.owner);
  return (await res.json()) as SettingsResponse;
}

function expense(day: string, amountFils = 20_000, kind: 'manual' | 'opening' = 'manual') {
  return {
    kind,
    enteredOn: day,
    memo: 'Office supplies',
    lines: [
      { accountId: idOf('6000'), debitFils: amountFils, creditFils: 0 },
      { accountId: idOf('1010'), debitFils: 0, creditFils: amountFils },
    ],
  };
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await seedFinanceUser(h);
  await loadAccounts();
  booksStartOn = (await settings()).booksStartOn;
});

afterAll(async () => {
  await h.close();
});

/**
 * Before anything is posted, because a year end may only move while the
 * journal is empty (rule 10) and the answer to a day the calendar does not
 * have must be a refusal the drawer has a sentence for, never a 500.
 */
describe('a year end the calendar has', () => {
  it('refuses the thirtieth of February before it reaches the database', async () => {
    const res = await h.call(
      'PATCH',
      '/api/accounting/settings',
      SEEDED.owner,
      { yearEndMonth: 2, yearEndDay: 30 },
      { 'x-reason': 'The adviser suggested the end of February.' },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_request' });
    expect((await settings()).yearEndMonth).toBe(12);
  });

  it('refuses a month alone that the stored day outgrows, from the constraint itself', async () => {
    // Only the month is sent, so the schema has nothing to compare it against;
    // 450's own check answers, and the route turns its 23514 into the same
    // coded refusal rather than an internal error.
    const res = await h.call(
      'PATCH',
      '/api/accounting/settings',
      SEEDED.owner,
      { yearEndMonth: 2 },
      { 'x-reason': 'The adviser suggested the end of February.' },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_request' });
    const after = await settings();
    expect(after.yearEndMonth).toBe(12);
    expect(after.yearEndDay).toBe(31);
  });

  it('takes a year end that every year has', async () => {
    const res = await h.call(
      'PATCH',
      '/api/accounting/settings',
      SEEDED.owner,
      { yearEndMonth: 2, yearEndDay: 28 },
      { 'x-reason': 'The adviser prefers a February year end.' },
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as SettingsResponse).toMatchObject({
      yearEndMonth: 2,
      yearEndDay: 28,
    });
    // Put back, so the year the rest of this file posts into is the calendar's.
    const back = await h.call(
      'PATCH',
      '/api/accounting/settings',
      SEEDED.owner,
      { yearEndMonth: 12, yearEndDay: 31 },
      { 'x-reason': 'The adviser prefers the calendar year after all.' },
    );
    expect(back.status).toBe(200);
  });
});

describe('posting an entry by hand', () => {
  it('lets finance post a balanced entry and answers it with its lines', async () => {
    const res = await h.callAs(
      'POST',
      '/api/accounting/entries',
      FINANCE.authId,
      expense('2026-09-02'),
      REASON,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as EntryResponse;
    expect(body.entry).toMatchObject({
      reference: 'JE-000001',
      enteredOn: '2026-09-02',
      kind: 'manual',
      memo: 'Office supplies',
      debitTotalFils: 20_000,
      reversedByEntryId: null,
    });
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0]).toMatchObject({ accountCode: '6000', debitFils: 20_000 });
    firstEntryId = body.entry.id;
  });

  it('refuses an entry that does not balance', async () => {
    const draft = expense('2026-09-02');
    draft.lines[1]!.creditFils = 19_000;
    const res = await h.call('POST', '/api/accounting/entries', SEEDED.owner, draft, REASON);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'unbalanced' });
  });

  it('refuses a write with no reason', async () => {
    const res = await h.call(
      'POST',
      '/api/accounting/entries',
      SEEDED.owner,
      expense('2026-09-02'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'reason_required' });
  });

  it('refuses a line on an account the practice does not have', async () => {
    const draft = expense('2026-09-02');
    draft.lines[0]!.accountId = '0000000e-0000-4000-8000-0000000000ff';
    const res = await h.call('POST', '/api/accounting/entries', SEEDED.owner, draft, REASON);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'unknown_account' });
  });

  it('dates an opening entry the books’ start day and no other', async () => {
    const wrong = { ...expense('2026-09-02'), kind: 'opening' as const };
    const refused = await h.call('POST', '/api/accounting/entries', SEEDED.owner, wrong, REASON);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'opening_day' });

    const right = {
      kind: 'opening' as const,
      enteredOn: booksStartOn,
      memo: 'Opening balances',
      lines: [
        { accountId: idOf('1010'), debitFils: 1_000_000, creditFils: 0 },
        { accountId: idOf('1020'), debitFils: 5_000, creditFils: 0 },
      ],
      balanceWithOpeningEquity: true,
    };
    const posted = await h.call('POST', '/api/accounting/entries', SEEDED.owner, right, REASON);
    expect(posted.status).toBe(201);
    const body = (await posted.json()) as EntryResponse;
    expect(body.lines).toHaveLength(3);
    expect(body.lines[2]).toMatchObject({ accountCode: '3100', creditFils: 1_005_000 });
  });

  it('refuses to level a manual entry with opening equity', async () => {
    const draft = { ...expense('2026-09-02'), balanceWithOpeningEquity: true };
    draft.lines[1]!.creditFils = 19_000;
    const res = await h.call('POST', '/api/accounting/entries', SEEDED.owner, draft, REASON);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'not_an_opening_entry' });
  });

  it('refuses an admin outright', async () => {
    const res = await h.call(
      'POST',
      '/api/accounting/entries',
      SEEDED.admin,
      expense('2026-09-02'),
      REASON,
    );
    expect(res.status).toBe(403);
  });
});

describe('reversing an entry', () => {
  it('writes the same lines the other way round and says why', async () => {
    const res = await h.call(
      'POST',
      `/api/accounting/entries/${firstEntryId}/reversal`,
      SEEDED.owner,
      { reason: 'It was recorded against the wrong account.' },
      { 'x-reason': 'It was recorded against the wrong account.' },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as EntryResponse;
    expect(body.entry).toMatchObject({ kind: 'reversal', reversesEntryId: firstEntryId });
    expect(body.entry.enteredOn).toBe('2026-09-02');
    expect(body.lines.map((line) => [line.accountCode, line.debitFils, line.creditFils])).toEqual([
      ['6000', 0, 20_000],
      ['1010', 20_000, 0],
    ]);
  });

  it('refuses to reverse the same entry twice', async () => {
    const res = await h.call(
      'POST',
      `/api/accounting/entries/${firstEntryId}/reversal`,
      SEEDED.owner,
      { reason: 'It was recorded against the wrong account.' },
      { 'x-reason': 'It was recorded against the wrong account.' },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'already_reversed' });
  });

  it('answers 404 for an entry that is not there', async () => {
    const res = await h.call(
      'POST',
      '/api/accounting/entries/0000000e-0000-4000-8000-0000000000ff/reversal',
      SEEDED.owner,
      { reason: 'Nothing to reverse here at all.' },
      { 'x-reason': 'Nothing to reverse here at all.' },
    );
    expect(res.status).toBe(404);
  });
});

describe('the chart', () => {
  it('lets finance add an account', async () => {
    const res = await h.callAs(
      'POST',
      '/api/accounting/accounts',
      FINANCE.authId,
      { code: '6300', name: 'Software and subscriptions', type: 'expense' },
      REASON,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { account: { id: string; code: string } };
    addedAccountId = body.account.id;
    await loadAccounts();
    expect(accounts).toHaveLength(17);
  });

  it('refuses a code whose first digit disagrees with the type', async () => {
    const res = await h.call(
      'POST',
      '/api/accounting/accounts',
      SEEDED.owner,
      { code: '4999', name: 'Not an income account', type: 'expense' },
      REASON,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'code_type_mismatch' });
  });

  it('refuses a code the practice already uses', async () => {
    const res = await h.call(
      'POST',
      '/api/accounting/accounts',
      SEEDED.owner,
      { code: '6300', name: 'Something else', type: 'expense' },
      REASON,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'duplicate_code' });
  });

  it('renames an account', async () => {
    const res = await h.call(
      'PATCH',
      `/api/accounting/accounts/${addedAccountId}`,
      SEEDED.owner,
      { name: 'Software subscriptions' },
      REASON,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { account: { name: string } };
    expect(body.account.name).toBe('Software subscriptions');
  });

  it('archives an account with no role and no balance, and refuses one with a role', async () => {
    const archived = await h.call(
      'PATCH',
      `/api/accounting/accounts/${addedAccountId}`,
      SEEDED.owner,
      { archive: true },
      { 'x-reason': 'It was added by mistake.' },
    );
    expect(archived.status).toBe(200);
    const body = (await archived.json()) as { account: { archivedAt: string | null } };
    expect(body.account.archivedAt).not.toBeNull();

    const refused = await h.call(
      'PATCH',
      `/api/accounting/accounts/${idOf('1010')}`,
      SEEDED.owner,
      { archive: true },
      { 'x-reason': 'It should not go anywhere.' },
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'cannot_archive' });
  });
});

describe('the years', () => {
  it('closes a year that is over and refuses one still running', async () => {
    const posted = await h.call(
      'POST',
      '/api/accounting/entries',
      SEEDED.owner,
      expense('2025-06-01', 5_000),
      REASON,
    );
    expect(posted.status).toBe(201);
    const years = (await (
      await h.call('GET', '/api/accounting/years', SEEDED.owner)
    ).json()) as YearsResponse;
    const y2025 = years.years.find((y) => y.startsOn === '2025-01-01')!;
    const y2026 = years.years.find((y) => y.startsOn === '2026-01-01')!;

    const running = await h.call(
      'POST',
      `/api/accounting/years/${y2026.id}/close`,
      SEEDED.owner,
      {},
      { 'x-reason': 'Closing the year that has not finished.' },
    );
    expect(running.status).toBe(409);
    expect(await running.json()).toMatchObject({ code: 'year_not_closable' });

    const closed = await h.call(
      'POST',
      `/api/accounting/years/${y2025.id}/close`,
      SEEDED.owner,
      {},
      { 'x-reason': 'The accountant has signed it off.' },
    );
    expect(closed.status).toBe(200);
    expect((await closed.json()) as { year: { status: string } }).toMatchObject({
      year: { status: 'closed', closeReason: 'The accountant has signed it off.' },
    });

    const late = await h.call(
      'POST',
      '/api/accounting/entries',
      SEEDED.owner,
      expense('2025-07-01', 1_000),
      REASON,
    );
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ code: 'period_locked' });

    const reopened = await h.call(
      'POST',
      `/api/accounting/years/${y2025.id}/reopen`,
      SEEDED.owner,
      {},
      { 'x-reason': 'A correction the adviser asked for.' },
    );
    expect(reopened.status).toBe(200);
    expect((await reopened.json()) as { year: { status: string } }).toMatchObject({
      year: { status: 'open' },
    });

    const again = await h.call(
      'POST',
      `/api/accounting/years/${y2025.id}/reopen`,
      SEEDED.owner,
      {},
      { 'x-reason': 'It is already open.' },
    );
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'year_not_closed' });
  });

  it('is closed by the owner alone', async () => {
    const years = (await (
      await h.call('GET', '/api/accounting/years', SEEDED.owner)
    ).json()) as YearsResponse;
    const res = await h.callAs(
      'POST',
      `/api/accounting/years/${years.years[0]!.id}/close`,
      FINANCE.authId,
      {},
      REASON,
    );
    expect(res.status).toBe(403);
  });
});

describe('the settings', () => {
  it('lets the owner change the tax settings and refuses finance', async () => {
    const res = await h.call(
      'PATCH',
      '/api/accounting/settings',
      SEEDED.owner,
      { smallBusinessReliefElected: false },
      { 'x-reason': 'The adviser says the relief is not elected this year.' },
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as SettingsResponse).toMatchObject({
      smallBusinessReliefElected: false,
    });

    const asFinance = await h.callAs(
      'PATCH',
      '/api/accounting/settings',
      FINANCE.authId,
      { smallBusinessReliefElected: true },
      REASON,
    );
    expect(asFinance.status).toBe(403);
  });

  it('refuses to move the year end once the journal holds an entry', async () => {
    const res = await h.call(
      'PATCH',
      '/api/accounting/settings',
      SEEDED.owner,
      { yearEndMonth: 6, yearEndDay: 30 },
      { 'x-reason': 'The adviser prefers a June year end.' },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'journal_not_empty' });
  });
});

describe('the lock date', () => {
  it('cannot be set in the future', async () => {
    const res = await h.call(
      'POST',
      '/api/accounting/lock',
      SEEDED.owner,
      { lockedThrough: '2026-09-03' },
      { 'x-reason': 'The first quarter has been filed.' },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'lock_in_future' });
  });

  it('moves forward, refuses the days behind it, and may be moved back with a reason', async () => {
    const forward = await h.call(
      'POST',
      '/api/accounting/lock',
      SEEDED.owner,
      { lockedThrough: '2026-06-30' },
      { 'x-reason': 'The second quarter has been filed.' },
    );
    expect(forward.status).toBe(200);
    expect((await forward.json()) as LockResponse).toEqual({
      lockedThrough: '2026-06-30',
      move: 'forward',
    });

    const onTheLock = await h.call(
      'POST',
      '/api/accounting/entries',
      SEEDED.owner,
      expense('2026-06-30', 2_500),
      REASON,
    );
    expect(onTheLock.status).toBe(409);
    expect(await onTheLock.json()).toMatchObject({ code: 'period_locked' });

    const dayAfter = await h.call(
      'POST',
      '/api/accounting/entries',
      SEEDED.owner,
      expense('2026-07-01', 2_500),
      REASON,
    );
    expect(dayAfter.status).toBe(201);

    const back = await h.call(
      'POST',
      '/api/accounting/lock',
      SEEDED.owner,
      { lockedThrough: '2026-03-31' },
      { 'x-reason': 'A corrected return for the second quarter.' },
    );
    expect(back.status).toBe(200);
    expect((await back.json()) as LockResponse).toEqual({
      lockedThrough: '2026-03-31',
      move: 'backward',
    });
  });

  it('is the owner’s alone', async () => {
    const res = await h.callAs(
      'POST',
      '/api/accounting/lock',
      FINANCE.authId,
      { lockedThrough: '2026-03-31' },
      REASON,
    );
    expect(res.status).toBe(403);
  });
});

describe('the trail', () => {
  it('records every write against the table it changed', async () => {
    const { rows } = await h.owner.query<{ entity_type: string; action: string }>(
      'select entity_type, action::text as action from audit_log ' +
        "where tenant_id = $1 and entity_type in ('journal_entry', 'journal_line', 'fiscal_year', " +
        "'accounting_setting', 'account') group by entity_type, action order by entity_type, action",
      [h.data.tenant.id],
    );
    const seen = new Set(rows.map((row) => `${row.entity_type}:${row.action}`));
    expect(seen).toContain('journal_entry:insert');
    expect(seen).toContain('journal_line:insert');
    expect(seen).toContain('fiscal_year:insert');
    expect(seen).toContain('fiscal_year:update');
    expect(seen).toContain('accounting_setting:update');
    expect(seen).toContain('account:insert');
    expect(seen).toContain('account:update');
  });
});
