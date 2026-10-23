import { describe, expect, it } from 'vitest';
import { reversibleFor } from './reversal';

/**
 * The specification for reversing a payment recorded in error
 * (docs/superpowers/specs/2026-10-23-payment-reversal-design.md).
 */
describe('reversibleFor', () => {
  it('allows a payment that has not been reversed, for a client on record', () => {
    expect(reversibleFor({ reversed: false, clientErased: false })).toEqual({ ok: true });
  });

  it('refuses a payment that has already been reversed', () => {
    expect(reversibleFor({ reversed: true, clientErased: false })).toEqual({
      ok: false,
      refusal: 'already_reversed',
    });
  });

  it("refuses an erased client's payment", () => {
    expect(reversibleFor({ reversed: false, clientErased: true })).toEqual({
      ok: false,
      refusal: 'client_erased',
    });
  });

  it('names the erased client first when both refusals apply', () => {
    expect(reversibleFor({ reversed: true, clientErased: true })).toEqual({
      ok: false,
      refusal: 'client_erased',
    });
  });
});
