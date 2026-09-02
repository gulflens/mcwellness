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
