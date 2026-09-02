import type { IsoDate } from '../shared/actor';
import { isMinor } from './isMinor';
import type { ClientRecord, DeliveryMode, RequiredConsentPurpose } from './types';

/**
 * The consents `canActivate` must find active (docs/SPEC/client-record.md rule 3):
 * participation always; minor_participation only while the client is a minor on
 * `atDate`; home_visit only when the delivery includes a home visit. Sorted so the
 * result is deterministic regardless of the order these conditions were checked in.
 */
export function requiredConsents(
  record: ClientRecord,
  deliveryModes: readonly DeliveryMode[],
  atDate: IsoDate,
): RequiredConsentPurpose[] {
  const purposes: RequiredConsentPurpose[] = ['participation'];

  const { dateOfBirth } = record.client;
  if (dateOfBirth !== null && isMinor(dateOfBirth, atDate)) {
    purposes.push('minor_participation');
  }

  if (deliveryModes.includes('home')) {
    purposes.push('home_visit');
  }

  return purposes.sort();
}
