import { describe, expect, it } from 'vitest';
import {
  APPROACH_IDS,
  BAND_IDS,
  BENEFIT_IDS,
  CONNECTIVITY_IDS,
  DIMENSION_IDS,
  FINDING_IDS,
  FOCUS_IDS,
  INITIAL_BAND_LEVELS,
  INITIAL_CONNECTIVITY_LEVELS,
  RECOMMENDATION_IDS,
  REGION_IDS,
} from '../catalogue/ids';
import { CONDITIONS, EYES, HANDEDNESS, STAGES } from '../types';
import {
  APPROACHES_BY_POSITION,
  BAND_LEVEL_BY_OLD_WORD,
  BANDS_BY_POSITION,
  BENEFITS_BY_POSITION,
  CONDITION_BY_OLD_LABEL,
  CONNECTIVITY_LEVEL_BY_OLD_WORD,
  DIMENSIONS_BY_POSITION,
  EYES_BY_OLD_WORD,
  FINDINGS_BY_POSITION,
  FOCUS_BY_POSITION,
  HAND_BY_OLD_WORD,
  CONNECTIVITY_BY_OLD_KEY,
  RECOMMENDATIONS_BY_POSITION,
  REGIONS_BY_POSITION,
  STAGE_BY_OLD_WORD,
} from './v1Tables';

/**
 * Every table is pinned here IN FULL, written out by hand from the old
 * tool's own lists (`lib/models/content.dart`), read item by item. The line
 * comment beside each name is the old tool's label at that position, so a
 * reader can check the pairing without opening the Dart source.
 */

describe('what each position of the old file means', () => {
  it('reads the ten findings in the old order', () => {
    expect(FINDINGS_BY_POSITION).toEqual([
      'brainwave_dysregulation', // 0 Brainwave Dysregulation
      'altered_brain_communication', // 1 Altered Brain Communication
      'reduced_cognitive_efficiency', // 2 Reduced Cognitive Efficiency
      'reduced_attention_focus', // 3 Reduced Attention & Focus
      'mental_fatigue', // 4 Mental Fatigue
      'increased_stress_response', // 5 Increased Stress Response
      'reduced_emotional_regulation', // 6 Reduced Emotional Regulation
      'sleep_dysregulation', // 7 Sleep Dysregulation
      'reduced_recovery_capacity', // 8 Reduced Recovery Capacity
      'reduced_mental_energy', // 9 Reduced Mental Energy
    ]);
  });

  it('reads the eleven areas of focus in the old order', () => {
    expect(FOCUS_BY_POSITION).toEqual([
      'brainwave_regulation', // 0 Brainwave Regulation
      'brain_communication', // 1 Brain Communication
      'attention_focus', // 2 Attention & Focus
      'cognitive_efficiency', // 3 Cognitive Efficiency
      'memory_function', // 4 Memory Function
      'emotional_regulation', // 5 Emotional Regulation
      'stress_regulation', // 6 Stress Regulation
      'nervous_system_regulation', // 7 Nervous System Regulation
      'sleep_recovery', // 8 Sleep & Recovery
      'mental_energy', // 9 Mental Energy
      'performance_optimisation', // 10 Performance Optimisation
    ]);
  });

  it('reads the six recommendations in the old order', () => {
    expect(RECOMMENDATIONS_BY_POSITION).toEqual([
      'mental_energy', // 0 Mental Energy
      'attention_focus', // 1 Attention & Focus
      'cognitive_efficiency', // 2 Cognitive Efficiency
      'stress_regulation', // 3 Stress Regulation
      'recovery_capacity', // 4 Recovery Capacity
      'decision_making', // 5 Decision Making
    ]);
  });

  it('reads the nine benefits in the old order', () => {
    expect(BENEFITS_BY_POSITION).toEqual([
      'attention_focus', // 0 Improved attention & focus
      'emotional_regulation', // 1 Improved emotional regulation
      'stress_management', // 2 Better stress management
      'sleep', // 3 Improved sleep
      'mental_energy', // 4 Increased mental energy
      'resilience', // 5 Improved resilience
      'cognitive_endurance', // 6 Increased cognitive endurance
      'peak_performance', // 7 Peak cognitive performance
      'recovery', // 8 Improved recovery
    ]);
  });

  it('reads the nine regions in the old order', () => {
    expect(REGIONS_BY_POSITION).toEqual([
      'frontal', // 0 Frontal Regions
      'central', // 1 Central Regions
      'temporal', // 2 Temporal Regions
      'parietal', // 3 Parietal Regions
      'occipital', // 4 Occipital Regions
      'left_hemisphere', // 5 Left Hemisphere
      'right_hemisphere', // 6 Right Hemisphere
      'bilateral', // 7 Bilateral
      'widespread', // 8 Diffuse / Widespread
    ]);
  });

  it('reads the five bands in the old order', () => {
    expect(BANDS_BY_POSITION).toEqual([
      'delta', // 0 Delta, 1 to 4 Hz
      'theta', // 1 Theta, 4 to 8 Hz
      'alpha', // 2 Alpha, 8 to 12 Hz
      'beta', // 3 Beta, 12 to 25 Hz
      'high_beta', // 4 High Beta, 25 to 30 Hz
    ]);
  });

  it('reads the six dashboard dimensions in the old order', () => {
    expect(DIMENSIONS_BY_POSITION).toEqual([
      'mental_energy', // 0 Mental Energy
      'attention_focus', // 1 Attention & Focus
      'cognitive_flexibility', // 2 Cognitive Efficiency & Flexibility
      'stress_regulation', // 3 Stress Regulation
      'recovery_capacity', // 4 Recovery Capacity
      'decision_making', // 5 Decision Making
    ]);
  });

  it('reads the three training approaches in the old order', () => {
    expect(APPROACHES_BY_POSITION).toEqual([
      'calming', // '0' Calming
      'stabilising', // '1' Stabilising
      'calming_and_stabilising', // '2' Calming & Stabilising
    ]);
  });
});

