/**
 * The appointment lifecycle (docs/SPEC/scheduling-manual.md section 3), and
 * the one question a day sheet asks of it: is this visit settled?
 *
 * The single home for the status list. `app/api/appointments/schema.ts`
 * validates the wire against this array rather than repeating it, so the two
 * cannot drift; the database's own `appointment_status` enum
 * (db/migrations/200_appointment.sql) is the third copy, and the only one
 * that has to be written twice.
 */

export const APPOINTMENT_STATUSES = [
  'proposed',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'cancelled_late',
  'no_show',
  'rescheduled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/**
 * The statuses that mean this visit is over: it was delivered, called off
 * (either side of the notice period), missed, or moved to a new appointment
 * of its own. Everything else — proposed, confirmed, checked_in — is a visit
 * the practitioner still owes someone.
 */
export const SETTLED_STATUSES = [
  'completed',
  'cancelled',
  'cancelled_late',
  'no_show',
  'rescheduled',
] as const;

export function isSettled(status: AppointmentStatus): boolean {
  return (SETTLED_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether the household has been told about this visit.
 *
 * `proposed` means "placed on the calendar, client not yet informed"
 * (docs/SPEC/scheduling-manual.md section 3), and every other live status is
 * on the far side of somebody having said so: `confirmed` is the telling
 * itself, and a visit cannot be checked in or completed without one. A
 * settled visit is judged on what it was before it settled and is not asked
 * this question — the rules that use it are about a visit still owed.
 *
 * Two rules read it, and both would otherwise say something untrue about a
 * visit nobody has heard of: the notice period (a household given no promise
 * was given no notice to break, domain/scheduling/cancellation.ts) and the
 * reason list (a family cannot have called off a visit they were never told
 * about).
 */
export function householdHasBeenTold(status: AppointmentStatus): boolean {
  return status !== 'proposed';
}

/**
 * Whether this visit is one to confirm — that is, to record the household as
 * having been told about (docs/SPEC/scheduling-manual.md section 3:
 * "`confirmed`: client informed (manual toggle in Phase 1; WhatsApp in Phase
 * 2)").
 *
 * Only from `proposed`, and in that one direction. A visit already confirmed
 * has nothing to record; a visit checked in, delivered, missed, called off or
 * moved has happened, and what happened is not re-announced. Confirming is
 * never a way back from any of those: the lifecycle in section 3 has no
 * arrow pointing that way, and `app/api/appointments/confirm.ts` writes the
 * same predicate into its own `where` clause so a visit somebody settled
 * between the read and the write cannot be quietly reopened.
 */
export function canBeConfirmed(status: AppointmentStatus): boolean {
  return status === 'proposed';
}
