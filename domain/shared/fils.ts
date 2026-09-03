/**
 * Money is an integer number of fils (AED multiplied by 100). Floating-point
 * numbers are never used for money anywhere in this codebase.
 *
 * `Fils` is a branded integer: a plain `number` cannot be passed where money
 * is expected without going through `fils()`, which checks it is a safe
 * integer.
 *
 * **And this is where money is formatted** — the one place, as CLAUDE.md's
 * money rule requires. `formatFils` lived in `app/admin/billing/money.ts`
 * while only the admin screens showed money, then moved to
 * `domain/billing/money.ts` when the rendered invoice needed it, and is here
 * now because it belongs to nobody in particular: two streams reached the
 * same wall importing it from a third's path (`docs/CHANGE-REQUESTS/
 * scheduling-04.md` section 4, `session-capture-02.md`). Nine lines of
 * integer arithmetic with no billing dependency at all, in the file the
 * `Fils` type is already in. `domain/billing/money.ts` and
 * `app/admin/billing/money.ts` both re-export it, so no caller moved.
 */
export type Fils = number & { readonly __brand: 'Fils' };

/** Builds a `Fils` value, refusing anything that is not a safe integer. */
export function fils(amount: number): Fils {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Money must be an integer number of fils, received ${amount}`);
  }
  return amount as Fils;
}

/** Adds two amounts. The result passes through `fils()` so overflow cannot slip by. */
export function addFils(a: Fils, b: Fils): Fils {
  return fils(a + b);
}

/**
 * Formats an integer number of fils as a bare figure with en-GB grouping:
 * "1,234.56". Bare, not "AED 1,234.56": the currency is named once, by the
 * column header or the field label, not repeated on every row
 * (docs/DESIGN-BRIEF.md's silence by default).
 *
 * The arithmetic is exact. The fils integer is read as two integer parts —
 * whole AED, and the remaining fils — so nothing is ever divided as a
 * floating-point number.
 *
 * A plain `number` rather than a `Fils`, deliberately: every figure that
 * reaches a screen has come off a JSON response and is an ordinary number by
 * then, and a formatter that demanded the brand would be a formatter every
 * caller had to launder its argument through.
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
