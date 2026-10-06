import { describe, expect, it } from 'vitest';
import { LAVENDER, LAVENDER_EDGE, Sheet, VIOLET, WASH_FROM, WASH_TO, WHITE, wash } from './render';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../../shared/document';
import type { Font, FontSet, Op } from '../../shared/document';

/**
 * The named colours and the card-shaped drawing primitives of the practice's
 * softer dress of 7 October 2026 (docs/superpowers/specs/2026-10-07-soft-
 * documents-design.md): the violet ink, a lavender for bands and blocks, a
 * lavender edge for cards, the two ends of the page's wash — and
 * `Sheet.card` / `Sheet.bandFill` / `Sheet.lavenderFill`, thin wrappers over
 * the writer's own `rect` op (`domain/shared/document/pdf.ts`).
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

/** A colour as the six hex digits a designer would write it in. */
const hex = (rgb: readonly number[]): string =>
  rgb
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

describe('the named colours of the soft dress', () => {
  it('keeps the practice’s own violet, #380473, as the ink and the accent', () => {
    expect(hex(VIOLET)).toBe('380473');
  });

  it('pins LAVENDER, the bands and blocks, to #dccfef', () => {
    expect(hex(LAVENDER)).toBe('dccfef');
  });

  it('pins LAVENDER_EDGE, the cards’ borders and hairlines, to #e2d8ee', () => {
    expect(hex(LAVENDER_EDGE)).toBe('e2d8ee');
  });

  it('pins the wash from a lavender #e4daf2 to a warm near-white blush #fbf3f6', () => {
    expect(hex(WASH_FROM)).toBe('e4daf2');
    expect(hex(WASH_TO)).toBe('fbf3f6');
  });

  it('is lighter wherever it is less ink: LAVENDER < WASH_FROM < WASH_TO <= WHITE in lightness', () => {
    const light = (rgb: readonly number[]): number => rgb.reduce((total, c) => total + c, 0);
    expect(light(LAVENDER)).toBeLessThan(light(WASH_FROM));
    expect(light(WASH_FROM)).toBeLessThan(light(WASH_TO));
    expect(light(WASH_TO)).toBeLessThan(light(WHITE));
  });
});

describe('the wash', () => {
  it('covers the whole page, lavender at the top-right corner fading to blush toward the bottom-left', () => {
    const op = wash();
    expect(op).toMatchObject({ kind: 'shade', x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
    expect(op.from).toEqual({ x: PAGE_WIDTH, y: PAGE_HEIGHT, rgb: WASH_FROM });
    expect(op.to.rgb).toEqual(WASH_TO);
    // Down and to the left of where it starts.
    expect(op.to.x).toBeLessThan(op.from.x);
    expect(op.to.y).toBeLessThan(op.from.y);
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
  it('pushes one rect op with the top edge converted to the op’s bottom-left corner, WHITE filled and LAVENDER_EDGE stroked', () => {
    const ops = opsOf((sheet) => sheet.card(10, 100, 200, 40));
    expect(ops).toEqual([
      {
        kind: 'rect',
        x: 10,
        // y = yTop - height = 100 - 40
        y: 60,
        width: 200,
        height: 40,
        fill: { rgb: WHITE },
        stroke: { rgb: LAVENDER_EDGE },
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

  it('takes a radius', () => {
    const ops = opsOf((sheet) => sheet.bandFill(0, 20, 40, 20, 10));
    expect(ops[0]).toMatchObject({ radius: 10 });
  });
});

describe('Sheet.lavenderFill', () => {
  it('pushes one rect op filled LAVENDER, the same top-edge conversion, and no stroke', () => {
    const ops = opsOf((sheet) => sheet.lavenderFill(0, 500, 300, 24, 6));
    expect(ops).toEqual([
      { kind: 'rect', x: 0, y: 476, width: 300, height: 24, fill: { rgb: LAVENDER }, radius: 6 },
    ]);
  });
});
