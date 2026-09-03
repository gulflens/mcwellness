import type { Hono } from 'hono';
import { z } from 'zod';
import { canViewClient, documentUploadRefusal, type ClientStatus } from '../../../domain/client';
import { hasRole, type Actor } from '../../../domain/shared';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { canWriteClientRecord } from './access';
import { fileClientDocument, signedDocumentLink } from './document-store';
import {
  ClientDocumentListResponse,
  DocumentLinkResponse,
  IdResponse,
  UploadDocumentBody,
} from './record-schema';
import { logReads } from '../_middleware/audit';
import { logRefused } from './refused';

/**
 * The Documents tab (docs/SPEC/client-record.md section 4.2): what is filed
 * against a client, filing something new, and a short-lived link to open one.
 *
 * Three things this route will not do.
 *
 *   * **No identity documents.** `documentUploadRefusal` refuses an Emirates
 *     ID, a passport or a visa page by kind and says which, because
 *     docs/SPEC/00-data-model.md section 3 says the practice never holds an
 *     image of one: an identity number is a keyed fingerprint and a sealed
 *     value, never a picture. A refusal that only said "not allowed" would
 *     read as a bug to whoever hit it.
 *   * **No deleting.** Erasure is the fifth pull request and runs through
 *     `app.erase_client` as the table owner; the API role holds no delete
 *     grant on `document` at all (090_grants_and_rls.sql), so a delete button
 *     here would be a button that cannot work.
 *   * **No bytes of its own.** Opening a document is a signed link through the
 *     seam, never this API streaming the file (docs/SEAMS.md).
 *
 * Consent evidence is listed here too, filed by the consent route under its
 * own kinds and immutable. It is part of what the practice holds about this
 * client and hiding it from the one screen that lists documents would only
 * make the record look emptier than it is.
 */

const ClientParams = z.object({ id: z.uuid() });
const DocumentParams = z.object({ id: z.uuid(), documentId: z.uuid() });

type DocumentRow = {
  id: string;
  kind: string;
  mime_type: string;
  created_at: Date;
  uploaded_by_name: string | null;
  retention_until: Date | null;
  is_immutable: boolean;
};

/**
 * Whether this actor may see the client's documents at all.
 *
 * Finance may not: section 2 gives it demographics and contacts and nothing
 * else, and the read policy is the floor under this
 * (db/policies/client/readers.sql). The test is "holds nothing but finance",
 * not "holds finance" — one person may be several things at once
 * (docs/SPEC/00-data-model.md section 2, roles live on `user_role`), and an
 * owner who also keeps the books must not lose the record because of it. It is
 * the same test app/admin/clients/clientAccess.ts makes for the same reason.
 */
async function mayReadDocuments(
  db: Db,
  actor: Actor,
  clientId: string,
  status: ClientStatus,
  now: Date,
): Promise<{ ok: boolean; needsReason: boolean }> {
  if (actor.roles.every((role) => role === 'finance')) {
    return { ok: false, needsReason: false };
  }
  const contactClientIds = hasRole(actor, 'client_contact')
    ? (
        await db.query<{ client_id: string }>('select client_id from contact where user_id = $1', [
          actor.userId,
        ])
      ).rows.map((r) => r.client_id)
    : [];
  const scheduledClientIds =
    hasRole(actor, 'practitioner') &&
    (
      await db.query<{ visible: boolean }>(
        'select app.client_visible_to_practitioner($1) as visible',
        [clientId],
      )
    ).rows[0]?.visible === true
      ? [clientId]
      : [];
  const view = canViewClient(
    actor,
    { id: clientId, tenantId: actor.tenantId, status },
    { scheduledClientIds, contactClientIds },
    now,
  );
  return { ok: view.ok, needsReason: view.needsReason };
}

