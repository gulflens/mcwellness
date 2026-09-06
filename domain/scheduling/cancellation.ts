import { householdHasBeenTold, type AppointmentStatus } from './status';

/**
 * Calling a visit off: whether it was called off in time, and what the
 * appointment's status becomes when it was not
 * (docs/SPEC/scheduling-manual.md sections 3 and 6.4,
 * docs/SPEC/billing.md section 4.3).
 *
 * Pure: no I/O, no clock read inside — `cancelledAt` is always an argument,
 * and so is the notice period (CLAUDE.md rule 4, .claude/rules/testing.md).
 * The practice's own notice period lives in `scheduling_setting.notice_hours`
 * (db/migrations/202_scheduling_setting.sql) and is read by the route that
 * calls this, never by this file.
 *
 * **What "late" costs.** A late cancellation consumes one of the client's
 * credits: `app.billing_on_appointment_charged` (404_billing_consumption.sql)
 * fires the moment an appointment's status becomes `cancelled_late`, and the
 * coordinator's way back is billing's own waiver,
 * `POST /api/billing/entitlements/:id/waiver`, with a reason. So the boundary
 * below is the difference between a family paying for a visit that did not
 * happen and not paying for it, which is why it is a tested rule and not an
 * inline comparison in a route.
 */

/**
 * The founder's decision of 2026-09-03, and `docs/SPEC/billing.md`
 * section 4.3: twenty-four hours. It is the default the practice starts with,
 * not a constant the code depends on — the figure a route uses comes from
 * `scheduling_setting.notice_hours`, which the practice may change.
 */
export const DEFAULT_NOTICE_HOURS = 24;

/**
 * And the fee for a visit that could not go ahead once the practitioner had
 * arrived: AED 150, the operator's decision of the same day, in integer fils.
 * The practice's own figure lives in `scheduling_setting.unfit_fee_fils`; this
 * is what it starts life as, and what a screen falls back to only when the row
 * cannot be read at all.
 */
export const DEFAULT_UNFIT_FEE_FILS = 15_000;

/**
 * Why a visit was called off. A closed set, because the ledger and the
 * practice's own policy both read it: which reason a cancellation carries
 * decides whether a credit goes with it.
 *
 * - `client_request` — the family called it off.
 * - `practice_request` — the practice called it off. Ordinary notice applies:
 *   a practice cancelling its own visit inside the notice period still writes
 *   `cancelled_late`, and the coordinator waives it, deliberately. Making the
 *   status depend on who was at fault would put the judgement in a status
 *   rather than in the waiver, where somebody has to give a reason for it.
 * - `unfit_to_attend` — the practitioner arrived and the visit could not go
 *   ahead. Always late (see below).
 * - `consent_withdrawn` — a consent the visit depended on was withdrawn, and
 *   every future visit went with it. Never late (see below).
 */
