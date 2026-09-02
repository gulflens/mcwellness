import type { AppointmentStatus } from '../../api/appointments/schema';

/**
 * Status in words first, one small dot carrying the one non-band hue the
 * brief allows (DESIGN.md "The Status-in-Words Rule"). Local to this module:
 * the shared `StatusChip` in app/shell/components is typed to `ClientStatus`.
 *
 * The tone follows what a status means to the coordinator, not its raw place
 * in the lifecycle (docs/SPEC/scheduling-manual.md section 3): `proposed`
 * still needs the client told, so it takes attention; `confirmed`,
 * `checked_in` and `completed` are all in good order, so they take ok; a
 * plain `cancelled` or a `rescheduled` appointment is closed without fault,
 * so it takes the default, uncoloured dot; `cancelled_late` and `no_show`
 * cost the practice something and want a look, so they take critical.
 */
const LABELS: Record<AppointmentStatus, string> = {
  proposed: 'Proposed',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  cancelled_late: 'Cancelled late',
  no_show: 'No-show',
  rescheduled: 'Rescheduled',
};

const TONES: Record<AppointmentStatus, 'ok' | 'attention' | 'critical' | null> = {
  proposed: 'attention',
  confirmed: 'ok',
  checked_in: 'ok',
  completed: 'ok',
  cancelled: null,
  cancelled_late: 'critical',
  no_show: 'critical',
  rescheduled: null,
};

export function AppointmentStatusChip({ status }: { status: AppointmentStatus }) {
  const tone = TONES[status];
  return (
    <span
      className={['appt-status', tone ? `appt-status--${tone}` : null].filter(Boolean).join(' ')}
    >
      <span className="appt-status__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
