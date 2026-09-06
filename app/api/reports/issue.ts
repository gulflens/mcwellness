import { createHash, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { canIssue } from '../../../domain/reports';
import { renderReport } from '../../../domain/reports/document';
import { isoDateIn } from '../../../domain/shared';
import { clientDocumentKey, documentRetentionUntil } from '../../../domain/shared/storage';
import { isUuid } from '../billing/ids';
import { documentFonts } from '../billing/fonts';
import { logAction } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { mayDraftReport } from './access';
import { practiceTimeZone } from './gather';
import { IssueInput, IssueResponse } from './schema';
import { asRow, documentFrom, readRecipient, readReport } from './source';
import { signerFor, signingCredentials } from './signer';

/**
 * `POST /api/reports/:id/issue` — the atomic sign-and-render of
 * docs/SPEC/reports-v1.md section 3.
 *
 * **Signing is a one-way door and this is the door.** In one transaction: the
 * credential is re-checked against this moment, the number is allocated, the
 * signer's four snapshots and the practice's identity block are written onto
 * the row, the PDF is rendered from what was just written, and the `document`
 * row is filed against the report. The bytes follow after the commit.
 *
 * **The credential is asked twice, on purpose.** `canIssue` in
 * `domain/reports` is asked first so a person gets a sentence — "that
 * certificate lapsed on the fifth" — rather than a database raise; then
 * `app.issue_report` (migration 600) asks the same question in SQL, as the
 * practice, and that is the answer that binds. Nothing about a role is asked
 * in either place: a role does not grant this (section 10, decision 6), and
 * the founder signs because she holds the certificate.
 *
 * **The signer is the person issuing** (section 10, decision 3). The request
 * body names nobody: the practitioner is read from the caller's own row here,
 * and `app.issue_report` refuses any other, so a lead practitioner cannot put
 * a colleague's name and certificate number on a document.
 *
 * **Why `report.document_id` is not `invoice.document_id` repeated.** 402 left
 * that column on a table nobody may update, so nothing could ever fill it in
 * and 407 had to invent a link table. Here the column is written inside this
 * transaction by `app.file_report_document`, and the guard trigger admits
 * exactly that one transition on an issued row and no other. The bytes go to
 * the store after the commit, as an invoice's do, because a store cannot be
 * rolled back and a transaction can — and a put that never ran is recoverable,
 * because rendering is deterministic: `app/api/reports/get.ts` re-renders from
 * the row and refuses when the fingerprint differs.
 */

/** The refusal a person reads, per reason the credential failed. */
const SIGNING_REFUSALS: Record<string, string> = {
  no_credential: 'no_signing_credential',
  credential_cannot_sign: 'credential_cannot_sign',
  credential_lapsed: 'credential_lapsed',
  credential_not_yet_valid: 'credential_not_yet_valid',
};

export function mountReportIssue(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/reports/:id/issue', async (c) => {
    const requestId = c.get('requestId');
    const reportId = c.req.param('id');
    if (!isUuid(reportId)) {
      // Checked before it reaches a uuid column, the way billing's own routes
      // check theirs: an id that is not one is a 400, not a raise dressed up
      // as a 500 on a path a stranger can call.
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const body = IssueInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const storage = c.get('storage');
    if (!storage) {
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }

    const db = c.get('db');
    const actor = c.get('actor');
    const draft = await readReport(db, reportId);
    if (!draft) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!mayDraftReport(actor, draft.client_id, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (draft.status !== 'draft') {
      return c.json({ error: 'unprocessable', code: 'already_issued', requestId }, 422);
    }

    const timeZone = await practiceTimeZone(db);
    const today = isoDateIn(now(), timeZone);

    // The person doing it, and nobody else: the request carries no signer and
    // `app.issue_report` refuses a practitioner who is not the caller's own.
    const own = await signerFor(db, actor.userId);
    const practitionerId = own?.practitionerId;
    if (!practitionerId) {
      // Not a practitioner at all, so there is no certificate to sign on. A
      // sentence rather than a raise: nothing about their role is wrong, they
      // simply are not the person who signs.
      return c.json({ error: 'forbidden', code: 'not_a_practitioner', requestId }, 403);
    }

    // The credential, at this moment. Asked here for the sentence; asked again
    // inside app.issue_report, which is the answer that binds.
    const answer = canIssue(await signingCredentials(db, practitionerId), {
      practitionerId,
      serviceTypeId: draft.service_type_id,
      on: today,
    });
    if (!answer.ok) {
      // Written before the answer (section 8: every refusal is), so the trail
      // shows an attempt to sign that the platform turned away.
      await logAction(
        db,
        'report.issue_refused',
        { type: 'report', id: reportId, clientId: draft.client_id },
        { reason: answer.code },
      );
      return c.json(
        { error: 'forbidden', code: SIGNING_REFUSALS[answer.code] ?? answer.code, requestId },
        403,
      );
    }

    const issued = await db.query<{ id: string }>(
      'select id from app.issue_report($1::uuid, $2::uuid, $3::date)',
      [reportId, practitionerId, today],
    );
    if (!issued.rows[0]) {
      throw new Error('Issuing a report did not return a row.');
    }

    const record = await readReport(db, reportId);
    const recipient = await readRecipient(db, draft.client_id);
    const document_ = record && recipient ? documentFrom(record, recipient) : null;
    if (!record || !document_) {
      // **Raised, not returned, and that is the whole of it.** The number has
      // already been allocated and the signature already written by the
      // function above; the transaction rolls back on a raise or a 5xx and on
      // nothing else (app/api/_middleware/request-context.ts). A 422 returned
      // here committed a numbered, signed report with no document behind it —
      // a row nothing could ever file, because a second issue is refused as
      // already signed and the repair path has no bytes to compare.
      //
      // Reaching here at all means the row the function just wrote does not
      // render: a body the shape no longer recognises, or a client row row
      // security stopped showing mid-request. Both are faults, and a fault
      // that rolls the signature back is the only safe answer.
      throw new Error('An issued report did not render; the issue was rolled back.');
    }

    const bytes = renderReport(document_, documentFonts());
    const documentId = randomUUID();
    const key = clientDocumentKey(actor.tenantId, draft.client_id, documentId);
    const sha256 = createHash('sha256').update(bytes).digest();
    // Five years from filing, by the one piece of arithmetic that decides it
    // (domain/shared/storage.ts). An erasure takes it before then, which is
    // the whole of section 6's erasure step.
    const retentionUntil = documentRetentionUntil('report', now());

    const filed = await db.query<{ document_id: string }>(
      'select app.file_report_document($1::uuid, $2::uuid, $3::text, $4::bytea, $5::timestamptz) ' +
        'as document_id',
      [reportId, documentId, key, sha256, retentionUntil],
    );
    const filedId = filed.rows[0]?.document_id;
    if (!filedId) {
      throw new Error('Filing a report document did not return an id.');
    }

    if (filedId === documentId) {
      c.get('afterCommit')(async () => {
        // `overwrite` false, so a second rendering can never quietly replace
        // the first (docs/SEAMS.md, PutOptions).
        const stored = await storage.put(key, bytes, 'application/pdf');
        if (stored.sha256 !== sha256.toString('hex')) {
          // The store did not write what it was handed. Never the key and
          // never the hash: both name a client's document.
          console.error(JSON.stringify({ requestId, after: 'commit', name: 'ReportHashMismatch' }));
        }
      });
    }

    // A sensitive act, carrying the reason it is one: a person put their name
    // on a document (section 8).
    await logAction(
      db,
      'report.issued',
      { type: 'report', id: reportId, clientId: draft.client_id },
      { reference: record.reference ?? '', kind: record.kind, version: String(record.version) },
    );

    const answered = await readReport(db, reportId);
    return c.json(IssueResponse.parse({ report: asRow(answered ?? record) }), 201);
  });
}
