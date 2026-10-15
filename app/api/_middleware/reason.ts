import type { Context } from 'hono';

/**
 * The reason a console save carries, read off the request.
 *
 * A browser refuses to send a header whose value holds a character outside
 * ISO-8859-1, so a reason with a curly apostrophe (which macOS types on its
 * own), an em dash, an emoji or any Arabic could not travel in `X-Reason`
 * as typed: the save failed before it left the screen. The console therefore
 * percent-encodes such a reason (`encodeURIComponent`) and says so in a
 * second header, `X-Reason-Encoding: uri` (app/shell/auth/reasonHeader.ts).
 * A header without that marker is read as the plain text it is, so a caller
 * that sends plain ASCII, as every caller did before, works unchanged.
 *
 * Every reader of the reason goes through `requestReason`, so the text a
 * route judges and the text the fence stamps on `app.reason` for the audit
 * trail are the same decoded, human text.
 */

export const REASON_HEADER = 'x-reason';
export const REASON_ENCODING_HEADER = 'x-reason-encoding';
export const REASON_ENCODING_URI = 'uri';

/**
 * The reason as text: `''` when there is none, `null` when the header cannot
 * be read — an encoding this does not know, or a malformed percent-encoding.
 * Pure; never throws.
 */
export function decodeReason(
  value: string | undefined,
  encoding: string | undefined,
): string | null {
  if (encoding === undefined) {
    return value ?? '';
  }
  if (encoding.trim().toLowerCase() !== REASON_ENCODING_URI) {
    return null;
  }
  try {
    return decodeURIComponent(value ?? '');
  } catch {
    return null;
  }
}

/**
 * The request's reason, decoded. An unreadable header reads as no reason
 * here; the request-context middleware has already refused one with a 400
 * before any route below it runs.
 */
export function requestReason(c: Context): string {
  return decodeReason(c.req.header(REASON_HEADER), c.req.header(REASON_ENCODING_HEADER)) ?? '';
}
