/**
 * The sheet a money document is drawn on: the page's measurements, the
 * practice's violet and its three tints, and `Sheet` — the cursor that lays a
 * document out top-down across as many pages as it needs.
 *
 * Split out of `render.ts` in round 65 so the pages drawn on it — the invoice
 * and the receipt in the operator's design of 24 September 2026 (`invoice.ts`,
 * `receipt.ts`, and the blocks they share in `page.ts`) — can each import it
 * without importing the other.
 * Pure, like everything beside it: laying out a page is arithmetic.
 */

import {
  measure,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type FontSet,
  type Op,
  type Page,
} from '../../shared/document';

export const MARGIN = 48;
export const LEFT = MARGIN;
export const RIGHT = PAGE_WIDTH - MARGIN;
/** The first baseline. */
export const TOP = PAGE_HEIGHT - MARGIN;
/** The paper's foot, above its edge: the footer band hangs thirty points above it. */
export const FOLIO = MARGIN + 8;
/** The hairline the footer band hangs from, pinned to the bottom of the page. */
export const BAND = FOLIO + 30;
/** The floor the flow may not go below: far enough above the band to clear it. */
export const BOTTOM = BAND + 18;
/** The smallest gap two pieces of type may have between them. */
export const GUTTER = 10;

export const INK = 0;
export const MUTED = 0.42;
export const RULE = 0.78;

/**
 * The practice's own violet, `#380473`, sampled from the darkest large area of
 * its mark. The one hue on either document: both pages in the operator's
 * design of 24 September 2026 fill their bands and accents with it and ground
 * their cards in the three tints below.
 */
export const VIOLET = [0x38 / 255, 0x04 / 255, 0x73 / 255] as const;

/**
 * Type set on violet — the table's headings and the violet block's caption
 * and figure — and nowhere else: white is his colour only on his violet
 * (which `tests/billing/palette.test.ts` pins on every page).
 */
export const WHITE = [1, 1, 1] as const;

/**
 * `VIOLET` mixed toward white by `k`: `1 - (1 - v) * k` per channel, so
 * `k = 0` is white and `k = 1` is `VIOLET` itself. One formula, so `CARD`,
 * `EDGE` and `PILL` below have the one source the design asks for
 * (docs/superpowers/specs/2026-09-24-invoice-redesign-design.md, "The page,
 * top to bottom": "all derived in code from the one brand violet").
 */
export function tint(k: number): readonly [number, number, number] {
  const [r, g, b] = VIOLET;
  return [1 - (1 - r) * k, 1 - (1 - g) * k, 1 - (1 - b) * k];
}

/** A card's ground: the violet mixed six per cent over white, `#f3f0f7`. */
export const CARD = tint(0.06);
/** A card's border: the violet mixed fifteen per cent over white, `#e1d9ea`. */
export const EDGE = tint(0.15);
/** The discount pill's ground: the violet mixed twelve per cent over white, `#e7e1ee`. */
export const PILL = tint(0.12);

export const SIZE = { wordmark: 15, title: 20, reference: 13, heading: 12, body: 9, small: 7.5 };
export const LINE = 13;
export const SMALL_LINE = 9.5;

export type TextOptions = {
  bold?: boolean;
  grey?: number;
  rgb?: readonly [number, number, number];
  align?: 'start' | 'end' | 'centre';
  rtl?: boolean;
};

/** What `Sheet.rect` takes beyond the box itself: the writer's own `rect` op, minus its position. */
export type RectOptions = Omit<
  Extract<Op, { kind: 'rect' }>,
  'kind' | 'x' | 'y' | 'width' | 'height'
>;

/**
 * The longest string this will set at all.
 *
 * Not a layout rule but a floor under one: a description or an address is a
 * string somebody typed, and rendering is on the path that produces a client's
 * financial record. Wrapping an unbounded string is unbounded work, so it is cut
 * — visibly, with an ellipsis, because a document that quietly drops half a line
 * is worse than one that shows it was too long.
 */
const MAX_DRAWN = 400;

export function clampForDocument(text: string): string {
  const characters = [...text];
  return characters.length <= MAX_DRAWN ? text : `${characters.slice(0, MAX_DRAWN - 1).join('')}…`;
}

/**
 * A document being drawn top-down, across as many pages as it needs.
 *
 * Exported so `domain/billing/document/colours.test.ts` can drive `rect`,
 * `card` and `bandFill` directly and read back the ops they push, the same
 * way this file's own docstring asks everything here to be testable — with
 * no font file, a database or a clock. Nothing outside this module and its
 * colocated tests constructs one; the barrel (`index.ts`) does not re-export
 * it.
 */
