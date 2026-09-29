/**
 * A brain-map report nobody has filled in yet, in either edition.
 *
 * **Unset is `null`, never a guess.** The tool this report was rebuilt from
 * started every score at 5 and printed it whether or not anyone had looked.
 * Here a blank has no score, no level, no change and no date: each is a
 * practitioner's judgement, and `complete.ts` lists what she has still to
 * give before the report can be signed. A blank still validates, because an
 * unfinished draft has to be saved.
 *
 * **Every band, kind of connectivity and dimension has its entry from the start.** The
 * form, the preview and the completeness list all walk the same keys, so none
 * of them has to ask whether an entry exists.
 *
 * **Built afresh on every call.** Two drafts that shared an array would change
 * together, silently, the first time something pushed onto it. The two
 * constants are frozen for the same reason and are never placed inside a
 * blank.
 */

import { BAND_IDS, CONNECTIVITY_IDS, DIMENSION_IDS } from './catalogue/ids';
import type {
  BilingualRich,
  ComparedWith,
  CustomItem,
  Pair,
  Picked,
  QeegFollowUp,
  QeegInitial,
  RichText,
} from './types';

export const EMPTY_RICH: RichText = Object.freeze({ text: '', marks: Object.freeze([]) });

export const NOTHING_PICKED: Picked<never> = Object.freeze({
  chosen: Object.freeze([]),
  custom: Object.freeze({}),
});

function nothingPicked<Id extends string>(): Picked<Id> {
  const custom: Record<string, CustomItem & { position: number }> = {};
  return { chosen: [], custom };
}

function emptySummary(): BilingualRich {
  return { en: { text: '', marks: [] }, ar: null };
}

/**
 * An entry for every key of a list, each made afresh. The one home of this
 * for the brain-map report: the blanks, the switch between editions and the
 * prefill all use it.
 *
 * The one cast in this code outside a test, and why it is sound:
 * `Object.fromEntries` is typed to give a record of any string, and cannot
 * know that the entries are exactly one for each of `keys`. They are, since
 * each comes from `keys.map`, so the record holds every `K` and nothing else.
 */
export function eachOf<K extends string, V>(keys: readonly K[], make: (key: K) => V): Record<K, V> {
  return Object.fromEntries(keys.map((key) => [key, make(key)])) as Record<K, V>;
}

function emptyPair(): Pair {
  return { earlier: null, later: null };
}

/** What both editions start with. */
function blankCommon() {
  return {
    kind: 'qeeg' as const,
    schema: 1 as const,
    wording: 1 as const,
    provenance: { origin: 'app' as const },
    subject: { nameAr: null, ageYears: null, sex: null },
    recording: { recordedOn: null, eyes: null, handedness: null },
    findings: nothingPicked<QeegInitial['findings']['chosen'][number]>(),
    focus: nothingPicked<QeegInitial['focus']['chosen'][number]>(),
    maps: {},
    recommendations: nothingPicked<QeegInitial['recommendations']['chosen'][number]>(),
    summary: emptySummary(),
    benefits: nothingPicked<QeegInitial['benefits']['chosen'][number]>(),
  };
}

export function blankInitial(stage: 'initial' = 'initial'): QeegInitial {
  return {
    ...blankCommon(),
    edition: 'initial',
    stage,
    bands: eachOf(BAND_IDS, () => ({ level: null, regions: [] })),
    connectivity: eachOf(CONNECTIVITY_IDS, () => ({ level: null, regions: [] })),
    dashboard: eachOf(DIMENSION_IDS, () => ({ score: null, evidence: null })),
    plan: { sessions: null, approach: null },
  };
}

export function blankFollowUp(
  comparedWith: ComparedWith,
  stage: 'follow_up' | 'final',
): QeegFollowUp {
  return {
    ...blankCommon(),
    edition: 'follow-up',
    stage,
    comparedWith: { ...comparedWith },
    bands: eachOf(BAND_IDS, () => ({ change: null, regions: [] })),
    connectivity: eachOf(CONNECTIVITY_IDS, () => ({ change: null, regions: [] })),
    dashboard: eachOf(DIMENSION_IDS, () => ({ score: null, evidence: null, earlierScore: null })),
    change: {
      tiles: {},
      sessionsCompleted: null,
      pairs: { eyes_open: emptyPair(), eyes_closed: emptyPair() },
      table: {},
      summary: emptySummary(),
    },
    plan: { sessions: null, next: null },
  };
}
