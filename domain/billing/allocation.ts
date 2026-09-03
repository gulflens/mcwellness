/**
 * Splitting a package price across the credits it buys
 * (docs/SPEC/billing.md section 4.2: allocate by relative standalone selling
 * price). A package is a bundle of different services delivered over months,
 * so "one twentieth of the package" is the wrong number for every one of
 * them; each credit is created carrying its own share, and that share is what
 * a delivered session recognises and what an unused credit refunds at.
 *
 * Two properties this file exists to guarantee, both pinned by test in
 * allocation.test.ts:
 *
 *   1. **The parts sum exactly to the price.** Not to within a fils. The
 *      arithmetic is integer fils throughout (CLAUDE.md rule: doubles are
 *      banned for money) and the rounding remainder is handed out rather
 *      than dropped, so a package sold for 1,032,500 fils creates credits
 *      totalling 1,032,500 fils.
 *   2. **The same input always gives the same answer.** The remainder goes to
 *      the units with the largest fractional part, ties broken by the order
 *      the components were given in — never by a sort the runtime is free to
 *      reorder.
 *
 * Pure: no I/O, no clock, no randomness (.claude/rules/testing.md).
 */

import { fils, type Fils } from '../shared';

/** One line of a package definition: so many credits for one service. */
export type PackageComponent = {
  serviceTypeId: string;
  /** How many credits of this service the package contains. At least one. */
  quantity: number;
  /**
   * What one of these costs on its own today, net of VAT. Zero is legitimate
   * and deliberate: the practice's consultation is bundled and never sold
   * alone, so it carries no share of the price and refunds nothing unused.
   */
  standaloneNetFils: Fils;
};

/** One credit, with the share of the package price it carries. */
export type AllocatedEntitlement = {
  serviceTypeId: string;
  /** 1-based, within its own component: the third of fifteen sessions. */
  unit: number;
  allocatedNetFils: Fils;
};

/**
 * The allocation for one package sold at `packageNetFils`.
 *
 * Every unit's exact share is `standalone x price / standaloneTotal`. The
 * integer part is allocated first; the fils left over by that rounding are
 * then given, one each, to the units whose discarded fraction was largest
 * (the largest-remainder method), so the total is exact. The multiplication
 * runs in BigInt, so a large package can never lose a fils to a
 * floating-point product.
 *
 * Throws when a component is malformed, and when the components are worth
 * nothing standalone but the package is not free — there is no honest way to
 * split a real price across credits that have no relative value.
 */
export function allocateEntitlements(
  components: readonly PackageComponent[],
  packageNetFils: Fils,
): AllocatedEntitlement[] {
  if (components.length === 0) {
    throw new RangeError('A package must contain at least one component.');
  }
  if (packageNetFils < 0) {
    throw new RangeError('A package price cannot be negative.');
  }
  for (const component of components) {
    if (!Number.isSafeInteger(component.quantity) || component.quantity < 1) {
      throw new RangeError(
        `A package component must contain at least one credit, received ${component.quantity}.`,
      );
    }
    if (!Number.isSafeInteger(component.standaloneNetFils) || component.standaloneNetFils < 0) {
      throw new RangeError(
        `A standalone price must be a non-negative number of fils, received ${component.standaloneNetFils}.`,
      );
    }
  }

  // One entry per credit, in the order the components were given: this order
  // is the tie-break below, so it is the whole of what makes the answer stable.
  const units: { serviceTypeId: string; unit: number; standalone: bigint }[] = [];
  for (const component of components) {
    for (let unit = 1; unit <= component.quantity; unit++) {
      units.push({
        serviceTypeId: component.serviceTypeId,
        unit,
        standalone: BigInt(component.standaloneNetFils),
      });
    }
  }

  const price = BigInt(packageNetFils);
  const standaloneTotal = units.reduce((total, u) => total + u.standalone, 0n);

  if (standaloneTotal === 0n) {
    if (price !== 0n) {
      throw new RangeError(
        'A package whose components have no standalone price cannot carry a price of its own.',
      );
    }
    return units.map((u) => ({
      serviceTypeId: u.serviceTypeId,
      unit: u.unit,
      allocatedNetFils: fils(0),
    }));
  }

  const shares = units.map((u, index) => {
    const numerator = u.standalone * price;
    return {
      index,
      serviceTypeId: u.serviceTypeId,
      unit: u.unit,
      whole: numerator / standaloneTotal,
      remainder: numerator % standaloneTotal,
    };
  });

  const allocatedSoFar = shares.reduce((total, share) => total + share.whole, 0n);
  let leftover = price - allocatedSoFar;

  // The units with the largest discarded fraction take the leftover fils, one
  // each. Ties go to whichever came first in the components as given, so the
  // answer never depends on the sort being stable or the input being ordered.
  const byRemainder = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) {
      return a.index - b.index;
    }
    return a.remainder > b.remainder ? -1 : 1;
  });
  const extra = new Set<number>();
  for (const share of byRemainder) {
    if (leftover <= 0n) {
      break;
    }
    extra.add(share.index);
    leftover -= 1n;
  }

  return shares.map((share) => ({
    serviceTypeId: share.serviceTypeId,
    unit: share.unit,
    allocatedNetFils: fils(Number(share.whole + (extra.has(share.index) ? 1n : 0n))),
  }));
}

/** What the components are worth bought one at a time, net of VAT. */
export function standaloneTotalFils(components: readonly PackageComponent[]): Fils {
  return fils(components.reduce((total, c) => total + c.quantity * c.standaloneNetFils, 0));
}
