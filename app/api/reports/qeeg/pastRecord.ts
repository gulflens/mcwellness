import type { Context, Hono } from 'hono';
import { figuresNamedIn } from '../../../../domain/reports/qeeg/figuresNamed';
import { LEGACY_FORMAT } from '../../../../domain/reports/qeeg/legacy/keys';
import { placeImportedMaps } from '../../../../domain/reports/qeeg/legacy/placeImport';
import { ownLinksNotNamed } from '../../../../domain/reports/qeeg/links';
import { validateQeegContent } from '../../../../domain/reports/qeeg/shape';
import { isRecord } from '../../../../domain/reports/qeeg/text';
import type { MapEntry, Ordered } from '../../../../domain/reports/qeeg/types';
import { logAction } from '../../_middleware/audit';
import type { ApiEnv, Db } from '../../_middleware/request-context';
import { isUuid } from '../../billing/ids';
import { mayImportReport } from '../access';
import { requiredReason } from '../reason';
import {
  ImportInput,
  ImportResponse,
  KeepImportInput,
  PastRecordResponse,
  REPORT_IMPORT_PATH,
  WithdrawImportInput,
} from '../schema';
import { asRow, readReport, type ReportRecord } from '../source';
import { linksOf, picturesOf } from './pages';

/**
 * A past record from the practice's old report tool
 * (docs/SPEC/reports-qeeg.md sections 11 and 14): `POST /api/reports/qeeg/
 * import` brings one in as a draft, its pictures go through the ordinary maps
 * door (`figures.ts`) while it is a draft, `POST /:id/keep-import` places
 * them and keeps it, and `POST /:id/withdraw-import` withdraws one kept
 * against the wrong client.
 *
 * **The file never crosses the wire** (point 1). The browser reads it with
 * `readLegacyReport` and sends the reader's content and the fingerprint of the
 * file's bytes. The server cannot see the file, so it checks what it can:
 * that the fingerprint is a SHA-256, that the content's own provenance says
 * the same fingerprint and the one format the reader writes, and that the
 * content is what the reader makes (a first report from the old tool, its
 * person empty, its maps still to come) and passes the shape.
 *
 * **The person the file typed is never stored** (point 2). The body has no
 * field for them, and a content whose `subject` holds anything is refused by
 * the field: the name, age and sex a report prints are gathered from the
 * record, and a past record prints nothing.
 *
 * **The same file twice for one client is refused** (point 6), by its
 * fingerprint: migration 602's unique index `report_source_once_per_client`
 * on (tenant, client, `source_sha256`) is the boundary, and the route asks
 * first so it can say where that record is (a draft to go on with, or a kept
 * one). The index is not partial on withdrawn, so a record withdrawn from the
 * wrong client keeps that client's claim on the file, and the right client
 * may still bring it in.
 *
 * **Kept, then frozen** (point 4). The keep writes the pictures' places into
 * the content (`placeImportedMaps`, with a note naming each place left out,
 * point 5), checks each is this record's own, stored and what was filed, and
 * that none was filed and left unplaced (which the freeze would keep for no
 * reason), then calls `app.keep_imported_report`, which moves the draft to
 * `imported` and refuses one that holds nothing (migration 972). The freeze
 * of its pictures follows the status (604).
 *
 * **Withdrawn, never deleted** (point 7). The content is cleared and the
 * stamp set in one update, which 603's guard admits once; the maps are then
 * removed through `app.remove_report_figure`, one call for each, as 604
 * leaves to this door; the source stays. 603's key refuses the update while a
 * follow-up is compared with the record (`report_compared_with_comparable`:
 * the record's `comparable_id` would go, and a follow-up references it), and
 * the route answers that by code, naming the follow-ups to re-point first.
 *
 * **Who.** `report.import`: the owner and the lead practitioner (reports-02
 * request 6), asked here, by the row policy on insert and update, and by the
 * guard and the functions. Every call carries a reason (`X-Reason`); the
 * withdraw's is the one its stamp keeps. Refusals of the keep and the
 * withdraw, once the record is found, are written as `report.import_refused`.
 */

/** A past record's source never names a file: it names the format (J, ruling 3). */
const SOURCE_FORMAT = LEGACY_FORMAT;

