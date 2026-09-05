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
  | 'date_of_birth_unknown'
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
export function refusalsForRecording(context: AssessmentContext): readonly RecordRefusal[] {
  if (!context.clientFound) return ['client_not_found'];
  // **Reachable, which is not the same as on the schedule.** The door answers
  // `visible` true for the practice's three oversight roles by role, and for a
  // practitioner only for a client on their own schedule (migration 500). So a
  // lead practitioner correcting a figure for a household they have not
  // visited inside the ninety-day window passes here, because oversight is
  // what the role is for — and `db/policies/assessment/access.sql` says the
  // same underneath, which is the half that binds (review gap 12).
  //
  // Nothing else is waived with it: the credential below is asked for the
  // assessment's own service at the moment of writing, because a new version
  // is a recording, and the household's consents are asked the same way.
  if (!context.visible) return ['not_visible'];

  const refusals: RecordRefusal[] = [];
  if (context.practitionerId === null) refusals.push('no_practitioner_row');
  if (!context.credentialOk) refusals.push('credential_invalid');
  if (!context.activeConsentPurposes.includes('participation')) {
    refusals.push('consent_missing_participation');
  }
  // **No date of birth is a refusal, not an adult.** Without one the app
  // cannot tell whether a guardian's own agreement is needed, and treating
  // the person as an adult decides that question the dangerous way round.
  // `canCheckIn` fails closed here for the same reason and in the same order
  // (domain/session/canCheckIn.ts), and this practice sees children as the
  // common case rather than the edge.
  //
  // A guardian consents for a minor, and the purpose is its own row: a
  // household that agreed to take part has not thereby agreed on a child's
  // behalf (.claude/rules/compliance.md).
  if (!context.hasDateOfBirth) {
    refusals.push('date_of_birth_unknown');
  } else if (context.isMinor && !context.activeConsentPurposes.includes('minor_participation')) {
    refusals.push('consent_missing_minor_participation');
  }
  // **Always, and not on the caller's word for where the recording happened.**
  // The brain map is a home service in the catalogue — ninety minutes, in the
  // household — so the agreement is asked for every recording. An earlier
  // draft took a delivery mode from the request, which meant the word
  // `studio` walked past this gate with nothing on the server to check it
  // against (docs/CHANGE-REQUESTS/assessment-01.md, the reversal of default 3).
  if (!context.activeConsentPurposes.includes('home_visit')) {
    refusals.push('consent_missing_home_visit');
  }
  return refusals;
}
