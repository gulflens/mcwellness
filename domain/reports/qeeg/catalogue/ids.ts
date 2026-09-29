/**
 * What a brain-map report may choose from: every list, by a name that never
 * changes.
 *
 * **Why names and not positions.** The tool this report was rebuilt from kept
 * a practitioner's choices as a row of ticks, "the first, fourth and sixth
 * finding", and looked its Arabic up by matching the English sentence. Moving
 * a line in a list, or mending a spelling, would have changed what every
 * report already written said, and nothing would have noticed. Here each item
 * has a name of its own, a stored report holds names, and the order below is
 * the order a list is shown in and nothing else. The one place a position is
 * still read is the importer of the old tool's files
 * (`domain/reports/qeeg/legacy`), which turns positions into names once, at
 * the door.
 *
 * **Why the two editions have lists of their own.** A first report says what
 * was seen: a band is increased, reduced, or within normal limits. A follow-up
 * says what changed since an earlier report: improved, unchanged, moved
 * further from normal limits. Those are different questions, and the practice
 * asked for them to be kept apart (the founder's request of 29 September
 * 2026). No name appears in both, so a choice made in one edition cannot be
 * read as a choice made in the other; `ids.test.ts` holds that.
 *
 * **Why the bands are this file's and not the shared list's.**
 * `domain/shared/bands.ts` is a vocabulary for measurements: five bands
 * ending in gamma, no ranges, shared by sessions, ribbons and assessments.
 * The report's five end in high beta and carry the ranges the practice
 * reports them in, because that is how its mapping software writes them.
 * Changing the shared list would re-read every figure already stored. The two
 * are different things, and this one touches nothing but this report.
 *
 * Words are not here. Every name below has its sentence, in both languages,
 * in `domain/reports/qeeg/wording`, where a person approves it.
 */

/** A list nobody can add to or reorder by accident. */
function list<const T extends readonly (string | number)[]>(...items: T): T {
  return Object.freeze(items) as T;
}

export const FINDING_IDS = list(
  'brainwave_dysregulation',
  'altered_brain_communication',
  'reduced_cognitive_efficiency',
  'reduced_attention_focus',
  'mental_fatigue',
  'increased_stress_response',
  'reduced_emotional_regulation',
  'sleep_dysregulation',
  'reduced_recovery_capacity',
  'reduced_mental_energy',
);
export type FindingId = (typeof FINDING_IDS)[number];

export const FOCUS_IDS = list(
  'brainwave_regulation',
  'brain_communication',
  'attention_focus',
  'cognitive_efficiency',
  'memory_function',
  'emotional_regulation',
  'stress_regulation',
  'nervous_system_regulation',
  'sleep_recovery',
  'mental_energy',
  'performance_optimisation',
);
export type FocusId = (typeof FOCUS_IDS)[number];

/** Regions of the head, as a household reads them. Never an electrode site. */
export const REGION_IDS = list(
  'frontal',
  'central',
  'temporal',
  'parietal',
  'occipital',
  'left_hemisphere',
  'right_hemisphere',
  'bilateral',
  'widespread',
);
export type RegionId = (typeof REGION_IDS)[number];

export const BAND_IDS = list('delta', 'theta', 'alpha', 'beta', 'high_beta');
export type BandId = (typeof BAND_IDS)[number];

export type Range = { readonly from: number; readonly to: number };

/** In hertz, as the practice reports them. Each begins where the last ended. */
export const BAND_RANGES: Readonly<Record<BandId, Range>> = Object.freeze({
  delta: { from: 1, to: 4 },
  theta: { from: 4, to: 8 },
  alpha: { from: 8, to: 12 },
  beta: { from: 12, to: 25 },
  high_beta: { from: 25, to: 30 },
});

export const CONNECTIVITY_IDS = list('connectivity', 'asymmetry', 'phase_lag');
export type ConnectivityId = (typeof CONNECTIVITY_IDS)[number];

export const DIMENSION_IDS = list(
  'mental_energy',
  'attention_focus',
  'cognitive_flexibility',
  'stress_regulation',
  'recovery_capacity',
  'decision_making',
);
export type DimensionId = (typeof DIMENSION_IDS)[number];

/** Which of three wordings a score out of ten is printed with. */
export const TIER_IDS = list('low', 'middle', 'high');
export type TierId = (typeof TIER_IDS)[number];

export const RECOMMENDATION_IDS = list(
  'mental_energy',
  'attention_focus',
  'cognitive_efficiency',
  'stress_regulation',
  'recovery_capacity',
  'decision_making',
);
export type RecommendationId = (typeof RECOMMENDATION_IDS)[number];

