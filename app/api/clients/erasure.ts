import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  ERASURE_LETTER_KIND,
  ERASURE_LETTER_MIME_TYPE,
  type ClientStatus,
} from '../../../domain/client';
import { hasRole, isoDateIn } from '../../../domain/shared';
import { logReads } from '../_middleware/audit';
import { cleanText } from '../_middleware/text';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { canPerformErasure, canRecordErasureRequest } from './access';
import {
  putPracticeDocumentBytes,
  recordPracticeDocument,
  signedDocumentLink,
} from './document-store';
import { erasureLetter } from './erasure-letter';
import {
  ErasurePerformedResponse,
  ErasureRequestBody,
  ErasureRequestListResponse,
  ErasureRequestRecord,
  IdResponse,
} from './record-schema';
import { logRefused } from './refused';

/**
 * Being forgotten, in two acts (docs/SPEC/client-record.md section 8).
 *
 * **The request.** "Record erasure request" writes down that a household
 * asked, who asked, why, and — the one thing this route captures that nothing
 * else could — the number to send the confirmation to. That number is read
 * here because after the second act there is no contact left to read it from:
 * every phone, email and name on every contact of that client is null, which
 * is the point.
 *
 * **The act.** A separate call, a separate press, a confirmation step in
 * between. `app.erase_client` (migrations 100, 102 and 104) does the work as
 * the table owner inside `app.begin_erasure()` … `app.end_erasure()`, so every
 * audit row it writes keeps its field names and withholds every value; the API
 * role never deletes anything itself and holds no grant to. This route's own
 * work is what the database cannot do: cut the letter, file it, hand the
 * person who pressed the button a link to it, and give the bytes of every
 * deleted document to the after-commit hook.
 *
 * **Why the two are apart.** Until this pull request they were one statement
 * apart in the same handler, which meant there was no such thing as a recorded
 * request that had not already happened — nothing to show anybody, nothing to
 * confirm, and no moment at which somebody could be asked "are you sure" while
 * the record still existed.
 *
 * **Who may perform one.** The owner and an admin. `app.erase_client` also
 * admits the lead practitioner, and that is the right floor for the function —
 * it is the role that may open an erased record afterwards — but section 8
 * calls the act an admin action, so the route is the narrower of the two. The
 * database staying wider than the screen is the ordinary direction.
 */

const ClientParams = z.object({ id: z.uuid() });
const ExecuteParams = z.object({ id: z.uuid(), requestId: z.uuid() });

/** The practice's own day: the letter's date is the date in Dubai, not in UTC. */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

type RequestRow = {
  id: string;
  reason: string;
  requested_at: Date;
  requested_by_contact_id: string | null;
  requested_by_phone: string | null;
  performed_at: Date | null;
  performed_by_name: string | null;
  performed_reason: string | null;
  letter_document_id: string | null;
  letter_version: string | null;
  letter_sent_at: Date | null;
  summary: Record<string, unknown> | null;
  files_pending: number;
};

const REQUEST_COLUMNS =
  'e.id, e.reason, e.requested_at, e.requested_by_contact_id, e.requested_by_phone, ' +
  'e.performed_at, u.display_name as performed_by_name, r.reason as performed_reason, ' +
  'e.letter_document_id, ' +
  'e.letter_version, e.letter_sent_at, e.summary, ' +
  'jsonb_array_length(e.storage_keys_pending) as files_pending';
/** The request with the person who performed it named, which is a join and not a column. */
const REQUEST_FROM =
  'from erasure_request e left join app_user u on u.id = e.performed_by ' +
  // The reason the erasure was carried out with belongs to the act, not to the
  // row, so it comes from the trail — the same lateral join record.ts uses for
  // the reason a consent was withdrawn, and audit_log's own read policy decides
  // who sees it.
  'left join lateral (select a.reason from audit_log a ' +
  "where a.action = 'erase' and a.entity_id = e.client_id and a.reason is not null " +
  'order by a.occurred_at desc limit 1) r on true';

/**
 * The summary app.erase_client writes, as the screen reads it. Counts only:
 * the function is careful to hold no name, and this is careful not to invent
 * a shape for one. A request not yet performed has no summary at all.
 */
