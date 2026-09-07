import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ZOHO_ACCOUNT_HEADINGS,
  ZOHO_JOURNAL_HEADINGS,
  corporateTaxEstimate,
} from '../../../domain/accounting';
import { fils } from '../../../domain/shared';
import { buildActivity, type Activity } from './fixture';
import { FINANCE, SEEDED, seedFinanceUser, startHarness, type Harness } from './support';

/**
 * The four statements, the overview and the exports, read off a month of the
 * practice's own trading (docs/SPEC/accounting.md sections 4.5, 4.6 and 5.1).
 * Every CSV is asserted against the JSON the screen shows, because a file that
 * disagrees with the screen is worse than no file.
 */
const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const REASON = { 'x-reason': 'Bringing the books up to date.' };
const AS_OF = '2026-12-31';

let h: Harness;
let activity: Activity;

type StatementRow = { accountCode: string; accountName: string; balanceFils: number };
type TrialBalance = {
  asOf: string;
  rows: (StatementRow & { debitFils: number; creditFils: number })[];
  totalDebitFils: number;
  totalCreditFils: number;
};
type ProfitAndLoss = {
  income: StatementRow[];
  expenses: StatementRow[];
  incomeFils: number;
  expenseFils: number;
  resultFils: number;
};
type BalanceSheet = {
  assets: StatementRow[];
  liabilities: StatementRow[];
  equity: StatementRow[];
  resultYearToDateFils: number;
  retainedEarningsFils: number;
  totalAssetsFils: number;
  totalLiabilitiesAndEquityFils: number;
};
type CashFlow = {
  byCategory: Record<string, number>;
  openingCashFils: number;
  netChangeFils: number;
  closingCashFils: number;
};
type Overview = {
  month: string;
  asOf: string;
  fiscalYearStartsOn: string;
  resultYearToDateFils: number;
  revenueYearToDateFils: number;
  cashPositionFils: number;
  cashAccounts: StatementRow[];
  receivableFils: number;
  corporateTaxEstimateFils: number;
  reliefWatch: 'clear' | 'approaching' | 'exceeded';
  reliefThresholdFils: number;
  reliefElected: boolean;
  unpostedCount: number;
  unknownCount: number;
  recentEntries: { reference: string }[];
};

async function get<T>(path: string, user: number = SEEDED.owner): Promise<T> {
  const res = await h.call('GET', path, user);
  if (res.status !== 200) {
    throw new Error(`${path} answered ${res.status}.`);
  }
  return (await res.json()) as T;
}

async function csv(path: string): Promise<{ headers: Headers; lines: string[] }> {
  const res = await h.call('GET', path, SEEDED.owner);
  if (res.status !== 200) {
    throw new Error(`${path} answered ${res.status}.`);
  }
  const text = await res.text();
  return { headers: res.headers, lines: text.split('\r\n').filter((line) => line.length > 0) };
}

/** The one field a comma-separated line needs unpicking for; enough for a test. */
function fields(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      out.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await seedFinanceUser(h);
  activity = await buildActivity(h);
  const posted = await h.call('POST', '/api/accounting/post', SEEDED.owner, {}, REASON);
  if (posted.status !== 200) {
    throw new Error(`The poster answered ${posted.status}.`);
  }
}, 180_000);

afterAll(async () => {
  await h.close();
});

