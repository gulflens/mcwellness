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
 *
 * Takes only a date of birth because that is all the rule above actually
 * reads. A caller that has no contacts, locations or consent history to
 * hand — the bundle route (`POST /api/clients/:id/consents/bundle` in
 * app/api/clients/consents.ts) and the Consent tab
 * (app/admin/clients/ConsentTab.tsx) among them — asks this question before
 * it has assembled any of that, and has no business inventing empty
 * placeholders for a `ClientRecord` it does not have just to satisfy a wider
 * shape this rule never needed.
 */
export function requiredConsentsFor(
  client: { dateOfBirth: IsoDate | null },
  deliveryModes: readonly DeliveryMode[],
  atDate: IsoDate,
): RequiredConsentPurpose[] {
  const purposes: RequiredConsentPurpose[] = ['participation', 'health_data'];

  if (client.dateOfBirth !== null && isMinor(client.dateOfBirth, atDate)) {
    purposes.push('minor_participation');
  }

  if (deliveryModes.includes('home')) {
    purposes.push('home_visit');
  }

  return purposes.sort();
}

/**
 * The same question, asked with a full `ClientRecord` in hand.
 *
 * `canActivate` reads the rest of `record` for its own three other gates, so
 * it takes the wider shape; the rule itself only ever needed the client's
 * date of birth, which is why it lives on `requiredConsentsFor` above and
 * this is a thin pull of one field onto it. The two can never drift, because
 * there is only the one rule.
 */
export function requiredConsents(
  record: ClientRecord,
  deliveryModes: readonly DeliveryMode[],
  atDate: IsoDate,
): RequiredConsentPurpose[] {
  return requiredConsentsFor({ dateOfBirth: record.client.dateOfBirth }, deliveryModes, atDate);
}
