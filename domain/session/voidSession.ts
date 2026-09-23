import { OFFICE_ROLES } from '@domain/shared';

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
  // The three roles that may log a visit from the records may also void one.
  if (!input.actorRoles.some((role) => (OFFICE_ROLES as readonly string[]).includes(role))) {
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

/**
 * Whether a row on the day's schedule is one a void or a correction may be
 * offered on: completed, typed up by the office from the records rather than
 * closed on the phone, and with its session known. A visit closed on the
 * phone carries what the household really had and is not unwound from the
 * screen; a voided one has nothing left to change. The screen asks this; the
 * route and the database hold the same line (`canVoidRecordedSession`,
 * `app.void_recorded_session`).
 */
export function isVoidableRow<
  T extends { status: string; recordedFrom: 'device' | 'records' | null; sessionId: string | null },
>(row: T): row is T & { sessionId: string } {
  return row.status === 'completed' && row.recordedFrom === 'records' && row.sessionId !== null;
}
