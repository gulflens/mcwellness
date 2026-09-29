/**
 * Turning a draft from a first report into a follow-up, or back.
 *
 * **Nothing is mapped from one list to the other.** A first report says what
 * was seen; a follow-up says what changed. "Increased" is not "moved further",
 * and a guess made here would be a judgement nobody made printed under her
 * signature. So every band's and measure's choice is cleared, with the
 * approach or the next stage, and each one cleared is listed in `setAside`
 * so the form can show her what she had. Every band then shows as unfinished
 * (`complete.ts`) until she chooses again.
 *
 * **What does not depend on the edition is kept**: the findings, the areas of
 * focus, the maps, the recommendations, the summary, the benefits, the head
 * of the report, where it came from, the scores and their evidence, the number
 * of sessions, and every region chosen. Regions say where something was seen,
 * and that is as true of a follow-up as of a first report.
 *
 * **Going back to a first report drops what only a follow-up has**: what it is
 * compared with, the page of what has changed, and each earlier score.
 *
 * **A past record is never switched.** A report read from the old tool is a
 * record of what was printed, and it is frozen. `toFollowUp` refuses one, and
 * says so, rather than make a follow-up that still claims to be the old
 * tool's while holding choices made here. Starting a new report from a past
 * record is a copy a route makes, and is not this function. `toInitial` has
 * nothing to refuse: every follow-up was written in this app.
 *
 * Returns new values and never changes what it was given.
 */

import { blankFollowUp } from './blank';
import { BAND_IDS, CONNECTIVITY_IDS, DIMENSION_IDS } from './catalogue/ids';
import type { ComparedWith, QeegCommon, QeegFollowUp, QeegInitial } from './types';

/** A choice that was cleared, where it was, and what it had been. */
export type SetAside = { at: string; was: string };

/**
 * The parts both editions share, copied so the result shares nothing with its
 * source. Where it came from is not among them: each caller says that itself.
 */
function keptParts(content: QeegCommon): Omit<QeegCommon, 'stage' | 'provenance'> {
  return structuredClone({
    kind: content.kind,
    schema: content.schema,
    wording: content.wording,
    subject: content.subject,
    recording: content.recording,
    findings: content.findings,
    focus: content.focus,
    maps: content.maps,
    recommendations: content.recommendations,
    summary: content.summary,
    benefits: content.benefits,
  });
}

function eachOf<K extends string, V>(keys: readonly K[], make: (key: K) => V): Record<K, V> {
  return Object.fromEntries(keys.map((key) => [key, make(key)])) as Record<K, V>;
}

export type ToFollowUp =
  { ok: true; content: QeegFollowUp; setAside: SetAside[] } | { ok: false; reason: 'past_record' };

export function toFollowUp(
  content: QeegInitial,
  comparedWith: ComparedWith,
  stage: 'follow_up' | 'final',
): ToFollowUp {
  if (content.provenance.origin !== 'app') return { ok: false, reason: 'past_record' };

  const setAside: SetAside[] = [];
  const setAsideIf = (at: string, was: string | null) => {
    if (was !== null) setAside.push({ at, was });
  };

  const bands = eachOf(BAND_IDS, (band) => {
    setAsideIf(`bands.${band}`, content.bands[band].level);
    return { change: null, regions: [...content.bands[band].regions] };
  });
  const connectivity = eachOf(CONNECTIVITY_IDS, (measure) => {
    setAsideIf(`connectivity.${measure}`, content.connectivity[measure].level);
    return { change: null, regions: [...content.connectivity[measure].regions] };
  });
  setAsideIf('plan.approach', content.plan.approach);

  const blank = blankFollowUp(comparedWith, stage);
  return {
    ok: true,
    content: {
      ...blank,
      ...keptParts(content),
      provenance: { origin: 'app' },
      bands,
      connectivity,
      dashboard: eachOf(DIMENSION_IDS, (dimension) => ({
        ...structuredClone(content.dashboard[dimension]),
        earlierScore: null,
      })),
      plan: { sessions: content.plan.sessions, next: null },
    },
    setAside,
  };
}

export function toInitial(content: QeegFollowUp): { content: QeegInitial; setAside: SetAside[] } {
  const setAside: SetAside[] = [];
  const setAsideIf = (at: string, was: string | null) => {
    if (was !== null) setAside.push({ at, was });
  };

  const bands = eachOf(BAND_IDS, (band) => {
    setAsideIf(`bands.${band}`, content.bands[band].change);
    return { level: null, regions: [...content.bands[band].regions] };
  });
  const connectivity = eachOf(CONNECTIVITY_IDS, (measure) => {
    setAsideIf(`connectivity.${measure}`, content.connectivity[measure].change);
    return { level: null, regions: [...content.connectivity[measure].regions] };
  });
  setAsideIf('plan.next', content.plan.next);

  return {
    content: {
      ...keptParts(content),
      provenance: { origin: 'app' },
      edition: 'initial',
      stage: 'initial',
      bands,
      connectivity,
      dashboard: eachOf(DIMENSION_IDS, (dimension) => {
        const { score, evidence } = content.dashboard[dimension];
        return { score, evidence: structuredClone(evidence) };
      }),
      plan: { sessions: content.plan.sessions, approach: null },
    },
    setAside,
  };
}
