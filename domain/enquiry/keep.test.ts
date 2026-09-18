import { describe, expect, it } from 'vitest';
import { carriesAPerson, dismissalKeeps, isMarketable, noticeOf } from './keep';

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

  it('is a person who ticked, is still on the row, and has not become a client', () => {
    expect(isMarketable({ ...asked, status: 'new' })).toBe(true);
    expect(isMarketable({ ...asked, status: 'dismissed' })).toBe(true);
  });

  it('is nobody who did not tick, was never asked, or has been erased', () => {
    expect(isMarketable({ ...asked, status: 'new', marketingOptIn: false })).toBe(false);
    expect(isMarketable({ ...asked, status: 'new', marketingOptIn: null })).toBe(false);
    expect(isMarketable({ ...asked, status: 'dismissed', name: null })).toBe(false);
    // A lead's consents are the client record's own documents, not an enquiry form's tick.
    expect(isMarketable({ ...asked, status: 'converted' })).toBe(false);
  });
});
