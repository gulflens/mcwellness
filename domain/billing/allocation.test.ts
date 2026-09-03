import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import { allocateEntitlements, standaloneTotalFils, type PackageComponent } from './allocation';

/**
 * The specification for how a package price is split (docs/SPEC/billing.md
 * section 4.2). The three packages below are the practice's own, as the
 * founder set them on 2026-09-03: a consultation bundled at no charge, brain
 * maps at AED 825 net and neurofeedback sessions at AED 700 net, sold as
 * Silver, Gold and Platinum at a launch price the founder names. The
 * expected figures here are pinned, not derived: if the arithmetic changes,
 * these numbers change with it, in the same commit, with a reason.
 */

const CONSULTATION = 'consultation';
const BRAIN_MAP = 'brain-map';
const NF_SESSION = 'nf-session';

const SILVER: PackageComponent[] = [
  { serviceTypeId: CONSULTATION, quantity: 1, standaloneNetFils: fils(0) },
  { serviceTypeId: BRAIN_MAP, quantity: 2, standaloneNetFils: fils(82_500) },
  { serviceTypeId: NF_SESSION, quantity: 15, standaloneNetFils: fils(70_000) },
];
const GOLD: PackageComponent[] = [
  { serviceTypeId: CONSULTATION, quantity: 2, standaloneNetFils: fils(0) },
  { serviceTypeId: BRAIN_MAP, quantity: 3, standaloneNetFils: fils(82_500) },
  { serviceTypeId: NF_SESSION, quantity: 25, standaloneNetFils: fils(70_000) },
];
const PLATINUM: PackageComponent[] = [
  { serviceTypeId: CONSULTATION, quantity: 3, standaloneNetFils: fils(0) },
  { serviceTypeId: BRAIN_MAP, quantity: 4, standaloneNetFils: fils(82_500) },
  { serviceTypeId: NF_SESSION, quantity: 40, standaloneNetFils: fils(70_000) },
];

function total(allocation: readonly { allocatedNetFils: number }[]): number {
  return allocation.reduce((sum, unit) => sum + unit.allocatedNetFils, 0);
}

function valuesFor(
  allocation: readonly { serviceTypeId: string; allocatedNetFils: number }[],
  serviceTypeId: string,
): number[] {
  return allocation.filter((u) => u.serviceTypeId === serviceTypeId).map((u) => u.allocatedNetFils);
}

describe("the practice's own list prices", () => {
  it('is the sum of what the parts cost bought one at a time', () => {
    // AED 12,150, 19,975 and 31,300 — the figures on the price list. The
    // consultation is bundled and carries no standalone price, which is why
    // the list price of Silver is exactly two brain maps plus fifteen sessions.
    expect(standaloneTotalFils(SILVER)).toBe(1_215_000);
    expect(standaloneTotalFils(GOLD)).toBe(1_997_500);
    expect(standaloneTotalFils(PLATINUM)).toBe(3_130_000);
  });
});

