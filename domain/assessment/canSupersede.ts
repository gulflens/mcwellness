import { MAX_SUPERSEDE_REASON_LENGTH } from './types';

/**
 * Whether a measurement may be corrected, and with what
 * (docs/SPEC/assessment.md section 5, rule 5).
 *
 * A measurement is a fact about a day and a fact about a day does not change.
 * The one thing that may happen to it is a new version of it, with a reason,
 * and both stay. Two things follow, and this is both of them:
 *
 * - **Only the version that stands may be superseded.** Correcting a version
 *   that has already been corrected would fork the chain, and a chain with two
 *   tips has no current version at all. Migration 500 says the same underneath,
 *   with a unique index admitting one successor per row.
 * - **A supersede carries a reason.** Every other append-only entity in the
 *   data model requires one (`client_protocol` is the precedent); section 4
 *   omits it here by oversight, and the column is a change request
 *   (`docs/CHANGE-REQUESTS/assessment-01.md`). Without it the record says a
 *   figure changed and never says why, which is the one thing a correction is
 *   for.
 */
export type SupersedeTarget = {
  id: string;
  /** The version that replaced this one, if any. Null when this one stands. */
  supersededById: string | null;
};

export type SupersedeRefusal = 'already_superseded' | 'reason_required' | 'reason_too_long';

export type SupersedeDecision = { ok: true } | { ok: false; reason: SupersedeRefusal };

export function canSupersede(target: SupersedeTarget, reason: string): SupersedeDecision {
  if (target.supersededById !== null) {
    return { ok: false, reason: 'already_superseded' };
  }
  if (reason.trim() === '') {
    return { ok: false, reason: 'reason_required' };
  }
  if (reason.trim().length > MAX_SUPERSEDE_REASON_LENGTH) {
    return { ok: false, reason: 'reason_too_long' };
  }
  return { ok: true };
}
