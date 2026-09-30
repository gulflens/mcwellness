/**
 * Every character a report's pages hold that no face it is set in can draw
 * (docs/SPEC/reports-qeeg.md section 12, point 10).
 *
 * **Why the editor is told.** The writer draws each character in the face its
 * script belongs to, and a character that face does not hold is simply left
 * out (`domain/shared/document/pdf.ts`, `runsOf`). A name typed with a letter
 * outside the installed Latin subset would print with that letter missing and
 * nothing would say so. The preview says so instead, before she signs.
 *
 * **Asked the way the writer asks.** A Latin character is asked of the
 * regular or the bold face its op is set in; an Arabic one of the Arabic
 * face, or of the bold Arabic face when the op is bold and the set carries
 * one. A right-to-left op is shaped first, as the writer shapes it, so what is
 * asked is the glyph that would be drawn, not the letter that was typed.
 *
 * **Code points, not the characters.** The answer travels to the screen in a
 * response header, and a header carries ASCII. `U+0141` names the letter
 * exactly and the screen can show it beside its name.
 *
 * Pure: pages and faces in, a sorted list out, nothing thrown.
 */

import { forDrawing, glyphFor, isArabic } from '@domain/shared/document';
import type { Font, FontSet, Page, Style } from '@domain/shared/document';

/** The face the writer draws `code` in, for an op set in `style`. */
function faceFor(code: number, style: Style, fonts: FontSet): Font {
  const bold = style.font === 'bold' || style.font === 'arabicBold';
  if (isArabic(code)) return bold && fonts.arabicBold ? fonts.arabicBold : fonts.arabic;
  return bold ? fonts.bold : fonts.regular;
}

/** A code point as `U+` and at least four upper-case hex digits. */
function named(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function unprintableIn(pages: readonly Page[], fonts: FontSet): string[] {
  const missing = new Set<number>();
  for (const page of pages) {
    for (const op of page.ops) {
      if (op.kind !== 'text') continue;
      const codes =
        op.rtl === true ? forDrawing(op.text) : [...op.text].map((c) => c.codePointAt(0) ?? 0);
      for (const code of codes) {
        if (glyphFor(faceFor(code, op.style, fonts), code) === null) missing.add(code);
      }
    }
  }
  return [...missing].sort((a, b) => a - b).map(named);
}
