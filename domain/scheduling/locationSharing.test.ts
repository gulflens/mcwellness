import { describe, expect, it } from 'vitest';
import {
  POSITION_RETENTION_HOURS,
  SHIFT_LEAD_MINUTES,
  SHIFT_TAIL_MINUTES,
  STAFF_LOCATION_NOTICE_VERSION,
  mayWritePosition,
  positionAgeMinutes,
  positionsCutoff,
  shiftOpen,
  shiftWindow,
  type SharingFacts,
  type ShiftStop,
} from './locationSharing';

/**
 * Live location for the dispatcher (docs/SPEC/dispatch.md section 15, piece
 * twenty-five): whether a position may be written now — consent, the
 * person's own switch, and an open shift — and what "a shift" is. Fixed
 * clocks; nothing here reads the time.
 */

function at(time: string, date = '2026-10-06'): Date {
  return new Date(`${date}T${time}:00+04:00`);
}

/** The practice day of 6 October 2026, midnight to midnight in Dubai. */
const DAY = { start: at('00:00'), end: at('00:00', '2026-10-07') };

function stop(time: string, overrides: Partial<ShiftStop> = {}): ShiftStop {
  const windowStart = at(time);
  return {
    windowStart,
    windowEnd: new Date(windowStart.getTime() + 45 * 60_000),
    durationMinutes: 60,
    status: 'confirmed',
    closedAt: null,
    ...overrides,
  };
}

describe('shiftWindow', () => {
  it('has no shift on a day with no visits: a day off is never a working day', () => {
    expect(shiftWindow([], DAY)).toBeNull();
  });

  it('opens before the first window, for the drive to the first door', () => {
    const window = shiftWindow([stop('09:00'), stop('11:00')], DAY);
    expect(window?.opensAt).toEqual(new Date(at('09:00').getTime() - SHIFT_LEAD_MINUTES * 60_000));
  });

  it('closes a little after the last visit could have ended, when it has not closed', () => {
    // 11:00 window, 45 minutes long, then a 60 minute session: 12:45 at the
    // latest, and the tail after it.
    const window = shiftWindow([stop('09:00'), stop('11:00')], DAY);
    expect(window?.closesAt).toEqual(new Date(at('12:45').getTime() + SHIFT_TAIL_MINUTES * 60_000));
  });

  it('closes after the last visit actually closed, when that is later than planned', () => {
    const window = shiftWindow(
      [stop('11:00', { status: 'completed', closedAt: at('13:20') })],
      DAY,
    );
    expect(window?.closesAt).toEqual(new Date(at('13:20').getTime() + SHIFT_TAIL_MINUTES * 60_000));
  });

  it('closes after the last visit actually closed, when that is earlier than planned', () => {
    const window = shiftWindow(
      [stop('11:00', { status: 'completed', closedAt: at('11:50') })],
      DAY,
    );
    expect(window?.closesAt).toEqual(new Date(at('11:50').getTime() + SHIFT_TAIL_MINUTES * 60_000));
  });

  it('stays open to midnight while the practitioner is still checked in at a door', () => {
    const window = shiftWindow([stop('20:00', { status: 'checked_in' })], DAY);
    expect(window?.closesAt).toEqual(DAY.end);
  });

  it('never runs past midnight, however late the last visit', () => {
    const window = shiftWindow([stop('23:00')], DAY);
    expect(window?.closesAt).toEqual(DAY.end);
  });

  it('never opens before midnight, however early the first visit', () => {
    const window = shiftWindow([stop('00:30')], DAY);
    expect(window?.opensAt).toEqual(DAY.start);
  });

  it('ignores visits that are not a stop on the day: proposed, called off, moved, voided', () => {
    for (const status of [
      'proposed',
      'cancelled',
      'cancelled_late',
      'rescheduled',
      'voided',
    ] as const) {
      expect(shiftWindow([stop('09:00', { status })], DAY), status).toBeNull();
    }
  });

  it('counts a visit nobody answered: the practitioner still drove there', () => {
    expect(shiftWindow([stop('09:00', { status: 'no_show' })], DAY)).not.toBeNull();
  });

  it('ignores a visit outside the day it is asked about', () => {
    expect(
      shiftWindow([stop('09:00', { windowStart: at('09:00', '2026-10-07') })], DAY),
    ).toBeNull();
  });
});

describe('shiftOpen', () => {
  const day = [stop('09:00'), stop('11:00')];

  it('is closed early in the morning, before the lead-in to the first door', () => {
    expect(shiftOpen(day, DAY, at('07:29'))).toBe(false);
  });

  it('is open from the lead-in to the first door', () => {
    expect(shiftOpen(day, DAY, at('07:30'))).toBe(true);
  });

  it('is open between visits', () => {
    expect(shiftOpen(day, DAY, at('10:30'))).toBe(true);
  });

  it('is closed once the tail after the last visit has passed', () => {
    expect(shiftOpen(day, DAY, at('13:15'))).toBe(false);
    expect(shiftOpen(day, DAY, at('13:14'))).toBe(true);
  });

  it('is closed all day on a day with nothing booked', () => {
    expect(shiftOpen([], DAY, at('10:00'))).toBe(false);
  });
});

describe('mayWritePosition', () => {
  const facts = (overrides: Partial<SharingFacts> = {}): SharingFacts => ({
    consentVersion: STAFF_LOCATION_NOTICE_VERSION,
    sharingOn: true,
    shiftOpen: true,
    ...overrides,
  });

  it('admits a position when consent stands, the switch is on and the shift is open', () => {
    expect(mayWritePosition(facts())).toEqual({ ok: true });
  });

  it('refuses without consent, whatever else is true', () => {
    expect(mayWritePosition(facts({ consentVersion: null }))).toEqual({
      ok: false,
      reason: 'no_consent',
    });
  });

  it('refuses a consent given to a notice that has since changed', () => {
    expect(mayWritePosition(facts({ consentVersion: '0.9' }))).toEqual({
      ok: false,
      reason: 'notice_changed',
    });
  });

  it('refuses when the person has turned their switch off', () => {
    expect(mayWritePosition(facts({ sharingOn: false }))).toEqual({
      ok: false,
      reason: 'sharing_off',
    });
  });

  it('refuses outside the shift, even with consent and the switch on', () => {
    expect(mayWritePosition(facts({ shiftOpen: false }))).toEqual({
      ok: false,
      reason: 'off_shift',
    });
  });

  it('names consent first when everything is missing, because it is what the person must do first', () => {
    expect(mayWritePosition({ consentVersion: null, sharingOn: false, shiftOpen: false })).toEqual({
      ok: false,
      reason: 'no_consent',
    });
  });
});

describe('positionsCutoff', () => {
  it('is two days before now', () => {
    expect(POSITION_RETENTION_HOURS).toBe(48);
    expect(positionsCutoff(at('10:00'))).toEqual(at('10:00', '2026-10-04'));
  });
});

describe('positionAgeMinutes', () => {
  it('counts whole minutes since the position was recorded', () => {
    expect(positionAgeMinutes(at('10:00'), at('10:04'))).toBe(4);
    expect(positionAgeMinutes(at('10:00'), new Date(at('10:04').getTime() + 59_000))).toBe(4);
  });

  it('is never negative when a clock runs a little ahead of the server', () => {
    expect(positionAgeMinutes(at('10:01'), at('10:00'))).toBe(0);
  });
});
