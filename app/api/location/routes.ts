import type { Hono } from 'hono';
import { canActor, hasRole } from '@domain/shared';
import {
  STAFF_LOCATION_NOTICE_VERSION,
  firstNameOf,
  helperShiftWindow,
  mayWritePosition,
  positionAgeMinutes,
  practiceDate,
  shiftWindow,
  type AppointmentStatus,
  type DayBounds,
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
 *
 * **A helper** (round 76, section 15.12) uses the same five routes for
 * themselves, and nothing else in this API: their consent and switch are
 * their own rows as anybody's are; their positions carry their own `user_id`
 * rather than a practitioner's; and their shift is the shift of the
 * practitioner they accompany, read through `app.accompanied_day` (migration
 * 213) — times and states, never a household — and judged by the same rule
 * (`helperShiftWindow`). The board's read places a helper's last position
 * beside that practitioner, marked as a helper's, by first name.
 */

/**
 * Who may share: somebody with a day of visits, which is a practitioner's or a
 * lead's — or a helper, who shares the day of the practitioner they accompany.
 */
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
  'select pp.id, pp.practitioner_id, pp.user_id, pp.latitude, pp.longitude, ' +
  'pp.accuracy_metres, pp.recorded_at, a.practitioner_id as accompanies, ' +
  'u.display_name as helper_name ' +
  'from practitioner_position pp ' +
  // A helper's row names the helper; whom they go with is the standing
  // accompaniment, and their name is the board's to read already.
  'left join helper_accompaniment a on a.helper_user_id = pp.user_id ' +
  'and a.tenant_id = pp.tenant_id and a.ended_at is null ' +
  'left join app_user u on u.id = pp.user_id and u.tenant_id = pp.tenant_id ' +
  'where pp.tenant_id = app.current_tenant_id() and pp.recorded_at >= $1 ' +
  'order by pp.practitioner_id, pp.user_id';

/** The practitioner this helper accompanies now, or nobody (migration 213). */
const ACCOMPANIES_SQL = 'select app.helper_accompanies(app.current_actor_id()) as id';

/** The accompanied practitioner's day, as times and states only (migration 213). */
const ACCOMPANIED_DAY_SQL =
  'select window_start, window_end, status, duration_minutes, closed_at ' +
  'from app.accompanied_day($1, $2)';

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

type DayRow = {
  window_start: Date;
  window_end: Date;
  status: string;
  duration_minutes: number;
  closed_at: Date | null;
};

function toStops(rows: readonly DayRow[]): ShiftStop[] {
  return rows.map((row) => ({
    windowStart: row.window_start,
    windowEnd: row.window_end,
    durationMinutes: row.duration_minutes,
    status: row.status as AppointmentStatus,
    closedAt: row.closed_at,
  }));
}

/** A practitioner's day as the reader's own row security lets them read it. */
async function dayOf(
  db: Db,
  practitionerId: string,
  now: Date,
): Promise<{ stops: ShiftStop[]; bounds: DayBounds }> {
  const [start, end] = dayRange(practiceDate(now));
  const { rows } = await db.query<DayRow>(OWN_DAY_SQL, [practitionerId, start, end]);
  return { stops: toStops(rows), bounds: { start, end } };
}

async function shiftOf(db: Db, practitionerId: string, now: Date): Promise<ShiftWindow | null> {
  const { stops, bounds } = await dayOf(db, practitionerId, now);
  return shiftWindow(stops, bounds);
}

/**
 * A helper's shift, asked by the helper: the accompanied practitioner's day,
 * read through the one door a helper has to it, fed to the same rule.
 */
async function ownHelperShift(db: Db, accompanies: string, now: Date): Promise<ShiftWindow | null> {
  const [start, end] = dayRange(practiceDate(now));
  const { rows } = await db.query<DayRow>(ACCOMPANIED_DAY_SQL, [start, end]);
  return helperShiftWindow({ practitionerId: accompanies }, toStops(rows), { start, end });
}

function isOpen(window: ShiftWindow | null, now: Date): boolean {
  return (
    window !== null &&
    now.getTime() >= window.opensAt.getTime() &&
    now.getTime() < window.closesAt.getTime()
  );
}

/**
 * Who is sharing, and whose day their shift is read from: their own, as a
 * practitioner or a lead with a working row; or, as a helper, the day of the
 * practitioner they accompany now.
 */
type Sharer =
  { kind: 'practitioner'; practitionerId: string } | { kind: 'helper'; accompanies: string };

async function sharerShiftOpen(db: Db, sharer: Sharer, now: Date): Promise<boolean> {
  const window =
    sharer.kind === 'practitioner'
      ? await shiftOf(db, sharer.practitionerId, now)
      : await ownHelperShift(db, sharer.accompanies, now);
  return isOpen(window, now);
}

async function accompanied(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ id: string | null }>(ACCOMPANIES_SQL);
  return rows[0]?.id ?? null;
}

