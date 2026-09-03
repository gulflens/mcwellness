import type { Context } from 'hono';
import {
  deriveObservationFlag,
  replayEvents,
  scoreSignalQuality,
  type SessionEvent,
} from '@domain/session';
import { logRefusal } from './audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import {
  lastSeqOf,
  loadSession,
  readEvents,
  writeCheckedOutPoint,
  writeProjection,
  type SessionRow,
} from './session-row';
import {
  EventsResponse,
  SessionState,
  type EventRefusalReason,
  type SessionEventWire,
} from './schema';
import { PHOTO_STORAGE_AVAILABLE } from './photo-availability';

/**
 * The rest of the outbox's flush: every event after the one that opened the
 * visit (docs/SPEC/session-capture.md section 2). The device posts what it
 * has, whenever it has a connection; the server stores what it does not
 * already hold, replays the whole stream, and hands back exactly which ids
 * it now owns so the outbox can let those go and keep the rest.
 *
 * Two properties this route owes the device, and both are proved against a
 * real database in tests/session/db/run.test.ts:
 *
 * - **Idempotent on the event id.** A resend of an event already stored is a
 *   success, not a conflict and not a second row. The id is the device's
 *   own, generated once when the event was queued, so the same tap can be
 *   delivered any number of times.
 * - **Ordered by seq.** Events are read back and folded in seq order however
 *   they arrived, so a batch that reaches the server out of order, split
 *   across requests, or interleaved with a retry projects the same visit.
 *
 * Consent is checked here, at execution time, not cached on the device
 * (.claude/rules/compliance.md): a `photo_captured` event for a client with
 * no active `photo_video` consent is refused by name, and the practitioner's
 * screen never offered the camera in the first place. Belt and braces on
 * purpose — the screen is a courtesy, the server is the boundary.
 */

/** How far a device's clock may run ahead of the server's before its event is refused. */
const CLOCK_AHEAD_MS = 15 * 60 * 1000;
/** And how far behind the visit's own check-in it may claim to be. */
const CLOCK_BEHIND_CHECK_IN_MS = 15 * 60 * 1000;

type Refusal = { id: string; reason: EventRefusalReason };

/** The unique constraint `unique (session_id, seq)` in 300_session.sql. */
const SEQ_CONSTRAINT = 'session_event_session_id_seq_key';

function stateOf(session: SessionRow, events: readonly SessionEvent[]): SessionState {
  const projection = replayEvents(events);
  return SessionState.parse({
    id: session.id,
    phase: projection?.phase ?? 'in_progress',
    checkedInAt: session.checked_in_at.toISOString(),
    startedAt: projection?.startedAt ?? null,
    endedAt: projection?.endedAt ?? null,
    checkedOutAt: projection?.checkedOutAt ?? null,
    signalQualityScore: scoreSignalQuality(projection?.telemetry ?? []),
    closed: session.closed_at !== null,
    lastSeq: lastSeqOf(events),
  });
}

/**
 * Appends a batch to a visit already open. Returns the route's response; the
 * caller (./checkin.ts, which owns the path) decides nothing beyond which
 * branch to take.
 */
