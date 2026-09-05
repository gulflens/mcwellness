import { describe, expect, it } from 'vitest';
import { canSupersede } from './canSupersede';
import { MAX_SUPERSEDE_REASON_LENGTH } from './types';

/**
 * Correcting a measurement (docs/SPEC/assessment.md section 5, rule 5; section
 * 11's "a supersede of a superseded row").
 */

const STANDS = { id: '0000000f-0000-4000-8000-000000000001', supersededById: null };
const REPLACED = {
  id: '0000000f-0000-4000-8000-000000000001',
  supersededById: '0000000f-0000-4000-8000-000000000002',
};

describe('correcting a measurement', () => {
  it('allows a new version of the one that stands, with a reason', () => {
    expect(canSupersede(STANDS, 'The alpha figure at Fz was typed from the wrong column.')).toEqual(
      { ok: true },
    );
  });

  it('refuses a supersede of a version already superseded', () => {
    expect(canSupersede(REPLACED, 'A reason.')).toEqual({
      ok: false,
      reason: 'already_superseded',
    });
  });

  it('refuses a supersede with no reason', () => {
    expect(canSupersede(STANDS, '')).toEqual({ ok: false, reason: 'reason_required' });
  });

  it('refuses a reason that is only spaces', () => {
    expect(canSupersede(STANDS, '   \n ')).toEqual({ ok: false, reason: 'reason_required' });
  });

  it('refuses a reason longer than the column holds', () => {
    expect(canSupersede(STANDS, 'r'.repeat(MAX_SUPERSEDE_REASON_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'reason_too_long',
    });
  });

  it('accepts a reason exactly as long as the column holds', () => {
    expect(canSupersede(STANDS, 'r'.repeat(MAX_SUPERSEDE_REASON_LENGTH))).toEqual({ ok: true });
  });

  it('asks whether it is superseded before it asks about the reason', () => {
    // A version that has already been corrected is not correctable whatever
    // the reason says, and the person should be told that rather than told to
    // write a better reason.
    expect(canSupersede(REPLACED, '')).toEqual({ ok: false, reason: 'already_superseded' });
  });
});
