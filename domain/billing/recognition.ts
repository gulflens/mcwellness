/**
 * The three figures a solo operator has to see next to each other, from
 * docs/SPEC/billing.md section 4.1: cash collected, revenue recognised, and the
 * deferred balance.
 *
 * They exist because a good cash month and a good trading month are different
 * months, and a practice that sells prepaid programmes can be told the first
 * and never the second. Ten packages sold in a launch month is a great deal of
 * money in the bank and roughly six months of work owed; the deferred balance is
 * that obligation, and it is the number to watch the way one watches a debt.
 *
 * Every figure is derived from the entitlement ledger and the payments, and
 * none is stored (billing.md section 1). Pure: fils in, fils out, and the month
 * is always an argument (.claude/rules/testing.md).
 */

import { addFils, fils, type Fils, type IsoDate } from '../shared';
import type { EntitlementStatus } from './balance';

/** A payment, reduced to what these figures need. */
export type CollectedPayment = {
  amountFils: Fils;
  /** The day it arrived, in the practice's own time zone. */
  receivedOn: IsoDate;
};

/** A credit, reduced to what these figures need. */
export type LedgerCredit = {
  status: EntitlementStatus;
  /** Its share of what was paid (docs/SPEC/billing.md section 4.2). */
  allocatedNetFils: Fils;
  /** The day it was used up; null while it is still owed. */
  consumedOn: IsoDate | null;
};

export type MonthlyMoney = {
  /** YYYY-MM, echoed back so a screen never has to work out what it asked for. */
  month: string;
  /** What came in: every payment received in the month, whatever it was for. */
  cashCollectedFils: Fils;
  /**
   * What was earned: the allocated value of every credit used up in the month.
   * A visit delivered discharges the obligation behind its credit, and that is
   * the moment revenue is recognised — not the moment the money arrived.
   */
  revenueRecognisedFils: Fils;
  /**
   * What is still owed in sessions **as things stand**: the allocated value of
   * every credit not yet used up. A contract liability, not income.
   *
   * A position, not a period — which is why it does not move with `month`. It
   * answers "what does the practice owe now", and asking about January gives
   * the same figure as asking about June, because the credits outstanding are
   * the credits outstanding. Reading it as "deferred at the end of that month"
   * would be wrong, and the comment used to say exactly that.
   *
   * A credit past its expiry date is still counted here, and deliberately:
   * until the practice writes one off it is a promise it has made, and a
   * figure that quietly dropped lapsed credits would show the practice owing
   * less than it does.
   */
  deferredNetFils: Fils;
};

/** Whether a day falls inside a YYYY-MM month. */
function inMonth(day: IsoDate, month: string): boolean {
  return day.startsWith(`${month}-`);
}

/**
 * The three figures for one month.
 *
 * `month` is YYYY-MM. Payments and credits are the practice's whole ledger:
 * filtering is this function's, so the caller cannot narrow the deferred
 * balance by accident — it is a position at a moment, not a total for a period,
 * and asking the database for "this month's credits" would silently answer a
 * different question.
 */
export function monthlyMoney(
  payments: readonly CollectedPayment[],
  credits: readonly LedgerCredit[],
  month: string,
): MonthlyMoney {
  let cash = fils(0);
  for (const payment of payments) {
    if (inMonth(payment.receivedOn, month)) {
      cash = addFils(cash, payment.amountFils);
    }
  }

  let recognised = fils(0);
  let deferred = fils(0);
  for (const credit of credits) {
    // Refunded and waived credits are neither earned nor owed: the money went
    // back, or the practice forgave the charge. Counting either would be
    // counting something nobody has.
    if (credit.status === 'refunded' || credit.status === 'waived') {
      continue;
    }
    if (credit.status === 'consumed') {
      if (credit.consumedOn !== null && inMonth(credit.consumedOn, month)) {
        recognised = addFils(recognised, credit.allocatedNetFils);
      }
      continue;
    }
    deferred = addFils(deferred, credit.allocatedNetFils);
  }

  return {
    month,
    cashCollectedFils: cash,
    revenueRecognisedFils: recognised,
    deferredNetFils: deferred,
  };
}