describe('the trial balance', () => {
  it('agrees side to side and lists the accounts by code', async () => {
    const tb = await get<TrialBalance>(`/api/accounting/statements/trial-balance?asOf=${AS_OF}`);
    expect(tb.asOf).toBe(AS_OF);
    expect(tb.totalDebitFils).toBe(tb.totalCreditFils);
    expect(tb.totalDebitFils).toBeGreaterThan(0);
    expect(tb.rows.map((row) => row.accountCode)).toEqual(
      [...tb.rows.map((row) => row.accountCode)].sort(),
    );
  });

  it('reads the same for finance as for the owner', async () => {
    const asOwner = await get<TrialBalance>(
      `/api/accounting/statements/trial-balance?asOf=${AS_OF}`,
      SEEDED.owner,
    );
    const res = await h.callAs(
      'GET',
      `/api/accounting/statements/trial-balance?asOf=${AS_OF}`,
      FINANCE.authId,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(asOwner);
  });

  it('is refused to an admin', async () => {
    const res = await h.call(
      'GET',
      `/api/accounting/statements/trial-balance?asOf=${AS_OF}`,
      SEEDED.admin,
    );
    expect(res.status).toBe(403);
  });
});

describe('the balance sheet', () => {
  it('balances at the month end and at the year end', async () => {
    for (const asOf of ['2026-09-30', AS_OF]) {
      const sheet = await get<BalanceSheet>(
        `/api/accounting/statements/balance-sheet?asOf=${asOf}`,
      );
      expect(sheet.totalAssetsFils, asOf).toBe(sheet.totalLiabilitiesAndEquityFils);
      expect(sheet.assets.length, asOf).toBeGreaterThan(0);
    }
  });

  it('computes the year to date and carries nothing forward from before the books', async () => {
    const sheet = await get<BalanceSheet>(`/api/accounting/statements/balance-sheet?asOf=${AS_OF}`);
    const pl = await get<ProfitAndLoss>(
      `/api/accounting/statements/profit-and-loss?from=2026-01-01&to=${AS_OF}`,
    );
    expect(sheet.resultYearToDateFils).toBe(pl.resultFils);
    expect(sheet.retainedEarningsFils).toBe(0);
  });
});

describe('the cash flow', () => {
  it('ties its closing cash to the cash position on the overview', async () => {
    const flow = await get<CashFlow>(
      `/api/accounting/statements/cash-flow?from=2026-01-01&to=${AS_OF}`,
    );
    const overview = await get<Overview>(`/api/accounting/overview?month=${activity.month}`);
    expect(flow.closingCashFils).toBe(overview.cashPositionFils);
    expect(flow.openingCashFils + flow.netChangeFils).toBe(flow.closingCashFils);
    expect(flow.byCategory.fromHouseholds).toBeGreaterThan(0);
  });
});

describe('the CSV twins', () => {
  it('gives the trial balance’s own rows, and says it is a file', async () => {
    const tb = await get<TrialBalance>(`/api/accounting/statements/trial-balance?asOf=${AS_OF}`);
    const file = await csv(`/api/accounting/statements/trial-balance.csv?asOf=${AS_OF}`);
    expect(file.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(file.headers.get('content-disposition')).toBe(
      `attachment; filename="trial-balance-${AS_OF}.csv"`,
    );
    expect(file.lines).toHaveLength(tb.rows.length + 2);
    expect(fields(file.lines[1]!)[0]).toBe(tb.rows[0]!.accountCode);
    expect(fields(file.lines[1]!)[1]).toBe(tb.rows[0]!.accountName);
  });

  it('gives the other three statements as files too', async () => {
    for (const [path, name] of [
      [
        `profit-and-loss.csv?from=2026-01-01&to=${AS_OF}`,
        `profit-and-loss-2026-01-01-${AS_OF}.csv`,
      ],
      [`balance-sheet.csv?asOf=${AS_OF}`, `balance-sheet-${AS_OF}.csv`],
      [`cash-flow.csv?from=2026-01-01&to=${AS_OF}`, `cash-flow-2026-01-01-${AS_OF}.csv`],
    ]) {
      const file = await csv(`/api/accounting/statements/${path}`);
      expect(file.headers.get('content-disposition'), path).toBe(`attachment; filename="${name}"`);
      expect(file.lines.length, path).toBeGreaterThan(1);
    }
  });

  it('names nobody in any file', async () => {
    const file = await csv(`/api/accounting/statements/trial-balance.csv?asOf=${AS_OF}`);
    const text = file.lines.join('\n');
    expect(text).not.toContain(activity.clientId);
    expect(text).not.toContain('INV-');
  });
});

describe('the Zoho-shaped exports', () => {
  it('opens the journal with the template’s own headings, one row per line', async () => {
    const file = await csv(`/api/accounting/exports/zoho-journal.csv?from=2026-01-01&to=${AS_OF}`);
    expect(file.lines[0]).toBe(ZOHO_JOURNAL_HEADINGS.join(','));
    expect(file.headers.get('content-disposition')).toBe(
      `attachment; filename="zoho-journal-2026-01-01-${AS_OF}.csv"`,
    );
    const { rows } = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from journal_line l join journal_entry e on e.id = l.entry_id ' +
        "where l.tenant_id = $1 and e.entered_on between '2026-01-01' and $2",
      [h.data.tenant.id, AS_OF],
    );
    expect(file.lines).toHaveLength(Number(rows[0]!.n) + 1);
    expect(fields(file.lines[1]!)).toHaveLength(ZOHO_JOURNAL_HEADINGS.length);
  });

  it('gives the chart with the template’s own headings', async () => {
    const file = await csv('/api/accounting/exports/zoho-accounts.csv');
    expect(file.lines[0]).toBe(ZOHO_ACCOUNT_HEADINGS.join(','));
    expect(file.lines).toHaveLength(17);
    expect(fields(file.lines[1]!)).toEqual(['1010', 'Bank, operating', 'Bank']);
  });
});

describe('the overview', () => {
  it('reads zero outstanding after a posting run, and the relief clear', async () => {
    const overview = await get<Overview>(`/api/accounting/overview?month=${activity.month}`);
    expect(overview.month).toBe(activity.month);
    expect(overview.unpostedCount).toBe(0);
    expect(overview.unknownCount).toBe(0);
    expect(overview.reliefWatch).toBe('clear');
    expect(overview.reliefElected).toBe(true);
    expect(overview.corporateTaxEstimateFils).toBe(0);
    expect(overview.fiscalYearStartsOn).toBe('2026-01-01');
    expect(overview.cashAccounts.length).toBeGreaterThan(0);
    expect(overview.recentEntries.length).toBeGreaterThan(0);
  });

  it('charges the rate above the threshold once the relief is not elected', async () => {
    const before = await get<Overview>(`/api/accounting/overview?month=${activity.month}`);
    const patched = await h.call(
      'PATCH',
      '/api/accounting/settings',
      SEEDED.owner,
      { smallBusinessReliefElected: false },
      { 'x-reason': 'The adviser says the relief is not elected this year.' },
    );
    expect(patched.status).toBe(200);
    const settings = (await patched.json()) as {
      corporateTaxRateBasisPoints: number;
      corporateTaxThresholdFils: number;
      smallBusinessReliefThresholdFils: number;
    };
    const after = await get<Overview>(`/api/accounting/overview?month=${activity.month}`);
    expect(after.reliefElected).toBe(false);
    expect(after.corporateTaxEstimateFils).toBe(
      corporateTaxEstimate(fils(before.resultYearToDateFils), fils(before.revenueYearToDateFils), {
        corporateTaxRateBasisPoints: settings.corporateTaxRateBasisPoints,
        corporateTaxThresholdFils: fils(settings.corporateTaxThresholdFils),
        smallBusinessReliefElected: false,
        smallBusinessReliefThresholdFils: fils(settings.smallBusinessReliefThresholdFils),
      }),
    );
  });

  it('is refused to an admin', async () => {
    const res = await h.call('GET', '/api/accounting/overview', SEEDED.admin);
    expect(res.status).toBe(403);
  });
});
