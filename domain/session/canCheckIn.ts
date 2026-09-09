import { canActor, isoDateIn, type Actor } from '@domain/shared';
import type { CheckInConsentPurpose, DeliveryMode } from './types';

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

export type CheckInBlockReason =
  | 'not_authorised'
  | 'consent_missing_participation'
  | 'consent_missing_minor_participation'
  | 'consent_missing_home_visit'
  | 'consent_missing_health_data'
  | 'date_of_birth_unknown'
  | 'kit_calibration_overdue';

export type CheckInInput = {
  actor: Actor;
  serviceTypeId: string;
  deliveryMode: DeliveryMode;
  /** Whether a date of birth is on file for this client at all. */
  hasDateOfBirth: boolean;
  /** Whether the client is under 18 as of `now`, in `timeZone`. Meaningless
   *  (and ignored) when `hasDateOfBirth` is false. */
  isMinor: boolean;
  /** The purposes with an active consent row for this client, as of `now`. */
  activeConsentPurposes: readonly CheckInConsentPurpose[];
  /**
   * Whether at least one active kit item assigned to this practitioner has a
   * calibration that fell due before now (docs/SPEC/practitioner-phone.md
   * section 6.3). `domain/session/kit.ts` is the rule; the caller reads the
   * answer from `app.checkin_context`, whose SQL mirrors it. **No item
   * assigned is false**, not true: the register starts empty and the day it
   * ships must not stop every visit in the practice.
   */
  kitCalibrationOverdue: boolean;
  timeZone?: string;
};

export type CheckInResult = { ok: boolean; reasons: readonly CheckInBlockReason[] };

/**
 * The check-in gate (docs/SPEC/session-capture.md section 3.1, section 5 rule
 * 1) — "the highest-stakes screen in the product". Decoupled from
 * `appointment` and `kit`, neither of which exists in the database yet: this
 * pull request checks who the practitioner is (a role plus a credential
 * valid today, reusing canActor's existing 'session.execute' action rather
 * than re-deriving it) and the client's active consent. "Not today" and "kit
 * calibration overdue" are added once appointment and kit exist.
 *
 * Takes `hasDateOfBirth` and `isMinor` rather than an actual date of birth:
 * the caller (app/api/sessions/checkin.ts) reads these from
 * app.checkin_context (db/migrations/301_checkin_context.sql, replaced by
 * 306), a database door that deliberately never hands back the real date —
 * only whether one is on file and whether it makes the client a minor today,
 * judged in PRACTICE_TIME_ZONE by that same function. This gate never needed
 * the date itself, only those two facts. `kitCalibrationOverdue` arrives the
 * same way and for the same reason: a boolean, from the same door, rather
 * than a register this pure function would have to be handed.
 *
 * A client with no recorded date of birth blocks rather than being assumed
 * an adult. Client-record's own rule requires one at activation (see the
 * comment in db/migrations/060_client.sql), so this should never fire for a
 * genuinely active client — but when it does, failing closed is the safer
 * default for a wellness practice that sees minors as the common case.
 */
export function canCheckIn(input: CheckInInput, now: Date): CheckInResult {
  const reasons: CheckInBlockReason[] = [];
  const today = isoDateIn(now, input.timeZone ?? PRACTICE_TIME_ZONE);

  const authorised = canActor(
    input.actor,
    { type: 'session.execute', serviceTypeId: input.serviceTypeId, on: today },
    {},
    now,
  );
  if (!authorised) {
    reasons.push('not_authorised');
  }

  if (!input.activeConsentPurposes.includes('participation')) {
    reasons.push('consent_missing_participation');
  }

  if (!input.hasDateOfBirth) {
    reasons.push('date_of_birth_unknown');
  } else if (input.isMinor && !input.activeConsentPurposes.includes('minor_participation')) {
    reasons.push('consent_missing_minor_participation');
  }

  if (input.deliveryMode === 'home' && !input.activeConsentPurposes.includes('home_visit')) {
    reasons.push('consent_missing_home_visit');
  }

  // Every visit, whatever the delivery: a session is training on a person's
  // own brain activity, so there is no visit that collects no health data.
  if (!input.activeConsentPurposes.includes('health_data')) {
    reasons.push('consent_missing_health_data');
  }

  // The instruments, last: a household's consent is the more important thing
  // to be told about, and a practitioner reads the reasons in the order they
  // are given (docs/SPEC/practitioner-phone.md section 6.3).
  if (input.kitCalibrationOverdue) {
    reasons.push('kit_calibration_overdue');
  }

  return { ok: reasons.length === 0, reasons };
}
