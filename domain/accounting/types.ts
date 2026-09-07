import type { Fils, IsoDate } from '../shared';

/**
 * The books' shapes (docs/SPEC/accounting.md sections 4.1, 4.2 and 4.4). Types
 * only: every rule about them is a pure function beside this file, and every
 * later task uses these names exactly.
 */

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_ROLES = [
  'bank',
  'cash',
  'link_clearing',
  'receivable',
  'refunds_payable',
  'contract_liability',
  'vat_payable',
  'opening_balance',
  'income_sessions',
  'income_assessments',
  'income_fees',
  'income_expired',
] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** The three accounts a cash flow statement counts as cash (section 4.5). */
export const CASH_ROLES: readonly AccountRole[] = ['bank', 'cash', 'link_clearing'];

export type ChartAccount = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: AccountType;
  role: AccountRole | null;
  archivedAt: string | null;
};

export const JOURNAL_KINDS = ['opening', 'automatic', 'manual', 'reversal'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export type DraftLine = { accountId: string; debitFils: Fils; creditFils: Fils };

export type JournalSource = { table: string; id: string; event: string };

export type JournalDraft = {
  enteredOn: IsoDate;
  occurredOn: IsoDate | null;
  kind: JournalKind;
  memo: string;
  lines: readonly DraftLine[];
  source: JournalSource | null;
};

export type PostedLine = {
  entryId: string;
  entryReference: string;
  enteredOn: IsoDate;
  kind: JournalKind;
  memo: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  accountRole: AccountRole | null;
  debitFils: Fils;
  creditFils: Fils;
};

export type FiscalYearStatus = 'open' | 'closed';

export type FiscalYear = {
  id: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  status: FiscalYearStatus;
};

export type BooksSetting = {
  booksStartOn: IsoDate;
  yearEndMonth: number;
  yearEndDay: number;
  lockedThrough: IsoDate | null;
  corporateTaxRateBasisPoints: number;
  corporateTaxThresholdFils: Fils;
  smallBusinessReliefElected: boolean;
  smallBusinessReliefThresholdFils: Fils;
};
