// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppointmentStatusChip } from '../../app/admin/schedule/AppointmentStatusChip';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '../../app/api/appointments/schema';

afterEach(cleanup);

/** Every status maps to exactly one of the three allowed tones, or to the
 * default (uncoloured) dot — never to a fourth colour (DESIGN.md "The Silent
 * Chrome Rule"). */
const EXPECTED: Record<AppointmentStatus, string | null> = {
  proposed: 'attention',
  confirmed: 'ok',
  checked_in: 'ok',
  completed: 'ok',
  cancelled: null,
  cancelled_late: 'critical',
  no_show: 'critical',
  rescheduled: null,
};

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

describe('AppointmentStatusChip', () => {
  for (const status of APPOINTMENT_STATUSES) {
    it(`maps ${status} to its word and to the ${EXPECTED[status] ?? 'default'} tone`, () => {
      render(<AppointmentStatusChip status={status} />);
      expect(screen.getByText(LABELS[status])).toBeTruthy();
      const chip = screen.getByText(LABELS[status]).closest('.appt-status');
      const tone = EXPECTED[status];
      if (tone) {
        expect(chip?.classList.contains(`appt-status--${tone}`)).toBe(true);
      } else {
        expect(chip?.className).toBe('appt-status');
      }
      cleanup();
    });
  }
});
