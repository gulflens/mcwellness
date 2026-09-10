import { formatArrivalWindow, windowFor } from '@domain/scheduling';

/**
 * Turning what a coordinator types — a date and a start time — into the
 * instant an arrival window opens, and back again. Shared by the booking
 * drawer and the move drawer so the two cannot drift.
 */

/** Asia/Dubai carries no daylight-saving change, so a wall-clock time in the
 * practice's own day is always this far from UTC. Kept independently here,
 * beside the same constant in app/api/appointments/list.ts, options.ts,
 * create.ts and move.ts: a screen and a route agreeing by accident is worse
 * than each stating it. */
export const PRACTICE_UTC_OFFSET = '+04:00';

export const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: PRACTICE_TIME_ZONE });

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** Today in the practice's zone, as YYYY-MM-DD. */
export function practiceDay(now: Date): string {
  return DATE_FORMAT.format(now);
}

/** The calendar day an instant falls on in the practice's zone, as YYYY-MM-DD. */
export function dayOf(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

/** The wall-clock start time an instant falls on in the practice's zone, as HH:MM. */
export function timeOf(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

/**
 * "09:00–09:45", in the practice's zone, and in that order in Arabic too:
 * `formatArrivalWindow` wraps the range in bidirectional isolates so the two
 * clock times cannot swap inside a right-to-left paragraph
 * (domain/scheduling/window.ts explains what that would mean).
 */
export function formatWindow(windowStart: string, windowEnd: string): string {
  return formatArrivalWindow(new Date(windowStart), new Date(windowEnd), PRACTICE_TIME_ZONE);
}

/** "Mon 8 Sep", for a column heading or a line of context. */
export function formatDay(day: string): string {
  return DAY_FORMAT.format(new Date(`${day}T00:00:00${PRACTICE_UTC_OFFSET}`));
}

/**
 * The arrival window's end for a typed start time, computed by
 * `domain/scheduling`'s own `windowFor` rather than a locally-mirrored
 * constant. The reference date is arbitrary — only the wall-clock time
 * carries meaning here — so wrapping past midnight lands on the next day
 * harmlessly; a session starting that late is out of scope.
 */
export function windowEndForTime(time: string): string {
  const [hours, mins] = time.split(':').map(Number);
  const { end } = windowFor(new Date(2000, 0, 1, hours ?? 0, mins ?? 0));
  const hh = String(end.getHours()).padStart(2, '0');
  const mm = String(end.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** A day and a wall-clock time in the practice's zone, as an instant. */
export function composeWindowStart(date: string, time: string): string {
  return new Date(`${date}T${time}:00${PRACTICE_UTC_OFFSET}`).toISOString();
}

/**
 * "Fri 11 Sept 10:00", the way a rescheduled row names where the visit
 * went — the same day-and-time the move drawer itself shows
 * (`formatDay(dayOf(...))` beside the window, MoveAppointmentDrawer.tsx),
 * composed rather than a second Intl formatter of its own: the drawer shows
 * a window (`formatWindow`, a start and an end); this shows only the start
 * a rescheduled row's `movedTo` carries.
 */
export function formatMovedTo(iso: string): string {
  return `${formatDay(dayOf(iso))} ${timeOf(iso)}`;
}

/** The day `offset` days after `day`, as YYYY-MM-DD. */
export function addDays(day: string, offset: number): string {
  const start = new Date(`${day}T00:00:00${PRACTICE_UTC_OFFSET}`);
  return DATE_FORMAT.format(new Date(start.getTime() + offset * 24 * 60 * 60_000));
}
