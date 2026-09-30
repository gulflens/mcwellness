import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { canIssue } from '../../../../domain/reports';
import { missingForIssue } from '../../../../domain/reports/qeeg/complete';
import { ownLinksNotNamed } from '../../../../domain/reports/qeeg/links';
import { twinChangeIn } from '../../../../domain/reports/qeeg/twin';
import { validateQeegContent } from '../../../../domain/reports/qeeg/shape';
import { WORDING_STATUS } from '../../../../domain/reports/qeeg/wording';
import { isoDateIn } from '../../../../domain/shared';
import { clientDocumentKey, documentRetentionUntil } from '../../../../domain/shared/storage';
import { logAction, logRead } from '../../_middleware/audit';
import type { ApiEnv } from '../../_middleware/request-context';
import { practiceTimeZone } from '../gather';
import { requiredReason } from '../reason';
import { IssueResponse, QeegIssueInput } from '../schema';
import { asRow, readReport, type ReportRecord } from '../source';
import { signerFor, signingCredentials } from '../signer';
import { gatheredOnce, linksOf, pagesOf, picturesOf, signedFacts } from './pages';

/**
 * `POST /api/reports/:id/issue` for a brain-map (qEEG) draft
 * (docs/SPEC/reports-qeeg.md sections 9, 12 and 14). `issue.ts` hands a
 * draft of this kind here, after it has found the row, asked who may draft
 * and seen that it is still a draft.
 *
 * **Everything that can be refused is asked before a number is taken**, each
 * with its own code, so the form can say what to do: a save made since the
 * version on her screen (`stale_draft`); a client whose record was erased
 * (`client_erased`); anything left to fill (`incomplete`, with the list
 * `missingForIssue` gives, the same list the form counts); the words still a
 * draft in the report's language (`wording_draft`, section 6, point 1); a
 * picture uploaded to the draft and never placed on it (`unplaced_figures`,
 * with the list, so she places or removes each: nothing is stripped behind
 * her back); a map the report names whose bytes are gone or differ
 * (`map_missing`, `map_differs`, section 9, point 6); and the signer's
 * certificate, as for every report. Each refusal is written to the trail
 * before it is answered.
 *
 * **The other language of a signed report** (`twin_of_id`, section 8) signs
 * through this same door, with its own reference, and is refused while the
 * report it was made from no longer stands (`twin_out_of_step`), or when it
 * says anything that report does not beyond its own language's halves of
 * typed text (`twin_differs`).
 *
 * **Then one step, inside a savepoint.** The client's head is read from the
 * record once more and written onto the draft (section 14: "gathers the
 * client once more"); `app.issue_report` takes the number and writes the
 * signer's and the practice's snapshots; the pages are laid from what the
 * row now says, exactly as the repair path will lay them; and the PDF is
 * filed as a `document` with its digest. A page that runs over is found only
 * once the signature block is known, so it is refused by rolling back to the
 * savepoint: the number, the snapshot and the head go with it, and the answer
 * commits nothing but the refusal on the trail.
 *
 * **Leaving draft freezes the maps** (604's trigger): the pictures uploaded to
 * it become immutable documents and its links admit no change.
 *
 * **Audited with its reason** (`X-Reason`), as every brain-map save is: the
 * head written, the signature and the filing each carry it on the trail.
 */

const WRITE_HEAD_SQL =
  'update report set content = $2::jsonb ' +
  "where tenant_id = app.current_tenant_id() and id = $1 and kind = 'qeeg' " +
  "and status = 'draft' and imported_from is null and updated_at = $3::timestamptz " +
  'returning id';

/** The refusal a person reads, per reason the credential failed. */
const SIGNING_REFUSALS: Record<string, string> = {
  no_credential: 'no_signing_credential',
  credential_cannot_sign: 'credential_cannot_sign',
  credential_lapsed: 'credential_lapsed',
  credential_not_yet_valid: 'credential_not_yet_valid',
};

