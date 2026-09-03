/**
 * What a client is owed when they leave a package part-way through
 * (docs/SPEC/billing.md section 4.3): refund the unused credits at the rate
 * they were allocated at, and reprice what was delivered at the single-visit
 * rate. The client loses the volume discount on what they consumed, which is
 * what a volume discount means.
 *
 *   Paid                                     16,500
 *   Delivered: 6 sessions at the single rate  5,400
 *   Refund due                               11,100
 *
 * **Nothing in this pull request issues a refund.** The wording of the policy
 * is with the practice's lawyer and the tax point on prepaid packages is with
 * its tax adviser (billing.md section 10, decisions 2 and 4). This is the
 * calculator, exposed read-only so a coordinator can quote a figure and a
 * client can be shown it; the route that would actually pay it waits on both
 * answers.
 *
 * Pure: no I/O, no clock (.claude/rules/testing.md).
 */

import { fils, type Fils } from '../shared';

export type DeliveredCount = {
  serviceTypeId: string;
  /** How many credits of this service were used up. */
  count: number;
};

export type SingleRate = {
  serviceTypeId: string;
  /** What one costs bought on its own today, net of VAT. */
  netFils: Fils;
};

export type RefundLine = {
  serviceTypeId: string;
  count: number;
  singleRateNetFils: Fils;
  chargeNetFils: Fils;
};

export type RefundQuote = {
  paidNetFils: Fils;
  /** What the delivered visits come to at the single-visit rate. */
  deliveredChargeNetFils: Fils;
  /** Never below zero: a client who consumed more than they paid for is not billed by this. */
  refundNetFils: Fils;
  lines: RefundLine[];
};

/**
 * The figure, given what was paid for the package net of VAT and what was
 * delivered from it. `delivered` counts every credit the client used up,
 * including any taken by a late cancellation that was not waived: those were
 * consumed under the practice's own stated policy, so they are repriced like
 * a delivered visit rather than refunded.
 *
 * Throws when a delivered service has no single-visit rate to be repriced
 * at — there is no defensible number in that case, and guessing one would be
 * the practice quietly deciding a refund in its own favour.
 */
export function refundOnTermination(input: {
  paidNetFils: Fils;
  delivered: readonly DeliveredCount[];
  singleRates: readonly SingleRate[];
}): RefundQuote {
  if (input.paidNetFils < 0) {
    throw new RangeError('A package price cannot be negative.');
  }
  const rates = new Map(input.singleRates.map((rate) => [rate.serviceTypeId, rate.netFils]));
  const lines: RefundLine[] = [];
  let deliveredCharge = 0;

  for (const delivered of input.delivered) {
    if (!Number.isSafeInteger(delivered.count) || delivered.count < 0) {
      throw new RangeError(
        `A delivered count must be a whole number, received ${delivered.count}.`,
      );
    }
    if (delivered.count === 0) {
      continue;
    }
    const rate = rates.get(delivered.serviceTypeId);
    if (rate === undefined) {
      throw new RangeError(
        `No single-visit rate for service ${delivered.serviceTypeId}; a refund cannot be quoted.`,
      );
    }
    const charge = delivered.count * rate;
    deliveredCharge += charge;
    lines.push({
      serviceTypeId: delivered.serviceTypeId,
      count: delivered.count,
      singleRateNetFils: rate,
      chargeNetFils: fils(charge),
    });
  }

  return {
    paidNetFils: input.paidNetFils,
    deliveredChargeNetFils: fils(deliveredCharge),
    refundNetFils: fils(Math.max(0, input.paidNetFils - deliveredCharge)),
    lines,
  };
}
