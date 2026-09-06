import type { IsoDate } from './types';

/**
 * Rule 1 (docs/SPEC/reports-v1.md section 8): who may sign a report.
 *
 * **`can_sign_report` on a credential valid at that moment, and nothing
 * else grants it: not a role, not the owner's seniority** (section 10,
 * decision 6). The practice grows into a second signer by issuing a
 * credential, never by handing somebody a role.
 *
 * **The moment matters.** A credential is checked against the day the
 * signature is being made, in the practice's own time zone, not against the
 * day the draft was written and not against whatever the sign-in token
 * happened to carry an hour ago. `app/api/reports/issue.ts` reads the
 * credential rows fresh inside the issuing transaction and asks this, exactly
 * as the check-in route re-reads `can_execute_session`; the database asks it a
 * second time inside `app.issue_report`, which is the answer that binds.
 *
 * Pure: the credentials and the day come in, an answer goes out. The clock is
 * never read in here (.claude/rules/testing.md).
 */

/** One credential row, as much of it as this question needs. */
export type SigningCredential = {
  /** The practitioner the credential belongs to. */
  practitionerId: string;
  serviceTypeId: string;
  canSignReport: boolean;
  validFrom: IsoDate;
  validTo: IsoDate | null;
};

export type IssueRefusalCode =
  'no_credential' | 'credential_cannot_sign' | 'credential_lapsed' | 'credential_not_yet_valid';

export type IssueAnswer =
  { ok: true; credential: SigningCredential } | { ok: false; code: IssueRefusalCode };

/** True when `on` falls inside the credential's validity; no end date never expires. */
export function credentialValidOn(credential: SigningCredential, on: IsoDate): boolean {
  return credential.validFrom <= on && (credential.validTo === null || on <= credential.validTo);
}

/**
 * Whether this practitioner may sign this report today, and on which
 * credential. The credential is answered as well as the permission, because it
 * is what gets snapshotted onto the row (section 3) — asking twice, once for
 * the yes and once for the values, is how the two come to disagree.
 *
 * `serviceTypeId` narrows the question where the report is about one service.
 * A progress report over a whole programme names none, and then any valid
 * signing credential the practitioner holds will do.
 */
export function canIssue(
  credentials: readonly SigningCredential[],
  input: { practitionerId: string; serviceTypeId?: string | null; on: IsoDate },
): IssueAnswer {
  const theirs = credentials.filter(
    (credential) =>
      credential.practitionerId === input.practitionerId &&
      (input.serviceTypeId === undefined ||
        input.serviceTypeId === null ||
        credential.serviceTypeId === input.serviceTypeId),
  );
  if (theirs.length === 0) {
    return { ok: false, code: 'no_credential' };
  }

  const signing = theirs.filter((credential) => credential.canSignReport);
  if (signing.length === 0) {
    return { ok: false, code: 'credential_cannot_sign' };
  }

  const valid = signing.find((credential) => credentialValidOn(credential, input.on));
  if (valid) {
    return { ok: true, credential: valid };
  }

  // Lapsed and not-yet-valid are told apart, because they are different
  // sentences to the person holding the pen: one asks them to renew, the other
  // says the certificate does not start until a date they can read.
  const lapsed = signing.some(
    (credential) => credential.validTo !== null && credential.validTo < input.on,
  );
  return { ok: false, code: lapsed ? 'credential_lapsed' : 'credential_not_yet_valid' };
}
