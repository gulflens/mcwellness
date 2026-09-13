import { isRealDate } from '@domain/shared';

/**
 * The arithmetic and the placement maths behind `CalendarPanel`, kept out of
 * the component so both can be tested without a browser. jsdom has no layout
 * engine, so "given these boxes and this viewport, where does the panel go"
 * has to be answerable from plain numbers or it cannot be tested at all — and
 * that decision is the whole reason this control exists (round 48: the native
 * picker opened off the right edge of a right-docked drawer and was clipped,
 * and a native picker's panel has no CSS surface in any browser).
 *
 * **Every date here is built and read locally.** `new Date('1986-09-30')`
 * parses as UTC midnight and `.toISOString()` on a locally-constructed date
 * shifts a day across the UTC+4 boundary the practice actually sits on. So
 * nothing in this file goes near `Date.parse` of an ISO string or
 * `toISOString()`: dates are three numbers, and the only `Date` that appears
 * is a scratch one built with local fields and read back with local getters.
 */

/** A day as three numbers, month 1-12. The form every function here speaks. */
export type DateParts = { readonly year: number; readonly month: number; readonly day: number };

/**
 * A scratch `Date` at local noon on the given day, with the fields set rather
 * than passed to the constructor.
 *
 * Noon, not midnight: in a timezone that springs forward at midnight there is
 * no 00:00 on that day and the clamp can move the calendar date. Dubai has no
 * daylight saving, but the test runner is not always in Dubai.
 *
 * `setFullYear` rather than `new Date(year, ...)`: the constructor remaps a
 * year of 0-99 onto 1900-1999, which would quietly rewrite a two-digit year.
 * `setFullYear` normalises out-of-range months and days exactly the same way,
 * so day 0 is the last day of the month before and day 32 is the first or
 * second of the month after.
 */
function localDate(year: number, month: number, day: number): Date {
  const date = new Date(2000, 0, 1, 12);
  date.setFullYear(year, month - 1, day);
  return date;
}

