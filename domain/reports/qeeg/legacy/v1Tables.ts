/**
 * What each position and each word of the old tool's version 1 file means,
 * under this app's names.
 *
 * **Why these tables are written out and not derived.** The old tool kept a
 * practitioner's ticks as a row of booleans, "the first, fourth and sixth
 * finding", counted against its own lists in `lib/models/content.dart`. This
 * app keeps names (`catalogue/ids.ts`). The two lists happen to run in the
 * same order today, but nothing holds them there: the order of `ids.ts` is the
 * order a list is SHOWN in, and may change. Were a table built from it, a
 * reordering would silently put on a past record a finding that was never
 * made. So each table below was made by reading the old list item by item and
 * matching what the item MEANS to a name, and `v1Tables.test.ts` pins every
 * one of them, position by position, as a literal list.
 *
 * **Why the words are tables too.** The old file holds its choices as the
 * English label the form showed ("Within normal limits", "Follow-up QEEG").
 * A word with no row here is one this app has no name for, and the reader
 * says so in a note rather than guessing.
 *
 * Nothing here is ever written back to an old file. It is read once, at the
 * door, and never again.
 */

import type {
  ApproachId,
  BandId,
  BenefitId,
  ConnectivityId,
  DimensionId,
  FindingId,
  FocusId,
  InitialBandLevel,
  InitialConnectivityLevel,
  RecommendationId,
  RegionId,
} from '../catalogue/ids';
import type { Condition, Eyes, Handedness, Stage } from '../types';

function positions<const T extends readonly string[]>(...items: T): T {
  return Object.freeze(items) as T;
}

/** The old `keyFindings`, by position. */
export const FINDINGS_BY_POSITION: readonly FindingId[] = positions(
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

/** The old `focusAreas`, by position. */
export const FOCUS_BY_POSITION: readonly FocusId[] = positions(
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

/** The old `recommendations`, by position. */
export const RECOMMENDATIONS_BY_POSITION: readonly RecommendationId[] = positions(
  'mental_energy',
  'attention_focus',
  'cognitive_efficiency',
  'stress_regulation',
  'recovery_capacity',
  'decision_making',
);

/** The old `benefits`, by position. */
export const BENEFITS_BY_POSITION: readonly BenefitId[] = positions(
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

/** The old `regions`, by position. The last is the old "Diffuse / Widespread". */
export const REGIONS_BY_POSITION: readonly RegionId[] = positions(
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

/** The old `bands`, by position. */
export const BANDS_BY_POSITION: readonly BandId[] = positions(
  'delta',
  'theta',
  'alpha',
  'beta',
  'high_beta',
);

/** The old `dimensions`, by position. The third is the old "Cognitive Efficiency & Flexibility". */
export const DIMENSIONS_BY_POSITION: readonly DimensionId[] = positions(
  'mental_energy',
  'attention_focus',
  'cognitive_flexibility',
  'stress_regulation',
  'recovery_capacity',
  'decision_making',
);

/** The old `approaches`, by position. The old file writes the position as a string. */
export const APPROACHES_BY_POSITION: readonly ApproachId[] = positions(
  'calming',
  'stabilising',
  'calming_and_stabilising',
);

/** The keys of the old file's `links`. */
export const CONNECTIVITY_BY_OLD_KEY: Readonly<Record<'conn' | 'asym' | 'phase', ConnectivityId>> =
  Object.freeze({
    conn: 'connectivity',
    asym: 'asymmetry',
    phase: 'phase_lag',
  });

/** The old `levels`, as a band's `lvl`. */
export const BAND_LEVEL_BY_OLD_WORD: Readonly<Record<string, InitialBandLevel>> = Object.freeze({
  Increased: 'increased',
  Reduced: 'reduced',
  'Within normal limits': 'within_normal_limits',
});

/**
 * Each kind of connectivity's old levels, as a link's `lvl`. The old words and this app's
 * names happen to be spelt alike; the table says so rather than assuming it.
 */
export const CONNECTIVITY_LEVEL_BY_OLD_WORD: {
  readonly [K in ConnectivityId]: Readonly<Record<string, InitialConnectivityLevel<K>>>;
} = Object.freeze({
  connectivity: Object.freeze({ increased: 'increased', reduced: 'reduced', mixed: 'mixed' }),
  asymmetry: Object.freeze({ left: 'left', right: 'right', bilateral: 'bilateral' }),
  phase_lag: Object.freeze({ normal: 'normal', delayed: 'delayed', altered: 'altered' }),
});

/** What the practitioner called the assessment, as the form offered it. */
export const STAGE_BY_OLD_WORD: Readonly<Record<string, Stage>> = Object.freeze({
  'Initial QEEG': 'initial',
  'Follow-up QEEG': 'follow_up',
  'Final QEEG': 'final',
});

export const EYES_BY_OLD_WORD: Readonly<Record<string, Eyes>> = Object.freeze({
  Closed: 'closed',
  Open: 'open',
  'Closed and Open': 'closed_and_open',
});

export const HAND_BY_OLD_WORD: Readonly<Record<string, Handedness>> = Object.freeze({
  Right: 'right',
  Left: 'left',
  Ambidextrous: 'ambidextrous',
});

/** The two labels the old tool gave a map slot by default. Any other label is her own. */
export const CONDITION_BY_OLD_LABEL: Readonly<Record<string, Condition>> = Object.freeze({
  'EO: Eyes Open': 'eyes_open',
  'EC: Eyes Closed': 'eyes_closed',
});
