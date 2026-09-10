import type { IsoDate } from '../shared/actor';
import { isMinor } from './isMinor';
import type { ClientRecord, DeliveryMode, RequiredConsentPurpose } from './types';

/**
 * The consents `canActivate` must find active (docs/SPEC/client-record.md rule 3):
 * participation and health_data always; minor_participation only while the client
 * is a minor on `atDate`; home_visit only when the delivery includes a home visit.
 * Sorted so the result is deterministic regardless of the order these conditions
 * were checked in.
 *
 * `health_data` is unconditional because every client is trained on their own
 * brain activity: there is no shape of engagement where the practice holds no
 * health information, so there is none where a household has not been asked
 * about it specifically.
 */
export function requiredConsents(
  record: ClientRecord,
  deliveryModes: readonly DeliveryMode[],
  atDate: IsoDate,
): RequiredConsentPurpose[] {
  const purposes: RequiredConsentPurpose[] = ['participation', 'health_data'];

  const { dateOfBirth } = record.client;
  if (dateOfBirth !== null && isMinor(dateOfBirth, atDate)) {
    purposes.push('minor_participation');
  }

  if (deliveryModes.includes('home')) {
    purposes.push('home_visit');
  }

  return purposes.sort();
}

/**
 * The same question, answered from a client's date of birth alone.
 *
 * `requiredConsents` takes a full `ClientRecord` because `canActivate` reads
 * the rest of it for its own three other gates. A caller that only needs the
 * list of purposes — the bundle route (`POST /api/clients/:id/consents/bundle`
 * in app/api/clients/consents.ts) and the Consent tab
 * (app/admin/clients/ConsentTab.tsx) among them — has no contacts, locations
 * or consent history to hand and no business inventing empty ones just to
 * satisfy the wider shape. This delegates to `requiredConsents` itself rather
 * than repeating its rule, so the two can never drift.
 */
export function requiredConsentsFor(
  client: { dateOfBirth: IsoDate | null },
  deliveryModes: readonly DeliveryMode[],
  atDate: IsoDate,
): RequiredConsentPurpose[] {
  return requiredConsents(
    {
      client: { id: '', status: 'lead', dateOfBirth: client.dateOfBirth },
      contacts: [],
      locations: [],
      consents: [],
    },
    deliveryModes,
    atDate,
  );
}
