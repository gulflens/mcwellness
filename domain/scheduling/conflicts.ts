import { isCredentialValidOn, type Capability, type IsoDate } from '@domain/shared';

/**
 * Stops a coordinator double-booking a practitioner or a client, stops an
 * appointment being placed against a practitioner who isn't actually
 * certified for it, and stops one being placed without the consent it needs
 * (docs/SPEC/scheduling-manual.md section 6.1). Pure: no I/O, no clock read
 * inside (.claude/rules/testing.md) — every appointment and every consent
 * this needs to know about is handed in by the caller, already loaded.
 *
 * Session-spacing, zero-entitlement, prayer-time and continuity warnings need
 * session history, entitlement balances and practitioner preferences that
 * don't exist yet in this stream; `warnings` is always empty in this slice
 * and is wired up once those tables land.
 */

export type ConflictCode =
  | 'practitioner_overlap'
  | 'client_overlap'
  | 'credential_invalid'
  | 'client_inactive'
  | 'consent_missing';

export type ConflictIssue = {
  code: ConflictCode;
  message: string;
  /** The other appointment this one collides with, for the two overlap codes. */
  conflictsWithAppointmentId?: string;
};

export type ConflictReport = { blocking: ConflictIssue[]; warnings: ConflictIssue[] };

/** One appointment already on the calendar, as much as a conflict check needs. */
export type ExistingAppointment = {
  id: string;
  windowStart: Date;
  windowEnd: Date;
  travelBufferMinutes: number;
};

export type SchedulingCandidate = {
  practitionerId: string;
  clientId: string;
  serviceTypeId: string;
  windowStart: Date;
  windowEnd: Date;
  travelBufferMinutes: number;
  /** The candidate's own calendar date: credential validity is judged on that date, not today's. */
  on: IsoDate;
};

export type SchedulingContext = {
  /** The practitioner's other live appointments (any status that still holds a slot). */
  practitionerAppointments: readonly ExistingAppointment[];
  /** The client's other live appointments. */
  clientAppointments: readonly ExistingAppointment[];
  /** The practitioner's credentials, in the same shape domain/shared's Actor carries them. */
  practitionerCredentials: readonly Capability[];
  /** Whether the client's record is `active` (docs/SPEC/00-data-model.md section 3). */
  clientActive: boolean;
  /** The consent purposes this appointment needs; the caller (create.ts) decides which, since that
   * is booking policy, not a scheduling conflict rule. */
  requiredConsentPurposes: readonly string[];
  /** The client's currently active consent purposes, loaded in the same transaction. */
  activeConsentPurposes: readonly string[];
};

export const PRACTITIONER_OVERLAP_MESSAGE =
  'This practitioner is already booked close to this time.';
export const CLIENT_OVERLAP_MESSAGE = 'This client already has an appointment at this time.';

/** Half-open interval overlap: touching at the boundary is not a conflict. */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * The busy interval a visit occupies: the window itself, plus the travel
 * buffer AFTER it (the drive to whatever comes next) — never before, so two
 * back-to-back default-buffer visits need only one buffer's worth of gap
 * between them, not two. Matches the exclusion constraint in
 * db/migrations/200_appointment.sql exactly: `[window_start, window_end + buffer)`.
 */
function busyInterval(start: Date, end: Date, bufferMinutes: number): [Date, Date] {
  return [start, new Date(end.getTime() + bufferMinutes * 60_000)];
}

export function checkConflicts(
  candidate: SchedulingCandidate,
  context: SchedulingContext,
): ConflictReport {
  const blocking: ConflictIssue[] = [];

  const [candidateStart, candidateEnd] = busyInterval(
    candidate.windowStart,
    candidate.windowEnd,
    candidate.travelBufferMinutes,
  );
  for (const existing of context.practitionerAppointments) {
    const [existingStart, existingEnd] = busyInterval(
      existing.windowStart,
      existing.windowEnd,
      existing.travelBufferMinutes,
    );
    if (overlaps(candidateStart, candidateEnd, existingStart, existingEnd)) {
      blocking.push({
        code: 'practitioner_overlap',
        message: PRACTITIONER_OVERLAP_MESSAGE,
        conflictsWithAppointmentId: existing.id,
      });
    }
  }

  for (const existing of context.clientAppointments) {
    if (
      overlaps(candidate.windowStart, candidate.windowEnd, existing.windowStart, existing.windowEnd)
    ) {
      blocking.push({
        code: 'client_overlap',
        message: CLIENT_OVERLAP_MESSAGE,
        conflictsWithAppointmentId: existing.id,
      });
    }
  }

  const hasValidCredential = context.practitionerCredentials.some(
    (capability) =>
      capability.serviceTypeId === candidate.serviceTypeId &&
      capability.canExecuteSession &&
      isCredentialValidOn(capability, candidate.on),
  );
  if (!hasValidCredential) {
    blocking.push({
      code: 'credential_invalid',
      message:
        'This practitioner does not hold a current certification for this service on this date.',
    });
  }

  if (!context.clientActive) {
    blocking.push({ code: 'client_inactive', message: "This client's record is not active." });
  }

  const active = new Set(context.activeConsentPurposes);
  for (const purpose of context.requiredConsentPurposes) {
    if (!active.has(purpose)) {
      blocking.push({
        code: 'consent_missing',
        message: `The required consent (${purpose}) is not active for this client.`,
      });
    }
  }

  return { blocking, warnings: [] };
}
