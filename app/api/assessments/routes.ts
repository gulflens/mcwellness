import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  canSupersede,
  compare,
  currentVersions,
  validateDerived,
  type Assessment,
} from '@domain/assessment';
import { canActor, hasRole } from '@domain/shared';
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from '../../../domain/shared/storage';
import { logRead, logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { auditDocumentRead } from '../_middleware/storage/audit';
import { logRefusal } from './audit';
import { assessmentContext, refusalsForRecording } from './gate';
import {
  readByIds,
  readFiles,
  readForClient,
  readOne,
  readVisits,
  toAssessment,
  toRow,
  type DbAssessment,
} from './rows';
import {
  AssessmentListResponse,
  AssessmentResponse,
  AssessmentVisitsResponse,
  ComparisonResponse,
  FileLinkResponse,
  RecordAssessmentRequest,
  SupersedeAssessmentRequest,
  type AssessmentFile,
} from './schema';

/**
 * The measurement's routes (docs/SPEC/assessment.md section 7). Thin: every
 * rule they apply is a pure function in `domain/assessment` or a gate in the
 * database, and nothing here decides anything on its own (CLAUDE.md rule 4).
 *
 * - `GET /api/clients/:id/assessments` — the current version of each
 *   measurement with its history beneath it, and one audit `list` row per row
 *   shown.
 * - `POST /api/assessments` — validates the payload against the instrument's
 *   declared shape, re-checks the credential and the consents in the database
 *   at the moment of writing, and writes the row.
 * - `POST /api/assessments/:id/supersede` — a new version with a reason.
 *   Refuses anything that is not the version that stands.
 * - `GET /api/assessments/visits?clientId=` — the client's completed visits,
 *   so the drawer can name the one a measurement was taken at (migration 951).
 * - `GET /api/assessments/compare?ids=` — paired figures and their
 *   differences, computing nothing a reader could not.
 * - `GET /api/assessments/file/:documentId/link` — `auditDocumentRead`, then a
 *   short-lived signed link.
 *
 * The bytes have a door of their own (`file.ts`).
 *
 * **Every refusal is written before the answer** (section 8), and a refusal
 * files itself against a client only once that client has been shown to be one
 * of this practice's: a caller's own claimed id is not proof of anything.
 */

const ClientParams = z.object({ id: z.uuid() });
const ClientQuery = z.object({ clientId: z.uuid() });
const AssessmentParams = z.object({ id: z.uuid() });
const DocumentParams = z.object({ documentId: z.uuid() });
/** Two ids, comma-separated. Opaque ids only, never a name (.claude/rules/ui.md). */
const CompareIds = z
  .string()
  .transform((value) => value.split(',').map((part) => part.trim()))
  .pipe(z.array(z.uuid()).length(2));

/** A payload refused by the shape, answered so the drawer can name the field. */
function refusedPayload(
  requestId: string,
  refusal: { field: string; reason: string },
): { error: string; code: string; field: string; reason: string; requestId: string } {
  return {
    error: 'unprocessable',
    code: 'invalid_payload',
    field: refusal.field,
    reason: refusal.reason,
    requestId,
  };
}

async function rowsWithFiles(
  db: Db,
  rows: readonly DbAssessment[],
): Promise<Map<string, AssessmentFile[]>> {
  return readFiles(
    db,
    rows.map((row) => row.id),
  );
}

export function mountAssessments(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/clients/:id/assessments', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    if (!canActor(actor, { type: 'assessment.read' }, {}, now())) {
      await logRefusal(db, 'assessment', params.data.id, null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Whether this person may reach the record at all, asked of the database
    // rather than inferred from an empty result: section 11 requires that a
    // practitioner off a client's schedule is refused **and audited**, and a
    // silent empty list records nothing.
    const context = await assessmentContext(db, params.data.id, 'qeeg');
    if (!context.clientFound || !context.visible) {
      await logRefusal(
        db,
        'assessment',
        params.data.id,
        context.clientFound ? params.data.id : null,
        [context.clientFound ? 'not_visible' : 'client_not_found'],
      );
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const rows = await readForClient(db, params.data.id);
    const files = await rowsWithFiles(db, rows);
    const chains = currentVersions(rows.map(toAssessment));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const shown = (assessment: Assessment) =>
      toRow(byId.get(assessment.id)!, files.get(assessment.id) ?? []);

    // One `list` row per measurement shown (section 8). Opening one of them,
    // or the comparison, is a `read` — the distinction PR 5 drew.
    await logReads(
      db,
      'assessment',
      rows.map((row) => ({ id: row.id, clientId: row.client_id })),
      'list',
    );

    return c.json(
      AssessmentListResponse.parse({
        assessments: chains.map((chain) => ({
          current: shown(chain.current),
          superseded: chain.superseded.map(shown),
        })),
      }),
    );
  });

  api.post('/api/assessments', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');
    if (!canActor(actor, { type: 'assessment.record' }, {}, now())) {
      await logRefusal(db, 'assessment', randomUUID(), null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = RecordAssessmentRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;

    // The shape first, so a payload that is wrong is refused with the field
    // named before anything else is asked (section 3.2).
    const derived = validateDerived(input.instrument, input.instrumentVersion, input.derived);
    if (!derived.ok) {
      return c.json(refusedPayload(requestId, derived), 422);
    }

    const context = await assessmentContext(db, input.clientId, input.instrument);
    const refusals = refusalsForRecording(context);
    if (refusals.length > 0) {
      await logRefusal(
        db,
        'assessment',
        input.clientId,
        context.clientFound ? input.clientId : null,
        refusals,
      );
      // A client of another practice, and one this person may not reach, look
      // the same from outside: neither answer says whether the record exists.
      const unreachable = refusals[0] === 'client_not_found' || refusals[0] === 'not_visible';
      return unreachable
        ? c.json({ error: 'not_found', requestId }, 404)
        : c.json({ error: 'forbidden', code: refusals[0], refusals, requestId }, 403);
    }

    // A visit of another household is refused by `assessment_session_fk`
    // (migration 951), which binds the visit to this measurement's own client
    // and is the boundary. This asks first only so that a caller naming a
    // visit that is not this client's is told so, rather than being handed the
    // 500 a foreign-key violation would otherwise become.
    if (input.sessionId !== null) {
      const visit = await db.query(
        'select 1 from session where tenant_id = app.current_tenant_id() and id = $1 ' +
          "and client_id = $2 and status = 'completed'",
        [input.sessionId, input.clientId],
      );
      if (visit.rowCount === 0) {
        return c.json({ error: 'unprocessable', code: 'no_such_visit', requestId }, 422);
      }
    }

    const id = randomUUID();
    await db.query(
      'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, ' +
        'performed_at, instrument, instrument_version, derived, condition_note, ' +
        'reference_age_years, reference_sex, session_id, created_by) values ' +
        '($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::sex_at_birth, ' +
        '$11, $12)',
      [
        id,
        input.clientId,
        context.practitionerId,
        input.performedAt,
        input.instrument,
        input.instrumentVersion,
        JSON.stringify(derived.value),
        input.conditionNote,
        input.referenceAgeYears,
        input.referenceSex,
        input.sessionId,
        actor.userId,
      ],
    );
    const row = await readOne(db, id);
    if (row === null) {
      throw new Error('The measurement was written and could not be read back.');
    }
    return c.json(AssessmentResponse.parse({ assessment: toRow(row, []) }), 201);
  });

  api.post('/api/assessments/:id/supersede', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');
    const params = AssessmentParams.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    if (!canActor(actor, { type: 'assessment.record' }, {}, now())) {
      await logRefusal(db, 'assessment', params.data.id, null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = SupersedeAssessmentRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;

    const target = await readOne(db, params.data.id);
    if (target === null) {
      await logRefusal(db, 'assessment', params.data.id, null, ['not_found']);
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const context = await assessmentContext(db, target.client_id, target.instrument);
    // The recording practitioner, or the lead practitioner (section 7). The
    // owner reaches it as the lead practitioner does, holding that role.
    const isRecorder =
      context.practitionerId !== null &&
      context.practitionerId === target.performed_by_practitioner_id;
    if (!isRecorder && !hasRole(actor, 'lead_practitioner')) {
      await logRefusal(db, 'assessment', target.id, target.client_id, ['not_your_measurement']);
      return c.json({ error: 'forbidden', code: 'not_your_measurement', requestId }, 403);
    }

    const successor = await db.query<{ id: string }>(
      'select id from assessment where tenant_id = app.current_tenant_id() and supersedes_id = $1',
      [target.id],
    );
    const decision = canSupersede(
      { id: target.id, supersededById: successor.rows[0]?.id ?? null },
      input.reason,
    );
    if (!decision.ok) {
      await logRefusal(db, 'assessment', target.id, target.client_id, [decision.reason]);
      return c.json({ error: 'conflict', code: decision.reason, requestId }, 409);
    }

    const derived = validateDerived(target.instrument, input.instrumentVersion, input.derived);
    if (!derived.ok) {
      return c.json(refusedPayload(requestId, derived), 422);
    }

    // The same gates as a first recording: a correction is a measurement, and
    // a certification that has lapsed since does not authorise one.
    const refusals = refusalsForRecording(context);
    if (refusals.length > 0) {
      await logRefusal(db, 'assessment', target.id, target.client_id, refusals);
      return c.json({ error: 'forbidden', code: refusals[0], refusals, requestId }, 403);
    }

    const id = randomUUID();
    await db.query(
      'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, ' +
        'performed_at, instrument, instrument_version, derived, condition_note, ' +
        'reference_age_years, reference_sex, session_id, version, supersedes_id, ' +
        'supersede_reason, created_by) ' +
        'values ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7::jsonb, $8, $9, ' +
        '$10::sex_at_birth, $11, $12, $13, $14, $15)',
      [
        id,
        target.client_id,
        // The person who typed the correction, not the person who took the
        // original: `performed_by_practitioner_id` says who is answerable for
        // the figures in this row, and the row it replaced still says who was
        // answerable for those.
        context.practitionerId,
        input.performedAt,
        target.instrument,
        input.instrumentVersion,
        JSON.stringify(derived.value),
        input.conditionNote,
        input.referenceAgeYears,
        input.referenceSex,
        // The visit travels with the correction rather than being asked for
        // again: a correction is a new reading of the same measurement, taken
        // at the same visit, and a picker on that form would be a way to move
        // a measurement onto a different day's visit by accident.
        target.session_id,
        target.version + 1,
        target.id,
        input.reason,
        actor.userId,
      ],
    );
    const row = await readOne(db, id);
    if (row === null) {
      throw new Error('The correction was written and could not be read back.');
    }
    return c.json(AssessmentResponse.parse({ assessment: toRow(row, []) }), 201);
  });

  api.get('/api/assessments/visits', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');
    const query = ClientQuery.safeParse({ clientId: c.req.query('clientId') });
    if (!query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    // The recording audience, because this list exists to fill in one field on
    // the recording form and nothing else reads it.
    if (!canActor(actor, { type: 'assessment.record' }, {}, now())) {
      await logRefusal(db, 'assessment', query.data.clientId, null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const context = await assessmentContext(db, query.data.clientId, 'qeeg');
    if (!context.clientFound || !context.visible) {
      await logRefusal(
        db,
        'assessment',
        query.data.clientId,
        context.clientFound ? query.data.clientId : null,
        [context.clientFound ? 'not_visible' : 'client_not_found'],
      );
      return c.json({ error: 'not_found', requestId }, 404);
    }
    // **A read, written before the answer** (section 8): this says which days
    // the practice visited this household and who went, which is a fact about
    // the record even though nothing changes.
    await logRead(db, 'client', query.data.clientId, query.data.clientId);
    return c.json(
      AssessmentVisitsResponse.parse({ visits: await readVisits(db, query.data.clientId) }),
    );
  });

  api.get('/api/assessments/compare', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');
    if (!canActor(actor, { type: 'assessment.read' }, {}, now())) {
      await logRefusal(db, 'assessment', randomUUID(), null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const ids = CompareIds.safeParse(c.req.query('ids') ?? '');
    if (!ids.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const rows = await readByIds(db, ids.data);
    if (rows.length !== 2) {
      // One of them is another practice's, or a record this person may not
      // reach: row security answered, and the answer is the same either way.
      //
      // **The attempt is written before the answer** (section 8), one row per
      // id that did not come back, because a practitioner reaching for a
      // measurement off their own schedule is exactly what section 11 asks to
      // be audited and a silent 404 records nothing.
      //
      // The client is null, and deliberately. The list route can name one
      // because its path carries a client id and `assessmentContext` is asked
      // about that id before anything else; here the path carries assessment
      // ids, row security has already hidden whatever is out of reach, and the
      // door takes a client rather than an assessment. Filing the attempt
      // against the client of whichever row *did* come back would write a
      // false line onto a household that has nothing to do with it, and a
      // refusal that filed itself against an id the caller supplied would let
      // anybody write rows onto anybody's trail (./audit.ts).
      const reached = new Set(rows.map((row) => row.id));
      for (const id of ids.data) {
        if (!reached.has(id)) {
          await logRefusal(db, 'assessment', id, null, ['not_found']);
        }
      }
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const [first, second] = rows as [DbAssessment, DbAssessment];
    const ordered =
      first.performed_at.getTime() <= second.performed_at.getTime()
        ? [first, second]
        : [second, first];
    const result = compare(toAssessment(ordered[0]!), toAssessment(ordered[1]!));
    if (!result.ok) {
      return c.json(
        { error: 'unprocessable', code: result.reason, key: result.key ?? null, requestId },
        422,
      );
    }
    // Opening the comparison is a `read` per assessment shown (section 8).
    await logReads(
      db,
      'assessment',
      rows.map((row) => ({ id: row.id, clientId: row.client_id })),
    );
    return c.json(ComparisonResponse.parse({ comparison: result.value }));
  });

  api.get('/api/assessments/file/:documentId/link', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');
    const params = DocumentParams.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    if (!canActor(actor, { type: 'assessment.read' }, {}, now())) {
      await logRefusal(db, 'document', params.data.documentId, null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const storage = c.get('storage');
    if (!storage) {
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }
    const { rows } = await db.query<{ client_id: string; storage_key: string }>(
      'select ad.client_id, d.storage_key from assessment_document ad ' +
        'join document d on d.id = ad.document_id and d.tenant_id = ad.tenant_id ' +
        'where ad.tenant_id = app.current_tenant_id() and ad.document_id = $1',
      [params.data.documentId],
    );
    const row = rows[0];
    if (!row) {
      // Row security decides which links this actor can see, so a file of
      // another practice's — or of a client this person may not read — is
      // simply not there. A 404, never a 403 that confirms it exists.
      //
      // Written before the answer, as the file door's own refusal is
      // (./file.ts) and for the same reason: reaching for the export of a
      // client off your schedule is an attempt worth recording. The client is
      // null because the one row that would name it is the row row security
      // has just refused to hand over.
      await logRefusal(db, 'document', params.data.documentId, null, ['not_found']);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    // Handing somebody the means to open a client's file is the read worth
    // recording, and signing is the only moment it can be recorded
    // (docs/SEAMS.md). Before the link, every time.
    await auditDocumentRead(db, { id: params.data.documentId, clientId: row.client_id });
    const url = await storage.getSignedUrl(row.storage_key, DEFAULT_SIGNED_URL_TTL_SECONDS);
    return c.json(
      FileLinkResponse.parse({ url, expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS }),
    );
  });
}
