/**
 * A follow-up begun from an earlier report of the same client.
 *
 * **Facts come forward; judgements do not.** A follow-up says what has
 * changed since an earlier report, so it names that report
 * (`comparedWith`), prints the earlier score beside each new one, and shows
 * the earlier brain map beside the new. Those are facts about the earlier
 * report. So is the client's handedness, which is a fact about a person and
 * not a judgement. The day of the new recording and the stage are what she
 * gave in the request. Everything else is as `blankFollowUp` has it: no
 * finding, area of focus, recommendation, benefit, region, change, score,
 * evidence, summary, number of sessions or later map is filled in, because
 * each is a judgement made anew and signed under her name. `subject` stays
 * empty: the server gathers it from the client's record. So the follow-up is
 * missing exactly what a blank one is missing.
 *
 * **What she chose last time is offered, never filled in.** `offered` is
 * handed over beside the content, for the form to show as a suggestion she
 * may take or leave. Something she added to a list herself and then unticked
 * is not offered: she had already set it aside.
 *
 * **Refused in a fixed order.** `other_client` comes first, so that nothing
 * about another client's report, not even that it is a draft, is ever said
 * to someone asking about this client. Then a record that has been erased,
 * the very draft being filled, a report never signed or kept, one with a
 * later version, a past record that was withdrawn, a reference that does not
 * fit where the report came from (a signed report has one, a past record
 * from the old tool has none), no day of recording, and last an earlier
 * report recorded after the new recording. The same day is allowed.
 *
 * It never throws on what it is handed: a part of the earlier report it
 * cannot read is taken as not there. It returns new values and changes
 * nothing it was given.
 */

import { blankFollowUp } from './blank';
import {
  BAND_IDS,
  BENEFIT_IDS,
  CONNECTIVITY_IDS,
  DIMENSION_IDS,
  FINDING_IDS,
  FOCUS_IDS,
  RECOMMENDATION_IDS,
  REGION_IDS,
  type BandId,
  type BenefitId,
  type ConnectivityId,
  type DimensionId,
  type FindingId,
  type FocusId,
  type RecommendationId,
  type RegionId,
} from './catalogue/ids';
import { UNCUT, clean, isRealDay, isRecord } from './text';
import {
  CONDITIONS,
  HANDEDNESS,
  type Bilingual,
  type ComparedWith,
  type Condition,
  type CustomItem,
  type FigureRef,
  type FollowUpScore,
  type Handedness,
  type Pair,
  type Picked,
  type QeegContent,
  type QeegFollowUp,
  type Regions,
} from './types';

export type EarlierReport = {
  readonly reportId: string;
  readonly clientId: string;
  readonly status: 'draft' | 'issued' | 'superseded' | 'imported';
  /** Set when a past record was withdrawn, or the client's record erased. */
  readonly withdrawn: boolean;
  readonly erased: boolean;
  readonly reference: string | null;
  readonly content: QeegContent;
};

export type PrefillRequest = {
  readonly clientId: string;
  /** The draft being filled, when there is one already. */
  readonly draftId: string | null;
  readonly stage: 'follow_up' | 'final';
  /** The day of the new recording, when she has given it. */
  readonly recordedOn: string | null;
};

export type PrefillRefusal =
  | 'other_client'
  | 'same_report'
  | 'draft'
  | 'superseded'
  | 'withdrawn'
  | 'erased'
  | 'undated'
  | 'recorded_later'
  | 'no_reference';

/** What she chose last time, for the form to offer. Never part of the content. */
export type Offered = {
  readonly findings: Picked<FindingId>;
  readonly focus: Picked<FocusId>;
  readonly recommendations: Picked<RecommendationId>;
  readonly benefits: Picked<BenefitId>;
  readonly regions: {
    readonly bands: Readonly<Record<BandId, Regions>>;
    readonly connectivity: Readonly<Record<ConnectivityId, Regions>>;
  };
};

export type Prefill =
  { ok: true; content: QeegFollowUp; offered: Offered } | { ok: false; reason: PrefillRefusal };

// ---------------------------------------------------------------------------
// Reading the earlier report without trusting it
// ---------------------------------------------------------------------------

/** A key's own value, or undefined where there is none or no object to hold it. */
function own(record: unknown, key: string): unknown {
  return isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return list.some((item) => item === value);
}

function eachOf<K extends string, V>(keys: readonly K[], make: (key: K) => V): Record<K, V> {
  return Object.fromEntries(keys.map((key) => [key, make(key)])) as Record<K, V>;
}

/** A score as the shape holds one, a whole number from 0 to 10, or none. */
function scoreOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10
    ? value
    : null;
}

function regionsOf(value: unknown): Regions {
  return Array.isArray(value) ? value.filter((id): id is RegionId => oneOf(REGION_IDS, id)) : [];
}

function bilingualOf(value: unknown): Bilingual | null {
  const en = own(value, 'en');
  const ar = own(value, 'ar');
  if (typeof en !== 'string' || (ar !== null && typeof ar !== 'string')) return null;
  return { en, ar };
}

