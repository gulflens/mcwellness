import type { Hono } from 'hono';
import { z } from 'zod';
import { clientDocumentKey } from '../../../domain/shared';
import { logAction } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import type { ServerStorageProvider } from '../_middleware/storage';
import { mayDraftReport } from './access';
import { readReport } from './source';

/**
 * `POST /api/reports/:id/withdraw` — an uploaded report taken back
 * (docs/SPEC/reports-v1.md section 12; migration 608 section 3).
 *
 * **Why an upload needs this and a report written here does not.** A report
 * written here is read over as a draft and signed, and a mistake in it is
 * corrected by a new version. An upload is filed issued in one step and the
 * household can open it at once, so a PDF filed against the wrong client — or
 * the wrong PDF — is in front of a household that should never see it until
 * somebody takes it back. That is this route: the row stamped withdrawn and
 * its title cleared, the household's row rule leaving it out from that moment,
 * the console no longer opening or sending it, and the file's bytes deleted.
 * The row itself stays, with its number, date and document link, so the trail
 * and the Reports tab still say which report was filed and withdrawn.
 *
 * **Who** is who may file one (`report.draft`: the owner, the lead
 * practitioner, a practitioner for a client on her schedule), asked here and
 * again by `app.withdraw_external_report`.
 *
 * **The reason is required, in `X-Reason`**, as an archive's is: it is what
 * the trail cannot reconstruct. The fence stamps the transaction with it, and
 * the function keeps it on the row (`withdraw_reason`, at most 200 characters).
 *
 * **The bytes go after the commit**, the upload door's order reversed: a
 * store cannot be rolled back, so the row changes first. What the store would
 * not give up then is found by `sweepWithdrawnReportFiles`, run hourly with
 * the erasure sweep, which asks the store rather than a column. A retry of
 * the withdraw answers 200 again and tries the bytes again.
 */

const REASON_MOST = 200;

const ANSWER_FOR: Readonly<Record<string, { status: 400 | 403 | 404 | 422; code: string }>> = {
  '42501': { status: 403, code: 'not_permitted' },
  P0002: { status: 404, code: 'not_found' },
  '23001': { status: 422, code: 'record_erased' },
  '22023': { status: 400, code: 'reason_required' },
};

function answerFor(error: unknown): { status: 400 | 403 | 404 | 422; code: string } | undefined {
  const { code, hint } = error as { code?: string; hint?: string };
  if (code === '23514') {
    return hint === 'not_an_upload' ? { status: 422, code: 'not_an_upload' } : undefined;
  }
  return ANSWER_FOR[code ?? ''];
}

export function mountReportWithdraw(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/reports/:id/withdraw', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found', requestId }, 404);
    // Asked before anything is read, so a request without one changes nothing.
    const reason = (c.req.header('x-reason') ?? '').trim();
    if (reason === '' || [...reason].length > REASON_MOST) {
      return c.json({ error: 'bad_request', code: 'reason_required', requestId }, 400);
    }

    const record = await readReport(db, id.data);
    if (!record) return c.json({ error: 'not_found', requestId }, 404);
    if (!mayDraftReport(actor, record.client_id, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (record.kind !== 'external') {
      // A report written here is corrected with a new version, never withdrawn.
      return c.json({ error: 'unprocessable', code: 'not_an_upload', requestId }, 422);
    }

    await db.query('savepoint withdraw_external_report');
    let answer: { withdrawn: boolean; storageKey: string | null };
    try {
      const found = await db.query<{ answer: { withdrawn: boolean; storageKey: string | null } }>(
        'select app.withdraw_external_report($1, $2) as answer',
        [id.data, reason],
      );
      const row = found.rows[0];
      if (!row) throw new Error('Withdrawing an uploaded report did not answer.');
      answer = row.answer;
      await db.query('release savepoint withdraw_external_report');
    } catch (error) {
      const refusal = answerFor(error);
      if (!refusal) throw error;
      await db.query('rollback to savepoint withdraw_external_report');
      return c.json(
        { error: refusal.status === 404 ? 'not_found' : 'refused', code: refusal.code, requestId },
        refusal.status,
      );
    }

    const storage = c.get('storage');
    const key = answer.storageKey;
    if (storage && key !== null) {
      c.get('afterCommit')(async () => {
        if (await storage.exists(key)) await storage.delete(key);
      });
    }
    if (answer.withdrawn) {
      // Ids and the kind; the reason is on the transaction, the title is gone.
      await logAction(
        db,
        'report.withdrawn',
        { type: 'report', id: record.id, clientId: record.client_id },
        { kind: 'external' },
      );
    }
    return c.json({ ok: true, withdrawn: answer.withdrawn });
  });
}

/** What one pass of the sweep did: counts only, never a key or a household. */
export type WithdrawnFilesSwept = { removed: number; stillThere: number; notOurs: number };

/**
 * The second attempt at deleting a withdrawn upload's bytes, run hourly with
 * the erasure sweep (app/api/scheduler.ts). Like that sweep it asks the store
 * whether each file is still there rather than trusting a column: withdrawals
 * are rare, so asking about each withdrawn upload every hour costs a handful
 * of lookups. A key is deleted only when it is the one the document's own ids
 * would build (`clientDocumentKey`), so a bad row can never name another
 * household's file for deletion.
 *
 * Nothing here throws for a store that refuses: the next hour tries again.
 */
export async function sweepWithdrawnReportFiles(
  db: Db,
  storage: ServerStorageProvider,
): Promise<WithdrawnFilesSwept> {
  const { rows } = await db.query<{
    tenant_id: string;
    client_id: string;
    document_id: string;
    storage_key: string;
  }>(
    'select r.tenant_id, r.client_id, d.id as document_id, d.storage_key from report r ' +
      'join document d on d.tenant_id = r.tenant_id and d.id = r.document_id ' +
      "where r.kind = 'external' and r.withdrawn_at is not null",
  );
  const swept: WithdrawnFilesSwept = { removed: 0, stillThere: 0, notOurs: 0 };
  for (const row of rows) {
    let ours: boolean;
    try {
      ours = row.storage_key === clientDocumentKey(row.tenant_id, row.client_id, row.document_id);
    } catch {
      // clientDocumentKey refuses ids it would not have built a key from.
      ours = false;
    }
    if (!ours) {
      swept.notOurs += 1;
      continue;
    }
    try {
      if (await storage.exists(row.storage_key)) {
        await storage.delete(row.storage_key);
        swept.removed += 1;
      }
    } catch {
      swept.stillThere += 1;
    }
  }
  return swept;
}