/** The stamp's own cap (602's `report_withdraw_together`). */
const WITHDRAW_REASON_MOST = 200;

const CLIENT_SQL =
  'select status::text as status from client where tenant_id = app.current_tenant_id() and id = $1';

const SAME_FILE_SQL =
  'select id, status::text as status, withdrawn_at is not null as withdrawn from report ' +
  'where tenant_id = app.current_tenant_id() and client_id = $1 and source_sha256 = $2 ' +
  'order by created_at, id limit 1';

const INSERT_SQL =
  'insert into report (tenant_id, client_id, kind, locale, content, imported_from, ' +
  'source_sha256, created_by) values (app.current_tenant_id(), $1, ' +
  "'qeeg', 'en', $2::jsonb, $3, $4, app.current_actor_id()) returning id";

const PLACE_SQL =
  'update report set content = $2::jsonb ' +
  "where tenant_id = app.current_tenant_id() and id = $1 and kind = 'qeeg' " +
  "and status = 'draft' and imported_from is not null and updated_at = $3::timestamptz " +
  'returning id';

const WITHDRAW_SQL =
  "update report set content = '{}'::jsonb, withdrawn_at = now(), withdraw_reason = $2 " +
  "where tenant_id = app.current_tenant_id() and id = $1 and status = 'imported' " +
  'and withdrawn_at is null returning id';

const COMPARED_SQL =
  'select id from report where tenant_id = app.current_tenant_id() and compared_with_id = $1 ' +
  'order by created_at, id';

const LINK_SIZES_SQL =
  'select document_id, width_px, height_px from report_figure ' +
  'where tenant_id = app.current_tenant_id() and report_id = $1';

const SUBJECT_PARTS = ['nameAr', 'ageYears', 'sex'] as const;

function pgError(error: unknown): { code?: unknown; constraint?: unknown } {
  return typeof error === 'object' && error !== null
    ? (error as { code?: unknown; constraint?: unknown })
    : {};
}

type Status = 400 | 403 | 404 | 409 | 422 | 503;

function errorWord(status: Status): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable';
    case 503:
      return 'storage_unavailable';
    default: {
      const unknown: never = status;
      return unknown;
    }
  }
}

function answer(
  c: Context<ApiEnv>,
  status: Status,
  code: string,
  extra: Record<string, unknown> = {},
): Response {
  return c.json(
    { error: errorWord(status), code, ...extra, requestId: c.get('requestId') },
    status,
  );
}

/** The first part of the content's person that holds anything, as a field, or null. */
function personIn(content: Readonly<Record<string, unknown>>): string | null {
  if (!Object.hasOwn(content, 'subject')) return null;
  const subject = content['subject'];
  if (!isRecord(subject)) return 'subject';
  for (const part of SUBJECT_PARTS) {
    if (Object.hasOwn(subject, part) && subject[part] !== null) return `subject.${part}`;
  }
  return null;
}

async function clientStatus(db: Db, clientId: string): Promise<string | null> {
  const found = await db.query<{ status: string }>(CLIENT_SQL, [clientId]);
  return found.rows[0]?.status ?? null;
}

async function sameFile(db: Db, clientId: string, sha: string) {
  const found = await db.query<{ id: string; status: string; withdrawn: boolean }>(SAME_FILE_SQL, [
    clientId,
    sha,
  ]);
  return found.rows[0] ?? null;
}

/** Where a record of the same file already is: a draft to go on with, or a kept one. */
function alreadyImported(
  c: Context<ApiEnv>,
  found: { id: string; status: string; withdrawn: boolean },
): Response {
  return answer(c, 409, 'already_imported', {
    reportId: found.id,
    status: found.status,
    withdrawn: found.withdrawn,
  });
}

// ---------------------------------------------------------------------------
// Bringing one in
// ---------------------------------------------------------------------------

