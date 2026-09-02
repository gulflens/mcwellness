import type { Hono } from 'hono';
import { z } from 'zod';
import {
  canCheckIn,
  replayEvents,
  type CheckInConsentPurpose,
  type SessionEvent,
} from '@domain/session';
import { hasRole } from '@domain/shared';
import { logRefusal } from './audit';
import type { ApiEnv } from '../_middleware/request-context';
import { CheckInRequest, CheckInResponse } from './schema';

/**
 * POST /api/sessions/:id/events — the offline outbox's server side
 * (docs/SPEC/session-capture.md sections 2 and 4): the device flushes its
 * queued events here, keyed by their own client-generated ids, and the
 * server folds them into the session row.
 *
 * This pull request accepts only the visit's opening event and stops at
 * check-in: signal check, run, end, close and their event kinds arrive with
 * their own screens. Not mounted in app/api/create-api.ts yet — see
 * docs/CHANGE-REQUESTS/session-capture-01.md; the database tests mount it
 * directly on the Hono instance createApi returns.
 *
 * Every refusal — wrong role, no practitioner row, someone else's session,
 * an unverified or foreign client or service type, the gate, or a genuine
 * second open visit — is written to the audit trail before the response
 * goes out (session-capture.md section 8), never only the gate's.
 */

const CONSENT_PURPOSES = ['participation', 'minor_participation', 'home_visit'] as const;

function isConsentPurpose(value: string): value is CheckInConsentPurpose {
  return (CONSENT_PURPOSES as readonly string[]).includes(value);
}

const Params = z.object({ id: z.uuid() });

// How far a device's own clock may drift from the server's before its event
// is refused rather than trusted as the visit's checked-in time.
const DEVICE_CLOCK_WINDOW_MS = 15 * 60 * 1000;

type ExistingSessionRow = { id: string; checked_in_at: Date; practitioner_id: string };
type PractitionerRow = { id: string };
type ServiceTypeRow = { id: string };
// Mirrors app.checkin_context's return row (db/migrations/301_checkin_context.sql):
// deliberately narrower than the client table itself — no name, no contact
// detail, nothing beyond what canCheckIn's gate reads. client_id is the
// function's own resolution of whichever of clientId/clientMrn the caller
// sent — null whenever found is false, never trusted from the request body.
type CheckinContextRow = {
  found: boolean;
  client_id: string | null;
  status: string;
  has_date_of_birth: boolean;
  is_minor: boolean;
  active_consent_purposes: string[];
};

