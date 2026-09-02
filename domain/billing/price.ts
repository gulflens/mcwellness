/**
 * The price list is strictly append-only (the operator's ruling on this
 * worktree's first pull request): a new price is never an edit and never
 * closes an old row, it only supersedes it from its own `validFrom`. The
 * price in force on a date is the row with the latest `validFrom` on or
 * before that date — there is nothing else to look at. Pure: no I/O, no
 * clock read inside (.claude/rules/testing.md); "today" is always an
 * argument.
 */

import type { Fils, IsoDate } from '../shared';

export type Price = {
  id: string;
  serviceTypeId: string;
  unitPriceFils: Fils;
  validFrom: IsoDate;
};

/**
 * The price in force for `serviceTypeId` on `on`: among the rows for that
 * service, the one with the greatest `validFrom` that is not after `on`.
 * `validFrom` is inclusive — a price counts from its own day. `null` when
 * the service has never had a price, or none has started yet.
 */
export function currentPriceFor(
  prices: readonly Price[],
  serviceTypeId: string,
  on: IsoDate,
): Price | null {
  let current: Price | null = null;
  for (const price of prices) {
    if (price.serviceTypeId !== serviceTypeId || price.validFrom > on) {
      continue;
    }
    if (current === null || price.validFrom > current.validFrom) {
      current = price;
    }
  }
  return current;
}

export type NewPriceApproval = { ok: true };
export type NewPriceRefusal = { ok: false; reason: string };

/**
 * Whether a new price may be recorded. Refused when it would backdate a
 * price that a client may already have been shown or charged: it must take
 * effect today or later, and strictly after the price it supersedes (append-only
 * means a later row, never a row squeezed in before or on top of an earlier one).
 */
export function validateNewPrice(
  currentPrice: Price | null,
  input: { validFrom: IsoDate },
  today: IsoDate,
): NewPriceApproval | NewPriceRefusal {
  if (input.validFrom < today) {
    return { ok: false, reason: 'A new price cannot take effect before today.' };
  }
  if (currentPrice !== null && input.validFrom <= currentPrice.validFrom) {
    return {
      ok: false,
      reason: 'A new price must take effect after the price it supersedes.',
    };
  }
  return { ok: true };
}
