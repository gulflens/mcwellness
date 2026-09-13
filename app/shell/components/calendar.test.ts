import { describe, expect, it } from 'vitest';
import {
  bound,
  clampToBounds,
  daysInMonth,
  isoFromParts,
  monthGrid,
  openingDay,
  outsideBounds,
  partsFromIso,
  placeCalendarPanel,
  shiftDays,
  shiftMonths,
  todayParts,
  weekdayIndex,
} from './calendar';

// jsdom has no layout engine, so the placement maths lives here as a pure
// function and is tested with fabricated boxes rather than a real panel.
// Everything else in this file guards the timezone trap: the practice sits at
// UTC+4 and this suite must pass whatever timezone the runner is in, which it
// only does because not one date here is built from an ISO string or read back
// through toISOString().

const panel = { width: 336, height: 320 };
const viewport = { width: 1280, height: 800 };

/** A field sitting comfortably in the middle of the page. */
function fieldAt(left: number, top: number, width = 280, height = 44) {
  return { left, right: left + width, top, bottom: top + height };
}

describe('placeCalendarPanel', () => {
  it('opens below the field, a gap under it, aligned to its inline start', () => {
    const placed = placeCalendarPanel({ anchor: fieldAt(120, 200), panel, viewport });
    expect(placed).toEqual({ top: 252, left: 120, side: 'below' });
  });

  it('flips above when the room below is short of the panel', () => {
    const placed = placeCalendarPanel({ anchor: fieldAt(120, 600), panel, viewport });
    expect(placed.side).toBe('above');
    expect(placed.top).toBe(600 - 8 - 320);
  });

  it('stays below when below is the roomier of two rooms that both fail', () => {
    const huge = { width: 400, height: 700 };
    const placed = placeCalendarPanel({ anchor: fieldAt(0, 100), panel: huge, viewport });
    expect(placed.side).toBe('below');
    // Slid up off its preferred 152 so the whole panel is inside the viewport.
    expect(placed.top).toBe(800 - 8 - 700);
  });

  it('pins the panel to the top margin when it is taller than the viewport', () => {
    const tall = { width: 336, height: 900 };
    const placed = placeCalendarPanel({ anchor: fieldAt(0, 100), panel: tall, viewport });
    expect(placed.top).toBe(8);
  });

  // The whole reason this control exists: a field in a drawer docked to the
  // right edge, where the browser's own picker opened outwards and was clipped.
  it('pulls the panel back inside when the field sits against the outer edge', () => {
    const drawer = fieldAt(1180, 200, 90);
    const placed = placeCalendarPanel({ anchor: drawer, panel, viewport });
    expect(placed.left).toBe(1280 - 8 - 336);
    expect(placed.left + panel.width).toBeLessThanOrEqual(viewport.width - 8);
  });

  it('never leaves the inline start off the near edge either', () => {
    const placed = placeCalendarPanel({ anchor: fieldAt(-40, 200), panel, viewport });
    expect(placed.left).toBe(8);
  });

  it('keeps the panel inside a viewport narrower than the panel itself', () => {
    const phone = { width: 320, height: 700 };
    const placed = placeCalendarPanel({ anchor: fieldAt(16, 200), panel, viewport: phone });
    expect(placed.left).toBe(8);
  });

  it('aligns to the right edge of the field in Arabic', () => {
    const placed = placeCalendarPanel({
      anchor: fieldAt(600, 200),
      panel,
      viewport,
      direction: 'rtl',
    });
    expect(placed.left).toBe(880 - 336);
  });

  it('is never clipped, wherever the field is and whichever way the page runs', () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      for (const width of [320, 768, 1280]) {
        for (const left of [-20, 0, 40, width - 200, width - 40, width + 10]) {
          for (const top of [-10, 0, 120, 500, 780]) {
            const placed = placeCalendarPanel({
              anchor: fieldAt(left, top),
              panel,
              viewport: { width, height: 800 },
              direction,
            });
            expect(placed.left).toBeGreaterThanOrEqual(8);
            expect(placed.top).toBeGreaterThanOrEqual(8);
            expect(placed.left + panel.width).toBeLessThanOrEqual(Math.max(width - 8, 8 + 336));
            expect(placed.top + panel.height).toBeLessThanOrEqual(800 - 8);
          }
        }
      }
    }
  });
});