describe('what each word of the old file means', () => {
  it('names the three kinds of connectivity by the keys the old file uses', () => {
    expect(CONNECTIVITY_BY_OLD_KEY).toEqual({
      conn: 'connectivity',
      asym: 'asymmetry',
      phase: 'phase_lag',
    });
  });

  it('names the three levels a band may have', () => {
    expect(BAND_LEVEL_BY_OLD_WORD).toEqual({
      Increased: 'increased',
      Reduced: 'reduced',
      'Within normal limits': 'within_normal_limits',
    });
  });

  it('names the levels each measure may have', () => {
    expect(CONNECTIVITY_LEVEL_BY_OLD_WORD).toEqual({
      connectivity: { increased: 'increased', reduced: 'reduced', mixed: 'mixed' },
      asymmetry: { left: 'left', right: 'right', bilateral: 'bilateral' },
      phase_lag: { normal: 'normal', delayed: 'delayed', altered: 'altered' },
    });
  });

  it('names the three stages the practitioner could call an assessment', () => {
    expect(STAGE_BY_OLD_WORD).toEqual({
      'Initial QEEG': 'initial',
      'Follow-up QEEG': 'follow_up',
      'Final QEEG': 'final',
    });
  });

  it('names the three ways the eyes were during the recording', () => {
    expect(EYES_BY_OLD_WORD).toEqual({
      Closed: 'closed',
      Open: 'open',
      'Closed and Open': 'closed_and_open',
    });
  });

  it('names the three hands', () => {
    expect(HAND_BY_OLD_WORD).toEqual({
      Right: 'right',
      Left: 'left',
      Ambidextrous: 'ambidextrous',
    });
  });

  it('names the two map labels the practice uses', () => {
    expect(CONDITION_BY_OLD_LABEL).toEqual({
      'EO: Eyes Open': 'eyes_open',
      'EC: Eyes Closed': 'eyes_closed',
    });
  });
});

describe('every table is whole', () => {
  const exactlyOnce = (table: readonly string[], ids: readonly string[]) => {
    expect(table).toHaveLength(ids.length);
    expect(new Set(table).size).toBe(table.length);
    expect([...table].sort()).toEqual([...ids].sort());
  };

  it('holds every finding exactly once', () => exactlyOnce(FINDINGS_BY_POSITION, FINDING_IDS));
  it('holds every area of focus exactly once', () => exactlyOnce(FOCUS_BY_POSITION, FOCUS_IDS));
  it('holds every recommendation exactly once', () =>
    exactlyOnce(RECOMMENDATIONS_BY_POSITION, RECOMMENDATION_IDS));
  it('holds every benefit exactly once', () => exactlyOnce(BENEFITS_BY_POSITION, BENEFIT_IDS));
  it('holds every region exactly once', () => exactlyOnce(REGIONS_BY_POSITION, REGION_IDS));
  it('holds every band exactly once', () => exactlyOnce(BANDS_BY_POSITION, BAND_IDS));
  it('holds every dimension exactly once', () =>
    exactlyOnce(DIMENSIONS_BY_POSITION, DIMENSION_IDS));
  it('holds every approach exactly once', () => exactlyOnce(APPROACHES_BY_POSITION, APPROACH_IDS));
  it('holds every measure exactly once', () =>
    exactlyOnce(Object.values(CONNECTIVITY_BY_OLD_KEY), CONNECTIVITY_IDS));
  it('holds every band level exactly once', () =>
    exactlyOnce(Object.values(BAND_LEVEL_BY_OLD_WORD), INITIAL_BAND_LEVELS));
  it('holds every level of every measure exactly once', () => {
    for (const id of CONNECTIVITY_IDS) {
      exactlyOnce(
        Object.values(CONNECTIVITY_LEVEL_BY_OLD_WORD[id]),
        INITIAL_CONNECTIVITY_LEVELS[id],
      );
    }
  });
  it('holds every stage exactly once', () => exactlyOnce(Object.values(STAGE_BY_OLD_WORD), STAGES));
  it('holds every way of the eyes exactly once', () =>
    exactlyOnce(Object.values(EYES_BY_OLD_WORD), EYES));
  it('holds every hand exactly once', () =>
    exactlyOnce(Object.values(HAND_BY_OLD_WORD), HANDEDNESS));
  it('holds every condition exactly once', () =>
    exactlyOnce(Object.values(CONDITION_BY_OLD_LABEL), CONDITIONS));

  it('cannot be changed once loaded', () => {
    for (const table of [
      FINDINGS_BY_POSITION,
      FOCUS_BY_POSITION,
      RECOMMENDATIONS_BY_POSITION,
      BENEFITS_BY_POSITION,
      REGIONS_BY_POSITION,
      BANDS_BY_POSITION,
      DIMENSIONS_BY_POSITION,
      APPROACHES_BY_POSITION,
      CONNECTIVITY_BY_OLD_KEY,
      BAND_LEVEL_BY_OLD_WORD,
      CONNECTIVITY_LEVEL_BY_OLD_WORD,
      CONNECTIVITY_LEVEL_BY_OLD_WORD.connectivity,
      CONNECTIVITY_LEVEL_BY_OLD_WORD.asymmetry,
      CONNECTIVITY_LEVEL_BY_OLD_WORD.phase_lag,
      STAGE_BY_OLD_WORD,
      EYES_BY_OLD_WORD,
      HAND_BY_OLD_WORD,
      CONDITION_BY_OLD_LABEL,
    ]) {
      expect(Object.isFrozen(table)).toBe(true);
    }
  });
});
