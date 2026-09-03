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
