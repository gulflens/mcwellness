import { SECTION_TITLES, sectionOfField } from './sections';

/**
 * A sentence for every refusal `POST /api/reports/draft` answers a brain-map
 * save with (app/api/reports/qeegDraft.ts), as the other report editor keeps
 * one per code (`ReportEditor.tsx`).
 *
 * **Plain, and saying what to do.** The practitioner is at her desk with a
 * form in front of her. "Invalid" tells her nothing; the section, and the
 * domain's own reason for the field, tell her where to look. The stale save
 * says that a newer version exists elsewhere and that nothing was written
 * over it, because the one thing she must not believe is that her screen
 * replaced it.
 */

export const DRAFT_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  invalid_request:
    'The form sent something the server does not accept. Reload the page and try again.',
  reason_required: 'The save did not say why it was made, so nothing was saved. Try again.',
  invalid_content: 'Something in the report is not what the report accepts.',
  route_owned:
    'The form sent a part of the report the server fills in itself, so nothing was saved. Reload the page and try again.',
  wrong_kind: 'This is not a brain-map report, so it cannot be saved from this form.',
  already_issued: 'This report has already been signed, so it can no longer be changed.',
  imported_draft:
    'This is a past record read from the old tool. It is reviewed through its own screen, not saved here.',
  locale_fixed: 'The language of a saved report cannot be changed.',
  cannot_compare: 'The earlier report chosen cannot be compared with.',
  stale_draft:
    'A newer version of this draft was saved somewhere else, perhaps in another tab. Nothing here was saved over it.',
});

/** Why the earlier report a follow-up names was refused (`prefillFollowUp`, and the route's own). */
export const CANNOT_COMPARE: Readonly<Record<string, string>> = Object.freeze({
  no_such_report: 'The earlier report chosen could not be found.',
  not_a_brain_map: 'The earlier report chosen is not a brain-map report.',
  other_client: 'The earlier report chosen belongs to another client.',
  erased: 'This client’s record has been erased, so nothing can be compared with it.',
  same_report: 'A report cannot be compared with itself.',
  superseded:
    'The earlier report chosen has been replaced by a newer version. Choose the version that stands.',
  draft:
    'The earlier report chosen is still a draft. Only a signed report or a kept past record can be compared with.',
  withdrawn: 'The earlier report chosen was withdrawn, so it cannot be compared with.',
  no_reference: 'The earlier report chosen has no reference to name it by.',
  undated: 'The earlier report chosen has no recording date, so nothing can be measured from it.',
  no_such_day: 'The recording date is not a real day.',
  recorded_later: 'This recording is dated before the report it is compared with.',
});

const FORBIDDEN = 'You are not allowed to write reports for this client.';
const NOT_FOUND =
  'This draft or this client could not be found. It may have been removed, or you may no longer have access to it.';
const FALLBACK = 'The draft could not be saved. Check the connection and try again.';

type Refusal = {
  error?: unknown;
  code?: unknown;
  reason?: unknown;
  field?: unknown;
  refusals?: unknown;
};

function asRefusal(body: unknown): Refusal {
  return typeof body === 'object' && body !== null ? (body as Refusal) : {};
}

/** The first reason the shape gave, for the field it named. */
function firstReason(refusal: Refusal): string | null {
  if (!Array.isArray(refusal.refusals)) return null;
  const first: unknown = refusal.refusals[0];
  if (typeof first !== 'object' || first === null) return null;
  const reason = (first as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : null;
}

export function refusalSentence(status: number, body: unknown): string {
  const refusal = asRefusal(body);
  if (status === 403) return FORBIDDEN;
  if (status === 404) return NOT_FOUND;
  const code =
    typeof refusal.code === 'string'
      ? refusal.code
      : typeof refusal.error === 'string'
        ? refusal.error
        : '';
  if (code === 'cannot_compare' && typeof refusal.reason === 'string') {
    return CANNOT_COMPARE[refusal.reason] ?? DRAFT_REFUSALS['cannot_compare'] ?? FALLBACK;
  }
  if (code === 'invalid_content') {
    const field = typeof refusal.field === 'string' ? refusal.field : '';
    const section = sectionOfField(field);
    const reason = firstReason(refusal);
    if (section !== null && reason !== null) {
      return `Something in ${SECTION_TITLES[section]} is not what the report accepts: ${reason}`;
    }
  }
  return Object.hasOwn(DRAFT_REFUSALS, code) ? (DRAFT_REFUSALS[code] ?? FALLBACK) : FALLBACK;
}
