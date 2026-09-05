import { describe, expect, it } from 'vitest';
import { packageProgress, type ProgressEntitlement } from './packages';

/** docs/SPEC/client-portal.md section 5, rule 8. */

const PURCHASE = { id: 'purchase-1' };

function credits(
  statuses: readonly ProgressEntitlement['status'][],
  packagePurchaseId: string | null = PURCHASE.id,
): ProgressEntitlement[] {
  return statuses.map((status) => ({ packagePurchaseId, status }));
}

describe('packageProgress', () => {
  it('counts what has been used against what the household holds', () => {
    expect(
      packageProgress(PURCHASE, credits(['consumed', 'consumed', 'available', 'available'])),
    ).toEqual({ used: 2, total: 4 });
  });

  it('leaves a refunded or waived credit out of both figures', () => {
    expect(
      packageProgress(PURCHASE, credits(['consumed', 'available', 'refunded', 'waived'])),
    ).toEqual({ used: 1, total: 2 });
  });

  it('keeps a credit that has run out of time in the total', () => {
    expect(packageProgress(PURCHASE, credits(['consumed', 'expired']))).toEqual({
      used: 1,
      total: 2,
    });
  });

  it('counts only this purchase', () => {
    const mixed = [...credits(['consumed']), ...credits(['consumed', 'available'], 'purchase-2')];
    expect(packageProgress(PURCHASE, mixed)).toEqual({ used: 1, total: 1 });
  });

  it('answers nothing for a purchase with no credits left against it', () => {
    expect(packageProgress(PURCHASE, credits([], null))).toEqual({ used: 0, total: 0 });
  });
});
