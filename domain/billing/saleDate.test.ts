import { describe, expect, it } from 'vitest';
import { earliestSaleOn, unsellableReason } from './saleDate';

/**
 * Why a package could not be sold on the day a sale was dated.
 *
 * The sale route reads the catalogue as it stood on the "Bought on" date. A
 * sale dated before any price had started was refused with the words for a
 * package missing a price — when every price was there, only later than the
 * date chosen. These two functions tell the cases apart, so the drawer can
 * say which date would work.
 */

describe('earliestSaleOn', () => {
  it('is the latest of the first package price and each service’s first price', () => {
    expect(
      earliestSaleOn({
        packagePriceFrom: '2026-09-15',
        componentPriceFroms: ['2026-09-07', '2026-09-07', '2026-09-07'],
      }),
    ).toBe('2026-09-15');
    expect(
      earliestSaleOn({
        packagePriceFrom: '2026-09-02',
        componentPriceFroms: ['2026-09-07', '2026-09-20'],
      }),
    ).toBe('2026-09-20');
  });

  it('is null while the package has never had a price', () => {
    expect(
      earliestSaleOn({ packagePriceFrom: null, componentPriceFroms: ['2026-09-07'] }),
    ).toBeNull();
  });

  it('is null while any service in it has never had a price', () => {
    expect(
      earliestSaleOn({ packagePriceFrom: '2026-09-15', componentPriceFroms: ['2026-09-07', null] }),
    ).toBeNull();
  });

  it('is null for a package with nothing in it', () => {
    expect(earliestSaleOn({ packagePriceFrom: '2026-09-15', componentPriceFroms: [] })).toBeNull();
  });
});

describe('unsellableReason', () => {
  const TODAY = '2026-10-06';

  it('names the earliest date when every price exists but starts after the sale', () => {
    expect(unsellableReason('2026-08-18', '2026-09-15', TODAY)).toEqual({
      code: 'no_price_on_date',
      earliestOn: '2026-09-15',
    });
  });

  it('is a missing price when something has never been priced', () => {
    expect(unsellableReason('2026-08-18', null, TODAY)).toEqual({ code: 'not_sellable' });
  });

  it('is a missing price when the first prices have not started even today', () => {
    // No date the sale could be moved to is allowed: a sale cannot be
    // dated in the future.
    expect(unsellableReason('2026-08-18', '2026-10-07', TODAY)).toEqual({ code: 'not_sellable' });
  });

  it('is not about the date when the date was already late enough', () => {
    // Prices were in force, so what stopped the sale was something else —
    // a withdrawn package, say — and the date is not the answer.
    expect(unsellableReason('2026-09-20', '2026-09-15', TODAY)).toEqual({ code: 'not_sellable' });
    expect(unsellableReason('2026-09-15', '2026-09-15', TODAY)).toEqual({ code: 'not_sellable' });
  });
});
