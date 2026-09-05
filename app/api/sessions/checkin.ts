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
import type { ApiEnv, Db } from '../_middleware/request-context';
import { appendEvents } from './events';
import { mountClose } from './close';
import { mountOpenSession } from './open';
import { CheckInRequest, CheckInResponse, SessionEventsRequest } from './schema';
import { resolvePractitioner } from './session-row';
import { mountServiceTypes } from './service-types';

/**
 * mountSessions mounts every route this stream owns: POST
 * /api/sessions/:id/events below, GET /api/sessions/open (./open.ts), POST
 * /api/sessions/:id/close (./close.ts) and GET /api/sessions/service-types
 * (./service-types.ts).
 *
 * POST /api/sessions/:id/events — the offline outbox's server side
 * (docs/SPEC/session-capture.md sections 2 and 4): the device flushes its
 * queued events here, keyed by their own client-generated ids, and the
 * server folds them into the session row.
 *
 * One path, two branches, because the outbox has one address to post to:
 *
 * - a batch carrying `session_started` **opens** the visit, and runs the
 *   check-in gate below — the consent, credential and booking checks section
 *   3.1 puts at the door. It is online-only by design: those checks happen on
 *   the server, at execution time, never from a cached answer
 *   (.claude/rules/compliance.md), and section 3.1 names an offline check-in
 *   as a Phase 2 intention rather than something this ships.
 * - every other batch **appends** to a visit already open (./events.ts), and
 *   that half is what works with no signal: the practitioner checks in at the
 *   door with a bar of reception and the rest of the visit queues locally.
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

/**
 * Whether the setup photo may be offered on this visit at all
 * (app/therapist/session): one boolean, from the definer door in
 * 304_session_reads.sql, so the runner never has to ask a second time and
 * never sees a consent row.
 */
async function photoConsent(db: Db, sessionId: string): Promise<boolean> {
  const { rows } = await db.query<{ active: boolean }>(
    "select app.session_consent_active($1, 'photo_video') as active",
    [sessionId],
  );
  return rows[0]?.active === true;
}

// How far a device's own clock may drift from the server's before its event
// is refused rather than trusted as the visit's checked-in time.
const DEVICE_CLOCK_WINDOW_MS = 15 * 60 * 1000;

type ExistingSessionRow = { id: string; checked_in_at: Date; practitioner_id: string };
type ServiceTypeRow = { id: string };
// Mirrors app.checkin_context's return row (db/migrations/301_checkin_context.sql):
// deliberately narrower than the client table itself — no name, no contact
// detail, nothing beyond what canCheckIn's gate reads. client_id is the
// function's own resolution of whichever of clientId/clientMrn the caller
// sent — null whenever found is false, never trusted from the request body.
type CheckinContextRow = {
  found: boolean;
  client_id: string | null;
  has_date_of_birth: boolean;
  is_minor: boolean;
  active_consent_purposes: string[];
  // The caller's own instruments (db/migrations/306_kit_and_setup_photo.sql).
  // Answered whatever `found` says, because they describe the practitioner
  // rather than the client.
  kit_calibration_overdue: boolean;
  kit_id: string | null;
};

