import { amountCell, type CsvCell } from '../shared/csv';
import type { ChartAccount, PostedLine } from './types';

/**
 * Comma-separated files: each statement's own export and the two shaped like
 * Zoho Books' import templates (docs/SPEC/accounting.md section 4.6). Nothing
 * is sent anywhere — the person downloads the file — and no row names a
 * household, because no journal line does.
 *
 * The writer itself — a cell is text or an amount, text that would read as a
 * formula is guarded, an amount never is — lives in `domain/shared/csv`
 * since trunk round 50, because the expo's leads file needed the same rules;
 * the names below are re-exported so nothing in the books moved.
 */
export { amountCell, escapeCell, filsToDecimal, toCsv } from '../shared/csv';
export type { AmountCell, CsvCell } from '../shared/csv';

/**
 * Zoho Books' journal import columns. Verified on 2026-09-07 against the API
 * reference https://www.zoho.com/books/api/v3/journals/ — a journal carries
 * `journal_date`, `reference_number` and `notes`, and each line an
 * `account_name` with a debit or a credit — and the help page
 * https://www.zoho.com/us/books/help/accountant/manual-journal.html, which
 * shows the same fields on the form and maps an import file's headings onto
 * them. The sample file itself is downloadable only from inside an account,
 * so these are the field names the mapper matches, in the template's order.
 */
export const ZOHO_JOURNAL_HEADINGS: readonly string[] = [
  'Journal Date',
  'Reference Number',
  'Notes',
  'Account',
  'Debit',
  'Credit',
];

/** One row per posted line, the headings first. */
export function zohoJournalRows(lines: readonly PostedLine[]): CsvCell[][] {
  return [
    [...ZOHO_JOURNAL_HEADINGS],
    ...lines.map((line) => [
      line.enteredOn,
      line.entryReference,
      line.memo,
      line.accountName,
      amountCell(line.debitFils),
      amountCell(line.creditFils),
    ]),
  ];
}

/**
 * Zoho Books' chart-of-accounts import columns. Verified on 2026-09-07 against
 * https://www.zoho.com/books/api/v3/chart-of-accounts/ (`account_code`,
 * `account_name`, `account_type`) and the type names on
 * https://www.zoho.com/us/books/help/accountant/chart-of-accounts.html.
 */
export const ZOHO_ACCOUNT_HEADINGS: readonly string[] = [
  'Account Code',
  'Account Name',
  'Account Type',
];

/** The books' five types and three cash roles said in Zoho Books' own words. */
function zohoAccountType(account: ChartAccount): string {
  switch (account.type) {
    case 'asset':
      if (account.role === 'bank') {
        return 'Bank';
      }
      return account.role === 'cash' ? 'Cash' : 'Other Current Asset';
    case 'liability':
      return 'Other Current Liability';
    case 'equity':
      return 'Equity';
    case 'income':
      return 'Income';
    case 'expense':
      return 'Expense';
  }
}

export function zohoAccountRows(chart: readonly ChartAccount[]): string[][] {
  return [
    [...ZOHO_ACCOUNT_HEADINGS],
    ...chart.map((account) => [account.code, account.name, zohoAccountType(account)]),
  ];
}
