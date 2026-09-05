import { serviceCodeFor, type Instrument } from '@domain/assessment';
import type { Db } from '../_middleware/request-context';

/**
 * The gates of docs/SPEC/assessment.md section 7.2, asked in the database at
 * the moment of writing and never from anything a device is carrying.
 *
 * One call to `app.assessment_context` (migration 500) answers all of it: is
 * this a client of this practice, may this person reach that record, do they
 * hold a valid certification for this service **today**, is the client a
 * minor, and which of the three consent purposes are active right now.
 *
 * **Nothing here is cached and nothing is read off the token.** A
 * certification that lapsed this morning refuses this afternoon's recording,
 * and a household that withdrew its consent between the visit and the typing
 * gets a refusal rather than a row (.claude/rules/compliance.md).
 */

export type AssessmentContext = {
  clientFound: boolean;
  visible: boolean;
  practitionerId: string | null;
  credentialOk: boolean;
  hasDateOfBirth: boolean;
  isMinor: boolean;
  activeConsentPurposes: readonly string[];
};

type ContextRow = {
  client_found: boolean;
  visible: boolean;
  practitioner_id: string | null;
  credential_ok: boolean;
  has_date_of_birth: boolean;
  is_minor: boolean;
  active_consent_purposes: string[];
};

export async function assessmentContext(
  db: Db,
  clientId: string,
  instrument: Instrument,
): Promise<AssessmentContext> {
  const { rows } = await db.query<ContextRow>(
    'select client_found, visible, practitioner_id, credential_ok, has_date_of_birth, ' +
      'is_minor, active_consent_purposes from app.assessment_context($1, $2)',
    [clientId, serviceCodeFor(instrument)],
  );
  const row = rows[0];
  return {
    clientFound: row?.client_found ?? false,
    visible: row?.visible ?? false,
    practitionerId: row?.practitioner_id ?? null,
    credentialOk: row?.credential_ok ?? false,
    hasDateOfBirth: row?.has_date_of_birth ?? false,
    isMinor: row?.is_minor ?? false,
    activeConsentPurposes: row?.active_consent_purposes ?? [],
  };
}

/** Why a recording was refused. Each is a sentence the drawer can say. */
export type RecordRefusal =
  | 'client_not_found'
  | 'not_visible'
  | 'no_practitioner_row'
  | 'credential_invalid'
  | 'consent_missing_participation'
  | 'consent_missing_minor_participation'
  | 'consent_missing_home_visit';

/**
 * Every reason this recording is refused, in the order a person should hear
 * them: whether the record is reachable at all, then whether this person may
 * take a measurement, then what the household has agreed to.
 *
 * All of them, not the first: a practitioner told their certification has
 * lapsed and then, on fixing it, told the consent is missing has been refused
 * twice for one attempt. The trail keeps the whole list too.
 */
export function refusalsForRecording(
  context: AssessmentContext,
  deliveryMode: 'home' | 'studio' | 'remote',
): readonly RecordRefusal[] {
  if (!context.clientFound) return ['client_not_found'];
  if (!context.visible) return ['not_visible'];

  const refusals: RecordRefusal[] = [];
  if (context.practitionerId === null) refusals.push('no_practitioner_row');
  if (!context.credentialOk) refusals.push('credential_invalid');
  if (!context.activeConsentPurposes.includes('participation')) {
    refusals.push('consent_missing_participation');
  }
  // A guardian consents for a minor, and the purpose is its own row: a
  // household that agreed to take part has not thereby agreed on a child's
  // behalf (.claude/rules/compliance.md).
  if (context.isMinor && !context.activeConsentPurposes.includes('minor_participation')) {
    refusals.push('consent_missing_minor_participation');
  }
  if (deliveryMode === 'home' && !context.activeConsentPurposes.includes('home_visit')) {
    refusals.push('consent_missing_home_visit');
  }
  return refusals;
}
