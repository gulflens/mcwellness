import {
  measure,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type FontSet,
  type Op,
  type Page,
} from '../../shared/document';

/**
 * A report being drawn top-down, across as many pages as it needs.
 *
 * **Why this is not billing's `Sheet`.** It is very nearly the same object,
 * and that is deliberate rather than careless: `docs/SPEC/OWNERSHIP.md` rule 3
 * forbids one module importing another module's `domain/`, and the trunk's
 * round 29 moved the half that knows about *bytes* to `domain/shared/document`
 * and deliberately left the half that knows what a document *says* — the
 * model, the layout and the wording — with the module whose document it is. A
 * report's page is not an invoice's: it has no columns of figures, no totals,
 * a signature block, a ribbon and two standing sentences. Sharing a layout
 * class between them would have meant a class that knows about both, in
 * `shared`, growing a branch every time either page changed.
 *
 * The discipline is billing's own and is worth restating, because it is what
 * makes the geometry testable rather than a set of guesses: **a primitive
 * draws where it is told and never moves the cursor.** The caller works out
 * how tall a block is, asks for the room, draws it on a baseline it holds, and
 * then advances once. Every string is measured against the room it actually
 * has and wraps into it; nothing is drawn past the right margin.
 *
 * Pure: laying out a page is arithmetic, so this is testable without a
 * database or a clock. The fonts arrive as bytes from `app/api/billing/fonts.ts`.
 */

export const MARGIN = 48;
export const LEFT = MARGIN;
export const RIGHT = PAGE_WIDTH - MARGIN;
/** The first baseline, and the floor the last one may not go below. */
export const TOP = PAGE_HEIGHT - MARGIN;
export const BOTTOM = MARGIN + 26;
/** Where a page number sits: below the content floor, above the paper's edge. */
export const FOLIO = MARGIN + 8;
/** Where a value sits: far enough from the label to read as its own column. */
export const VALUE = LEFT + 170;
/** The smallest gap two pieces of type may have between them. */
export const GUTTER = 10;

export const INK = 0;
export const MUTED = 0.42;
export const RULE = 0.78;

export const SIZE = { wordmark: 15, heading: 12, body: 9, small: 7.5 };
export const LINE = 13;
export const SMALL_LINE = 9.5;

/**
 * The page's own measurements, exported so the geometry tests assert against
 * the same numbers the layout uses rather than against copies of them.
 */
export const GEOMETRY = {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN,
  LEFT,
  RIGHT,
  TOP,
  BOTTOM,
  FOLIO,
  VALUE,
  GUTTER,
  LINE,
  SMALL_LINE,
  SIZE,
} as const;

export type TextOptions = {
  bold?: boolean;
  grey?: number;
  align?: 'start' | 'end' | 'centre';
  rtl?: boolean;
};

/**
 * The longest string this will set at all.
 *
 * A narrative is a paragraph somebody typed, and rendering is on the path that
 * files a household's most personal document. Wrapping an unbounded string is
 * unbounded work, so it is cut — visibly, with an ellipsis, because a document
 * that quietly drops half a paragraph is worse than one that shows it was too
 * long. The shapes cap each field well below this; this is the floor under
 * them.
 */
const MAX_DRAWN = 4000;

export function clampForDocument(text: string): string {
  const characters = [...text];
  return characters.length <= MAX_DRAWN ? text : `${characters.slice(0, MAX_DRAWN - 1).join('')}…`;
}

