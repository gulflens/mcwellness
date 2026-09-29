/**
 * Typed text in a brain-map report: which language to print, how it breaks
 * into paragraphs, how the wording's bold is read, how what a person typed
 * is made safe to store, and what counts as a day.
 *
 * **Her English stands in for a missing Arabic.** A practitioner types once
 * in English and may add Arabic. An Arabic report prints her Arabic where she
 * gave some and her English where she did not, so nothing she wrote is lost
 * from either report. Arabic of nothing but white space counts as none: a
 * blank line on an Arabic page is worse than an English sentence.
 *
 * **Marks are cut, never stretched.** A bold stretch that crosses a newline is
 * cut into one stretch per paragraph, because the document writer lays out a
 * paragraph at a time, and a stretch cut down to nothing is dropped.
 *
 * **A fault in the wording throws; a fault in what was typed is cleaned.**
 * An odd number of `**` in a fixed sentence is a mistake a test should catch
 * before anyone reads it. Control characters in a typed sentence are a person
 * pasting from somewhere else, and are removed quietly: they have no glyph,
 * and the document writer would ignore them anyway.
 */

import type { Bilingual, BilingualRich, Locale, Mark, RichText } from './types';

const hasSomething = (text: string) => text.trim().length > 0;

/** A plain set of fields: an object that is not an array. The one test of it here. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function textFor(locale: Locale, text: Bilingual): string {
  if (locale === 'ar' && text.ar !== null && hasSomething(text.ar)) return text.ar;
  return text.en;
}

export function richFor(locale: Locale, text: BilingualRich): RichText {
  if (locale === 'ar' && text.ar !== null && !isEmpty(text.ar)) return text.ar;
  return text.en;
}

/** Nothing but white space. */
export function isEmpty(rich: RichText): boolean {
  return !hasSomething(rich.text);
}

export function plain(rich: RichText): string {
  return rich.text;
}

/** The part of a mark that falls between `start` and `end`, counted from `start`. */
function markWithin(mark: Mark, start: number, end: number): Mark | null {
  const from = Math.max(mark.from, start);
  const to = Math.min(mark.to, end);
  if (to <= from) return null;
  return { ...mark, from: from - start, to: to - start };
}

/** One rich text per paragraph, marks re-based, empty paragraphs dropped. */
export function toParagraphs(rich: RichText): RichText[] {
  const paragraphs: RichText[] = [];
  let start = 0;
  for (const text of rich.text.split('\n')) {
    const end = start + text.length;
    if (hasSomething(text)) {
      const marks = rich.marks
        .map((mark) => markWithin(mark, start, end))
        .filter((mark): mark is Mark => mark !== null);
      paragraphs.push({ text, marks });
    }
    start = end + 1;
  }
  return paragraphs;
}

export type BoldSpan = { text: string; bold: boolean };

const BOLD = '**';

/** The wording's `**bold**` marks, read into spans. Empty spans are left out. */
export function spansOf(marked: string): BoldSpan[] {
  const parts = marked.split(BOLD);
  if (parts.length % 2 === 0) {
    // The fault and nothing else: what is given here could one day hold
    // something a person typed, and an error reaches a log.
    throw new Error('The wording has an unclosed bold mark.');
  }
  return parts
    .map((text, index) => ({ text, bold: index % 2 === 1 }))
    .filter((span) => span.text.length > 0);
}

const TAB = 0x09;
const SPACE = ' ';

/**
 * A character with no glyph, which the document writer would drop in
 * silence, or one that would move what follows it about the page: the two
 * blocks of controls, a carriage return (so a Windows line end becomes a
 * newline), the line and paragraph separators, the zero-width space and the
 * word joiner, the direction marks, embeddings and isolates, and the
 * byte-order mark. A lone half of a surrogate pair is removed too: it is no
 * letter, and the database refuses it.
 *
 * **Two characters with no glyph are KEPT**: U+200C, which parts two letters
 * that would otherwise join, and U+200D, which joins. Both are part of what
 * she typed. The document writer honours the first when it shapes a word, so
 * taking it out would change the word on the page; and a name gathered from
 * a client's record would no longer equal the record it came from. What is
 * stored is the record, and a character removed from it cannot be put back.
 */