export const CANCELLATION_REASONS = [
  'client_request',
  'practice_request',
  'unfit_to_attend',
  'consent_withdrawn',
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

/**
 * Reasons that are late however much notice the clock says there was.
 *
 * `unfit_to_attend` is the whole of this list. The practitioner has already
 * driven to the door: there was no notice at all, whatever the window says,
 * and the visit cost the practice the journey. The operator set a fee for it
 * on 2026-09-03 (AED 150, `scheduling_setting.unfit_fee_fils`); charging that
 * fee is billing's, and until it does, this status is what accounts for the
 * visit at all.
 */
export const ALWAYS_LATE_REASONS: readonly CancellationReason[] = ['unfit_to_attend'];

/**
 * Reasons that are never late, whatever the clock says.
 *
 * `consent_withdrawn` is the whole of this list. A person withdrawing a
 * consent is exercising a right, and charging them for the visits that right
 * cancels would be a penalty on exercising it. `app.cancel_future_appointments`
 * (db/migrations/203_appointment_move_and_cancel.sql) writes plain `cancelled`
 * for exactly this reason, and this list is the same rule stated where the
 * rest of the rules are.
 */
export const NEVER_LATE_REASONS: readonly CancellationReason[] = ['consent_withdrawn'];

/**
 * Reasons that say the household did something, and so cannot be given about
 * a visit the household has never been told about.
 *
 * - `client_request` says the family called it off. A family cannot call off
 *   a visit nobody has mentioned to them, and offering the words to a
 *   coordinator invites a record that says something false
 *   (docs/CHANGE-REQUESTS/qa-01.md item 5).
 * - `unfit_to_attend` says a practitioner arrived at the door. Nobody drives
 *   to a `proposed` visit: it is on no practitioner's day
 *   (`OWN_STATUS_FILTER`, app/api/appointments/list.ts) precisely so that
 *   nobody does.
 *
 * `practice_request` is what a coordinator releasing a slot they were holding
 * actually did, and it is left available for exactly that. `consent_withdrawn`
 * is too: `app.cancel_future_appointments` cancels a client's proposed visits
 * along with their confirmed ones, and a right exercised reaches both.
 */
export const REASONS_NEEDING_THE_HOUSEHOLD_TOLD: readonly CancellationReason[] = [
  'client_request',
  'unfit_to_attend',
];

/**
 * As much of an appointment as the notice rule needs.
 *
 * The status is here because the rule is about notice given to a household,
 * and whether a household has been told is the difference between a promise
 * broken and a slot released (section 3: "`proposed`: placed on the calendar,
 * client not yet informed"). It was absent, so a proposed visit and a
 * confirmed one were judged identically and a coordinator releasing a held
 * slot the same afternoon was charged a household a full session for it
 * (docs/CHANGE-REQUESTS/qa-01.md item 5).
 */
export type CancellableAppointment = { windowStart: Date; status: AppointmentStatus };

/**
 * Whether a reason can honestly be given about this visit at this moment.
 *
 * Two things make a reason dishonest, and both are about something that
 * cannot have happened.
 *
 * **The household has not been told.** A visit still `proposed` is one the
 * practice is holding and has mentioned to nobody, so neither "the family
 * called it off" nor "the practitioner arrived and could not go ahead" can be
 * true of it. `REASONS_NEEDING_THE_HOUSEHOLD_TOLD` is that list, and it is a
 * property of the visit rather than of the clock: it does not change while a
 * coordinator has the drawer open, which is why the screen can leave those
 * reasons off the list rather than offer them and refuse them.
 *
 * **The door has not been reached.** `unfit_to_attend` means the practitioner
 * arrived and the visit could not go ahead, and nobody has arrived anywhere
 * before the arrival window has opened. Without this it is a way to charge a
 * household a full session for a visit weeks away, by choosing the reason that
 * skips the notice rule — which is exactly what it was doing (compliance
 * review of the pull request that added it: a visit two hundred hours out,
 * called off as unfit, consumed a credit).
 *
 * Judged against `window_start` rather than against the end of the window,
 * because a practitioner may reasonably be at the door the minute it opens.
 */
export function reasonCanBeGivenAt(
  reason: CancellationReason,
  appointment: CancellableAppointment,
  at: Date,
): boolean {
  if (
    !householdHasBeenTold(appointment.status) &&
    REASONS_NEEDING_THE_HOUSEHOLD_TOLD.includes(reason)
  ) {
    return false;
  }
  if (reason !== 'unfit_to_attend') {
    return true;
  }
  return appointment.windowStart.getTime() <= at.getTime();
}

/**
 * Whether a visit was called off inside the notice period.
 *
 * The boundary is exclusive at the notice period itself: "under 24 hours
 * consumes the entitlement" (docs/SPEC/billing.md section 4.3), so exactly
 * twenty-four hours' notice is in time and anything less is not. A visit
 * called off after its window has already opened is late by the same
 * arithmetic — the notice was negative — and needs no separate branch.
 */
export function isLateCancellation(
  appointment: CancellableAppointment,
  cancelledAt: Date,
  noticeHours: number = DEFAULT_NOTICE_HOURS,
): boolean {
  const noticeMs = appointment.windowStart.getTime() - cancelledAt.getTime();
  return noticeMs < noticeHours * 3_600_000;
}

/**
 * The status a cancelled appointment takes: `cancelled`, or `cancelled_late`
 * when the notice rule or the reason says the client's credit goes with it.
 *
 * The three tests below win over the clock, in the order they are written,
 * because each says something the clock cannot.
 *
 * 1. A withdrawn consent is not a late cancellation however close to the
 *    window it lands.
 * 2. **A household that was never told was given no notice to break.**
 *    `proposed` means the visit is a slot the practice is holding and has
 *    mentioned to nobody (section 3). Releasing that slot takes nothing from
 *    anybody, so nothing is taken: the notice period measures notice *to a
 *    household*, and there is none to measure. This sits above the always-late
 *    list deliberately, though the two can barely meet — `reasonCanBeGivenAt`
 *    refuses `unfit_to_attend` on an untold visit outright, since nobody
 *    drives to one — and where they do meet the honest answer is still that a
 *    household promised nothing loses nothing.
 * 3. A practitioner standing at a door had no notice however early the visit
 *    was booked.
 */
export function cancellationStatusFor(
  appointment: CancellableAppointment,
  reason: CancellationReason,
  cancelledAt: Date,
  noticeHours: number = DEFAULT_NOTICE_HOURS,
): Extract<AppointmentStatus, 'cancelled' | 'cancelled_late'> {
  if (NEVER_LATE_REASONS.includes(reason)) {
    return 'cancelled';
  }
  if (!householdHasBeenTold(appointment.status)) {
    return 'cancelled';
  }
  if (ALWAYS_LATE_REASONS.includes(reason)) {
    return 'cancelled_late';
  }
  return isLateCancellation(appointment, cancelledAt, noticeHours) ? 'cancelled_late' : 'cancelled';
}
