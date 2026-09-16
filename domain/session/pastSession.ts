import { canActor, type Actor, type Capability, type IsoDate } from '@domain/shared';
import type { CheckInConsentPurpose, DeliveryMode } from './types';

/**
 * A session logged after the fact, from the practice's own records
 * (docs/superpowers/specs/2026-09-16-past-sessions-design.md). The clients
 * the practice already has were seen before the app existed, and their
 * history belongs on their record; the office logs each visit from the day
 * schedule for a day that has passed. Pure: the route applies these rules
 * and the database keeps what survives them.
 */

/** The practice opened in 2024; a visit before that is a mistyped year (the same floor billing's sales use). */
export const EARLIEST_PAST_SESSION_ON: IsoDate = '2024-01-01';

/** Dubai keeps no daylight saving, so a wall-clock time there is always this far from UTC. */
const PRACTICE_UTC_OFFSET = '+04:00';

/** A visit's length: five minutes to four hours. Longer is a typo, shorter is not a visit. */
export const PAST_SESSION_MINUTES = { min: 5, max: 240 } as const;

/** How the visit was settled: a credit from the client's package, or money that changed hands before the app. */
export const PAST_SESSION_BILLING = ['credit', 'settled_outside'] as const;
export type PastSessionBilling = (typeof PAST_SESSION_BILLING)[number];

export type PastSessionDateProblem = 'in_the_future' | 'too_old';

/**
 * Whether a day is one a past visit can be logged on: not after today in the
 * practice's zone, and not before the practice existed.
 */
export function pastSessionDateProblem(on: IsoDate, today: IsoDate): PastSessionDateProblem | null {
  if (on > today) return 'in_the_future';
  if (on < EARLIEST_PAST_SESSION_ON) return 'too_old';
  return null;
}

/**
 * The visit's two instants from what the office types: a day, a start time
 * on the clock, and how long it ran. Both as ISO instants in UTC, the way the
 * session row stores them.
 */
export function pastSessionTimes(input: {
  on: IsoDate;
  startTime: string;
  durationMinutes: number;
}): { startsAt: string; endsAt: string } {
  const starts = new Date(`${input.on}T${input.startTime}:00${PRACTICE_UTC_OFFSET}`);
  const ends = new Date(starts.getTime() + input.durationMinutes * 60_000);
  return { startsAt: starts.toISOString(), endsAt: ends.toISOString() };
}

export type PastSessionBlockReason =
  | 'not_authorised'
  | 'consent_missing_participation'
  | 'consent_missing_minor_participation'
  | 'consent_missing_home_visit'
  | 'consent_missing_health_data'
  | 'date_of_birth_unknown';

export type PastSessionInput = {
  actor: Actor;
  /** The practitioner who delivered the visit, and their credentials, resolved by the route. */
  practitionerId: string;
  practitionerCapabilities: readonly Capability[];
  serviceTypeId: string;
  /** The day the visit happened. */
  on: IsoDate;
  deliveryMode: DeliveryMode;
  hasDateOfBirth: boolean;
  /** Whether the client is under eighteen as of now. Ignored when `hasDateOfBirth` is false. */
  isMinor: boolean;
  /** The purposes with an active consent row for this client, as of now. */
  activeConsentPurposes: readonly CheckInConsentPurpose[];
};

export type PastSessionResult = { ok: boolean; reasons: readonly PastSessionBlockReason[] };

/**
 * The gate for logging a past visit: the shape of the check-in gate
 * (canCheckIn.ts) with the instrument checks left out — there is no kit at
 * the door and no visit to be confirmed — and the actor rule swapped for the
 * office's. Who may log one is the calendar's three roles, and the named
 * practitioner must have held a credential for the service on the visit's
 * own date; the client's consents are judged as of now, because a current
 * client's consent covers their own record, history included.
 *
 * A client with no recorded date of birth blocks rather than being assumed
 * an adult, as at check-in: failing closed is the safer default for a
 * practice that sees minors as the common case.
 */
export function canRecordPastSession(input: PastSessionInput, now: Date): PastSessionResult {
  const reasons: PastSessionBlockReason[] = [];

  const authorised = canActor(
    input.actor,
    {
      type: 'session.record_past',
      practitionerId: input.practitionerId,
      serviceTypeId: input.serviceTypeId,
      on: input.on,
    },
    { assigneeCapabilities: input.practitionerCapabilities },
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

  if (!input.activeConsentPurposes.includes('health_data')) {
    reasons.push('consent_missing_health_data');
  }

  return { ok: reasons.length === 0, reasons };
}