function isRemoved(code: number): boolean {
  return (
    code <= 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0d && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    code === 0x200b ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x2028 && code <= 0x202e) ||
    code === 0x2060 ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff ||
    (code >= 0xd800 && code <= 0xdfff)
  );
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/**
 * What `clean` removes, removed, and nothing else: no trimming, no cutting,
 * no composing. A tab becomes a space, so the length changes only where a
 * character went. The old summary's reader uses it on each piece of text
 * before counting, so a mark still lands on the letters it was typed over.
 */
export function withoutUnseen(typed: string): string {
  let kept = '';
  for (const character of typed) {
    const code = character.codePointAt(0) ?? 0;
    if (code === TAB) kept += SPACE;
    else if (!isRemoved(code)) kept += character;
  }
  return kept;
}

/**
 * What a person typed, made fit to store: composed, trimmed, with control
 * characters removed, and cut at `most` UTF-16 units without splitting a
 * character in two.
 */
export function clean(typed: string, most: number): string {
  checkMost(most);
  let text = withoutUnseen(typed.normalize('NFC')).trim();
  if (text.length > most) text = text.slice(0, cutAt(text, most)).trimEnd();
  return text;
}

function checkMost(most: number): void {
  if (!Number.isInteger(most) || most < 1) {
    throw new RangeError('A length to cut at is a whole number above 0.');
  }
}

/** Where to cut `text` at `most` units without splitting a letter written as a pair. */
function cutAt(text: string, most: number): number {
  return isHighSurrogate(text.charCodeAt(most - 1)) ? most - 1 : most;
}

const BOLD_BIT = 1;
const UNDERLINE_BIT = 2;
const COMBINING = /\p{M}/u;

/**
 * The style of every UTF-16 unit of a text of `length`: bold, underlined,
 * both, or neither. Marks out of order, overlapping, or running past the
 * text are what a person's editor may hand over, so they are read, never
 * refused: a unit is bold when any bold mark covers it, and so for
 * underline. An edge that is no number covers nothing.
 */
function unitStyles(marks: readonly Mark[], length: number): Uint8Array {
  const bold = new Int32Array(length + 1);
  const underline = new Int32Array(length + 1);
  for (const mark of marks) {
    const isBold = mark.bold === true;
    const isUnderlined = mark.underline === true;
    if (!isBold && !isUnderlined) continue;
    // A unit at `i` is covered when from <= i < to.
    const from = Math.min(Math.max(Math.ceil(mark.from), 0), length);
    const to = Math.min(Math.max(Math.ceil(mark.to), 0), length);
    if (!(from < to)) continue;
    if (isBold) {
      bold[from] = (bold[from] ?? 0) + 1;
      bold[to] = (bold[to] ?? 0) - 1;
    }
    if (isUnderlined) {
      underline[from] = (underline[from] ?? 0) + 1;
      underline[to] = (underline[to] ?? 0) - 1;
    }
  }
  const styles = new Uint8Array(length);
  let inBold = 0;
  let inUnderline = 0;
  for (let i = 0; i < length; i += 1) {
    inBold += bold[i] ?? 0;
    inUnderline += underline[i] ?? 0;
    styles[i] = (inBold > 0 ? BOLD_BIT : 0) | (inUnderline > 0 ? UNDERLINE_BIT : 0);
  }
  return styles;
}

/** Whether `next` becomes part of the letter `letter` when the text is composed. */
function joins(letter: string, next: string): boolean {
  if (letter === '') return false;
  if (COMBINING.test(next)) return true;
  return (letter + next).normalize('NFC') !== letter.normalize('NFC') + next.normalize('NFC');
}

type Styled = { readonly text: string; readonly style: number };

