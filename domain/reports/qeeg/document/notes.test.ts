import { describe, expect, it } from 'vitest';
import { layoutNotesOf, UNPRINTABLE_LISTED } from './notes';
import type { Laid } from './place';

const uuid = (n: number) => `0000000d-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A laid report with the most a report can hold: eight maps and both sides of two pairs. */
function fullest(
  pages = 40,
): Pick<Laid, 'pages' | 'dashboardScale' | 'overflowing' | 'maps' | 'pairs'> {
  return {
    pages: Array.from({ length: pages }, () => ({ ops: [] })),
    dashboardScale: 0.8765432,
    overflowing: [],
    maps: Array.from({ length: 8 }, (_, n) => ({
      figureId: uuid(n),
      dpi: 123.456,
      quality: 'poor' as const,
    })),
    pairs: (['eyes_closed', 'eyes_open'] as const).flatMap((condition, n) =>
      (['earlier', 'later'] as const).map((side, m) => ({
        figureId: uuid(20 + n * 2 + m),
        condition,
        side,
        dpi: 99.9,
        quality: 'poor' as const,
      })),
    ),
  };
}

describe('layoutNotesOf', () => {
  it('rounds the dots to the inch and the scale, and keeps what ran over', () => {
    const notes = layoutNotesOf({ ...fullest(3), overflowing: ['summary.1'] }, []);
    expect(notes.pages).toBe(3);
    expect(notes.dashboardScale).toBe(0.877);
    expect(notes.maps[0]).toEqual({ figureId: uuid(0), dpi: 123, quality: 'poor' });
    expect(notes.overflowing).toEqual(['summary.1']);
    expect(notes.unprintable).toEqual([]);
    expect(notes.unprintableMore).toBe(0);
  });

  it('lists the first characters no face draws, and counts the rest', () => {
    const codes = Array.from(
      { length: 50 },
      (_, n) => `U+${(0x4e00 + n).toString(16).toUpperCase()}`,
    );
    const notes = layoutNotesOf(fullest(), codes);
    expect(notes.unprintable).toEqual(codes.slice(0, UNPRINTABLE_LISTED));
    expect(notes.unprintableMore).toBe(50 - UNPRINTABLE_LISTED);
  });

  it('stays well under a proxy’s 4 KB header buffer at its largest', () => {
    const codes = Array.from(
      { length: 5000 },
      (_, n) => `U+${(0x10000 + n).toString(16).toUpperCase()}`,
    );
    const header = JSON.stringify(layoutNotesOf(fullest(999), codes));
    expect(new TextEncoder().encode(header).length).toBeLessThan(3072);
    expect(/^[\x20-\x7e]*$/.test(header)).toBe(true);
  });
});
