import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import { applyDiscount, combineDiscounts } from './discount';

/**
 * The specification for a discount (docs/SPEC/billing.md section 2.4, the
 * operator's decision of 7 September 2026). The figures below are the
 * practice's own launch catalogue — a neurofeedback session at AED 700 net
 * and Silver at a list of AED 12,150 — so a change to the arithmetic shows up
 * here as a change to a number a family was quoted, with a reason.
 */

describe('applyDiscount', () => {
  it('takes a percentage of the list figure and leaves the rest as the net', () => {
    expect(applyDiscount(fils(70_000), { kind: 'percent', basisPoints: 1500 })).toEqual({
      listFils: 70_000,
      discountFils: 10_500,
      netFils: 59_500,
      basisPoints: 1500,
    });
  });

  it('takes a percentage of a package list price to the fils', () => {
    expect(applyDiscount(fils(1_215_000), { kind: 'percent', basisPoints: 1500 })).toEqual({
      listFils: 1_215_000,
      discountFils: 182_250,
      netFils: 1_032_750,
      basisPoints: 1500,
    });
  });

  it('rounds a percentage half up to the fils, as VAT does', () => {
    // Half a fils rounds away from the practice, towards the family.
    expect(applyDiscount(fils(1), { kind: 'percent', basisPoints: 5000 }).discountFils).toBe(1);
    // 0.9999 of a fils is a fils; nothing is ever divided as a float.
    expect(applyDiscount(fils(3), { kind: 'percent', basisPoints: 3333 }).discountFils).toBe(1);
    expect(applyDiscount(fils(1), { kind: 'percent', basisPoints: 4999 }).discountFils).toBe(0);
  });

  it('takes a sum of money off the list figure and keeps no percentage', () => {
    expect(applyDiscount(fils(70_000), { kind: 'amount', fils: fils(5_000) })).toEqual({
      listFils: 70_000,
      discountFils: 5_000,
      netFils: 65_000,
      basisPoints: null,
    });
  });

  it('charges the list figure when there is no discount', () => {
    expect(applyDiscount(fils(70_000), null)).toEqual({
      listFils: 70_000,
      discountFils: 0,
      netFils: 70_000,
      basisPoints: null,
    });
  });

  it('refuses a negative list, a percentage outside nought to a hundred, and a sum above the list', () => {
    expect(() => applyDiscount(fils(-1), null)).toThrow(RangeError);
    expect(() => applyDiscount(fils(70_000), { kind: 'percent', basisPoints: -1 })).toThrow(
      RangeError,
    );
    expect(() => applyDiscount(fils(70_000), { kind: 'percent', basisPoints: 10_001 })).toThrow(
      RangeError,
    );
    expect(() => applyDiscount(fils(70_000), { kind: 'percent', basisPoints: 12.5 })).toThrow(
      RangeError,
    );
    expect(() =>
      applyDiscount(fils(70_000), { kind: 'amount', fils: -1 as ReturnType<typeof fils> }),
    ).toThrow(RangeError);
    expect(() =>
      applyDiscount(fils(70_000), { kind: 'amount', fils: 1.5 as ReturnType<typeof fils> }),
    ).toThrow(RangeError);
    expect(() => applyDiscount(fils(70_000), { kind: 'amount', fils: fils(70_001) })).toThrow(
      RangeError,
    );
  });
});

describe('combineDiscounts', () => {
  it('adds two percentages into one applied once to the list figure', () => {
    // Fifteen per cent then five is exactly twenty per cent of the list, never
    // two roundings and never five per cent of an already discounted figure.
    expect(
      combineDiscounts(
        fils(1_215_000),
        { discountFils: fils(182_250), basisPoints: 1500 },
        { kind: 'percent', basisPoints: 500 },
      ),
    ).toEqual({
      listFils: 1_215_000,
      discountFils: 243_000,
      netFils: 972_000,
      basisPoints: 2000,
    });
  });

  it('adds a percentage to a standing sum and keeps no percentage', () => {
    expect(
      combineDiscounts(
        fils(1_215_000),
        { discountFils: fils(182_500), basisPoints: null },
        { kind: 'percent', basisPoints: 500 },
      ),
    ).toEqual({
      listFils: 1_215_000,
      discountFils: 243_250,
      netFils: 971_750,
      basisPoints: null,
    });
  });

  it('adds a sum to a standing percentage and keeps no percentage', () => {
    expect(
      combineDiscounts(
        fils(1_215_000),
        { discountFils: fils(182_250), basisPoints: 1500 },
        { kind: 'amount', fils: fils(50_000) },
      ),
    ).toEqual({
      listFils: 1_215_000,
      discountFils: 232_250,
      netFils: 982_750,
      basisPoints: null,
    });
  });

  it('leaves the standing discount and its percentage alone when no extra is given', () => {
    expect(
      combineDiscounts(fils(1_215_000), { discountFils: fils(182_250), basisPoints: 1500 }, null),
    ).toEqual({
      listFils: 1_215_000,
      discountFils: 182_250,
      netFils: 1_032_750,
      basisPoints: 1500,
    });
  });

  it('refuses a combined discount larger than the list figure, and a standing one out of range', () => {
    expect(() =>
      combineDiscounts(
        fils(70_000),
        { discountFils: fils(60_000), basisPoints: null },
        { kind: 'amount', fils: fils(10_001) },
      ),
    ).toThrow(RangeError);
    expect(() =>
      combineDiscounts(
        fils(70_000),
        { discountFils: fils(35_000), basisPoints: 5000 },
        { kind: 'percent', basisPoints: 5001 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      combineDiscounts(
        fils(70_000),
        { discountFils: -1 as ReturnType<typeof fils>, basisPoints: null },
        null,
      ),
    ).toThrow(RangeError);
    expect(() =>
      combineDiscounts(fils(70_000), { discountFils: fils(70_001), basisPoints: null }, null),
    ).toThrow(RangeError);
  });
});
