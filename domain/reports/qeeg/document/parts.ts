/**
 * What a part of a brain-map report's pages is, and the few helpers every
 * builder of parts shares: the report's sections in order, a part laid at a
 * width, a day as the practice writes it, and her formatted text as spans.
 *
 * **Why a module of its own.** The first report's parts are built in
 * `build.ts` and a follow-up's page of what has changed in `changePage.ts`,
 * and both make parts the same way. Kept here, neither imports the other.
 *
 * **A part is laid at a width, not once.** The dashboard is scaled to fit
 * its page, which lays it out wider and draws it smaller, so every part is a
 * function from a width to a block (`at`), and its height is its height at
 * the width of the page body. A part laid at the same width twice gives the
 * same block, and is laid once.
 */

import type { RichText } from '../types';
import type { Block } from './block';
import { BODY_WIDTH } from './geometry';
import type { Flow } from './paginate';
import type { Span } from './paragraph';

/** The sections of a report, in the order they are printed. `change` is a follow-up's alone. */
export const SECTIONS = Object.freeze([
  'client',
  'overview',
  'findings',
  'focus',
  'maps',
  'change',
  'brain',
  'connectivity',
  'dashboard',
  'recommendations',
  'summary',
  'benefits',
  'programme',
  'approach',
  'closing',
  'final',
  'signature',
] as const);
export type Section = (typeof SECTIONS)[number];

/**
 * A part of a page: how it behaves at a break (`Flow`), which section it
 * belongs to, and the part laid at a width. `height` is its height at the
 * width of the page body, what hangs below it included.
 */
export type Part = Flow & {
  readonly section: Section;
  readonly at: (width: number) => Block;
};

/** How a part behaves at a break. Each is false and each margin nothing unless said. */
export type Flags = Partial<
  Pick<
    Flow,
    | 'marginTop'
    | 'marginBottom'
    | 'keep'
    | 'newPage'
    | 'gapBefore'
    | 'sectionStart'
    | 'pinBottom'
    | 'fit'
  >
>;

/** A part, laid at the body's width once to learn its height, and at any width once. */
export function part(
  id: string,
  section: Section,
  make: (width: number) => Block,
  flags: Flags,
): Part {
  const laid = new Map<number, Block>();
  const at = (width: number): Block => {
    const known = laid.get(width);
    if (known) return known;
    const block = make(width);
    laid.set(width, block);
    return block;
  };
  const natural = at(BODY_WIDTH);
  return {
    id,
    section,
    at,
    height: natural.height + natural.overhang,
    marginTop: flags.marginTop ?? 0,
    marginBottom: flags.marginBottom ?? 0,
    keep: flags.keep ?? false,
    newPage: flags.newPage ?? false,
    gapBefore: flags.gapBefore ?? false,
    sectionStart: flags.sectionStart ?? false,
    pinBottom: flags.pinBottom ?? false,
    fit: flags.fit ?? false,
  };
}

/** A day as the practice writes it, `DD/MM/YYYY`, in Latin figures in either language. */
export function dayOf(iso: string | null): string {
  if (iso === null) return '';
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

/** Her formatted text as spans: a span for each stretch between two edges of a mark. */
export function spansOfRich(rich: RichText): Span[] {
  const edges = new Set([0, rich.text.length]);
  for (const mark of rich.marks) {
    edges.add(mark.from);
    edges.add(mark.to);
  }
  const sorted = [...edges].sort((one, other) => one - other);
  const spans: Span[] = [];
  sorted.forEach((from, index) => {
    const to = sorted[index + 1];
    if (to === undefined || to <= from) return;
    const mark = rich.marks.find((each) => each.from <= from && each.to >= to);
    spans.push({
      text: rich.text.slice(from, to),
      ...(mark?.bold ? { bold: true } : {}),
      ...(mark?.underline ? { underline: true } : {}),
    });
  });
  return spans;
}

/** The key the engine looks a brain map up by. */
export function mapImageKey(figureId: string): string {
  return `map:${figureId}`;
}

/** What a sentence reads as before anything is chosen, as `sentences.ts` prints it. A mark, not a word. */
export const NOTHING_YET = '—';
