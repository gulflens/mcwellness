import type { PostObservations } from './types';

/**
 * Whether a visit's after-session observations are worth the lead
 * practitioner's attention (docs/SPEC/session-capture.md section 5 rule 5):
 * true when any chip other than `none` was ticked.
 *
 * A note on its own does not raise the flag. The chips are the structured
 * answer and the queue is built on them (CLAUDE.md rule 3: measurements,
 * goals and observations are typed fields; free text sits beside them, never
 * replaces them). A practitioner who has something to escalate ticks
 * `other` and writes beside it.
 *
 * No observations recorded at all is false, not true: nothing was reported,
 * which is the ordinary end of an ordinary visit.
 */
export function deriveObservationFlag(observations: PostObservations | null): boolean {
  if (!observations) return false;
  return observations.chips.some((chip) => chip !== 'none');
}
