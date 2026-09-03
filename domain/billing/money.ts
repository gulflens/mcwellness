/**
 * Money is displayed in exactly one place (CLAUDE.md's "Money" rule: doubles
 * are banned for money everywhere; there is one formatter).
 *
 * It lives here, in the domain, because two things now show money and both must
 * show it identically: the admin screens (`app/admin/billing/money.ts`
 * re-exports this and adds the parsing a typed field needs) and the rendered
 * invoice (`domain/billing/document`), which is pure and cannot reach into
 * `app/`. One function, one output, whichever is asking.
 *
 * The arithmetic is exact. `formatFils` reads the fils integer as two integer
 * parts — whole AED, and the remaining fils — so nothing is ever divided as a
 * floating-point number.
 */

/**
 * Formats an integer number of fils as a bare figure with en-GB grouping:
 * "1,234.56". Bare, not "AED 1,234.56": the currency is named once, by the
 * column header or the field label, not repeated on every row
 * (docs/DESIGN-BRIEF.md's silence by default).
 */
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
