import type { ChartAccount, PostedLine } from './types';

/**
 * Comma-separated files: each statement's own export and the two shaped like
 * Zoho Books' import templates (docs/SPEC/accounting.md section 4.6). Nothing
 * is sent anywhere — the person downloads the file — and no row names a
 * household, because no journal line does.
 *
 * A cell is either text or an amount, and the difference matters when the file
 * is opened: text that would read as a formula is guarded, and an amount never
 * is (`escapeCell` below).
 */

const NEEDS_QUOTING = /[",\r\n]/;

/**
 * What Excel and Google Sheets treat as the opening of a formula rather than
 * as text. Memos, account names and `name_ar` are typed by the owner or by
 * finance and open cells in all six files; a cell beginning with one of these
 * would be executed when somebody opened the file.
 */
const STARTS_A_FORMULA = /^[=+\-@\t\r]/;

/**
 * A cell that is a figure and not text. `filsToDecimal` writes a negative
 * balance as "-0.05", which begins exactly as a formula does: an amount is
 * marked so it is never guarded, and a file of guarded figures would be a file
 * of text no spreadsheet could add up.
 */
export type AmountCell = { readonly amount: string };
export type CsvCell = string | AmountCell;

/** An amount for a file, marked as one. */
export function amountCell(amount: number): AmountCell {
  return { amount: filsToDecimal(amount) };
}

/**
 * One field, ready for the file: a text field that would be a formula is
 * opened with a single quotation mark first, and then RFC 4180 quoting is
 * applied to whatever came of it.
 */
export function escapeCell(value: string, kind: 'text' | 'amount'): string {
  const guarded = kind === 'text' && STARTS_A_FORMULA.test(value) ? `'${value}` : value;
  return NEEDS_QUOTING.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** RFC 4180: quote a field holding a comma, a quotation mark or a line break; CRLF throughout. */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          typeof cell === 'string' ? escapeCell(cell, 'text') : escapeCell(cell.amount, 'amount'),
        )
        .join(','),
    )
    .map((line) => `${line}\r\n`)
    .join('');
}

/**
 * An amount for a file, not for a screen: "1234.56", "-0.05", no grouping and
 * no currency. Screens use `formatFils` (CLAUDE.md's money rule).
 */
export function filsToDecimal(amount: number): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${negative ? '-' : ''}${whole}.${String(remainder).padStart(2, '0')}`;
}

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
