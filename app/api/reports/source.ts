import type { ReportDocument, ReportContent } from '../../../domain/reports';
import { validateContent } from '../../../domain/reports';
import type { Db } from '../_middleware/request-context';
import type { ReportRow } from './schema';

/**
 * Reading a report back out of its own row.
 *
 * **Everything the renderer needs is on the row.** The content, the signer's
 * four snapshots, the practice's identity block, the reference, the date and
 * the version: nothing here joins `tenant`, `credential` or `practitioner`,
 * because a report issued in March must re-render in five years' time exactly
 * as it was filed and a live join would quietly give it this year's answers.
 * That is what makes the byte-identical re-render possible at all.
 *
 * The client's own name and record number *are* read live, and deliberately:
 * they are the recipient block, and a household that corrects the spelling of
 * a child's name has corrected it. A re-render after such a correction would
 * differ from the filed bytes and the repair path refuses it, which is the
 * right answer — the filed document stays, the store is not overwritten with a
 * different one, and the mismatch is logged.
 */

export const REPORT_COLUMNS =
  'r.id, r.client_id, r.kind::text as kind, r.status::text as status, r.locale, ' +
  'r.service_type_id, r.reference, r.number, ' +
  "to_char(r.issued_on, 'YYYY-MM-DD') as issued_on, " +
  "to_char(r.coverage_from, 'YYYY-MM-DD') as coverage_from, " +
  "to_char(r.coverage_to, 'YYYY-MM-DD') as coverage_to, " +
  'r.content, r.document_id, r.version, r.supersedes_id, r.amendment_reason, ' +
  'r.signed_by_practitioner_id, r.signed_by_name, r.signed_by_certification, ' +
  'r.signed_by_certifying_body, r.signed_by_certificate_number, ' +
  'r.practice_legal_name, r.practice_legal_name_ar, r.practice_address, ' +
  'r.practice_licence_number, r.practice_licensing_authority, ' +
  'to_char(r.created_at, \'YYYY-MM-DD"T"HH24:MI:SSOF\') as created_at';

export type ReportRecord = {
  id: string;
  client_id: string;
  kind: 'session' | 'progress';
  status: 'draft' | 'issued' | 'superseded';
  locale: 'en' | 'ar';
  service_type_id: string | null;
  reference: string | null;
  number: number | null;
  issued_on: string | null;
  coverage_from: string | null;
  coverage_to: string | null;
  content: unknown;
  document_id: string | null;
  version: number;
  supersedes_id: string | null;
  amendment_reason: string | null;
  signed_by_practitioner_id: string | null;
  signed_by_name: string | null;
  signed_by_certification: string | null;
  signed_by_certifying_body: string | null;
  signed_by_certificate_number: string | null;
  practice_legal_name: string | null;
  practice_legal_name_ar: string | null;
  practice_address: string | null;
  practice_licence_number: string | null;
  practice_licensing_authority: string | null;
  created_at: string;
  deliveries?: string | number;
};

const ONE_SQL =
  `select ${REPORT_COLUMNS}, ` +
  '(select count(*) from report_delivery d where d.tenant_id = r.tenant_id ' +
  ' and d.report_id = r.id) as deliveries ' +
  'from report r where r.tenant_id = app.current_tenant_id() and r.id = $1';

const LIST_SQL =
  `select ${REPORT_COLUMNS}, ` +
  '(select count(*) from report_delivery d where d.tenant_id = r.tenant_id ' +
  ' and d.report_id = r.id) as deliveries ' +
  'from report r where r.tenant_id = app.current_tenant_id() and r.client_id = any($1::uuid[]) ' +
  'order by r.created_at desc, r.id';

/** One report, or nothing at all where row security does not show it. */
export async function readReport(db: Db, id: string): Promise<ReportRecord | null> {
  const found = await db.query<ReportRecord>(ONE_SQL, [id]);
  return found.rows[0] ?? null;
}

/** Every report of these clients this actor may see. */
export async function readReports(db: Db, clientIds: readonly string[]): Promise<ReportRecord[]> {
  if (clientIds.length === 0) return [];
  const found = await db.query<ReportRecord>(LIST_SQL, [clientIds]);
  return found.rows;
}

/** The row as a screen reads it. Never the content, which is its own field. */
export function asRow(record: ReportRecord): ReportRow {
  return {
    id: record.id,
    clientId: record.client_id,
    kind: record.kind,
    status: record.status,
    locale: record.locale,
    reference: record.reference,
    issuedOn: record.issued_on,
    coverageFrom: record.coverage_from,
    coverageTo: record.coverage_to,
    signedByName: record.signed_by_name,
    version: record.version,
    supersedesId: record.supersedes_id,
    amendmentReason: record.amendment_reason,
    documentId: record.document_id,
    deliveries: Number(record.deliveries ?? 0),
    createdAt: record.created_at,
  };
}

const CLIENT_SQL =
  'select given_name, family_name, mrn from client ' +
  'where tenant_id = app.current_tenant_id() and id = $1';

export type Recipient = { name: string; recordNumber: string };

export async function readRecipient(db: Db, clientId: string): Promise<Recipient | null> {
  const found = await db.query<{ given_name: string; family_name: string; mrn: string }>(
    CLIENT_SQL,
    [clientId],
  );
  const row = found.rows[0];
  if (!row) return null;
  return {
    name: [row.given_name, row.family_name].filter((part) => part.length > 0).join(' '),
    recordNumber: row.mrn,
  };
}

/**
 * The row and its recipient, assembled into what the renderer takes.
 *
 * Answers null when the report is not one that can be rendered: a draft has no
 * reference and no signature, and a row whose content the shape no longer
 * recognises is a row nothing should quietly render half of.
 */
export function documentFrom(record: ReportRecord, recipient: Recipient): ReportDocument | null {
  if (
    record.status === 'draft' ||
    record.reference === null ||
    record.issued_on === null ||
    record.signed_by_name === null ||
    record.signed_by_certification === null ||
    record.practice_legal_name === null
  ) {
    return null;
  }
  const parsed = validateContent(record.kind, record.content);
  if (!parsed.ok) return null;

  return {
    kind: record.kind,
    locale: record.locale,
    practice: {
      legalName: record.practice_legal_name,
      legalNameAr: record.practice_legal_name_ar,
      address: record.practice_address,
      licenceNumber: record.practice_licence_number,
      licensingAuthority: record.practice_licensing_authority,
    },
    signer: {
      name: record.signed_by_name,
      certification: record.signed_by_certification,
      certifyingBody: record.signed_by_certifying_body,
      certificateNumber: record.signed_by_certificate_number,
    },
    recipient,
    reference: record.reference,
    issuedOn: record.issued_on,
    version: record.version,
    amendmentReason: record.amendment_reason,
    content: parsed.content as ReportContent,
  };
}
