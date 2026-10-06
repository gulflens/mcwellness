import { describe, expect, it } from 'vitest';
import { canActivate, consentsOutstanding } from './canActivate';
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
};

const LEGAL_GUARDIAN_CONTACT: ClientRecordContact = {
  id: 'contact-1',
  relationship: 'mother',
  isLegalGuardian: true,
  canConsent: true,
  userId: null,
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
    consents: [consent('health_data'), consent('participation'), consent('home_visit')],
    ...overrides,
  };
}

/** A minor's record: same shape as `record`, but with a legal guardian as the default contact. */
function minorRecord(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return record({
    client: { id: 'client-1', status: 'lead', dateOfBirth: MINOR_DOB },
    contacts: [LEGAL_GUARDIAN_CONTACT],
    ...overrides,
  });
}

describe('canActivate', () => {
  it('activates when a date of birth, a verified location, a consenting contact and every required consent are present', () => {
    expect(canActivate(record())).toEqual({ ok: true, missing: [] });
  });

  it('activates a lead before any consent is signed, which is signed at the first visit', () => {
    // The practice's request of 29 September 2026, approved by the operator on
    // 6 October: the household signs when the practitioner meets them, so a
    // lead becomes active and can be booked without it. The check-in still
    // refuses a visit until the consents are signed (domain/session canCheckIn).
    expect(canActivate(record({ consents: [] }))).toEqual({ ok: true, missing: [] });
  });

  it('is missing date_of_birth when it is not yet known', () => {
    const result = canActivate(
      record({ client: { id: 'client-1', status: 'lead', dateOfBirth: null } }),
    );
    expect(result).toEqual({ ok: false, missing: ['date_of_birth'] });
  });

  it('is missing verified_location when no location has a verified pin', () => {
    expect(
      canActivate(record({ locations: [{ ...VERIFIED_LOCATION, hasVerifiedPin: false }] })),
    ).toEqual({ ok: false, missing: ['verified_location'] });
    expect(canActivate(record({ locations: [] }))).toEqual({
      ok: false,
      missing: ['verified_location'],
    });
  });

  it('is missing consenting_contact when no contact may consent', () => {
    expect(
      canActivate(record({ contacts: [{ ...CONSENTING_CONTACT, canConsent: false }] })),
    ).toEqual({ ok: false, missing: ['consenting_contact'] });
    expect(canActivate(record({ contacts: [] }))).toEqual({
      ok: false,
      missing: ['consenting_contact'],
    });
  });
});

