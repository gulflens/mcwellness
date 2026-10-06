/**
 * What a household must have agreed to before a brain-map report is written
 * or a past one brought in (round 74, the operator's approval of 6 October
 * 2026, on a gap the review of round 71 found): a brain-map report holds what
 * a person's brain did, which is health data, so drafting one or bringing one
 * in asks the same agreements a recording of it does.
 *
 * - `participation`: the household agreed to take part.
 * - `health_data`: it agreed to the practice holding what the brain does.
 * - `minor_participation`, for a minor: a guardian's own agreement. A date of
 *   birth that is unknown cannot be proven adult, so it fails closed, as the
 *   check-in and the assessment gate do.
 *
 * Pure: the caller reads the active purposes and whether the person is a
 * minor at the moment of writing, never from a cache.
 */

export type BrainMapConsentRefusal =
  | 'consent_missing_participation'
  | 'consent_missing_health_data'
  | 'consent_missing_minor_participation';

export function brainMapConsentRefusals(input: {
  /** The consent purposes active for the client now. */
  active: readonly string[];
  /** Whether the client is a minor today; null when the date of birth is unknown. */
  isMinor: boolean | null;
}): BrainMapConsentRefusal[] {
  const refusals: BrainMapConsentRefusal[] = [];
  if (!input.active.includes('participation')) refusals.push('consent_missing_participation');
  if (!input.active.includes('health_data')) refusals.push('consent_missing_health_data');
  if (input.isMinor !== false && !input.active.includes('minor_participation')) {
    refusals.push('consent_missing_minor_participation');
  }
  return refusals;
}
