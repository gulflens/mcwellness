import { describe, expect, it } from 'vitest';
import { BODY_LIMIT_BYTES } from '../create-api';
import {
  DOCUMENT_ENVELOPE_ALLOWANCE_BYTES,
  MAX_DOCUMENT_BASE64_LENGTH,
  MAX_DOCUMENT_BYTES,
} from './record-schema';

/**
 * The one place the document cap and the API's own body cap are compared.
 *
 * `MAX_DOCUMENT_BYTES` is written as a number rather than derived from
 * `BODY_LIMIT_BYTES`, because deriving it would make `record-schema.ts` —
 * which the browser imports — depend on `create-api.ts`, which imports every
 * route, which imports `record-schema.ts` back. So the relationship is pinned
 * here instead: this file is the only one that imports both, and it fails if
 * either constant moves without the other.
 *
 * `BODY_LIMIT_BYTES` is the shared zone's (docs/SPEC/OWNERSHIP.md). If the
 * trunk raises it, this test does not break — a larger envelope simply leaves
 * more room than the cap uses — and
 * docs/CHANGE-REQUESTS/client-record-03.md asks for exactly that, with the
 * matching change to `MAX_DOCUMENT_BYTES`.
 */

describe('the document cap against the API body cap', () => {
  it('leaves a base64 payload and its envelope inside the body limit', () => {
    expect(MAX_DOCUMENT_BASE64_LENGTH + DOCUMENT_ENVELOPE_ALLOWANCE_BYTES).toBeLessThanOrEqual(
      BODY_LIMIT_BYTES,
    );
  });

  it('allows enough room to be worth having', () => {
    // Below this a signature drawn on screen would not reliably fit, and the
    // cap would be refusing the one thing it exists to carry.
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThanOrEqual(32 * 1024);
  });

  it('states the base64 length its byte cap implies', () => {
    // Four characters per three bytes, rounded up to a whole group.
    expect(MAX_DOCUMENT_BASE64_LENGTH).toBe(Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4);
  });
});
