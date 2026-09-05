import { describe, expect, it } from 'vitest';
import { canSupersede, MAX_SUPERSEDE_REASON, nextVersion } from './canSupersede';

/**
 * Rule 4a (docs/SPEC/reports-v1.md sections 8 and 11), including the chain
 * three versions deep section 11 names.
 */

const REASON = 'The visit date was written as the day the note was typed.';

describe('canSupersede', () => {
  it('admits a supersede of the standing issued version, with its reason trimmed', () => {
    expect(canSupersede({ status: 'issued', version: 1 }, `  ${REASON}  `)).toEqual({
      ok: true,
      reason: REASON,
    });
  });

  it('refuses a draft: a draft is edited, not superseded', () => {
    expect(canSupersede({ status: 'draft', version: 1 }, REASON)).toEqual({
      ok: false,
      code: 'not_issued',
    });
  });

  it('refuses a version that has already been superseded', () => {
    expect(canSupersede({ status: 'superseded', version: 1 }, REASON)).toEqual({
      ok: false,
      code: 'already_superseded',
    });
  });

  it('refuses a supersede with no reason', () => {
    expect(canSupersede({ status: 'issued', version: 1 }, '')).toEqual({
      ok: false,
      code: 'no_reason',
    });
  });

  it('refuses a reason that is only whitespace, and one too short to be one', () => {
    expect(canSupersede({ status: 'issued', version: 1 }, '     ')).toEqual({
      ok: false,
      code: 'no_reason',
    });
    expect(canSupersede({ status: 'issued', version: 1 }, 'typo')).toEqual({
      ok: false,
      code: 'no_reason',
    });
  });

  it('caps a reason long enough to be a document of its own', () => {
    const answer = canSupersede({ status: 'issued', version: 1 }, 'r'.repeat(2000));
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.reason).toHaveLength(MAX_SUPERSEDE_REASON);
  });

  it('follows a chain three versions deep, refusing every version but the standing one', () => {
    // Version 1 was issued and corrected; version 2 was issued and corrected;
    // version 3 stands. Only the third may be superseded, and the next one it
    // would make is version 4.
    const first = { status: 'superseded' as const, version: 1 };
    const second = { status: 'superseded' as const, version: 2 };
    const third = { status: 'issued' as const, version: 3 };

    expect(canSupersede(first, REASON)).toEqual({ ok: false, code: 'already_superseded' });
    expect(canSupersede(second, REASON)).toEqual({ ok: false, code: 'already_superseded' });
    expect(canSupersede(third, REASON)).toEqual({ ok: true, reason: REASON });
    expect(nextVersion(third)).toBe(4);
  });
});

describe('nextVersion', () => {
  it('is one more than the version it corrects', () => {
    expect(nextVersion({ status: 'issued', version: 1 })).toBe(2);
    expect(nextVersion({ status: 'issued', version: 9 })).toBe(10);
  });
});