export const BENEFIT_IDS = list(
  'attention_focus',
  'emotional_regulation',
  'stress_management',
  'sleep',
  'mental_energy',
  'resilience',
  'cognitive_endurance',
  'peak_performance',
  'recovery',
);
export type BenefitId = (typeof BENEFIT_IDS)[number];

// ---------------------------------------------------------------------------
// A first report: what was seen.
// ---------------------------------------------------------------------------

export const INITIAL_BAND_LEVELS = list('increased', 'reduced', 'within_normal_limits');
export type InitialBandLevel = (typeof INITIAL_BAND_LEVELS)[number];

export const INITIAL_CONNECTIVITY_LEVELS = Object.freeze({
  connectivity: list('increased', 'reduced', 'mixed'),
  asymmetry: list('left', 'right', 'bilateral'),
  phase_lag: list('normal', 'delayed', 'altered'),
});
export type InitialConnectivityLevel<K extends ConnectivityId = ConnectivityId> =
  (typeof INITIAL_CONNECTIVITY_LEVELS)[K][number];

export const APPROACH_IDS = list('calming', 'stabilising', 'calming_and_stabilising');
export type ApproachId = (typeof APPROACH_IDS)[number];

// ---------------------------------------------------------------------------
// A follow-up: what changed since an earlier report.
// ---------------------------------------------------------------------------

export const BAND_CHANGES = list(
  'improved',
  'further_improved',
  'unchanged',
  'moved_further',
  'now_within_normal_limits',
);
export type BandChange = (typeof BAND_CHANGES)[number];

/**
 * One list for all three measures. What differs between them is the words
 * ("more regulated" of connectivity, "reduced asymmetry" of asymmetry), and
 * words are the wording file's.
 *
 * `mixed_changes` and not `mixed`: a first report's connectivity may be
 * `mixed`, and no name belongs to both editions.
 */
export const CONNECTIVITY_CHANGES = list(
  'improved',
  'unchanged',
  'moved_further',
  'mixed_changes',
  'now_within_normal_limits',
);
export type ConnectivityChange = (typeof CONNECTIVITY_CHANGES)[number];

export const NEXT_STAGE_IDS = list(
  'continue_current',
  'continue_calming',
  'continue_stabilising',
  'continue_calming_and_stabilising',
  'progress_to_optimisation',
  'adjust_focus',
);
export type NextStageId = (typeof NEXT_STAGE_IDS)[number];

/**
 * The rows the change table may carry: the five bands, and the narrower
 * bands the mapping software reports inside alpha and beta.
 */
export const MEASURE_IDS = list(
  'delta',
  'theta',
  'alpha',
  'alpha_1',
  'alpha_2',
  'beta',
  'beta_1',
  'beta_2',
  'beta_3',
  'high_beta',
);
export type MeasureId = (typeof MEASURE_IDS)[number];

export type MeasureRange = Range & { readonly within: BandId | null };

export const MEASURE_RANGES: Readonly<Record<MeasureId, MeasureRange>> = Object.freeze({
  delta: { ...BAND_RANGES.delta, within: null },
  theta: { ...BAND_RANGES.theta, within: null },
  alpha: { ...BAND_RANGES.alpha, within: null },
  alpha_1: { from: 8, to: 10, within: 'alpha' },
  alpha_2: { from: 10, to: 12, within: 'alpha' },
  beta: { ...BAND_RANGES.beta, within: null },
  beta_1: { from: 12, to: 15, within: 'beta' },
  beta_2: { from: 15, to: 18, within: 'beta' },
  beta_3: { from: 18, to: 25, within: 'beta' },
  high_beta: { ...BAND_RANGES.high_beta, within: null },
});

/**
 * The measures a figure can ever be CALCULATED for, because the app records
 * them (`domain/shared/bands.ts`). For every other measure a figure is the
 * practitioner's own estimate, typed, and the page says so. No figure is ever
 * read off a picture.
 */
export const CALCULABLE_MEASURES = list('delta', 'theta', 'alpha', 'beta');

// ---------------------------------------------------------------------------
// Both editions.
// ---------------------------------------------------------------------------

/** How many sessions a programme is offered at. Any other number is typed. */
export const SESSION_OPTIONS = list(15, 20, 30, 40);

/**
 * Which wording a score is printed with: 0 to 4, 5 to 7, 8 to 10.
 *
 * A score is the practitioner's judgement and lives only in a signed report.
 * This reads it; it never makes one.
 */
export function tierOf(score: number): TierId {
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    throw new RangeError('A score is a whole number from 0 to 10.');
  }
  if (score <= 4) return 'low';
  if (score <= 7) return 'middle';
  return 'high';
}
