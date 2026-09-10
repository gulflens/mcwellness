import { PRACTICE_UTC_OFFSET, timeOf } from '../windows';

/**
 * The board's columns (docs/SPEC/dispatch.md 4.2): fifteen-minute columns
 * across the practice's day, as `docs/SPEC/scheduling-manual.md` section 4.1
 * describes them for the week grid.
 *
 * The day runs from the hour before the first block to the hour after the
 * last one ends, and never narrower than 08:00 to 18:00, so an empty day
 * still has a shape rather than collapsing to nothing.
 *
 * Pure: no clock read inside, no DOM. The date is always given.
 */

export const QUARTER_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;

/** A rectangle of time. A visit's block, or the whole day's. */
export type Block = { start: Date; end: Date };

export type Span = Block & { columns: number };

/**
 * The day the board draws, snapped outwards to whole clock hours so the
 * column heads read as hours.
 *
 * Snapping in UTC milliseconds is the same as snapping in the practice's own
 * wall clock, because Asia/Dubai is a whole number of hours from UTC all year
 * (`app/admin/schedule/windows.ts` records why that holds).
 */
export function daySpan(date: string, blocks: readonly Block[]): Span {
  let start = new Date(`${date}T08:00:00${PRACTICE_UTC_OFFSET}`).getTime();
  let end = new Date(`${date}T18:00:00${PRACTICE_UTC_OFFSET}`).getTime();
  for (const block of blocks) {
    start = Math.min(start, block.start.getTime() - HOUR_MS);
    end = Math.max(end, block.end.getTime() + HOUR_MS);
  }
  start = Math.floor(start / HOUR_MS) * HOUR_MS;
  end = Math.ceil(end / HOUR_MS) * HOUR_MS;
  return { start: new Date(start), end: new Date(end), columns: (end - start) / QUARTER_MS };
}

/**
 * `grid-column: <start> / <end>` for a block, one-based and clipped to the
 * span. Never narrower than one column, so a block shorter than a quarter of
 * an hour is still something a person can see and take hold of.
 */
export function gridColumns(span: Span, block: Block): { start: number; end: number } {
  const first = Math.max(
    1,
    Math.floor((block.start.getTime() - span.start.getTime()) / QUARTER_MS) + 1,
  );
  const last = Math.min(
    span.columns + 1,
    Math.ceil((block.end.getTime() - span.start.getTime()) / QUARTER_MS) + 1,
  );
  return { start: first, end: Math.max(first + 1, last) };
}

/** The clock hours across the top, one every four columns. */
export function hourLabels(span: Span): { label: string; column: number }[] {
  const labels: { label: string; column: number }[] = [];
  for (let column = 1; column <= span.columns; column += 4) {
    const at = new Date(span.start.getTime() + (column - 1) * QUARTER_MS);
    labels.push({ label: timeOf(at.toISOString()), column });
  }
  return labels;
}

/**
 * Which row inside a lane each block takes, so that blocks overlapping in
 * time are kept apart on the fewest rows that will hold them (spec 4.2:
 * one row per practitioner, and blocks that overlap stack within the lane).
 *
 * A block spans its window *plus* the service that follows it, so a
 * practitioner seeing a household every hour has every block overlapping its
 * neighbour: left to the browser's own auto-placement, whose cursor never
 * returns to an earlier row, five such visits became a five-step staircase
 * seven hundred pixels tall (the seeded walk, spec 13). Placed here instead,
 * because a browser's packing is neither testable nor visible to the next
 * reader of this file.
 *
 * First fit, in start order: a block goes on the first row whose last block
 * ends at or before it starts — touching is not overlapping — and otherwise
 * opens a new one. For intervals sorted by start, that is the minimum number
 * of rows. Blocks must arrive in start order, which is the order the route
 * sends a practitioner's visits and the order they are drawn in, so a
 * later-starting block can never land above an earlier one.
 *
 * Returns one 1-based row per block, in the order given. Pure.
 */
export function laneRows(blocks: readonly Block[]): number[] {
  /** When the last block on each row so far ends. */
  const endsAt: number[] = [];
  return blocks.map((block) => {
    const found = endsAt.findIndex((end) => end <= block.start.getTime());
    const row = found === -1 ? endsAt.length : found;
    endsAt[row] = block.end.getTime();
    return row + 1;
  });
}

/** A block spans its arrival window plus the service's own length (4.2). */
export function blockOf(visit: {
  windowStart: string;
  windowEnd: string;
  serviceType: { durationMinutes: number };
}): Block {
  return {
    start: new Date(visit.windowStart),
    end: new Date(new Date(visit.windowEnd).getTime() + visit.serviceType.durationMinutes * 60_000),
  };
}
