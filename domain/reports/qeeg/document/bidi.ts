/**
 * Which words of a line are drawn right to left, and which left to right.
 *
 * **Why the layout needs this before the engine sees a string.** The PDF
 * writer's `rtl` text op (`domain/shared/document/arabic.ts`) shapes its whole
 * string and turns it round, keeping only bare stretches of Latin and digits
 * in order. That is right for Arabic words and for a plain number among them,
 * and wrong for a telephone number with a plus sign, an email address, a
 * percentage or a range with a dash: those come out scrambled. So a paragraph
 * is cut, word by word, into runs of one direction, and only runs the engine
 * draws correctly are handed to it as `rtl`.
 *
 * **A small subset of the Unicode bidirectional algorithm, on purpose.** A
 * report paragraph is one base direction with the other script embedded as
 * words and phrases; there is no nesting. So the unit is the word, not the
 * character, and five rules cover it: the first strong character sets the
 * base; brackets and sentence punctuation at the edge of a Latin word or a
 * figure are peeled off in a right-to-left paragraph so they can take the
 * Arabic's side; a neutral word between two words of one direction takes it,
 * else the paragraph's; neighbouring figures are one left-to-right run; and
 * only a plain number may join an Arabic run.
 *
 * **Figures typed on an Arabic keyboard are figures.** U+0660 to 0669 and the
 * Persian U+06F0 to 06F9 sit inside the Arabic block, but they are digits:
 * a word of them is a neutral figure drawn left to right, never an Arabic
 * letter and never merged into an `rtl` op, because the engine keeps only
 * ASCII figures in order there. A word that runs Arabic letters into them is
 * cut at the join. The Arabic percent sign and the Arabic comma, semicolon
 * and question mark are marks, never letters.
 *
 * Pure: text in, runs out.
 */

import { isArabic } from '@domain/shared/document';

export type Direction = 'ltr' | 'rtl';

/** Holds Arabic; holds Latin and no Arabic; holds no letter. */
export type TokenClass = 'R' | 'L' | 'N';

/** One word, or a piece peeled off one. `glued`: no space before it. */
export type Token = { text: string; class: TokenClass; glued: boolean };

/** Neighbouring tokens drawn in one direction, in reading order. */
export type Run = { direction: Direction; tokens: readonly Token[] };

function isLatin(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0xc0 && code <= 0x24f)
  );
}

/** A figure an Arabic keyboard types (U+0660 to 0669) or a Persian one (U+06F0 to 06F9). */
function isArabicDigit(code: number): boolean {
  return (code >= 0x0660 && code <= 0x0669) || (code >= 0x06f0 && code <= 0x06f9);
}

/** A figure of either script. */
function isDigit(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || isArabicDigit(code);
}

/**
 * Characters inside the Arabic block that are not letters: the Arabic
 * decimal and thousands separators, the Arabic percent sign, and the Arabic
 * comma, semicolon and question mark. They take a side from what surrounds
 * them, as their Latin counterparts do.
 */
const ARABIC_NEUTRALS = new Set([0x066b, 0x066c, 0x066a, 0x060c, 0x061b, 0x061f]);

/**
 * A strong Arabic character: in the Arabic blocks and neither a figure nor
 * a neutral. The engine's `isArabic` counts the whole block, figures
 * included, which is right for choosing a face and wrong for choosing a
 * direction: the engine does not keep Arabic figures in order inside an
 * `rtl` op, so they must never be read as Arabic letters here.
 */
function isArabicLetter(code: number): boolean {
  return isArabic(code) && !isArabicDigit(code) && !ARABIC_NEUTRALS.has(code);
}

function codesOf(text: string): number[] {
  return [...text].map((character) => character.codePointAt(0) ?? 0);
}

/** The direction of the first strong character, or the fallback when there is none. */
export function baseDirection(text: string, fallback: Direction): Direction {
  for (const code of codesOf(text)) {
    if (isArabicLetter(code)) return 'rtl';
    if (isLatin(code)) return 'ltr';
  }
  return fallback;
}

export function classify(word: string): TokenClass {
  const codes = codesOf(word);
  if (codes.some(isArabicLetter)) return 'R';
  if (codes.some(isLatin)) return 'L';
  return 'N';
}

const PLAIN_NUMBER = /^[0-9]+([.,:/-][0-9]+)*$/;

/** Digits joined by the separators of a figure or a date: what an `rtl` op keeps in order. */
export function isPlainNumber(text: string): boolean {
  return PLAIN_NUMBER.test(text);
}

/**
 * Brackets and sentence punctuation, Latin and Arabic. At the edge of a
 * figure or a Latin word in an Arabic line they belong to the Arabic, not to
 * the word: the full stop of an English sentence set right to left ends up
 * at its left, and the bracket before a range has to be mirrored.
 */
const PEELABLE = new Set([...'()[]{}«».,;:!?…،؛؟٪']);

function peelable(character: string): boolean {
  return PEELABLE.has(character);
}

/** One word, cut into its leading punctuation, its core and its trailing punctuation. */
function peel(word: string, glued: boolean): Token[] {
  const characters = [...word];
  let start = 0;
  while (start < characters.length && peelable(characters[start] ?? '')) start += 1;
  let end = characters.length;
  while (end > start && peelable(characters[end - 1] ?? '')) end -= 1;
  const core = characters.slice(start, end).join('');
  // Nothing but punctuation, or an Arabic word: left whole, since the engine
  // mirrors and places punctuation inside an Arabic run itself.
  if (core.length === 0 || classify(core) === 'R' || (start === 0 && end === characters.length)) {
    return [{ text: word, class: classify(word), glued }];
  }
  const out: Token[] = [];
  if (start > 0) out.push({ text: characters.slice(0, start).join(''), class: 'N', glued });
  out.push({ text: core, class: classify(core), glued: start > 0 ? true : glued });
  if (end < characters.length) {
    out.push({ text: characters.slice(end).join(''), class: 'N', glued: true });
  }
  return out;
}