export class Sheet {
  private readonly pages: Op[][] = [[]];
  private y = TOP;
  private continuation: (() => void) | null = null;

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
    if (this.y - space >= BOTTOM) return;
    this.newPage();
  }

  /** What to redraw at the top of a page taken mid-way through something. */
  setContinuation(draw: (() => void) | null): void {
    this.continuation = draw;
  }

  private newPage(): void {
    this.pages.push([]);
    this.y = TOP;
    // A running header, so a loose second sheet still says which report it
    // belongs to and whose practice issued it.
    this.text(LEFT, this.running.practice, SIZE.small, { grey: MUTED });
    this.text(RIGHT, this.running.reference, SIZE.small, { grey: MUTED, align: 'end' });
    this.down(SMALL_LINE);
    this.rule();
    this.down(LINE);
    this.continuation?.();
  }

  /** One line, on the baseline it is given. Nothing here moves the cursor. */
  line(y: number, x: number, text: string, size: number, options: TextOptions = {}): void {
    if (text.length === 0) return;
    this.ops.push({
      kind: 'text',
      x,
      y,
      text,
      style: { font: options.bold ? 'bold' : 'regular', size, grey: options.grey ?? INK },
      ...(options.align ? { align: options.align } : {}),
      ...(options.rtl ? { rtl: true } : {}),
    });
  }

  /** The same, on the current baseline. */
  text(x: number, text: string, size: number, options: TextOptions = {}): void {
    this.line(this.y, x, text, size, options);
  }

  /**
   * Breaks a string into the lines that fit `maxWidth`: on spaces where it
   * can, and inside a word where it cannot, because running off the page is
   * not an answer.
   *
   * A blank line in the middle of a paragraph is kept as a blank line: a
   * practitioner's summary is prose, and the paragraph breaks they typed are
   * part of what they wrote.
   */
  wrap(text: string, maxWidth: number, size: number, options: TextOptions = {}): string[] {
    const clamped = clampForDocument(text);
    if (maxWidth <= 0) return [clamped];

    const out: string[] = [];
    for (const source of clamped.split(/\r?\n/)) {
      if (source.length === 0) {
        out.push('');
        continue;
      }
      if (this.width(source, size, options) <= maxWidth) {
        out.push(source);
        continue;
      }
      let line = '';
      const flush = (): void => {
        if (line.length > 0) out.push(line);
        line = '';
      };
      for (const word of source.split(' ')) {
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
        // A single word wider than the column: broken by character, which is
        // what a long unspaced name needs.
        let piece = '';
        for (const character of word) {
          if (this.width(piece + character, size, options) > maxWidth && piece.length > 0) {
            out.push(piece);
            piece = character;
          } else {
            piece += character;
          }
        }
        line = piece;
      }
      flush();
    }
    return out.length > 0 ? out : [''];
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

  rule(grey = RULE, thickness = 0.5, x = LEFT, width = RIGHT - LEFT): void {
    this.ops.push({ kind: 'rule', x, y: this.y, width, thickness, grey });
  }

  /**
   * A rule on a baseline of the caller's choosing, which is what the ribbon
   * needs: its slices sit at heights the strip decides, not at the cursor.
   *
   * **The one place a colour may be asked for.** `rgb` is the band's own hue
   * (`BAND_RGB`, domain/shared/bands.ts); the writer takes the grey path when
   * it is absent, which is every other rule on every page. Nothing else on
   * this sheet offers a colour, so the design brief's "the one place hue
   * enters a report" is held by the shape of the class and not by a comment.
   */
  ruleAt(
    y: number,
    x: number,
    width: number,
    thickness: number,
    grey: number,
    rgb?: readonly [number, number, number],
  ): void {
    this.ops.push({ kind: 'rule', x, y, width, thickness, grey, ...(rgb ? { rgb } : {}) });
  }

  /**
   * The finished pages. A report that took more than one says so on every
   * sheet: a page torn off a stack has to be able to say what it is part of.
   */
  finish(): Page[] {
    if (this.pages.length > 1) {
      this.pages.forEach((ops, index) => {
        ops.push({
          kind: 'text',
          x: RIGHT,
          y: FOLIO,
          text: `Page ${index + 1} of ${this.pages.length}`,
          style: { font: 'regular', size: SIZE.small, grey: MUTED },
          align: 'end',
        });
      });
    }
    return this.pages.map((ops) => ({ ops }));
  }
}
