/**
 * What the client record's forms check before they send, and how they name a
 * refusal when the server sends one back.
 *
 * The rules here are the ones the route's own zod schemas hold
 * (app/api/clients/record-schema.ts): the point is not to move the boundary —
 * the server still decides — but to let a person see which field is wrong and
 * why, rather than reading "This could not be saved" and having nowhere to
 * look. A phone typed without its country code was exactly that loop: the
 * form checked only that something had been typed, the server needed E.164,
 * and the 400 that came back named nothing.
 */

// The same expression as record-schema.ts's `E164`, and as the check constraint
// on contact.phone (db/migrations/060_client.sql).
const E164 = /^\+[1-9][0-9]{6,14}$/;

export const PHONE_HINT = 'Include the country code, for example +971 50 000 1234';
export const PHONE_ERROR = `Enter the phone number with its country code, for example +971500001234.`;
export const EMAIL_ERROR =
  'Enter an email address, for example name@example.com, or leave it blank.';
export const FUTURE_DATE_ERROR = 'A date of birth is in the past.';

/** E.164: a plus, then seven to fifteen digits. Spaces are allowed while typing. */
export function isValidPhone(value: string): boolean {
  return E164.test(value.replace(/\s/g, ''));
}

/** The phone as the routes want it: no spaces. */
export function normalisePhone(value: string): string {
  return value.replace(/\s/g, '');
}

/** Deliberately loose, matching what `z.email()` accepts in practice, not a specification. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** A date of birth cannot be later than today (record-schema.ts's own bound). */
export function isPastDate(value: string, today: string): boolean {
  return value <= today;
}

/**
 * A 400 from a client-record route, turned into something a person can act on.
 * The routes answer `{ error, code?, fields? }`: `code` names a specific
 * refusal (an Emirates ID that fails its checksum), `fields` names the parts of
 * the body zod rejected, by the path it rejected them at. Neither carries a
 * value, so nothing personal travels in an error.
 */
export type BadRequest = { code?: string; fields?: string[] };

/** The field a server-named path belongs to on these forms. */
export function fieldOf(path: string): 'phone' | 'email' | 'dateOfBirth' | 'emiratesId' | null {
  const leaf = path.split('.').pop() ?? '';
  if (leaf === 'phone') return 'phone';
  if (leaf === 'email') return 'email';
  if (leaf === 'dateOfBirth') return 'dateOfBirth';
  if (leaf === 'emiratesId') return 'emiratesId';
  return null;
}

/** Moves the caret to the first field that is wrong, in the order they are read. */
export function focusFirstError(order: readonly string[], wrong: Record<string, unknown>): void {
  const first = order.find((id) => wrong[id] !== undefined);
  if (first === undefined) return;
  const element = document.getElementById(first);
  if (element instanceof HTMLElement) element.focus();
}
