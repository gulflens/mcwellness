import { describe, expect, it } from 'vitest';
import { moneyVisibleTo } from './money';

/**
 * docs/SPEC/client-portal.md section 5, rule 5. The boundary day is the case
 * that matters and tests/portal/db/money_visibility.test.ts asks the database
 * the identical question on the identical dates.
 */

const BIRTHDAY = '2008-09-05';

describe('moneyVisibleTo', () => {
  it('shows the money to a parent of a child', () => {
    expect(
      moneyVisibleTo({ relationship: 'mother' }, { dateOfBirth: '2016-01-01' }, '2026-09-05'),
    ).toBe(true);
  });

  it('shows the money to a guardian and to a spouse', () => {
    for (const relationship of ['guardian', 'spouse', 'father', 'other']) {
      expect(moneyVisibleTo({ relationship }, { dateOfBirth: '2016-01-01' }, '2026-09-05')).toBe(
        true,
      );
    }
  });

  it("hides the money from a young person's own login", () => {
    expect(
      moneyVisibleTo({ relationship: 'self' }, { dateOfBirth: '2016-01-01' }, '2026-09-05'),
    ).toBe(false);
  });

  it('hides it on the day before the eighteenth birthday', () => {
    expect(moneyVisibleTo({ relationship: 'self' }, { dateOfBirth: BIRTHDAY }, '2026-09-04')).toBe(
      false,
    );
  });

  it('shows it on the eighteenth birthday itself', () => {
    expect(moneyVisibleTo({ relationship: 'self' }, { dateOfBirth: BIRTHDAY }, '2026-09-05')).toBe(
      true,
    );
  });

  it('treats a client with no date of birth as an adult', () => {
    expect(moneyVisibleTo({ relationship: 'self' }, { dateOfBirth: null }, '2026-09-05')).toBe(
      true,
    );
  });
});
