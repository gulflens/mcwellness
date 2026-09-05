import type { Assessment, DerivedPayload, Instrument, ReferenceSex } from '@domain/assessment';
import type { Db } from '../_middleware/request-context';
import type { AssessmentFile, AssessmentFileRole, AssessmentRow } from './schema';

/**
 * Reading measurements back out of the database, in one shape, for every route
 * that needs one.
 *
 * Row security decides which rows come back (db/policies/assessment/access.sql):
 * these statements are the same for everybody and the database narrows them,
 * so a practitioner off a client's schedule gets an empty result rather than a
 * refusal that tells them something is there.
 *
 * The files are read in a second statement rather than joined, so a
 * measurement with three files is one row and not three.
 */

export type DbAssessment = {
  id: string;
  client_id: string;
  instrument: Instrument;
  instrument_version: string;
  performed_at: Date;
  performed_by_practitioner_id: string;
  performed_by: string | null;
  derived: DerivedPayload;
  condition_note: string | null;
  reference_age_years: number | null;
  reference_sex: ReferenceSex | null;
  version: number;
  supersedes_id: string | null;
  supersede_reason: string | null;
};

const SELECT =
  'select a.id, a.client_id, a.instrument, a.instrument_version, a.performed_at, ' +
  'a.performed_by_practitioner_id, u.display_name as performed_by, a.derived, ' +
  'a.condition_note, a.reference_age_years, a.reference_sex, a.version, a.supersedes_id, ' +
  'a.supersede_reason ' +
  'from assessment a ' +
  'left join practitioner p on p.id = a.performed_by_practitioner_id ' +
  'and p.tenant_id = app.current_tenant_id() ' +
  'left join app_user u on u.id = p.user_id and u.tenant_id = app.current_tenant_id() ' +
  'where a.tenant_id = app.current_tenant_id()';

export async function readForClient(db: Db, clientId: string): Promise<DbAssessment[]> {
  const { rows } = await db.query<DbAssessment>(
    `${SELECT} and a.client_id = $1 order by a.performed_at desc, a.version desc`,
    [clientId],
  );
  return rows;
}

export async function readByIds(db: Db, ids: readonly string[]): Promise<DbAssessment[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<DbAssessment>(`${SELECT} and a.id = any($1::uuid[])`, [ids]);
  return rows;
}

export async function readOne(db: Db, id: string): Promise<DbAssessment | null> {
  const { rows } = await db.query<DbAssessment>(`${SELECT} and a.id = $1`, [id]);
  return rows[0] ?? null;
}

type FileRow = {
  assessment_id: string;
  document_id: string;
  role: AssessmentFileRole;
  created_at: Date;
};

export async function readFiles(
  db: Db,
  assessmentIds: readonly string[],
): Promise<Map<string, AssessmentFile[]>> {
  const files = new Map<string, AssessmentFile[]>();
  if (assessmentIds.length === 0) return files;
  const { rows } = await db.query<FileRow>(
    'select assessment_id, document_id, role::text as role, created_at from assessment_document ' +
      'where tenant_id = app.current_tenant_id() and assessment_id = any($1::uuid[]) ' +
      'order by created_at',
    [assessmentIds],
  );
  for (const row of rows) {
    const filed = files.get(row.assessment_id) ?? [];
    filed.push({
      documentId: row.document_id,
      role: row.role,
      filedAt: row.created_at.toISOString(),
    });
    files.set(row.assessment_id, filed);
  }
  return files;
}

/** The row as the console reads it. */
export function toRow(row: DbAssessment, files: readonly AssessmentFile[]): AssessmentRow {
  return {
    id: row.id,
    clientId: row.client_id,
    instrument: row.instrument,
    instrumentVersion: row.instrument_version,
    performedAt: row.performed_at.toISOString(),
    performedByPractitionerId: row.performed_by_practitioner_id,
    performedBy: row.performed_by,
    derived: row.derived as unknown as Record<string, unknown>,
    conditionNote: row.condition_note,
    referenceAgeYears: row.reference_age_years,
    referenceSex: row.reference_sex,
    version: row.version,
    supersedesId: row.supersedes_id,
    supersedeReason: row.supersede_reason,
    files: [...files],
  };
}

/** The row as `domain/assessment`'s own rules read it. */
export function toAssessment(row: DbAssessment): Assessment {
  return {
    id: row.id,
    clientId: row.client_id,
    instrument: row.instrument,
    instrumentVersion: row.instrument_version,
    performedAt: row.performed_at.toISOString(),
    derived: row.derived,
    version: row.version,
    supersedesId: row.supersedes_id,
    referenceAgeYears: row.reference_age_years,
    referenceSex: row.reference_sex,
  };
}
