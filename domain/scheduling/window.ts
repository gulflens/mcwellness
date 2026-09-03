/**
 * The arrival window every appointment promises: a fixed 45 minutes
 * (docs/SPEC/00-data-model.md section 9, decision 2). Client-facing copy
 * promises the window, never a clock time. Pure: no I/O, no clock read
 * inside (.claude/rules/testing.md) — the candidate start is always given.
 */

export const WINDOW_MINUTES = 45;

export type ArrivalWindow = { start: Date; end: Date };

/** The 45-minute window starting at `start`. */
export function windowFor(start: Date): ArrivalWindow {
  return { start, end: new Date(start.getTime() + WINDOW_MINUTES * 60_000) };
}

/**
 * An arrival window as a person reads it: "09:00–09:45", in the practice's own
 * zone, and in that order in every language.
 *
 * **The isolates are the point.** A time range is a run of left-to-right text,
 * and dropped bare into an Arabic paragraph the bidirectional algorithm
 * reorders it: the two clock times swap and the window reads 09:45–09:00,
 * which is not a smaller mistake than it looks — it is the practice telling a
 * household the wrong hour, on the screen the whole app exists to get right
 * (docs/DESIGN-BRIEF.md's RTL-safe-from-day-one rule, and the design review of
 * this pull request). U+2066 opens a left-to-right isolate and U+2069 closes
 * it, so the range is laid out on its own and takes its place in the sentence
 * around it without disturbing or being disturbed by it.
 *
 * Done here, once, rather than in each of the four screens that render a
 * window: a rule that has to be remembered is a rule that will be forgotten on
 * the fifth.
 */
const LTR_ISOLATE = '\u2066';
const POP_ISOLATE = '\u2069';

export function formatArrivalWindow(start: Date, end: Date, timeZone: string): string {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${LTR_ISOLATE}${format.format(start)}\u2013${format.format(end)}${POP_ISOLATE}`;
}
