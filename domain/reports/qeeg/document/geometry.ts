/**
 * The measurements of the brain-map report: its page, its gaps, and every
 * length inside each of its pieces.
 *
 * **They are the practice's**, from the report a household knows
 * (`docs/SPEC/reports-qeeg.md` section 18, decision 2). Every number a piece
 * needs is here, named, so that a piece holds no number of its own and a
 * change to the layout is a change to one file.
 *
 * **Units.** Points, unless a group says otherwise. Two figures were drawn on
 * grids of their own, and keep them: a band icon on a square of 48 and a
 * score's ring on a square of 40. A length in one of those groups is in the
 * units of its grid, and the piece multiplies by the size it draws at.
 *
 * **Start and end, never left and right.** A piece asks a frame where its
 * start is (`frame.ts`), so nothing here names a side of the page.
 */

import { PAGE_HEIGHT, PAGE_WIDTH } from '@domain/shared/document';
import { finite, mm } from './metrics';
import type { ReportBand } from './palette';

function frozen<const T extends object>(value: T): Readonly<T> {
  for (const inner of Object.values(value)) {
    if (inner !== null && typeof inner === 'object') Object.freeze(inner);
  }
  return Object.freeze(value);
}

/** The page's margins. */
export const PAD = frozen({ top: mm(11), side: mm(17), bottom: mm(8) });

export const BODY_WIDTH = PAGE_WIDTH - 2 * PAD.side;

/** The band at the head of every page: the logo, and the room under it. */
export const HEADER = frozen({
  height: mm(26) + mm(5),
  logo: { width: mm(52), height: mm(26) },
});

/** How far up the page the top of the body is, as PDF measures. */
export function bodyTop(): number {
  return PAGE_HEIGHT - PAD.top - HEADER.height;
}

/** What the margins, the header and a footer of this height leave for the body. */
export function bodyHeight(footerHeight: number): number {
  finite('bodyHeight', 'footer height', footerHeight);
  if (footerHeight < 0) {
    throw new RangeError(
      `bodyHeight needs a footer height of zero or more, and was given ${footerHeight}.`,
    );
  }
  const left = PAGE_HEIGHT - PAD.top - PAD.bottom - HEADER.height - footerHeight;
  if (left <= 0) {
    throw new RangeError(`bodyHeight is left no body by a footer ${footerHeight} tall.`);
  }
  return left;
}

/** The room under a block, by what the block is, and two rooms above. */
export const GAP = frozen({
  afterPanel: mm(6),
  afterHeading: mm(2.2),
  afterSubheading: mm(2),
  afterParagraph: mm(3),
  afterList: mm(3),
  afterBand: mm(2.6),
  afterConnectivity: mm(3),
  afterNote: mm(3.4),
  /** A heading that does not start a page: the summary's and the benefits'. */
  beforeLateHeading: mm(6),
  beforeSignature: mm(6),
  /** The note under the dashboard's heading is drawn up towards it by this. */
  noteRaisedBy: mm(1),
  betweenParagraphs: mm(3),
});

/** A list whose marker is a diamond. */
export const BULLETS = frozen({
  /** From the start edge to the text. */
  indent: mm(6.5),
  /** The side of the diamond's square, before it is turned on its point. */
  diamond: mm(2.4),
  /** From the start edge to the diamond's box, and from the row's top to it. */
  diamondInset: mm(1.2),
  diamondTop: mm(1.7),
  rowGap: mm(1.8),
  gutter: mm(10),
  /** A list of more than this many items is set in two columns. */
  columnsAbove: 6,
});

/** One of two columns of a list, in a body of this width. */
export function columnWidth(width: number): number {
  finite('columnWidth', 'width', width);
  const column = (width - BULLETS.gutter) / 2;
  if (column <= 0) throw new RangeError(`columnWidth is left no column by a width of ${width}.`);
  return column;
}

/**
 * A band's icon. `size`, `gutter`, `top` and the two gaps are in points; the
 * rest is on the icon's own grid of 48, `y` measured down from its top.
 */
export const BAND_ICON = frozen({
  size: mm(15),
  /** Between the icon and the text beside it. */
  gutter: mm(4),
  /** The icon is lowered by this, to sit level with the first line. */
  top: mm(0.6),
  /** Between the first line and the second, and between the second and the finding. */
  lineGap: mm(0.7),
  findingGap: mm(1.6),
  box: 48,
  discRadius: 22,
  ringLine: 1.5,
  waveLine: 2.1,
  waveFrom: 11,
  waveTo: 37,
});

/** The wave inside each band's icon, on the grid of 48: slow and tall to fast and low. */
export const BAND_WAVE: Readonly<
  Record<ReportBand, { readonly cycles: number; readonly amplitude: number }>
