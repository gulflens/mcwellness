import type { Hono } from 'hono';
import { figuresNamedIn } from '../../../../domain/reports/qeeg/figuresNamed';
import { validateQeegContent } from '../../../../domain/reports/qeeg/shape';
import { logAction } from '../../_middleware/audit';
import type { ApiEnv, Db } from '../../_middleware/request-context';
import { isUuid } from '../../billing/ids';
import { mayDraftReport } from '../access';
import { requiredReason } from '../reason';
import { TwinInput, TwinResponse } from '../schema';
import { asRow, readReport } from '../source';

/**
 * `POST /api/reports/:id/twin`: "Sign the other language"
 * (docs/SPEC/reports-qeeg.md sections 8 and 14).
 *
 * **One recording, a report in each language, each signed as its own.** A
 * report is given one language and frozen in it at signing (reports-v1), so
 * the Arabic report of a recording signed in English is a second report, with
 * its own reference. This route makes its draft from the signed one: the
 * other locale, `twin_of_id` naming the first, the same content, the same
 * comparison, the same service, and the first report's maps, borrowed, so
 * nothing is copied and the frozen pictures are printed by both.
 *
 * **Only a signed report that stands.** A draft may still change, so a second
 * language made from it could disagree with what is later signed; a past
 * record has no pages of this app's; a version already replaced is not the one
 * a household should be given in another language. And only one second
 * language at a time: while a draft or a signed report in the other language
 * names this one, or this one is itself the other language of a report, the
 * request is answered with where that report is, never a second one beside it.
 *
 * **The same people as a draft** (`report.draft`, docs/CHANGE-REQUESTS/
 * reports-02.md request 6): whoever may write a report for this client, a
 * practitioner on her schedule included. It begins a draft, not a change to
 * anything signed; the first report is left exactly as it was, and the draft
 * is signed through the ordinary door by a person whose certificate allows it.
 * A coordinator, who drafts nothing, is refused. Audited
 * with its reason (`X-Reason`, stamped by the fence on the transaction), on
 * the new row by the trigger and as `report.twin_started` beside it; every
 * refusal after the report is found is written as `report.twin_refused`
 * before it is answered.
 *
 * **One at a time.** The signed row is locked before the question of whether
 * a second language exists is asked, so two requests at once make one draft
 * and the second is told where it is.
 */

const LOCK_SQL =
  'select id from report where tenant_id = app.current_tenant_id() and id = $1 ' +
  "and status = 'issued' for update";

const CURRENT_TWIN_SQL =
  'select id, status::text as status from report ' +
  'where tenant_id = app.current_tenant_id() and twin_of_id = $1 ' +
  "and status in ('draft', 'issued') order by created_at desc, id limit 1";

const CLIENT_SQL =
  'select status::text as status from client ' +
  'where tenant_id = app.current_tenant_id() and id = $1';

const INSERT_SQL =
  'insert into report (tenant_id, client_id, kind, locale, service_type_id, compared_with_id, ' +
  'twin_of_id, content, created_by) ' +
  "values (app.current_tenant_id(), $1, 'qeeg', $2::locale, $3, $4, $5, $6::jsonb, " +
  'app.current_actor_id()) returning id';

function codeOf(error: unknown): { code?: unknown; constraint?: unknown } {
  return typeof error === 'object' && error !== null
    ? (error as { code?: unknown; constraint?: unknown })
    : {};
}

async function currentTwin(db: Db, reportId: string) {
  const found = await db.query<{ id: string; status: string }>(CURRENT_TWIN_SQL, [reportId]);
  return found.rows[0] ?? null;
}