/**
 * A person who may share: a practitioner or a lead with a working row, or a
 * helper who accompanies somebody now. A person holding a working role is
 * judged as that role: a helper holds no other role (migration 213).
 */
async function eligible(db: Db, actor: ApiEnv['Variables']['actor']): Promise<Sharer | null> {
  if (hasRole(actor, 'practitioner', 'lead_practitioner')) {
    const practitionerId = await ownPractitioner(db);
    return practitionerId === null ? null : { kind: 'practitioner', practitionerId };
  }
  if (hasRole(actor, 'helper')) {
    const accompanies = await accompanied(db);
    return accompanies === null ? null : { kind: 'helper', accompanies };
  }
  return null;
}

/** For a helper's own page: the first name of whom they accompany, or null. */
async function accompaniesName(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ name: string | null }>('select app.accompanied_name() as name');
  const name = rows[0]?.name ?? null;
  return name === null ? null : firstNameOf(name);
}

export function mountLocation(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/location/me', async (c) => {
    const db = c.get('db');
    const actor = c.get('actor');
    const sharer = await eligible(db, actor);
    const consent = await standingConsent(db);
    // A helper is told whom they go with, by first name; nobody else is told
    // anything new, and their answer is as it was.
    const helperOnly =
      hasRole(actor, 'helper') && !hasRole(actor, 'practitioner', 'lead_practitioner');
    const accompanies = helperOnly ? { accompanies: await accompaniesName(db) } : {};
    if (sharer === null) {
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
          ...accompanies,
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
        shiftOpen: await sharerShiftOpen(db, sharer, now()),
        ...accompanies,
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
    const sharer = await eligible(db, c.get('actor'));
    if (sharer === null) return c.json({ error: 'forbidden', requestId }, 403);
    const at = now();
    const consent = await standingConsent(db);
    const decision = mayWritePosition({
      consentVersion: consent?.notice_version ?? null,
      sharingOn: await sharingOn(db),
      shiftOpen: await sharerShiftOpen(db, sharer, at),
    });
    if (!decision.ok) {
      return c.json({ error: 'position_refused', code: decision.reason, requestId }, 409);
    }
    // No `returning`: the writer may not read the table back, by design.
    // `recorded_at` is the database's own clock (migration 212): no writer,
    // this route included, chooses when a position was taken.
    const fix = [body.data.latitude, body.data.longitude, body.data.accuracyMetres];
    if (sharer.kind === 'practitioner') {
      await db.query(
        'insert into practitioner_position (tenant_id, practitioner_id, latitude, longitude, ' +
          'accuracy_metres, created_by) values (app.current_tenant_id(), $1, $2, $3, $4, ' +
          'app.current_actor_id())',
        [sharer.practitionerId, ...fix],
      );
    } else {
      // A helper's own row: the person is the caller, never anybody named.
      await db.query(
        'insert into practitioner_position (tenant_id, user_id, latitude, longitude, ' +
          'accuracy_metres, created_by) values (app.current_tenant_id(), ' +
          'app.current_actor_id(), $1, $2, $3, app.current_actor_id())',
        fix,
      );
    }
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
      practitioner_id: string | null;
      user_id: string | null;
      latitude: number;
      longitude: number;
      accuracy_metres: number;
      recorded_at: Date;
      accompanies: string | null;
      helper_name: string | null;
    }>(SHARED_POSITIONS_SQL, [dayStart]);
    // Only somebody whose shift is open now, and only a position sent since
    // it opened: once the shift closes the last position leaves the board
    // rather than staying there, hours old, until midnight (fix round 1,
    // finding 4). The same domain rule the write is judged by. A helper's
    // shift is the practitioner's they accompany (section 15.12); a helper
    // who accompanies nobody now has none.
    const shown: typeof rows = [];
    for (const row of rows) {
      let window: ShiftWindow | null;
      if (row.practitioner_id !== null) {
        window = await shiftOf(db, row.practitioner_id, at);
      } else if (row.accompanies !== null) {
        const { stops, bounds } = await dayOf(db, row.accompanies, at);
        window = helperShiftWindow({ practitionerId: row.accompanies }, stops, bounds);
      } else {
        window = null;
      }
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
    const fix = (row: (typeof rows)[number]) => ({
      latitude: row.latitude,
      longitude: row.longitude,
      accuracyMetres: row.accuracy_metres,
      recordedAt: row.recorded_at.toISOString(),
      ageMinutes: positionAgeMinutes(row.recorded_at, at),
    });
    return c.json(
      SharedPositionsResponse.parse({
        positions: shown
          .filter((row) => row.practitioner_id !== null)
          .map((row) => ({ practitionerId: row.practitioner_id, ...fix(row) })),
        helpers: shown
          .filter((row) => row.practitioner_id === null)
          .map((row) => ({
            accompaniesPractitionerId: row.accompanies,
            firstName: firstNameOf(row.helper_name ?? ''),
            ...fix(row),
          })),
      }),
    );
  });
}