describe('the calendar reads and writes days without crossing a timezone', () => {
  it('reads a stored date as its own three numbers', () => {
    expect(partsFromIso('1988-09-12')).toEqual({ year: 1988, month: 9, day: 12 });
  });

  it('refuses a day the calendar does not have', () => {
    expect(partsFromIso('2026-02-31')).toBeNull();
    expect(partsFromIso('')).toBeNull();
    expect(partsFromIso('12/09/1988')).toBeNull();
  });

  it('writes the three numbers back as the stored form', () => {
    expect(isoFromParts({ year: 2026, month: 1, day: 1 })).toBe('2026-01-01');
    expect(isoFromParts({ year: 2026, month: 12, day: 31 })).toBe('2026-12-31');
  });

  it('survives a round trip on the two days a UTC shift would move', () => {
    for (const iso of ['2026-01-01', '2026-12-31']) {
      const parts = partsFromIso(iso);
      expect(parts).not.toBeNull();
      expect(parts === null ? '' : isoFromParts(parts)).toBe(iso);
    }
  });

  it('steps over the new year without losing or gaining a day', () => {
    expect(shiftDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
    expect(shiftDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
  });

  it('steps a week at a time across a month boundary', () => {
    expect(shiftDays({ year: 2026, month: 2, day: 26 }, 7)).toEqual({
      year: 2026,
      month: 3,
      day: 5,
    });
  });

  it('counts February in a leap year and in a common one', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it('clamps the day into the month a page turn lands on', () => {
    expect(shiftMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(shiftMonths({ year: 2026, month: 1, day: 15 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 15,
    });
  });

  it('starts the week on Monday', () => {
    // 2026-09-14 is a Monday, 2026-09-20 the Sunday that ends its week.
    expect(weekdayIndex({ year: 2026, month: 9, day: 14 })).toBe(0);
    expect(weekdayIndex({ year: 2026, month: 9, day: 20 })).toBe(6);
  });

  it('reads today from the clock with local getters', () => {
    const now = new Date(2026, 8, 13, 23, 30);
    expect(todayParts(now)).toEqual({ year: 2026, month: 9, day: 13 });
  });
});

describe('the month grid', () => {
  it('leads with blanks up to the first of the month and pads to whole weeks', () => {
    // 1 September 2026 is a Tuesday, so one blank leads the first week.
    const weeks = monthGrid(2026, 9);
    expect(weeks[0]).toEqual([null, 1, 2, 3, 4, 5, 6]);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().filter((day) => day !== null)).toHaveLength(30);
  });

  it('gives February in a leap year its 29 days', () => {
    expect(monthGrid(2024, 2).flat().filter(Boolean)).toHaveLength(29);
  });
});

describe('bounds', () => {
  it('ignores a bound that is not a real day, including the empty string', () => {
    expect(bound('')).toBe('');
    expect(bound(undefined)).toBe('');
    expect(bound('2026-02-31')).toBe('');
    expect(bound('2026-02-28')).toBe('2026-02-28');
  });

  it('puts a day outside the range out of reach', () => {
    expect(outsideBounds('2019-12-31', '2020-01-01', '')).toBe(true);
    expect(outsideBounds('2020-01-01', '2020-01-01', '')).toBe(false);
    expect(outsideBounds('2026-01-02', '', '2026-01-01')).toBe(true);
    expect(outsideBounds('2026-01-02', '', '')).toBe(false);
  });

  it('pulls a day back to the nearest bound', () => {
    expect(clampToBounds('2019-01-01', '2020-01-01', '')).toBe('2020-01-01');
    expect(clampToBounds('2030-01-01', '', '2026-01-01')).toBe('2026-01-01');
    expect(clampToBounds('2023-01-01', '2020-01-01', '2026-01-01')).toBe('2023-01-01');
  });
});

describe('openingDay', () => {
  const today = { year: 2026, month: 9, day: 13 };

  it('opens on the day already stored', () => {
    expect(openingDay('1988-09-12', today, '', '')).toEqual({ year: 1988, month: 9, day: 12 });
  });

  it('opens on today when the field is empty', () => {
    expect(openingDay('', today, '', '')).toEqual(today);
  });

  it('never opens on a day outside the bounds', () => {
    expect(openingDay('', today, '2027-01-01', '')).toEqual({ year: 2027, month: 1, day: 1 });
    expect(openingDay('2030-05-05', today, '', '2026-01-01')).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
  });
});
