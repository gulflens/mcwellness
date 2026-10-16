/**
 * Makes a request's `X-Reason` sendable whatever the person typed.
 *
 * A browser refuses a header value holding any character outside ISO-8859-1
 * (`new Headers` and `fetch` throw before anything leaves the device). So a
 * reason with a curly apostrophe — which macOS types on its own — an em dash,
 * an emoji or any Arabic used to fail as "could not be saved". Such a reason
 * is sent percent-encoded (`encodeURIComponent`) and marked with
 * `X-Reason-Encoding: uri`; the API decodes it before anything reads it
 * (app/api/_middleware/reason.ts), so the audit trail keeps the words as typed.
 *
 * A reason of printable ASCII alone goes as it always went, unmarked: it is
 * already sendable, and the API reads an unmarked header as plain text.
 *
 * Every console save reaches the API through `apiFetch`, which runs its
 * headers through this, so no screen has to remember to.
 */

const REASON = 'x-reason';
const ENCODING = 'x-reason-encoding';

// Anything other than printable ASCII: Latin-1 letters the browser would
// send, line breaks it would refuse, and everything beyond.
const NEEDS_ENCODING = /[^\x20-\x7e]/;
// A lone half of a surrogate pair, which encodeURIComponent refuses to encode.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

function pairsOf(init: HeadersInit | undefined): [string, string][] {
  if (init === undefined) return [];
  if (init instanceof Headers) return [...init.entries()];
  if (Array.isArray(init)) return init.map(([name, value]) => [String(name), String(value)]);
  return Object.entries(init);
}

export function withSendableReason(init: HeadersInit | undefined): Headers {
  const headers = new Headers();
  let encoded = false;
  for (const [name, value] of pairsOf(init)) {
    if (name.toLowerCase() === REASON && NEEDS_ENCODING.test(value)) {
      headers.append(name, encodeURIComponent(value.replace(LONE_SURROGATE, '\ufffd')));
      encoded = true;
    } else {
      headers.append(name, value);
    }
  }
  if (encoded) headers.set(ENCODING, 'uri');
  return headers;
}
