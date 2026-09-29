/**
 * A formatted paragraph of a brain-mapping report: broken into lines, then
 * turned into the PDF engine's text and rule ops.
 *
 * **Why lines are decided here and not by the engine.** The engine draws one
 * string where it is told and knows nothing of wrapping, bold words, colour
 * or underline. The report's paragraphs have all four, in English, in Arabic,
 * and in each other: a figure inside an Arabic sentence, an Arabic greeting
 * inside an English one. So this lays every line out itself, word by word,
 * with `bidi.ts` deciding which words run which way, and hands the engine
 * only strings it draws correctly: whole Arabic runs as `rtl` ops anchored at
 * their right edge, everything else left to right from its left edge.
 *
 * **Fonts are not imported.** The caller injects a `Measure`, which in the
 * app wraps `measure` from `domain/shared/document` and in a test counts
 * characters. That keeps this pure and every width in a test exact.
 *
 * **Laid once, drawn anywhere.** `layoutParagraph` positions every piece of
 * every line relative to the paragraph's own box, so `splitParagraph` cuts a
 * laid paragraph between lines without laying it out again, and
 * `drawParagraph` only adds the page position.
 */

import { isArabic, type Op, type Style } from '@domain/shared/document';
import { runsOf, type Direction } from './bidi';
import { lineBox, type Face, type LineBox, type TextStyle } from './metrics';

export type Span = { text: string; bold?: boolean; underline?: boolean; accent?: boolean };

export type Measure = (
  text: string,
  weight: 'regular' | 'bold',
  size: number,
  rtl: boolean,
) => number;

export type Paint = { grey?: number; rgb?: readonly [number, number, number] };

export type ParagraphInput = {
  spans: readonly Span[];
  style: TextStyle;
  width: number;
  /** The base direction of this paragraph. */
  paragraph: Direction;
  /** Relative to the paragraph's direction. */
  align: 'start' | 'end' | 'centre';
  /** Default false. */
  justify?: boolean;
  ink: Paint;
  /** What an `accent` span is drawn in. */
  accent: Paint;
  faces: { latin: Face; arabic: Face };
};

/** One op's worth of a line: its text and style, and where its left edge sits in the box. */
export type Piece = {
  readonly text: string;
  readonly weight: 'regular' | 'bold';
  readonly underline: boolean;
  readonly accent: boolean;
  readonly rtl: boolean;
  /** Holds an Arabic character, which sets the underline lower. */
  readonly arabic: boolean;
  /** Left edge, from the left of the paragraph's box. */
  readonly left: number;
  readonly width: number;
};

/** A laid line: its pieces in reading order. */
export type Line = { readonly pieces: readonly Piece[] };

export type Laid = { lines: readonly Line[]; height: number; box: LineBox; input: ParagraphInput };

/** A word, or the part of one in a single style and direction, before it is placed. */
type Atom = {
  text: string;
  weight: 'regular' | 'bold';
  underline: boolean;
  accent: boolean;
  rtl: boolean;
  /** No space before it. */
  glued: boolean;
};

/** Atoms made into what will be drawn as one op, with the space before it. */
type Group = Omit<Piece, 'left'> & { gap: number };

/** Room for rounding in sums of widths, so a line exactly the measure still fits. */
const EPSILON = 1e-9;

function sameStyle(a: Atom, b: Atom): boolean {
  return (
    a.weight === b.weight && a.underline === b.underline && a.accent === b.accent && a.rtl === b.rtl
  );
}

function holdsArabic(text: string): boolean {
  return [...text].some((character) => isArabic(character.codePointAt(0) ?? 0));
}

/**
 * The atoms of a paragraph, in reading order. The text is read whole by
 * `runsOf`, so a word's direction does not depend on where a span happened
 * to begin, and then cut again wherever the style changes inside a word.
 */
function atomsOf(input: ParagraphInput): Atom[] {
  const plain = input.spans
    .map((span) => span.text)
    .join('')
    .replace(/\s/g, ' ');
  const spanAt: number[] = [];
  input.spans.forEach((span, index) => {
    for (let at = 0; at < span.text.length; at += 1) spanAt.push(index);
  });

  const atoms: Atom[] = [];
  let cursor = 0;
  for (const run of runsOf(plain, input.paragraph)) {
    for (const token of run.tokens) {
      const start = plain.indexOf(token.text, cursor);
      if (start < 0) continue;
      cursor = start + token.text.length;
      let from = start;
      for (let at = start + 1; at <= cursor; at += 1) {
        if (at < cursor && spanAt[at] === spanAt[from]) continue;
        const span = input.spans[spanAt[from] ?? 0];
        atoms.push({
          text: plain.slice(from, at),
          weight: span?.bold === true ? 'bold' : input.style.weight,
          underline: span?.underline === true,
          accent: span?.accent === true,
          rtl: run.direction === 'rtl',
          glued: from === start ? token.glued : true,
        });
        from = at;
      }
    }
  }
  return atoms;
}

