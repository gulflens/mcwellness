import { describe, expect, it } from 'vitest';
import { scoreSignalQuality } from './scoreSignalQuality';
import type { TelemetrySample } from './types';

function sample(over: Partial<TelemetrySample> = {}): TelemetrySample {
  return {
    seconds: 60,
    artefactPercent: 0,
    timeInRewardPercent: 100,
    bands: {},
    threshold: null,
    at: '2026-09-03T06:40:00.000Z',
    ...over,
  };
}

describe('scoreSignalQuality', () => {
  it('has no score for a visit with no telemetry at all', () => {
    expect(scoreSignalQuality([])).toBeNull();
  });

  it('scores a perfectly clean minute wholly in reward as one', () => {
    expect(scoreSignalQuality([sample()])).toBe(1);
  });

  it('scores a clean recording that never reached reward as zero', () => {
    expect(scoreSignalQuality([sample({ timeInRewardPercent: 0 })])).toBe(0);
  });

  it('scores a recording that was all artefact as zero however long it sat in reward', () => {
    expect(scoreSignalQuality([sample({ artefactPercent: 100 })])).toBe(0);
  });

  it('multiplies cleanliness by time in target rather than averaging them', () => {
    // Cleanliness 0.8, time in target 0.5. A product gives 0.4; an average
    // would give 0.65 and let one factor hide the other.
    expect(scoreSignalQuality([sample({ artefactPercent: 20, timeInRewardPercent: 50 })])).toBe(
      0.4,
    );
  });

  it('weights each chunk by the seconds it covers', () => {
    // Three minutes at 60% reward and one at 20%: the weighted mean is 50%.
    const long = sample({ seconds: 180, timeInRewardPercent: 60 });
    const short = sample({ seconds: 60, timeInRewardPercent: 20 });
    expect(scoreSignalQuality([long, short])).toBe(0.5);
  });

  it('gives a summary-only visit the same score as the per-minute stream it summarises', () => {
    // Section 3.4 allows a single end-of-session summary when per-minute data
    // is not available; the two forms must not disagree about the same visit.
    const perMinute = [
      sample({ seconds: 60, artefactPercent: 10, timeInRewardPercent: 40 }),
      sample({ seconds: 60, artefactPercent: 30, timeInRewardPercent: 60 }),
    ];
    const summary = [sample({ seconds: 120, artefactPercent: 20, timeInRewardPercent: 50 })];
    expect(scoreSignalQuality(perMinute)).toBe(scoreSignalQuality(summary));
  });

  it('clips a share a device reports outside 0 to 100 rather than believing it', () => {
    expect(scoreSignalQuality([sample({ artefactPercent: -5, timeInRewardPercent: 140 })])).toBe(1);
  });

  it('ignores a chunk covering no time at all', () => {
    expect(scoreSignalQuality([sample(), sample({ seconds: 0, timeInRewardPercent: 0 })])).toBe(1);
  });

  it('rounds to three decimal places so the same samples always give the same number', () => {
    const score = scoreSignalQuality([sample({ artefactPercent: 33, timeInRewardPercent: 33 })]);
    expect(score).toBe(0.221);
  });
});
