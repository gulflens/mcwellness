import type { Context } from 'hono';
import { figuresNamedIn } from '../../../../domain/reports/qeeg/figuresNamed';
import { validateQeegContent } from '../../../../domain/reports/qeeg/shape';
import { logAction } from '../../_middleware/audit';
import type { ApiEnv } from '../../_middleware/request-context';
import { SupersedeResponse, type QeegSupersedeInput } from '../schema';
import { asRow, readReport, type ReportRecord } from '../source';

/**
 * `POST /api/reports/:id/supersede` for a signed brain-map (qEEG) report
 * (docs/SPEC/reports-qeeg.md section 14). `supersede.ts` hands a row of this
 * kind here after it has asked who may correct it and whether it may be
 * corrected (`canSupersede`: a signed, standing version, and a reason).
 *
 * **The correction starts from what was signed.** The new draft carries the
 * signed report's content exactly, what it is compared with, its twin in the
 * other language, its language and its service, as the next version with the
 * reason. The request sends no content: a body that does is refused, because
 * a correction that began from whatever the screen held could quietly differ
 * from the page the household has, and the practitioner corrects it in the
 * form, where every save is checked, before it is signed again.
 *
 * **It borrows the maps** (section 9, point 7). Every picture the content
 * names, its own maps and, on a follow-up, both sides of each pair, is linked
 * to the new draft from the signed report, which holds each. So the new
 * draft's first save names only pictures it holds and is not refused with
 * `unlinked_figure`, and nothing is copied: the frozen document is printed by
 * both versions.
 *
 * **The signed report stays exactly as it was** (rule 7): marked superseded,
 * which the guard admits by the owner or the lead practitioner and nothing
 * more. A comparison the database no longer admits (the report compared with
 * was withdrawn since it was signed) is an answer, not a fault, and is
 * answered in the draft route's words.
 */

const INSERT_SQL =
  'insert into report (tenant_id, client_id, kind, locale, service_type_id, compared_with_id, ' +
  'twin_of_id, content, version, supersedes_id, amendment_reason, created_by) ' +
  "values (app.current_tenant_id(), $1, 'qeeg', $2::locale, $3, $4, $5, $6::jsonb, $7, $8, $9, " +
  'app.current_actor_id()) returning id';

const MARK_SQL =
  "update report set status = 'superseded' " +
  "where tenant_id = app.current_tenant_id() and id = $1 and status = 'issued' returning id";

function codeOf(error: unknown): { code?: unknown; constraint?: unknown } {
  return typeof error === 'object' && error !== null
    ? (error as { code?: unknown; constraint?: unknown })
    : {};
}

export async function supersedeQeeg(
  c: Context<ApiEnv>,
  standing: ReportRecord,
  input: QeegSupersedeInput,
  reason: string,
): Promise<Response> {
  const requestId = c.get('requestId');
  if (input.content !== undefined) {
    return c.json(
      {
        error: 'bad_request',
        code: 'route_owned',
        field: 'content',
        fields: ['content'],
        requestId,
      },
      400,
    );
  }
  if (input.locale !== undefined && input.locale !== standing.locale) {
    return c.json({ error: 'unprocessable', code: 'locale_fixed', requestId }, 422);
  }
  const checked = validateQeegContent(standing.content);
  if (!checked.ok) {
    // A signed body the shape no longer reads, or one an erasure cleared.
    return c.json(
      {
        error: 'unprocessable',
        code: 'invalid_content',
        field: checked.refusals[0]?.path ?? '',
        requestId,
      },
      422,
    );
  }
  const db = c.get('db');
  const target = { type: 'report', id: standing.id, clientId: standing.client_id } as const;

  await db.query('savepoint qeeg_supersede');
  let written: { rows: { id: string }[] };
  try {
    written = await db.query<{ id: string }>(INSERT_SQL, [
      standing.client_id,
      standing.locale,
      standing.service_type_id,
      standing.compared_with_id,
      standing.twin_of_id,
      JSON.stringify(checked.content),
      standing.version + 1,
      standing.id,
      reason,
    ]);
  } catch (error) {
    const { code, constraint } = codeOf(error);
    if (code !== '23503' || constraint !== 'report_compared_with_comparable') throw error;
    await db.query('rollback to savepoint qeeg_supersede');
    return c.json(
      {
        error: 'conflict',
        code: 'cannot_compare',
        reason: 'withdrawn',
        field: 'comparedWith.reportId',
        requestId,
      },
      409,
    );
  }
  const id = written.rows[0]?.id;
  if (!id) throw new Error('A corrected brain-map draft was not written.');

  const marked = await db.query<{ id: string }>(MARK_SQL, [standing.id]);
  if (!marked.rows[0]) {
    // Raised, not returned, for supersede.ts's reason: a returned answer
    // would commit a successor beside a version that still stands.
    throw new Error('The standing version could not be marked superseded; the draft rolls back.');
  }

  const borrowed = new Set<string>();
  for (const figure of figuresNamedIn(checked.content)) {
    const { figureId } = figure.ref;
    if (borrowed.has(figureId)) continue;
    borrowed.add(figureId);
    try {
      await db.query('select app.borrow_report_figure($1, $2, $3)', [id, standing.id, figureId]);
    } catch (error) {
      const { code } = codeOf(error);
      if (code === '42501') {
        // The database reads who may touch a report's maps as the route reads
        // who may correct one; at the edge (a record erased meanwhile) it is
        // an answer, and nothing of the correction stays.
        await db.query('rollback to savepoint qeeg_supersede');
        return c.json({ error: 'forbidden', code: 'not_permitted', requestId }, 403);
      }
      if (code === '23503') {
        // A picture the signed report names but does not hold: signing
        // refuses that, so only a row written some other way reaches here.
        await db.query('rollback to savepoint qeeg_supersede');
        return c.json(
          {
            error: 'unprocessable',
            code: 'map_not_held',
            field: `${figure.path}.figureId`,
            requestId,
          },
          422,
        );
      }
      throw error;
    }
  }
  await db.query('release savepoint qeeg_supersede');

  await logAction(db, 'report.superseded', target, {
    reason,
    version: String(standing.version + 1),
  });

  const record = await readReport(db, id);
  if (!record) return c.json({ error: 'not_found', requestId }, 404);
  return c.json(SupersedeResponse.parse({ report: asRow(record) }), 201);
}