export class Sheet {
  private readonly pages: Op[][] = [[]];
  private y = TOP;
  /**
   * The lowest the flow may go. `BOTTOM` unless a page's own footer, measured
   * before anything is drawn, asks for more room above it (`setFloor`).
   */
  private floorAt = BOTTOM;
  private readonly fonts: FontSet;
  private readonly running: { practice: string; reference: string };

  constructor(fonts: FontSet, running: { practice: string; reference: string }) {
    this.fonts = fonts;
    this.running = running;
  }

  private get ops(): Op[] {
    const page = this.pages[this.pages.length - 1];
    if (!page) throw new Error('A sheet always has a page.');
    return page;
  }

  get baseline(): number {
    return this.y;
  }

  down(by: number): void {
    this.y -= by;
  }

  /** Which page is being drawn on, from nought. */
  get page(): number {
    return this.pages.length - 1;
  }

  /** The lowest baseline the flow may reach on any page of this sheet. */
  get floor(): number {
    return this.floorAt;
  }

  /** Raises the floor, never lowers it below `BOTTOM`: for a footer taller than one line. */
  setFloor(y: number): void {
    this.floorAt = Math.max(BOTTOM, y);
  }

  /** Whether `space` points of content still fit on this page. */
  fits(space: number): boolean {
    return this.y - space >= this.floorAt;
  }

  /** How wide a string is, set as it will be set. */
  width(text: string, size: number, options: TextOptions = {}): number {
    if (text.length === 0) return 0;
    return measure(
      text,
      { font: options.bold ? 'bold' : 'regular', size },
      this.fonts,
      options.rtl === true,
    );
  }

  /** Makes room for `space` points of content, taking another page if there is none. */
  room(space: number): void {
    if (this.fits(space)) return;
    this.newPage();
  }

  /** Takes another page now, whatever room is left on this one. */
  breakPage(): void {
    this.newPage();
  }

  private newPage(): void {
    this.pages.push([]);
    this.y = TOP;
    // A running header, so a loose second sheet still says which document it
    // belongs to and whose practice issued it.
    // Cut to half the measure, so a long legal name never runs under the
    // reference against the right margin.
    this.text(LEFT, this.fit(this.running.practice, (RIGHT - LEFT) / 2, SIZE.small), SIZE.small, {
      grey: MUTED,
    });
    this.text(RIGHT, this.running.reference, SIZE.small, { grey: MUTED, align: 'end' });
    this.down(SMALL_LINE);
    this.rule();
    this.down(LINE);
  }

  /**
   * One line, on the baseline it is given. Nothing here moves the cursor.
   *
   * That is the whole discipline: a first version had the drawing helpers
   * advance the cursor themselves and the callers correct it afterwards with
   * arithmetic, and every block on the page printed on top of the last. A
   * primitive draws where it is told; the caller advances once, by an amount it
   * worked out before it drew anything.
   */
  line(y: number, x: number, text: string, size: number, options: TextOptions = {}): void {
    if (text.length === 0) return;
    this.ops.push({
      kind: 'text',
      x,
      y,
      text,
      style: {
        font: options.bold ? 'bold' : 'regular',
        size,
        grey: options.grey ?? INK,
        ...(options.rgb ? { rgb: options.rgb } : {}),
      },
      ...(options.align ? { align: options.align } : {}),
      ...(options.rtl ? { rtl: true } : {}),
    });
  }

  /** The same, on the current baseline. */
  text(x: number, text: string, size: number, options: TextOptions = {}): void {
    this.line(this.y, x, text, size, options);
  }

  /** The practice's mark, with its bottom-left corner where it is told. */
  image(x: number, y: number, width: number, height: number): void {
    this.ops.push({ kind: 'image', image: 'logo', x, y, width, height });
  }

  /**
   * A filled and/or stroked rectangle, straight to the writer's own `rect`
   * op — `x`, `y` is its bottom-left corner, exactly as the op takes it
   * (`domain/shared/document/pdf.ts`). `card` and `bandFill` below are the
   * page's own two shapes of it, from the top edge; this is the primitive
   * itself, for whatever the redesign still needs one for.
   */
  rect(x: number, y: number, width: number, height: number, options: RectOptions = {}): void {
    this.ops.push({ kind: 'rect', x, y, width, height, ...options });
  }

  /**
   * A card: `CARD` filled, `EDGE` stroked, 6 pt corners unless told
   * otherwise — the practice's own design (docs/superpowers/specs/2026-09-24-
   * invoice-redesign-design.md, "Corners: 6 pt on cards").
   *
   * Takes the box from its **top** edge, `yTop`, which is how this file lays
   * a page out — downward from `TOP` — rather than the bottom-left corner
   * the op itself takes: `y = yTop - height` is the whole of the conversion,
   * done once here so no caller of `card` works it out for itself.
   */
  card(
    x: number,
    yTop: number,
    width: number,
    height: number,
    options: { radius?: number } = {},
  ): void {
    this.rect(x, yTop - height, width, height, {
      fill: { rgb: CARD },
      stroke: { rgb: EDGE },
      radius: options.radius ?? 6,
    });
  }

