import { describe, expect, it } from 'vitest';
import { PAGE_HEIGHT, PAGE_WIDTH } from '@domain/shared/document';
import {
  BAND_ICON,
  BAND_WAVE,
  BODY_WIDTH,
  BULLETS,
  CARD,
  CONNECTIVITY,
  FOOTER,
  GAP,
  GRID,
  HEADER,
  MAP,
  PAD,
  PANEL,
  PILL,
  RING,
  ROW,
  SIGNATURE,
  bodyHeight,
  bodyTop,
  cardWidth,
  columnWidth,
  panelColumnWidth,
} from './geometry';
import { mm } from './metrics';
import { REPORT_BANDS } from './palette';
import { styleOf } from './styles';

const GROUPS = {
  PAD,
  HEADER,
  GAP,
  BULLETS,
  BAND_ICON,
  BAND_WAVE,
  CONNECTIVITY,
  CARD,
  GRID,
  RING,
  PANEL,
  ROW,
  PILL,
  SIGNATURE,
  FOOTER,
  MAP,
};

function numbersIn(value: unknown, at: string): [string, number][] {
  if (typeof value === 'number') return [[at, value]];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => numbersIn(inner, `${at}.${key}`));
}

describe('the measurements of a page', () => {
  it('is an A4 page with 17 mm at each side, as the practice’s report has', () => {
    expect(PAD).toEqual({ top: mm(11), side: mm(17), bottom: mm(8) });
    expect(BODY_WIDTH).toBeCloseTo(PAGE_WIDTH - 2 * mm(17), 9);
    expect(BODY_WIDTH).toBeCloseTo(498.9, 1);
  });

  it('holds the logo in its header, twice as wide as it is tall', () => {
    expect(HEADER.logo.width).toBe(2 * HEADER.logo.height);
    expect(HEADER.logo.height).toBeLessThanOrEqual(HEADER.height);
    expect(HEADER.height).toBeCloseTo(mm(31), 9);
  });

  it('starts the body under the header', () => {
    expect(bodyTop()).toBeCloseTo(PAGE_HEIGHT - mm(11) - mm(31), 9);
  });

  it('gives the body what the header, the footer and the margins leave', () => {
    expect(bodyHeight(30)).toBeCloseTo(PAGE_HEIGHT - mm(11) - mm(8) - mm(31) - 30, 9);
  });

  it('refuses a footer that is no height, or leaves no body, by name', () => {
    expect(() => bodyHeight(Number.NaN)).toThrow(/bodyHeight needs a finite footer height/);
    expect(() => bodyHeight(-1)).toThrow(/bodyHeight needs a footer height of zero or more/);
    expect(() => bodyHeight(PAGE_HEIGHT)).toThrow(/bodyHeight is left no body/);
  });
});

describe('the columns of a page', () => {
  it('fills the body with three cards and the two gaps between them', () => {
    expect(3 * cardWidth(BODY_WIDTH) + 2 * GRID.columnGap).toBeCloseTo(BODY_WIDTH, 9);
    expect(GRID).toMatchObject({ columns: 3, rows: 2 });
  });

  it('fills the body with two columns of a list and the gutter between them', () => {
    expect(2 * columnWidth(BODY_WIDTH) + BULLETS.gutter).toBeCloseTo(BODY_WIDTH, 9);
  });

  it('fills the panel’s inside with its two columns and their gutter', () => {
    expect(2 * panelColumnWidth(BODY_WIDTH) + PANEL.gutter + 2 * PANEL.padH).toBeCloseTo(
      BODY_WIDTH,
      9,
    );
  });

  it('leaves the text of a row room beside its number and its name', () => {
    expect(ROW.number + ROW.gutter + ROW.name + ROW.gutter).toBeLessThan(BODY_WIDTH / 2);
  });

  it('refuses a width that is no width, by name', () => {
    expect(() => cardWidth(Number.NaN)).toThrow(/cardWidth needs a finite width/);
    expect(() => columnWidth(5)).toThrow(/columnWidth is left no column/);
    expect(() => panelColumnWidth(10)).toThrow(/panelColumnWidth is left no column/);
  });
});

describe('the figures', () => {
  it('draws a slower band with fewer, taller waves', () => {
    expect(Object.keys(BAND_WAVE)).toEqual([...REPORT_BANDS]);
    REPORT_BANDS.forEach((band, index) => {
      const slower = REPORT_BANDS[index - 1];
      if (!slower) return;
      expect(BAND_WAVE[band].cycles).toBeGreaterThan(BAND_WAVE[slower].cycles);
      expect(BAND_WAVE[band].amplitude).toBeLessThan(BAND_WAVE[slower].amplitude);
    });
  });

  it('keeps every wave, and the width of its line, inside its disc', () => {
    const half = (BAND_ICON.waveTo - BAND_ICON.waveFrom) / 2;
    const middle = BAND_ICON.box / 2;
    expect((BAND_ICON.waveFrom + BAND_ICON.waveTo) / 2).toBe(middle);
    // The room above the wave's end, where the disc is narrowest for it.
    const room = Math.sqrt(BAND_ICON.discRadius ** 2 - half ** 2);
    for (const band of REPORT_BANDS) {
      expect(BAND_WAVE[band].amplitude + BAND_ICON.waveLine / 2).toBeLessThan(room);
    }
  });

  it('keeps the disc and its ring inside the icon’s box', () => {
    expect(BAND_ICON.discRadius + BAND_ICON.ringLine / 2).toBeLessThanOrEqual(BAND_ICON.box / 2);
  });

  it('keeps a score’s ring inside its box, and its two lines of figures inside the ring', () => {
    expect(RING.radius + RING.line / 2).toBeLessThanOrEqual(RING.box / 2);
    const inner = RING.radius - RING.line / 2;
    const middle = RING.box / 2;
    expect(RING.scoreBaseline - RING.scoreSize).toBeGreaterThan(middle - inner);
    expect(RING.outOfBaseline).toBeLessThan(middle + inner);
  });

  it('draws the dash of a card’s list as an en dash of its type, inside the indent', () => {
    const { size } = styleOf('cardBullet', 'ltr').style;
    expect(CARD.dash).toBeCloseTo(size / 2, 9);
    expect(CARD.dash).toBeLessThan(CARD.bulletIndent);
    expect(CARD.dashLine).toBeLessThan(CARD.dash);
    // Its middle stands above the baseline and below the top of a small letter.
    expect(CARD.dashRise - CARD.dashLine / 2).toBeGreaterThan(0);
    expect(CARD.dashRise + CARD.dashLine / 2).toBeLessThan(size / 2);
  });

  it('starts a list in two columns above six', () => {
    expect(BULLETS.columnsAbove).toBe(6);
  });
});

describe('every measurement', () => {
  it('is a number, and none is below nothing', () => {
    const all = numbersIn(GROUPS, 'geometry');
    expect(all.length).toBeGreaterThan(80);
    for (const [at, value] of all) {
      expect(Number.isFinite(value), at).toBe(true);
      expect(value, at).toBeGreaterThanOrEqual(0);
    }
  });

  it('cannot be changed by whoever holds it', () => {
    for (const [name, group] of Object.entries(GROUPS)) {
      expect(Object.isFrozen(group), name).toBe(true);
    }
    expect(Object.isFrozen(HEADER.logo)).toBe(true);
    expect(Object.isFrozen(BAND_WAVE.delta)).toBe(true);
  });
});