export function mountSessions(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountServiceTypes(api, now);
  mountOpenSession(api);
  mountClose(api, now);

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

    const body: unknown = await c.req.json().catch(() => null);
    const batch = SessionEventsRequest.safeParse(body);
    if (!batch.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    const practitionerId = await resolvePractitioner(db, actor.userId);
    if (!practitionerId) {
      await logRefusal(db, 'session', sessionId, null, ['no_practitioner_row']);
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    // No opening event in the batch: this belongs to a visit already open,
    // and the rest of the flush is ./events.ts's.
    if (!batch.data.events.some((event) => event.kind === 'session_started')) {
      return appendEvents(
        c,
        sessionId,
        practitionerId,
        batch.data.events,
        batch.data.point ?? null,
        now,
      );
    }

    // Opening a visit is the narrower shape: exactly one of clientId and
    // clientMrn, and a payload with no practitioner id in it.
    const parsed = CheckInRequest.safeParse(body);
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
            photoConsent: await photoConsent(db, sessionId),
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
    // straight through that gate, and narrow — whether a date of birth is
    // on file, whether the client counts as a minor today, and the consent
    // purposes canCheckIn's gate actually reads. Never a name, never a
    // contact detail. It resolves the client by clientId or clientMrn,
    // whichever the request carried (schema.ts's CheckInRequest already
    // guarantees exactly one), and found = false covers "no such client", "a
    // client belonging to another tenant" and, as of this pull request, "this
    // client has no appointment with this practitioner today" — one generic
    // not_booked_today refusal for all three (renamed from client_not_found):
    // the practitioner is told the visit is not booked for them today, which
    // is true in every one of those cases and reveals nothing about which it
    // actually was.
    const context = await db.query<CheckinContextRow>(
      'select found, client_id, has_date_of_birth, is_minor, active_consent_purposes, ' +
        'kit_calibration_overdue, kit_id ' +
        'from app.checkin_context($1, $2)',
      [parsed.data.clientId ?? null, parsed.data.clientMrn ?? null],
    );
    const contextRow = context.rows[0];
    if (!contextRow?.found || !contextRow.client_id) {
      await logRefusal(db, 'session', sessionId, null, ['not_booked_today']);
      return c.json({ error: 'bad_request', requestId, detail: 'not_booked_today' }, 400);
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
        // The sixth reason (docs/SPEC/practitioner-phone.md section 6.3).
        // domain/session/kit.ts is the rule; app.checkin_context mirrors it in
        // SQL and hands back the answer, so the screen and the door cannot
        // disagree about whether an amplifier is in date.
        kitCalibrationOverdue: contextRow.kit_calibration_overdue,
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

    // Which booked visit this check-in belongs to. app.checkin_context (301)
    // has already proved one exists — that is what its `found` means — but
    // it hands back no id, so the row is read here instead. An ordinary
    // select, not another definer door: a practitioner may read their own
    // appointments (db/policies/scheduling/appointment_access.sql), and this
    // asks for exactly the row that policy already shows them. Null is not a
    // failure; a session with no appointment simply closes without one to
    // flip (app.complete_appointment_for_session, 302).
    //
    // Ordered by the visit the practitioner is actually standing in front of,
    // never merely by the earliest of the day: a household with a morning and
    // an afternoon visit would otherwise have its 16:00 check-in stamped onto
    // the 08:00 row, and every consequence of that — the wrong row marked
    // checked in, the wrong row completed at close — would follow silently.
    // First key: does the window contain this moment. Second: distance from
    // this moment to the window, zero inside it, so a check-in in the gap
    // between two visits takes the nearer one whether it has just finished or
    // is about to start. greatest(..., interval '0') is that distance written
    // out; the containment key is redundant beside it by construction and is
    // kept because it states the intent the ordering exists for.
    const appointment = await db.query<{ id: string; status: string }>(
      'select a.id, a.status::text as status from appointment a ' +
        'where a.tenant_id = app.current_tenant_id() and a.client_id = $1 ' +
        'and a.practitioner_id = $2 ' +
        "and a.status in ('proposed', 'confirmed', 'checked_in') " +
        "and a.window_start < ((date_trunc('day', now() at time zone 'Asia/Dubai')::date + 1)" +
        "::timestamp at time zone 'Asia/Dubai') " +
        "and a.window_end > ((date_trunc('day', now() at time zone 'Asia/Dubai')::date)" +
        "::timestamp at time zone 'Asia/Dubai') " +
        'order by (now() >= a.window_start and now() < a.window_end) desc, ' +
        "greatest(a.window_start - now(), now() - a.window_end, interval '0') asc, " +
        'a.window_start asc limit 1',
      [clientId, practitionerId],
    );
    const appointmentId = appointment.rows[0]?.id ?? null;
    const appointmentStatus = appointment.rows[0]?.status ?? null;

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
          'delivery_mode, location_id, checked_in_at, checked_in_point, created_by, ' +
          'appointment_id, kit_id) values ' +
          '($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7, ' +
          'case when $8::float8 is null then null else extensions.st_geogfromtext(' +
          "'SRID=4326;POINT(' || $8::float8 || ' ' || $9::float8 || ')') end, $10, $11, $12)",
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
          appointmentId,
          // Which instrument ran the visit (section 6.1). The caller's one
          // active amplifier when they have exactly one assigned; null
          // otherwise, because a guess between two is worse than a blank.
          contextRow.kit_id,
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
      // And the appointment behind the visit now says so
      // (db/migrations/305_appointment_checked_in.sql). In the same
      // transaction as the session and its opening event, so a visit is never
      // running against an appointment that still reads 'confirmed': that gap
      // is what let a running visit be moved or late-cancelled, since every
      // guard written in terms of a checked-in visit had a status nothing
      // ever wrote.
      //
      // The answer is deliberately not read. False means the appointment was
      // only proposed, or there was none at all (a walk-up visit), or a
      // replay found the row already checked in — none of which is a reason
      // to undo a check-in that has passed every gate at the door. The door
      // itself refuses anything that is not this caller's own open session
      // and a 'confirmed' appointment of their own; there is nothing left
      // here for the route to check.
      const marked = await db.query<{ marked: boolean }>(
        'select app.mark_appointment_checked_in($1) as marked',
        [sessionId],
      );
      // A confirmed appointment of this practitioner's own that the door
      // nevertheless declined to mark is the one combination nothing above
      // explains — a cancellation landing between the select and the flip, say.
      // Not an error: the check-in stands either way, and the day is not
      // stopped for it. Debug level, opaque ids only, no client and no name,
      // so the line is safe wherever logs are kept (.claude/rules/compliance.md).
      if (appointmentStatus === 'confirmed' && marked.rows[0]?.marked !== true) {
        console.debug(
          JSON.stringify({
            event: 'appointment_not_marked_checked_in',
            requestId,
            sessionId,
            appointmentId,
          }),
        );
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
              photoConsent: await photoConsent(db, sessionId),
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
        photoConsent: await photoConsent(db, sessionId),
      }),
      201,
    );
  });
}
