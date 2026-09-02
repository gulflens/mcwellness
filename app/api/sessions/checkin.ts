import type { Hono } from 'hono';
import { z } from 'zod';
import {
  canCheckIn,
  replayEvents,
  type CheckInConsentPurpose,
  type SessionEvent,
} from '@domain/session';
import { hasRole } from '@domain/shared';
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
 */

const CONSENT_PURPOSES = ['participation', 'minor_participation', 'home_visit'] as const;

function isConsentPurpose(value: string): value is CheckInConsentPurpose {
  return (CONSENT_PURPOSES as readonly string[]).includes(value);
}

const Params = z.object({ id: z.uuid() });

type ExistingSessionRow = { id: string; checked_in_at: Date };
type PractitionerRow = { id: string };
type ClientRow = { date_of_birth: string | null };
type ServiceTypeRow = { id: string };
type ConsentRow = { purpose: string };

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

    // Idempotent replay: the outbox may deliver the same event more than
    // once (section 2). If this session already exists, this is a resend of
    // an already-successful check-in, not a new attempt.
    const existing = await db.query<ExistingSessionRow>(
      'select id, checked_in_at from session where id = $1 and tenant_id = app.current_tenant_id()',
      [sessionId],
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      return c.json(
        CheckInResponse.parse({
          status: 'checked_in',
          sessionId: existingRow.id,
          checkedInAt: existingRow.checked_in_at.toISOString(),
        }),
        200,
      );
    }

    const practitioner = await db.query<PractitionerRow>(
      "select id from practitioner where user_id = $1 and tenant_id = app.current_tenant_id() and status = 'active'",
      [actor.userId],
    );
    const practitionerId = practitioner.rows[0]?.id;
    if (!practitionerId) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    // Defensive re-check: a foreign key alone does not stop a caller naming
    // another tenant's real client or service type. Row security governs
    // what a query can see, not what a literal id can reference on insert.
    const client = await db.query<ClientRow>(
      'select date_of_birth from client where id = $1 and tenant_id = app.current_tenant_id()',
      [started.payload.clientId],
    );
    const clientRow = client.rows[0];
    if (!clientRow) {
      return c.json({ error: 'bad_request', requestId, detail: 'client_not_found' }, 400);
    }
    const serviceType = await db.query<ServiceTypeRow>(
      "select id from service_type where id = $1 and tenant_id = app.current_tenant_id() and status = 'active'",
      [started.payload.serviceTypeId],
    );
    if (!serviceType.rows[0]) {
      return c.json({ error: 'bad_request', requestId, detail: 'service_type_not_found' }, 400);
    }

    // Consent as of this moment (00-data-model.md section 3: every session
    // start checks it fresh, never a cached flag).
    const consents = await db.query<ConsentRow>(
      'select purpose from consent where client_id = $1 and tenant_id = app.current_tenant_id() ' +
        "and status = 'active' and (expires_at is null or expires_at > now())",
      [started.payload.clientId],
    );
    const activeConsentPurposes = consents.rows.map((row) => row.purpose).filter(isConsentPurpose);

    const gate = canCheckIn(
      {
        actor,
        serviceTypeId: started.payload.serviceTypeId,
        deliveryMode: started.payload.deliveryMode,
        clientDateOfBirth: clientRow.date_of_birth,
        activeConsentPurposes,
      },
      now(),
    );
    if (!gate.ok) {
      // Nothing is written for a blocked attempt: the gate runs before any row exists.
      return c.json(CheckInResponse.parse({ status: 'blocked', reasons: gate.reasons }), 200);
    }

    const event: SessionEvent = {
      id: started.id,
      sessionId,
      seq: started.seq,
      kind: 'session_started',
      deviceAt: started.deviceAt,
      payload: {
        clientId: started.payload.clientId,
        practitionerId,
        serviceTypeId: started.payload.serviceTypeId,
        deliveryMode: started.payload.deliveryMode,
        locationId: started.payload.locationId,
        point: started.payload.point,
      },
    };
    const projection = replayEvents([event]);
    if (!projection) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    // The session row comes first: session_event.session_id references it,
    // so it must exist before the event that names it. The one-open-visit
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
          projection.clientId,
          projection.practitionerId,
          projection.serviceTypeId,
          projection.deliveryMode,
          projection.locationId,
          projection.checkedInAt,
          projection.checkedInPoint?.lng ?? null,
          projection.checkedInPoint?.lat ?? null,
          actor.userId,
        ],
      );
      await db.query(
        'insert into session_event (id, tenant_id, session_id, client_id, practitioner_id, seq, ' +
          'kind, payload, device_at) values ($1, app.current_tenant_id(), $2, $3, $4, $5, $6, $7::jsonb, $8) ' +
          'on conflict (id) do nothing',
        [
          event.id,
          sessionId,
          projection.clientId,
          projection.practitionerId,
          event.seq,
          event.kind,
          JSON.stringify(event.payload),
          event.deviceAt,
        ],
      );
      await db.query('release savepoint check_in');
    } catch (error) {
      await db.query('rollback to savepoint check_in');
      if ((error as { code?: string }).code === '23505') {
        return c.json(
          CheckInResponse.parse({ status: 'blocked', reasons: ['already_checked_in'] }),
          200,
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
