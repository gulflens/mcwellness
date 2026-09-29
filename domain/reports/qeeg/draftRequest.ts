/**
 * What a brain-map draft takes from the request that saves it, and what the
 * route writes in its place.
 *
 * **The server's parts are the server's** (docs/SPEC/reports-qeeg.md section
 * 4, rule 11). The client's name, age and sex are gathered from the record on
 * every save; where a report came from is the app, for any draft this door
 * writes; what a follow-up is compared with is read from the earlier report
 * itself, and so are the scores and the maps it brings forward. A request
 * that carries one of the parts it may not set is REFUSED, by name
 * (`routeOwnedIn`), rather than quietly overwritten: a caller who sent a
 * client's age believes it was taken, and a refusal is the only answer that
 * tells them it was not. The earlier scores and maps are the one exception:
 * the form shows them and sends them back as it got them, so the route writes
 * them afresh from the earlier report (`assembleDraft`) and a figure typed
 * over one never reaches the page.
 *
 * **What she typed goes to the shape as it was sent** (RC4 note N2). Nothing
 * here reads, cleans or drops a typed part: `assembleDraft` copies every key
 * it does not own, so a mark that is nearly a mark is refused by the shape at
 * its own path, not lost on the way.
 *
 * **Days are the shape's** (RC4 note N1). Nothing here compares the
 * recording's day with the earlier report's: the shape does, and only when
 * both are days, so a day that is no day is refused once, for being no day.
 *
 * Pure: no clock (`today` is handed in), no I/O. Each function returns new
 * values and changes nothing it is given.
 */

import { ageOn } from '../../shared/dates';
import { DIMENSION_IDS } from './catalogue/ids';
import { isBlank, isRealDay, isRecord } from './text';
import { CONDITIONS, type QeegFollowUp, type Sex, type Subject } from './types';

/** The four facts of the client's record the report's head is made from. */
export type ClientFacts = {
  readonly givenNameAr: string | null;
  readonly familyNameAr: string | null;
  /** `YYYY-MM-DD`, or none on file. */
  readonly dateOfBirth: string | null;
  readonly sexAtBirth: Sex | 'unknown' | null;
};

/** The oldest age the shape accepts. An older one is a slip on the record, and printed as none. */
const OLDEST = 130;

/**
 * The report's head, from the record. The age is counted on the day of the
 * recording, or on `today` while the draft has no day (or one that is no
 * day, which the shape refuses in any case). A birth after that day gives no
 * age rather than a negative one.
 */
export function subjectFrom(
  facts: ClientFacts,
  on: { readonly recordedOn: string | null; readonly today: string },
): Subject {
  const parts = [facts.givenNameAr, facts.familyNameAr]
    .filter((part): part is string => part !== null && !isBlank(part))
    .map((part) => part.trim());
  const day = on.recordedOn !== null && isRealDay(on.recordedOn) ? on.recordedOn : on.today;
  const age = facts.dateOfBirth === null ? null : ageOn(facts.dateOfBirth, day);
  return {
    nameAr: parts.length === 0 ? null : parts.join(' '),
    ageYears: age === null || age < 0 || age > OLDEST ? null : age,
    sex: facts.sexAtBirth === 'female' || facts.sexAtBirth === 'male' ? facts.sexAtBirth : null,
  };
}

/** A key's own value, never one its prototype answers to. */
function own(record: unknown, key: string): unknown {
  return isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** What the request may say of what a follow-up is compared with: which report. */
const COMPARED_WITH_OWN = new Set(['reportId']);

/**
 * Every part of `sent` the route owns, as dotted paths, in a fixed order: the
 * client, where the report came from, what it is compared with beyond its id,
 * each calculated figure, and a count of sessions said to be gathered. Empty
 * when the request may be taken. It never throws.
 */
export function routeOwnedIn(sent: unknown): string[] {
  if (!isRecord(sent)) return [];
  const found: string[] = [];
  for (const key of ['subject', 'provenance']) {
    if (Object.hasOwn(sent, key)) found.push(key);
  }
  const comparedWith = own(sent, 'comparedWith');
  if (isRecord(comparedWith)) {
    for (const key of Object.keys(comparedWith)) {
      if (!COMPARED_WITH_OWN.has(key)) found.push(`comparedWith.${key}`);
    }
  }
  const change = own(sent, 'change');
  const table = own(change, 'table');
  if (isRecord(table)) {
    for (const [measure, row] of Object.entries(table)) {
      for (const condition of ['eyesOpen', 'eyesClosed']) {
        if (own(own(row, condition), 'source') === 'calculated') {
          found.push(`change.table.${measure}.${condition}.source`);
        }
      }
    }
  }
  if (own(own(change, 'sessionsCompleted'), 'source') === 'gathered') {
    found.push('change.sessionsCompleted.source');
  }
  return found;
}

/**
 * The body to validate: `sent`, with the client and an app source written in,
 * and on a follow-up what it is compared with and the earlier scores and maps
 * written from `followUp` (the earlier report, brought forward by
 * `prefillFollowUp`). A part of `sent` that is not the shape it should be is
 * left as it was sent, for the shape to refuse by name.
 */
export function assembleDraft(
  sent: Readonly<Record<string, unknown>>,
  from: { readonly subject: Subject; readonly followUp: QeegFollowUp | null },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...structuredClone(sent),
    subject: { ...from.subject },
    provenance: { origin: 'app' },
  };
  const earlier = from.followUp;
  if (earlier === null || own(sent, 'edition') !== 'follow-up') return body;

  body['comparedWith'] = { ...earlier.comparedWith };

  const dashboard = body['dashboard'];
  if (isRecord(dashboard)) {
    const scores: Record<string, unknown> = { ...dashboard };
    for (const dimension of DIMENSION_IDS) {
      const score = own(dashboard, dimension);
      if (isRecord(score)) {
        scores[dimension] = { ...score, earlierScore: earlier.dashboard[dimension].earlierScore };
      }
    }
    body['dashboard'] = scores;
  }

  const change = body['change'];
  const pairs = own(change, 'pairs');
  if (isRecord(change) && isRecord(pairs)) {
    const next: Record<string, unknown> = { ...pairs };
    for (const condition of CONDITIONS) {
      const pair = own(pairs, condition);
      if (isRecord(pair)) {
        const picture = earlier.change.pairs[condition].earlier;
        next[condition] = { ...pair, earlier: picture === null ? null : { ...picture } };
      }
    }
    body['change'] = { ...change, pairs: next };
  }
  return body;
}
