/**
 * Why a package could not be sold on the day its sale was dated.
 *
 * A sale takes the catalogue as it stood on its own "Bought on" date: the
 * package price and every service's standalone price in force then. Price
 * lists are append-only and a price counts from its own `validFrom` onward
 * (price.ts), so once a package and each of its services has *some* price,
 * every later day has one too. The first day a sale can be dated is therefore
 * the latest of their first `validFrom`s — and a sale dated before it was
 * refused for its date, not for a missing price. Telling the two apart is what
 * lets the drawer say which date would work instead of sending the person to
 * look for a price that is already there.
 *
 * Pure: "today" is an argument (.claude/rules/testing.md).
 */

import type { IsoDate } from '../shared';

/**
 * The first day every price the sale needs is in force: the latest of the
 * package price's first `validFrom` and each service's first `validFrom`.
 * `null` when the package or any service in it has never been priced, or when
 * there is nothing in it — no date would make that sellable.
 */
export function earliestSaleOn(input: {
  packagePriceFrom: IsoDate | null;
  componentPriceFroms: readonly (IsoDate | null)[];
}): IsoDate | null {
  if (input.packagePriceFrom === null || input.componentPriceFroms.length === 0) {
    return null;
  }
  let earliest = input.packagePriceFrom;
  for (const from of input.componentPriceFroms) {
    if (from === null) return null;
    if (from > earliest) earliest = from;
  }
  return earliest;
}

export type UnsellableReason =
  { code: 'no_price_on_date'; earliestOn: IsoDate } | { code: 'not_sellable' };

/**
 * The refusal for a package the catalogue would not sell on `purchasedOn`.
 * The date is the reason only when a later date — one no later than today,
 * since a sale cannot be dated in the future — would have been sold;
 * otherwise something is genuinely missing (a price, a service, an active
 * status) and the date is not the answer.
 */
export function unsellableReason(
  purchasedOn: IsoDate,
  earliestOn: IsoDate | null,
  today: IsoDate,
): UnsellableReason {
  if (earliestOn !== null && purchasedOn < earliestOn && earliestOn <= today) {
    return { code: 'no_price_on_date', earliestOn };
  }
  return { code: 'not_sellable' };
}