/**
 * The drawable groups of a line. Merged, neighbouring atoms of one style and
 * one direction share an op; unmerged, every atom is its own. The first on a
 * line has no gap before it, whatever preceded it.
 */
function groupsOf(
  atoms: readonly Atom[],
  merge: boolean,
  input: ParagraphInput,
  measure: Measure,
  space: number,
): Group[] {
  const texts: { atom: Atom; text: string; gap: number }[] = [];
  atoms.forEach((atom, index) => {
    const last = texts[texts.length - 1];
    if (merge && last && sameStyle(last.atom, atom)) {
      last.text += (atom.glued ? '' : ' ') + atom.text;
      return;
    }
    texts.push({ atom, text: atom.text, gap: index === 0 || atom.glued ? 0 : space });
  });
  return texts.map(({ atom, text, gap }) => ({
    text,
    weight: atom.weight,
    underline: atom.underline,
    accent: atom.accent,
    rtl: atom.rtl,
    arabic: holdsArabic(text),
    width: measure(text, atom.weight, input.style.size, atom.rtl),
    gap,
  }));
}

function naturalOf(groups: readonly Group[]): number {
  return groups.reduce(
    (total, group, index) => total + group.width + (index > 0 ? group.gap : 0),
    0,
  );
}

/** Atoms cut into words: a word ends where a space comes. */
function wordsOf(atoms: readonly Atom[]): Atom[][] {
  const words: Atom[][] = [];
  for (const atom of atoms) {
    const last = words[words.length - 1];
    if (last && atom.glued) last.push(atom);
    else words.push([atom]);
  }
  return words;
}

/**
 * Breaks lines greedily on spaces. A word wider than the line is broken by
 * character, as `domain/reports/document/sheet.ts` does, because running off
 * the page is not an answer.
 */
