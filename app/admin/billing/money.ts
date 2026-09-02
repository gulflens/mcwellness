/**
 * Money is displayed and parsed in exactly one place (CLAUDE.md's "Money"
 * rule: doubles are banned for money everywhere; there is one formatter).
 * Both directions are exact: an amount is never multiplied or divided as a
 * floating-point number. `formatFils` reads the fils integer as two integer
 * parts (whole AED and remaining fils); `parseAedToFils` reads a typed AED
 * string the same way, so "0.1" becomes 10 and "0.2" becomes 20 without ever
 * computing `0.1 * 100` (which drifts to 10.000000000000002 in IEEE 754).
 */

/** A non-negative amount with an optional one- or two-digit fraction: "0", "120", "12.3", "12.34". */
const AED_INPUT = /^(\d+)(?:\.(\d{1,2}))?$/;

/** Formats an integer number of fils as "AED 1,234.56". */
export function formatFils(amountFils: number): string {
  if (!Number.isFinite(amountFils)) {
    throw new RangeError(`Money must be a finite number of fils, received ${amountFils}`);
  }
  const rounded = Math.round(amountFils);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const wholeAed = Math.floor(abs / 100);
  const remainderFils = abs % 100;
  const wholeFormatted = wholeAed.toLocaleString('en-US');
  const sign = negative ? '-' : '';
  return `${sign}AED ${wholeFormatted}.${String(remainderFils).padStart(2, '0')}`;
}

/**
 * A live estimate of VAT and the gross total for the "add a price" drawer,
 * matching `domain/billing/vat.ts`'s `resolveVat` formula exactly — VAT is
 * the net amount times the rate in basis points, rounded half up to the
 * nearest fils (docs/SPEC/billing.md section 5.1) — but kept local rather
 * than imported. `domain/billing/vat.ts` reaches `domain/shared` through its
 * barrel (`../shared`), and that barrel also re-exports
 * `domain/shared/identity.ts`, which imports `node:crypto` at module scope;
 * a browser bundle cannot load that. The server's own `resolveVat` remains
 * the one place a saved price's VAT is actually computed and stamped
 * (`app/api/billing/prices.ts`); this only estimates the number shown
 * before that request is made.
 */
export function previewVat(
  netFils: number,
  vatRateBasisPoints: number,
): { vatFils: number; grossFils: number } {
  const vatFils = Math.round((netFils * vatRateBasisPoints) / 10_000);
  return { vatFils, grossFils: netFils + vatFils };
}

/**
 * Parses an AED amount typed by a person (e.g. "12.34") into an exact
 * integer number of fils (1234). The whole and fractional parts are read as
 * integers directly and only ever added, never produced by multiplying a
 * decimal — so a value such as "0.1" or "0.2" converts exactly. Returns
 * `null` for anything that is not a non-negative amount with at most two
 * decimal places (empty input, a negative sign, more than two decimals, a
 * thousands separator, or a value too large to hold safely).
 */
export function parseAedToFils(input: string): number | null {
  const match = AED_INPUT.exec(input.trim());
  if (!match) {
    return null;
  }
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const wholeAed = Number(whole);
  const fractionFils = Number(fraction);
  if (!Number.isSafeInteger(wholeAed)) {
    return null;
  }
  const wholeFils = wholeAed * 100;
  const total = wholeFils + fractionFils;
  return Number.isSafeInteger(total) ? total : null;
}