> = frozen({
  delta: { cycles: 1, amplitude: 9 },
  theta: { cycles: 2, amplitude: 7.5 },
  alpha: { cycles: 3, amplitude: 6 },
  beta: { cycles: 4.5, amplitude: 4.5 },
  high_beta: { cycles: 6, amplitude: 3.5 },
});

/** A block of connectivity: a bar at its start edge, and what stands beside it. */
export const CONNECTIVITY = frozen({
  bar: 2.2,
  /** From the start edge to the text. */
  inset: mm(4),
  /** Between the title, the description and the finding. */
  gap: mm(1),
});

/** A card of the dashboard. */
export const CARD = frozen({
  radius: mm(2),
  edge: 0.6,
  /** The bar in the hue of the score, down the card's start edge. */
  accent: 2.6,
  padV: mm(2.8),
  padH: mm(3.4),
  /** Under the head, the summary, the evidence and the list. */
  gap: mm(1.8),
  /** Under a label. */
  labelGap: mm(1),
  ring: mm(11),
  /** Between the ring and the text beside it. */
  ringGutter: mm(2.6),
  /** Between the category and the title. */
  titleTop: mm(0.5),
  /** From the start edge to the text of a line of the list, and between two lines. */
  bulletIndent: mm(3.4),
  bulletGap: mm(0.7),
  /** The hairline over the advice, and the room under it. */
  rule: 0.5,
  ruleGap: mm(1.5),
  /**
   * The dash before a line of the list, drawn as a mark and not a letter:
   * the practice set an en dash in the list's 8.4-point type. Its length is
   * an en, half that size; its thickness and how far its middle stands above
   * the line's baseline are an en dash's in the report's face, about 0.08
   * and 0.27 of the size, so it sits level with the middle of small letters.
   */
  dash: 4.2,
  dashLine: 0.7,
  dashRise: 2.3,
});

/** The dashboard: six cards, three to a row, each row as tall as its tallest card. */
export const GRID = frozen({ columns: 3, rows: 2, columnGap: mm(4), rowGap: mm(3.2) });

/** One card of a row of three, in a body of this width. */
export function cardWidth(width: number): number {
  finite('cardWidth', 'width', width);
  const card = (width - (GRID.columns - 1) * GRID.columnGap) / GRID.columns;
  if (card <= 0) throw new RangeError(`cardWidth is left no card by a width of ${width}.`);
  return card;
}

/**
 * A score's ring, on its own grid of 40, `y` measured down from its top. The
 * score is centred on one baseline and "/10" on another under it.
 *
 * A score not yet given has no figure to draw: a report's scores start
 * empty, and a draft is previewed before they are set. Its ring holds a
 * short mark across its middle, `unsetDash` long and `unsetLine` thick. It
 * is a mark and not a word, so it needs no translating and cannot be too
 * wide for the ring, as words for it were.
 */
export const RING = frozen({
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

/** The panel at the head of a report: who it is about, and the recording. */
export const PANEL = frozen({
  padH: mm(4.5),
  padV: mm(3.6),
  gutter: mm(10),
  radius: mm(2.5),
  edge: 0.6,
  /** Under a column's title, and under each of its lines. */
  headGap: mm(1.5),
  lineGap: mm(0.9),
});

/** One of the panel's two columns, in a body of this width. */
export function panelColumnWidth(width: number): number {
  finite('panelColumnWidth', 'width', width);
  const column = (width - 2 * PANEL.padH - PANEL.gutter) / 2;
  if (column <= 0) {
    throw new RangeError(`panelColumnWidth is left no column by a width of ${width}.`);
  }
  return column;
}

/** A recommendation: its number, its name, its text, on one baseline, over a hairline. */
export const ROW = frozen({
  number: mm(11),
  name: mm(46),
  gutter: mm(3),
  padV: mm(2.4),
  rule: 0.5,
});

/** The number of sessions, in an outline with round ends. */
export const PILL = frozen({
  padV: mm(1.4),
  padH: mm(5),
  edge: 1,
  above: mm(1),
  below: mm(3),
});

/** The signature: a line, and the signer's details under it. */
export const SIGNATURE = frozen({
  width: mm(70),
  rule: 0.75,
  /** Under the line. */
  gap: mm(1.8),
  /** The room kept over the line, where a hand may sign a printed copy. */
  room: mm(12),
});

/** The foot of every page: a hairline, the practice at the start, the page at the end. */
export const FOOTER = frozen({ rule: 0.5, padTop: mm(2.5), gutter: mm(8) });

/** A map on a page of its own. */
export const MAP = frozen({
  /** Under the map's label. */
  labelGap: mm(4),
  /** Kept clear above the footer. */
  reserve: mm(3),
});
