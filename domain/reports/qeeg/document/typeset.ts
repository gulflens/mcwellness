/**
 * Words set as a block, by the role they play: the one place where a role's
 * style (`styles.ts`) becomes a paragraph (`paragraph.ts`).
 *
 * **Why one place.** Every piece of the report sets words, and each would
 * otherwise decide for itself which way a paragraph reads and which edge it
 * is set against. Those two decisions are where the old tool's English and
 * Arabic reports came apart, so they are made here, once, for every piece.
 *
 * **Which way a paragraph reads.** Fixed wording reads the way its report
 * does, whatever it begins with. What a person typed reads the way its first
 * letter does: English typed into an Arabic report is an English paragraph,
 * wrapped left to right. It is still set against the REPORT's start edge, so
 * a column of answers keeps one edge whatever language each was typed in.
 *
 * **`align` is the report's.** 'start' is where a line of the report begins:
 * the left of an English page and the right of an Arabic one. A paragraph's
 * own idea of start and end (`ParagraphInput.align`) is worked out from it
 * here and nowhere else.
 *
 * **The line height follows the paragraph**, not the report: Arabic typed
 * into an English report is given the room an Arabic face needs.
 */

import { baseDirection } from './bidi';
import { blank, paragraphBlock } from './block';
import type { Block } from './block';
import type { Direction } from './direction';
import type { Face } from './metrics';
import { ACCENT, TIER_PAINT } from './palette';
import type { Tier } from './palette';
import type { Measure, Span } from './paragraph';
import type { Paint } from './shapes';
import { styleOf } from './styles';
import type { Role } from './styles';

/** What every piece is handed to draw with: the report's direction, and its faces measured. */
export type Drawing = {
  readonly direction: Direction;
  readonly measure: Measure;
  readonly faces: { readonly latin: Face; readonly arabic: Face };
};

export type Setting = {
  /** Against which edge of the report. Default 'start'. */
  readonly align?: 'start' | 'end' | 'centre';
  /** A person typed it, so it reads the way its first letter does. Default false. */
  readonly typed?: boolean;
  /** The score whose hue a card's category takes. */
  readonly tier?: Tier;
  /** Set to both edges. Default false (`docs/SPEC/reports-qeeg.md` section 12, point 4). */
  readonly justify?: boolean;
};

function inkOf(role: Role, setting: Setting): Paint {
  const { paint } = styleOf(role, 'ltr');
  if (paint) return paint;
  if (!setting.tier) throw new RangeError(`typeset needs a tier for ${role}.`);
  return { rgb: TIER_PAINT[setting.tier] };
}

/** Where the report's edge is, in the paragraph's own terms. */
function alignIn(
  paragraph: Direction,
  report: Direction,
  asked: NonNullable<Setting['align']>,
): NonNullable<Setting['align']> {
  if (asked === 'centre' || paragraph === report) return asked;
  return asked === 'start' ? 'end' : 'start';
}

/** Words in a role, wrapped to `width`. No words are no block: nothing drawn, no room taken. */
export function typeset(
  role: Role,
  content: string | readonly Span[],
  width: number,
  drawing: Drawing,
  setting: Setting = {},
): Block {
  const ink = inkOf(role, setting);
  const spans: readonly Span[] = typeof content === 'string' ? [{ text: content }] : content;
  const plain = spans.map((span) => span.text).join('');
  if (plain.trim() === '') return blank(width, 0);

  const paragraph =
    setting.typed === true ? baseDirection(plain, drawing.direction) : drawing.direction;
  const { style, underline } = styleOf(role, paragraph);
  return paragraphBlock(
    {
      spans: underline ? spans.map((span) => ({ ...span, underline: true })) : spans,
      style,
      width,
      paragraph,
      align: alignIn(paragraph, drawing.direction, setting.align ?? 'start'),
      justify: setting.justify === true,
      ink,
      accent: ACCENT,
      faces: drawing.faces,
    },
    drawing.measure,
  );
}