  /**
   * A band filled solid `VIOLET` and never stroked: the lines table's
   * header, the totals' "TOTAL DUE" / "TOTAL PAID" block, the discount pill,
   * the tax card's left-edge bar. Top-edge coordinates and the same
   * conversion as `card` — see there.
   */
  bandFill(x: number, yTop: number, width: number, height: number, radius = 0): void {
    this.rect(x, yTop - height, width, height, { fill: { rgb: VIOLET }, radius });
  }

  /**
   * A card's border with nothing inside it: `EDGE` stroked, the page's white
   * showing through — the lines table and the two cards beneath it, as the
   * operator's page draws them. Top-edge coordinates, as `card`.
   */
  outline(x: number, yTop: number, width: number, height: number, radius = 6): void {
    this.rect(x, yTop - height, width, height, { stroke: { rgb: EDGE }, radius });
  }

  /**
   * A hairline inside a card, in the card's own `EDGE` rather than the grey
   * rule the page draws between blocks: across when `height` is left at its
   * half point, down a column when it is given. `x`, `y` is its bottom-left.
   */
  hairline(x: number, y: number, width: number, height = 0.5): void {
    this.rect(x, y, width, height, { fill: { rgb: EDGE } });
  }

  /**
   * Breaks a string into the lines that fit `maxWidth`.
   *
   * On spaces where it can, and inside a word where it cannot — a forty-point
   * column and a fifty-point word have no polite answer, and running off the
   * page is not one.
   */
  wrap(text: string, maxWidth: number, size: number, options: TextOptions = {}): string[] {
    const clamped = clampForDocument(text);
    if (maxWidth <= 0) return [clamped];
    if (this.width(clamped, size, options) <= maxWidth) return [clamped];

    const lines: string[] = [];
    let line = '';
    const flush = (): void => {
      if (line.length > 0) lines.push(line);
      line = '';
    };
    for (const word of clamped.split(' ')) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (this.width(candidate, size, options) <= maxWidth) {
        line = candidate;
        continue;
      }
      flush();
      if (this.width(word, size, options) <= maxWidth) {
        line = word;
        continue;
      }
      // A single word wider than the column: broken by character, which is what
      // a long reference or an unspaced name needs.
      let piece = '';
      for (const character of word) {
        if (this.width(piece + character, size, options) > maxWidth && piece.length > 0) {
          lines.push(piece);
          piece = character;
        } else {
          piece += character;
        }
      }
      line = piece;
    }
    flush();
    return lines.length > 0 ? lines : [''];
  }

  /**
   * The same string, cut to one line that fits.
   *
   * For the footer's contact line alone, which is pinned to the bottom of the
   * page and so cannot grow downward off the paper. The address line above it
   * wraps upward instead of being cut, because it states a fact nothing else
   * on the page repeats.
   */
  fit(text: string, maxWidth: number, size: number, options: TextOptions = {}): string {
    if (this.width(text, size, options) <= maxWidth) return text;
    // Eight points of room kept back for the ellipsis, so the cut line is
    // still inside the measure once it is added.
    return `${this.wrap(text, maxWidth - 8, size, options)[0] ?? ''}…`;
  }

  /**
   * A wrapped block starting on baseline `y`, drawn downward. Answers how many
   * lines it took; the cursor is the caller's to move.
   */
  paragraph(
    y: number,
    x: number,
    text: string,
    maxWidth: number,
    size: number,
    options: TextOptions = {},
    step = LINE,
  ): number {
    const lines = this.wrap(text, maxWidth, size, options);
    lines.forEach((each, index) => {
      this.line(y - index * step, x, each, size, options);
    });
    return lines.length;
  }

  rule(grey = RULE, thickness = 0.5): void {
    this.ops.push({ kind: 'rule', x: LEFT, y: this.y, width: RIGHT - LEFT, thickness, grey });
  }

  /** A rule where it is told, and — with a rise — down the side of a box. */
  ruleAt(y: number, x: number, width: number, dy = 0, grey = RULE, thickness = 0.5): void {
    this.ops.push({ kind: 'rule', x, y, width, ...(dy ? { dy } : {}), thickness, grey });
  }

  /**
   * The finished pages, and nothing added to them: no page number, because
   * the operator's page has none (docs/superpowers/specs/2026-09-24-invoice-
   * redesign-design.md). A later sheet still says what it belongs to — the
   * running header `newPage` draws carries the practice and the reference.
   */
  finish(): Page[] {
    return this.pages.map((ops) => ({ ops }));
  }
}
