import { createHash, randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { clientDocumentKey } from '../../../../domain/shared';
// By its own path, as app/api/assessments/file.ts imports it: the seam's
// retention arithmetic is not in the shared barrel.
import { documentRetentionUntil } from '../../../../domain/shared/storage';
import { figuresNamedIn } from '../../../../domain/reports/qeeg/figuresNamed';
import { validateQeegContent } from '../../../../domain/reports/qeeg/shape';
import { logAction } from '../../_middleware/audit';
import type { ApiEnv, Db } from '../../_middleware/request-context';
import { mayDraftReport } from '../access';
import { requiredReason } from '../reason';
import { readReport, type ReportRecord } from '../source';
import {
  FIGURE_SENTENCES,
  FigureDigest,
  FigureFiledResponse,
  FigureQuery,
  FigureRemovedResponse,
  type FigureRefusalCode,
} from './figureSchema';
import { databaseRefusal } from './databaseRefusal';
import { verifyMap } from './verifyMap';

/**
 * A brain-map draft's pictures (docs/SPEC/reports-qeeg.md sections 9 and 14):
 * `PUT /api/reports/:id/figures` files one, `DELETE
 * /api/reports/:id/figures/:figureId` takes one away.
 *
 * **A door of the report's own** (section 9, point 1). The assessment's file
 * door refuses images on purpose and is not widened: a past record has no
 * assessment to attach to, and a picture in a report must be frozen with the
 * report. So this door files against a DRAFT, and migration 604's link table
 * and guard freeze what it filed the moment the report leaves draft.
 *
 * **Raw bytes, checked for what they are.** The browser normalises every map
 * to an opaque 8-bit RGB PNG before sending it (point 2). The server checks the
 * declared digest over the bytes it received, then that the bytes are exactly
 * that kind of picture and within the caps (`verifyMap`), and refuses anything
 * else with a sentence the form can show (point 3). It never re-encodes: what
 * is filed is what was sent.
 *
 * **Row first, bytes after the commit**, as the assessment's door and every
 * door here does (docs/SEAMS.md): a store cannot be rolled back and a
 * transaction can. A retry with the same digest is handed the same picture,
 * and puts the bytes back if a first attempt's put never landed.
 *
 * **Both doors move the draft's stamp**, so the answer carries the new
 * `savedAt` and the editor's next save is made over it (brief L, "For PR 7").
 *
 * **Who may.** Whoever may write the draft (`report.draft`): the owner, the
 * lead practitioner, a practitioner with the client on their schedule, whom
 * row security alone lets read the report; a draft read from the old tool's
 * file only the first two (reports-02 request 6). Asked here, and again by
 * the database functions, which are the only way a link is written.
 *
 * **Every call carries a reason** (`X-Reason`), as a brain-map save does: each
 * writes rows to the trail, and the reason is written beside them.
 */

const Params = z.object({ id: z.uuid() });
const RemoveParams = z.object({ id: z.uuid(), figureId: z.uuid() });

/** A refusal of the picture itself, with its sentence. */
function refused(c: Context<ApiEnv>, code: FigureRefusalCode, status: 413 | 415 | 422) {
  return c.json(
    {
      error: status === 413 ? 'payload_too_large' : 'unprocessable',
      code,
      sentence: FIGURE_SENTENCES[code],
      requestId: c.get('requestId'),
    },
    status,
  );
}

/** A database function's refusal as an answer, or the error again for the handler. */
function answerFor(c: Context<ApiEnv>, error: unknown): Response {
  const answer = databaseRefusal(error);
  if (answer === null) throw error;
  return c.json({ ...answer.body, requestId: c.get('requestId') }, answer.status);
}

const CONDITION_WORDS: Readonly<Record<'eyes_open' | 'eyes_closed', string>> = {
  eyes_open: 'eyes open',
  eyes_closed: 'eyes closed',
};

/** How the form names a map's condition and place, for the sentence of a second upload. */
function placeWords(
  condition: 'eyes_open' | 'eyes_closed' | null,
  position: number | null,
): string {
  const kept = condition === null ? 'with no condition' : CONDITION_WORDS[condition];
  return position === null ? `${kept}, in no place` : `${kept}, in place ${position + 1}`;
}

type Door = { ok: true; report: ReportRecord } | { ok: false; response: Response };

/**
 * The questions both doors ask before touching anything, in the order the
 * draft route asks them: a reason, the report as the caller may see it, the
 * caller's right to write it, and whether it is a brain-map draft at all.
 */
async function openDoor(c: Context<ApiEnv>, reportId: string, now: Date): Promise<Door> {
  const requestId = c.get('requestId');
  const db = c.get('db');
  if ((await requiredReason(db)) === null) {
    return { ok: false, response: c.json({ error: 'reason_required', requestId }, 400) };
  }
  const report = await readReport(db, reportId);
  if (!report) {
    // Another practice's, a client off this practitioner's schedule, or none.
    return { ok: false, response: c.json({ error: 'not_found', requestId }, 404) };
  }
  const actor = c.get('actor');
  const ownerOrLead = actor.roles.includes('owner') || actor.roles.includes('lead_practitioner');
  if (!mayDraftReport(actor, report.client_id, now)) {
    return { ok: false, response: c.json({ error: 'forbidden', requestId }, 403) };
  }
  if (report.imported_from !== null && !ownerOrLead) {
    return { ok: false, response: c.json({ error: 'forbidden', requestId }, 403) };
  }
  switch (report.kind) {
    case 'qeeg':
      break;
    case 'session':
    case 'progress':
      return {
        ok: false,
        response: c.json({ error: 'unprocessable', code: 'wrong_kind', requestId }, 422),
      };
    default: {
      const unknown: never = report.kind;
      throw new Error(`A report of an unknown kind: ${String(unknown)}`);
    }
  }
  return { ok: true, report };
}

function notADraft(c: Context<ApiEnv>): Response {
  return c.json(
    {
      error: 'unprocessable',
      code: 'not_a_draft',
      sentence: FIGURE_SENTENCES.not_a_draft,
      requestId: c.get('requestId'),
    },
    422,
  );
}

async function savedAtOf(db: Db, reportId: string): Promise<string> {
  const report = await readReport(db, reportId);
  if (!report) throw new Error('The report read a moment ago is not there.');
  return report.saved_at;
}

type LinkRow = {
  document_id: string;
  sha256: string;
  width_px: number;
  height_px: number;
  condition: 'eyes_open' | 'eyes_closed' | null;
  position: number | null;
  borrowed: boolean;
  storage_key: string | null;
};

async function linkOf(db: Db, reportId: string, documentId: string): Promise<LinkRow | null> {
  const found = await db.query<LinkRow>(
    "select f.document_id, encode(f.sha256, 'hex') as sha256, f.width_px, f.height_px, " +
      'f.condition, f.position, f.borrowed_from_report_id is not null as borrowed, ' +
      'd.storage_key from report_figure f ' +
      'left join document d on d.tenant_id = f.tenant_id and d.id = f.document_id ' +
      'where f.tenant_id = app.current_tenant_id() and f.report_id = $1 and f.document_id = $2',
    [reportId, documentId],
  );
  return found.rows[0] ?? null;
}

/** Where the report's saved content names this picture, or null where it does not. */
async function inUseAt(db: Db, reportId: string, figureId: string): Promise<string | null> {
  const report = await readReport(db, reportId);
  const content = validateQeegContent(report?.content);
  if (!content.ok) return null;
  const named = figuresNamedIn(content.content).find((entry) => entry.ref.figureId === figureId);
  return named?.path ?? null;
}

export function mountReportFigures(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.put('/api/reports/:id/figures', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const params = Params.safeParse(c.req.param());
    const query = FigureQuery.safeParse(c.req.query());
    if (!params.success || !query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const storage = c.get('storage');
    if (!storage) {
      // A row naming bytes nobody can write is a record of a file that does
      // not exist.
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }
    const mimeType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (mimeType !== 'image/png') {
      return c.json({ error: 'unsupported_media_type', requestId }, 415);
    }
    const declared = FigureDigest.safeParse(c.req.header('x-sha256') ?? '');
    if (!declared.success) {
      return c.json({ error: 'bad_request', code: 'digest_missing', requestId }, 400);
    }

    const reportId = params.data.id;
    const door = await openDoor(c, reportId, now());
    if (!door.ok) return door.response;
    if (door.report.status !== 'draft') return notADraft(c);

    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength === 0) {
      return c.json({ error: 'bad_request', code: 'empty_body', requestId }, 400);
    }
    const computed = createHash('sha256').update(body).digest('hex');
    if (computed !== declared.data) {
      return c.json({ error: 'bad_request', code: 'digest_mismatch', requestId }, 400);
    }
    const checked = verifyMap(body);
    if (!checked.ok) {
      const status =
        checked.code === 'too_many_bytes' ? 413 : checked.code === 'not_a_png' ? 415 : 422;
      return refused(c, checked.code, status);
    }

    const clientId = door.report.client_id;
    const documentId = randomUUID();
    // Ids and nothing else, from the seam's own helper (docs/SEAMS.md).
    const storageKey = clientDocumentKey(c.get('actor').tenantId, clientId, documentId);
    const retentionUntil = documentRetentionUntil('report_figure', now());

    // The filing in a savepoint of its own: the two refusals the database
    // may give after the reads above (the report signed meanwhile, or an
    // eighth picture filed by another tab) are answers, and a caught error
    // left standing would abort the transaction.
    await db.query('savepoint report_figure_file');
    let filedId: string;
    try {
      const filed = await db.query<{ document_id: string }>(
        'select app.file_report_figure($1, $2, $3, $4, $5, $6, $7, $8::smallint, $9) as document_id',
        [
          reportId,
          documentId,
          storageKey,
          Buffer.from(computed, 'hex'),
          checked.widthPx,
          checked.heightPx,
          query.data.condition ?? null,
          query.data.position ?? null,
          retentionUntil,
        ],
      );
      const id = filed.rows[0]?.document_id;
      if (!id) throw new Error('Filing a map did not return an id.');
      filedId = id;
    } catch (error) {
      if (databaseRefusal(error) === null) throw error;
      await db.query('rollback to savepoint report_figure_file');
      return answerFor(c, error);
    }

    const link = await linkOf(db, reportId, filedId);
    if (!link) throw new Error('The map filed a moment ago has no link.');
    const figure = {
      figureId: filedId,
      sha256: link.sha256,
      widthPx: link.width_px,
      heightPx: link.height_px,
      condition: link.condition,
      position: link.position,
      borrowed: link.borrowed,
    };

    if (filedId !== documentId) {
      // These bytes are already this report's: hand that picture back. A row
      // is not bytes, so a first attempt whose put never landed is repaired
      // with the bytes in hand, which are the filed picture's own by digest.
      const key = link.storage_key;
      if (key !== null && !(await storage.exists(key))) {
        c.get('afterCommit')(async () => {
          await storage.put(key, body, 'image/png');
        });
      }
      // The same picture asked for with another condition or place is not
      // answered with the first link's values as if it had been taken: the
      // form would show one thing and the report hold another. It is refused,
      // saying what the report holds; the form removes it and adds it again.
      const askedCondition = query.data.condition ?? null;
      const askedPosition = query.data.position ?? null;
      if (askedCondition !== link.condition || askedPosition !== link.position) {
        return c.json(
          {
            error: 'conflict',
            code: 'already_on_report',
            sentence:
              `This picture is already on the report as ${placeWords(link.condition, link.position)}. ` +
              'Remove it first to add it again with another condition or place.',
            figure,
            requestId,
          },
          409,
        );
      }
      return c.json(
        FigureFiledResponse.parse({ figure, savedAt: await savedAtOf(db, reportId) }),
        200,
      );
    }

    c.get('afterCommit')(async () => {
      await storage.put(storageKey, body, 'image/png');
    });
    // What was done and nothing of the picture: the link row itself is on the
    // trail with its ids, written by the audit trigger with the reason.
    await logAction(
      db,
      'report.figure_filed',
      { type: 'report', id: reportId, clientId },
      figure.condition === null ? {} : { condition: figure.condition },
    );
    return c.json(
      FigureFiledResponse.parse({ figure, savedAt: await savedAtOf(db, reportId) }),
      201,
    );
  });

  api.delete('/api/reports/:id/figures/:figureId', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const params = RemoveParams.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const storage = c.get('storage');
    if (!storage) {
      // A picture removed deletes its bytes after the commit; with no store
      // to delete them from they would outlive the row that names them.
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }
    const { id: reportId, figureId } = params.data;
    const door = await openDoor(c, reportId, now());
    if (!door.ok) return door.response;
    // Drafts only. A withdrawn past record's maps are removed by the
    // withdraw's own door (section 11, point 7), not by this one.
    if (door.report.status !== 'draft') return notADraft(c);

    await db.query('savepoint report_figure_remove');
    let key: string | null;
    try {
      const removed = await db.query<{ key: string | null }>(
        'select app.remove_report_figure($1, $2) as key',
        [reportId, figureId],
      );
      key = removed.rows[0]?.key ?? null;
      // A picture the saved draft still prints is not taken out from under
      // it: the draft is saved without it first, so a saved draft only ever
      // names the pictures it holds. Read after the function, which holds the
      // report's row, so a save on another tab cannot land in between.
      const inUse = await inUseAt(db, reportId, figureId);
      if (inUse !== null) {
        await db.query('rollback to savepoint report_figure_remove');
        return c.json(
          { error: 'conflict', code: 'figure_in_use', field: `${inUse}.figureId`, requestId },
          409,
        );
      }
    } catch (error) {
      if (databaseRefusal(error) === null) throw error;
      await db.query('rollback to savepoint report_figure_remove');
      return answerFor(c, error);
    }

    if (key !== null) {
      const gone = key;
      c.get('afterCommit')(async () => {
        await storage.delete(gone);
      });
    }
    await logAction(
      db,
      'report.figure_removed',
      { type: 'report', id: reportId, clientId: door.report.client_id },
      {},
    );
    return c.json(
      FigureRemovedResponse.parse({ removed: true, savedAt: await savedAtOf(db, reportId) }),
      200,
    );
  });
}