/**
 * A word cut wherever Arabic letters meet Arabic figures, as in a figure typed
 * straight after a word. Whole, it would be one Arabic token, and the engine
 * would turn its figures round with the letters. The cut falls just after
 * the last letter or figure of the first kind, so a separator between the two
 * stays with what follows it.
 */
function cutAtFigures(word: string): string[] {
  const characters = [...word];
  const pieces: string[] = [];
  let start = 0;
  let lastKind: 'letter' | 'figure' | null = null;
  let lastAt = -1;
  characters.forEach((character, at) => {
    const code = character.codePointAt(0) ?? 0;
    const kind = isArabicLetter(code) ? 'letter' : isArabicDigit(code) ? 'figure' : null;
    if (kind === null) return;
    if (lastKind !== null && kind !== lastKind) {
      pieces.push(characters.slice(start, lastAt + 1).join(''));
      start = lastAt + 1;
    }
    lastKind = kind;
    lastAt = at;
  });
  pieces.push(characters.slice(start).join(''));
  return pieces;
}

/**
 * The words of a line. Spaces separate words and are not kept: a run of them
 * reads as one, which is all a laid-out paragraph can show anyway.
 */
export function tokenise(text: string, paragraph: Direction): Token[] {
  const words = text.split(' ').filter((word) => word.length > 0);
  return words.flatMap((word) =>
    cutAtFigures(word).flatMap((piece, index) => {
      const glued = index > 0;
      return paragraph === 'rtl'
        ? peel(piece, glued)
        : [{ text: piece, class: classify(piece), glued }];
    }),
  );
}

/**
 * Each token's direction. A strong token has its own; a neutral one takes the
 * direction of the strong tokens either side of it when they agree, and the
 * paragraph's otherwise, the edge of the line counting as the paragraph.
 */
export function resolve(tokens: readonly Token[], paragraph: Direction): Direction[] {
  const strong = (token: Token): Direction | null =>
    token.class === 'R' ? 'rtl' : token.class === 'L' ? 'ltr' : null;
  const before: (Direction | null)[] = [];
  let seen: Direction | null = null;
  for (const token of tokens) {
    before.push(seen);
    seen = strong(token) ?? seen;
  }
  const after: (Direction | null)[] = new Array<Direction | null>(tokens.length).fill(null);
  seen = null;
  for (let at = tokens.length - 1; at >= 0; at -= 1) {
    after[at] = seen;
    const token = tokens[at];
    if (token) seen = strong(token) ?? seen;
  }
  return tokens.map((token, at) => {
    const own = strong(token);
    if (own) return own;
    const left = before[at] ?? null;
    const right = after[at] ?? null;
    return left !== null && left === right ? left : paragraph;
  });
}

/**
 * How a token may be drawn. `arabic` tokens share one `rtl` op; `ltr` tokens
 * share one left-to-right op; a `mark` is punctuation on the Arabic side,
 * drawn right to left on its own.
 */
type Kind = 'arabic' | 'ltr' | 'mark' | 'number';

function holdsDigit(token: Token): boolean {
  return codesOf(token.text).some(isDigit);
}

/** The runs of a line, in reading order. */
export function runsOf(text: string, paragraph: Direction): Run[] {
  const tokens = tokenise(text, paragraph);
  const directions = resolve(tokens, paragraph);

  // A figure is a neutral holding a digit. Two or more side by side — a
  // telephone number, a time range — are one left-to-right run, however
  // they resolved.
  const figure = tokens.map((token) => token.class === 'N' && holdsDigit(token));
  const grouped = figure.map(
    (is, at) => is && (figure[at - 1] === true || figure[at + 1] === true),
  );

  const kinds: Kind[] = tokens.map((token, at) => {
    if (token.class === 'R') return 'arabic';
    if (token.class === 'L' || grouped[at] || directions[at] === 'ltr') return 'ltr';
    if (isPlainNumber(token.text)) return 'number';
    return figure[at] ? 'ltr' : 'mark';
  });

  // A plain number resolved to the Arabic side joins the Arabic beside it;
  // with no Arabic next to it, there is nothing to join and it is a figure.
  const settled: Kind[] = kinds.map((kind, at) => {
    if (kind !== 'number') return kind;
    return kinds[at - 1] === 'arabic' || kinds[at + 1] === 'arabic' ? 'arabic' : 'ltr';
  });

  const runs: { kind: Kind; tokens: Token[] }[] = [];
  tokens.forEach((token, at) => {
    const kind = settled[at] ?? 'ltr';
    const last = runs[runs.length - 1];
    if (last && last.kind === kind && kind !== 'mark') {
      last.tokens.push(token);
      return;
    }
    runs.push({ kind, tokens: [token] });
  });
  return runs.map((run) => ({
    direction: run.kind === 'ltr' ? 'ltr' : 'rtl',
    tokens: run.tokens,
  }));
}

/** A run's text, with the spaces between its words put back. */
export function textOf(run: Run): string {
  return run.tokens.map((token, at) => (at > 0 && !token.glued ? ' ' : '') + token.text).join('');
}
