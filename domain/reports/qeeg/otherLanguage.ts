/**
 * The second report of one recording: the first report, with only the other
 * language's halves of typed text taken from what was sent.
 *
 * **Why so little is taken.** One recording may be signed as an English
 * report and as an Arabic one. The specification (`docs/SPEC/reports-qeeg.md`
 * section 8) says that in the second one's draft only the other-language
 * halves of typed text can differ, and that the server rebuilds everything
 * else from the first report on every save, so two signed reports of one
 * recording cannot disagree on a finding or a score. This is that rebuild.
 * Nothing else of `sent` is read: not a score, a finding, a region, a map, a
 * figure, the stage, the edition, where it came from, or the subject.
 *
 * **What counts as typed text.** Every `Bilingual` and `BilingualRich` in
 * `types.ts`, which are, walked here in this order:
 *
 * - the label and the note of each item she added to a list: `findings`,
 *   `focus`, `recommendations` and `benefits`, under `custom` (`Bilingual`,
 *   the note `Bilingual | null`);
 * - the caption of each map, under `maps` (`Bilingual | null`);
 * - the evidence of each score, under `dashboard` (`Bilingual | null`);
 * - the summary (`BilingualRich`);
 * - on a follow-up, the caption of each headline tile, under `change.tiles`
 *   (`Bilingual`), and the summary of the page of what has changed,
 *   `change.summary` (`BilingualRich`).
 *
 * A test fills every typed half of both editions and fails if a typed text is
 * added to the type and not to this walk.
 *
 * **Matched by key.** An item of a list is matched by its key (`c0`,
 * `map-0`, `t1`), never by its place. An item `sent` holds and `first` does
 * not is ignored; an item `first` holds and `sent` does not keeps the half
 * `first` had. A typed text `first` does not have (a score with no evidence)
 * is not added: there is nothing in the first report for it to be the other
 * half of. When `sent` is of the other edition, only the typed texts both
 * editions share are taken.
 *
 * **A half of nothing.** An Arabic that is empty once cleaned is none. An
 * English that is empty once cleaned is refused by keeping the first's: an
 * English report is never left without words where the first had some.
 *
 * **Cleaned as the editor cleans.** Every half taken goes through `clean` or
 * `cleanRich` to the limits of `LIMITS`, so the result passes the shape.
 *
 * It never throws on what was sent, and it returns a new value, sharing
 * nothing with either input and changing neither.
 */

import { DIMENSION_IDS, type DimensionId } from './catalogue/ids';
import { clean, cleanRich, isEmpty, isRecord } from './text';
import {
  LIMITS,
  type Bilingual,
  type BilingualRich,
  type CustomItem,
  type Locale,
  type MapEntry,
  type Mark,
  type Ordered,
  type Picked,
  type QeegCommon,
  type QeegContent,
  type RichText,
  type Score,
  type Tile,
} from './types';