/** The first map, by place, recorded under `condition`, as a reference to its picture. */
function earlierPicture(maps: unknown, condition: Condition): FigureRef | null {
  let found: { position: number; ref: FigureRef } | null = null;
  for (const entry of isRecord(maps) ? Object.values(maps) : []) {
    const position = own(entry, 'position');
    const figureId = own(entry, 'figureId');
    const sha256 = own(entry, 'sha256');
    const widthPx = own(entry, 'widthPx');
    const heightPx = own(entry, 'heightPx');
    if (
      own(entry, 'condition') !== condition ||
      typeof position !== 'number' ||
      typeof figureId !== 'string' ||
      typeof sha256 !== 'string' ||
      typeof widthPx !== 'number' ||
      typeof heightPx !== 'number'
    ) {
      continue;
    }
    if (found === null || position < found.position) {
      found = { position, ref: { figureId, sha256, widthPx, heightPx } };
    }
  }
  return found === null ? null : found.ref;
}

/** What she ticked and what she added and kept ticked, renumbered from 0. */
function offeredFrom<Id extends string>(value: unknown, ids: readonly Id[]): Picked<Id> {
  const chosen = own(value, 'chosen');
  const custom = own(value, 'custom');
  const kept: Array<[string, CustomItem & { position: number }]> = [];
  for (const [key, item] of isRecord(custom) ? Object.entries(custom) : []) {
    const label = bilingualOf(own(item, 'label'));
    const position = own(item, 'position');
    if (own(item, 'chosen') !== true || label === null || typeof position !== 'number') continue;
    kept.push([key, { label, note: bilingualOf(own(item, 'note')), chosen: true, position }]);
  }
  kept.sort((a, b) => a[1].position - b[1].position);
  return {
    chosen: Array.isArray(chosen) ? chosen.filter((id): id is Id => oneOf(ids, id)) : [],
    custom: Object.fromEntries(kept.map(([key, item], position) => [key, { ...item, position }])),
  };
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

function refusalFor(earlier: EarlierReport, request: PrefillRequest): PrefillRefusal | null {
  if (earlier.clientId !== request.clientId) return 'other_client';
  if (earlier.erased) return 'erased';
  if (request.draftId !== null && earlier.reportId === request.draftId) return 'same_report';
  if (earlier.status === 'superseded') return 'superseded';
  if (earlier.status !== 'issued' && earlier.status !== 'imported') return 'draft';
  if (earlier.withdrawn) return 'withdrawn';
  const reference = typeof earlier.reference === 'string' ? clean(earlier.reference, UNCUT) : '';
  if (earlier.status === 'issued' ? reference === '' : earlier.reference !== null) {
    return 'no_reference';
  }
  const day = own(own(earlier.content, 'recording'), 'recordedOn');
  if (typeof day !== 'string' || !isRealDay(day)) return 'undated';
  const asked = request.recordedOn;
  if (asked !== null && isRealDay(asked) && day > asked) return 'recorded_later';
  return null;
}

export function prefillFollowUp(earlier: EarlierReport, request: PrefillRequest): Prefill {
  const reason = refusalFor(earlier, request);
  if (reason !== null) return { ok: false, reason };

  const content: unknown = earlier.content;
  const recording = own(content, 'recording');
  const recordedOn = own(recording, 'recordedOn');
  if (typeof recordedOn !== 'string') return { ok: false, reason: 'undated' };
  const relation = own(content, 'stage') === 'initial' ? 'initial' : 'previous';
  const comparedWith: ComparedWith =
    earlier.status === 'issued'
      ? {
          reportId: earlier.reportId,
          recordedOn,
          relation,
          origin: 'issued',
          reference: clean(earlier.reference ?? '', UNCUT),
        }
      : { reportId: earlier.reportId, recordedOn, relation, origin: 'imported', reference: null };

  const blank = blankFollowUp(comparedWith, request.stage);
  const handedness = own(recording, 'handedness');
  const dashboard = own(content, 'dashboard');
  const maps = own(content, 'maps');
  const bands = own(content, 'bands');
  const connectivity = own(content, 'connectivity');
  const asked = request.recordedOn;

  return {
    ok: true,
    content: {
      ...blank,
      recording: {
        ...blank.recording,
        recordedOn: asked !== null && isRealDay(asked) ? asked : null,
        handedness: oneOf<Handedness>(HANDEDNESS, handedness) ? handedness : null,
      },
      dashboard: eachOf(DIMENSION_IDS, (d: DimensionId): FollowUpScore => ({
        ...blank.dashboard[d],
        earlierScore: scoreOf(own(own(dashboard, d), 'score')),
      })),
      change: {
        ...blank.change,
        pairs: eachOf(CONDITIONS, (condition): Pair => ({
          earlier: earlierPicture(maps, condition),
          later: null,
        })),
      },
    },
    offered: structuredClone({
      findings: offeredFrom(own(content, 'findings'), FINDING_IDS),
      focus: offeredFrom(own(content, 'focus'), FOCUS_IDS),
      recommendations: offeredFrom(own(content, 'recommendations'), RECOMMENDATION_IDS),
      benefits: offeredFrom(own(content, 'benefits'), BENEFIT_IDS),
      regions: {
        bands: eachOf(BAND_IDS, (b) => regionsOf(own(own(bands, b), 'regions'))),
        connectivity: eachOf(CONNECTIVITY_IDS, (c) =>
          regionsOf(own(own(connectivity, c), 'regions')),
        ),
      },
    }),
  };
}
