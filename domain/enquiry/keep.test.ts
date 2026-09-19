import { describe, expect, it } from 'vitest';
import {
  KEPT_REVIEW_AFTER_DAYS,
  carriesAPerson,
  dismissalKeeps,
  isMarketable,
  keptReviewYears,
  noticeOf,
} from './keep';

describe('noticeOf', () => {
  it('takes a plain 2 for the second wording and everything else for the first', () => {
    expect(noticeOf('2')).toBe(2);
    expect(noticeOf(2)).toBe(2);
    // A form that does not say showed the earlier wording: the promise that keeps nothing.
    for (const other of [undefined, null, '', '1', 1, '3', 'two', '2.0', ' 2', true, {}]) {
      expect(noticeOf(other)).toBe(1);
    }
  });
});

describe('dismissalKeeps', () => {
  it('keeps a person who was told they would be kept, unless whoever dismisses chooses to erase', () => {
    expect(dismissalKeeps({ noticeVersion: 2, erase: false })).toBe(true);
    expect(dismissalKeeps({ noticeVersion: 2, erase: true })).toBe(false);
  });

  it('never keeps a person who was promised the enquiry keeps nothing, whatever was chosen', () => {
    expect(dismissalKeeps({ noticeVersion: 1, erase: false })).toBe(false);
    expect(dismissalKeeps({ noticeVersion: 1, erase: true })).toBe(false);
  });
});

describe('carriesAPerson', () => {
  it('is whether the row still has a name: a read of such a row is a read of somebody', () => {
    expect(carriesAPerson({ name: 'Hazel Harbour' })).toBe(true);
    expect(carriesAPerson({ name: null })).toBe(false);
  });
});

describe('isMarketable', () => {
  const asked = { name: 'Rowan Meadow', marketingOptIn: true as boolean | null };

  it('is a person who ticked, was dismissed, and is still on the row', () => {
    expect(isMarketable({ ...asked, status: 'dismissed' })).toBe(true);
  });

  it('is nobody the practice has not yet spoken to', () => {
    // The tick is whatever the form sent, and anybody can send the form with
    // somebody else's number. A waiting row is one no person has looked at; a
    // dismissed one has been, by somebody who could have erased it.
    expect(isMarketable({ ...asked, status: 'new' })).toBe(false);
  });

  it('is nobody who did not tick, was never asked, was erased, or became a client', () => {
    expect(isMarketable({ ...asked, status: 'dismissed', marketingOptIn: false })).toBe(false);
    expect(isMarketable({ ...asked, status: 'dismissed', marketingOptIn: null })).toBe(false);
    expect(isMarketable({ ...asked, status: 'dismissed', name: null })).toBe(false);
    // A lead's consents are the client record's own documents, not an enquiry form's tick.
    expect(isMarketable({ ...asked, status: 'converted' })).toBe(false);
  });
});

describe('keptReviewYears', () => {
  const now = new Date('2028-10-20T08:00:00.000Z');
  const kept = { status: 'dismissed' as const, name: 'Rowan Meadow' as string | null };

  it('is the whole years a kept person has been held, once that is two or more', () => {
    expect(KEPT_REVIEW_AFTER_DAYS).toBe(730);
    expect(keptReviewYears({ ...kept, receivedAt: '2026-10-14T11:20:00.000Z' }, now)).toBe(2);
    expect(keptReviewYears({ ...kept, receivedAt: '2025-01-02T00:00:00.000Z' }, now)).toBe(3);
  });

  it('is nothing before two years, and nothing for a row that holds nobody or still waits', () => {
    expect(keptReviewYears({ ...kept, receivedAt: '2026-10-21T08:00:01.000Z' }, now)).toBeNull();
    expect(
      keptReviewYears({ ...kept, name: null, receivedAt: '2020-01-01T00:00:00.000Z' }, now),
    ).toBeNull();
    // A waiting row has its own marker: how long it has waited.
    expect(
      keptReviewYears(
        { status: 'new', name: 'Iris Creek', receivedAt: '2020-01-01T00:00:00.000Z' },
        now,
      ),
    ).toBeNull();
  });
});