async function bringIn(c: Context<ApiEnv>, now: Date): Promise<Response> {
  const parsed = ImportInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return answer(c, 400, 'invalid_request');
  const input = parsed.data;
  const db = c.get('db');

  if (!mayImportReport(c.get('actor'), input.clientId, now)) {
    return answer(c, 403, 'not_permitted');
  }
  if ((await requiredReason(db)) === null) {
    return c.json({ error: 'reason_required', requestId: c.get('requestId') }, 400);
  }

  const sent = input.content;
  if (!isRecord(sent)) return answer(c, 400, 'invalid_content', { field: '' });
  const person = personIn(sent);
  if (person !== null) return answer(c, 400, 'route_owned', { field: person });

  const checked = validateQeegContent(sent);
  if (!checked.ok) {
    return answer(c, 400, 'invalid_content', {
      field: checked.refusals[0]?.path ?? '',
      refusals: checked.refusals,
    });
  }
  const content = checked.content;
  if (content.provenance.origin !== 'legacy_tool') {
    return answer(c, 400, 'not_a_past_record', { field: 'provenance' });
  }
  if (content.edition !== 'initial') {
    // The old tool wrote only first reports (point 8).
    return answer(c, 400, 'not_a_past_record', { field: 'edition' });
  }
  if (content.provenance.sourceSha256 !== input.sourceSha256) {
    return answer(c, 400, 'digest_mismatch', { field: 'provenance.sourceSha256' });
  }
  if (Object.keys(content.maps).length > 0) {
    // A map is named once it is filed against this record, which does not
    // exist yet: the pictures come through the maps door, then the keep.
    return answer(c, 400, 'maps_come_after', { field: 'maps' });
  }

  const status = await clientStatus(db, input.clientId);
  if (status === null) return answer(c, 404, 'not_found');
  if (status === 'erased') return answer(c, 422, 'client_erased');

  const found = await sameFile(db, input.clientId, input.sourceSha256);
  if (found) return alreadyImported(c, found);

  await db.query('savepoint qeeg_import');
  let id: string | undefined;
  try {
    const written = await db.query<{ id: string }>(INSERT_SQL, [
      input.clientId,
      JSON.stringify(content),
      SOURCE_FORMAT,
      input.sourceSha256,
    ]);
    id = written.rows[0]?.id;
  } catch (error) {
    const { code, constraint } = pgError(error);
    if (code !== '23505' || constraint !== 'report_source_once_per_client') throw error;
    // Brought in on another tab between the question and the write.
    await db.query('rollback to savepoint qeeg_import');
    const now_ = await sameFile(db, input.clientId, input.sourceSha256);
    if (!now_) throw error;
    return alreadyImported(c, now_);
  }
  await db.query('release savepoint qeeg_import');
  if (!id) throw new Error('A past record was not written.');

  await logAction(
    db,
    'report.imported',
    { type: 'report', id, clientId: input.clientId },
    { format: SOURCE_FORMAT },
  );
  const record = await readReport(db, id);
  if (!record) return answer(c, 404, 'not_found');
  return c.json(
    ImportResponse.parse({
      report: asRow(record),
      content: record.content,
      savedAt: record.saved_at,
    }),
    201,
  );
}

// ---------------------------------------------------------------------------
// The keep and the withdraw: the questions both ask first
// ---------------------------------------------------------------------------

type Opened =
  { ok: true; record: ReportRecord; refuse: Refuse } | { ok: false; response: Response };

type Refuse = (status: Status, code: string, extra?: Record<string, unknown>) => Promise<Response>;

async function openRecord(c: Context<ApiEnv>, now: Date): Promise<Opened> {
  const reportId = c.req.param('id') ?? '';
  if (!isUuid(reportId)) return { ok: false, response: answer(c, 400, 'invalid_request') };
  const db = c.get('db');
  const record = await readReport(db, reportId);
  if (!record) return { ok: false, response: answer(c, 404, 'not_found') };

  const target = { type: 'report', id: record.id, clientId: record.client_id } as const;
  const refuse: Refuse = async (status, code, extra = {}) => {
    // Written before the answer, as every refusal of an act on a report is.
    await logAction(db, 'report.import_refused', target, { reason: code });
    return answer(c, status, code, extra);
  };
  if (!mayImportReport(c.get('actor'), record.client_id, now)) {
    return { ok: false, response: await refuse(403, 'not_permitted') };
  }
  if ((await requiredReason(db)) === null) {
    return {
      ok: false,
      response: c.json({ error: 'reason_required', requestId: c.get('requestId') }, 400),
    };
  }
  switch (record.kind) {
    case 'qeeg':
      break;
    case 'session':
    case 'progress':
      return { ok: false, response: await refuse(422, 'not_a_past_record') };
    default: {
      const unknown: never = record.kind;
      return unknown;
    }
  }
  if (record.imported_from === null) {
    return { ok: false, response: await refuse(422, 'not_a_past_record') };
  }
  const status = await clientStatus(db, record.client_id);
  if (status === 'erased') return { ok: false, response: await refuse(422, 'client_erased') };
  return { ok: true, record, refuse };
}

