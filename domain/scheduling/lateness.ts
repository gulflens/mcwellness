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
 * not cascade a single overrun into every later stop: the walk carries the
 * overrun forward as a delay on its cursor, and a stop far enough ahead is
 * saved by slack in the gap before its own window, not by anything to do
 * with waiting for a window to open — that wait (`Math.max` against
 * `windowStart`, below) handles the opposite case, a door reached early.
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
  // The session's own check-in instant, or — when the status alone says
  // checked in but the session recorded none (a seed can produce this) —
  // the window's own start standing in for it.
  const checkedInAt = stop.checkedInAt ?? (stop.status === 'checked_in' ? stop.windowStart : null);
  if (checkedInAt !== null) {
    // Still there: they leave when the service is done, or now if that has
    // already passed and they have not closed it — an overrun.
    const planned = checkedInAt.getTime() + stop.durationMinutes * MINUTE_MS;
    return new Date(Math.max(planned, now.getTime()));
  }
  return null;
}

/** Whether anything has happened at this stop that fixes the practitioner in time and place. */
function hasHappened(stop: Progress): boolean {
  return stop.closedAt !== null || stop.checkedInAt !== null || stop.status === 'checked_in';
}

/** The day in the order the rule reads it, however it arrives. */
function inWindowOrder(day: readonly Progress[]): Progress[] {
  return [...day].sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime());
}

/** The last stop, in window order, at which something happened; -1 when nothing has. */
function anchorIndexOf(stops: readonly Progress[]): number {
  let anchorIndex = -1;
  for (const [index, stop] of stops.entries()) {
    if (hasHappened(stop)) anchorIndex = index;
  }
  return anchorIndex;
}

/**
 * The stops `lateness` below will actually price a drive between, in window
 * order: the anchor the walk leaves from, and every stop after it that is
 * neither settled nor already reached. Empty when there is nothing left to
 * drive to, and the anchor alone is never a list — a lone place has no leg.
 *
 * It exists so a caller can size the drive matrix to the legs the rule can
 * ask for instead of to the whole day. Nothing else is priced: a stop before
 * the anchor is judged against the clock alone, a settled stop is not this
 * rule's to judge, and the walk never leaves from a home base. Keeping the
 * two in step is this file's business, which is why the list is derived here
 * from the same `hasHappened` and `isSettled` the walk itself uses.
 */
export function drivenStops(day: readonly Progress[]): Progress[] {
  const stops = inWindowOrder(day);
  const anchorIndex = anchorIndexOf(stops);
  const ahead = stops
    .slice(anchorIndex + 1)
    .filter((stop) => !isSettled(stop.status) && !hasHappened(stop));
  if (ahead.length === 0) return [];
  const anchor = anchorIndex < 0 ? [] : [stops[anchorIndex]!];
  return [...anchor, ...ahead];
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
  const stops = inWindowOrder(day);
  const result = new Map<string, Lateness>();
  for (const stop of stops) result.set(stop.stopId, NOT_LATE);

  // The anchor: the last stop, in window order, at which something happened.
  const anchorIndex = anchorIndexOf(stops);

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
    // The earliest possible arrival, but never earlier than now: an idle
    // practitioner does not make a stop less late by doing nothing.
    const arrival = new Date(Math.max(cursorTime.getTime() + driveSeconds * 1000, now.getTime()));
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
 * The four statuses in which nothing happened at the door: the visit was
 * called off on either side of the notice period, missed, or moved to an
 * appointment of its own. `completed` is settled too and did take place, so it
 * is not one of them.
 */
const NEVER_TOOK_PLACE: readonly AppointmentStatus[] = [
  'cancelled',
  'cancelled_late',
  'no_show',
  'rescheduled',
];

/**
 * "The previous visit" as `boardState` below means it (docs/SPEC/dispatch.md
 * 4.4, "the previous visit is closed"): the last stop before this one that
 * actually took place.
 *
 * The stop immediately before is the wrong answer whenever the day has a
 * call-off in it. A practitioner who closed the nine o'clock door, had the ten
 * o'clock called off and is now driving to the eleven o'clock one is on the
 * way to it; reading the cancellation as what they are coming from says
 * "Agreed" about a practitioner already in the car.
 *
 * `day` arrives in window order — `readDay`'s own `order by`, which is also
 * the order the board draws — and `index` is this stop's place in it. Pure.
 */
export function previousStop(day: readonly Progress[], index: number): Progress | null {
  for (let before = index - 1; before >= 0; before -= 1) {
    const stop = day[before]!;
    if (!NEVER_TOOK_PLACE.includes(stop.status)) return stop;
  }
  return null;
}

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