/**
 * What a person typed with its bold and underline, made fit to store by the
 * rule `clean` follows: composed, rid of what `withoutUnseen` removes,
 * trimmed at both ends, and cut at `most` UTF-16 units without splitting a
 * letter written as a pair. Every mark still covers the letters it was typed
 * over.
 *
 * **Why it works a letter at a time.** Composing joins two characters into
 * one letter: a letter and its accent, or two Korean jamo, where the second
 * is no combining mark at all. A mark whose edge fell between them would
 * slip by one if the text were composed as a whole and the mark left where
 * it was. So what is removed goes first, the rest is gathered into the runs
 * that compose into one letter, and each letter takes the style of the first
 * of its characters that has one: an edge that falls inside a letter is
 * moved OUTWARD to take the whole of it, and where two marks meet inside
 * one letter, the earlier keeps it.
 *
 * **What comes back is tidy.** Marks are in order, never overlap, and never
 * run past the text; alike neighbours that touch are one mark; a mark that
 * ends up empty, or is neither bold nor underlined, is gone. Cleaning twice
 * is cleaning once.
 *
 * How many marks there may be is not this function's to decide: the shape
 * refuses too many by name (`LIMITS.marks`), and the old-file reader keeps
 * the first ones with a note.
 */
export function cleanRich(rich: RichText, most: number): RichText {
  checkMost(most);
  const source = rich.text;
  const units = unitStyles(rich.marks, source.length);

  // What `withoutUnseen` removes, removed, each character keeping its style.
  const kept: Styled[] = [];
  for (let i = 0; i < source.length;) {
    const code = source.codePointAt(i) ?? 0;
    const size = code > 0xffff ? 2 : 1;
    const style = (units[i] ?? 0) || (size === 2 ? (units[i + 1] ?? 0) : 0);
    if (code === TAB) kept.push({ text: SPACE, style });
    else if (!isRemoved(code)) kept.push({ text: source.slice(i, i + size), style });
    i += size;
  }

  // Gathered into letters, each composed, each styled by its first styled part.
  let text = '';
  const styles: number[] = [];
  let letter = '';
  let letterStyle = 0;
  const flush = () => {
    const composed = letter.normalize('NFC');
    text += composed;
    for (let i = 0; i < composed.length; i += 1) styles.push(letterStyle);
    letter = '';
    letterStyle = 0;
  };
  for (const character of kept) {
    if (!joins(letter, character.text)) flush();
    letter += character.text;
    if (letterStyle === 0) letterStyle = character.style;
  }
  flush();

  // Trimmed, then cut, as `clean` does.
  const lead = text.length - text.trimStart().length;
  let end = text.trimEnd().length;
  if (end - lead > most) {
    const cut = cutAt(text.slice(lead, end), most);
    end = lead + text.slice(lead, lead + cut).trimEnd().length;
  }
  return { text: text.slice(Math.min(lead, end), end), marks: marksOf(styles.slice(lead, end)) };
}

/** One mark for each run of units alike in style, leaving out the unstyled. */
function marksOf(styles: readonly number[]): Mark[] {
  const marks: Mark[] = [];
  let from = 0;
  for (let i = 1; i <= styles.length; i += 1) {
    const style = styles[from] ?? 0;
    if (i < styles.length && styles[i] === style) continue;
    if (style !== 0) {
      marks.push({
        from,
        to: i,
        ...((style & BOLD_BIT) !== 0 ? { bold: true as const } : {}),
        ...((style & UNDERLINE_BIT) !== 0 ? { underline: true as const } : {}),
      });
    }
    from = i;
  }
  return marks;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The years a recording can have been made in. Anything else is a slip of the keyboard. */
const FIRST_YEAR = 2000;
const LAST_YEAR = 2100;

/**
 * A real day, written `YYYY-MM-DD`, in a year from 2000 to 2100. The one rule
 * for both the shape and the old-file reader, so the two cannot disagree. It
 * works from the length of each month and constructs no `Date`, which reads
 * a year below 100 as the 1900s.
 */
export function isRealDay(text: string): boolean {
  const parts = ISO_DAY.exec(text);
  if (!parts) return false;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (year < FIRST_YEAR || year > LAST_YEAR || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= days;
}