export function mountDocuments(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/clients/:id/documents', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;

    // Existence through app.client_status_for (security definer) before the
    // role check, the ordering every route in this worktree uses: a plain
    // select under row security collapses "no such client" and "a client this
    // role may not see" into the same empty result, and the refusal a real row
    // owes the trail would be skipped (issue 13, third review round).
    const statusRow = await db.query<{ status: ClientStatus | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const status = statusRow.rows[0]?.status ?? null;
    if (status === null) return c.json({ error: 'not_found', requestId }, 404);

    const view = await mayReadDocuments(db, actor, clientId, status, now());
    if (!view.ok) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (view.needsReason && !(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }

    // No size: the row names the bytes, the store holds them, and `document`
    // records no length. A column that was always null would be worse than the
    // absence.
    const { rows } = await db.query<DocumentRow>(
      'select d.id, d.kind, d.mime_type, d.created_at, ' +
        'u.display_name as uploaded_by_name, d.retention_until, d.is_immutable ' +
        'from document d left join app_user u on u.id = d.uploaded_by ' +
        'where d.client_id = $1 order by d.created_at desc',
      [clientId],
    );

    // One `list` row per document named, the same rule app/api/clients/list.ts
    // follows for a client it shows: naming what the practice holds about
    // somebody is itself a read, and a trail that recorded only the refusals
    // would say who was turned away and never who looked.
    await logReads(
      db,
      'document',
      rows.map((r) => ({ id: r.id, clientId })),
      'list',
    );
    return c.json(
      ClientDocumentListResponse.parse({
        documents: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          mimeType: row.mime_type,
          uploadedAt: row.created_at.toISOString(),
          uploadedByName: row.uploaded_by_name,
          retentionUntil: row.retention_until ? row.retention_until.toISOString() : null,
          isImmutable: row.is_immutable,
        })),
      }),
    );
  });

  api.post('/api/clients/:id/documents', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const bodyJson = await c.req.json().catch(() => null);
    const body = UploadDocumentBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    const statusRow = await db.query<{ status: ClientStatus | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const status = statusRow.rows[0]?.status ?? null;
    if (status === null) return c.json({ error: 'not_found', requestId }, 404);
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // A closed record is read-only "except documents" (section 3), so closed is
    // deliberately not refused here. Erased is: nothing is filed against a
    // household that asked to be forgotten.
    if (status === 'erased') return c.json({ error: 'erased', requestId }, 400);

    const refusal = documentUploadRefusal(body.data.kind);
    if (refusal) return c.json({ error: 'bad_request', code: refusal, requestId }, 400);

    const filed = await fileClientDocument(db, c.get('storage'), actor, {
      clientId,
      kind: body.data.kind,
      file: body.data.file,
      // An uploaded document is evidence of what somebody sent the practice,
      // but it is not evidence of what a person agreed to: it stays ordinary,
      // so a mistake is correctable by the erasure path rather than frozen.
      isImmutable: false,
      now: now(),
    });
    if (!filed.ok) {
      return filed.reason === 'storage_unavailable'
        ? c.json({ error: 'storage_unavailable', requestId }, 503)
        : c.json({ error: 'bad_request', code: filed.reason, requestId }, 400);
    }
    return c.json(IdResponse.parse({ id: filed.document.id }), 201);
  });

  api.get('/api/clients/:id/documents/:documentId/link', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = DocumentParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const { id: clientId, documentId } = params.data;

    const statusRow = await db.query<{ status: ClientStatus | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const status = statusRow.rows[0]?.status ?? null;
    if (status === null) return c.json({ error: 'not_found', requestId }, 404);

    const view = await mayReadDocuments(db, actor, clientId, status, now());
    if (!view.ok) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (view.needsReason && !(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const storage = c.get('storage');
    if (!storage) return c.json({ error: 'storage_unavailable', requestId }, 503);

    // Read under row security as the caller, and keyed on the client in the
    // path as well as the document's own id: a document id alone would let one
    // client's path name another client's file, and the answer would be
    // whatever row security happened to allow rather than what was asked for.
    //
    // Two shapes are admitted, and the second is why this is not a one-line
    // predicate. A client's own document belongs to the client in the path.
    // The **consent wording** a consent points at does not: it is a practice
    // document with `client_id` null, the practice's published words, and
    // `client_id = $2` could never match one — so the Consent tab could link
    // the signature and never the text that was signed, which is the half of
    // the record a person is most entitled to. It is admitted here only where
    // a `consent` of this very client names it, so the door opens onto the
    // wording somebody signed and never the practice's filing cabinet, and
    // db/policies/client/readers.sql is the floor underneath saying the same.
    const { rows } = await db.query<{ storage_key: string; client_id: string | null }>(
      'select storage_key, client_id from document where id = $1 and (client_id = $2 or ' +
        "(client_id is null and kind = 'consent_text' and exists (select 1 from consent cs " +
        'where cs.text_document_id = document.id and cs.client_id = $2)))',
      [documentId, clientId],
    );
    const row = rows[0];
    if (!row) return c.json({ error: 'not_found', requestId }, 404);

    const link = await signedDocumentLink(db, storage, {
      id: documentId,
      // Null for a practice wording: the audit trail denormalises the client
      // and a document that names none must not have one invented for it
      // (app/api/_middleware/storage/audit.ts).
      clientId: row.client_id,
      storageKey: row.storage_key,
    });
    return c.json(DocumentLinkResponse.parse(link));
  });
}
