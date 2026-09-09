/**
 * An enquiry nobody has actioned (the operator's decision of 10 September
 * 2026, decision 3 of docs/OPERATOR/2026-09-10-decisions.md): still `new`
 * after thirty days, it is surfaced on the screen as waiting, with the days,
 * beside the same Dismiss. Nothing dismisses it by itself — dismissing is an
 * act with a reason, and nothing on this platform deletes on a timer. Pure.
 */
export const ENQUIRY_WAITING_AFTER_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * The whole days an enquiry has waited when that is thirty or more and it is
 * still new; otherwise null.
 */
export function enquiryWaitingDays(
  status: 'new' | 'converted' | 'dismissed',
  receivedAtIso: string,
  now: Date,
): number | null {
  if (status !== 'new') return null;
  const days = Math.floor((now.getTime() - new Date(receivedAtIso).getTime()) / DAY_MS);
  return days >= ENQUIRY_WAITING_AFTER_DAYS ? days : null;
}
