import { createHash, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { replayEvents } from '@domain/session';
import { hasRole, clientDocumentKey } from '@domain/shared';
// By its own path, as app/api/clients/document-store.ts imports it: the seam's
// retention arithmetic is not in the shared barrel, and domain/shared is the
// trunk's to export from.
import { documentRetentionUntil } from '../../../domain/shared/storage';
import { logAction } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { logRefusal } from './audit';
import { photoStorageAvailable } from './photo-availability';
import { loadSession, readEvents, resolvePractitioner } from './session-row';

/**
 * `PUT /api/sessions/:id/photo` — the door the setup photograph's bytes go
 * through (docs/SPEC/practitioner-phone.md section 4.3 and 4.4).
 *
 * **Raw bytes, not JSON.** The picture is up to a megabyte and base64 would
 * make it a third larger for nothing; `app/api/create-api.ts` exempts this one
 * path from the 64 KiB envelope and from `jsonOnly`, and this route is what
 * makes that exemption safe — it accepts three media types and no others, caps
 * nothing itself (the middleware does), and verifies the digest the device
 * declared before a byte is stored.
 *
 * **Consent is the first question of all**, before the event and before the
 * document: a household that has not agreed is refused 403
 * `consent_missing_photo_video` and the refusal is written to the trail,
 * whatever else is or is not true about the visit (section 4.3's own order).
 *
 * **The event comes first among the rest.** The device flushes events, then bytes: a
 * picture is only ever filed against a `photo_captured` event the server
 * already holds, which is what keeps the record's own log the source of truth
 * (session-capture.md section 2). A digest with no event yet is 409
 * `photo_event_pending` and the device tries again after its next flush; a
 * digest the event does not name is 409 `photo_superseded` and the device
 * drops the blob, because a retake has already replaced it.
 *
 * **Consent is checked at this moment**, not at the moment the picture was
 * taken (.claude/rules/compliance.md: the specific purpose, at execution time,
 * never a cached flag). A household that has withdrawn between the visit and
 * the flush gets 403 and no photograph.
 *
 * **The bytes may arrive after the visit has closed** (decision 4). That is
 * ordinary: an offline day closes on the device and the pictures follow when
 * there is signal. `app.file_setup_photo` is the one change migration 306's
 * close guard admits on a frozen visit.
 *
 * **The order is row, bytes, link**, as section 4.4 sets it out, and
 * `afterCommit` is not used because nothing here deletes anything. One
 * consequence is worth naming: the `document` insert is audited, so the store
 * call sits between two audited writes and holds the audit chain's lock for as
 * long as the store takes. That is one call per visit, at most once a day per
 * practitioner, against a store that is a folder on a laptop and a bucket in
 * production — and the alternative, bytes before the row, would leave an
 * object in the store that no row names whenever the filing is refused after
 * it.
 */

const PRACTITIONER_ROLES = ['practitioner', 'lead_practitioner'] as const;

const Params = z.object({ id: z.uuid() });
const Digest = z.string().regex(/^[0-9a-f]{64}$/, 'Not a sha256 digest');
const PHOTO_TYPES = ['image/jpeg', 'image/webp', 'image/png'] as const;
type PhotoType = (typeof PHOTO_TYPES)[number];

function isPhotoType(value: string): value is PhotoType {
  return (PHOTO_TYPES as readonly string[]).includes(value);
}

export function mountSessionPhoto(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.put('/api/sessions/:id/photo', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');

    const params = Params.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const sessionId = params.data.id;

    if (!hasRole(actor, ...PRACTITIONER_ROLES)) {
      await logRefusal(db, 'session', sessionId, null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const storage = c.get('storage');
    if (!photoStorageAvailable(storage)) {
      // No store configured is refused cleanly rather than assumed away: a
      // document row against a key nothing ever uploads to is a record of a
      // photograph that does not exist.
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }

    // The media type is the caller's claim; the bytes are checked against the
    // digest below, and the store is told the type the caller declared. Only
    // three are accepted, matching what the device's own module produces and
    // what migration 306's door will file.
    const mimeType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!isPhotoType(mimeType)) {
      return c.json({ error: 'unsupported_media_type', requestId }, 415);
    }
    const declared = Digest.safeParse(c.req.header('x-photo-sha256') ?? '');
    if (!declared.success) {
      return c.json({ error: 'bad_request', requestId, detail: 'digest_missing' }, 400);
    }

    const practitionerId = await resolvePractitioner(db, actor.userId);
    if (!practitionerId) {
      await logRefusal(db, 'session', sessionId, null, ['no_practitioner_row']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const session = await loadSession(db, sessionId);
    if (!session) {
      await logRefusal(db, 'session', sessionId, null, ['session_not_found']);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (session.practitioner_id !== practitionerId) {
      await logRefusal(db, 'session', sessionId, null, ['session_not_yours']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength === 0) {
      return c.json({ error: 'bad_request', requestId, detail: 'empty_body' }, 400);
    }
    // The route computes its own over the bytes it actually received. A device
    // that declared one digest and sent another is refused before anything is
    // stored, so a `document.sha256` can never disagree with its own object.
    const computed = createHash('sha256').update(body).digest('hex');
    if (computed !== declared.data) {
      await logRefusal(db, 'session', sessionId, session.client_id, ['digest_mismatch']);
      return c.json({ error: 'bad_request', requestId, detail: 'digest_mismatch' }, 400);
    }

    // Consent now, at this moment, for this visit, and **before anything
    // else in the transaction** — spec 4.3's own order. The door checked the
    // event first, so a forged PUT for a household that had never agreed was
    // answered 409 "the event has not arrived yet", with nothing on the trail:
    // a refusal that told the caller to try again and left no record of the
    // attempt. Consent is the first question, and its refusal is audited.
    //
    // The definer door reads through row security and answers about the
    // caller's own visit alone (migration 306); unlike 304's it still answers
    // after the close, because that is when these bytes arrive.
    const consent = await db.query<{ active: boolean }>(
      'select app.setup_photo_consent_active($1) as active',
      [sessionId],
    );
    if (consent.rows[0]?.active !== true) {
      await logRefusal(db, 'session', sessionId, session.client_id, [
        'consent_missing_photo_video',
      ]);
      return c.json({ error: 'forbidden', requestId, detail: 'consent_missing_photo_video' }, 403);
    }

    // Already filed? Same digest is an idempotent retry — a device whose
    // connection dropped after the server committed asks again, and gets the
    // same answer. A different digest is refused: a filed evidence document is
    // never replaced (docs/SEAMS.md).
    if (session.setup_photo_document_id !== null) {
      const existing = await db.query<{ id: string; sha256: Buffer }>(
        'select id, sha256 from document where id = $1 and tenant_id = app.current_tenant_id()',
        [session.setup_photo_document_id],
      );
      const row = existing.rows[0];
      if (row && row.sha256.toString('hex') === computed) {
        return c.json({ status: 'filed', documentId: row.id }, 200);
      }
      await logRefusal(db, 'session', sessionId, session.client_id, ['document_exists']);
      return c.json({ error: 'conflict', requestId, detail: 'document_exists' }, 409);
    }

    // The event that names these bytes must already be here. The projection's
    // `photo` is the last photo_captured payload, which is exactly the retake
    // rule: a picture taken again before check-out replaces the blob and
    // appends a new event, so an older digest is superseded rather than
    // pending.
    const projection = replayEvents(await readEvents(db, sessionId));
    const photo = projection?.photo ?? null;
    if (photo === null) {
      return c.json({ error: 'conflict', requestId, detail: 'photo_event_pending' }, 409);
    }
    if (photo.sha256 !== computed) {
      return c.json({ error: 'conflict', requestId, detail: 'photo_superseded' }, 409);
    }

    const documentId = randomUUID();
    // Ids and nothing else, from the seam's own helper. Never the session-
    // derived path close.ts once sketched, which is retired: a key is made of
    // ids so that a key that leaks says nothing about whose file it is.
    const storageKey = clientDocumentKey(actor.tenantId, session.client_id, documentId);
    // Five years, from the seam's own arithmetic. A client document's clock is
    // usually the client's last activity rather than the upload
    // (app/api/clients/document-store.ts), and filing a photograph *is* that
    // activity — the visit it belongs to happened today — so on the day it is
    // written the two rules give the same date, and the erasure job moves the
    // client's own clock on from there. `computeRetentionUntil` itself lives in
    // domain/client, which this stream may not import from
    // (docs/SPEC/OWNERSHIP.md rule 3).
    const retentionUntil = documentRetentionUntil('setup_photo', now());

    // 1. The row, through the one door a practitioner has.
    const filed = await db.query<{ filed: boolean }>(
      'select app.file_setup_photo_document($1, $2, $3, $4, $5, $6) as filed',
      [sessionId, documentId, storageKey, mimeType, Buffer.from(computed, 'hex'), retentionUntil],
    );
    if (filed.rows[0]?.filed !== true) {
      // The door refused: another practitioner's visit, a household that has
      // not agreed, or a second photograph. Every one of those is already
      // answered above, so reaching here means the row moved between the
      // checks and now.
      await logRefusal(db, 'session', sessionId, session.client_id, ['photo_not_filed']);
      return c.json({ error: 'conflict', requestId, detail: 'document_exists' }, 409);
    }

    // 2. The bytes. `overwrite` stays false: a fresh uuid cannot already be in
    // the store, so a refusal here means something is very wrong and a 409 is
    // a better answer than a silent replace.
    await storage.put(storageKey, body, mimeType);

    // 3. The link, through the door the close guard admits.
    const linked = await db.query<{ linked: boolean }>(
      'select app.file_setup_photo($1, $2) as linked',
      [sessionId, documentId],
    );
    if (linked.rows[0]?.linked !== true) {
      // Nothing left to do but refuse and let the transaction roll back with
      // the row: an object with no row naming it is the orphan the seam
      // already accepts (docs/SEAMS.md).
      return c.json({ error: 'conflict', requestId, detail: 'document_exists' }, 409);
    }

    // The document id and nothing else. Bytes never appear in a payload, a log
    // line or the trail (section 4.7).
    await logAction(
      db,
      'session.photo_filed',
      { type: 'session', id: sessionId, clientId: session.client_id },
      { documentId },
    );
    return c.json({ status: 'filed', documentId }, 201);
  });
}