function breakLines(
  atoms: readonly Atom[],
  input: ParagraphInput,
  measure: Measure,
  space: number,
): Atom[][] {
  const fits = (line: readonly Atom[]): boolean =>
    naturalOf(groupsOf(line, true, input, measure, space)) <= input.width + EPSILON;
  const lines: Atom[][] = [];
  let current: Atom[] = [];

  for (const word of wordsOf(atoms)) {
    if (current.length > 0) {
      const candidate = [...current, ...word];
      if (fits(candidate)) {
        current = candidate;
        continue;
      }
      lines.push(current);
    }
    if (fits(word)) {
      current = [...word];
      continue;
    }
    let chunk: Atom[] = [];
    for (const atom of word) {
      let fresh = true;
      for (const character of atom.text) {
        const last = chunk[chunk.length - 1];
        const trial =
          last && !fresh
            ? [...chunk.slice(0, -1), { ...last, text: last.text + character }]
            : [...chunk, { ...atom, text: character, glued: chunk.length > 0 || atom.glued }];
        if (chunk.length > 0 && !fits(trial)) {
          lines.push(chunk);
          chunk = [{ ...atom, text: character, glued: false }];
        } else {
          chunk = trial;
        }
        fresh = false;
      }
    }
    current = chunk;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * Places a line's groups, left edges from the left of the box.
 *
 * The line is cut into stretches of one direction. The stretches follow the
 * paragraph, from its start edge; inside a stretch the groups follow the
 * stretch. So a right-to-left line is walked from its right edge, and a
 * left-to-right run inside it is measured whole and set from its left edge.
 */
function place(
  groups: readonly Group[],
  natural: number,
  input: ParagraphInput,
  align: ParagraphInput['align'],
): Piece[] {
  const rtl = input.paragraph === 'rtl';
  const spare = input.width - natural;
  const offset = align === 'centre' ? spare / 2 : (align === 'end') !== rtl ? spare : 0;

  const stretches: Group[][] = [];
  for (const group of groups) {
    const last = stretches[stretches.length - 1];
    if (last && last[0]?.rtl === group.rtl) last.push(group);
    else stretches.push([group]);
  }

  const pieces: Piece[] = [];
  let edge = rtl ? offset + natural : offset;
  stretches.forEach((stretch, index) => {
    const first = stretch[0];
    if (!first) return;
    if (index > 0) edge += rtl ? -first.gap : first.gap;
    const width = naturalOf(stretch);
    const boxLeft = rtl ? edge - width : edge;
    let at = first.rtl ? boxLeft + width : boxLeft;
    stretch.forEach((group, inner) => {
      if (inner > 0) at += first.rtl ? -group.gap : group.gap;
      const left = first.rtl ? at - group.width : at;
      pieces.push({
        text: group.text,
        weight: group.weight,
        underline: group.underline,
        accent: group.accent,
        rtl: group.rtl,
        arabic: group.arabic,
        left,
        width: group.width,
      });
      at = first.rtl ? left : left + group.width;
    });
    edge += rtl ? -width : width;
  });
  return pieces;
}

export function layoutParagraph(input: ParagraphInput, measure: Measure): Laid {
  const box = lineBox(
    input.style,
    input.paragraph === 'rtl' ? input.faces.arabic : input.faces.latin,
  );
  const space = measure(' ', input.style.weight, input.style.size, false);
  const broken = breakLines(atomsOf(input), input, measure, space);

  const lines: Line[] = broken.map((atoms, index) => {
    const last = index === broken.length - 1;
    if (input.justify === true && !last) {
      const loose = groupsOf(atoms, false, input, measure, space);
      const gaps = loose.filter((group, at) => at > 0 && group.gap > 0).length;
      const stretch = gaps > 0 ? (input.width - naturalOf(loose)) / gaps : Infinity;
      if (stretch >= 0 && stretch <= space + EPSILON) {
        const widened = loose.map((group, at) =>
          at > 0 && group.gap > 0 ? { ...group, gap: group.gap + stretch } : group,
        );
        return { pieces: place(widened, input.width, input, 'start') };
      }
    }
    const groups = groupsOf(atoms, true, input, measure, space);
    return { pieces: place(groups, naturalOf(groups), input, input.align) };
  });

  return { lines, height: lines.length * box.advance, box, input };
}

function paintOf(paint: Paint): { grey?: number; rgb?: readonly [number, number, number] } {
  return {
    ...(paint.grey !== undefined ? { grey: paint.grey } : {}),
    ...(paint.rgb ? { rgb: paint.rgb } : {}),
  };
}

/** Ops for a laid paragraph whose box has its left edge at `at.x` and its top at `at.top`. */
export function drawParagraph(laid: Laid, at: { x: number; top: number }): Op[] {
  const { input, box } = laid;
  const size = input.style.size;
  const ops: Op[] = [];
  laid.lines.forEach((line, index) => {
    const baseline = at.top - (box.firstBaseline + index * box.advance);
    for (const piece of line.pieces) {
      const style: Style = {
        font: piece.weight,
        size,
        ...paintOf(piece.accent ? input.accent : input.ink),
      };
      ops.push(
        piece.rtl
          ? {
              kind: 'text',
              x: at.x + piece.left + piece.width,
              y: baseline,
              text: piece.text,
              style,
              align: 'end',
              rtl: true,
            }
          : { kind: 'text', x: at.x + piece.left, y: baseline, text: piece.text, style },
      );
    }

    for (const run of underlinesOf(line)) {
      const paint = paintOf(run.accent ? input.accent : input.ink);
      ops.push({
        kind: 'rule',
        x: at.x + run.from,
        y: baseline - run.drop * size,
        width: run.to - run.from,
        thickness: Math.max(0.06 * size, 0.5),
        // The writer strokes an unpainted rule in a light grey; an underline is
        // the colour of its words, which unpainted is black.
        grey: paint.grey ?? 0,
        ...(paint.rgb ? { rgb: paint.rgb } : {}),
      });
    }
  });
  return ops;
}

/** One underline: its span from the left of the box, its paint, and its drop below the baseline in em. */
type Underline = { from: number; to: number; accent: boolean; drop: number };

/**
 * The underlines of a line: one for each UNBROKEN run of underlined pieces,
 * walked in order of their left edge. A piece that is not underlined, or a
 * change of paint, ends a run; the space between two underlined neighbours
 * in one run is underlined with them. A run holding Arabic sits lower, below
 * the deeper Arabic descenders.
 */
function underlinesOf(line: Line): Underline[] {
  const runs: Underline[] = [];
  let open: Underline | null = null;
  for (const piece of [...line.pieces].sort((a, b) => a.left - b.left)) {
    if (!piece.underline) {
      open = null;
      continue;
    }
    const drop = piece.arabic ? 0.5 : 0.275;
    if (open && open.accent === piece.accent) {
      open.to = piece.left + piece.width;
      open.drop = Math.max(open.drop, drop);
      continue;
    }
    open = { from: piece.left, to: piece.left + piece.width, accent: piece.accent, drop };
    runs.push(open);
  }
  return runs;
}

/**
 * Cuts a laid paragraph between lines, as many on the first side as `room`
 * holds. Each side keeps at least two lines, so a paragraph under four lines
 * never splits.
 */
export function splitParagraph(laid: Laid, room: number): readonly [Laid, Laid] | null {
  const count = laid.lines.length;
  if (count < 4) return null;
  const take = Math.min(Math.floor(room / laid.box.advance + EPSILON), count - 2);
  if (take < 2) return null;
  const part = (lines: readonly Line[]): Laid => ({
    ...laid,
    lines,
    height: lines.length * laid.box.advance,
  });
  return [part(laid.lines.slice(0, take)), part(laid.lines.slice(take))];
}
