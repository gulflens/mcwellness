import type { Hono } from 'hono';
import { canSupersede, validateContent } from '../../../domain/reports';
import { cleanText } from '../_middleware/text';
import { logAction } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { isUuid } from '../billing/ids';
import { mayDraftReport } from './access';
import { SupersedeInput, SupersedeResponse } from './schema';
import { asRow, readReport } from './source';

/**
 * `POST /api/reports/:id/supersede` — correcting an issued report
 * (docs/SPEC/reports-v1.md section 3).
 *
 * **A correction is a new version, and it arrives as a draft.** This route
 * writes the successor with `supersedes_id`, its reason and the next version
 * number, and marks the standing version superseded in the same transaction —
 * and then stops. The new version is signed through the ordinary issuing door,
 * by a person, on a valid credential, after they have read the preview: a
 * correction that issued itself would be a document nobody looked at.
 *
 * **Both stay, and the superseded one is still readable.** A household may
 * already hold the first version; a record that quietly becomes the corrected
 * one cannot answer the only question that matters afterwards — what did they
 * actually receive? The household sees a superseded version only where the
 * practice actually sent them one (db/policies/reports/reports.sql).
 *
 * **A chain cannot fork.** `unique (tenant_id, supersedes_id)` on the table
 * means one successor per version, ever, so "which version is current" has one
 * answer (section 10, decision 5).
 */

const INSERT_SQL =
  'insert into report (tenant_id, client_id, kind, locale, service_type_id, ' +
  'coverage_from, coverage_to, content, version, supersedes_id, amendment_reason, created_by) ' +
  'values (app.current_tenant_id(), $1, $2::report_kind, $3::locale, $4, $5::date, $6::date, ' +
  '$7::jsonb, $8, $9, $10, app.current_actor_id()) returning id';

const MARK_SQL =
  "update report set status = 'superseded' " +
  "where tenant_id = app.current_tenant_id() and id = $1 and status = 'issued' returning id";

export function mountReportSupersede(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/reports/:id/supersede', async (c) => {
    const requestId = c.get('requestId');
    const reportId = c.req.param('id');
    if (!isUuid(reportId)) {
      // Checked before it reaches a uuid column, the way billing's own routes
      // check theirs: an id that is not one is a 400, not a raise dressed up
      // as a 500 on a path a stranger can call.
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const body = SupersedeInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }

    const db = c.get('db');
    const actor = c.get('actor');
    const standing = await readReport(db, reportId);
    if (!standing) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!mayDraftReport(actor, standing.client_id, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const answer = canSupersede(
      { status: standing.status, version: standing.version },
      cleanText(body.data.reason, 500),
    );
    if (!answer.ok) {
      await logAction(
        db,
        'report.supersede_refused',
        { type: 'report', id: reportId, clientId: standing.client_id },
        { reason: answer.code },
      );
      return c.json({ error: 'unprocessable', code: answer.code, requestId }, 422);
    }

    const checked = validateContent(standing.kind, body.data.content);
    if (!checked.ok) {
      return c.json(
        { error: 'bad_request', code: 'invalid_content', field: checked.field, requestId },
        400,
      );
    }

    const written = await db.query<{ id: string }>(INSERT_SQL, [
      standing.client_id,
      standing.kind,
      body.data.locale ?? standing.locale,
      standing.service_type_id,
      standing.coverage_from,
      standing.coverage_to,
      JSON.stringify(checked.content),
      standing.version + 1,
      standing.id,
      answer.reason,
    ]);
    const id = written.rows[0]?.id;
    if (!id) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const marked = await db.query<{ id: string }>(MARK_SQL, [reportId]);
    if (!marked.rows[0]) {
      // The standing version moved under this request — somebody else
      // superseded it first. The insert above is rolled back with this answer
      // rather than leaving a second successor the unique index would have
      // refused anyway.
      return c.json({ error: 'conflict', code: 'already_superseded', requestId }, 409);
    }

    // Sensitive, and carrying the reason: that is the whole value of keeping
    // both versions (section 8).
    await logAction(
      db,
      'report.superseded',
      { type: 'report', id: reportId, clientId: standing.client_id },
      { reason: answer.reason, version: String(standing.version + 1) },
    );

    const record = await readReport(db, id);
    if (!record) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    return c.json(SupersedeResponse.parse({ report: asRow(record) }), 201);
  });
}
