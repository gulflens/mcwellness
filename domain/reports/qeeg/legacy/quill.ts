/**
 * The old tool's formatted summary, read into this app's rich text.
 *
 * **What the old tool stored.** Its summary editor kept the text as a Quill
 * delta: a list of inserts, each with the attributes it was typed with, and a
 * newline at the very end. This app keeps plain text and a list of marks that
 * are bold, underlined, or both (`RichText` in `../types.ts`).
 *
 * **What is carried and what is not, and why it is named.** Bold and
 * underline are carried. Colour is not: hue in this app belongs to band data
 * and three states. Italic is not: Arabic has no italic, so a slant could be
 * honoured in one language only. Direction and alignment are not: the page
 * sets them from the language it is printed in. Anything else the editor may
 * have written is not carried either. Each kind that was left out is named
 * once in `dropped`, so the reader can put a note on the record that says the
 * summary was not carried exactly as printed.
 *
 * **Counting.** Offsets count UTF-16 units of the text, as `Mark` says, which
 * is what `String.prototype.length` counts. The inserts are joined, each
 * bold or underlined one read as a mark, and the whole is made fit to store
 * by `cleanRich` (`../text.ts`), the rule the editor uses: composed, rid of
 * control characters and the like, trimmed, with every mark still on the
 * letters it was typed over. That also takes off the newline a delta ends
 * with and any empty paragraphs before it. `removed` says whether anything
 * but white space was taken out. Nothing is cut here: the reader cuts to its
 * own limit and notes that it did.
 *
 * It never throws. Whatever cannot be read gives `{ ok: false }`, and the
 * reader falls back to the plain summary the old file also kept.
 */

import { cleanRich, isRecord, withoutUnseen } from '../text';
import type { Mark, RichText } from '../types';

export type Dropped = 'colour' | 'slant' | 'direction' | 'embed' | 'other';

const DROPPED_ORDER: readonly Dropped[] = Object.freeze([
  'colour',
  'slant',
  'direction',
  'embed',
  'other',
]);

type Span = {
  readonly from: number;
  readonly to: number;
  readonly bold: boolean;
  readonly underline: boolean;
};

/** An attribute that is present and not switched off. */
function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

function droppedFor(key: string): Dropped {
  switch (key) {
    case 'color':
      return 'colour';
    case 'italic':
      return 'slant';
    case 'direction':
    case 'align':
      return 'direction';
    default:
      return 'other';
  }
}

/** No cut here: the reader cuts to its own limit, and notes that it did. */
const UNCUT = Number.MAX_SAFE_INTEGER;

export function fromQuillDelta(
  deltaJson: string,
): { ok: true; rich: RichText; dropped: Dropped[]; removed: boolean } | { ok: false } {
  try {
    if (typeof deltaJson !== 'string') return { ok: false };
    const decoded: unknown = JSON.parse(deltaJson);
    const ops: unknown = Array.isArray(decoded)
      ? decoded
      : isRecord(decoded)
        ? decoded['ops']
        : undefined;
    if (!Array.isArray(ops)) return { ok: false };

    const dropped = new Set<Dropped>();
    const spans: Span[] = [];
    let text = '';

    for (const op of ops as readonly unknown[]) {
      if (!isRecord(op)) {
        dropped.add('other');
        continue;
      }
      const insert = op['insert'];
      if (typeof insert !== 'string') {
        dropped.add(insert === undefined ? 'other' : 'embed');
        continue;
      }
      const attributes = op['attributes'];
      let bold = false;
      let underline = false;
      if (isRecord(attributes)) {
        for (const [key, value] of Object.entries(attributes)) {
          if (key === 'bold' || key === 'underline') {
            if (value === true) {
              if (key === 'bold') bold = true;
              else underline = true;
            } else if (isSet(value)) {
              dropped.add('other');
            }
          } else if (isSet(value)) {
            dropped.add(droppedFor(key));
          }
        }
      } else if (isSet(attributes)) {
        dropped.add('other');
      }

      const from = text.length;
      text += insert;
      if (bold || underline) spans.push({ from, to: text.length, bold, underline });
    }

    const marks: Mark[] = spans.map(({ from, to, bold, underline }) => ({
      from,
      to,
      ...(bold ? { bold: true as const } : {}),
      ...(underline ? { underline: true as const } : {}),
    }));
    return {
      ok: true,
      rich: cleanRich({ text, marks }, UNCUT),
      dropped: DROPPED_ORDER.filter((kind) => dropped.has(kind)),
      removed: withoutUnseen(text).length < text.length,
    };
  } catch {
    return { ok: false };
  }
}
