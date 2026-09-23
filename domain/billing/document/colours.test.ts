import { describe, expect, it } from 'vitest';
import { CARD, EDGE, PILL, Sheet, VIOLET } from './render';
import type { Font, FontSet, Op } from '../../shared/document';

/**
 * The tints and the two card-shaped drawing primitives the practice's own
 * design needs (docs/superpowers/specs/2026-09-24-invoice-redesign-design.md,
 * "The page, top to bottom"): `CARD`, `EDGE` and `PILL` are arithmetic on
 * `VIOLET`, and `Sheet.card` / `Sheet.bandFill` are thin wrappers over the
 * writer's own `rect` op (`domain/shared/document/pdf.ts`).
 *
 * Both are testable with no font file, a database or a clock, which is
 * `render.ts`'s own rule for everything in it (its file-top comment) — so the
 * fixture below is a font with nothing in it: `rect`, `card` and `bandFill`
 * never measure a glyph.
 */

const blankFont: Font = {
  name: 'blank',
  program: new Uint8Array(),
  unitsPerEm: 1000,
  cmap: new Map(),
  widths: new Map(),
  numGlyphs: 0,
  bbox: [0, 0, 0, 0],
  ascent: 0,
  descent: 0,
  capHeight: 0,
  italicAngle: 0,
  arabic: false,
};
const fonts: FontSet = { regular: blankFont, bold: blankFont, arabic: blankFont };

/** The ops a single page of a fresh sheet holds after `draw` runs on it. */
function opsOf(draw: (sheet: Sheet) => void): Op[] {
  const sheet = new Sheet(fonts, { practice: '', reference: '' });
  draw(sheet);
  return sheet.finish()[0]?.ops ?? [];
}

describe('the card tints VIOLET is mixed toward white by', () => {
  it('pins CARD, the six per cent mix, to the design’s own #f3f0f7', () => {
    expect(CARD[0]).toBeCloseTo(0.953, 3);
    expect(CARD[1]).toBeCloseTo(0.941, 3);
    expect(CARD[2]).toBeCloseTo(0.967, 3);
  });

  it('pins EDGE, the fifteen per cent mix, to the design’s own #e1d9ea', () => {
    expect(EDGE[0]).toBeCloseTo(0.883, 3);
    expect(EDGE[1]).toBeCloseTo(0.852, 3);
    expect(EDGE[2]).toBeCloseTo(0.918, 3);
  });

  it('pins PILL, the twelve per cent mix, to the design’s own #e7e1ee', () => {
    expect(PILL[0]).toBeCloseTo(0.906, 3);
    expect(PILL[1]).toBeCloseTo(0.882, 3);
    expect(PILL[2]).toBeCloseTo(0.934, 3);
  });

  it('is the deeper mix wherever it is asked for more of the violet: EDGE < PILL < CARD in every channel', () => {
    [0, 1, 2].forEach((channel) => {
      const edge = EDGE[channel] as number;
      const pill = PILL[channel] as number;
      const card = CARD[channel] as number;
      const violet = VIOLET[channel] as number;
      expect(edge).toBeLessThan(pill);
      expect(pill).toBeLessThan(card);
      expect(card).toBeLessThan(1);
      expect(edge).toBeGreaterThan(violet);
    });
  });
});

describe('Sheet.rect', () => {
  it('pushes the op exactly as given, the bottom-left corner with no conversion at all', () => {
    const ops = opsOf((sheet) => sheet.rect(5, 12, 40, 18, { stroke: { grey: 0.5 } }));
    expect(ops).toEqual([
      { kind: 'rect', x: 5, y: 12, width: 40, height: 18, stroke: { grey: 0.5 } },
    ]);
  });
});

describe('Sheet.card', () => {
  it('pushes one rect op with the top edge converted to the op’s bottom-left corner, CARD filled and EDGE stroked', () => {
    const ops = opsOf((sheet) => sheet.card(10, 100, 200, 40));
    expect(ops).toEqual([
      {
        kind: 'rect',
        x: 10,
        // y = yTop - height = 100 - 40
        y: 60,
        width: 200,
        height: 40,
        fill: { rgb: CARD },
        stroke: { rgb: EDGE },
        radius: 6,
      },
    ]);
  });

  it('takes its own radius in place of the default 6', () => {
    const ops = opsOf((sheet) => sheet.card(0, 50, 100, 20, { radius: 999 }));
    expect(ops[0]).toMatchObject({ radius: 999 });
  });
});

describe('Sheet.bandFill', () => {
  it('pushes one rect op filled VIOLET, the same top-edge conversion as card, and no stroke', () => {
    const ops = opsOf((sheet) => sheet.bandFill(0, 500, 300, 24));
    expect(ops).toEqual([
      { kind: 'rect', x: 0, y: 476, width: 300, height: 24, fill: { rgb: VIOLET }, radius: 0 },
    ]);
  });

  it('takes a radius for the pill and the tax card’s left-edge bar', () => {
    const ops = opsOf((sheet) => sheet.bandFill(0, 20, 40, 20, 10));
    expect(ops[0]).toMatchObject({ radius: 10 });
  });
});
