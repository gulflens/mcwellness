import type { ConflictIssue } from '../../api/appointments/schema';

/**
 * The one place this module turns a refusal from `POST /api/appointments`
 * and its `:id/move` sibling into a sentence a coordinator can act on.
 *
 * The server sends a ready-made sentence per issue
 * (`domain/scheduling/conflicts.ts`), and it is never rendered directly: that
 * wording is the rule's own, written for whoever reads it next, and this
 * screen's job is to name the problem *and the way out* (docs/DESIGN-BRIEF.md
 * — "errors name the problem and the recovery"). Both drawers that can be
 * refused share this file rather than keeping a sentence each, so the booking
 * drawer and the move drawer cannot come to say different things about the
 * same refusal.
 *
 * `consent_missing` is the one code that still reads something out of the
 * server's own message — which consent — because the coordinator needs to
 * know what to go and obtain, not merely that something is missing
 * (docs/CHANGE-REQUESTS/scheduling-02.md section 4).
 */

const CONFLICT_MESSAGES: Record<Exclude<ConflictIssue['code'], 'consent_missing'>, string> = {
  practitioner_overlap:
    'This practitioner is already booked close to this time. Choose a different time or practitioner.',
  client_overlap: 'This client already has an appointment at this time. Choose a different time.',
  credential_invalid:
    'This practitioner is not certified for this service on this date. Choose a different practitioner.',
  client_inactive:
    "This client's record is not active. Reactivate the client's record before booking.",
};

/** The three purposes `requiredConsentPurposes` (create.ts) can ask for, named
 * the way a coordinator asking a family for consent would say them, not the
 * database's own purpose codes. */
const CONSENT_PURPOSE_LABELS: Record<string, string> = {
  participation: 'participation',
  minor_participation: 'guardian',
  home_visit: 'home visit',
};

export function localConflictMessage(issue: ConflictIssue): string {
  if (issue.code === 'consent_missing') {
    const purpose = /\(([a-z_]+)\)/i.exec(issue.message)?.[1] ?? null;
    const label = (purpose && CONSENT_PURPOSE_LABELS[purpose]) || 'required';
    return `The client's ${label} consent is missing. Ask the family for it before booking.`;
  }
  return CONFLICT_MESSAGES[issue.code];
}
