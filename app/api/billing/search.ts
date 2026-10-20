import { isUuid } from './ids';

/**
 * The pure half of searching the invoice and receipt books
 * (`POST /api/billing/invoices/search`, `POST /api/billing/payments/search`).
 *
 * Imported by the request schemas, which the browser imports too, so nothing
 * here reaches for Node: `btoa` and `atob` are on both sides, and every cursor
 * is plain ASCII.
 */

/**
 * The text a person typed, made safe to put between `ilike`'s wildcards.
 *
 * Without this a search for "%" would list the whole book and one for "_"
 * every reference of a given length: the characters `like` reads as patterns
 * are matched as themselves instead. The routes say `escape '\'`, so the
 * backslash is escaped first and the other two after it.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

/** The escaped text anywhere in a value: a substring search. */
export function containsPattern(text: string): string {
  return `%${escapeLike(text)}%`;
}

/**
 * Where one page of receipts ended: the last row's moment and its id.
 *
 * The moment is UTC to the microsecond, as Postgres keeps it, because a
 * JavaScript `Date` keeps only milliseconds — two payments a few microseconds
 * apart would otherwise compare as equal and a page could repeat or skip one.
 * The route reads it out of the database as text for exactly that reason.
 */
export type ReceiptCursor = { receivedAt: string; id: string };

const RECEIVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * The cursor as the client holds it: opaque, so a screen keeps it and sends
 * it back without being tempted to build or edit one. Base64url, so it is
 * safe anywhere text travels, though it only ever travels in a body.
 */
export function encodeReceiptCursor(cursor: ReceiptCursor): string {
  return btoa(`${cursor.receivedAt}|${cursor.id}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The cursor read back, or null when it is not one this file made. It comes
 * from the caller, so it is judged on its shape before either half goes near
 * a query: a full UTC timestamp that is a real moment, and a uuid.
 */
export function decodeReceiptCursor(text: string): ReceiptCursor | null {
  if (!BASE64URL.test(text)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
  const parts = decoded.split('|');
  if (parts.length !== 2) {
    return null;
  }
  const [receivedAt, id] = parts as [string, string];
  if (!RECEIVED_AT.test(receivedAt) || !isRealMoment(receivedAt) || !isUuid(id)) {
    return null;
  }
  return { receivedAt, id };
}

// `Date` rolls an impossible date over rather than refusing it (the 31st of
// September is the 1st of October), so the moment is checked by writing it
// back out and comparing the part a Date can hold.
function isRealMoment(receivedAt: string): boolean {
  const parsed = new Date(receivedAt);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 23) === receivedAt.slice(0, 23)
  );
}
