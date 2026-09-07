/**
 * A discount is money off a list figure, and this is the only place the
 * arithmetic lives (docs/SPEC/billing.md section 2.4, the operator's decision
 * of 7 September 2026 at 21:49, which amends the founder's decision of
 * 2026-09-03 that no discount percentage is stored anywhere). The price list,
 * the package routes, the sale and the browser's preview all call these two
 * functions, so a figure the drawer shows and the figure the invoice carries
 * cannot drift apart.
 *
 * Pure: no I/O, no clock read (.claude/rules/testing.md). Money is integer
 * fils throughout; nothing here divides as a floating-point number.
 */

import { fils, type Fils } from '../shared';

/** How a person expressed a discount: a share of the list figure, or a sum of money. */
export type Discount =
  | { kind: 'percent'; basisPoints: number } // 1500 is fifteen per cent
  | { kind: 'amount'; fils: Fils };

export type AppliedDiscount = {
  listFils: Fils;
  discountFils: Fils;
  netFils: Fils;
  /** The percentage, kept only when the discount was one; null for a sum. */
  basisPoints: number | null;
};

const BASIS_POINTS_IN_WHOLE = 10_000;

/**
 * A share of an amount, rounded half up to the fils — the same rule VAT
 * rounds by, so a family never meets two rounding conventions on one
 * document. Integer arithmetic only: the product and its remainder are both
 * exact, and the half is decided by doubling the remainder rather than by
 * comparing halves of a division.
 */
function shareOf(amountFils: Fils, basisPoints: number): Fils {
  const product = amountFils * basisPoints;
  const remainder = product % BASIS_POINTS_IN_WHOLE;
  const whole = (product - remainder) / BASIS_POINTS_IN_WHOLE;
  return fils(remainder * 2 >= BASIS_POINTS_IN_WHOLE ? whole + 1 : whole);
}

function checkList(listFils: Fils): void {
  if (!Number.isSafeInteger(listFils) || listFils < 0) {
    throw new RangeError(`A list figure must be a whole number of fils, received ${listFils}`);
  }
}

function checkBasisPoints(basisPoints: number): void {
  if (
    !Number.isSafeInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > BASIS_POINTS_IN_WHOLE
  ) {
    throw new RangeError(
      `A discount percentage must be between 0 and 10000 basis points, received ${basisPoints}`,
    );
  }
}

/**
 * Money off `listFils`, rounded half up to the fils. `null` is no discount.
 *
 * The list figure is the ceiling: nothing is ever sold above it and no
 * discount can take a price below nothing (the operator's first default).
 */
export function applyDiscount(listFils: Fils, discount: Discount | null): AppliedDiscount {
  checkList(listFils);
  if (discount === null) {
    return { listFils, discountFils: fils(0), netFils: listFils, basisPoints: null };
  }
  if (discount.kind === 'percent') {
    checkBasisPoints(discount.basisPoints);
    const discountFils = shareOf(listFils, discount.basisPoints);
    return {
      listFils,
      discountFils,
      netFils: fils(listFils - discountFils),
      basisPoints: discount.basisPoints,
    };
  }
  const amount = discount.fils;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > listFils) {
    throw new RangeError(
      `A discount of ${amount} fils is not a whole sum between nothing and the list figure of ${listFils}`,
    );
  }
  return {
    listFils,
    discountFils: fils(amount),
    netFils: fils(listFils - amount),
    basisPoints: null,
  };
}

/**
 * A sale's discount: the price list's own standing discount plus an extra one
 * taken from the same list figure (the operator's second default — the two add
 * up into one discount on the invoice).
 *
 * When both are percentages the combined percentage is applied once to the
 * list figure, so fifteen per cent and five per cent is exactly twenty per
 * cent and never five per cent of an already discounted figure, nor two
 * roundings. Otherwise the two sums are added and no percentage is kept,
 * because no single percentage would describe what was given.
 */
export function combineDiscounts(
  listFils: Fils,
  standing: { discountFils: Fils; basisPoints: number | null },
  extra: Discount | null,
): AppliedDiscount {
  checkList(listFils);
  if (
    !Number.isSafeInteger(standing.discountFils) ||
    standing.discountFils < 0 ||
    standing.discountFils > listFils
  ) {
    throw new RangeError(
      `The price list's own discount of ${standing.discountFils} fils is not a whole sum between nothing and the list figure of ${listFils}`,
    );
  }
  if (standing.basisPoints !== null) {
    checkBasisPoints(standing.basisPoints);
  }
  if (extra === null) {
    return {
      listFils,
      discountFils: standing.discountFils,
      netFils: fils(listFils - standing.discountFils),
      basisPoints: standing.basisPoints,
    };
  }
  if (standing.basisPoints !== null && extra.kind === 'percent') {
    checkBasisPoints(extra.basisPoints);
    return applyDiscount(listFils, {
      kind: 'percent',
      basisPoints: standing.basisPoints + extra.basisPoints,
    });
  }
  const applied = applyDiscount(listFils, extra);
  const discountFils = fils(standing.discountFils + applied.discountFils);
  if (discountFils > listFils) {
    throw new RangeError(
      `A discount of ${discountFils} fils is larger than the list figure of ${listFils}`,
    );
  }
  return { listFils, discountFils, netFils: fils(listFils - discountFils), basisPoints: null };
}
