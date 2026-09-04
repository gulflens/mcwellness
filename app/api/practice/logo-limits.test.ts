import { describe, expect, it } from 'vitest';
import { BODY_LIMIT_BYTES, LOGO_BODY_LIMIT_BYTES } from '../create-api';
import { LOGO_ENVELOPE_ALLOWANCE_BYTES, MAX_LOGO_BASE64_LENGTH, MAX_LOGO_BYTES } from './schema';

/**
 * The one place the logo cap and the envelope it travels in are compared.
 *
 * Every body on this API is JSON and capped, and the logo is the single route
 * with a cap of its own: 64 KiB is right for a form and wrong for a file, and
 * raising the floor for everything to carry one image would be the cheap
 * change and the wrong one. So the exception is written down here, where it
 * fails if either constant moves without the other.
 */

describe('the practice logo against the API body caps', () => {
  it('gives the logo route enough room for its own cap, base64 and all', () => {
    expect(LOGO_BODY_LIMIT_BYTES).toBeGreaterThanOrEqual(
      MAX_LOGO_BASE64_LENGTH + LOGO_ENVELOPE_ALLOWANCE_BYTES,
    );
  });

  it('states the base64 length its byte cap implies', () => {
    // Four characters per three bytes, rounded up to a whole group.
    expect(MAX_LOGO_BASE64_LENGTH).toBe(Math.ceil(MAX_LOGO_BYTES / 3) * 4);
  });

  it('is an exception rather than a new floor: every other route keeps 64 KiB', () => {
    expect(BODY_LIMIT_BYTES).toBe(64 * 1024);
    expect(LOGO_BODY_LIMIT_BYTES).toBeGreaterThan(BODY_LIMIT_BYTES);
  });

  it('holds the logo to half a megabyte, which is a mark and not a photograph', () => {
    expect(MAX_LOGO_BYTES).toBe(512 * 1024);
  });
});