function partsOf(date: Date): DateParts {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** `1988-09-12` to its three numbers, and null for anything that is not a real day. */
export function partsFromIso(iso: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return null;
  const [, year, month, day] = match;
  const parts = { year: Number(year), month: Number(month), day: Number(day) };
  if (!isRealDate(parts.year, parts.month, parts.day)) return null;
  return parts;
}

/** Three numbers to the stored `YYYY-MM-DD`, built by padding and never by a `Date`. */
export function isoFromParts({ year, month, day }: DateParts): string {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

/** Today, where the person is sitting. */
export function todayParts(now: Date = new Date()): DateParts {
  return partsOf(now);
}

/** How many days the month has, leap years included. */
export function daysInMonth(year: number, month: number): number {
  return localDate(year, month + 1, 0).getDate();
}

/** The same day, moved by whole days. Month and year roll over on their own. */
export function shiftDays(parts: DateParts, days: number): DateParts {
  return partsOf(localDate(parts.year, parts.month, parts.day + days));
}

/**
 * The same day number in another month, clamped into it: a month on from 31
 * January is 28 or 29 February, not the 2nd or 3rd of March.
 */
export function shiftMonths(parts: DateParts, months: number): DateParts {
  const target = partsOf(localDate(parts.year, parts.month + months, 1));
  return { ...target, day: Math.min(parts.day, daysInMonth(target.year, target.month)) };
}

/** 0 for Monday through 6 for Sunday: the week the practice's country works. */
export function weekdayIndex(parts: DateParts): number {
  return (localDate(parts.year, parts.month, parts.day).getDay() + 6) % 7;
}

/**
 * The cells of one month's grid, Monday first: nulls for the days before the
 * first and after the last, and a whole number of weeks either way.
 */
export function monthGrid(
  year: number,
  month: number,
): ReadonlyArray<ReadonlyArray<number | null>> {
  const lead = weekdayIndex({ year, month, day: 1 });
  const total = daysInMonth(year, month);
  const cells: Array<number | null> = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= total; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<number | null>> = [];
  for (let start = 0; start < cells.length; start += 7) weeks.push(cells.slice(start, start + 7));
  return weeks;
}

/**
 * A bound only if it is a real day. `min` and `max` are legal as `''` — that
 * is what an unset from/to range bound to component state holds — and ISO
 * dates compare as strings, so an unchecked `''` upper bound would put every
 * day out of range.
 */
export function bound(value: string | undefined): string {
  if (!value) return '';
  return partsFromIso(value) === null ? '' : value;
}

/** Whether a day falls outside the bounds the caller set. Either may be `''`. */
export function outsideBounds(iso: string, min: string, max: string): boolean {
  if (min !== '' && iso < min) return true;
  if (max !== '' && iso > max) return true;
  return false;
}

/** The nearest day inside the bounds, so the grid never opens on a day nobody may choose. */
export function clampToBounds(iso: string, min: string, max: string): string {
  if (min !== '' && iso < min) return min;
  if (max !== '' && iso > max) return max;
  return iso;
}

/**
 * The day the grid opens on: the one already stored, today when the field is
 * empty or holds something that is not yet a date, and in either case pulled
 * into the bounds so the calendar never opens on a day nobody may choose.
 */
export function openingDay(value: string, today: DateParts, min: string, max: string): DateParts {
  const start = partsFromIso(value) ?? today;
  return partsFromIso(clampToBounds(isoFromParts(start), min, max)) ?? start;
}

/** A box in viewport coordinates, the four edges `getBoundingClientRect` gives. */
export type Box = {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
};

export type Size = { readonly width: number; readonly height: number };

/** Where the panel goes, in viewport coordinates, for `position: fixed`. */
export type Placement = {
  readonly top: number;
  readonly left: number;
  readonly side: 'below' | 'above';
};

/** The breathing room between the field and its panel. */
export const CALENDAR_GAP = 8;

/** The smallest gap kept between the panel and the edge of the viewport. */
export const CALENDAR_MARGIN = 8;

/**
 * Where a calendar panel of this size sits when opened from this field.
 *
 * `anchor` is the field's own box: its inline edges are the text box's, and
 * its block edges are the row the calendar button sits on, so the panel lines
 * up with the input rather than with a hint line under it.
 *
 * The contract, in order:
 *
 * 1. **Below by preference.** The panel opens under the field, `gap` below it.
 *    It flips above only when the room under the field is short of the panel's
 *    height. When neither side has room, the roomier side wins and the panel
 *    is slid to sit inside the viewport regardless.
 * 2. **Never off the block edges.** `top` is clamped to `[margin, viewport
 *    height − margin − panel height]`, and to `margin` alone when the panel is
 *    taller than the viewport.
 * 3. **Aligned to the field's inline start**, then pulled back along the
 *    inline axis by however much it overhangs, so it always sits fully inside
 *    the viewport with `margin` to spare. `direction` decides which edge the
 *    inline start is: the left in `ltr`, the right in `rtl`.
 *
 * Returns whole pixels — a panel on a half pixel draws a soft edge.
 */
export function placeCalendarPanel({
  anchor,
  panel,
  viewport,
  direction = 'ltr',
  gap = CALENDAR_GAP,
  margin = CALENDAR_MARGIN,
}: {
  anchor: Box;
  panel: Size;
  viewport: Size;
  direction?: 'ltr' | 'rtl';
  gap?: number;
  margin?: number;
}): Placement {
  const roomBelow = viewport.height - margin - (anchor.bottom + gap);
  const roomAbove = anchor.top - gap - margin;
  const side: 'below' | 'above' =
    panel.height <= roomBelow || (panel.height > roomAbove && roomBelow >= roomAbove)
      ? 'below'
      : 'above';

  const wanted = side === 'below' ? anchor.bottom + gap : anchor.top - gap - panel.height;
  const lowestTop = Math.max(margin, viewport.height - margin - panel.height);
  const top = Math.min(Math.max(wanted, margin), lowestTop);

  const inlineStart = direction === 'rtl' ? anchor.right - panel.width : anchor.left;
  const furthestLeft = Math.max(margin, viewport.width - margin - panel.width);
  const left = Math.min(Math.max(inlineStart, margin), furthestLeft);

  return { top: Math.round(top), left: Math.round(left), side };
}
