/**
 * Money is an integer number of fils (AED multiplied by 100). Floating-point
 * numbers are never used for money anywhere in this codebase.
 *
 * `Fils` is a branded integer: a plain `number` cannot be passed where money
 * is expected without going through `fils()`, which checks it is a safe
 * integer.
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
