import type { TelemetrySample } from './types';

/**
 * The signal quality score of a whole visit, 0 to 1 (docs/SPEC/session-capture.md
 * section 5 rule 3). It is the number the ribbon's slice height encodes
 * (docs/DESIGN-BRIEF.md section 5), so it has to mean the same thing in
 * every session ever run.
 *
 * ## The formula
 *
 *     cleanliness  = 1 - (mean artefact share)
 *     timeInTarget = mean reward share
 *     score        = cleanliness x timeInTarget
 *
 * Both means are weighted by each chunk's own `seconds`, so the single
 * end-of-session summary section 3.4 allows and a stream of per-minute
 * chunks give the same answer for the same visit, and a short tail chunk
 * does not count as much as a full minute.
 *
 * ## Why a product rather than an average
 *
 * The two factors are not interchangeable and must not be allowed to
 * compensate for each other. A recording that was clean but never reached
 * the reward state trained nothing; a recording that sat in reward but was
 * mostly artefact was rewarding noise. Either failure alone should pull the
 * score down hard, which multiplication does and an average does not.
 *
 * ## Sign-off and versioning
 *
 * Agreed with the practice on 2026-09-03 as the definition for the first
 * release, to be reviewed once there are enough real sessions to see the
 * spread (docs/DESIGN-BRIEF.md section 10 asks the same question of the
 * ribbon itself). Changing it later changes nothing already recorded: the
 * score is computed once, at close, and snapshotted onto `session.
 * signal_quality_score` — closed sessions are immutable, so history keeps
 * the number it was closed with and only new visits use a new formula.
 *
 * Returns null when there is nothing to score. A visit with no telemetry at
 * all has no quality, which is a different fact from a quality of zero, and
 * the ribbon needs to be able to tell them apart.
 *
 * Pure arithmetic: no clock, no I/O, no rounding surprises — the result is
 * rounded to three decimal places so the same samples always produce
 * byte-identical output, in the database and in a golden test alike.
 */
export function scoreSignalQuality(samples: readonly TelemetrySample[]): number | null {
  let seconds = 0;
  let artefactSeconds = 0;
  let rewardSeconds = 0;

  for (const sample of samples) {
    if (!Number.isFinite(sample.seconds) || sample.seconds <= 0) continue;
    const artefact = clampPercent(sample.artefactPercent);
    const reward = clampPercent(sample.timeInRewardPercent);
    seconds += sample.seconds;
    artefactSeconds += sample.seconds * artefact;
    rewardSeconds += sample.seconds * reward;
  }

  if (seconds === 0) return null;

  const cleanliness = 1 - artefactSeconds / seconds / 100;
  const timeInTarget = rewardSeconds / seconds / 100;
  return round3(cleanliness * timeInTarget);
}

/** A device that reports 104% or -3% is clipped, not believed and not refused. */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
