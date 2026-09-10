import { describe, expect, it } from 'vitest';
import type { Matrix } from './optimise';
import { boardState, lateness, type Progress } from './lateness';

/**
 * Running late, decided rather than typed (docs/SPEC/dispatch.md section 5),
 * and the nine states a block can be in (section 4.4). Fixed matrices, fixed
 * clocks; nothing here reads the time.
 */

// Three stops an hour apart, 45 minutes each, at three places.
const day = (overrides: Partial<Progress>[] = []): Progress[] =>
  [
    { stopId: 's1', windowStart: at('09:00'), windowEnd: at('09:45'), locationId: 'L1' },
    { stopId: 's2', windowStart: at('10:00'), windowEnd: at('10:45'), locationId: 'L2' },
    { stopId: 's3', windowStart: at('11:00'), windowEnd: at('11:45'), locationId: 'L3' },
  ].map((stop, i) => ({
    durationMinutes: 45,
    status: 'confirmed' as const,
    checkedInAt: null,
    closedAt: null,
    ...stop,
    ...(overrides[i] ?? {}),
  }));

function at(time: string): Date {
  return new Date(`2026-09-04T${time}:00+04:00`);
}

/** Fifteen minutes between any two places, zero from a place to itself. */
const fifteen: Matrix = (from, to) => ({
  seconds: from === to ? 0 : 15 * 60,
  metres: from === to ? 0 : 9000,
  source: 'straight-line',
});

describe('lateness', () => {
  it('says nothing is late while nothing has happened and every window is still open', () => {
    const result = lateness(day(), fifteen, at('09:20'), 10);
    expect([...result.values()]).toEqual([
      { late: false, byMinutes: 0 },
      { late: false, byMinutes: 0 },
      { late: false, byMinutes: 0 },
    ]);
  });

  it('does not call a visit late merely because nobody has checked in while its window is open', () => {
    const result = lateness(day(), fifteen, at('09:40'), 10);
    expect(result.get('s1')).toEqual({ late: false, byMinutes: 0 });
  });

  it('walks forward from the last visit closed, and lets the gaps absorb a single overrun', () => {
    // The first visit overran by 35 minutes and closed at 10:20. The second
    // is reached at 10:35, inside its window; the third at 11:35, inside its
    // window too, because waiting for a window to open is not lateness.
    const result = lateness(
      day([{ status: 'completed', closedAt: at('10:20') }]),
      fifteen,
      at('10:25'),
      10,
    );
    expect(result.get('s2')).toEqual({ late: false, byMinutes: 0 });
    expect(result.get('s3')).toEqual({ late: false, byMinutes: 0 });
  });

  it('calls the next visits late when an open visit is still running past its length', () => {
    // Checked in at 09:00, never closed, and it is now 10:50: the earliest
    // departure is now, so the second door is reached at 11:05 — twenty
    // minutes after its window shut — and the third at 12:05.
    const result = lateness(
      day([{ status: 'checked_in', checkedInAt: at('09:00') }]),
      fifteen,
      at('10:50'),
      10,
    );
    expect(result.get('s1')).toEqual({ late: false, byMinutes: 0 });
    expect(result.get('s2')).toEqual({ late: true, byMinutes: 20 });
    expect(result.get('s3')).toEqual({ late: true, byMinutes: 20 });
  });

  it('applies the grace as given, never a constant of its own', () => {
    // Closed at 10:33: the second door is reached at 10:48, three minutes late.
    const stops = day([{ status: 'completed', closedAt: at('10:33') }]);
    expect(lateness(stops, fifteen, at('10:35'), 10).get('s2')).toEqual({
      late: false,
      byMinutes: 3,
    });
    expect(lateness(stops, fifteen, at('10:35'), 2).get('s2')).toEqual({
      late: true,
      byMinutes: 3,
    });
  });

  it('marks a visit whose window has passed with no check-in as late by the time since, once something later has happened', () => {
    // The practitioner skipped the first door and checked in at the second.
    const result = lateness(
      day([{}, { status: 'checked_in', checkedInAt: at('10:05') }]),
      fifteen,
      at('10:10'),
      10,
    );
    expect(result.get('s1')).toEqual({ late: true, byMinutes: 25 });
    expect(result.get('s2')).toEqual({ late: false, byMinutes: 0 });
  });

  it('answers every stop, settled ones as not late', () => {
    const result = lateness(day([{ status: 'cancelled' }]), fifteen, at('12:00'), 10);
    expect(result.get('s1')).toEqual({ late: false, byMinutes: 0 });
    expect(result.size).toBe(3);
  });
});

describe('boardState', () => {
  const stop = day()[0]!;
  it('reads the state from the status, the session and the lateness, in that order', () => {
    expect(boardState({ ...stop, status: 'proposed' }, null, false, at('08:00'))).toBe('waiting');
    expect(boardState({ ...stop, status: 'confirmed' }, null, false, at('08:00'))).toBe('agreed');
    expect(boardState({ ...stop, status: 'checked_in' }, null, false, at('09:10'))).toBe(
      'at_the_door',
    );
    expect(boardState({ ...stop, status: 'completed' }, null, false, at('12:00'))).toBe('finished');
    expect(boardState({ ...stop, status: 'no_show' }, null, false, at('12:00'))).toBe('missed');
    expect(boardState({ ...stop, status: 'cancelled' }, null, false, at('12:00'))).toBe(
      'called_off',
    );
    expect(boardState({ ...stop, status: 'cancelled_late' }, null, false, at('12:00'))).toBe(
      'called_off',
    );
    expect(boardState({ ...stop, status: 'rescheduled' }, null, false, at('12:00'))).toBe('moved');
  });

  it('says on the way once the previous visit is closed and this window has not opened', () => {
    const previous = { ...day()[0]!, status: 'completed' as const, closedAt: at('09:40') };
    const next = day()[1]!;
    expect(boardState(next, previous, false, at('09:50'))).toBe('on_the_way');
    expect(boardState(next, previous, false, at('10:05'))).toBe('agreed');
    expect(boardState(next, null, false, at('09:50'))).toBe('agreed');
  });

  it('lets running late override waiting, agreed and on the way, but never a door already reached', () => {
    expect(boardState({ ...stop, status: 'confirmed' }, null, true, at('08:00'))).toBe(
      'running_late',
    );
    expect(boardState({ ...stop, status: 'proposed' }, null, true, at('08:00'))).toBe(
      'running_late',
    );
    expect(boardState({ ...stop, status: 'checked_in' }, null, true, at('09:10'))).toBe(
      'at_the_door',
    );
    expect(boardState({ ...stop, status: 'completed' }, null, true, at('12:00'))).toBe('finished');
  });
});
