import { describe, expect, it } from 'vitest';
import { PAGE_HEIGHT, PAGE_WIDTH } from '@domain/shared/document';
import {
  BAND_ICON,
  BAND_WAVE,
  BODY_WIDTH,
  BULLETS,
  CARD,
  CHANGE,
  CONNECTIVITY,
  FOOTER,
  GAP,
  GRID,
  HEADER,
  MAP,
  MARKER,
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
  CHANGE,
  MARKER,
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

  it('keeps a map of a pair between the least and the preferred height of N7', () => {
    expect(CHANGE.mapLeast).toBe(96);
    expect(CHANGE.mapPreferred).toBe(190);
    expect(CHANGE.mapLeast).toBeLessThan(CHANGE.mapPreferred);
  });

  it('draws each marker no taller than the capitals of the words it stands before', () => {
    // A capital of the report's face stands about seven tenths of its size.
    expect(MARKER.cell).toBeLessThan(0.7 * styleOf('body', 'ltr').style.size);
    expect(MARKER.card).toBeLessThan(0.7 * styleOf('cardSummary', 'ltr').style.size);
    expect(MARKER.headline).toBeLessThan(0.7 * styleOf('headline', 'ltr').style.size);
  });

  it('leaves the two figures of the change table room beside the measure', () => {
    const figure = (BODY_WIDTH - CHANGE.measure - 2 * CHANGE.cellGutter) / 2;
    expect(figure).toBeGreaterThan(CHANGE.measure / 2);
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

describe('the practice’s measurements, written out', () => {
  /**
   * Written out, and not read back from the module, so that a number changed
   * there by a slip is a number that no longer agrees with this table. In
   * millimetres where the practice's layout is, in points where it is, and
   * on a figure's own grid where the figure was drawn on one. The review of
   * the pieces changed fourteen of these by a little, one at a time, and ten
   * of the changes passed every test there was.
   */
  it('holds the page', () => {
    expect(PAD).toEqual({ top: mm(11), side: mm(17), bottom: mm(8) });
    expect(HEADER).toEqual({ height: mm(31), logo: { width: mm(52), height: mm(26) } });
    expect(FOOTER).toEqual({ rule: 0.5, padTop: mm(2.5), gutter: mm(8) });
    expect(MAP).toEqual({ labelGap: mm(4), reserve: mm(3) });
  });

  it('holds the page of what has changed, and the marker of a figure that moved', () => {
    expect(CHANGE).toEqual({
      tilesMost: 3,
      tilePadH: mm(4),
      tilePadV: mm(3.2),
      tileRadius: mm(2.5),
      tileEdge: 0.6,
      tileGutter: mm(4),
      tileGap: mm(1.2),
      afterHeadlines: mm(6),
      pairGutter: mm(8),
      pairLabelGap: mm(1.5),
      afterPair: mm(4),
      mapLeast: 96,
      mapPreferred: 190,
      measure: mm(58),
      cellGutter: mm(4),
      cellPadV: mm(1.8),
      rule: 0.5,
    });
    expect(MARKER).toEqual({ cell: 5.5, card: 4.5, headline: 8, gutter: mm(1.2) });
  });

  it('holds the room between one block and the next', () => {
    expect(GAP).toEqual({
      afterPanel: mm(6),
      afterHeading: mm(2.2),
      afterSubheading: mm(2),
      afterParagraph: mm(3),
      afterList: mm(3),
      afterBand: mm(2.6),
      afterConnectivity: mm(3),
      afterNote: mm(3.4),
      beforeLateHeading: mm(6),
      beforeSignature: mm(6),
      noteRaisedBy: mm(1),
      betweenParagraphs: mm(3),
    });
  });

  it('holds a list', () => {
    expect(BULLETS).toEqual({
      indent: mm(6.5),
      diamond: mm(2.4),
      diamondInset: mm(1.2),
      diamondTop: mm(1.7),
      rowGap: mm(1.8),
      gutter: mm(10),
      columnsAbove: 6,
    });
  });

  it('holds a band’s icon, on its grid of 48, and the wave of each band', () => {
    expect(BAND_ICON).toEqual({
      size: mm(15),
      gutter: mm(4),
      top: mm(0.6),
      lineGap: mm(0.7),
      findingGap: mm(1.6),
      box: 48,
      discRadius: 22,
      ringLine: 1.5,
      waveLine: 2.1,
      waveFrom: 11,
      waveTo: 37,
    });
    expect(BAND_WAVE).toEqual({
      delta: { cycles: 1, amplitude: 9 },
      theta: { cycles: 2, amplitude: 7.5 },
      alpha: { cycles: 3, amplitude: 6 },
      beta: { cycles: 4.5, amplitude: 4.5 },
      high_beta: { cycles: 6, amplitude: 3.5 },
    });
  });

  it('holds a block of connectivity', () => {
    expect(CONNECTIVITY).toEqual({ bar: 2.2, inset: mm(4), gap: mm(1) });
  });

  it('holds a card, and the dashboard it stands in', () => {
    expect(CARD).toEqual({
      radius: mm(2),
      edge: 0.6,
      accent: 2.6,
      padV: mm(2.8),
      padH: mm(3.4),
      gap: mm(1.8),
      labelGap: mm(1),
      ring: mm(11),
      ringGutter: mm(2.6),
      titleTop: mm(0.5),
      bulletIndent: mm(3.4),
      bulletGap: mm(0.7),
      rule: 0.5,
      ruleGap: mm(1.5),
      dash: 4.2,
      dashLine: 0.7,
      dashRise: 2.3,
    });
    expect(GRID).toEqual({ columns: 3, rows: 2, columnGap: mm(4), rowGap: mm(3.2) });
  });

  it('holds a score’s ring, on its grid of 40', () => {
    expect(RING).toEqual({
      box: 40,
      radius: 17,
      line: 3,
      scoreSize: 13,
      scoreBaseline: 22,
      outOfSize: 5,
      outOfBaseline: 29,
      unsetDash: 8,
      unsetLine: 2,
    });
  });

  it('draws the mark of a score not yet given inside the ring, across its middle', () => {
    const inner = RING.radius - RING.line / 2;
    expect(RING.unsetDash).toBeLessThan(inner);
    expect(RING.unsetLine).toBeLessThanOrEqual(RING.line);
  });

  it('holds the panel, a row, the pill and the signature', () => {
    expect(PANEL).toEqual({
      padH: mm(4.5),
      padV: mm(3.6),
      gutter: mm(10),
      radius: mm(2.5),
      edge: 0.6,
      headGap: mm(1.5),
      lineGap: mm(0.9),
    });
    expect(ROW).toEqual({ number: mm(11), name: mm(46), gutter: mm(3), padV: mm(2.4), rule: 0.5 });
    expect(PILL).toEqual({ padV: mm(1.4), padH: mm(5), edge: 1, above: mm(1), below: mm(3) });
    expect(SIGNATURE).toEqual({ width: mm(70), rule: 0.75, gap: mm(1.8), room: mm(12) });
  });
});