export async function issueQeeg(
  c: Context<ApiEnv>,
  draft: ReportRecord,
  raw: unknown,
  now: Date,
): Promise<Response> {
  const requestId = c.get('requestId');
  const input = QeegIssueInput.safeParse(raw);
  if (!input.success) {
    return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
  }
  const db = c.get('db');
  const actor = c.get('actor');
  const storage = c.get('storage');
  if (!storage) {
    return c.json({ error: 'storage_unavailable', requestId }, 503);
  }
  if ((await requiredReason(db)) === null) {
    return c.json({ error: 'reason_required', requestId }, 400);
  }
  const target = { type: 'report', id: draft.id, clientId: draft.client_id } as const;

  /** Written before the answer, as every refusal to sign is (reports-v1 section 8). */
  const refuse = async (
    status: 403 | 409 | 422,
    code: string,
    extra: Record<string, unknown> = {},
  ): Promise<Response> => {
    await logAction(db, 'report.issue_refused', target, { reason: code });
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

  if (draft.imported_from !== null) {
    // Read from the old tool's file: kept as a past record, never signed.
    return refuse(422, 'imported_draft');
  }
  if (draft.saved_at !== input.data.savedAt) {
    return refuse(409, 'stale_draft');
  }
  const checked = validateQeegContent(draft.content);
  if (!checked.ok) {
    return refuse(422, 'invalid_content', { field: checked.refusals[0]?.path ?? '' });
  }

  if (draft.twin_of_id !== null) {
    // The other language of a signed report (section 8): signed only while
    // that report stands. Corrected since, it says something this one does
    // not, so this one is out of step and is not signed.
    const first = await readReport(db, draft.twin_of_id);
    if (!first || first.status !== 'issued') {
      return refuse(409, 'twin_out_of_step', { twinOfId: draft.twin_of_id });
    }
    // Every save of it is held to the first report; asked once more here,
    // so a row written some other way is never signed as its twin.
    const from = validateQeegContent(first.content);
    const differs = from.ok ? twinChangeIn(from.content, checked.content, draft.locale) : '';
    if (differs !== null) return refuse(422, 'twin_differs', { field: differs });
  }

  const gathered = await gatheredOnce(db, draft.client_id, checked.content, now);
  if (!gathered.ok) {
    if (gathered.code === 'not_found') return c.json({ error: 'not_found', requestId }, 404);
    return refuse(422, 'client_erased');
  }
  // The record was read, and its details are about to be written onto the report.
  await logRead(db, 'client', draft.client_id, draft.client_id);
  const content = gathered.content;

  const missing = missingForIssue(content);
  if (missing.length > 0) return refuse(422, 'incomplete', { missing });

  if (WORDING_STATUS[draft.locale] === 'draft') {
    return refuse(422, 'wording_draft', { locale: draft.locale });
  }

  const unplaced = ownLinksNotNamed(content, await linksOf(db, draft.id));
  if (unplaced.length > 0) return refuse(422, 'unplaced_figures', { figures: unplaced });

  const pictures = await picturesOf(db, storage, draft.id, content);
  if (!pictures.ok) return refuse(422, pictures.refusal.code, { ...pictures.refusal });

  // The person doing it, and nobody else, on the credential they hold now:
  // asked here for the sentence, and again inside app.issue_report, which is
  // the answer that binds (issue.ts says why).
  const today = isoDateIn(now, await practiceTimeZone(db));
  const own = await signerFor(db, actor.userId);
  if (!own) {
    return c.json({ error: 'forbidden', code: 'not_a_practitioner', requestId }, 403);
  }
  const answer = canIssue(await signingCredentials(db, own.practitionerId), {
    practitionerId: own.practitionerId,
    serviceTypeId: draft.service_type_id,
    on: today,
  });
  if (!answer.ok) return refuse(403, SIGNING_REFUSALS[answer.code] ?? answer.code);

  await db.query('savepoint qeeg_issue');
  const headed = await db.query<{ id: string }>(WRITE_HEAD_SQL, [
    draft.id,
    JSON.stringify(content),
    input.data.savedAt,
  ]);
  if (!headed.rows[0]) {
    // Saved over, or signed, between the read above and this write.
    await db.query('rollback to savepoint qeeg_issue');
    return refuse(409, 'stale_draft');
  }
  const issued = await db.query<{ id: string }>(
    'select id from app.issue_report($1::uuid, $2::uuid, $3::date)',
    [draft.id, own.practitionerId, today],
  );
  if (!issued.rows[0]) throw new Error('Issuing a report did not return a row.');

  const record = await readReport(db, draft.id);
  const facts = record ? await signedFacts(db, storage, record, pictures.pictures) : null;
  const signedContent = record ? validateQeegContent(record.content) : null;
  if (!record || !facts || !signedContent?.ok) {
    // Raised, not returned, for issue.ts's reason: a returned answer would
    // commit a numbered, signed report with no document behind it.
    throw new Error('An issued brain-map report did not render; the issue was rolled back.');
  }
  const filed = pagesOf({ content: signedContent.content, locale: record.locale, facts });
  if (!filed.ok) {
    if (filed.code !== 'overrun') {
      throw new Error('An issued brain-map report did not render; the issue was rolled back.');
    }
    await db.query('rollback to savepoint qeeg_issue');
    return refuse(422, 'overrun', { parts: filed.notes.overflowing, layout: filed.notes });
  }

  const bytes = filed.bytes;
  const documentId = randomUUID();
  const key = clientDocumentKey(actor.tenantId, draft.client_id, documentId);
  const sha256 = createHash('sha256').update(bytes).digest();
  const retentionUntil = documentRetentionUntil('report', now);
  const filedRow = await db.query<{ document_id: string }>(
    'select app.file_report_document($1::uuid, $2::uuid, $3::text, $4::bytea, $5::timestamptz) ' +
      'as document_id',
    [draft.id, documentId, key, sha256, retentionUntil],
  );
  const filedId = filedRow.rows[0]?.document_id;
  if (!filedId) throw new Error('Filing a report document did not return an id.');
  await db.query('release savepoint qeeg_issue');

  if (filedId === documentId) {
    c.get('afterCommit')(async () => {
      // `overwrite` false: a second rendering never quietly replaces the first.
      const stored = await storage.put(key, bytes, 'application/pdf');
      if (stored.sha256 !== sha256.toString('hex')) {
        console.error(JSON.stringify({ requestId, after: 'commit', name: 'ReportHashMismatch' }));
      }
    });
  }

  await logAction(db, 'report.issued', target, {
    reference: record.reference ?? '',
    kind: record.kind,
    version: String(record.version),
  });

  const answered = await readReport(db, draft.id);
  return c.json(IssueResponse.parse({ report: asRow(answered ?? record) }), 201);
}