// ---------------------------------------------------------------------------
// Keeping one
// ---------------------------------------------------------------------------

async function keepRecord(c: Context<ApiEnv>, now: Date): Promise<Response> {
  if (!isUuid(c.req.param('id') ?? '')) return answer(c, 400, 'invalid_request');
  const body = KeepImportInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return answer(c, 400, 'invalid_request');
  const storage = c.get('storage');
  if (!storage) return answer(c, 503, 'storage_unavailable');
  const opened = await openRecord(c, now);
  if (!opened.ok) return opened.response;
  const { record, refuse } = opened;
  const db = c.get('db');

  switch (record.status) {
    case 'draft':
      break;
    case 'imported':
      return refuse(422, 'already_kept');
    case 'issued':
    case 'superseded':
      return refuse(422, 'not_a_past_record');
    default: {
      const unknown: never = record.status;
      return unknown;
    }
  }
  if (!isRecord(record.content) || Object.keys(record.content).length === 0) {
    return refuse(422, 'nothing_to_keep');
  }
  const brought = validateQeegContent(record.content);
  if (!brought.ok) {
    return refuse(422, 'invalid_content', { field: brought.refusals[0]?.path ?? '' });
  }
  if (brought.content.edition !== 'initial') return refuse(422, 'not_a_past_record');

  const placed = placeImportedMaps(brought.content, {
    // Held to the shape below, once placed: a map that is not one is refused there by its field.
    maps: body.data.maps as Ordered<MapEntry>,
    leftOut: body.data.leftOut,
  });
  if (!placed.ok) {
    return answer(c, 400, 'invalid_placement', { field: placed.field, reason: placed.reason });
  }
  const checked = validateQeegContent(placed.content);
  if (!checked.ok) {
    return answer(c, 400, 'invalid_content', {
      field: checked.refusals[0]?.path ?? '',
      refusals: checked.refusals,
    });
  }
  const content = checked.content;

  // Each map this record's own, stored, and what was filed, with the size its link holds.
  const pictures = await picturesOf(db, storage, record.id, content);
  if (!pictures.ok) {
    const { code, field } = pictures.refusal;
    return code === 'unlinked_figure'
      ? answer(c, 400, code, { field })
      : refuse(409, code, { field });
  }
  const sizes = await db.query<{ document_id: string; width_px: number; height_px: number }>(
    LINK_SIZES_SQL,
    [record.id],
  );
  const byId = new Map(sizes.rows.map((row) => [row.document_id, row]));
  for (const figure of figuresNamedIn(content)) {
    const link = byId.get(figure.ref.figureId);
    const differs =
      link === undefined
        ? 'figureId'
        : link.width_px !== figure.ref.widthPx
          ? 'widthPx'
          : link.height_px !== figure.ref.heightPx
            ? 'heightPx'
            : null;
    if (differs !== null) {
      return answer(c, 400, 'figure_mismatch', { field: `${figure.path}.${differs}` });
    }
  }
  // A picture filed and never placed would be frozen with the record for no
  // reason anyone could give: placed, or removed through the maps door, first.
  const unplaced = ownLinksNotNamed(content, await linksOf(db, record.id));
  if (unplaced.length > 0) return refuse(422, 'unplaced_figures', { figures: unplaced });

  await db.query('savepoint qeeg_keep');
  const written = await db.query<{ id: string }>(PLACE_SQL, [
    record.id,
    JSON.stringify(content),
    body.data.savedAt,
  ]);
  if (!written.rows[0]) {
    await db.query('rollback to savepoint qeeg_keep');
    const current = await readReport(db, record.id);
    if (current && current.status !== 'draft') return refuse(422, 'already_kept');
    return refuse(409, 'stale_draft');
  }
  try {
    await db.query('select app.keep_imported_report($1)', [record.id]);
  } catch (error) {
    const { code } = pgError(error);
    await db.query('rollback to savepoint qeeg_keep');
    if (code === '23514') return refuse(422, 'nothing_to_keep');
    if (code === '42501') return refuse(403, 'not_permitted');
    if (code === '23001') return refuse(422, 'already_kept');
    throw error;
  }
  await db.query('release savepoint qeeg_keep');

  await logAction(
    db,
    'report.import_kept',
    { type: 'report', id: record.id, clientId: record.client_id },
    {
      maps: String(Object.keys(content.maps).length),
      leftOut: String(new Set(body.data.leftOut).size),
    },
  );
  const kept = await readReport(db, record.id);
  if (!kept) return answer(c, 404, 'not_found');
  return c.json(PastRecordResponse.parse({ report: asRow(kept) }), 200);
}

