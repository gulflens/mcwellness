import type { IsoDate } from '../shared/actor';
import { requiredConsents } from './requiredConsents';
import type { ClientRecord, ClientRecordConsent, DeliveryMode } from './types';

export type Missing =
  | 'date_of_birth'
  | 'verified_location'
  | 'consenting_contact'
  | 'consent:participation'
  | 'consent:minor_participation'
  | 'consent:home_visit';

const DEFAULT_DELIVERY_MODES: readonly DeliveryMode[] = ['home'];

/** Active on `today`: status active, and either it never expires or its expiry is after today. */
function isActiveOn(consent: ClientRecordConsent, today: IsoDate): boolean {
  return consent.status === 'active' && (consent.expiresAt === null || consent.expiresAt > today);
}

/**
 * Whether `consent` was given by a contact who may actually give it on a
 * minor's behalf: a legal guardian who may consent. A minor_participation
 * consent recorded against anyone else — a sibling, an unrelated contact, a
 * guardian whose own consenting right has since been withdrawn — does not
 * satisfy the gate, even if the consent row itself is active.
 */
function isGivenByLegalGuardian(record: ClientRecord, consent: ClientRecordConsent): boolean {
  const givenBy = record.contacts.find((contact) => contact.id === consent.givenByContactId);
  return givenBy !== undefined && givenBy.isLegalGuardian && givenBy.canConsent;
}

/**
 * The lead → active gate (docs/SPEC/client-record.md rule 1, section 3): a
 * date of birth, at least one location with a verified pin, at least one
 * contact who may consent, and every consent `requiredConsents` names active
 * on `today`. A minor_participation consent additionally has to have been
 * given by a legal guardian who may consent — the point of the consent is
 * that a guardian gave it, so a technically-active row given by the wrong
 * contact does not satisfy the gate. Delivery defaults to home, since that
 * is what drives the practice today; a caller planning a remote-only
 * programme passes its own modes. This is a gate for the activation action
 * itself — it does not read or judge `record.client.status`, so it answers
 * the same for a lead as it would for a record whose status has already
 * moved.
 */
export function canActivate(
  record: ClientRecord,
  today: IsoDate,
  deliveryModes: readonly DeliveryMode[] = DEFAULT_DELIVERY_MODES,
): { ok: boolean; missing: Missing[] } {
  const missing: Missing[] = [];

  if (record.client.dateOfBirth === null) {
    missing.push('date_of_birth');
  }
  if (!record.locations.some((location) => location.hasVerifiedPin)) {
    missing.push('verified_location');
  }
  if (!record.contacts.some((contact) => contact.canConsent)) {
    missing.push('consenting_contact');
  }

  for (const purpose of requiredConsents(record, deliveryModes, today)) {
    const satisfied = record.consents.some(
      (consent) =>
        consent.purpose === purpose &&
        isActiveOn(consent, today) &&
        (purpose !== 'minor_participation' || isGivenByLegalGuardian(record, consent)),
    );
    if (!satisfied) {
      missing.push(`consent:${purpose}`);
    }
  }

  return { ok: missing.length === 0, missing };
}
