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
