/**
 * Typed text in a brain-map report: which language to print, how it breaks
 * into paragraphs, how the wording's bold is read, and how what a person
 * typed is made safe to store.
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
    throw new Error(`The wording has an unclosed bold mark in "${marked}".`);
  }
  return parts
    .map((text, index) => ({ text, bold: index % 2 === 1 }))
    .filter((span) => span.text.length > 0);
}

const TAB = 0x09;
const SPACE = ' ';

/** A character with no glyph, which the document writer would drop in silence. */
function isRemoved(code: number): boolean {
  return (
    code <= 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    code === 0x7f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/**
 * What a person typed, made fit to store: composed, trimmed, with control
 * characters removed, and cut at `most` UTF-16 units without splitting a
 * character in two.
 */
export function clean(typed: string, most: number): string {
  let kept = '';
  for (const character of typed.normalize('NFC')) {
    const code = character.codePointAt(0) ?? 0;
    if (code === TAB) kept += SPACE;
    else if (!isRemoved(code)) kept += character;
  }
  let text = kept.trim();
  if (text.length > most) {
    let cut = most;
    if (cut > 0 && isHighSurrogate(text.charCodeAt(cut - 1))) cut -= 1;
    text = text.slice(0, cut).trimEnd();
  }
  return text;
}