function summaryOf(row: RequestRow): ErasureRequestRecord['summary'] {
  const raw = row.summary;
  if (!raw) return null;
  const count = (key: string): number => (typeof raw[key] === 'number' ? (raw[key] as number) : 0);
  return {
    contactsAnonymised: count('contactsAnonymised'),
    portalAccountsArchived: count('portalAccountsArchived'),
    locationsReduced: count('locationsReduced'),
    goalsCleared: count('goalsCleared'),
    consentsUnlinked: count('consentsUnlinked'),
    documentsDeleted: count('documentsDeleted'),
    documentsKept: count('documentsKept'),
    paymentsCleared: count('paymentsCleared'),
    sessionsCleared: count('sessionsCleared'),
    sessionEventsCleared: count('sessionEventsCleared'),
    visitActualsCleared: count('visitActualsCleared'),
  };
}

function toRecord(row: RequestRow): ErasureRequestRecord {
  return ErasureRequestRecord.parse({
    id: row.id,
    reason: row.reason,
    requestedAt: row.requested_at.toISOString(),
    requestedByContactId: row.requested_by_contact_id,
    notifyPhone: row.requested_by_phone,
    performedAt: row.performed_at ? row.performed_at.toISOString() : null,
    performedByName: row.performed_by_name,
    performedReason: row.performed_reason,
    letterDocumentId: row.letter_document_id,
    letterVersion: row.letter_version,
    letterSentAt: row.letter_sent_at ? row.letter_sent_at.toISOString() : null,
    summary: summaryOf(row),
    filesPending: Number(row.files_pending ?? 0),
  });
}

/**
 * The act itself, in the trail, in one row that names it.
 *
 * Everything app.erase_client touched is already logged by the triggers, with
 * every value withheld — which is right, and which also means the trail would
 * otherwise show a great many field names and never the sentence "this record
 * was erased, by this person, for this reason". The reason comes off the
 * transaction's own settings, like every other context column, so it cannot be
 * attributed to somebody else. Written after the function returns, which is
 * after `app.end_erasure()`, so this row is recorded in the ordinary way.
 */
async function logErasurePerformed(db: Db, clientId: string): Promise<void> {
  await db.query(
    'insert into audit_log (tenant_id, actor_id, actor_type, actor_role, action, entity_type, ' +
      'entity_id, client_id, reason, request_id) values (' +
      "app.current_tenant_id(), nullif(current_setting('app.actor_id', true), '')::uuid, 'user', " +
      "nullif(current_setting('app.actor_roles', true), ''), 'erase', 'client', $1, $1, " +
      "nullif(current_setting('app.reason', true), ''), " +
      "nullif(current_setting('app.request_id', true), '')::uuid)",
    [clientId],
  );
}

