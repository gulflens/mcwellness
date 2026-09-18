import { describe, expect, it } from 'vitest';
import {
  ENQUIRY_PAGE,
  ENQUIRY_STATUSES,
  enquiryCursor,
  readEnquiryListQuery,
  tallyEnquiries,
} from './list';

const ID = '0000000e-0000-4000-8000-000000000001';
const AT = '2026-10-14T11:20:05.123Z';

describe('readEnquiryListQuery', () => {
  it('reads nothing as the active enquiries from every source, from the top', () => {
    // What a screen built before the tabs asks for: it gets what is waiting,
    // which is the list it was for.
    expect(readEnquiryListQuery({})).toEqual({ status: 'new', source: null, before: null });
  });

  it('reads each status and each source by its own name', () => {
    for (const status of ENQUIRY_STATUSES) {
      expect(readEnquiryListQuery({ status })?.status).toBe(status);
    }
    expect(readEnquiryListQuery({ status: 'dismissed', source: 'expo' })).toEqual({
      status: 'dismissed',
      source: 'expo',
      before: null,
    });
    expect(readEnquiryListQuery({ source: 'all' })?.source).toBeNull();
  });

  it('refuses a status or a source it does not know, rather than guessing', () => {
    expect(readEnquiryListQuery({ status: 'archived' })).toBeNull();
    expect(readEnquiryListQuery({ status: '' })).toBeNull();
    expect(readEnquiryListQuery({ source: 'billboard' })).toBeNull();
  });

  it('reads back the cursor it wrote, and refuses one it did not', () => {
    const before = enquiryCursor({ receivedAt: AT, id: ID });
    expect(readEnquiryListQuery({ status: 'dismissed', before })?.before).toEqual({
      receivedAt: AT,
      id: ID,
    });
    for (const bad of ['', 'yesterday', `${AT}_not-a-uuid`, `not-a-time_${ID}`, `${AT}_${ID}_x`]) {
      expect(readEnquiryListQuery({ before: bad })).toBeNull();
    }
    // A date the calendar does not have. V8 reads 30 February as 2 March and
    // says nothing; the database refuses it outright, which from here would be
    // a server error for what is only a bad address. So it is refused here.
    for (const never of ['2026-02-30T00:00:00Z', '2026-04-31T00:00:00Z', '0000-01-01T00:00:00Z']) {
      expect(readEnquiryListQuery({ before: `${never}_${ID}` })).toBeNull();
    }
    // And a real one, to the microsecond the database keeps, is still read.
    expect(
      readEnquiryListQuery({ before: `2028-02-29T23:59:59.999999Z_${ID}` })?.before?.receivedAt,
    ).toBe('2028-02-29T23:59:59.999999Z');
    // Text for the database's own comparison, so it is a time and an id or it
    // is nothing: never a quote, never a second statement.
    expect(readEnquiryListQuery({ before: `${AT}'; drop table enquiry; --_${ID}` })).toBeNull();
  });
});

describe('enquiryCursor', () => {
  it('is the row’s own moment and id, so two lodged in one instant still have an order', () => {
    expect(enquiryCursor({ receivedAt: AT, id: ID })).toBe(`${AT}_${ID}`);
  });
});

describe('tallyEnquiries', () => {
  it('counts every status and source, and writes a nought where there is none', () => {
    const tally = tallyEnquiries([
      { status: 'new', source: 'expo', count: 40 },
      { status: 'new', source: 'website', count: 2 },
      { status: 'dismissed', source: 'expo', count: 310 },
    ]);
    expect(tally.new).toEqual({ all: 42, website: 2, discovery_call: 0, expo: 40 });
    expect(tally.dismissed).toEqual({ all: 310, website: 0, discovery_call: 0, expo: 310 });
    expect(tally.converted).toEqual({ all: 0, website: 0, discovery_call: 0, expo: 0 });
  });
});

describe('ENQUIRY_PAGE', () => {
  it('is a page a person can read, not the whole table', () => {
    expect(ENQUIRY_PAGE).toBe(100);
  });
});