export async function appendEvents(
  c: Context<ApiEnv>,
  sessionId: string,
  practitionerId: string,
  events: readonly SessionEventWire[],
  /**
   * The coordinate the practitioner is standing on, carried beside the batch
   * rather than inside an event — session-level, exactly as check-in carries
   * its own (domain/session/events.ts explains why). Read only when the batch
   * carries the check-out.
   */
  point: { lat: number; lng: number } | null,
  now: () => Date,
): Promise<Response> {
  const db = c.get('db');
  const actor = c.get('actor');
  const requestId = c.get('requestId');

  const session = await loadSession(db, sessionId);
  if (!session) {
    // No row, or a row this caller's tenant cannot see: the same answer, for
    // the same reason app.checkin_context gives one generic refusal.
    await logRefusal(db, 'session', sessionId, null, ['session_not_found']);
    return c.json({ error: 'not_found', requestId }, 404);
  }
  if (session.practitioner_id !== practitionerId) {
    await logRefusal(db, 'session', sessionId, null, ['session_not_yours']);
    return c.json({ error: 'forbidden', requestId }, 403);
  }
  if (session.closed_at !== null) {
    // The device may have been offline through the whole close. This is a
    // refusal it should stop retrying, not a failure it should queue behind.
    await logRefusal(db, 'session', sessionId, session.client_id, ['session_closed']);
    return c.json({ error: 'conflict', requestId, detail: 'session_closed' }, 409);
  }

  const acknowledged: string[] = [];
  const refused: Refusal[] = [];
  const stored: string[] = [];
  const nowMs = now().getTime();
  const checkedInMs = session.checked_in_at.getTime();
  // Asked once per request, not once per event: a client's consent does not
  // change inside a single transaction, and the door is a definer function.
  let photoConsent: boolean | null = null;

  for (const event of events) {
    if (event.kind === 'session_started') {
      // Not reachable: ./checkin.ts sends a batch containing one only to its
      // own branch. Named here so the exhaustive shape is honest rather than
      // silently falling through to an insert of the wrong payload.
      continue;
    }

    const deviceAtMs = Date.parse(event.deviceAt);
    if (
      deviceAtMs > nowMs + CLOCK_AHEAD_MS ||
      deviceAtMs < checkedInMs - CLOCK_BEHIND_CHECK_IN_MS
    ) {
      refused.push({ id: event.id, reason: 'device_clock_out_of_range' });
      continue;
    }

    if (event.kind === 'photo_captured') {
      // Consent first, and it is the more important of the two refusals: a
      // household that has not agreed to photographs must be told that,
      // whatever the state of the storage seam.
      photoConsent ??= await hasPhotoConsent(db, sessionId);
      if (!photoConsent) {
        await logRefusal(db, 'session_event', event.id, session.client_id, [
          'consent_missing_photo_video',
        ]);
        refused.push({ id: event.id, reason: 'consent_missing_photo_video' });
        continue;
      }
      if (!PHOTO_STORAGE_AVAILABLE) {
        // Nowhere to put the bytes yet (./photo-availability.ts). Accepting
        // the event would mean filing a document row against a key nothing
        // ever uploads to, which is a record of a photograph that does not
        // exist; refusing it is the honest answer and the device stops
        // asking.
        await logRefusal(db, 'session_event', event.id, session.client_id, [
          'photo_storage_unavailable',
        ]);
        refused.push({ id: event.id, reason: 'photo_storage_unavailable' });
        continue;
      }
    }

    if (event.kind === 'checked_out' && point !== null) {
      if (!session.has_checked_in_point) {
        // "The position only if sharing was switched on at check-in"
        // (section 3.6). Enforced here rather than trusted from the device:
        // a practitioner who declined at the door declined for the visit.
        await logRefusal(db, 'session_event', event.id, session.client_id, [
          'location_not_shared_at_check_in',
        ]);
        refused.push({ id: event.id, reason: 'location_not_shared_at_check_in' });
        continue;
      }
    }

    const outcome = await insertEvent(db, session, event, actor.userId);
    if (outcome === 'duplicate_seq') {
      await logRefusal(db, 'session_event', event.id, session.client_id, ['duplicate_seq']);
      refused.push({ id: event.id, reason: 'duplicate_seq' });
      continue;
    }
    if (outcome === 'stored') {
      stored.push(event.id);
      if (event.kind === 'checked_out' && point !== null) {
        await writeCheckedOutPoint(db, sessionId, point);
      }
    }
    // 'stored' and 'already_held' are the same answer to the device: the
    // server has this event and the outbox may let it go.
    acknowledged.push(event.id);
  }

  const stream = await readEvents(db, sessionId);
  const projection = replayEvents(stream);
  // Only when something was actually stored, and then only when the
  // projection it folds to differs from the one already on the row: every
  // update writes an audit row, and a visit copied out unchanged on every
  // thirty-second retry buries the changes that matter.
  if (projection && stored.length > 0) {
    await writeProjection(
      db,
      session,
      projection,
      scoreSignalQuality(projection.telemetry),
      deriveObservationFlag(projection.observations),
    );
  }

  return c.json(
    EventsResponse.parse({
      status: 'stored',
      acknowledged,
      refused,
      session: stateOf(session, stream),
    }),
    200,
  );
}

async function hasPhotoConsent(db: Db, sessionId: string): Promise<boolean> {
  // app.session_consent_active (304_session_reads.sql): a definer door that
  // answers one boolean about one purpose for the caller's own session, and
  // never hands back a consent row, a date or a name.
  const { rows } = await db.query<{ active: boolean }>(
    "select app.session_consent_active($1, 'photo_video') as active",
    [sessionId],
  );
  return rows[0]?.active === true;
}

/**
 * One event, in its own savepoint so a clash on one does not abort the batch.
 *
 * `on conflict (id) do nothing` is the idempotency: a resend writes nothing
 * and reports no row, which is a success. A unique violation that is *not*
 * the id is a genuine disagreement — two different events claiming the same
 * position in the visit — and is refused by name rather than swallowed.
 */
async function insertEvent(
  db: Db,
  session: SessionRow,
  event: Exclude<SessionEventWire, { kind: 'session_started' }>,
  userId: string,
): Promise<'stored' | 'already_held' | 'duplicate_seq'> {
  await db.query('savepoint append_event');
  try {
    const result = await db.query(
      'insert into session_event (id, tenant_id, session_id, client_id, practitioner_id, seq, ' +
        'kind, payload, device_at, created_by) values ' +
        '($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7::jsonb, $8, $9) ' +
        'on conflict (id) do nothing returning id',
      [
        event.id,
        session.id,
        session.client_id,
        session.practitioner_id,
        event.seq,
        event.kind,
        JSON.stringify(event.payload),
        event.deviceAt,
        userId,
      ],
    );
    await db.query('release savepoint append_event');
    return result.rowCount === 1 ? 'stored' : 'already_held';
  } catch (error) {
    await db.query('rollback to savepoint append_event');
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === SEQ_CONSTRAINT) {
      return 'duplicate_seq';
    }
    throw error;
  }
}