// ---------------------------------------------------------------------------
// Withdrawing one
// ---------------------------------------------------------------------------

async function withdrawRecord(c: Context<ApiEnv>, now: Date): Promise<Response> {
  if (!isUuid(c.req.param('id') ?? '')) return answer(c, 400, 'invalid_request');
  const body = WithdrawImportInput.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return answer(c, 400, 'invalid_request');
  const storage = c.get('storage');
  if (!storage) return answer(c, 503, 'storage_unavailable');
  const opened = await openRecord(c, now);
  if (!opened.ok) return opened.response;
  const { record, refuse } = opened;
  const db = c.get('db');

  const reason = (await requiredReason(db)) ?? '';
  if (reason.length > WITHDRAW_REASON_MOST) {
    return answer(c, 400, 'reason_too_long', { most: WITHDRAW_REASON_MOST });
  }
  switch (record.status) {
    case 'imported':
      break;
    case 'draft':
      // Not kept yet: nothing is frozen, and a draft is not withdrawn.
      return refuse(422, 'not_kept');
    case 'issued':
    case 'superseded':
      return refuse(422, 'not_a_past_record');
    default: {
      const unknown: never = record.status;
      return unknown;
    }
  }
  if (record.withdrawn) return refuse(422, 'already_withdrawn');

  const links = await linksOf(db, record.id);
  await db.query('savepoint qeeg_withdraw');
  let written: { rows: { id: string }[] };
  try {
    written = await db.query<{ id: string }>(WITHDRAW_SQL, [record.id, reason]);
  } catch (error) {
    const { code, constraint } = pgError(error);
    await db.query('rollback to savepoint qeeg_withdraw');
    if (code === '23503' && constraint === 'report_compared_with_comparable') {
      const compared = await db.query<{ id: string }>(COMPARED_SQL, [record.id]);
      return refuse(409, 'in_comparison', { reportIds: compared.rows.map((row) => row.id) });
    }
    if (code === '42501') return refuse(403, 'not_permitted');
    throw error;
  }
  if (!written.rows[0]) {
    await db.query('rollback to savepoint qeeg_withdraw');
    return refuse(422, 'already_withdrawn');
  }
  const gone: string[] = [];
  for (const link of links) {
    const removed = await db.query<{ key: string | null }>(
      'select app.remove_report_figure($1, $2) as key',
      [record.id, link.figureId],
    );
    const key = removed.rows[0]?.key ?? null;
    if (key !== null) gone.push(key);
  }
  await db.query('release savepoint qeeg_withdraw');
  if (gone.length > 0) {
    // A picture the record was the only holder of, and still mutable: its
    // bytes follow its row, after the commit (604). Frozen ones stay.
    c.get('afterCommit')(async () => {
      for (const key of gone) await storage.delete(key);
    });
  }

  await logAction(
    db,
    'report.import_withdrawn',
    { type: 'report', id: record.id, clientId: record.client_id },
    { maps: String(links.length) },
  );
  const withdrawn = await readReport(db, record.id);
  if (!withdrawn) return answer(c, 404, 'not_found');
  return c.json(PastRecordResponse.parse({ report: asRow(withdrawn) }), 200);
}

export function mountReportPastRecords(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
): void {
  api.post(REPORT_IMPORT_PATH, (c) => bringIn(c, now()));
  api.post('/api/reports/:id/keep-import', (c) => keepRecord(c, now()));
  api.post('/api/reports/:id/withdraw-import', (c) => withdrawRecord(c, now()));
}
