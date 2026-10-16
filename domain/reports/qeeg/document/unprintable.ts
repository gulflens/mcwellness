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
 * **Asked by the writer itself.** A Latin character is asked of the
 * regular or the bold face its op is set in, and of that weight's extended
 * face when the first has no glyph; an Arabic one of the Arabic face, or of
 * the bold Arabic face when the op is bold and the set carries one. A
 * right-to-left op is shaped first, as the writer shapes it, so what is asked
 * is the glyph that would be drawn, not the letter that was typed.
 *
 * **Code points, not the characters.** The answer travels to the screen in a
 * response header, and a header carries ASCII. `U+0141` names the letter
 * exactly and the screen can show it beside its name.
 *
 * Pure: pages and faces in, a sorted list out, nothing thrown.
 */

import { undrawable } from '@domain/shared/document';
import type { FontSet, Page } from '@domain/shared/document';

/** A code point as `U+` and at least four upper-case hex digits. */
function named(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * The writer's own answer (`undrawable`, `domain/shared/document/pdf.ts`),
 * named for a header. Asked of the writer rather than worked out again here,
 * so the two can never disagree about which face a character goes to — the
 * extended Latin faces of docs/CHANGE-REQUESTS/docfix-01.md included.
 */
export function unprintableIn(pages: readonly Page[], fonts: FontSet): string[] {
  return undrawable(pages, fonts).map(named);
}
