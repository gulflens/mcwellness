/**
 * Whether a visit logged from the practice's records may be voided
 * (docs/superpowers/specs/2026-09-23-void-logged-session-design.md, trunk
 * round 60): the owner found one entered wrongly and asked for a way to void
 * or correct it. A void is a stamp on a closed record, never a delete — the
 * same shape `domain/session/pastSession.ts` and `canCheckIn.ts` use, kept
 * pure so the route can turn a refusal into a sentence before the database
 * turns it into an exception. `app.void_recorded_session` (migration 969)
 * asks the same questions again, from the database's own rows, which is the
 * answer that binds.
 */

export type VoidRefusal =
  'wrong_role' | 'not_a_records_row' | 'not_completed' | 'already_voided' | 'session_in_use';

export type VoidRecordedSessionInput = {
  actorRoles: readonly string[];
  session: {
    /** A `device` row carries events, readings and actuals from a visit the
     *  household actually had; unwinding one is a credit note, a different
     *  piece. Only a `records` row — logged after the fact, from the office —
     *  may be voided. */
    recordedFrom: 'device' | 'records';
    status: string;
    /** Set once a void has already happened, never before. Checked before
     *  `status`, so a voided row (whose status is also `voided`, and so also
     *  not `completed`) answers `already_voided` rather than `not_completed`. */
    voidedAt: string | null;
  };
  /** What still names this session: an assessment, an invoice or a billing
   *  exception. Any of the three refuses the void — the row stays a fact
   *  something else already points at. */
  inUseBy: {
    assessments: number;
    invoices: number;
    exceptions: number;
  };
};

export type VoidRecordedSessionResult = { ok: true } | { ok: false; reason: VoidRefusal };

/** The three roles that may log a visit from the records may also void one. */
const VOID_ROLES = ['owner', 'admin', 'lead_practitioner'];

/**
 * The gate for voiding a session logged from the records. Check order: role,
 * then already voided, then whether it is a records row at all, then whether
 * it is completed, then whether anything still names it. Role comes first
 * because every other answer is about a row this actor has no business
 * asking about in the first place; already-voided comes next so a second
 * attempt at the same row reads as "already done" rather than as some other
 * refusal a stale status might otherwise produce.
 */
export function canVoidRecordedSession(input: VoidRecordedSessionInput): VoidRecordedSessionResult {
  if (!input.actorRoles.some((role) => VOID_ROLES.includes(role))) {
    return { ok: false, reason: 'wrong_role' };
  }
  if (input.session.voidedAt !== null) {
    return { ok: false, reason: 'already_voided' };
  }
  if (input.session.recordedFrom !== 'records') {
    return { ok: false, reason: 'not_a_records_row' };
  }
  if (input.session.status !== 'completed') {
    return { ok: false, reason: 'not_completed' };
  }
  if (input.inUseBy.assessments > 0 || input.inUseBy.invoices > 0 || input.inUseBy.exceptions > 0) {
    return { ok: false, reason: 'session_in_use' };
  }
  return { ok: true };
}