export function mountReportTwin(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/reports/:id/twin', async (c) => {
    const requestId = c.get('requestId');
    const reportId = c.req.param('id');
    if (!isUuid(reportId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const raw: unknown = await c.req.json().catch(() => ({}));
    if (!TwinInput.safeParse(raw ?? {}).success) {
      // The language, the content and the maps are the signed report's; a
      // body that names any of them is refused rather than read.
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    const actor = c.get('actor');

    const first = await readReport(db, reportId);
    if (!first) return c.json({ error: 'not_found', requestId }, 404);

    const target = { type: 'report', id: first.id, clientId: first.client_id } as const;
    /** Written before the answer, as every refusal of a correction is. */
    const refuse = async (
      status: 403 | 409 | 422,
      code: string,
      extra: Record<string, unknown> = {},
    ): Promise<Response> => {
      await logAction(db, 'report.twin_refused', target, { reason: code });
      return c.json(
        {
          error: status === 403 ? 'forbidden' : status === 409 ? 'conflict' : 'unprocessable',
          code,
          ...extra,
          requestId,
        },
        status,
      );
    };

    if (!mayDraftReport(actor, first.client_id, now())) {
      return refuse(403, 'not_permitted');
    }
    if ((await requiredReason(db)) === null) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    switch (first.kind) {
      case 'qeeg':
        break;
      case 'session':
      case 'progress':
        // One language each: only a brain map is written once and signed in two.
        return refuse(422, 'wrong_kind');
      default: {
        const unknown: never = first.kind;
        return unknown;
      }
    }
    if (first.imported_from !== null || first.status === 'imported') {
      return refuse(422, 'imported_record');
    }
    switch (first.status) {
      case 'issued':
        break;
      case 'draft':
        return refuse(422, 'not_signed');
      case 'superseded':
        return refuse(422, 'already_superseded');
      default:
        return refuse(422, 'not_signed');
    }
    if (first.twin_of_id !== null) {
      // This report is itself the other language of one: that one is its twin.
      return refuse(409, 'twin_exists', { twinId: first.twin_of_id });
    }

    const found = await db.query<{ status: string }>(CLIENT_SQL, [first.client_id]);
    const client = found.rows[0];
    if (!client) return c.json({ error: 'not_found', requestId }, 404);
    if (client.status === 'erased') return refuse(422, 'client_erased');

    const checked = validateQeegContent(first.content);
    if (!checked.ok) {
      return refuse(422, 'invalid_content', { field: checked.refusals[0]?.path ?? '' });
    }

    await db.query('savepoint qeeg_twin');
    const locked = await db.query<{ id: string }>(LOCK_SQL, [first.id]);
    if (!locked.rows[0]) {
      // Corrected between the read above and the lock.
      await db.query('rollback to savepoint qeeg_twin');
      return refuse(422, 'already_superseded');
    }
    const existing = await currentTwin(db, first.id);
    if (existing) {
      await db.query('rollback to savepoint qeeg_twin');
      return refuse(409, 'twin_exists', { twinId: existing.id, status: existing.status });
    }

    const locale = first.locale === 'en' ? 'ar' : 'en';
    let written: { rows: { id: string }[] };
    try {
      written = await db.query<{ id: string }>(INSERT_SQL, [
        first.client_id,
        locale,
        first.service_type_id,
        first.compared_with_id,
        first.id,
        JSON.stringify(checked.content),
      ]);
    } catch (error) {
      const { code, constraint } = codeOf(error);
      if (code !== '23503' || constraint !== 'report_compared_with_comparable') throw error;
      await db.query('rollback to savepoint qeeg_twin');
      return refuse(409, 'cannot_compare', { reason: 'withdrawn', field: 'comparedWith.reportId' });
    }
    const id = written.rows[0]?.id;
    if (!id) throw new Error('A second-language brain-map draft was not written.');

    // Every picture it prints, borrowed from the signed report, which holds each.
    const borrowed = new Set<string>();
    for (const figure of figuresNamedIn(checked.content)) {
      const { figureId } = figure.ref;
      if (borrowed.has(figureId)) continue;
      borrowed.add(figureId);
      try {
        await db.query('select app.borrow_report_figure($1, $2, $3)', [id, first.id, figureId]);
      } catch (error) {
        const { code } = codeOf(error);
        if (code === '42501') {
          await db.query('rollback to savepoint qeeg_twin');
          return refuse(403, 'not_permitted');
        }
        if (code === '23503') {
          await db.query('rollback to savepoint qeeg_twin');
          return refuse(422, 'map_not_held', { field: `${figure.path}.figureId` });
        }
        throw error;
      }
    }
    await db.query('release savepoint qeeg_twin');

    await logAction(db, 'report.twin_started', target, { locale, twinId: id });

    const record = await readReport(db, id);
    if (!record) return c.json({ error: 'not_found', requestId }, 404);
    return c.json(TwinResponse.parse({ report: asRow(record) }), 201);
  });
}
