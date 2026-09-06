import type {
  BandKey,
  BrainMapComparison,
  ComparisonLine,
  GoalLine,
  IsoDate,
  ProgressReportContent,
  Ribbon,
  RibbonSlice,
} from './types';
import { BAND_KEYS } from './types';

/**
 * Rule 3 (docs/SPEC/reports-v1.md section 8): everything a progress report
 * quotes, gathered from rows, with the ribbon's slices among it.
 *
 * **Pure, and rows come in as data.** Nothing here reads a database, a clock
 * or another module's `domain/`. The visits, the entitlements, the goals and
 * the brain maps arrive as plain values the route read; that is what lets the
 * arithmetic be tested on its own and what lets the brain-map half be absent
 * without a branch anywhere else — the assessment table lives in another
 * stream's range and may not be on this database at all (section 6, no foreign
 * key), so an empty list is the ordinary case and not an error.
 *
 * **The narrative is not gathered.** `summary`, `suggestion` and each goal's
 * `movement` are the parts only a person can write (section 4.2), so they come
 * in as whatever the practitioner has typed so far and go out untouched. The
 * figures are not editable for the same reason in reverse: a figure a
 * practitioner could retype is a figure that can disagree with the record.
 *
 * **What is never gathered at all.** No electrode site, no band threshold, no
 * protocol. `dominantBand` reads the band amplitudes a visit recorded and
 * answers which one was largest — a hue for a slice, which is the one place
 * hue enters a report — and the amplitudes themselves stay behind.
 */

/** A delivered visit, as much of it as a progress report quotes. */
export type VisitRow = {
  id: string;
  /** The day it happened, in the practice's time zone, as YYYY-MM-DD. */
  on: IsoDate;
  /** `session.signal_quality_score`, 0 to 1, or null where none was computed. */
  signalQuality: number | null;
  /**
   * The per-band amplitudes the visit recorded, summed or averaged by the
   * caller across the run. Every band optional: an amplifier that exports
   * three bands is not a malformed reading.
   */
  bands: Partial<Record<BandKey, number>>;
};

/** One credit on a programme, as much of it as "delivered against entitled" needs. */
export type EntitlementRow = {
  id: string;
  status: 'available' | 'consumed' | 'expired' | 'refunded' | 'waived';
};

/** A goal as the household set it. */
export type GoalRow = {
  id: string;
  description: string;
  status: string;
};

/**
 * A brain map, read through the guarded query in `app/api/reports/draft.ts`
 * and never imported from `domain/assessment` (docs/SPEC/OWNERSHIP.md rule 3).
 * The columns are the ones `docs/SPEC/assessment.md` section 6 names.
 */
export type AssessmentRow = {
  id: string;
  /** The day the measurement was taken, as YYYY-MM-DD. */
  performedOn: IsoDate;
  instrument: string;
  /** The figures the equipment's software reported, each with its unit. */
  figures: readonly { label: string; labelAr: string | null; unit: string; value: number }[];
  referenceAgeYears: number | null;
  referenceSex: string | null;
};

/** What the practitioner has written so far, carried through untouched. */
export type ProgressNarrative = {
  summary: string;
  suggestion: string;
  /** Keyed by goal id; a goal with nothing written yet gets an empty line. */
  movementByGoal: Readonly<Record<string, string>>;
};

/**
 * Which band was largest in a visit's own reading.
 *
 * Ties go to the slower band, which is the order `BAND_KEYS` is written in and
 * the order the design brief's ramp runs (cool to warm). An arbitrary but
 * fixed answer matters more than a clever one: the ribbon is snapshotted, and
 * two renders of the same row must colour the same slice the same way.
 */
