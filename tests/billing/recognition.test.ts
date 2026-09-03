import { describe, expect, it } from 'vitest';
import { monthlyMoney, type CollectedPayment, type LedgerCredit } from '../../domain/billing';
import { fils } from '../../domain/shared';

/**
 * Cash collected, revenue recognised, and the deferred balance
 * (docs/SPEC/billing.md section 4.1).
 *
 * The figures the spec puts side by side, in the spec's own worked example: a
 * programme sold in one month and delivered over several. The point of the
 * three is that the first and the second are different numbers, and that the
 * third is what the practice owes.
 */

const SILVER_ALLOCATION = 68_833; // one session's share of a Silver programme

function credits(count: number, consumedOn: string | null): LedgerCredit[] {
  return Array.from({ length: count }, () => ({
    status: consumedOn === null ? ('available' as const) : ('consumed' as const),
    allocatedNetFils: fils(SILVER_ALLOCATION),
    consumedOn,
  }));
}

describe('the month a programme is sold', () => {
  const payments: CollectedPayment[] = [{ amountFils: fils(1_032_500), receivedOn: '2026-09-02' }];
  const ledger: LedgerCredit[] = [...credits(1, '2026-09-04'), ...credits(14, null)];

  it('shows the cash in full', () => {
    expect(monthlyMoney(payments, ledger, '2026-09').cashCollectedFils).toBe(1_032_500);
  });

  it('recognises only what was delivered', () => {
    // One visit out of fifteen. The other fourteen are work owed, not income.
    expect(monthlyMoney(payments, ledger, '2026-09').revenueRecognisedFils).toBe(68_833);
  });

  it('carries the rest as owed in sessions', () => {
    expect(monthlyMoney(payments, ledger, '2026-09').deferredNetFils).toBe(14 * 68_833);
  });
});

describe('a later month', () => {
  const payments: CollectedPayment[] = [{ amountFils: fils(1_032_500), receivedOn: '2026-09-02' }];
  const ledger: LedgerCredit[] = [
    ...credits(1, '2026-09-04'),
    ...credits(3, '2026-10-06'),
    ...credits(11, null),
  ];

  it('shows no cash, because none came in', () => {
    expect(monthlyMoney(payments, ledger, '2026-10').cashCollectedFils).toBe(0);
  });

  it('recognises the visits delivered in it', () => {
    expect(monthlyMoney(payments, ledger, '2026-10').revenueRecognisedFils).toBe(3 * 68_833);
  });

  it('shows a deferred balance that has come down', () => {
    // A position at a moment, not a total for a period: the same eleven credits
    // are owed whichever month is asked about.
    expect(monthlyMoney(payments, ledger, '2026-10').deferredNetFils).toBe(11 * 68_833);
    expect(monthlyMoney(payments, ledger, '2026-09').deferredNetFils).toBe(11 * 68_833);
  });
});

describe('the figures reconcile to the ledger', () => {
  it('accounts for every credit as either earned or owed', () => {
    const ledger: LedgerCredit[] = [
      ...credits(4, '2026-09-04'),
      ...credits(2, '2026-10-06'),
      ...credits(9, null),
    ];
    const september = monthlyMoney([], ledger, '2026-09');
    const october = monthlyMoney([], ledger, '2026-10');
    const allocated = ledger.reduce((total, credit) => total + credit.allocatedNetFils, 0);

    // Everything the practice was paid for is either recognised in some month
    // or still owed. Nothing falls between the two.
    expect(september.revenueRecognisedFils + october.revenueRecognisedFils).toBe(6 * 68_833);
    expect(
      september.revenueRecognisedFils + october.revenueRecognisedFils + october.deferredNetFils,
    ).toBe(allocated);
  });

  it('counts a credit that has run out of time as still owed', () => {
    // Until the practice writes one off it is a promise it made, and a figure
    // that quietly dropped it would show the practice owing less than it does.
    const ledger: LedgerCredit[] = [
      { status: 'expired', allocatedNetFils: fils(68_833), consumedOn: null },
    ];
    expect(monthlyMoney([], ledger, '2026-09').deferredNetFils).toBe(68_833);
  });

  it('counts a refunded or waived credit as neither', () => {
    // The money went back, or the charge was forgiven. Counting either would be
    // counting something nobody has.
    const ledger: LedgerCredit[] = [
      { status: 'refunded', allocatedNetFils: fils(68_833), consumedOn: null },
      { status: 'waived', allocatedNetFils: fils(68_833), consumedOn: '2026-09-04' },
    ];
    const figures = monthlyMoney([], ledger, '2026-09');
    expect(figures.revenueRecognisedFils).toBe(0);
    expect(figures.deferredNetFils).toBe(0);
  });

  it('counts a payment on the last day of the month, and not the first of the next', () => {
    const payments: CollectedPayment[] = [
      { amountFils: fils(70_000), receivedOn: '2026-09-30' },
      { amountFils: fils(82_500), receivedOn: '2026-10-01' },
    ];
    expect(monthlyMoney(payments, [], '2026-09').cashCollectedFils).toBe(70_000);
    expect(monthlyMoney(payments, [], '2026-10').cashCollectedFils).toBe(82_500);
  });

  it('answers zero for a month nothing happened in, rather than nothing at all', () => {
    const figures = monthlyMoney([], [], '2026-01');
    expect(figures).toEqual({
      month: '2026-01',
      cashCollectedFils: 0,
      revenueRecognisedFils: 0,
      deferredNetFils: 0,
    });
  });
});
