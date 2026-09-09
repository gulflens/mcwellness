import { randomUUID } from 'node:crypto';
import type { Db } from '../_middleware/request-context';
import { cleanText } from '../_middleware/text';

/**
 * A new client as a lead, with its first contact made primary — the two
 * inserts `POST /api/clients` has always done, lifted here on 2026-09-09 so
 * that converting an enquiry (app/api/enquiries/routes.ts) creates a lead the
 * same way rather than with a copy of the same SQL. The Emirates ID capture
 * stays with the route that takes one; this receives the sealed bytes, or
 * nothing.
 *
 * Audited by the triggers under whoever is in the request context, which is
 * the point: a converted enquiry's client row is audited from its first byte
 * under the person who pressed the button (Option B).
 */
export type LeadInput = {
  givenName: string;
  familyName: string;
  givenNameAr?: string | undefined;
  familyNameAr?: string | undefined;
  dateOfBirth?: string | undefined;
  referralSource?: string | undefined;
  contact: {
    givenName?: string | undefined;
    familyName?: string | undefined;
    givenNameAr?: string | undefined;
    familyNameAr?: string | undefined;
    relationship: string;
    isLegalGuardian: boolean;
    canConsent: boolean;
    canReceiveReports: boolean;
    canPay: boolean;
    phone?: string | undefined;
    email?: string | undefined;
    emiratesIdSealed?: Buffer | null | undefined;
    emiratesIdHash?: Buffer | null | undefined;
  };
};

export async function createLead(
  db: Db,
  tenantId: string,
  input: LeadInput,
  contactId: string = randomUUID(),
): Promise<{ clientId: string; mrn: string; contactId: string }> {
  // app.next_mrn (db/migrations/100_client_record.sql) takes its own advisory
  // lock, so two enrolments at once never share a number.
  const nextMrnRow = await db.query<{ next_mrn: string }>('select app.next_mrn($1) as next_mrn', [
    tenantId,
  ]);
  const mrn = nextMrnRow.rows[0]?.next_mrn;
  if (!mrn) throw new Error('app.next_mrn returned no value.');

  const clientId = randomUUID();
  await db.query(
    'insert into client (id, tenant_id, mrn, given_name, family_name, given_name_ar, ' +
      'family_name_ar, date_of_birth, referral_source, status) ' +
      "values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'lead')",
    [
      clientId,
      tenantId,
      mrn,
      cleanText(input.givenName, 100),
      cleanText(input.familyName, 100),
      input.givenNameAr ? cleanText(input.givenNameAr, 100) : null,
      input.familyNameAr ? cleanText(input.familyNameAr, 100) : null,
      input.dateOfBirth ?? null,
      input.referralSource ? cleanText(input.referralSource, 200) : null,
    ],
  );
  const contact = input.contact;
  await db.query(
    'insert into contact (id, tenant_id, client_id, given_name, family_name, ' +
      'given_name_ar, family_name_ar, relationship, is_legal_guardian, ' +
      'can_consent, can_receive_reports, can_pay, phone, email, emirates_id_encrypted, ' +
      'emirates_id_hash) ' +
      'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)',
    [
      contactId,
      tenantId,
      clientId,
      contact.givenName ? cleanText(contact.givenName, 100) : null,
      contact.familyName ? cleanText(contact.familyName, 100) : null,
      contact.givenNameAr ? cleanText(contact.givenNameAr, 100) : null,
      contact.familyNameAr ? cleanText(contact.familyNameAr, 100) : null,
      contact.relationship,
      contact.isLegalGuardian,
      contact.canConsent,
      contact.canReceiveReports,
      contact.canPay,
      contact.phone ?? null,
      contact.email ?? null,
      contact.emiratesIdSealed ?? null,
      contact.emiratesIdHash ?? null,
    ],
  );
  await db.query('update client set primary_contact_id = $1 where id = $2', [contactId, clientId]);
  return { clientId, mrn, contactId };
}
