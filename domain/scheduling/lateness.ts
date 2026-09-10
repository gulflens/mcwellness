import type { Matrix } from './optimise';
import { isSettled, type AppointmentStatus } from './status';

/**
 * Running late, decided rather than typed (docs/SPEC/dispatch.md section 5),
 * and the state a block on the board is in (section 4.4). Pure: `now` is an
 * argument, the drive matrix is an argument, and the grace is an argument —
 * never a constant of this file's own.
 *
 * **The rule.** Take the last event that actually happened: a visit closed,
 * or a check-in. From there walk forward through the remaining stops, adding
 * each service's own length and the drive between, on the same matrix the
 * optimiser uses. A stop whose earliest possible arrival is later than the
 * end of its arrival window, by more than the grace, is late, and by how much.
 *
 * **Two things it must not do.** It must not call a visit late because the
 * practitioner has not checked in yet while the window is still open — so
 * with nothing happened, the earliest arrival is simply `now`. And it must
 * not cascade a single overrun into every later stop — so the walk waits for
 * each window to open before counting the visit's length, which is what the
 * gaps between windows are for.
 */

const MINUTE_MS = 60_000;

export const DEFAULT_GRACE_MINUTES = 10;

export type Progress = {
  stopId: string;
  windowStart: Date;
  windowEnd: Date;
  /** The service's own length, from `service_type.duration_minutes`. */
  durationMinutes: number;
  status: AppointmentStatus;
  /** From the session, when one was opened at this door. */
  checkedInAt: Date | null;
  /** From the session, when the visit was closed. */
  closedAt: Date | null;
  locationId: string;
};

export type Lateness = { late: boolean; byMinutes: number };

const NOT_LATE: Lateness = { late: false, byMinutes: 0 };

/** The instant the practitioner can leave a stop, given what has happened at it. */
function departureFrom(stop: Progress, now: Date): Date | null {
  if (stop.closedAt !== null) return stop.closedAt;
  if (stop.checkedInAt !== null) {
    // Still there: they leave when the service is done, or now if that has
    // already passed and they have not closed it — an overrun.
    const planned = stop.checkedInAt.getTime() + stop.durationMinutes * MINUTE_MS;
    return new Date(Math.max(planned, now.getTime()));
  }
  return null;
}

/** Whether anything has happened at this stop that fixes the practitioner in time and place. */
function hasHappened(stop: Progress): boolean {
  return stop.closedAt !== null || stop.checkedInAt !== null;
}

function minutesLate(arrival: Date, windowEnd: Date): number {
  return Math.max(0, Math.ceil((arrival.getTime() - windowEnd.getTime()) / MINUTE_MS));
}

export function lateness(
  day: readonly Progress[],
  drive: Matrix,
  now: Date,
  graceMinutes: number,
): Map<string, Lateness> {
  const stops = [...day].sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime());
  const result = new Map<string, Lateness>();
  for (const stop of stops) result.set(stop.stopId, NOT_LATE);

  // The anchor: the last stop, in window order, at which something happened.
  let anchorIndex = -1;
  for (const [index, stop] of stops.entries()) {
    if (hasHappened(stop)) anchorIndex = index;
  }

  let cursorTime: Date = now;
  let cursorLocation: string | null = null;
  if (anchorIndex >= 0) {
    const anchor = stops[anchorIndex]!;
    cursorTime = departureFrom(anchor, now) ?? now;
    cursorLocation = anchor.locationId;
    // A door skipped on the way to the anchor: late by the time since its
    // window shut, because the practitioner went past it.
    for (const stop of stops.slice(0, anchorIndex)) {
      if (isSettled(stop.status) || hasHappened(stop)) continue;
      const by = minutesLate(now, stop.windowEnd);
      result.set(stop.stopId, { late: by > graceMinutes, byMinutes: by });
    }
  }

  for (const stop of stops.slice(anchorIndex + 1)) {
    if (isSettled(stop.status) || hasHappened(stop)) {
      // Settled, or already reached: not this rule's to judge. A reached door
      // becomes the new place the walk continues from.
      if (hasHappened(stop)) {
        cursorTime = departureFrom(stop, now) ?? cursorTime;
        cursorLocation = stop.locationId;
      }
      continue;
    }
    const driveSeconds =
      cursorLocation === null ? 0 : drive(cursorLocation, stop.locationId, cursorTime).seconds;
    const arrival = new Date(cursorTime.getTime() + driveSeconds * 1000);
    const by = minutesLate(arrival, stop.windowEnd);
    result.set(stop.stopId, { late: by > graceMinutes, byMinutes: by });
    // Waiting for a window to open is not lateness: the visit starts at the
    // later of the arrival and the window, and takes its own length.
    const starts = Math.max(arrival.getTime(), stop.windowStart.getTime());
    cursorTime = new Date(starts + stop.durationMinutes * MINUTE_MS);
    cursorLocation = stop.locationId;
  }
  return result;
}

export const BOARD_STATES = [
  'waiting',
  'agreed',
  'on_the_way',
  'at_the_door',
  'running_late',
  'finished',
  'missed',
  'called_off',
  'moved',
] as const;
export type BoardState = (typeof BOARD_STATES)[number];

/**
 * The state a block shows (docs/SPEC/dispatch.md 4.4), read and never typed.
 * The status decides the settled states outright; a door reached is at the
 * door whatever the clock says; lateness overrides only the states in which
 * the practitioner has not yet arrived.
 */
export function boardState(
  stop: Progress,
  previous: Progress | null,
  late: boolean,
  now: Date,
): BoardState {
  switch (stop.status) {
    case 'completed':
      return 'finished';
    case 'no_show':
      return 'missed';
    case 'cancelled':
    case 'cancelled_late':
      return 'called_off';
    case 'rescheduled':
      return 'moved';
    case 'checked_in':
      return 'at_the_door';
    case 'proposed':
    case 'confirmed':
      break;
  }
  if (stop.checkedInAt !== null && stop.closedAt === null) return 'at_the_door';
  if (stop.closedAt !== null) return 'finished';
  if (late) return 'running_late';
  const previousClosed = previous !== null && previous.closedAt !== null;
  if (previousClosed && now.getTime() < stop.windowStart.getTime()) return 'on_the_way';
  return stop.status === 'proposed' ? 'waiting' : 'agreed';
}
