import { describe, expect, it } from 'vitest';
import type { Matrix } from './optimise';
import { boardState, drivenStops, lateness, previousStop, type Progress } from './lateness';

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

  it('reaches the next doors inside their windows after an overrun the day had room for', () => {
    // The first visit overran by 35 minutes and closed at 10:20. The second
    // is reached at 10:35, inside its window; the third at 11:35, inside its
    // window too.
    const result = lateness(
      day([{ status: 'completed', closedAt: at('10:20') }]),
      fifteen,
      at('10:25'),
      10,
    );
    expect(result.get('s2')).toEqual({ late: false, byMinutes: 0 });
    expect(result.get('s3')).toEqual({ late: false, byMinutes: 0 });
  });

  it('lets slack in the gap before a stop absorb an overrun, rather than cascading it forward', () => {
    // Three stops at 09:00, 10:00 and — this time — 12:00, so the gap ahead
    // of the third has room to spare. The first ran an hour over and closed
    // at 10:50; by 10:55 the second door is already twenty minutes late, but
    // the ninety-minute gap ahead of the third absorbs the delay entirely.
    const stops: Progress[] = [
      {
        stopId: 's1',
        windowStart: at('09:00'),
        windowEnd: at('09:45'),
        durationMinutes: 45,
        status: 'completed',
        checkedInAt: null,
        closedAt: at('10:50'),
        locationId: 'L1',
      },
      {
        stopId: 's2',
        windowStart: at('10:00'),
        windowEnd: at('10:45'),
        durationMinutes: 45,
        status: 'confirmed',
        checkedInAt: null,
        closedAt: null,
        locationId: 'L2',
      },
      {
        stopId: 's3',
        windowStart: at('12:00'),
        windowEnd: at('12:45'),
        durationMinutes: 45,
        status: 'confirmed',
        checkedInAt: null,
        closedAt: null,
        locationId: 'L3',
      },
    ];
    const result = lateness(stops, fifteen, at('10:55'), 10);
    expect(result.get('s2')).toEqual({ late: true, byMinutes: 20 });
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

  it('clamps arrival to now once nothing further has happened, so an idle wait cannot erase a lateness', () => {
    // Closed at 09:40, well inside its own window — but by 11:00 nobody has
    // moved on. The earliest possible arrival at a door not yet reached can
    // never be in the past, so it is 11:00, not the 09:55 the drive alone
    // would give: fifteen minutes after the second window shut. The third,
    // reached from there at 11:45 + 15 minutes, is late by the same margin.
    const result = lateness(
      day([{ status: 'completed', closedAt: at('09:40') }]),
      fifteen,
      at('11:00'),
      10,
    );
    expect(result.get('s2')).toEqual({ late: true, byMinutes: 15 });
    expect(result.get('s3')).toEqual({ late: true, byMinutes: 15 });
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

  it('treats a checked-in status as a door reached even when the session recorded no instant', () => {
    // The status alone says the practitioner is at the second door; a seed
    // can leave a checked-in row with no session instant, and the walk takes
    // it as checked in at the window's own start (10:00), departing at
    // max(10:00 + 45, now) = max(10:45, 10:50) = 10:50. The first door,
    // skipped on the way there, is late by the time since its own window
    // shut: 09:45 to 10:50 is 65 minutes. The third, reached from 10:50 by a
    // 15-minute drive, arrives at 11:05 — inside its 11:00–11:45 window.
    const result = lateness(
      day([{}, { status: 'checked_in', checkedInAt: null }]),
      fifteen,
      at('10:50'),
      10,
    );
    expect(result.get('s1')).toEqual({ late: true, byMinutes: 65 });
    expect(result.get('s2')).toEqual({ late: false, byMinutes: 0 });
    expect(result.get('s3')).toEqual({ late: false, byMinutes: 0 });
  });

  it('answers every stop, settled ones as not late', () => {
    const result = lateness(day([{ status: 'cancelled' }]), fifteen, at('12:00'), 10);
    expect(result.get('s1')).toEqual({ late: false, byMinutes: 0 });
    expect(result.size).toBe(3);
  });
});

describe('drivenStops', () => {
  it('is every unsettled stop when nothing has happened yet', () => {
    expect(drivenStops(day()).map((stop) => stop.stopId)).toEqual(['s1', 's2', 's3']);
  });

  it('is the anchor and what follows it, and nothing the day has already passed', () => {
    // The second door was reached, so the walk leaves from there: the first is
    // behind the anchor and no drive is ever priced to it again.
    const stops = day([{}, { status: 'checked_in', checkedInAt: at('10:05') }]);
    expect(drivenStops(stops).map((stop) => stop.stopId)).toEqual(['s2', 's3']);
  });

  it('leaves out a completed stop after the anchor and keeps the unsettled one beyond it', () => {
    // A visit marked completed with no session behind it is settled but not
    // reached, so it can sit after the anchor — and nobody drives to it.
    const stops = day([
      { status: 'checked_in', checkedInAt: at('09:05') },
      { status: 'completed' },
    ]);
    expect(drivenStops(stops).map((stop) => stop.stopId)).toEqual(['s1', 's3']);
  });

  it('is empty when nothing after the anchor is still to be driven to', () => {
    const stops = day([
      { status: 'checked_in', checkedInAt: at('09:05') },
      { status: 'cancelled' },
      { status: 'rescheduled' },
    ]);
    expect(drivenStops(stops)).toEqual([]);
    expect(drivenStops([])).toEqual([]);
  });

  it('reads the day in window order however it arrives', () => {
    const [first, second, third] = day();
    expect(drivenStops([third!, first!, second!]).map((stop) => stop.stopId)).toEqual([
      's1',
      's2',
      's3',
    ]);
  });
});

describe('previousStop', () => {
  it('is the stop immediately before when that visit took place', () => {
    const stops = day([{ status: 'completed', closedAt: at('09:40') }]);
    expect(previousStop(stops, 1)?.stopId).toBe('s1');
  });

  it('walks back past a visit that never took place', () => {
    for (const status of ['cancelled', 'cancelled_late', 'no_show', 'rescheduled'] as const) {
      const stops = day([{ status: 'completed', closedAt: at('09:40') }, { status }]);
      expect(previousStop(stops, 2)?.stopId).toBe('s1');
    }
  });

  it('is nothing at all when this is the first stop, or when nothing before it took place', () => {
    expect(previousStop(day(), 0)).toBeNull();
    expect(previousStop(day([{ status: 'cancelled' }, { status: 'no_show' }]), 2)).toBeNull();
  });

  it('keeps a completed visit, which is settled and did take place', () => {
    const stops = day([{ status: 'completed', closedAt: at('09:40') }, { status: 'completed' }]);
    expect(previousStop(stops, 2)?.stopId).toBe('s2');
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

  it('reads a checked-in status as at the door even with no session instant', () => {
    expect(
      boardState({ ...stop, status: 'checked_in', checkedInAt: null }, null, false, at('09:10')),
    ).toBe('at_the_door');
  });
});
