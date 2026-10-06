import { describe, expect, it } from 'vitest';
import {
  marketingConsentOfferedTo,
  marketingStanding,
  type MarketingConsentRow,
} from './marketing';

/**
 * The marketing consent on the household's own portal (the push memo's
 * decision 1, docs/OPERATOR/2026-09-17-push-notifications.md, answered "as
 * recommended" on 6 October 2026; docs/CONSENT/marketing.en.md).
 *
 * Ids in the reserved shape; nothing here names a person.
 */

const TODAY = '2026-10-06';

const MOTHER = { relationship: 'mother', dateOfBirth: '2014-09-05' };
const ADULT_SELF = { relationship: 'self', dateOfBirth: '1990-01-01' };
const MINOR_SELF = { relationship: 'self', dateOfBirth: '2014-09-05' };

const IDS = {
  a: '00000001-0000-4000-8000-0000000000d1',
  b: '00000001-0000-4000-8000-0000000000d2',
  c: '00000001-0000-4000-8000-0000000000d3',
  wording: '00000001-0000-4000-8000-0000000000d9',
} as const;

function row(overrides: Partial<MarketingConsentRow> = {}): MarketingConsentRow {
  return {
    id: IDS.a,
    status: 'active',
    givenAt: '2026-10-02T09:00:00.000Z',
    withdrawnAt: null,
    wordingId: IDS.wording,
    ...overrides,
  };
}

describe('marketingConsentOfferedTo', () => {
  it('offers the switch to a parent', () => {
    expect(marketingConsentOfferedTo([MOTHER], TODAY)).toBe(true);
  });

  it('offers the switch to an adult who is their own contact', () => {
    expect(marketingConsentOfferedTo([ADULT_SELF], TODAY)).toBe(true);
  });

  it("never offers it to a young person's own login", () => {
    expect(marketingConsentOfferedTo([MINOR_SELF], TODAY)).toBe(false);
  });

  it("never offers it to a login that is a young person's own on any record", () => {
    expect(marketingConsentOfferedTo([MOTHER, MINOR_SELF], TODAY)).toBe(false);
  });

  it('offers nothing to a person who is nobody’s contact', () => {
    expect(marketingConsentOfferedTo([], TODAY)).toBe(false);
  });

  it('offers it on the eighteenth birthday, in the practice’s own day', () => {
    const turning = { relationship: 'self', dateOfBirth: '2008-10-06' };
    expect(marketingConsentOfferedTo([turning], '2026-10-05')).toBe(false);
    expect(marketingConsentOfferedTo([turning], '2026-10-06')).toBe(true);
  });
});

describe('marketingStanding', () => {
  it('is never when nothing has been given', () => {
    expect(marketingStanding([])).toEqual({ state: 'never', since: null, consentIds: [] });
  });

  it('is on when a consent stands, since it was given', () => {
    expect(marketingStanding([row()])).toEqual({
      state: 'on',
      since: '2026-10-02T09:00:00.000Z',
      consentIds: [IDS.a],
    });
  });

  it('is on across every record a parent is a contact of, and names each row', () => {
    const standing = marketingStanding([
      row(),
      row({ id: IDS.b, givenAt: '2026-10-02T09:00:00.000Z' }),
    ]);
    expect(standing.state).toBe('on');
    expect(standing.consentIds).toEqual([IDS.a, IDS.b]);
  });

  it('is off at once when the consent is withdrawn, since the withdrawal', () => {
    expect(
      marketingStanding([row({ status: 'withdrawn', withdrawnAt: '2026-10-05T18:00:00.000Z' })]),
    ).toEqual({ state: 'off', since: '2026-10-05T18:00:00.000Z', consentIds: [] });
  });

  it('is on again when it is given again after a withdrawal, since the newer giving', () => {
    const standing = marketingStanding([
      row({ status: 'withdrawn', withdrawnAt: '2026-10-03T18:00:00.000Z' }),
      row({ id: IDS.c, givenAt: '2026-10-04T10:00:00.000Z' }),
    ]);
    expect(standing).toEqual({
      state: 'on',
      since: '2026-10-04T10:00:00.000Z',
      consentIds: [IDS.c],
    });
  });

  it('reads an expired or superseded row as not standing', () => {
    expect(marketingStanding([row({ status: 'expired' })]).state).toBe('off');
    expect(marketingStanding([row({ status: 'superseded' })]).state).toBe('off');
  });
});
