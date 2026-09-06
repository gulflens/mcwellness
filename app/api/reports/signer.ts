import type { SigningCredential } from '../../../domain/reports';
import type { Db } from '../_middleware/request-context';

/**
 * Who is about to put their name on a report, and on what authority.
 *
 * **Read fresh, every time, from the credential rows themselves.** Never from
 * the sign-in token's own capabilities: a token is minted once and lives for
 * minutes, and a certificate that lapsed this morning must refuse a signature
 * this afternoon. `can_execute_session` is re-checked at check-in for the same
 * reason, and this is the same discipline one door along.
 *
 * Shared by the issuing route and the preview so the two can never show a
 * different signature block for the same person.
 */

const PRACTITIONER_SQL =
  'select p.id, u.display_name from practitioner p ' +
  'join app_user u on u.id = p.user_id and u.tenant_id = p.tenant_id ' +
  'where p.tenant_id = app.current_tenant_id() and p.user_id = $1';

const CREDENTIALS_SQL =
  'select practitioner_id, service_type_id, can_sign_report, certification, certifying_body, ' +
  "certificate_number, to_char(valid_from, 'YYYY-MM-DD') as valid_from, " +
  "to_char(valid_to, 'YYYY-MM-DD') as valid_to " +
  'from credential where tenant_id = app.current_tenant_id() and practitioner_id = $1';

export type Signer = { practitionerId: string; name: string };

/** The practitioner row of the person signed in, or nothing where they are not one. */
export async function signerFor(db: Db, userId: string): Promise<Signer | null> {
  const found = await db.query<{ id: string; display_name: string }>(PRACTITIONER_SQL, [userId]);
  const row = found.rows[0];
  return row ? { practitionerId: row.id, name: row.display_name } : null;
}

/** Everything on a credential a report quotes, beside what `canIssue` reads. */
export type CredentialRow = SigningCredential & {
  certification: string;
  certifyingBody: string | null;
  certificateNumber: string | null;
};

export async function signingCredentials(db: Db, practitionerId: string): Promise<CredentialRow[]> {
  const found = await db.query<{
    practitioner_id: string;
    service_type_id: string;
    can_sign_report: boolean;
    certification: string;
    certifying_body: string | null;
    certificate_number: string | null;
    valid_from: string;
    valid_to: string | null;
  }>(CREDENTIALS_SQL, [practitionerId]);
  return found.rows.map((row) => ({
    practitionerId: row.practitioner_id,
    serviceTypeId: row.service_type_id,
    canSignReport: row.can_sign_report,
    certification: row.certification,
    certifyingBody: row.certifying_body,
    certificateNumber: row.certificate_number,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  }));
}
