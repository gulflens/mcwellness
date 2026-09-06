import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import {
  bytesMatchMimeType,
  canActor,
  practiceDocumentKey,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  type Actor,
} from '../../../domain/shared';
// By its own path: the seam's retention arithmetic is not in the shared
// barrel. Browser-safe either way — the same file practiceDocumentKey is in.
import { documentRetentionUntil } from '../../../domain/shared/storage';
import { auditDocumentRead } from '../_middleware/storage/audit';
import type { ServerStorageProvider } from '../_middleware/storage';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { MAX_LOGO_BYTES, PracticeLogoResponse, UploadLogoInput, type LogoMimeType } from './schema';

/**
 * The practice's logo: `GET`, `POST` and `DELETE /api/practice/logo`
 * (migration 909, `docs/CHANGE-REQUESTS/billing-04.md` request 5).
 *
 * The operator's decision of 2026-09-03 was that the invoice carries the
 * practice's logo, that the wordmark set in the app's own type stands in
 * until a file is supplied, and that the logo is a **practice document the
 * settings page can replace** rather than a file committed to the repository.
 * This is that document: `kind = 'practice_logo'`, `client_id` null, keyed
 * `tenant/<t>/practice/<d>` by `practiceDocumentKey`, one per practice.
 *
 * **Who.** `practice.settings.write` — the owner and an admin — for all
 * three, which is the audience `db/policies/client/writers.sql` already
 * admits to a practice document and the audience `app.remove_practice_logo()`
 * (909) enforces underneath. The read is the same audience deliberately: it
 * is a screen for the person who sets the logo, not a public asset route.
 * When billing reads the logo onto a rendered invoice it will do so from
 * `app/api/billing/document-source.ts`, against the row rather than this
 * route; if it wants this door instead, the audience is a decision to take
 * then and not one to widen in advance.
 *
 * **No reason header, unlike `PATCH /api/practice`.** That route insists on
 * `X-Reason` because it changes what a tax invoice *states* the supplier is —
 * the legal name, the registrations, the address — and every one of those is
 * a fact somebody may later have to account for. A logo is the mark above
 * them, not a claim about them. The trail still records who replaced it and
 * when: `document` is an audited table, so the insert and the delete are both
 * written by the row trigger (080), and the read of a signed link by
 * `auditDocumentRead` below.
 *
 * **Bytes first, row second, and both inside the request's transaction**
 * (docs/SEAMS.md, and `app/api/clients/document-store.ts` for the same
 * ordering said at length). A row written before its bytes points at nothing
 * for as long as the upload takes and forever if it fails; bytes written
 * before their row are an orphan in a bucket, which costs storage and tells
 * nobody anything. The old logo's bytes go the other way about — the row is
 * removed in the transaction, the bytes after it commits — because a delete
 * cannot be rolled back and a transaction can.
 */

/** How long the link this route hands back lives. */
const LOGO_URL_TTL_SECONDS = DEFAULT_SIGNED_URL_TTL_SECONDS;

type LogoRow = { id: string; storage_key: string; mime_type: LogoMimeType };

const SELECT_LOGO =
  'select id, storage_key, mime_type from document ' +
  "where tenant_id = app.current_tenant_id() and kind = 'practice_logo'";

/** The logo row for the caller's practice, or null. */
async function readLogo(db: Db): Promise<LogoRow | null> {
  const { rows } = await db.query<LogoRow>(SELECT_LOGO);
  return rows[0] ?? null;
}

/**
 * A short-lived link to the logo's bytes, with the read written to the trail
 * first. `auditDocumentRead` before `getSignedUrl`, every time and without
 * exception: signing is the only moment there is an actor to name
 * (app/api/_middleware/storage/audit.ts, docs/SEAMS.md).
 */
async function link(
  db: Db,
  storage: ServerStorageProvider,
  row: { id: string; storage_key: string },
): Promise<{ url: string; expiresInSeconds: number }> {
  await auditDocumentRead(db, { id: row.id, clientId: null });
  return {
    url: await storage.getSignedUrl(row.storage_key, LOGO_URL_TTL_SECONDS),
    expiresInSeconds: LOGO_URL_TTL_SECONDS,
  };
}

