import type { Hono } from 'hono';
import { canIssue, validateContent, type ReportContent } from '../../../domain/reports';
import { renderReport } from '../../../domain/reports/document';
import { isoDateIn } from '../../../domain/shared';
import { isUuid } from '../billing/ids';
import { documentFonts } from '../billing/fonts';
import { logRead } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { mayDraftReport } from './access';
import { practiceTimeZone } from './gather';
import { readRecipient, readReport } from './source';
import { signerFor, signingCredentials } from './signer';

/**
 * `GET /api/reports/:id/preview` — the exact page, before anybody signs it
 * (docs/SPEC/reports-v1.md section 4.2).
 *
 * **Rendered by the one renderer, from the draft's own content.** There is no
 * second implementation and there must not be: a preview drawn by a screen
 * could disagree with the document that is filed a moment later, and the whole
 * point of showing it is that a practitioner sees what a household will get.
 *
 * **What it fills in for the values that do not exist yet.** The practice's
 * identity block and the signature block are read live — they are exactly what
 * `app.issue_report` will snapshot in a moment, so the preview is right about
 * both unless the practice changes its own name in between. The **reference is
 * the one thing it cannot know**: a number is allocated at signing and never
 * before, because a draft that is never signed must not burn one. It prints as
 * the words that say so, and that is the only difference between this page and
 * the filed one.
 *
 * **Audited as a read**, because it is one: this renders a household's own
 * figures onto a page and hands it to somebody.
 */

const PRACTICE_SQL =
  'select t.legal_name, t.legal_name_ar, t.licence_number, t.licensing_authority, ' +
  'l.display_address from tenant t left join location l on l.id = t.location_id ' +
  'where t.id = app.current_tenant_id()';

/** What the page says where a number has not been allocated yet. */
export const PREVIEW_REFERENCE = 'Not yet signed';

type PracticeRow = {
  legal_name: string;
  legal_name_ar: string | null;
  licence_number: string | null;
  licensing_authority: string | null;
  display_address: string | null;
};

async function practiceSnapshot(db: Db): Promise<PracticeRow | null> {
  const found = await db.query<PracticeRow>(PRACTICE_SQL);
  return found.rows[0] ?? null;
}

export function mountReportPreview(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/reports/:id/preview', async (c) => {
    const requestId = c.get('requestId');
    const reportId = c.req.param('id');
    if (!isUuid(reportId)) {
      // Checked before it reaches a uuid column, the way billing's own routes
      // check theirs: an id that is not one is a 400, not a raise dressed up
      // as a 500 on a path a stranger can call.
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    const actor = c.get('actor');

    const record = await readReport(db, reportId);
    if (!record) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!mayDraftReport(actor, record.client_id, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const parsed = validateContent(record.kind, record.content);
    if (!parsed.ok) {
      return c.json(
        { error: 'unprocessable', code: 'invalid_content', field: parsed.field, requestId },
        422,
      );
    }
    // A draft has no recipient block yet, so a preview of one reads the client
    // as they are today — which is exactly what would be snapshotted if it
    // were signed now. An issued report's block is on its own row and that is
    // what is shown, so the preview of a signed report is the filed page.
    const recipient =
      record.recipient_name !== null && record.recipient_record_number !== null
        ? { name: record.recipient_name, recordNumber: record.recipient_record_number }
        : await readRecipient(db, record.client_id);
    const practice = await practiceSnapshot(db);
    if (!recipient || !practice) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    // The signature block, from the credential the person reading this holds
    // today — which is exactly what would be snapshotted if they signed now.
    // Where they hold none the block carries their name and no certificate,
    // and the issuing door is what refuses them, with a sentence.
    const timeZone = await practiceTimeZone(db);
    const today = isoDateIn(now(), timeZone);
    const signer = await signerFor(db, actor.userId);
    const credentials = signer ? await signingCredentials(db, signer.practitionerId) : [];
    const answer = signer
      ? canIssue(credentials, {
          practitionerId: signer.practitionerId,
          serviceTypeId: record.service_type_id,
          on: today,
        })
      : null;
    const would = answer?.ok
      ? credentials.find(
          (credential) =>
            credential.serviceTypeId === answer.credential.serviceTypeId &&
            credential.validFrom === answer.credential.validFrom,
        )
      : undefined;

    const bytes = renderReport(
      {
        kind: record.kind,
        locale: record.locale,
        practice: {
          legalName: practice.legal_name,
          legalNameAr: practice.legal_name_ar,
          address: practice.display_address,
          licenceNumber: practice.licence_number,
          licensingAuthority: practice.licensing_authority,
        },
        signer: {
          name: record.signed_by_name ?? signer?.name ?? '',
          certification: record.signed_by_certification ?? would?.certification ?? '',
          certifyingBody: record.signed_by_certifying_body ?? would?.certifyingBody ?? null,
          certificateNumber:
            record.signed_by_certificate_number ?? would?.certificateNumber ?? null,
        },
        recipient,
        reference: record.reference ?? PREVIEW_REFERENCE,
        issuedOn: record.issued_on ?? today,
        version: record.version,
        amendmentReason: record.amendment_reason,
        content: parsed.content as ReportContent,
      },
      documentFonts(),
    );

    await logRead(db, 'report', record.id, record.client_id);

    return c.body(bytes as unknown as ArrayBuffer, 200, {
      'content-type': 'application/pdf',
      // Never stored, never shared: a preview is a page somebody is looking at
      // once, and it carries a household's own figures.
      'cache-control': 'no-store',
      'content-disposition': 'inline; filename="preview.pdf"',
    });
  });
}
