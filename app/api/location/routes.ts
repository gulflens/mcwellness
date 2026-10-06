import type { Hono } from 'hono';
import { canActor, hasRole } from '@domain/shared';
import {
  STAFF_LOCATION_NOTICE_VERSION,
  mayWritePosition,
  positionAgeMinutes,
  practiceDate,
  shiftWindow,
  type AppointmentStatus,
  type ShiftStop,
  type ShiftWindow,
} from '@domain/scheduling';
import { logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { dayRange } from '../routing/estimates';
import {
  GiveConsentInput,
  LocationMeResponse,
  PositionInput,
  SetSharingInput,
  SharedPositionsResponse,
} from './schema';

/**
 * Live location for the dispatcher, consent-first (docs/SPEC/dispatch.md
 * section 15, piece twenty-five).
 *
 * | Route | Who |
 * |---|---|
 * | `GET /api/location/me` | anybody signed in; answers `eligible: false` for somebody with no day of their own |
 * | `POST /api/location/consent` | the person, for themselves |
 * | `POST /api/location/consent/withdraw` | the person, for themselves |
 * | `PUT /api/location/sharing` | the person, for themselves |
 * | `POST /api/location/positions` | the person, for themselves, while consent, switch and shift all hold |
 * | `GET /api/location/positions` | the board's three roles |
 *
 * **Nobody acts for anybody else.** No route here takes a person's id: every
 * write is about the caller, resolved from the fence's own actor stamp, and
 * the policies (db/policies/dispatch/location.sql) refuse a row whose
 * `user_id` is not the caller's — so the owner cannot switch a practitioner on
 * even by writing SQL through this API.
 *
 * **Positions never reach the audit log.** The table carries no audit
 * trigger (migration 211), and the board's read writes one `read` row per
 * position shown that names the position by id and nothing else: who looked,
 * when, at whose last position — never where it was. A consent, a withdrawal
 * and every turn of the switch are audited as ordinary rows.
 */

/** Who may share: somebody with a day of visits, which is a practitioner's or a lead's. */
const OWN_PRACTITIONER_SQL =
  'select id from practitioner where user_id = app.current_actor_id() ' +
  "and tenant_id = app.current_tenant_id() and status = 'active'";

const STANDING_CONSENT_SQL =
  'select id, notice_version, given_at from staff_consent ' +
  'where user_id = app.current_actor_id() and tenant_id = app.current_tenant_id() ' +
  "and purpose = 'location_sharing' and withdrawn_at is null";

const SWITCH_SQL =
  'select sharing_on from location_sharing ' +
  'where user_id = app.current_actor_id() and tenant_id = app.current_tenant_id()';

/** Off, for whoever asks, without creating a row for somebody who never had one. */
const TURN_OFF_SQL =
  'update location_sharing set sharing_on = false ' +
  'where user_id = app.current_actor_id() and tenant_id = app.current_tenant_id() and sharing_on';

const SET_SWITCH_SQL =
  'insert into location_sharing (tenant_id, user_id, sharing_on, created_by) ' +
  'values (app.current_tenant_id(), app.current_actor_id(), $1, app.current_actor_id()) ' +
  'on conflict (user_id) do update set sharing_on = excluded.sharing_on ' +
  'where location_sharing.sharing_on is distinct from excluded.sharing_on';

/**
 * The practitioner's own visits on the day, with what the shift rule needs:
 * when, how long, where each has got to, and when its session closed. Times
 * and states only — no household is read, so nothing here is a disclosure.
 */
const OWN_DAY_SQL =
  'select a.window_start, a.window_end, a.status::text as status, ' +
  'st.duration_minutes, s.closed_at ' +
  'from appointment a ' +
  'join service_type st on st.id = a.service_type_id ' +
  'left join lateral (' +
  'select s.closed_at from session s ' +
  'where s.appointment_id = a.id and s.tenant_id = app.current_tenant_id() ' +
  'order by s.checked_in_at desc limit 1' +
  ') s on true ' +
  'where a.tenant_id = app.current_tenant_id() and st.tenant_id = app.current_tenant_id() ' +
  'and a.practitioner_id = $1 and a.window_start >= $2 and a.window_start < $3';

/**
 * Every last position the caller may see that was recorded today. Row
 * security does the narrowing — the board's roles only, somebody sharing now,
 * and their latest row alone — so this asks for no more than "today".
 */
const SHARED_POSITIONS_SQL =
  'select id, practitioner_id, latitude, longitude, accuracy_metres, recorded_at ' +
  'from practitioner_position ' +
  'where tenant_id = app.current_tenant_id() and recorded_at >= $1 ' +
  'order by practitioner_id';

const REASONS = {
  give: 'gave consent to share location while working',
  withdraw: 'withdrew consent to share location',
  on: 'turned location sharing on',
  off: 'turned location sharing off',
} as const;

async function stampReason(db: Db, reason: string): Promise<void> {
  await db.query("select set_config('app.reason', $1, true)", [reason]);
}

async function ownPractitioner(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(OWN_PRACTITIONER_SQL);
  return rows[0]?.id ?? null;
}

async function standingConsent(
  db: Db,
): Promise<{ id: string; notice_version: string; given_at: Date } | null> {
  const { rows } = await db.query<{ id: string; notice_version: string; given_at: Date }>(
    STANDING_CONSENT_SQL,
  );
  return rows[0] ?? null;
}

async function sharingOn(db: Db): Promise<boolean> {
  const { rows } = await db.query<{ sharing_on: boolean }>(SWITCH_SQL);
  return rows[0]?.sharing_on ?? false;
}

async function shiftOf(db: Db, practitionerId: string, now: Date): Promise<ShiftWindow | null> {
  const [start, end] = dayRange(practiceDate(now));
  const { rows } = await db.query<{
    window_start: Date;
    window_end: Date;
    status: string;
    duration_minutes: number;
    closed_at: Date | null;
  }>(OWN_DAY_SQL, [practitionerId, start, end]);
  const day: ShiftStop[] = rows.map((row) => ({
    windowStart: row.window_start,
    windowEnd: row.window_end,
    durationMinutes: row.duration_minutes,
    status: row.status as AppointmentStatus,
    closedAt: row.closed_at,
  }));
  return shiftWindow(day, { start, end });
}

function isOpen(window: ShiftWindow | null, now: Date): boolean {
  return (
    window !== null &&
    now.getTime() >= window.opensAt.getTime() &&
    now.getTime() < window.closesAt.getTime()
  );
}

async function ownShiftOpen(db: Db, practitionerId: string, now: Date): Promise<boolean> {
  return isOpen(await shiftOf(db, practitionerId, now), now);
}

/** A person with a day of visits of their own: a practitioner or a lead, with a working row. */
async function eligible(db: Db, actor: ApiEnv['Variables']['actor']): Promise<string | null> {
  if (!hasRole(actor, 'practitioner', 'lead_practitioner')) return null;
  return ownPractitioner(db);
}

export function mountLocation(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/location/me', async (c) => {
    const db = c.get('db');
    const practitionerId = await eligible(db, c.get('actor'));
    const consent = await standingConsent(db);
    if (practitionerId === null) {
      // Somebody who can no longer share still sees what they agreed to and
      // whether their switch is on, so they can withdraw and switch off.
      return c.json(
        LocationMeResponse.parse({
          eligible: false,
          noticeVersion: STAFF_LOCATION_NOTICE_VERSION,
          consent: consent
            ? { noticeVersion: consent.notice_version, givenAt: consent.given_at.toISOString() }
            : null,
          sharingOn: await sharingOn(db),
          shiftOpen: false,
        }),
      );
    }
    return c.json(
      LocationMeResponse.parse({
        eligible: true,
        noticeVersion: STAFF_LOCATION_NOTICE_VERSION,
        consent: consent
          ? { noticeVersion: consent.notice_version, givenAt: consent.given_at.toISOString() }
          : null,
        sharingOn: consent !== null && (await sharingOn(db)),
        shiftOpen: await ownShiftOpen(db, practitionerId, now()),
      }),
    );
  });

  /**
   * The person accepts the notice they were shown, and sharing turns on. A
   * consent to an older notice is withdrawn and replaced in the same breath,
   * so there is only ever one standing consent and it names what they read.
   */
  api.post('/api/location/consent', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const body = GiveConsentInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    if ((await eligible(db, c.get('actor'))) === null) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (body.data.noticeVersion !== STAFF_LOCATION_NOTICE_VERSION) {
      return c.json({ error: 'notice_changed', requestId }, 409);
    }
    await stampReason(db, REASONS.give);
    const standing = await standingConsent(db);
    if (standing && standing.notice_version !== STAFF_LOCATION_NOTICE_VERSION) {
      await db.query('update staff_consent set withdrawn_at = now() where id = $1', [standing.id]);
    }
    if (!standing || standing.notice_version !== STAFF_LOCATION_NOTICE_VERSION) {
      await db.query(
        'insert into staff_consent (tenant_id, user_id, purpose, notice_version, created_by) ' +
          "values (app.current_tenant_id(), app.current_actor_id(), 'location_sharing', $1, " +
          'app.current_actor_id())',
        [STAFF_LOCATION_NOTICE_VERSION],
      );
    }
    await stampReason(db, REASONS.on);
    await db.query(SET_SWITCH_SQL, [true]);
    return c.body(null, 204);
  });

  /**
   * The person withdraws. Sharing stops, and every position of theirs still
   * held is deleted at once rather than left for the job: a withdrawal is a
   * request to stop holding it, not only to stop collecting it.
   */
  api.post('/api/location/consent/withdraw', async (c) => {
    const db = c.get('db');
    // Never refused: withdrawing must be as easy as agreeing, whatever the
    // person's role or practitioner row is now (fix round 1, finding 5).
    await stampReason(db, REASONS.withdraw);
    await db.query(
      'update staff_consent set withdrawn_at = now() ' +
        'where user_id = app.current_actor_id() and tenant_id = app.current_tenant_id() ' +
        "and purpose = 'location_sharing' and withdrawn_at is null",
    );
    await stampReason(db, REASONS.off);
    await db.query(TURN_OFF_SQL);
    await db.query('select app.forget_own_positions()');
    return c.body(null, 204);
  });

  /** The switch. Off always works and stops at once; on needs a standing consent. */
  api.put('/api/location/sharing', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const body = SetSharingInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    if (!body.data.on) {
      // Off is never refused, whoever the person is now (fix round 1, finding 5).
      await stampReason(db, REASONS.off);
      await db.query(TURN_OFF_SQL);
      return c.body(null, 204);
    }
    if ((await eligible(db, c.get('actor'))) === null) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const consent = await standingConsent(db);
    if (consent === null) return c.json({ error: 'no_consent', requestId }, 409);
    if (consent.notice_version !== STAFF_LOCATION_NOTICE_VERSION) {
      return c.json({ error: 'notice_changed', requestId }, 409);
    }
    await stampReason(db, REASONS.on);
    await db.query(SET_SWITCH_SQL, [true]);
    return c.body(null, 204);
  });

  /** One position, written only when consent, the switch and the shift all hold. */
  api.post('/api/location/positions', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const body = PositionInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    const practitionerId = await eligible(db, c.get('actor'));
    if (practitionerId === null) return c.json({ error: 'forbidden', requestId }, 403);
    const at = now();
    const consent = await standingConsent(db);
    const decision = mayWritePosition({
      consentVersion: consent?.notice_version ?? null,
      sharingOn: await sharingOn(db),
      shiftOpen: await ownShiftOpen(db, practitionerId, at),
    });
    if (!decision.ok) {
      return c.json({ error: 'position_refused', code: decision.reason, requestId }, 409);
    }
    // No `returning`: the writer may not read the table back, by design.
    // `recorded_at` is the database's own clock (migration 212): no writer,
    // this route included, chooses when a position was taken.
    await db.query(
      'insert into practitioner_position (tenant_id, practitioner_id, latitude, longitude, ' +
        'accuracy_metres, created_by) values (app.current_tenant_id(), $1, $2, $3, $4, ' +
        'app.current_actor_id())',
      [practitionerId, body.data.latitude, body.data.longitude, body.data.accuracyMetres],
    );
    return c.body(null, 204);
  });

  /** The board's read: the last position of everybody sharing now, recorded today. */
  api.get('/api/location/positions', async (c) => {
    const requestId = c.get('requestId');
    const actor = c.get('actor');
    const at = now();
    if (!canActor(actor, { type: 'appointment.board.read' }, {}, at)) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');
    const [dayStart] = dayRange(practiceDate(at));
    const { rows } = await db.query<{
      id: string;
      practitioner_id: string;
      latitude: number;
      longitude: number;
      accuracy_metres: number;
      recorded_at: Date;
    }>(SHARED_POSITIONS_SQL, [dayStart]);
    // Only somebody whose shift is open now, and only a position sent since
    // it opened: once the shift closes the last position leaves the board
    // rather than staying there, hours old, until midnight (fix round 1,
    // finding 4). The same domain rule the write is judged by.
    const shown: typeof rows = [];
    for (const row of rows) {
      const window = await shiftOf(db, row.practitioner_id, at);
      if (isOpen(window, at) && window !== null && row.recorded_at >= window.opensAt) {
        shown.push(row);
      }
    }
    // Before the answer leaves: whose position was looked at, by id, never where.
    await logReads(
      db,
      'practitioner_position',
      shown.map((row) => ({ id: row.id, clientId: null })),
    );
    return c.json(
      SharedPositionsResponse.parse({
        positions: shown.map((row) => ({
          practitionerId: row.practitioner_id,
          latitude: row.latitude,
          longitude: row.longitude,
          accuracyMetres: row.accuracy_metres,
          recordedAt: row.recorded_at.toISOString(),
          ageMinutes: positionAgeMinutes(row.recorded_at, at),
        })),
      }),
    );
  });
}
