import { describe, expect, it } from 'vitest';
import { voidFunctionRefusal } from './void';

/**
 * `app.void_recorded_session` (migration 969) refuses with
 * `restrict_violation` and the code as its message; the route maps the
 * message and never the sentence, and anything it does not recognise is not
 * a refusal of the void's, so it is rethrown by the caller.
 */
describe('voidFunctionRefusal', () => {
  it('reads a known code off a restrict_violation', () => {
    for (const code of [
      'wrong_role',
      'reason_required',
      'not_found',
      'not_a_records_row',
      'not_completed',
      'already_voided',
      'session_in_use',
    ]) {
      expect(voidFunctionRefusal({ code: '23001', message: code })).toBe(code);
    }
  });

  it('answers null for a restrict_violation whose message is not one of its codes', () => {
    expect(
      voidFunctionRefusal({
        code: '23001',
        message: 'session 1 is closed and cannot be changed; correct it with a new version',
      }),
    ).toBeNull();
    expect(voidFunctionRefusal({ code: '23001', message: 'void_needs_the_function' })).toBeNull();
    expect(voidFunctionRefusal({ code: '23001' })).toBeNull();
  });

  it('answers null for any other SQLSTATE, even carrying a known code', () => {
    expect(voidFunctionRefusal({ code: '23P01', message: 'already_voided' })).toBeNull();
    expect(voidFunctionRefusal({ code: '42501', message: 'wrong_role' })).toBeNull();
    expect(voidFunctionRefusal(new Error('already_voided'))).toBeNull();
  });
});