describe('consentsOutstanding: what the household signs at the first visit', () => {
  it('is missing consent:health_data when the household has not agreed to it', () => {
    // Every other condition met. A household that has agreed to take part has
    // not thereby agreed to the practice holding what their brain is doing:
    // the advisor asked for that to be a separate yes, so it separately gates.
    expect(
      consentsOutstanding(
        record({ consents: [consent('participation'), consent('home_visit')] }),
        TODAY,
      ),
    ).toEqual({ ok: false, missing: ['consent:health_data'] });
  });

  it('is missing consent:participation when that consent is absent', () => {
    expect(
      consentsOutstanding(
        record({ consents: [consent('health_data'), consent('home_visit')] }),
        TODAY,
      ),
    ).toEqual({
      ok: false,
      missing: ['consent:participation'],
    });
  });

  it('is missing consent:home_visit only when the delivery includes a home visit', () => {
    const consentsWithoutHomeVisit = {
      consents: [consent('health_data'), consent('participation')],
    };
    expect(consentsOutstanding(record(consentsWithoutHomeVisit), TODAY)).toEqual({
      ok: false,
      missing: ['consent:home_visit'],
    });
    // A remote-only delivery never needs home_visit consent.
    expect(consentsOutstanding(record(consentsWithoutHomeVisit), TODAY, ['remote'])).toEqual({
      ok: true,
      missing: [],
    });
  });

  it('is missing consent:minor_participation for a minor who lacks it, and not for an adult', () => {
    expect(consentsOutstanding(minorRecord(), TODAY)).toEqual({
      ok: false,
      missing: ['consent:minor_participation'],
    });
    // The adult baseline above never asks for it at all: 'activates when...' covers that.
  });

  it('satisfies consent:minor_participation when it was given by a legal guardian who may consent', () => {
    const minor = minorRecord();
    const withGuardianConsent: ClientRecord = {
      ...minor,
      consents: [
        ...minor.consents,
        consent('minor_participation', { givenByContactId: LEGAL_GUARDIAN_CONTACT.id }),
      ],
    };
    expect(consentsOutstanding(withGuardianConsent, TODAY)).toEqual({ ok: true, missing: [] });
  });

  it('does not satisfy consent:minor_participation when it was given by a contact who is not a legal guardian', () => {
    const notAGuardian: ClientRecordContact = {
      id: 'contact-2',
      relationship: 'other',
      isLegalGuardian: false,
      canConsent: true,
      userId: null,
    };
    const minor = minorRecord({ contacts: [LEGAL_GUARDIAN_CONTACT, notAGuardian] });
    const withNonGuardianConsent: ClientRecord = {
      ...minor,
      consents: [
        ...minor.consents,
        consent('minor_participation', { givenByContactId: notAGuardian.id }),
      ],
    };
    expect(consentsOutstanding(withNonGuardianConsent, TODAY)).toEqual({
      ok: false,
      missing: ['consent:minor_participation'],
    });
  });

  it('does not satisfy consent:minor_participation when the guardian who gave it may no longer consent', () => {
    const guardianWithoutConsentRight: ClientRecordContact = {
      id: 'contact-2',
      relationship: 'father',
      isLegalGuardian: true,
      canConsent: false,
      userId: null,
    };
    const minor = minorRecord({ contacts: [LEGAL_GUARDIAN_CONTACT, guardianWithoutConsentRight] });
    const withConsent: ClientRecord = {
      ...minor,
      consents: [
        ...minor.consents,
        consent('minor_participation', { givenByContactId: guardianWithoutConsentRight.id }),
      ],
    };
    expect(consentsOutstanding(withConsent, TODAY)).toEqual({
      ok: false,
      missing: ['consent:minor_participation'],
    });
  });

  it('does not satisfy consent:minor_participation when it names a contact that does not exist on the record', () => {
    const minor = minorRecord();
    const withDanglingConsent: ClientRecord = {
      ...minor,
      consents: [
        ...minor.consents,
        consent('minor_participation', { givenByContactId: 'no-such-contact' }),
      ],
    };
    expect(consentsOutstanding(withDanglingConsent, TODAY)).toEqual({
      ok: false,
      missing: ['consent:minor_participation'],
    });
  });

  it('treats a withdrawn, expired or superseded consent as not active', () => {
    for (const status of ['withdrawn', 'expired', 'superseded'] as const) {
      expect(
        consentsOutstanding(
          record({
            consents: [
              consent('health_data'),
              consent('participation', { status }),
              consent('home_visit'),
            ],
          }),
          TODAY,
        ),
      ).toEqual({ ok: false, missing: ['consent:participation'] });
    }
  });

  it('treats a consent expiring before or on today as not active, and after today as active', () => {
    const beforeToday = record({
      consents: [
        consent('health_data'),
        consent('participation', { expiresAt: '2026-09-01' }),
        consent('home_visit'),
      ],
    });
    expect(consentsOutstanding(beforeToday, TODAY)).toEqual({
      ok: false,
      missing: ['consent:participation'],
    });

    const onToday = record({
      consents: [
        consent('health_data'),
        consent('participation', { expiresAt: TODAY }),
        consent('home_visit'),
      ],
    });
    expect(consentsOutstanding(onToday, TODAY)).toEqual({
      ok: false,
      missing: ['consent:participation'],
    });

    const afterToday = record({
      consents: [
        consent('health_data'),
        consent('participation', { expiresAt: '2026-09-03' }),
        consent('home_visit'),
      ],
    });
    expect(consentsOutstanding(afterToday, TODAY)).toEqual({ ok: true, missing: [] });
  });

  it('treats a null expiry as never expiring', () => {
    const neverExpires = record({
      consents: [
        consent('health_data'),
        consent('participation', { expiresAt: null }),
        consent('home_visit'),
      ],
    });
    expect(consentsOutstanding(neverExpires, TODAY)).toEqual({ ok: true, missing: [] });
  });

  it('lists every consent still to sign, in a stable order', () => {
    const bare = record({ consents: [] });
    expect(consentsOutstanding(bare, TODAY)).toEqual({
      ok: false,
      missing: ['consent:health_data', 'consent:home_visit', 'consent:participation'],
    });
  });
});

describe('canActivate, with nothing on the record', () => {
  it('lists every missing condition, in a stable order, and no consent among them', () => {
    const bare = record({
      client: { id: 'client-1', status: 'lead', dateOfBirth: null },
      contacts: [],
      locations: [],
      consents: [],
    });
    expect(canActivate(bare)).toEqual({
      ok: false,
      missing: ['date_of_birth', 'verified_location', 'consenting_contact'],
    });
  });
});
