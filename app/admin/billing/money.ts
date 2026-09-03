import { resolveVat, type VatSetting } from '@domain/billing';
import { fils } from '@domain/shared';

/**
 * Money is displayed and parsed in exactly one place (CLAUDE.md's "Money"
 * rule: doubles are banned for money everywhere; there is one formatter).
 * Both directions are exact: an amount is never multiplied or divided as a
 * floating-point number. `formatFils` reads the fils integer as two integer
 * parts (whole AED and remaining fils); `parseAedToFils` reads a typed AED
 * string the same way, so "0.1" becomes 10 and "0.2" becomes 20 without ever
 * computing `0.1 * 100` (which drifts to 10.000000000000002 in IEEE 754).
 *
 * `formatFils` returns the bare figure ("1,234.56"), not "AED 1,234.56": the
 * currency word is named once — the "Unit price (AED)" table header, the
 * price field's own label — not repeated on every cell and preview row
 * (docs/DESIGN-BRIEF.md's silence-by-default: a word that means the same
 * thing on every row belongs to the column, not the cell).
 */

/**
 * A non-negative AED amount with an optional one- or two-digit fraction,
 * written plainly or with thousands separators: "0", "120", "12.3", "12.34",
 * "12,150.00".
 *
 * **Grouping is accepted because this file writes it.** `formatFils` returns
 * "12,150.00", and two drawers put that figure straight back into a field the
 * person may then submit unchanged: the package drawer offers the contents'
 * total as the list price, and the payment drawer offers the outstanding
 * amount. A parser that refused a comma refused its own output, so a founder
 * building the practice's Silver programme was told to "enter both prices in
 * AED" about the very figure the screen had just handed her.
 *
 * Only well-formed grouping passes — "1,234.56" yes, "12,34" and "1,23,456"
 * no — so a European decimal comma is still refused outright rather than
 * quietly read as a thousands separator and paid a hundredfold.
 */
const AED_INPUT = /^(\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

/**
 * The `price.unit_price_fils` column is Postgres `integer` (int4); this is
 * its largest value, AED 21,474,836.47. `parseAedToFils` refuses anything
 * above it before a request is ever sent, rather than letting the server's
 * own column check turn it into a generic 400.
 */
export const AED_MAX_FILS = 2_147_483_647;

/** Formats an integer number of fils as a bare figure with en-GB grouping: "1,234.56". */
export function formatFils(amountFils: number): string {
  if (!Number.isFinite(amountFils)) {
    throw new RangeError(`Money must be a finite number of fils, received ${amountFils}`);
  }
  const rounded = Math.round(amountFils);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const wholeAed = Math.floor(abs / 100);
  const remainderFils = abs % 100;
  const wholeFormatted = wholeAed.toLocaleString('en-GB');
  const sign = negative ? '-' : '';
  return `${sign}${wholeFormatted}.${String(remainderFils).padStart(2, '0')}`;
}

/**
 * A live estimate of VAT and the gross total for the "add a price" drawer,
 * computed by the same `resolveVat` (`domain/billing/vat.ts`) the server
 * calls to stamp a saved price — the browser and the server run one
 * arithmetic, not two that happen to agree. The `version` on the setting
 * passed here is a placeholder: nothing has been saved yet, so there is no
 * real `vat_setting` row to cite, and the caller only reads `vatFils` and
 * `grossFils` back out. The server's own call
 * (`app/api/billing/prices.ts`) remains the one place a saved price's VAT
 * is actually computed and stamped; this only estimates the number shown
 * before that request is made.
 */
export function previewVat(
  netFils: number,
  vatRateBasisPoints: number,
): { vatFils: number; grossFils: number } {
  const setting: VatSetting = { rateBasisPoints: vatRateBasisPoints, version: 0 };
  const resolution = resolveVat(fils(netFils), setting);
  return { vatFils: resolution.vatFils, grossFils: resolution.grossFils };
}

/**
 * The exact number of fils an AED string names, or `null` when it is not an
 * AED amount at all. The whole and fractional parts are read as integers and
 * only ever added, never produced by multiplying a decimal — so "0.1"
 * converts to 10 exactly, where `0.1 * 100` drifts to 10.000000000000002 in
 * IEEE 754. The column's own ceiling is not applied here: the two callers
 * below differ only in what they do about it.
 */
function readAedFils(input: string): number | null {
  const match = AED_INPUT.exec(input.trim());
  if (!match) {
    return null;
  }
  const wholeAed = Number((match[1] ?? '0').replaceAll(',', ''));
  const fractionFils = Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(wholeAed)) {
    return null;
  }
  const total = wholeAed * 100 + fractionFils;
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * Parses an AED amount typed by a person, or offered by this file's own
 * `formatFils` ("12.34", "12,150.00"), into an exact integer number of fils.
 * Returns `null` for anything that is not a non-negative amount with at most
 * two decimal places (empty input, a negative sign, more than two decimals,
 * misplaced grouping), and for an amount above `AED_MAX_FILS` — the database
 * column's own ceiling, checked here rather than left to a 400 the caller can
 * only show as "something went wrong".
 */
export function parseAedToFils(input: string): number | null {
  const total = readAedFils(input);
  if (total === null || total > AED_MAX_FILS) {
    return null;
  }
  return total;
}

/**
 * True only for the one shape of `parseAedToFils` returning `null` that
 * deserves its own message: a well-formed AED amount that exceeds
 * `AED_MAX_FILS`. Every other `null` (empty input, letters, a negative sign,
 * misplaced grouping) is the generic "not a price" case instead.
 */
export function isAedAmountTooLarge(input: string): boolean {
  const total = readAedFils(input);
  return total !== null && total > AED_MAX_FILS;
}
