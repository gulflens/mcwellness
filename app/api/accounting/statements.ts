import type { Context, Hono } from 'hono';
import { z } from 'zod';
import {
  balanceSheet,
  cashFlow,
  filsToDecimal,
  profitAndLoss,
  toCsv,
  trialBalance,
  yearBoundsContaining,
  type PostedLine,
} from '../../../domain/accounting';
import { isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { mayReadBooks } from './access';
import { csvResponse } from './csv-response';
import { readPostedLines, readSetting } from './rows';
import {
  BalanceSheetResponse,
  CashFlowResponse,
  IsoDate,
  ProfitAndLossResponse,
  TrialBalanceResponse,
} from './schema';

/**
 * The four statements, each computed and none stored (docs/SPEC/accounting.md
 * section 4.5). Every one of them is a pure function over the posted lines;
 * this file reads the lines, chooses the days, and answers — as JSON, or as
 * the same rows in a file.
 *
 * No statement takes the actor as an input (rule 13): the journal names
 * nobody, so the owner and finance see the same figures to the fils.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const AsOf = z.object({ asOf: IsoDate.optional() });
const Period = z.object({ from: IsoDate.optional(), to: IsoDate.optional() });

type Books = { lines: PostedLine[]; setting: Awaited<ReturnType<typeof readSetting>> };

async function books(c: Context<ApiEnv>): Promise<Books> {
  const db = c.get('db');
  const [lines, setting] = await Promise.all([readPostedLines(db), readSetting(db)]);
  return { lines, setting };
}

function today(now: () => Date): string {
  return isoDateIn(now(), PRACTICE_TIME_ZONE);
}

/** The financial year `day` falls in, from the practice's own year end. */
function yearOf(setting: Books['setting'], day: string): { startsOn: string; endsOn: string } {
  return yearBoundsContaining(day, setting.yearEndMonth, setting.yearEndDay);
}

const MONEY_HEADINGS = ['Account code', 'Account name', 'Type', 'Amount AED'] as const;

/**
 * The five types as a person reads them, because a file is opened by a person
 * as often as by a spreadsheet: the enum's own `asset` would be this codebase
 * talking to itself in a document somebody prints.
 */
const TYPE_WORDS: Record<string, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

function typeWord(type: string): string {
  return TYPE_WORDS[type] ?? type;
}

function statementRows(
  rows: readonly {
    accountCode: string;
    accountName: string;
    accountType: string;
    balanceFils: number;
  }[],
): string[][] {
  return rows.map((row) => [
    row.accountCode,
    row.accountName,
    typeWord(row.accountType),
    filsToDecimal(row.balanceFils),
  ]);
}

export function mountStatements(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  /** Every statement refuses the same way, before it touches the database. */
  function refused(c: Context<ApiEnv>): Response | null {
    if (mayReadBooks(c.get('actor'), now())) {
      return null;
    }
    return c.json({ error: 'forbidden', requestId: c.get('requestId') }, 403);
  }

  function badRequest(c: Context<ApiEnv>): Response {
    return c.json(
      { error: 'bad_request', code: 'invalid_request', requestId: c.get('requestId') },
      400,
    );
  }

  async function trialBalanceOf(c: Context<ApiEnv>, asOf: string) {
    const { lines } = await books(c);
    return trialBalance(lines, asOf);
  }

  async function profitAndLossOf(c: Context<ApiEnv>, from: string, to: string) {
    const { lines } = await books(c);
    return profitAndLoss(lines, from, to);
  }

  async function balanceSheetOf(c: Context<ApiEnv>, asOf: string) {
    const { lines, setting } = await books(c);
    return balanceSheet(lines, asOf, yearOf(setting, asOf).startsOn);
  }

  async function cashFlowOf(c: Context<ApiEnv>, from: string, to: string) {
    const { lines } = await books(c);
    return cashFlow(lines, from, to);
  }

  /** The day asked for, or today; and the period asked for, or this financial year to today. */
  function asOfOf(c: Context<ApiEnv>): string | null {
    const parsed = AsOf.safeParse({ asOf: c.req.query('asOf') });
    return parsed.success ? (parsed.data.asOf ?? today(now)) : null;
  }

  async function periodOf(c: Context<ApiEnv>): Promise<{ from: string; to: string } | null> {
    const parsed = Period.safeParse({ from: c.req.query('from'), to: c.req.query('to') });
    if (!parsed.success) {
      return null;
    }
    const to = parsed.data.to ?? today(now);
    if (parsed.data.from) {
      return { from: parsed.data.from, to };
    }
    const { setting } = await books(c);
    return { from: yearOf(setting, to).startsOn, to };
  }

  api.get('/api/accounting/statements/trial-balance', async (c) => {
    const no = refused(c);
    if (no) return no;
    const asOf = asOfOf(c);
    if (!asOf) return badRequest(c);
    return c.json(TrialBalanceResponse.parse(await trialBalanceOf(c, asOf)));
  });

  api.get('/api/accounting/statements/trial-balance.csv', async (c) => {
    const no = refused(c);
    if (no) return no;
    const asOf = asOfOf(c);
    if (!asOf) return badRequest(c);
    const statement = await trialBalanceOf(c, asOf);
    const rows = [
      ['Account code', 'Account name', 'Type', 'Debit AED', 'Credit AED', 'Balance AED'],
      ...statement.rows.map((row) => [
        row.accountCode,
        row.accountName,
        typeWord(row.accountType),
        filsToDecimal(row.debitFils),
        filsToDecimal(row.creditFils),
        filsToDecimal(row.balanceFils),
      ]),
      [
        'Total',
        '',
        '',
        filsToDecimal(statement.totalDebitFils),
        filsToDecimal(statement.totalCreditFils),
        '',
      ],
    ];
    return csvResponse(c, `trial-balance-${asOf}.csv`, toCsv(rows));
  });

  api.get('/api/accounting/statements/profit-and-loss', async (c) => {
    const no = refused(c);
    if (no) return no;
    const period = await periodOf(c);
    if (!period) return badRequest(c);
    return c.json(ProfitAndLossResponse.parse(await profitAndLossOf(c, period.from, period.to)));
  });

  api.get('/api/accounting/statements/profit-and-loss.csv', async (c) => {
    const no = refused(c);
    if (no) return no;
    const period = await periodOf(c);
    if (!period) return badRequest(c);
    const statement = await profitAndLossOf(c, period.from, period.to);
    const rows = [
      [...MONEY_HEADINGS],
      ...statementRows(statement.income),
      ...statementRows(statement.expenses),
      ['Income', '', '', filsToDecimal(statement.incomeFils)],
      ['Expenses', '', '', filsToDecimal(statement.expenseFils)],
      ['Result', '', '', filsToDecimal(statement.resultFils)],
    ];
    return csvResponse(c, `profit-and-loss-${period.from}-${period.to}.csv`, toCsv(rows));
  });

  api.get('/api/accounting/statements/balance-sheet', async (c) => {
    const no = refused(c);
    if (no) return no;
    const asOf = asOfOf(c);
    if (!asOf) return badRequest(c);
    return c.json(BalanceSheetResponse.parse(await balanceSheetOf(c, asOf)));
  });

  api.get('/api/accounting/statements/balance-sheet.csv', async (c) => {
    const no = refused(c);
    if (no) return no;
    const asOf = asOfOf(c);
    if (!asOf) return badRequest(c);
    const sheet = await balanceSheetOf(c, asOf);
    const rows = [
      [...MONEY_HEADINGS],
      ...statementRows(sheet.assets),
      ...statementRows(sheet.liabilities),
      ...statementRows(sheet.equity),
      ['Result for the year to date, computed', '', '', filsToDecimal(sheet.resultYearToDateFils)],
      ['Retained earnings, computed', '', '', filsToDecimal(sheet.retainedEarningsFils)],
      ['Total assets', '', '', filsToDecimal(sheet.totalAssetsFils)],
      ['Total liabilities and equity', '', '', filsToDecimal(sheet.totalLiabilitiesAndEquityFils)],
    ];
    return csvResponse(c, `balance-sheet-${asOf}.csv`, toCsv(rows));
  });

  api.get('/api/accounting/statements/cash-flow', async (c) => {
    const no = refused(c);
    if (no) return no;
    const period = await periodOf(c);
    if (!period) return badRequest(c);
    return c.json(CashFlowResponse.parse(await cashFlowOf(c, period.from, period.to)));
  });

  api.get('/api/accounting/statements/cash-flow.csv', async (c) => {
    const no = refused(c);
    if (no) return no;
    const period = await periodOf(c);
    if (!period) return badRequest(c);
    const flow = await cashFlowOf(c, period.from, period.to);
    const rows = [
      ['Heading', 'Amount AED'],
      ['From households', filsToDecimal(flow.byCategory.fromHouseholds)],
      ['For expenses and suppliers', filsToDecimal(flow.byCategory.forExpenses)],
      ['To owners and shareholders', filsToDecimal(flow.byCategory.toOwners)],
      ['Tax', filsToDecimal(flow.byCategory.tax)],
      ['Other', filsToDecimal(flow.byCategory.other)],
      ['Transfers between cash accounts', filsToDecimal(flow.byCategory.transfers)],
      ['Opening cash', filsToDecimal(flow.openingCashFils)],
      ['Net change', filsToDecimal(flow.netChangeFils)],
      ['Closing cash', filsToDecimal(flow.closingCashFils)],
    ];
    return csvResponse(c, `cash-flow-${period.from}-${period.to}.csv`, toCsv(rows));
  });
}
