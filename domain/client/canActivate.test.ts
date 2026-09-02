import { describe, expect, it } from 'vitest';
import { canActivate } from './canActivate';
import type {
  ClientRecord,
  ClientRecordConsent,
  ClientRecordContact,
  ClientRecordLocation,
} from './types';

const TODAY = '2026-09-02';
const ADULT_DOB = '1990-01-01';
const MINOR_DOB = '2015-01-01'; // eleven years old on TODAY

const CONSENTING_CONTACT: ClientRecordContact = {
  id: 'contact-1',
  relationship: 'self',
  isLegalGuardian: false,
  canConsent: true,
  userId: null,
  hasEmiratesId: false,
};

const VERIFIED_LOCATION: ClientRecordLocation = {
  id: 'location-1',
  emirate: 'DXB',
  hasVerifiedPin: true,
  label: 'home',
  isPrimary: true,
};

function consent(
  purpose: ClientRecordConsent['purpose'],
  overrides: Partial<ClientRecordConsent> = {},
): ClientRecordConsent {
  return {
    purpose,
    status: 'active',
    givenByContactId: 'contact-1',
    givenAt: '2026-01-01',
    expiresAt: null,
    ...overrides,
  };
}

function record(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    client: { id: 'client-1', status: 'lead', dateOfBirth: ADULT_DOB },
    contacts: [CONSENTING_CONTACT],
    locations: [VERIFIED_LOCATION],
    consents: [consent('participation'), consent('home_visit')],
    ...overrides,
  };
}

describe('canActivate', () => {
  it('activates when a date of birth, a verified location, a consenting contact and every required consent are present', () => {
    expect(canActivate(record(), TODAY)).toEqual({ ok: true, missing: [] });
  });

  it('is missing date_of_birth when it is not yet known', () => {
    const result = canActivate(
      record({ client: { id: 'client-1', status: 'lead', dateOfBirth: null } }),
      TODAY,
    );
    expect(result).toEqual({ ok: false, missing: ['date_of_birth'] });
  });

  it('is missing verified_location when no location has a verified pin', () => {
    expect(
      canActivate(record({ locations: [{ ...VERIFIED_LOCATION, hasVerifiedPin: false }] }), TODAY),
    ).toEqual({ ok: false, missing: ['verified_location'] });
    expect(canActivate(record({ locations: [] }), TODAY)).toEqual({
      ok: false,
      missing: ['verified_location'],
    });
  });

  it('is missing consenting_contact when no contact may consent', () => {
    expect(
      canActivate(record({ contacts: [{ ...CONSENTING_CONTACT, canConsent: false }] }), TODAY),
    ).toEqual({ ok: false, missing: ['consenting_contact'] });
    expect(canActivate(record({ contacts: [] }), TODAY)).toEqual({
      ok: false,
      missing: ['consenting_contact'],
    });
  });

  it('is missing consent:participation when that consent is absent', () => {
    expect(canActivate(record({ consents: [consent('home_visit')] }), TODAY)).toEqual({
      ok: false,
      missing: ['consent:participation'],
    });
  });

  it('is missing consent:home_visit only when the delivery includes a home visit', () => {
    const consentsWithoutHomeVisit = { consents: [consent('participation')] };
    expect(canActivate(record(consentsWithoutHomeVisit), TODAY)).toEqual({
      ok: false,
      missing: ['consent:home_visit'],
    });
    // A remote-only delivery never needs home_visit consent.
    expect(canActivate(record(consentsWithoutHomeVisit), TODAY, ['remote'])).toEqual({
      ok: true,
      missing: [],
    });
  });

  it('is missing consent:minor_participation for a minor who lacks it, and not for an adult', () => {
    const minor = record({
      client: { id: 'client-1', status: 'lead', dateOfBirth: MINOR_DOB },
    });
    expect(canActivate(minor, TODAY)).toEqual({
      ok: false,
      missing: ['consent:minor_participation'],
    });
    expect(
      canActivate(
        { ...minor, consents: [...minor.consents, consent('minor_participation')] },
        TODAY,
      ),
    ).toEqual({ ok: true, missing: [] });
  });

  it('treats a withdrawn, expired or superseded consent as not active', () => {
    for (const status of ['withdrawn', 'expired', 'superseded'] as const) {
      expect(
        canActivate(
          record({ consents: [consent('participation', { status }), consent('home_visit')] }),
          TODAY,
        ),
      ).toEqual({ ok: false, missing: ['consent:participation'] });
    }
  });

  it('treats a consent expiring before or on today as not active, and after today as active', () => {
    const beforeToday = record({
      consents: [consent('participation', { expiresAt: '2026-09-01' }), consent('home_visit')],
    });
    expect(canActivate(beforeToday, TODAY)).toEqual({
      ok: false,
      missing: ['consent:participation'],
    });

    const onToday = record({
      consents: [consent('participation', { expiresAt: TODAY }), consent('home_visit')],
    });
    expect(canActivate(onToday, TODAY)).toEqual({ ok: false, missing: ['consent:participation'] });

    const afterToday = record({
      consents: [consent('participation', { expiresAt: '2026-09-03' }), consent('home_visit')],
    });
    expect(canActivate(afterToday, TODAY)).toEqual({ ok: true, missing: [] });
  });

  it('treats a null expiry as never expiring', () => {
    const neverExpires = record({
      consents: [consent('participation', { expiresAt: null }), consent('home_visit')],
    });
    expect(canActivate(neverExpires, TODAY)).toEqual({ ok: true, missing: [] });
  });

  it('lists every missing condition, in a stable order', () => {
    const bare = record({
      client: { id: 'client-1', status: 'lead', dateOfBirth: null },
      contacts: [],
      locations: [],
      consents: [],
    });
    expect(canActivate(bare, TODAY)).toEqual({
      ok: false,
      missing: [
        'date_of_birth',
        'verified_location',
        'consenting_contact',
        'consent:home_visit',
        'consent:participation',
      ],
    });
  });
});
