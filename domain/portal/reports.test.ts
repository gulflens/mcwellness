import { describe, expect, it } from 'vitest';
import { reportsVisibleTo } from './reports';

/**
 * docs/SPEC/reports-v1.md section 7.3, as the operator amended it on
 * 2026-09-06. The boundary day is the case that matters and
 * `tests/reports/db/portal.test.ts` asks the database the same question.
 */

const BIRTHDAY = '2008-09-05';
const guardian = { relationship: 'mother', isLegalGuardian: true };
const own = { relationship: 'self', isLegalGuardian: false };

describe('reportsVisibleTo', () => {
  it('shows a report to a legal guardian, whoever they are to the child', () => {
    for (const relationship of ['mother', 'father', 'guardian', 'other']) {
      expect(
        reportsVisibleTo(
          { relationship, isLegalGuardian: true },
          { dateOfBirth: '2016-01-01' },
          '2026-09-05',
        ),
      ).toBe(true);
    }
  });

  it("hides it from a young person's own login", () => {
    expect(reportsVisibleTo(own, { dateOfBirth: '2016-01-01' }, '2026-09-05')).toBe(false);
  });

  it('hides it from a contact who is on the record and is not a guardian', () => {
    // A spouse or a relative who pays: money is the household's, a report is
    // not. This is where it differs from moneyVisibleTo beside it.
    for (const relationship of ['spouse', 'other', 'mother']) {
      expect(
        reportsVisibleTo(
          { relationship, isLegalGuardian: false },
          { dateOfBirth: '2016-01-01' },
          '2026-09-05',
        ),
      ).toBe(false);
    }
  });

  it('hides it on the day before the eighteenth birthday', () => {
    expect(reportsVisibleTo(own, { dateOfBirth: BIRTHDAY }, '2026-09-04')).toBe(false);
  });

  it('shows it on the eighteenth birthday itself', () => {
    expect(reportsVisibleTo(own, { dateOfBirth: BIRTHDAY }, '2026-09-05')).toBe(true);
  });

  it('treats a client with no date of birth as an adult', () => {
    expect(reportsVisibleTo(own, { dateOfBirth: null }, '2026-09-05')).toBe(true);
  });

  it('shows a guardian a report about an adult they look after', () => {
    expect(reportsVisibleTo(guardian, { dateOfBirth: BIRTHDAY }, '2026-09-05')).toBe(true);
  });
});
