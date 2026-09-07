import { describe, expect, it } from 'vitest';
import type { Matrix, PlanStop } from './optimise';
import { MAX_PLAN_STOPS, optimiseDay } from './optimise';

/**
 * The optimised day (docs/SPEC/route-planning.md 5.4). Four synthetic places:
 * a base B, two households near it (L1, L3, five minutes apart) and one far
 * away (L2). Seconds between them are fixed by the table below; metres are
 * ten times the seconds. Dubai is UTC+4: "09:00" here is 05:00Z.
 */
const SECONDS: Record<string, number> = {
  'B:L1': 600,
  'B:L2': 3000,
  'B:L3': 900,
  'L1:L2': 2700,
  'L1:L3': 300,
  'L2:L3': 2400,
};

const matrix: Matrix = (from, to) => {
  if (from === to) return { seconds: 0, metres: 0, source: 'traffic' };
  const seconds = SECONDS[`${from}:${to}`] ?? SECONDS[`${to}:${from}`];
  if (seconds === undefined) throw new Error(`no leg between ${from} and ${to}`);
  return { seconds, metres: seconds * 10, source: 'traffic' };
};

const straightLine: Matrix = (from, to, at) => ({
  ...matrix(from, to, at),
  source: 'straight-line',
});

const BASE = { locationId: 'B', point: { lat: 25.2, lng: 55.27 } };
/** The evening before: every stop is comfortably ahead of now plus an hour. */
const NOW = new Date('2026-09-06T12:00:00Z');

function dubai(hhmm: string): Date {
  return new Date(`2026-09-07T${hhmm}:00+04:00`);
}

function stop(id: string, start: string, status: PlanStop['status'] = 'proposed'): PlanStop {
  return {
    id,
    status,
    windowStart: dubai(start),
    windowEnd: new Date(dubai(start).getTime() + 45 * 60_000),
    durationMinutes: 60,
    travelBufferMinutes: 15,
    locationId: id,
    point: { lat: 25.2, lng: 55.27 },
  };
}

describe('optimiseDay', () => {
  it('finds the order that drives least, ties broken by the fewer households moved', () => {
    // Far first, then near, then near: 6,900 seconds with the drive home.
    const plan = optimiseDay(
      {
        stops: [stop('L2', '09:00'), stop('L1', '10:30'), stop('L3', '12:00')],
        homeBase: BASE,
        now: NOW,
      },
      matrix,
    );
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    // Two orders drive 6,300; L2, L3, L1 moves two households, L1, L3, L2 moves three.
    expect(plan.stops.map((s) => s.id)).toEqual(['L2', 'L3', 'L1']);
    expect(plan.before.driveSeconds).toBe(6900);
    expect(plan.after.driveSeconds).toBe(6300);
    expect(plan.savedSeconds).toBe(600);
    expect(plan.after.driveMetres).toBe(63000);
    expect(plan.source).toBe('traffic');
    const [l2, l3, l1] = plan.stops;
    expect(l2?.moved).toBe(false);
    expect(l2?.windowStart.toISOString()).toBe('2026-09-07T05:00:00.000Z');
    // Leaves L2 at 10:00, forty minutes to L3: 10:40, on the quarter hour 10:45.
    expect(l3?.windowStart.toISOString()).toBe('2026-09-07T06:45:00.000Z');
    expect(l3?.windowEnd.toISOString()).toBe('2026-09-07T07:30:00.000Z');
    expect(l3?.moved).toBe(true);
    // Leaves L3 at 11:45, five minutes to L1: 11:50, so 12:00.
    expect(l1?.windowStart.toISOString()).toBe('2026-09-07T08:00:00.000Z');
    // The day ends when the last visit does, 13:00, exactly as it did before.
    expect(plan.after.dayEnd.toISOString()).toBe('2026-09-07T09:00:00.000Z');
    expect(plan.before.dayEnd.toISOString()).toBe('2026-09-07T09:00:00.000Z');
    // Rule 6.2 on the moved stops: five minutes to L1 is the floor of fifteen; the last keeps fifteen.
    expect(l3?.travelBufferMinutes).toBe(15);
    expect(l1?.travelBufferMinutes).toBe(15);
    expect(l2?.travelBufferMinutes).toBe(15);
  });

  it('marks anchors and never moves them, and a confirmed visit can hold the whole day', () => {
    const plan = optimiseDay(
      {
        stops: [stop('L2', '09:00'), stop('L1', '10:30', 'confirmed'), stop('L3', '12:00')],
        homeBase: BASE,
        now: NOW,
      },
      matrix,
    );
    // Every other order either misses L1's window or ends the day later.
    expect(plan).toEqual({ kind: 'refusal', reason: 'no_improvement' });
  });

  it('treats a proposed visit within the hour, or behind, as an anchor', () => {
    const soon = new Date(dubai('09:00').getTime() - 30 * 60_000);
    const plan = optimiseDay(
      {
        stops: [stop('L2', '09:00'), stop('L1', '10:30', 'checked_in')],
        homeBase: BASE,
        now: soon,
      },
      matrix,
    );
    expect(plan).toEqual({ kind: 'refusal', reason: 'nothing_to_move' });
  });

  it('refuses more than ten stops', () => {
    const stops = Array.from({ length: MAX_PLAN_STOPS + 1 }, (_, i) =>
      stop(`L${i + 1}`, `0${Math.min(9, i)}:00`),
    );
    expect(optimiseDay({ stops, homeBase: null, now: NOW }, matrix)).toEqual({
      kind: 'refusal',
      reason: 'too_many_stops',
    });
  });

  it('says so when the current order already drives least', () => {
    // Windows that the drives already reach: L1 leaves at 10:00, L3 is five
    // minutes on and its window opens at 10:00, L2 is forty minutes after L3.
    const plan = optimiseDay(
      {
        stops: [stop('L1', '09:00'), stop('L3', '10:00'), stop('L2', '11:45')],
        homeBase: BASE,
        now: NOW,
      },
      matrix,
    );
    expect(plan).toEqual({ kind: 'refusal', reason: 'no_improvement' });
  });

  it('works without a base, counting only the drives between stops', () => {
    const plan = optimiseDay(
      {
        stops: [stop('L2', '09:00'), stop('L1', '10:30'), stop('L3', '12:00')],
        homeBase: null,
        now: NOW,
      },
      matrix,
    );
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    // L2 → L1 → L3 is 3,000; L2 → L3 → L1 is 2,700, and keeps L2 where it is.
    expect(plan.stops.map((s) => s.id)).toEqual(['L2', 'L3', 'L1']);
    expect(plan.after.driveSeconds).toBe(2700);
  });

  it('labels a plan by the source of every leg it used', () => {
    const plan = optimiseDay(
      {
        stops: [stop('L2', '09:00'), stop('L1', '10:30'), stop('L3', '12:00')],
        homeBase: BASE,
        now: NOW,
      },
      straightLine,
    );
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.source).toBe('straight-line');
  });

  it('never starts the day earlier than now plus an hour, whatever the windows say', () => {
    const lateMorning = dubai('08:30');
    const plan = optimiseDay(
      {
        stops: [stop('L2', '10:00'), stop('L1', '11:30'), stop('L3', '13:00')],
        homeBase: BASE,
        now: lateMorning,
      },
      matrix,
    );
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    for (const planned of plan.stops) {
      expect(planned.windowStart.getTime()).toBeGreaterThanOrEqual(dubai('09:30').getTime());
    }
  });
});
