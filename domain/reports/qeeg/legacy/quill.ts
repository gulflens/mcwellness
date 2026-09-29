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
 * is what `String.prototype.length` counts. The text is written in composed
 * form (NFC) before it is counted, so a mark lands on the letters it was
 * typed over. What `clean` would remove (control characters and the
 * like, `../text.ts`) is removed before it is counted too, for the same
 * reason, and `removed` says whether anything was. The inserts are joined
 * first and composed as a whole, so an insert that opens with a combining
 * mark joins the letter before it, and a mark whose edge falls inside a
 * letter written as a pair is moved outward to take the whole letter.
 *
 * It never throws. Whatever cannot be read gives `{ ok: false }`, and the
 * reader falls back to the plain summary the old file also kept.
 */

import { withoutUnseen } from '../text';
import type { Mark, RichText } from '../types';

export type Dropped = 'colour' | 'slant' | 'direction' | 'embed' | 'other';

const DROPPED_ORDER: readonly Dropped[] = Object.freeze([
  'colour',
  'slant',
  'direction',
  'embed',
  'other',
]);

type Style = { readonly bold: boolean; readonly underline: boolean };
type Span = Style & { readonly from: number; readonly to: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

/** The text with the newline a delta ends with, and any empty paragraphs before it, taken off. */
function withoutEmptyEnd(text: string): string {
  const paragraphs = text.split('\n');
  let end = paragraphs.length;
  while (end > 0 && (paragraphs[end - 1] ?? '').trim() === '') end -= 1;
  return paragraphs.slice(0, end).join('\n');
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const COMBINING = /\p{M}/u;

/** Whether `at` falls between the two halves of a letter written as a pair. */
function splitsPair(text: string, at: number): boolean {
  return at > 0 && isHigh(text.charCodeAt(at - 1)) && isLow(text.charCodeAt(at));
}

/** Past any combining mark at `at`: a mark belongs to the letter before it. */
function pastCombining(text: string, at: number): number {
  let edge = at;
  while (edge < text.length && COMBINING.test(text.charAt(edge))) edge += 1;
  return edge;
}

/**
 * A span whose edges fall on the edges of letters: one that begins or ends
 * inside a pair is moved outward to take the whole letter, and an edge
 * before a combining mark is moved after it, to the letter's end.
 */
function atLetterEdges(text: string, span: Span): Span {
  const from = splitsPair(text, span.from) ? span.from - 1 : span.from;
  const to = splitsPair(text, span.to) ? span.to + 1 : span.to;
  return { ...span, from: pastCombining(text, from), to: pastCombining(text, to) };
}

/**
 * The joined text, composed (NFC) and with what `clean` removes taken out,
 * and each span re-based onto it. The text is worked a stretch at a time
 * between the spans' edges, which fall on the edges of letters, so the
 * whole comes out composed and every span still covers the letters it was
 * typed over.
 */
function settle(
  text: string,
  spans: readonly Span[],
): { text: string; spans: Span[]; removed: boolean } {
  const edges = [...new Set([0, text.length, ...spans.flatMap((s) => [s.from, s.to])])].sort(
    (a, b) => a - b,
  );
  const moved = new Map<number, number>();
  let out = '';
  let removed = false;
  let previous = 0;
  for (const edge of edges) {
    const composed = text.slice(previous, edge).normalize('NFC');
    const piece = withoutUnseen(composed);
    if (piece.length < composed.length) removed = true;
    out += piece;
    moved.set(edge, out.length);
    previous = edge;
  }
  const at = (edge: number) => moved.get(edge) ?? out.length;
  return {
    text: out,
    spans: spans.map((span) => ({ ...span, from: at(span.from), to: at(span.to) })),
    removed,
  };
}

/** Marks inside the text, joined where two neighbours are alike. */
function toMarks(spans: readonly Span[], length: number): Mark[] {
  const marks: Span[] = [];
  for (const span of spans) {
    // A span moved outward to the edge of a letter may reach into the one before.
    const from = Math.min(Math.max(span.from, marks[marks.length - 1]?.to ?? 0), length);
    const to = Math.min(span.to, length);
    if (to <= from) continue;
    const last = marks[marks.length - 1];
    if (
      last !== undefined &&
      last.to === from &&
      last.bold === span.bold &&
      last.underline === span.underline
    ) {
      marks[marks.length - 1] = { ...last, to };
    } else {
      marks.push({ from, to, bold: span.bold, underline: span.underline });
    }
  }
  return marks.map(({ from, to, bold, underline }) => ({
    from,
    to,
    ...(bold ? { bold: true as const } : {}),
    ...(underline ? { underline: true as const } : {}),
  }));
}

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

    const settled = settle(
      text,
      spans.map((span) => atLetterEdges(text, span)),
    );
    const kept = withoutEmptyEnd(settled.text);
    return {
      ok: true,
      rich: { text: kept, marks: toMarks(settled.spans, kept.length) },
      dropped: DROPPED_ORDER.filter((kind) => dropped.has(kind)),
      removed: settled.removed,
    };
  } catch {
    return { ok: false };
  }
}
