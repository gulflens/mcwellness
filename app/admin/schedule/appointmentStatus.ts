import type { StatusTone } from '../../shell/components/StatusChip';
import type { AppointmentStatus } from '../../api/appointments/schema';

/**
 * The label and tone an appointment's status renders with, fed to the
 * shared `StatusChip` (round 7a, `app/shell/components/StatusChip.tsx`)
 * rather than a forked chip of this module's own: the chip chrome — the
 * word, the 6px dot, the tone colours — is shared library, not repeated
 * here; only the mapping from `AppointmentStatus` to a label and a tone is
 * local, since the shared component knows nothing about appointments.
 *
 * The tone follows what a status means to the coordinator, not its raw place
 * in the lifecycle (docs/SPEC/scheduling-manual.md section 3): `proposed`
 * still needs the client told, so it takes attention; `confirmed`,
 * `checked_in` and `completed` are all in good order, so they take ok; a
 * plain `cancelled` or a `rescheduled` appointment is closed without fault,
 * so it takes the shared chip's uncoloured `neutral` tone (the closest match
 * `StatusChip`'s four tones have to the client status chip's own default
 * slate dot, which this module cannot reuse — `StatusChip`'s tones are ok,
 * attention, critical and neutral, nothing else); `cancelled_late` and
 * `no_show` cost the practice something and want a look, so they take
 * critical.
 */
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  proposed: 'Proposed',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  cancelled_late: 'Cancelled late',
  no_show: 'No-show',
  rescheduled: 'Rescheduled',
};

export const APPOINTMENT_STATUS_TONES: Record<AppointmentStatus, StatusTone> = {
  proposed: 'attention',
  confirmed: 'ok',
  checked_in: 'ok',
  completed: 'ok',
  cancelled: 'neutral',
  cancelled_late: 'critical',
  no_show: 'critical',
  rescheduled: 'neutral',
};
