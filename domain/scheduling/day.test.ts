import { describe, expect, it } from 'vitest';
import { currentStopIndex, practiceDate, stopPhases, type DayStop } from './day';

// Every clock value here is an argument, never a read (.claude/rules/testing.md).
// Dubai is UTC+04:00 all year, so 05:00Z is 09:00 at the door.
const at = (iso: string) => new Date(iso);

function stop(windowStart: string, status: DayStop['status'] = 'confirmed'): DayStop {
  return { windowStart: at(windowStart), status };
}

describe('practiceDate', () => {
  it('reads the calendar date in the practice zone, not the machine one', () => {
    expect(practiceDate(at('2026-09-10T05:00:00Z'))).toBe('2026-09-10');
  });

  it('is already tomorrow in Dubai when it is still today in UTC', () => {
    expect(practiceDate(at('2026-09-10T20:30:00Z'))).toBe('2026-09-11');
  });

  it('is still yesterday in Dubai just after midnight UTC', () => {
    expect(practiceDate(at('2026-09-11T00:30:00Z'))).toBe('2026-09-11');
  });
});

describe('currentStopIndex', () => {
  const day: DayStop[] = [
    stop('2026-09-10T05:00:00Z'),
    stop('2026-09-10T07:00:00Z'),
    stop('2026-09-10T09:00:00Z'),
  ];

  it('has no current stop in an empty day', () => {
    expect(currentStopIndex([], at('2026-09-10T05:00:00Z'))).toBe(-1);
  });

  it('emphasises the first stop before the day has begun', () => {
    expect(currentStopIndex(day, at('2026-09-10T03:00:00Z'))).toBe(0);
  });

  it('moves on as each window opens', () => {
    expect(currentStopIndex(day, at('2026-09-10T05:10:00Z'))).toBe(0);
    expect(currentStopIndex(day, at('2026-09-10T07:00:00Z'))).toBe(1);
    expect(currentStopIndex(day, at('2026-09-10T23:00:00Z'))).toBe(2);
  });

  it('skips the stops already settled', () => {
    const settledFirst = [
      stop('2026-09-10T05:00:00Z', 'completed'),
      stop('2026-09-10T07:00:00Z'),
      stop('2026-09-10T09:00:00Z'),
    ];
    expect(currentStopIndex(settledFirst, at('2026-09-10T05:30:00Z'))).toBe(1);
  });

  it('stays on a visit that overran rather than following the clock past it', () => {
    // 07:10Z, ten minutes into the second window: the first is still open,
    // but the second is the one being delivered.
    expect(currentStopIndex(day, at('2026-09-10T07:10:00Z'))).toBe(1);
    // With the later two settled and the first left open, the day is back on
    // the first: an unclosed visit is not a finished one.
    const laterSettled = [
      stop('2026-09-10T05:00:00Z'),
      stop('2026-09-10T07:00:00Z', 'completed'),
      stop('2026-09-10T09:00:00Z', 'completed'),
    ];
    expect(currentStopIndex(laterSettled, at('2026-09-10T10:00:00Z'))).toBe(0);
  });

  it('has no current stop once every visit is settled, however it ended', () => {
    const closed = [
      stop('2026-09-10T05:00:00Z', 'completed'),
      stop('2026-09-10T07:00:00Z', 'no_show'),
      stop('2026-09-10T09:00:00Z', 'cancelled_late'),
    ];
    expect(currentStopIndex(closed, at('2026-09-10T12:00:00Z'))).toBe(-1);
  });

  it('treats a cancelled or rescheduled stop as settled too', () => {
    const moved = [
      stop('2026-09-10T05:00:00Z', 'cancelled'),
      stop('2026-09-10T07:00:00Z', 'rescheduled'),
      stop('2026-09-10T09:00:00Z'),
    ];
    expect(currentStopIndex(moved, at('2026-09-10T05:30:00Z'))).toBe(2);
  });

  it('counts a checked-in visit as still open', () => {
    const running = [stop('2026-09-10T05:00:00Z', 'checked_in'), stop('2026-09-10T07:00:00Z')];
    expect(currentStopIndex(running, at('2026-09-10T05:30:00Z'))).toBe(0);
  });
});

describe('stopPhases', () => {
  const day: DayStop[] = [
    stop('2026-09-10T05:00:00Z', 'completed'),
    stop('2026-09-10T07:00:00Z'),
    stop('2026-09-10T09:00:00Z'),
  ];

  it('names one phase per stop, in the order given', () => {
    expect(stopPhases(day, at('2026-09-10T07:15:00Z'))).toEqual(['past', 'current', 'later']);
  });

  it('puts the whole day behind once nothing is left open', () => {
    const closed = day.map((s) => ({ ...s, status: 'completed' as const }));
    expect(stopPhases(closed, at('2026-09-10T12:00:00Z'))).toEqual(['past', 'past', 'past']);
  });

  it('is empty for an empty day', () => {
    expect(stopPhases([], at('2026-09-10T05:00:00Z'))).toEqual([]);
  });

  it('leaves an unclosed earlier visit behind the one being delivered', () => {
    const open: DayStop[] = [
      stop('2026-09-10T05:00:00Z'),
      stop('2026-09-10T07:00:00Z'),
      stop('2026-09-10T09:00:00Z'),
    ];
    expect(stopPhases(open, at('2026-09-10T07:15:00Z'))).toEqual(['past', 'current', 'later']);
  });
});