/** A key's own value in what was sent, never one its prototype answers to. */
function own(record: unknown, key: string): unknown {
  return isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** A string half as it was sent, or null when it is none or not a string. */
function sentString(typed: unknown, locale: Locale): string | null {
  const half = own(typed, locale);
  return typeof half === 'string' ? half : null;
}

/** A formatted half as it was sent, read only as far as it is rich text. */
function sentRich(typed: unknown, locale: Locale): RichText | null {
  const half = own(typed, locale);
  const text = own(half, 'text');
  const marks = own(half, 'marks');
  if (typeof text !== 'string') return null;
  return {
    text,
    marks: Array.isArray(marks) ? marks.filter((m): m is Mark => isRecord(m)) : [],
  };
}

/** `first` with its `locale` half taken from `sent`, cleaned to `most`. */
function bilingualFrom(first: Bilingual, sent: unknown, locale: Locale, most: number): Bilingual {
  if (!isRecord(sent)) return { ...first };
  const taken = sentString(sent, locale);
  const cleaned = taken === null ? '' : clean(taken, most);
  if (locale === 'ar') return { en: first.en, ar: cleaned === '' ? null : cleaned };
  return { en: cleaned === '' ? first.en : cleaned, ar: first.ar };
}

function optionalFrom(
  first: Bilingual | null,
  sent: unknown,
  locale: Locale,
  most: number,
): Bilingual | null {
  return first === null ? null : bilingualFrom(first, sent, locale, most);
}

function richFrom(first: BilingualRich, sent: unknown, locale: Locale): BilingualRich {
  const copy = structuredClone(first);
  if (!isRecord(sent)) return copy;
  const taken = sentRich(sent, locale);
  const cleaned = taken === null ? null : cleanRich(taken, LIMITS.summary);
  const empty = cleaned === null || isEmpty(cleaned);
  if (locale === 'ar') return { en: copy.en, ar: empty ? null : cleaned };
  return { en: empty ? copy.en : cleaned, ar: copy.ar };
}

/** Each item of `first`, rebuilt by `item` from the item under the same key in `sent`. */
function byKey<T>(
  first: Ordered<T>,
  sent: unknown,
  item: (first: T & { readonly position: number }, sent: unknown) => T & { position: number },
): Ordered<T> {
  const out: Record<string, T & { position: number }> = {};
  for (const [key, value] of Object.entries(first)) out[key] = item(value, own(sent, key));
  return out;
}

function pickedFrom<Id extends string>(
  first: Picked<Id>,
  sent: unknown,
  locale: Locale,
): Picked<Id> {
  return {
    chosen: [...first.chosen],
    custom: byKey<CustomItem>(first.custom, own(sent, 'custom'), (item, other) => ({
      label: bilingualFrom(item.label, own(other, 'label'), locale, LIMITS.label),
      note: optionalFrom(item.note, own(other, 'note'), locale, LIMITS.note),
      chosen: item.chosen,
      position: item.position,
    })),
  };
}

function mapsFrom(first: Ordered<MapEntry>, sent: unknown, locale: Locale): Ordered<MapEntry> {
  return byKey<MapEntry>(first, sent, (map, other) => ({
    ...structuredClone(map),
    caption: optionalFrom(map.caption, own(other, 'caption'), locale, LIMITS.caption),
  }));
}

function dashboardFrom<S extends Score>(
  first: Readonly<Record<DimensionId, S>>,
  sent: unknown,
  locale: Locale,
): Record<DimensionId, S> {
  const out: Record<DimensionId, S> = { ...first };
  for (const dimension of DIMENSION_IDS) {
    const score = first[dimension];
    const other = own(own(sent, dimension), 'evidence');
    out[dimension] = {
      ...structuredClone(score),
      evidence: optionalFrom(score.evidence, other, locale, LIMITS.evidence),
    };
  }
  return out;
}

/** The typed texts both editions share, taken from `sent`. */
function commonFrom(first: QeegCommon, sent: unknown, locale: Locale) {
  return {
    findings: pickedFrom(first.findings, own(sent, 'findings'), locale),
    focus: pickedFrom(first.focus, own(sent, 'focus'), locale),
    maps: mapsFrom(first.maps, own(sent, 'maps'), locale),
    recommendations: pickedFrom(first.recommendations, own(sent, 'recommendations'), locale),
    summary: richFrom(first.summary, own(sent, 'summary'), locale),
    benefits: pickedFrom(first.benefits, own(sent, 'benefits'), locale),
  };
}

export function withOtherLanguageFrom(
  first: QeegContent,
  sent: QeegContent,
  locale: Locale,
): QeegContent {
  const copy = structuredClone(first);
  const common = commonFrom(first, sent, locale);
  const sentDashboard = own(sent, 'dashboard');
  if (copy.edition === 'initial') {
    return {
      ...copy,
      ...common,
      dashboard: dashboardFrom(copy.dashboard, sentDashboard, locale),
    };
  }
  // The page of what has changed is a follow-up's alone.
  const sentChange = own(sent, 'edition') === 'follow-up' ? own(sent, 'change') : undefined;
  return {
    ...copy,
    ...common,
    dashboard: dashboardFrom(copy.dashboard, sentDashboard, locale),
    change: {
      ...copy.change,
      tiles: byKey<Tile>(copy.change.tiles, own(sentChange, 'tiles'), (tile, other) => ({
        ...tile,
        caption: bilingualFrom(tile.caption, own(other, 'caption'), locale, LIMITS.caption),
      })),
      summary: richFrom(copy.change.summary, own(sentChange, 'summary'), locale),
    },
  };
}