describe('allocateEntitlements', () => {
  it('splits the Silver launch price across every credit it buys, to the fils', () => {
    const allocation = allocateEntitlements(SILVER, fils(1_032_500));

    expect(allocation).toHaveLength(18);
    expect(total(allocation)).toBe(1_032_500);
    // The bundled consultation carries no share of the price: it was worth
    // nothing standalone, so it refunds nothing unused.
    expect(valuesFor(allocation, CONSULTATION)).toEqual([0]);
    expect(valuesFor(allocation, BRAIN_MAP)).toEqual([70_108, 70_108]);
    // Nine fils are left over by the rounding; they go to the nine credits
    // with the largest discarded fraction, earliest first.
    expect(valuesFor(allocation, NF_SESSION)).toEqual([
      59_486, 59_486, 59_486, 59_486, 59_486, 59_486, 59_486, 59_486, 59_486, 59_485, 59_485,
      59_485, 59_485, 59_485, 59_485,
    ]);
  });

  it('numbers each credit within its own service, so the third of fifteen is nameable', () => {
    const allocation = allocateEntitlements(SILVER, fils(1_032_500));
    const sessions = allocation.filter((u) => u.serviceTypeId === NF_SESSION);
    expect(sessions.map((u) => u.unit)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  it('splits the Gold launch price to the fils', () => {
    const allocation = allocateEntitlements(GOLD, fils(1_697_500));
    expect(allocation).toHaveLength(30);
    expect(total(allocation)).toBe(1_697_500);
    expect(valuesFor(allocation, BRAIN_MAP)).toEqual([70_109, 70_109, 70_109]);
  });

  it('splits the Platinum launch price to the fils, with no remainder to hand out', () => {
    const allocation = allocateEntitlements(PLATINUM, fils(2_660_500));
    expect(allocation).toHaveLength(47);
    expect(total(allocation)).toBe(2_660_500);
    expect(valuesFor(allocation, BRAIN_MAP)).toEqual([70_125, 70_125, 70_125, 70_125]);
    expect(new Set(valuesFor(allocation, NF_SESSION))).toEqual(new Set([59_500]));
  });

  it('sums exactly to the price for every price a package could be sold at', () => {
    // The property, not an example: nothing is lost or invented by rounding,
    // whatever the discount happens to be.
    for (let price = 1_000_000; price <= 1_215_000; price += 1) {
      const allocation = allocateEntitlements(SILVER, fils(price));
      if (total(allocation) !== price) {
        throw new Error(`Allocation of ${price} summed to ${total(allocation)}.`);
      }
    }
    expect(total(allocateEntitlements(SILVER, fils(1_215_000)))).toBe(1_215_000);
  });

  it('gives the same answer every time it is asked', () => {
    const first = allocateEntitlements(SILVER, fils(1_032_500));
    const second = allocateEntitlements(SILVER, fils(1_032_500));
    expect(second).toEqual(first);
  });

  it('allocates a package sold at its full list price without a discount', () => {
    const allocation = allocateEntitlements(SILVER, fils(1_215_000));
    expect(valuesFor(allocation, BRAIN_MAP)).toEqual([82_500, 82_500]);
    expect(new Set(valuesFor(allocation, NF_SESSION))).toEqual(new Set([70_000]));
  });

  it('allocates nothing to anything when the package is given away', () => {
    const allocation = allocateEntitlements(SILVER, fils(0));
    expect(total(allocation)).toBe(0);
    expect(allocation.every((unit) => unit.allocatedNetFils === 0)).toBe(true);
  });

  it('gives every credit nothing when the whole bundle is complimentary', () => {
    const allocation = allocateEntitlements(
      [{ serviceTypeId: CONSULTATION, quantity: 2, standaloneNetFils: fils(0) }],
      fils(0),
    );
    expect(allocation.map((u) => u.allocatedNetFils)).toEqual([0, 0]);
  });

  it('refuses to price a bundle whose parts are all worth nothing standalone', () => {
    expect(() =>
      allocateEntitlements(
        [{ serviceTypeId: CONSULTATION, quantity: 2, standaloneNetFils: fils(0) }],
        fils(100_000),
      ),
    ).toThrow(RangeError);
  });

  it('refuses an empty package, a negative price and a fractional credit', () => {
    expect(() => allocateEntitlements([], fils(1))).toThrow(RangeError);
    expect(() => allocateEntitlements(SILVER, -1 as never)).toThrow(RangeError);
    expect(() =>
      allocateEntitlements(
        [{ serviceTypeId: NF_SESSION, quantity: 0, standaloneNetFils: fils(70_000) }],
        fils(0),
      ),
    ).toThrow(RangeError);
    expect(() =>
      allocateEntitlements(
        [{ serviceTypeId: NF_SESSION, quantity: 1.5, standaloneNetFils: fils(70_000) }],
        fils(70_000),
      ),
    ).toThrow(RangeError);
  });

  it('never loses a fils to a floating-point product, however large the package', () => {
    // 21,474,836.47 AED, the largest an integer fils column holds, split
    // across credits worth a hundred thousand dirhams standalone.
    const big: PackageComponent[] = [
      { serviceTypeId: BRAIN_MAP, quantity: 7, standaloneNetFils: fils(10_000_000) },
      { serviceTypeId: NF_SESSION, quantity: 11, standaloneNetFils: fils(3_333_333) },
    ];
    const allocation = allocateEntitlements(big, fils(2_147_483_647));
    expect(total(allocation)).toBe(2_147_483_647);
  });
});
