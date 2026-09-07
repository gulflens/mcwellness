import { addFils, fils, type Fils, type IsoDate } from '../shared';
import { addDays, isWithin } from './dates';
import { CASH_ROLES, type AccountRole, type AccountType, type PostedLine } from './types';

/**
 * The four statements, an account's ledger and the cash position
 * (docs/SPEC/accounting.md section 4.5), all computed and none stored. Every
 * function is pure over the posted lines with every date an argument, and two
 * of them refuse rather than answer: a balance sheet that does not balance and
 * a cash flow whose closing cash does not tie are thrown, never shown
 * (rules 12 and 17).
 */

export class UnbalancedBooksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnbalancedBooksError';
  }
}

/** The day the books can have nothing before: the beginning of time, for retained earnings. */
const DAWN: IsoDate = '0000-01-01';

const DEBIT_NATURAL: readonly AccountType[] = ['asset', 'expense'];

/** The account's own direction: assets and expenses rise on the debit side. */
export function balanceOf(type: AccountType, debitFils: Fils, creditFils: Fils): Fils {
  return DEBIT_NATURAL.includes(type) ? fils(debitFils - creditFils) : fils(creditFils - debitFils);
}

export type StatementRow = {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  balanceFils: Fils;
};

export type TrialBalanceRow = StatementRow & { debitFils: Fils; creditFils: Fils };

type Totals = {
  code: string;
  name: string;
  type: AccountType;
  role: AccountRole | null;
  debit: Fils;
  credit: Fils;
};

function totalsByAccount(lines: readonly PostedLine[]): Map<string, Totals> {
  const totals = new Map<string, Totals>();
  for (const line of lines) {
    const found = totals.get(line.accountCode) ?? {
      code: line.accountCode,
      name: line.accountName,
      type: line.accountType,
      role: line.accountRole,
      debit: fils(0),
      credit: fils(0),
    };
    found.debit = addFils(found.debit, line.debitFils);
    found.credit = addFils(found.credit, line.creditFils);
    totals.set(line.accountCode, found);
  }
  return totals;
}

function inPeriod(lines: readonly PostedLine[], from: IsoDate, to: IsoDate): PostedLine[] {
  return lines.filter((line) => isWithin(line.enteredOn, from, to));
}

function upTo(lines: readonly PostedLine[], asOf: IsoDate): PostedLine[] {
  return lines.filter((line) => line.enteredOn <= asOf);
}

function rowOf(totals: Totals): StatementRow {
  return {
    accountCode: totals.code,
    accountName: totals.name,
    accountType: totals.type,
    balanceFils: balanceOf(totals.type, totals.debit, totals.credit),
  };
}

