import type { AccountRole, AccountType, JournalKind } from '@domain/accounting';

/**
 * The books' own vocabulary in the words a person reads. Every one of these is
 * a fixed sentence fragment chosen here, never a value from the server shown
 * raw: a screen that printed `income_sessions` would be a screen that had not
 * decided what it meant.
 */

export const ACCOUNT_TYPE_WORDS: Record<AccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

export const ACCOUNT_ROLE_WORDS: Record<AccountRole, string> = {
  bank: 'Bank',
  cash: 'Cash box',
  link_clearing: 'Payment link clearing',
  receivable: 'Owed by households',
  refunds_payable: 'Refunds owed',
  contract_liability: 'Sessions owed',
  vat_payable: 'VAT payable',
  opening_balance: 'Opening balance',
  income_sessions: 'Session income',
  income_assessments: 'Brain map income',
  income_fees: 'Call-out fee income',
  income_expired: 'Expired credit income',
};

export const JOURNAL_KIND_WORDS: Record<JournalKind, string> = {
  opening: 'Opening',
  automatic: 'Automatic',
  manual: 'By hand',
  reversal: 'Reversal',
};

const EVENT_WORDS: Record<string, string> = {
  'invoice.issued': 'Invoice issued',
  'fee.waived': 'Call-out fee waived',
  'payment.received': 'Payment received',
  'credit.consumed': 'Credit used up',
  'credit.waived': 'Credit restored',
  'credit.expired': 'Credit expired',
  'credit.refunded': 'Credit refunded',
};

/** What an automatic entry came from, in words; an entry written by hand has none. */
export function eventWords(sourceEvent: string | null): string {
  if (sourceEvent === null) {
    return '';
  }
  return EVENT_WORDS[sourceEvent] ?? 'Something the books do not recognise';
}

/** The relief watch's three states, as the sentence beside the figure. */
export const RELIEF_WORDS = {
  clear: 'Comfortably below the relief line.',
  approaching: 'Approaching the relief line.',
  exceeded: 'Relief lost for this year.',
} as const;