export function mountPracticeLogo(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  const allowed = (actor: Actor): boolean =>
    canActor(actor, { type: 'practice.settings.write' }, {}, now());

  api.get('/api/practice/logo', async (c) => {
    const requestId = c.get('requestId');
    if (!allowed(c.get('actor'))) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const storage = c.get('storage');
    if (!storage) {
      // c.get('storage') is typed `| undefined` on purpose: a deployment with
      // no store configured is refused cleanly rather than assumed away.
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }
    const db = c.get('db');
    const row = await readLogo(db);
    if (row === null) {
      // No logo is a real answer and the wordmark is what stands in its place.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    return c.json(
      PracticeLogoResponse.parse({
        logo: {
          documentId: row.id,
          mimeType: row.mime_type,
          ...(await link(db, storage, row)),
        },
      }),
    );
  });

  api.post('/api/practice/logo', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!allowed(actor)) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const storage = c.get('storage');
    if (!storage) {
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }
    const bodyJson = await c.req.json().catch(() => null);
    const body = UploadLogoInput.safeParse(bodyJson);
    if (!body.success) {
      const code =
        body.error.issues[0]?.path[0] === 'mimeType' ? 'unsupported_type' : 'bad_request';
      return c.json({ error: 'bad_request', code, requestId }, 400);
    }
    const bytes = new Uint8Array(Buffer.from(body.data.bytesBase64, 'base64'));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) {
      return c.json({ error: 'bad_request', code: 'logo_too_large', requestId }, 400);
    }
    // The declared media type is a claim and the leading bytes are the
    // evidence: a page filed as an image would otherwise come back through a
    // signed link that a browser may well render. `bytesMatchMimeType` is the
    // one place that question is answered (`domain/shared/fileSignature.ts`),
    // which is where the trunk's round 31 moved it — this route's own copy of
    // two signatures, and the paragraph justifying it under rule 3, went with
    // the move.
    if (!bytesMatchMimeType(bytes, body.data.mimeType)) {
      return c.json({ error: 'bad_request', code: 'bytes_do_not_match_type', requestId }, 400);
    }

    const db = c.get('db');
    const documentId = randomUUID();
    const storageKey = practiceDocumentKey(actor.tenantId, documentId);
    // A fresh uuid cannot already be in the store, so the default refusal to
    // overwrite is the right one and is never expected to fire; if it ever
    // does, something is very wrong and a 409 is a better answer than a
    // silent replace.
    const stored = await storage.put(storageKey, bytes, body.data.mimeType);

    // The old row goes and the new one arrives inside one transaction, which
    // is what migration 909's one-logo-per-practice index requires: filing
    // the replacement first would collide with the logo still standing.
    const removed = await db.query<{ key: string | null }>(
      'select app.remove_practice_logo() as key',
    );
    const replacedKey = removed.rows[0]?.key ?? null;

    await db.query(
      'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256, ' +
        "uploaded_by, retention_until, is_immutable) values ($1, $2, null, 'practice_logo', $3, " +
        "$4, decode($5, 'hex'), $6, $7, false)",
      [
        documentId,
        actor.tenantId,
        storageKey,
        body.data.mimeType,
        stored.sha256,
        actor.userId,
        // Five years from upload, the practice-document rule. Not exempt: a
        // logo follows no client's activity and is nobody's evidence.
        documentRetentionUntil('practice_logo', now()),
      ],
    );

    if (replacedKey !== null) {
      // After the commit, never inside it: a delete cannot be rolled back and
      // a transaction can (docs/SEAMS.md). A key that survives its row is an
      // orphan in a bucket; a row that survives its bytes is a broken record.
      c.get('afterCommit')(async () => {
        await storage.delete(replacedKey);
      });
    }

    return c.json(
      PracticeLogoResponse.parse({
        logo: {
          documentId,
          mimeType: body.data.mimeType,
          ...(await link(db, storage, { id: documentId, storage_key: storageKey })),
        },
      }),
    );
  });

  api.delete('/api/practice/logo', async (c) => {
    const requestId = c.get('requestId');
    if (!allowed(c.get('actor'))) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const storage = c.get('storage');
    if (!storage) {
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }
    const removed = await c
      .get('db')
      .query<{ key: string | null }>('select app.remove_practice_logo() as key');
    const key = removed.rows[0]?.key ?? null;
    if (key === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    c.get('afterCommit')(async () => {
      await storage.delete(key);
    });
    // Nothing to return: the wordmark stands in its place again.
    return c.body(null, 204);
  });
}