function rowsOf(totals: Map<string, Totals>, types: readonly AccountType[]): StatementRow[] {
  return [...totals.values()]
    .filter((account) => types.includes(account.type))
    .map(rowOf)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

function sum(rows: readonly StatementRow[]): Fils {
  let total = fils(0);
  for (const row of rows) {
    total = addFils(total, row.balanceFils);
  }
  return total;
}

/** Every account that moved up to the day, its two sides and its balance. */
export function trialBalance(
  lines: readonly PostedLine[],
  asOf: IsoDate,
): { asOf: IsoDate; rows: TrialBalanceRow[]; totalDebitFils: Fils; totalCreditFils: Fils } {
  const totals = totalsByAccount(upTo(lines, asOf));
  const rows: TrialBalanceRow[] = [...totals.values()]
    .map((account) => ({ ...rowOf(account), debitFils: account.debit, creditFils: account.credit }))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  let totalDebitFils = fils(0);
  let totalCreditFils = fils(0);
  for (const row of rows) {
    totalDebitFils = addFils(totalDebitFils, row.debitFils);
    totalCreditFils = addFils(totalCreditFils, row.creditFils);
  }
  return { asOf, rows, totalDebitFils, totalCreditFils };
}

export function profitAndLoss(
  lines: readonly PostedLine[],
  from: IsoDate,
  to: IsoDate,
): {
  from: IsoDate;
  to: IsoDate;
  income: StatementRow[];
  expenses: StatementRow[];
  incomeFils: Fils;
  expenseFils: Fils;
  resultFils: Fils;
} {
  const totals = totalsByAccount(inPeriod(lines, from, to));
  const income = rowsOf(totals, ['income']);
  const expenses = rowsOf(totals, ['expense']);
  const incomeFils = sum(income);
  const expenseFils = sum(expenses);
  return {
    from,
    to,
    income,
    expenses,
    incomeFils,
    expenseFils,
    resultFils: fils(incomeFils - expenseFils),
  };
}

/**
 * Assets against liabilities and equity, with the year's result and every
 * earlier year's result computed rather than posted (section 4.1: there are no
 * closing entries, so there is nothing to post them to).
 */
export function balanceSheet(
  lines: readonly PostedLine[],
  asOf: IsoDate,
  currentYearStartsOn: IsoDate,
): {
  asOf: IsoDate;
  assets: StatementRow[];
  liabilities: StatementRow[];
  equity: StatementRow[];
  resultYearToDateFils: Fils;
  retainedEarningsFils: Fils;
  totalAssetsFils: Fils;
  totalLiabilitiesAndEquityFils: Fils;
} {
  const totals = totalsByAccount(upTo(lines, asOf));
  const assets = rowsOf(totals, ['asset']);
  const liabilities = rowsOf(totals, ['liability']);
  const equity = rowsOf(totals, ['equity']);
  const resultYearToDateFils = profitAndLoss(lines, currentYearStartsOn, asOf).resultFils;
  const retainedEarningsFils =
    currentYearStartsOn > DAWN
      ? profitAndLoss(lines, DAWN, addDays(currentYearStartsOn, -1)).resultFils
      : fils(0);
  const totalAssetsFils = sum(assets);
  const totalLiabilitiesAndEquityFils = fils(
    sum(liabilities) + sum(equity) + resultYearToDateFils + retainedEarningsFils,
  );
  if (totalAssetsFils !== totalLiabilitiesAndEquityFils) {
    throw new UnbalancedBooksError(
      `Assets ${totalAssetsFils} do not equal liabilities and equity ${totalLiabilitiesAndEquityFils}.`,
    );
  }
  return {
    asOf,
    assets,
    liabilities,
    equity,
    resultYearToDateFils,
    retainedEarningsFils,
    totalAssetsFils,
    totalLiabilitiesAndEquityFils,
  };
}

/** The balances of the accounts with a cash role, and their sum. */
export function cashPosition(
  lines: readonly PostedLine[],
  asOf: IsoDate,
): { accounts: StatementRow[]; totalFils: Fils } {
  const totals = totalsByAccount(upTo(lines, asOf));
  const accounts = [...totals.values()]
    .filter((account) => account.role !== null && CASH_ROLES.includes(account.role))
    .map(rowOf)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  return { accounts, totalFils: sum(accounts) };
}

export type CashFlowCategory =
  'fromHouseholds' | 'forExpenses' | 'toOwners' | 'tax' | 'other' | 'transfers';

function isCash(line: PostedLine): boolean {
  return line.accountRole !== null && CASH_ROLES.includes(line.accountRole);
}

/** Which heading an entry's cash movement belongs under, read from its other side. */
function categoryOf(counterparts: readonly PostedLine[]): CashFlowCategory {
  if (counterparts.length === 0) {
    return 'transfers';
  }
  if (counterparts.every((line) => line.accountRole === 'receivable')) {
    return 'fromHouseholds';
  }
  if (counterparts.every((line) => line.accountType === 'expense')) {
    return 'forExpenses';
  }
  if (counterparts.every((line) => line.accountType === 'equity')) {
    return 'toOwners';
  }
  if (counterparts.every((line) => line.accountRole === 'vat_payable')) {
    return 'tax';
  }
  return 'other';
}

/**
 * The direct method: every entry in the period that touched a cash account,
 * classified by what stood on the other side of it. Transfers between two cash
 * accounts are listed on their own and net to nothing.
 */
export function cashFlow(
  lines: readonly PostedLine[],
  from: IsoDate,
  to: IsoDate,
): {
  from: IsoDate;
  to: IsoDate;
  byCategory: Record<CashFlowCategory, Fils>;
  openingCashFils: Fils;
  netChangeFils: Fils;
  closingCashFils: Fils;
} {
  const byCategory: Record<CashFlowCategory, Fils> = {
    fromHouseholds: fils(0),
    forExpenses: fils(0),
    toOwners: fils(0),
    tax: fils(0),
    other: fils(0),
    transfers: fils(0),
  };
  const entries = new Map<string, PostedLine[]>();
  for (const line of inPeriod(lines, from, to)) {
    entries.set(line.entryId, [...(entries.get(line.entryId) ?? []), line]);
  }
  let netChangeFils = fils(0);
  for (const entryLines of entries.values()) {
    const cashLines = entryLines.filter(isCash);
    if (cashLines.length === 0) {
      continue;
    }
    let inflow = fils(0);
    for (const line of cashLines) {
      inflow = fils(inflow + line.debitFils - line.creditFils);
    }
    const category = categoryOf(entryLines.filter((line) => !isCash(line)));
    byCategory[category] = fils(byCategory[category] + inflow);
    netChangeFils = fils(netChangeFils + inflow);
  }
  const openingCashFils = cashPosition(lines, addDays(from, -1)).totalFils;
  const closingCashFils = fils(openingCashFils + netChangeFils);
  const position = cashPosition(lines, to).totalFils;
  if (closingCashFils !== position) {
    throw new UnbalancedBooksError(
      `Closing cash ${closingCashFils} does not equal the cash position ${position} on ${to}.`,
    );
  }
  return { from, to, byCategory, openingCashFils, netChangeFils, closingCashFils };
}

export type LedgerRow = {
  entryReference: string;
  enteredOn: IsoDate;
  memo: string;
  debitFils: Fils;
  creditFils: Fils;
  runningBalanceFils: Fils;
};

/** One account, day by day, with the balance it carried into the period. */
export function accountLedger(
  lines: readonly PostedLine[],
  accountCode: string,
  from: IsoDate,
  to: IsoDate,
): { openingBalanceFils: Fils; rows: LedgerRow[]; closingBalanceFils: Fils } {
  const own = lines.filter((line) => line.accountCode === accountCode);
  const before = totalsByAccount(own.filter((line) => line.enteredOn < from)).get(accountCode);
  const type = own[0]?.accountType ?? 'asset';
  const openingBalanceFils = before ? balanceOf(type, before.debit, before.credit) : fils(0);
  const period = inPeriod(own, from, to).sort(
    (a, b) =>
      a.enteredOn.localeCompare(b.enteredOn) || a.entryReference.localeCompare(b.entryReference),
  );
  let running = openingBalanceFils;
  const rows: LedgerRow[] = period.map((line) => {
    running = fils(running + balanceOf(type, line.debitFils, line.creditFils));
    return {
      entryReference: line.entryReference,
      enteredOn: line.enteredOn,
      memo: line.memo,
      debitFils: line.debitFils,
      creditFils: line.creditFils,
      runningBalanceFils: running,
    };
  });
  return { openingBalanceFils, rows, closingBalanceFils: running };
}
