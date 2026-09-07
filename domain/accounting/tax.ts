import { fils, type Fils } from '../shared';
import type { BooksSetting } from './types';

/**
 * The corporate-tax set-aside and the relief watch (docs/SPEC/accounting.md
 * section 4.5, rules 15 and 16). An **estimate**, and labelled so on every
 * screen: the platform files nothing and the adviser decides the election.
 */

type TaxSetting = Pick<
  BooksSetting,
  | 'corporateTaxRateBasisPoints'
  | 'corporateTaxThresholdFils'
  | 'smallBusinessReliefElected'
  | 'smallBusinessReliefThresholdFils'
>;

/**
 * Rule 15: zero while Small Business Relief is elected and the year's revenue
 * is at or below its threshold; otherwise the year-to-date result above the
 * taxable threshold at the rate, rounded down and never below zero.
 */
export function corporateTaxEstimate(
  resultYtdFils: Fils,
  revenueYtdFils: Fils,
  setting: TaxSetting,
): Fils {
  if (
    setting.smallBusinessReliefElected &&
    revenueYtdFils <= setting.smallBusinessReliefThresholdFils
  ) {
    return fils(0);
  }
  const taxable = resultYtdFils - setting.corporateTaxThresholdFils;
  if (taxable <= 0) {
    return fils(0);
  }
  return fils(Math.floor((taxable * setting.corporateTaxRateBasisPoints) / 10_000));
}

export type ReliefWatch = 'clear' | 'approaching' | 'exceeded';

/** Rule 16: calm below 80 percent, a warning from 80 percent, and gone past the line. */
export function reliefWatch(revenueYtdFils: Fils, thresholdFils: Fils): ReliefWatch {
  if (revenueYtdFils > thresholdFils) {
    return 'exceeded';
  }
  return revenueYtdFils * 10 >= thresholdFils * 8 ? 'approaching' : 'clear';
}
