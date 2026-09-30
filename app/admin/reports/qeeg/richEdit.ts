import { BOLD_BIT, marksOf, UNDERLINE_BIT, unitStyles } from '../../../../domain/reports/qeeg/text';
import type { RichText } from '../../../../domain/reports/qeeg/types';

/**
 * Bold and underline in the brain-map summary box, kept on the letters they
 * were set on while the practitioner types around them.
 *
 * **Why the box is plain text with marks beside it.** The report stores its
 * summary as text and a list of stretches that are bold, underlined or both
 * (`domain/reports/qeeg/types.ts`, `RichText`), counted in UTF-16 units of the
 * text. A plain text box keeps exactly that and nothing else: no colour, no
 * slant, no pasted formatting to strip. What the box cannot show, the form
 * shows beneath it as the page will set it.
 *
 * **What happens to a mark when she types.** Text typed before a mark moves
 * it along; text typed inside it grows it; text typed straight after it is
 * not styled, as in most editors; what is deleted takes its part of the mark
 * with it, and a mark deleted whole is gone. That is all this file decides.
 * Cleaning the text before it is saved is the domain's (`cleanRich`), and so
 * is every rule of what a mark may be, and how marks become the style of each
 * unit and back (`unitStyles`, `marksOf`), which this file asks rather than
 * restates.
 *
 * Pure, and each function returns a new value.
 */

export type Style = 'bold' | 'underline';

const BIT: Readonly<Record<Style, number>> = { bold: BOLD_BIT, underline: UNDERLINE_BIT };

/** Whether every unit from `from` to `to` has each style. False for an empty stretch. */
export function stylesAt(rich: RichText, from: number, to: number): Record<Style, boolean> {
  const styles = unitStyles(rich.marks, rich.text.length).slice(from, to);
  const every = (bit: number) => styles.length > 0 && styles.every((style) => (style & bit) !== 0);
  return { bold: every(BIT.bold), underline: every(BIT.underline) };
}

/**
 * The style set over the stretch, or taken off it when the whole stretch
 * already has it, the way a Bold button behaves.
 */
export function toggleMark(rich: RichText, from: number, to: number, style: Style): RichText {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(rich.text.length, Math.max(from, to));
  if (start >= end) return rich;
  const styles = unitStyles(rich.marks, rich.text.length);
  const on = !stylesAt(rich, start, end)[style];
  for (let at = start; at < end; at += 1) {
    const was = styles[at] ?? 0;
    styles[at] = on ? was | BIT[style] : was & ~BIT[style];
  }
  return { text: rich.text, marks: marksOf(styles) };
}

/**
 * The marks carried over to the text as it now reads. The change is found as
 * one stretch replaced by another, between what the two texts share at the
 * start and at the end, which is what a keystroke, a paste or a cut is.
 */
export function retype(rich: RichText, next: string): RichText {
  const was = rich.text;
  if (was === next) return rich;
  const most = Math.min(was.length, next.length);
  let head = 0;
  while (head < most && was.charCodeAt(head) === next.charCodeAt(head)) head += 1;
  let tail = 0;
  while (
    tail < most - head &&
    was.charCodeAt(was.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)
  ) {
    tail += 1;
  }
  const removedEnd = was.length - tail;
  const insertedEnd = next.length - tail;
  const shift = next.length - was.length;

  // A mark's start inside what was replaced moves past what replaced it; its
  // end moves back to where the replacement began. So text typed at either
  // edge of a mark is left unstyled, and text typed within it is not.
  const startOf = (at: number) => (at < head ? at : at >= removedEnd ? at + shift : insertedEnd);
  const endOf = (at: number) => (at <= head ? at : at > removedEnd ? at + shift : head);

  const marks = rich.marks
    .map((mark) => ({ ...mark, from: startOf(mark.from), to: endOf(mark.to) }))
    .filter((mark) => mark.from < mark.to);
  return { text: next, marks };
}
