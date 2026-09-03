import { describe, expect, it } from 'vitest';
import { fils } from '../shared';
import { refundOnTermination } from './refund';

/**
 * The specification for a refund on early termination (docs/SPEC/billing.md
 * section 4.3). Nothing in this pull request issues one: the policy wording
 * is with the practice's lawyer and the tax point with its tax adviser. This
 * is the figure a coordinator may quote and a client may be shown.
 */

const NF = 'nf-session';
const MAP = 'brain-map';
const SINGLE_RATES = [
  { serviceTypeId: NF, netFils: fils(70_000) },
  { serviceTypeId: MAP, netFils: fils(82_500) },
];

describe('refundOnTermination', () => {
  it("works the specification's own example: six of twenty delivered", () => {
    const quote = refundOnTermination({
      paidNetFils: fils(1_650_000),
      delivered: [{ serviceTypeId: NF, count: 6 }],
      singleRates: [{ serviceTypeId: NF, netFils: fils(90_000) }],
    });
    expect(quote.deliveredChargeNetFils).toBe(540_000);
    expect(quote.refundNetFils).toBe(1_110_000);
  });

  it("reprices a Silver package's delivered visits at the practice's single rates", () => {
    // Silver at the launch price, four sessions and one brain map delivered.
    const quote = refundOnTermination({
      paidNetFils: fils(1_032_500),
      delivered: [
        { serviceTypeId: NF, count: 4 },
        { serviceTypeId: MAP, count: 1 },
      ],
      singleRates: SINGLE_RATES,
    });
    expect(quote.deliveredChargeNetFils).toBe(4 * 70_000 + 82_500);
    expect(quote.refundNetFils).toBe(1_032_500 - 362_500);
    expect(quote.lines).toEqual([
      { serviceTypeId: NF, count: 4, singleRateNetFils: 70_000, chargeNetFils: 280_000 },
      { serviceTypeId: MAP, count: 1, singleRateNetFils: 82_500, chargeNetFils: 82_500 },
    ]);
  });

  it('refunds the whole price when nothing was delivered', () => {
    const quote = refundOnTermination({
      paidNetFils: fils(1_032_500),
      delivered: [],
      singleRates: SINGLE_RATES,
    });
    expect(quote.refundNetFils).toBe(1_032_500);
    expect(quote.lines).toEqual([]);
  });

  it('refunds nothing once the delivered visits are worth more than was paid', () => {
    const quote = refundOnTermination({
      paidNetFils: fils(1_032_500),
      delivered: [{ serviceTypeId: NF, count: 15 }],
      singleRates: SINGLE_RATES,
    });
    expect(quote.deliveredChargeNetFils).toBe(1_050_000);
    // Never a negative refund: this calculator does not invoice a leaver.
    expect(quote.refundNetFils).toBe(0);
  });

  it('ignores a service with nothing delivered rather than listing it at zero', () => {
    const quote = refundOnTermination({
      paidNetFils: fils(1_032_500),
      delivered: [
        { serviceTypeId: NF, count: 2 },
        { serviceTypeId: MAP, count: 0 },
      ],
      singleRates: SINGLE_RATES,
    });
    expect(quote.lines.map((line) => line.serviceTypeId)).toEqual([NF]);
  });

  it('refuses to quote when a delivered service has no single-visit rate', () => {
    expect(() =>
      refundOnTermination({
        paidNetFils: fils(1_032_500),
        delivered: [{ serviceTypeId: MAP, count: 1 }],
        singleRates: [{ serviceTypeId: NF, netFils: fils(70_000) }],
      }),
    ).toThrow(RangeError);
  });

  it('refuses a negative price and a fractional count', () => {
    expect(() =>
      refundOnTermination({ paidNetFils: -1 as never, delivered: [], singleRates: [] }),
    ).toThrow(RangeError);
    expect(() =>
      refundOnTermination({
        paidNetFils: fils(1_000),
        delivered: [{ serviceTypeId: NF, count: 1.5 }],
        singleRates: SINGLE_RATES,
      }),
    ).toThrow(RangeError);
  });
});
