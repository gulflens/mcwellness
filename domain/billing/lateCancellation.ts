/**
 * The notice period, and what a visit called off inside it costs
 * (docs/SPEC/billing.md section 4.3).
 *
 * **The founder's decision of 2026-09-04: one fee, never a session.** Moving or
 * cancelling more than twenty-four hours ahead is free; inside that period a
 * call-out fee applies; a visit that cannot go ahead once the practitioner has
 * arrived carries the same fee; and **a package's sessions are never taken for
 * a cancellation**. Until this file said so, they were: `CHARGING_OUTCOMES`
 * named `cancelled_late` and `no_show`, and 404_billing_consumption.sql took a
 * credit for each. It is empty now, and stays a list of the outcomes that
 * charge rather than becoming a list of the ones that do not, so a status added
 * to `appointment_status` later costs a family nothing until somebody names it
 * here on purpose.
 *
 * The rule is here rather than in the scheduler because it is a money rule: the
 * scheduler decides that a visit is cancelled, this decides what the family
 * pays for it. `isLateCancellation` is what the cancel flow asks before
 * choosing between `cancelled` and `cancelled_late`; `callOutFeeFor` is what
 * the ledger acts on once that status is written
 * (408_billing_call_out_fee.sql, which is the same rule in SQL because the
 * trigger has no application above it).
 *
 * Pure: no I/O, and the moment of cancellation is always an argument
 * (.claude/rules/testing.md).
 */

import { fils, type Fils } from '../shared';

/** Twenty-four hours, the founder's decision of 2026-09-03. A setting, not a law. */
export const LATE_CANCELLATION_NOTICE_HOURS = 24;

const MS_PER_HOUR = 3_600_000;

/**
 * True when a visit is called off with less than the notice period to go.
 * Exactly the notice period is not late: a client who cancels twenty-four
 * hours to the minute has given the notice the practice asked for. A
 * cancellation after the visit was due to start is late too.
 */
export function isLateCancellation(
  windowStart: Date,
  cancelledAt: Date,
  noticeHours: number = LATE_CANCELLATION_NOTICE_HOURS,
): boolean {
  if (!Number.isFinite(noticeHours) || noticeHours < 0) {
    throw new RangeError(`A notice period must be a non-negative number of hours.`);
  }
  const hoursOfNotice = (windowStart.getTime() - cancelledAt.getTime()) / MS_PER_HOUR;
  return hoursOfNotice < noticeHours;
}

/**
 * The appointment outcomes that take a credit: none, since the founder's
 * decision of 2026-09-04.
 *
 * Empty rather than deleted, and deliberately. The shape is the guarantee — a
 * list of what charges, never a list of what does not — and an empty list of
 * things that take a session is the whole of the founder's rule said in the
 * one place the ledger reads. Deleting the constant would leave nothing to
 * read, and the next person to want a session taken would have to invent the
 * discipline again.
 */
export const CHARGING_OUTCOMES = [] as const;
export type ChargingOutcome = (typeof CHARGING_OUTCOMES)[number];

/** Whether an appointment outcome takes one of the client's sessions. Never. */
export function consumesEntitlement(status: string): status is ChargingOutcome {
  return (CHARGING_OUTCOMES as readonly string[]).includes(status);
}

/**
 * The outcomes that carry the call-out fee instead.
 *
 * - `cancelled_late` — called off inside the practice's notice period. Which
 *   visits reach this status, and why `unfit_to_attend` always does however
 *   much notice the calendar shows, is `domain/scheduling/cancellation.ts`.
 * - `no_show` — the practitioner arrived and nobody was there.
 *
 * Both are the same event from the practice's side: a journey made and no
 * session delivered. Charging them differently would be charging for the
 * household's manners rather than for the practice's day. **That reading of
 * `no_show` is Claude's default of 2026-09-06, not the founder's decision**;
 * it is recorded in docs/CHANGE-REQUESTS/billing-05.md, and taking a session
 * for a no-show again is one line here.
 */
export const CALL_OUT_FEE_OUTCOMES = ['cancelled_late', 'no_show'] as const;

/**
 * The cancellation reasons that carry no fee even when the visit was called
 * off inside the notice period.
 *
 * - `practice_request` — the practice called it off. It still writes
 *   `cancelled_late` for the record, because who was at fault belongs in the
 *   reason rather than in the status (`domain/scheduling/cancellation.ts`), but
 *   a practice does not bill a family for its own change of plan.
 * - `consent_withdrawn` — a person exercising a right, which never becomes
 *   `cancelled_late` in the first place. Named here as well, so the answer does
 *   not depend on a rule in another stream staying as it is.
 */
export const FEE_EXEMPT_REASONS = ['practice_request', 'consent_withdrawn'] as const;

/** As much of the practice's cancellation policy as the fee rule needs. */
export type CallOutFeeSetting = {
  /**
   * `scheduling_setting.unfit_fee_fils` — AED 150 by the operator's decision of
   * 2026-09-03. The column keeps the name it was born with, when the fee paid
   * only for a visit that could not go ahead at the door; what it pays for
   * widened on 2026-09-04 and the words widened with it.
   */
  callOutFeeFils: Fils;
};

/**
 * What a household is charged for a visit that did not happen: the practice's
 * call-out fee, or nothing.
 *
 * Null means no charge at all, and a practice that has set its fee to zero
 * gets null too: a charge of nothing is a line on a family's account saying
 * they owe nothing, which is noise rather than a record.
 *
 * A status nobody has named here carries no fee. That is the safe direction
 * for money — a new appointment outcome bills a family nothing until somebody
 * decides it should — and it is the same discipline `CHARGING_OUTCOMES` keeps.
 */
export function callOutFeeFor(
  status: string,
  reason: string | null,
  setting: CallOutFeeSetting,
): Fils | null {
  if (!(CALL_OUT_FEE_OUTCOMES as readonly string[]).includes(status)) {
    return null;
  }
  if (reason !== null && (FEE_EXEMPT_REASONS as readonly string[]).includes(reason)) {
    return null;
  }
  return setting.callOutFeeFils > 0 ? fils(setting.callOutFeeFils) : null;
}