export function mountSessions(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/sessions/:id/events', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');

    const params = Params.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const sessionId = params.data.id;

    // Wrong role entirely: this person has no business at this door at all.
    if (!hasRole(actor, 'practitioner', 'lead_practitioner')) {
      await logRefusal(db, 'session', sessionId, null, ['wrong_role']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const parsed = CheckInRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    // A batch of exactly one 'session_started' event: everything else is
    // malformed for this pull request (the zod schema already refuses any
    // other kind; this refuses a batch that mixes it with anything, or with
    // itself, once retries are excluded by the idempotent check below).
    if (parsed.data.events.length !== 1) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const started = parsed.data.events[0];
    if (!started) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    // A device's clock is trusted only within a window of the server's own:
    // outside it, the event is refused rather than becoming a wrong
    // checked_in_at an outbox would otherwise retry against forever.
    const deviceAtMs = Date.parse(started.deviceAt);
    if (Math.abs(deviceAtMs - now().getTime()) > DEVICE_CLOCK_WINDOW_MS) {
      // Nothing is verified yet at this point, so the refusal names no client.
      await logRefusal(db, 'session', sessionId, null, ['device_clock_out_of_range']);
      return c.json({ error: 'bad_request', requestId, detail: 'device_clock_out_of_range' }, 400);
    }

    const practitioner = await db.query<PractitionerRow>(
      "select id from practitioner where user_id = $1 and tenant_id = app.current_tenant_id() and status = 'active'",
      [actor.userId],
    );
    const practitionerId = practitioner.rows[0]?.id;
    if (!practitionerId) {
      await logRefusal(db, 'session', sessionId, null, ['no_practitioner_row']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    // Idempotent replay: the outbox may deliver the same event more than
    // once (section 2). An existing session answers as checked_in only when
    // it is this practitioner's own and the posted event is the one already
    // stored — never another practitioner's session handed back, and never
    // a different, new event silently dropped behind a borrowed success.
    const existing = await db.query<ExistingSessionRow>(
      'select id, checked_in_at, practitioner_id from session where id = $1 and tenant_id = app.current_tenant_id()',
      [sessionId],
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      if (existingRow.practitioner_id !== practitionerId) {
        await logRefusal(db, 'session', sessionId, null, ['session_not_yours']);
        return c.json({ error: 'forbidden', requestId }, 403);
      }
      const existingEvent = await db.query<{ id: string }>(
        'select id from session_event where session_id = $1 and id = $2',
        [sessionId, started.id],
      );
      if (existingEvent.rows[0]) {
        return c.json(
          CheckInResponse.parse({
            status: 'checked_in',
            sessionId: existingRow.id,
            checkedInAt: existingRow.checked_in_at.toISOString(),
          }),
          200,
        );
      }
      // This practitioner's own already-open visit, but a different event:
      // nothing past session_started is handled yet (section 9).
      return c.json({ error: 'bad_request', requestId, detail: 'event_not_recognised' }, 400);
    }

    // Defensive re-check: a foreign key alone does not stop a caller naming
    // another tenant's real client or service type. Row security governs
    // what a query can see, not what a literal id can reference on insert.
    //
    // The client-record stream (pull request 21, not yet merged into this
    // worktree) adds restrictive read policies under which a practitioner
    // sees a client only when app.client_visible_to_practitioner() says so —
    // and today it always says no, because the scheduling stream that fills
    // it in has not landed either. A direct select here would see nothing the
    // moment that stream merges. app.checkin_context (301_checkin_context.sql)
    // is the door this route uses instead: security definer, so it reads
    // straight through that gate, and narrow — status, whether a date of
    // birth is on file, whether the client counts as a minor today, and the
    // consent purposes canCheckIn's gate actually reads. Never a name, never
    // a contact detail. It resolves the client by clientId or clientMrn,
    // whichever the request carried (schema.ts's CheckInRequest already
    // guarantees exactly one), and found = false covers "no such client", "a
    // client belonging to another tenant" and, as of this pull request, "this
    // client has no appointment with this practitioner today" — the same
    // generic client_not_found refusal for all three, exactly as the old
    // direct select's empty result was for the first two.
    const context = await db.query<CheckinContextRow>(
      'select found, client_id, status, has_date_of_birth, is_minor, active_consent_purposes ' +
        'from app.checkin_context($1, $2)',
      [parsed.data.clientId ?? null, parsed.data.clientMrn ?? null],
    );
    const contextRow = context.rows[0];
    if (!contextRow?.found || !contextRow.client_id) {
      await logRefusal(db, 'session', sessionId, null, ['client_not_found']);
      return c.json({ error: 'bad_request', requestId, detail: 'client_not_found' }, 400);
    }
    // The function's own resolution, never the caller's raw clientId: when
    // the request named the client by clientMrn, this is the only place the
    // route ever learns the id, and every write and refusal from here on
    // uses it.
    const clientId = contextRow.client_id;
    const serviceType = await db.query<ServiceTypeRow>(
      "select id from service_type where id = $1 and tenant_id = app.current_tenant_id() and status = 'active'",
      [started.payload.serviceTypeId],
    );
    if (!serviceType.rows[0]) {
      await logRefusal(db, 'session', sessionId, clientId, ['service_type_not_found']);
      return c.json({ error: 'bad_request', requestId, detail: 'service_type_not_found' }, 400);
    }

    // app.checkin_context already scoped this to consent as of now (00-data-
    // model.md section 3: every session start checks it fresh, never a cached
    // flag) and to the three purposes canCheckIn reads; this filter is the
    // same type narrowing isConsentPurpose always did, now over a shorter list.
    const activeConsentPurposes = contextRow.active_consent_purposes.filter(isConsentPurpose);

    // canCheckIn (domain/session/canCheckIn.ts) takes hasDateOfBirth and
    // isMinor directly, straight from app.checkin_context — it never sees an
    // actual date of birth, only whether one is on file and whether it makes
    // the client a minor today, judged in Asia/Dubai by that same function
    // (canCheckIn's own PRACTICE_TIME_ZONE, so the two never disagree about
    // which side of midnight "today" falls on).
    const gate = canCheckIn(
      {
        actor,
        serviceTypeId: started.payload.serviceTypeId,
        deliveryMode: started.payload.deliveryMode,
        hasDateOfBirth: contextRow.has_date_of_birth,
        isMinor: contextRow.is_minor,
        activeConsentPurposes,
      },
      now(),
    );
    if (!gate.ok) {
      // No session or session_event row exists for a refused check-in, but
      // the refusal itself is audited (session-capture.md section 8: "every
      // block reason"). The route's own transaction commits normally on a
      // 4xx, so this row is not undone by the refusal it records.
      await logRefusal(db, 'session', sessionId, clientId, gate.reasons);
      return c.json(CheckInResponse.parse({ status: 'blocked', reasons: gate.reasons }), 422);
    }

    // No clientId, no point: those are recorded on the session row directly
    // below, never duplicated into the event's own payload (see
    // domain/session/types.ts's SessionStartedPayload).
    const event: SessionEvent = {
      id: started.id,
      sessionId,
      seq: started.seq,
      kind: 'session_started',
      deviceAt: started.deviceAt,
      payload: {
        practitionerId,
        serviceTypeId: started.payload.serviceTypeId,
        deliveryMode: started.payload.deliveryMode,
        locationId: started.payload.locationId,
      },
    };
    const projection = replayEvents([event]);
    if (!projection) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    // The session row comes first: session_event's composite foreign key
    // needs it to exist before the event that names it. The one-open-visit
    // partial unique index lives on session, so a genuine "already checked
    // in on another visit" surfaces here, as a unique violation, without
    // aborting the rest of this request's transaction.
    await db.query('savepoint check_in');
    try {
      await db.query(
        'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
          'delivery_mode, location_id, checked_in_at, checked_in_point, created_by) values ' +
          '($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, ' +
          'case when $8::float8 is null then null else extensions.st_geogfromtext(' +
          "'SRID=4326;POINT(' || $8::float8 || ' ' || $9::float8 || ')') end, $10)",
        [
          sessionId,
          clientId,
          projection.practitionerId,
          projection.serviceTypeId,
          projection.deliveryMode,
          projection.locationId,
          projection.checkedInAt,
          parsed.data.point?.lng ?? null,
          parsed.data.point?.lat ?? null,
          actor.userId,
        ],
      );
      // Never a silent no-op: on conflict do nothing exists only for a
      // genuine resend of this exact event id, which the idempotent check
      // above already handled — reaching here with zero rows written means
      // this event id collided with an unrelated row, and the request fails
      // rather than reporting a false success.
      const eventInsert = await db.query(
        'insert into session_event (id, tenant_id, session_id, client_id, practitioner_id, seq, ' +
          'kind, payload, device_at, created_by) values ' +
          '($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7::jsonb, $8, $9) ' +
          'on conflict (id) do nothing returning id',
        [
          event.id,
          sessionId,
          clientId,
          projection.practitionerId,
          event.seq,
          event.kind,
          JSON.stringify(event.payload),
          event.deviceAt,
          actor.userId,
        ],
      );
      if (eventInsert.rowCount !== 1) {
        await db.query('rollback to savepoint check_in');
        return c.json({ error: 'conflict', requestId, detail: 'event_id_collision' }, 409);
      }
      await db.query('release savepoint check_in');
    } catch (error) {
      await db.query('rollback to savepoint check_in');
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === '23505' && pgError.constraint === 'session_pkey') {
        // Possibly a race with this same device's own earlier attempt,
        // which committed between this request's idempotent check above and
        // its own insert just now: re-read and answer as checked_in only if
        // it is genuinely this practitioner's row.
        const reread = await db.query<ExistingSessionRow>(
          'select id, checked_in_at, practitioner_id from session where id = $1 and tenant_id = app.current_tenant_id()',
          [sessionId],
        );
        const row = reread.rows[0];
        if (row && row.practitioner_id === practitionerId) {
          return c.json(
            CheckInResponse.parse({
              status: 'checked_in',
              sessionId: row.id,
              checkedInAt: row.checked_in_at.toISOString(),
            }),
            200,
          );
        }
      }
      if (pgError.code === '23505') {
        // Any other unique violation — a genuine second open visit
        // elsewhere, or a colliding id that turned out not to be this
        // practitioner's own — is a refusal, not a success.
        await logRefusal(db, 'session', sessionId, clientId, ['already_checked_in']);
        return c.json(
          CheckInResponse.parse({ status: 'blocked', reasons: ['already_checked_in'] }),
          422,
        );
      }
      throw error;
    }

    return c.json(
      CheckInResponse.parse({
        status: 'checked_in',
        sessionId,
        checkedInAt: projection.checkedInAt,
      }),
      201,
    );
  });
}
