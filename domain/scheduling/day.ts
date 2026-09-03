import { isoDateIn, type IsoDate } from '@domain/shared';
import { isSettled, type AppointmentStatus } from './status';

/**
 * The shape of one practitioner's day: which calendar day it is in the
 * practice's own zone, and where in the run of stops they have got to
 * (docs/SPEC/scheduling-manual.md section 5.1 — "Current stop is emphasised;
 * past stops collapse"). Pure: no I/O, no clock read inside — `now` is always
 * an argument (CLAUDE.md rule 4, .claude/rules/testing.md).
 */

/**
 * The practice works one zone. Asia/Dubai carries no daylight-saving change,
 * so a day here is always the same 24 hours wide.
 */
export const PRACTICE_TIME_ZONE = 'Asia/Dubai';

/** The calendar date of `now` in the practice's zone, as YYYY-MM-DD. */
export function practiceDate(now: Date): IsoDate {
  return isoDateIn(now, PRACTICE_TIME_ZONE);
}

/** As much of a stop as working out the day's shape needs. */
export type DayStop = { windowStart: Date; status: AppointmentStatus };

/** Where a stop sits relative to the practitioner: behind them, at them, ahead of them. */
export type StopPhase = 'past' | 'current' | 'later';

/**
 * The stop the practitioner is on, given a day's stops in window order (the
 * order `GET /api/appointments` returns them in).
 *
 * The current stop is the unsettled one whose window has started most
 * recently — the visit they should be at — and, before the day has begun,
 * simply the earliest unsettled one. Both halves matter. Emphasising the
 * first unsettled stop alone would leave the day frozen on a visit somebody
 * forgot to close, three doors ago; picking by the clock alone would move
 * on from a visit that overran while it was still being delivered.
 *
 * Returns -1 when every stop is settled: the day is done, and nothing is
 * emphasised.
 */
export function currentStopIndex(stops: readonly DayStop[], now: Date): number {
  let earliestOpen = -1;
  let startedOpen = -1;
  for (const [index, stop] of stops.entries()) {
    if (isSettled(stop.status)) {
      continue;
    }
    if (earliestOpen === -1) {
      earliestOpen = index;
    }
    if (stop.windowStart.getTime() <= now.getTime()) {
      startedOpen = index;
    }
  }
  return startedOpen === -1 ? earliestOpen : startedOpen;
}

/** One phase per stop, in the order the stops were given. */
export function stopPhases(stops: readonly DayStop[], now: Date): StopPhase[] {
  const current = currentStopIndex(stops, now);
  return stops.map((_stop, index) => {
    if (current === -1 || index < current) {
      return 'past';
    }
    return index === current ? 'current' : 'later';
  });
}
