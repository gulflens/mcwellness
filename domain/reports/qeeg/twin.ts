/**
 * What a save of the second-language report tried to change beyond its own
 * language, by the field.
 *
 * **Refused, never dropped** (docs/SPEC/reports-qeeg.md section 8, point 3;
 * brief Q). In the draft of the second report only the halves of typed text
 * in its own language may differ from the first report. The server rebuilds
 * everything else from the first report on every save
 * (`withOtherLanguageFrom`), and that rebuild alone would quietly throw away
 * a score or a tick she changed: the save would answer 200 and the page she
 * believes she set would print the first report's. So the route compares what
 * was sent with its own rebuild, and a save that differs anywhere is refused
 * naming the first field that does. What she was told is then what happened.
 *
 * **What is compared is the body the shape accepted**, with the server's
 * parts (the client, the source, what a follow-up is compared with, its
 * earlier scores and pictures) already written in from the first report, as
 * the draft route writes them for every save. Those are the server's and are
 * never hers to change, so they cannot differ.
 *
 * Pure, and it changes nothing it is given.
 */

import { withOtherLanguageFrom } from './otherLanguage';
import { isRecord } from './text';
import type { Locale, QeegContent } from './types';

function join(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

/**
 * The dotted path of the first place `a` and `b` differ, or null when they
 * hold the same values. Keys are compared as sets, in sorted order, so two
 * objects written in another order are the same; a list is compared by its
 * length, then place by place.
 */
export function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (Object.is(a, b)) return null;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return path;
    for (let index = 0; index < a.length; index += 1) {
      const found = firstDifference(a[index], b[index], join(path, index));
      if (found !== null) return found;
    }
    return null;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) return join(path, key);
      const found = firstDifference(a[key], b[key], join(path, key));
      if (found !== null) return found;
    }
    return null;
  }
  return path;
}

/**
 * The first field `sent` changes that a report in `locale`, made from
 * `first`, may not change, or null when it changes only the halves of typed
 * text in `locale`.
 */
export function twinChangeIn(first: QeegContent, sent: QeegContent, locale: Locale): string | null {
  return firstDifference(sent, withOtherLanguageFrom(first, sent, locale));
}
