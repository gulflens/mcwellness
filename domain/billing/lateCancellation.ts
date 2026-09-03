/**
 * The notice period, and what a visit called off inside it costs
 * (docs/SPEC/billing.md section 4.3, and the founder's decision of
 * 2026-09-03: under twenty-four hours consumes a credit, with a one-click
 * waiver and a reason).
 *
 * The rule is here rather than in the scheduler because it is a money rule:
 * the scheduler decides that a visit is cancelled, this decides whether the
 * client pays for it. `isLateCancellation` is what the cancel flow should ask
 * before choosing between `cancelled` and `cancelled_late`
 * (docs/CHANGE-REQUESTS/billing-03.md asks the scheduling stream to call it);
 * `consumesEntitlement` is what the ledger acts on once that status is
 * written.
 *
 * Pure: no I/O, and the moment of cancellation is always an argument
 * (.claude/rules/testing.md).
 */

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
 * The appointment outcomes that take a credit. Written as the outcomes that
 * charge, never as the ones that do not: a status added to
 * `appointment_status` later then costs the client nothing until somebody
 * names it here on purpose, the same discipline
 * 201_client_visible_to_practitioner.sql uses for its own status list.
 */
export const CHARGING_OUTCOMES = ['cancelled_late', 'no_show'] as const;
export type ChargingOutcome = (typeof CHARGING_OUTCOMES)[number];

export function consumesEntitlement(status: string): status is ChargingOutcome {
  return (CHARGING_OUTCOMES as readonly string[]).includes(status);
}
