/**
 * The books' rules, all of them pure and browser-safe: no Node built-in is
 * reachable from here, which tests/lint/no-node-imports-in-browser-bundle.test.ts
 * proves by walking this barrel (docs/CHANGE-REQUESTS/accounting-01.md item 11).
 * The Books page imports `formatFils` and `codeMatchesType` through it.
 */
export { ACCOUNT_ROLES, ACCOUNT_TYPES, CASH_ROLES, JOURNAL_KINDS } from './types';
export type {
  AccountRole,
  AccountType,
  BooksSetting,
  ChartAccount,
  DraftLine,
  FiscalYear,
  FiscalYearStatus,
  JournalDraft,
  JournalKind,
  JournalSource,
  PostedLine,
} from './types';
export { addDays, isWithin, isoDateOf, yearBoundsContaining, yearOf } from './dates';
export {
  MissingRoleError,
  UnbalancedEntryError,
  accountByRole,
  assertBalanced,
  balanceWithOpeningEquity,
  codeMatchesType,
  cr,
  dr,
  mayArchive,
  reversalOf,
} from './journal';
export {
  landingDayFor,
  lockMove,
  mayChangeYearEnd,
  mayCloseYear,
  mayLockThrough,
  mayPostOn,
  yearContaining,
} from './years';
export type { LockMove } from './years';
export { SOURCE_TABLE, postingsFor } from './posting';
export type { MoneyEvent } from './posting';
export {
  UnbalancedBooksError,
  accountLedger,
  balanceOf,
  balanceSheet,
  cashFlow,
  cashPosition,
  profitAndLoss,
  trialBalance,
} from './statements';
export type { CashFlowCategory, LedgerRow, StatementRow, TrialBalanceRow } from './statements';
export { corporateTaxEstimate, reliefWatch } from './tax';
export type { ReliefWatch } from './tax';
export {
  ZOHO_ACCOUNT_HEADINGS,
  ZOHO_JOURNAL_HEADINGS,
  filsToDecimal,
  toCsv,
  zohoAccountRows,
  zohoJournalRows,
} from './csv';
