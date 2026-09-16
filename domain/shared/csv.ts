/**
 * Comma-separated files, for anything a person downloads from the practice
 * system: the books' statements (domain/accounting) and, from trunk round 50,
 * the expo's leads (domain/enquiry). Nothing is sent anywhere — the person
 * downloads the file — and the rules are the same whoever writes one.
 *
 * A cell is either text or an amount, and the difference matters when the file
 * is opened: text that would read as a formula is guarded, and an amount never
 * is (`escapeCell` below). A telephone number in E.164 begins with a plus, so
 * it is guarded like any text: the office sees a quotation mark before the
 * number, and a spreadsheet never evaluates it.
 */

const NEEDS_QUOTING = /[",\r\n]/;

/**
 * What Excel and Google Sheets treat as the opening of a formula rather than
 * as text. Memos, account names, a visitor's own message — every open cell is
 * typed by somebody, and a cell beginning with one of these would be executed
 * when the file was opened.
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