export function mountErasureRequests(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/clients/:id/erasure-requests', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const bodyJson = await c.req.json().catch(() => null);
    const body = ErasureRequestBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    // app.client_status_for bypasses row level security: see app/api/clients/contacts.ts
    // for why this must come before the role check (issue 13, third review round).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const status = statusRow.rows[0]?.status ?? null;
    if (status === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canRecordErasureRequest(actor)) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    // requestedByContactId, when given, must be one of this client's own contacts — never
    // someone else's household standing in as the requester (issue 16).
    //
    // The phone comes back with it, and is written onto the request. This is the
    // only moment it can be: the act nulls every contact's phone, and a
    // confirmation letter with nowhere to go is not a confirmation
    // (client-record.md section 8 step 5, migration 104). Nothing joins back
    // from it, and the audit trail withholds it like every other value.
    let notifyPhone: string | null = null;
    if (body.data.requestedByContactId) {
      const contact = await db.query<{ id: string; phone: string | null }>(
        'select id, phone from contact where id = $1 and client_id = $2',
        [body.data.requestedByContactId, clientId],
      );
      const row = contact.rows[0];
      if (!row) {
        return c.json({ error: 'bad_request', requestId }, 400);
      }
      notifyPhone = row.phone;
    }

    const erasureId = randomUUID();
    await db.query(
      'insert into erasure_request (id, tenant_id, client_id, requested_by_contact_id, reason, ' +
        'requested_by_phone, created_by) values ($1, $2, $3, $4, $5, $6, $7)',
      [
        erasureId,
        actor.tenantId,
        clientId,
        body.data.requestedByContactId ?? null,
        // erasure_request.reason follows the request's own retention, tighter than the
        // general free-text ceiling elsewhere in this file (db/migrations/100_client_record.sql).
        cleanText(body.data.reason, 200),
        notifyPhone,
        // Who typed it, beside who asked and who later performed it. The
        // column has been on the table since migration 100 and nothing had
        // filled it: a row saying a household asked to be forgotten should
        // name the member of staff who wrote it down.
        actor.userId,
      ],
    );
    return c.json(IdResponse.parse({ id: erasureId }), 201);
  });

  api.get('/api/clients/:id/erasure-requests', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;

    const statusRow = await db.query<{ status: ClientStatus | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const status = statusRow.rows[0]?.status ?? null;
    if (status === null) return c.json({ error: 'not_found', requestId }, 404);
    if (!canRecordErasureRequest(actor)) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Once the record is erased this list is part of it: the same door, the
    // same reason prompt (section 8, and canViewClient's erased branch). An
    // admin may record a request and perform one, and may not read one back
    // afterwards — which is why performing one answers with everything the
    // person needs in the same breath.
    if (status === 'erased') {
      if (!hasRole(actor, 'owner', 'lead_practitioner')) {
        await logRefused(db, 'client', clientId, clientId);
        return c.json({ error: 'forbidden', requestId }, 403);
      }
      if (!(c.req.header('x-reason') ?? '').trim()) {
        return c.json({ error: 'reason_required', requestId }, 400);
      }
    }

    const { rows } = await db.query<RequestRow>(
      `select ${REQUEST_COLUMNS} ${REQUEST_FROM} where e.client_id = $1 order by e.requested_at desc`,
      [clientId],
    );
    await logReads(
      db,
      'erasure_request',
      rows.map((row) => ({ id: row.id, clientId })),
      'list',
    );
    return c.json(ErasureRequestListResponse.parse({ requests: rows.map(toRecord) }));
  });

  api.post('/api/clients/:id/erasure-requests/:requestId/letter-sent', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ExecuteParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const { id: clientId, requestId: erasureId } = params.data;

    // Handing the letter over is a thing only a person can report: it goes by
    // WhatsApp, from the practice's own phone, and no system sees it happen.
    // Saying so is what starts the clock on the one contact detail that
    // outlived the erasure — the sweep clears requested_by_phone once this and
    // files_cleared_at both stand (migration 105).
    const statusRow = await db.query<{ status: ClientStatus | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    if ((statusRow.rows[0]?.status ?? null) === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canRecordErasureRequest(actor)) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const marked = await db.query(
      'update erasure_request set letter_sent_at = now() where id = $1 and client_id = $2 ' +
        'and performed_at is not null and letter_sent_at is null',
      [erasureId, clientId],
    );
    // Already marked, never performed, or not this client's: nothing to say
    // yes to, and nothing worth an error either. The screen asks once.
    if (marked.rowCount === 0) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    return c.json(IdResponse.parse({ id: erasureId }));
  });

  api.post('/api/clients/:id/erasure-requests/:requestId/execute', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ExecuteParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const { id: clientId, requestId: erasureId } = params.data;

    const statusRow = await db.query<{ status: ClientStatus | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const status = statusRow.rows[0]?.status ?? null;
    if (status === null) return c.json({ error: 'not_found', requestId }, 404);
    if (!canPerformErasure(actor)) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Erasing is a sensitive action and the reason is typed before it commits
    // (client-record.md section 9, audit.md section 6). Checked before a single
    // row moves, so a refusal here has erased nothing.
    if (!(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', code: 'reason_required', requestId }, 400);
    }
    if (status === 'erased') {
      return c.json({ error: 'bad_request', code: 'already_erased', requestId }, 400);
    }

    const existing = await db.query<RequestRow>(
      `select ${REQUEST_COLUMNS} ${REQUEST_FROM} where e.id = $1 and e.client_id = $2`,
      [erasureId, clientId],
    );
    const request = existing.rows[0];
    // A request id that does not name this client is a not-found, not a hint
    // that some other client has one: app.erase_client refuses the same pairing
    // in the database, and this refuses it before anything is touched.
    if (!request) return c.json({ error: 'not_found', requestId }, 404);
    if (request.performed_at) {
      return c.json({ error: 'bad_request', code: 'already_performed', requestId }, 400);
    }

    // The letter needs the store, so a store that is not there is a refusal
    // before the erasure rather than a household erased with no confirmation
    // anybody can send them (docs/SEAMS.md: 503, plainly, never an internal
    // error in the record it belongs to).
    const storage = c.get('storage');
    if (!storage) {
      return c.json({ error: 'storage_unavailable', code: 'storage_unavailable', requestId }, 503);
    }

    // Both read before the erasure runs, because afterwards one of them is
    // gone: preferred_locale survives (it is how to speak to somebody, not a
    // personal detail) but the client row is about to be rewritten, and a
    // letter must never be cut from what an erasure has already touched.
    const before = await db.query<{ preferred_locale: 'en' | 'ar' }>(
      'select preferred_locale from client where id = $1',
      [clientId],
    );
    const locale = before.rows[0]?.preferred_locale ?? 'en';
    // The registered address comes with the legal name: the letter tells a
    // person where to write, and says so in words when the practice has not
    // recorded one (domain/client/erasureLetter.ts) rather than printing a
    // bracket into a legal confirmation.
    const practice = await db.query<{ legal_name: string; display_address: string | null }>(
      'select t.legal_name, l.display_address from tenant t ' +
        'left join location l on l.id = t.location_id where t.id = $1',
      [actor.tenantId],
    );
    const practiceLegalName = practice.rows[0]?.legal_name;
    if (!practiceLegalName) {
      // The tenant row is the practice; a request that resolved an actor has
      // one. Nothing here can proceed without it, and inventing a name on a
      // legal confirmation is not an option.
      throw new Error('The practice has no legal name to sign an erasure letter with.');
    }

    // The letter's bytes go into the store **before the first audited write
    // of this transaction**, and that ordering is the whole reason this is
    // three steps rather than one. Every audited write takes the audit
    // chain's lock, and a bucket call held between two of them would
    // serialise every other audited write in the practice behind a vendor's
    // network call (app/api/clients/document-store.ts says the same at the
    // seam). If the erasure below then fails, what is left is an object
    // nothing points at — the orphan docs/SEAMS.md already accepts, and the
    // better half of the trade.
    const letter = erasureLetter({
      locale,
      erasedOn: isoDateIn(now(), PRACTICE_TIME_ZONE),
      practiceLegalName,
      practiceAddress: practice.rows[0]?.display_address ?? null,
    });
    const filed = await putPracticeDocumentBytes(storage, actor, {
      bytes: new TextEncoder().encode(letter.text),
      mimeType: ERASURE_LETTER_MIME_TYPE,
    });

    const erased = await db.query<{ summary: { storage_keys_to_delete?: unknown } }>(
      'select app.erase_client($1, $2) as summary',
      [clientId, erasureId],
    );
    await logErasurePerformed(db, clientId);

    await recordPracticeDocument(db, actor, {
      ...filed,
      kind: ERASURE_LETTER_KIND,
      mimeType: ERASURE_LETTER_MIME_TYPE,
      // What was sent is what was sent. Migration 903 freezes it, and a
      // correction would be a second letter rather than an edit of the first.
      isImmutable: true,
      now: now(),
    });
    await db.query(
      'update erasure_request set letter_document_id = $1, letter_version = $2 where id = $3',
      [filed.id, letter.version, erasureId],
    );

    // The bytes, last, and outside the transaction. A delete cannot be rolled
    // back and this transaction still can, so the keys go to the fence
    // (docs/SEAMS.md, the only correct way to remove bytes after a database
    // change). Each is tried on its own; a failure is logged against the
    // request id, never surfaced, and never allowed to interrupt the ones
    // after it, because by then the record is already erased and there is
    // nothing left to refuse. What did not go stays on
    // erasure_request.storage_keys_pending for the sweep to find.
    const keys = z
      .array(z.object({ storageKey: z.string() }))
      .catch([])
      .parse(erased.rows[0]?.summary?.storage_keys_to_delete ?? []);
    if (keys.length > 0) {
      c.get('afterCommit')(async () => {
        for (const { storageKey } of keys) {
          try {
            await storage.delete(storageKey);
          } catch (error) {
            const shape = error as { name?: string; code?: string };
            // The key is not logged: it names a document. The request id is
            // what ties this to the erasure it belongs to.
            console.error(
              JSON.stringify({
                requestId,
                after: 'commit',
                erasure: erasureId,
                name: shape.name,
                code: shape.code,
              }),
            );
          }
        }
      });
    }

    const after = await db.query<RequestRow>(
      `select ${REQUEST_COLUMNS} ${REQUEST_FROM} where e.id = $1`,
      [erasureId],
    );
    const performed = after.rows[0];
    if (!performed) {
      // The row was read a moment ago and app.erase_client refuses to run
      // without it; nothing removes one.
      throw new Error('The erasure request vanished while it was being performed.');
    }
    // Signed here, in the one moment the person who pressed the button is
    // still allowed to hold it: an admin may perform an erasure and may not
    // open an erased record afterwards. The read is audited before the link is
    // signed (docs/SEAMS.md).
    const link = await signedDocumentLink(db, storage, {
      id: filed.id,
      clientId: null,
      storageKey: filed.storageKey,
    });
    return c.json(ErasurePerformedResponse.parse({ request: toRecord(performed), letter: link }));
  });
}
