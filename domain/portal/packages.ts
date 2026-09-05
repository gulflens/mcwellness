/**
 * "Session 6 of 15" — how far through a prepaid programme a household is
 * (docs/SPEC/client-portal.md sections 3.1, 3.3 and 5, rule 8).
 *
 * The figure is counted from the credits the purchase allocated, never stored:
 * one entitlement row per session, and the ones that have been used up are the
 * numerator. A credit that was refunded or waived is out of the sum entirely —
 * it is no longer a session the household holds, so counting it would make the
 * total say the practice owes more than it does. A credit that has run out of
 * time is still in the total, because until the practice writes it off it is a
 * promise it made (the same reading `domain/billing`'s `balanceFor` takes).
 *
 * Pure: rows in, two integers out.
 */

/** What the count needs of one credit. */
export type ProgressEntitlement = {
  packagePurchaseId: string | null;
  status: 'available' | 'consumed' | 'expired' | 'refunded' | 'waived';
};

export type ProgressPurchase = { id: string };

export type PackageProgress = {
  /** Sessions already used up: delivered, or taken by a late cancellation or a no-show. */
  used: number;
  /** Sessions the household still holds, used and unused together. */
  total: number;
};

export function packageProgress(
  purchase: ProgressPurchase,
  entitlements: readonly ProgressEntitlement[],
): PackageProgress {
  const mine = entitlements.filter(
    (entitlement) =>
      entitlement.packagePurchaseId === purchase.id &&
      entitlement.status !== 'refunded' &&
      entitlement.status !== 'waived',
  );
  return {
    used: mine.filter((entitlement) => entitlement.status === 'consumed').length,
    total: mine.length,
  };
}