export function dominantBand(bands: Partial<Record<BandKey, number>>): BandKey | null {
  let best: BandKey | null = null;
  let bestValue = -Infinity;
  for (const key of BAND_KEYS) {
    const value = bands[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    if (value > bestValue) {
      best = key;
      bestValue = value;
    }
  }
  return best;
}

/**
 * The ribbon (docs/DESIGN-BRIEF.md section 5): one slice per completed
 * session, height the visit's signal quality, colour the dominant trained
 * band, a hairline at each brain map, empty slices for the sessions remaining.
 *
 * A brain map marks the first visit at or after the day it was taken; where it
 * was taken after the last visit it marks nothing, because there is no slice
 * for it to sit against yet. Both are decided here so the figure is the same
 * on paper and on screen.
 */
export function ribbonFor(
  visits: readonly VisitRow[],
  assessments: readonly AssessmentRow[],
  remaining: number,
): Ribbon {
  const ordered = [...visits].sort((a, b) =>
    a.on === b.on ? a.id.localeCompare(b.id) : a.on < b.on ? -1 : 1,
  );
  const mapDays = [...new Set(assessments.map((assessment) => assessment.performedOn))].sort();

  const slices: RibbonSlice[] = ordered.map((visit, at) => {
    const previous = at === 0 ? null : (ordered[at - 1]?.on ?? null);
    const mapMark = mapDays.some((day) => day <= visit.on && (previous === null || day > previous));
    return {
      index: at + 1,
      quality: visit.signalQuality,
      band: dominantBand(visit.bands),
      mapMark,
    };
  });

  return { slices, remaining: Math.max(0, Math.trunc(remaining)) };
}

/**
 * The comparison between the two most distant brain maps of one instrument
 * (docs/SPEC/assessment.md section 3.3): the earlier figure, the later figure,
 * the difference, and nothing else.
 *
 * **Refused rather than guessed** where the two do not compare: fewer than two
 * maps, two of different instruments, or a pair whose units disagree on a
 * figure. That is the assessment stream's own `compare` rule, quoted rather
 * than imported (section 6, no import across modules), and a figure the two
 * maps do not share is left out rather than paired with nothing.
 *
 * The earliest and the latest are the pair, because a progress report is about
 * a stretch of a programme and the pair a household wants is the two ends of
 * it.
 */
export function compareBrainMaps(assessments: readonly AssessmentRow[]): BrainMapComparison | null {
  if (assessments.length < 2) return null;
  const ordered = [...assessments].sort((a, b) =>
    a.performedOn === b.performedOn
      ? a.id.localeCompare(b.id)
      : a.performedOn < b.performedOn
        ? -1
        : 1,
  );
  const earlier = ordered[0];
  const later = ordered[ordered.length - 1];
  if (!earlier || !later || earlier.id === later.id) return null;
  // Two measurements of different instruments are two different things, and a
  // difference between them is a number with no meaning.
  if (earlier.instrument !== later.instrument) return null;

  const lines: ComparisonLine[] = [];
  for (const first of earlier.figures) {
    const second = later.figures.find((figure) => figure.label === first.label);
    // A figure only one of the two maps carries has nothing to be compared
    // with; a pair whose units disagree is not a difference at all.
    if (!second || second.unit !== first.unit) continue;
    lines.push({
      label: first.label,
      labelAr: first.labelAr,
      unit: first.unit,
      earlier: first.value,
      later: second.value,
      difference: round3(second.value - first.value),
    });
  }
  if (lines.length === 0) return null;

  return {
    instrument: earlier.instrument,
    earlierOn: earlier.performedOn,
    laterOn: later.performedOn,
    earlierAssessmentId: earlier.id,
    laterAssessmentId: later.id,
    // The age and sex the *later* comparison was made against: it is the one a
    // reader is looking at, and a comparison made against a nine-year-old is
    // not the comparison made against a ten-year-old.
    referenceAgeYears: later.referenceAgeYears,
    referenceSex: later.referenceSex,
    lines,
  };
}

/**
 * Floating-point subtraction leaves tails a household should never read
 * ("0.30000000000000004"). Three places is finer than any figure these
 * instruments report and is the same answer on every machine, which the
 * snapshot needs it to be.
 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The whole of what a progress report quotes.
 *
 * `sessionsEntitled` counts every credit the programme bought, whatever became
 * of it; `sessionsDelivered` counts the visits inside the coverage. Where a
 * household has no package at all — the practice sells single visits too — the
 * entitlement list is empty and the report says the visits delivered against
 * none, which is honest and is what the ribbon then draws with no empty
 * slices ahead of it.
 */
export function gatherProgress(input: {
  visits: readonly VisitRow[];
  entitlements: readonly EntitlementRow[];
  goals: readonly GoalRow[];
  assessments: readonly AssessmentRow[];
  coverage: { from: IsoDate; to: IsoDate };
  narrative?: ProgressNarrative;
}): ProgressReportContent {
  const inCoverage = input.visits.filter(
    (visit) => visit.on >= input.coverage.from && visit.on <= input.coverage.to,
  );
  const mapsInCoverage = input.assessments.filter(
    (assessment) =>
      assessment.performedOn >= input.coverage.from && assessment.performedOn <= input.coverage.to,
  );

  const sessionsEntitled = input.entitlements.length;
  const sessionsDelivered = inCoverage.length;
  // Credits still to be used, never a negative: a programme delivered past its
  // entitlement is an ordinary thing (a waiver, a goodwill visit) and shows as
  // no empty slices rather than as a figure below zero.
  const remaining = input.entitlements.filter(
    (entitlement) => entitlement.status === 'available',
  ).length;

  const narrative = input.narrative;
  const goals: GoalLine[] = input.goals.map((goal) => ({
    id: goal.id,
    description: goal.description,
    status: goal.status,
    movement: narrative?.movementByGoal[goal.id] ?? '',
  }));

  return {
    kind: 'progress',
    coverageFrom: input.coverage.from,
    coverageTo: input.coverage.to,
    sessionsDelivered,
    sessionsEntitled,
    goals,
    ribbon: ribbonFor(inCoverage, mapsInCoverage, remaining),
    comparison: compareBrainMaps(mapsInCoverage),
    summary: narrative?.summary ?? '',
    suggestion: narrative?.suggestion ?? '',
  };
}
