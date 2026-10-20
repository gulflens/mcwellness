import { canActivate, consentsOutstanding, type ClientRecord, type Missing } from '@domain/client';
import type { ClientRecordResponse } from '../../api/clients/record-schema';

/**
 * Bridges the API's own shape (`ClientRecordResponse`) to the narrow slice
 * `canActivate` (domain/client) needs, so the enrolment wizard's steps and
 * the drawer's Overview tab can both ask "what's missing?" of the exact
 * record the server just returned, the way docs/SPEC/client-record.md
 * section 4.3 asks for. Pure, browser-safe: no I/O, nothing computed here
 * the server did not already send.
 *
 * `hasVerifiedPin` is true for every location the record carries: the
 * server has no separate "verified" column — `entrance_point` is itself the
 * verified coordinate, required at insert (00-data-model.md section 2) —
 * and app/api/clients/record.ts's own activation gate makes exactly this
 * same assumption for the same reason.
 */
export function toActivationRecord(record: ClientRecordResponse): ClientRecord {
  return {
    client: { id: record.id, status: record.status, dateOfBirth: record.dateOfBirth },
    contacts: record.contacts.map((contact) => ({
      id: contact.id,
      relationship: contact.relationship,
      isLegalGuardian: contact.isLegalGuardian,
      canConsent: contact.canConsent,
      userId: null,
    })),
    locations: record.locations.map((location) => ({
      id: location.id,
      emirate: location.emirate,
      hasVerifiedPin: true,
      label: location.label,
      isPrimary: location.isPrimary,
    })),
    consents: record.consents.map((consent) => ({
      purpose: consent.purpose,
      status: consent.status,
      givenByContactId: consent.givenByContactId,
      givenAt: consent.givenAt,
      expiresAt: consent.expiresAt,
    })),
  };
}

/** Plain words for each reason `canActivate` can refuse (client-record.md rule 1). */
const MISSING_LABELS: Record<Missing, string> = {
  date_of_birth: 'Date of birth',
  verified_location: 'A location with its pin set',
  consenting_contact: 'A contact who may give consent',
  'consent:participation': 'Participation consent',
  'consent:minor_participation': "The guardian's consent for a minor",
  'consent:home_visit': 'Consent for home visits',
  'consent:health_data': 'Consent for brain-map and neurofeedback information',
};

export function missingLabel(item: Missing): string {
  return MISSING_LABELS[item];
}

/** Today, in the practice's own time zone — the same "today" canActivate is judged against. */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';
export function practiceToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PRACTICE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The same day, written the way this country writes it. `practiceToday` is
 * ISO because it is compared; this one is read by a person — it is drawn into
 * the signature image that is filed, where 2026-09-03 is a database talking
 * and 03/09/2026 is a date on a form.
 */
export function practiceTodayInWords(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: PRACTICE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * A stored date drawn for a person, in the practice's zone and never the
 * computer's: a colleague abroad sees the day it was in Dubai (operator,
 * 20 October 2026). A bare calendar day such as a birthday is drawn as itself.
 */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

function drawn(iso: string, options: Intl.DateTimeFormatOptions): string {
  const calendarDay = CALENDAR_DAY.test(iso);
  const date = new Date(calendarDay ? `${iso}T00:00:00Z` : iso);
  // A malformed value draws a dash rather than throwing and taking the tab down.
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    ...options,
    timeZone: calendarDay ? 'UTC' : PRACTICE_TIME_ZONE,
  }).format(date);
}

/** 04/09/2026 */
export function practiceDate(iso: string): string {
  return drawn(iso, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 4 September 2026 */
export function practiceDateLong(iso: string): string {
  return drawn(iso, { year: 'numeric', month: 'long', day: 'numeric' });
}

export { canActivate, consentsOutstanding };
export type { Missing };
