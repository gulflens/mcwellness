import type { Hono } from 'hono';
import { z } from 'zod';
import { PRACTICE_TIME_ZONE, practiceDate } from '@domain/scheduling';
import { ageOn, canActor } from '@domain/shared';
import { logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import {
  APPOINTMENT_SCOPES,
  AppointmentListResponse,
  DayStopListResponse,
  type AppointmentRow,
  type AppointmentScope,
  type DayStop,
  type DeliveryMode,
} from './schema';

/**
 * GET /api/appointments: one tenant-local calendar day of appointments, in
 * one of two scopes.
 *
 * `scope=practice` (the default) is the admin console's day schedule
 * (scheduling-manual.md section 4.1), across every practitioner.
 * `scope=own` is the practitioner's Today (section 5.1): their own stops, and
 * only theirs. The two answer in different shapes, not one shape with holes
 * in it — see `AppointmentRow` and `DayStop` in schema.ts, and the note there
 * on what the own scope deliberately does not carry.
 *
 * **The own scope's effective date range.** A stop appears only while its
 * client is on the caller's schedule, which
 * db/migrations/201_client_visible_to_practitioner.sql defines as 90 Dubai
 * days back to 30 Dubai days ahead of today. The list joins `client`, and a
 * client outside that window is not readable by this caller, so the row never
 * forms: asking for a date beyond the range returns an empty list rather than
 * an error, even though appointments exist on it. That is the same rule the
 * day sheet lives by rather than a fault in the query, but it is silent, so
 * it is stated here and on `DayStopListResponse`.
 *
 * The queries below carry an explicit tenant_id = app.current_tenant_id()
 * predicate (the same defence-in-depth billing/prices.ts uses): row
 * security already enforces this, but a mistaken query here should fail
 * loudly in review and in tests/scheduling/db, not rely on RLS being the
 * only thing standing between one practice's day sheet and another's. The
 * own scope's practitioner_id predicate is the same kind of belt: the
 * scheduling_read_scope policy (db/policies/scheduling/appointment_access.sql)
 * already narrows an ordinary practitioner to their own rows, but an owner or
 * a lead practitioner reads every row in the tenant, so for them this
 * predicate is the only thing making "own" mean own.
 */

const PRACTICE_UTC_OFFSET = '+04:00'; // Asia/Dubai carries no daylight-saving change.

const Query = z.object({
  date: z.iso.date(),
  scope: z.enum(APPOINTMENT_SCOPES).default('practice'),
});

/** What both scopes read, and what neither hands out unchanged. */
type BaseRow = {
  id: string;
  window_start: Date;
  window_end: Date;
  status: AppointmentRow['status'];
  delivery_mode: DeliveryMode;
  client_id: string;
  service_type_id: string;
  service_type_name: string;
  location_id: string;
  location_label: string;
  location_emirate: string;
};

type PracticeRow = BaseRow & {
  client_given_name: string;
  client_family_name: string;
  client_given_name_ar: string | null;
  client_family_name_ar: string | null;
  practitioner_id: string;
  practitioner_display_name: string;
};

type OwnRow = BaseRow & {
  client_mrn: string;
  client_given_name: string;
  client_given_name_ar: string | null;
  // Computed in SQL: the full family name never leaves the database for this
  // scope (schema.ts's note on DayStop).
  client_family_initial: string;
  client_family_initial_ar: string | null;
  client_date_of_birth: string | null;
  entrance_lng: number;
  entrance_lat: number;
  parking_lng: number | null;
  parking_lat: number | null;
};

const BASE_COLUMNS =
  'select a.id, a.window_start, a.window_end, a.status, a.delivery_mode, ' +
  'c.id as client_id, ' +
  'st.id as service_type_id, st.name as service_type_name, ' +
  'l.id as location_id, l.label::text as location_label, l.emirate::text as location_emirate';

const PRACTICE_COLUMNS =
  ', c.given_name as client_given_name, c.family_name as client_family_name, ' +
  'c.given_name_ar as client_given_name_ar, c.family_name_ar as client_family_name_ar, ' +
  'p.id as practitioner_id, u.display_name as practitioner_display_name';

// st_x/st_y against the geography cast to geometry is the same read
// app/api/clients/record.ts makes of a location. left(...) is the family
// initial: one character, in whichever script the name is written.
const OWN_COLUMNS =
  ', c.mrn as client_mrn, c.given_name as client_given_name, ' +
  'c.given_name_ar as client_given_name_ar, ' +
  'left(c.family_name, 1) as client_family_initial, ' +
  'left(c.family_name_ar, 1) as client_family_initial_ar, ' +
  'c.date_of_birth as client_date_of_birth, ' +
  'extensions.st_x(l.entrance_point::extensions.geometry) as entrance_lng, ' +
  'extensions.st_y(l.entrance_point::extensions.geometry) as entrance_lat, ' +
  'extensions.st_x(l.parking_point::extensions.geometry) as parking_lng, ' +
  'extensions.st_y(l.parking_point::extensions.geometry) as parking_lat';

// Every joined table repeats the tenant_id predicate, not only the driving
// appointment row: a join condition alone (c.id = a.client_id) trusts that
// a.client_id can never point outside the tenant, which is exactly the kind
// of assumption row security is the backstop for, not the only line of
// defence (this route's own docstring, and billing/prices.ts's precedent).
const FROM_AND_WHERE =
  ' from appointment a ' +
  'join client c on c.id = a.client_id ' +
  'join practitioner p on p.id = a.practitioner_id ' +
  'join app_user u on u.id = p.user_id ' +
  'join service_type st on st.id = a.service_type_id ' +
  'join location l on l.id = a.location_id ' +
  'where a.tenant_id = app.current_tenant_id() and c.tenant_id = app.current_tenant_id() ' +
  'and p.tenant_id = app.current_tenant_id() and u.tenant_id = app.current_tenant_id() ' +
  'and st.tenant_id = app.current_tenant_id() and l.tenant_id = app.current_tenant_id() ' +
  'and a.window_start >= $1 and a.window_start < $2 ';

const ORDER = 'order by a.window_start';

// What counts as a stop on a day sheet: a visit the practitioner is going to,
// is at, or has been to. Named positively, so a status added to
// appointment_status later appears on nobody's day until somebody puts it
// here on purpose.
//
// What that leaves out, and why. A 'proposed' visit holds the slot but the
// client has not been told about it (scheduling-manual.md section 3) — nobody
// should be driving to a house that is not expecting them. A visit cancelled,
// inside the notice period or outside it, is not happening. A 'rescheduled'
// row has been superseded by the appointment that replaced it. The
// coordinator's practice scope keeps all four: a plan, a cancellation and a
// move are facts the ledger shows.
//
// This list is deliberately a subset of the five statuses
// app.client_visible_to_practitioner (201) grants a practitioner's own client
// on. That is what keeps the `join client` above honest: every row this query
// selects has a readable client behind it, so the join can never quietly
// drop one. Were the two lists to diverge, a stop would vanish from a day
// sheet with nothing said — and only sometimes, since a client with a second
// qualifying visit in the window stays readable regardless. (An erased
// client's stop still disappears through that join, and should: erasure
// outranks a day sheet.)
const OWN_STATUS_FILTER = "and a.status in ('confirmed', 'checked_in', 'completed', 'no_show') ";

const PRACTICE_SQL = BASE_COLUMNS + PRACTICE_COLUMNS + FROM_AND_WHERE + ORDER;
const OWN_SQL =
  BASE_COLUMNS +
  OWN_COLUMNS +
  FROM_AND_WHERE +
  'and a.practitioner_id = $3 ' +
  OWN_STATUS_FILTER +
  ORDER;

/** The caller's own practitioner row, or null when they are not one. */
const PRACTITIONER_SQL =
  'select id from practitioner where user_id = $1 and tenant_id = app.current_tenant_id()';

function dayRange(date: string): [Date, Date] {
  const start = new Date(`${date}T00:00:00${PRACTICE_UTC_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  return [start, end];
}

function point(lng: number | null, lat: number | null): { lat: number; lng: number } | null {
  return lng === null || lat === null ? null : { lat, lng };
}

function toPracticeRow(r: PracticeRow): AppointmentRow {
  return {
    id: r.id,
    windowStart: r.window_start.toISOString(),
    windowEnd: r.window_end.toISOString(),
    status: r.status,
    deliveryMode: r.delivery_mode,
    client: {
      id: r.client_id,
      givenName: r.client_given_name,
      familyName: r.client_family_name,
      givenNameAr: r.client_given_name_ar,
      familyNameAr: r.client_family_name_ar,
    },
    practitioner: { id: r.practitioner_id, displayName: r.practitioner_display_name },
    serviceType: { id: r.service_type_id, name: r.service_type_name },
    location: { id: r.location_id, label: r.location_label, emirate: r.location_emirate },
  };
}

function toDayStop(r: OwnRow, today: string): DayStop {
  return {
    id: r.id,
    // An opaque row id, and the handle the stop card asks billing for this
    // household's balance with (schema.ts's note on DayStop). The record
    // number stays out of every address.
    clientId: r.client_id,
    windowStart: r.window_start.toISOString(),
    windowEnd: r.window_end.toISOString(),
    status: r.status,
    deliveryMode: r.delivery_mode,
    client: {
      mrn: r.client_mrn,
      givenName: r.client_given_name,
      givenNameAr: r.client_given_name_ar,
      familyInitial: r.client_family_initial,
      familyInitialAr: r.client_family_initial_ar,
      age: r.client_date_of_birth === null ? null : ageOn(r.client_date_of_birth, today),
    },
    serviceType: { id: r.service_type_id, name: r.service_type_name },
    location: {
      id: r.location_id,
      label: r.location_label,
      emirate: r.location_emirate,
      // entrance_point is `not null` in the schema (030_location.sql), so this
      // pair is always a real coordinate. parking_point is not, and st_x of a
      // null geography is null, which is what `point` folds back into one null.
      entrancePoint: { lat: r.entrance_lat, lng: r.entrance_lng },
      parkingPoint: point(r.parking_lng, r.parking_lat),
    },
  };
}

/** The rows, and the client ids the audit trail needs but the wire does not. */
type OwnDay = { stops: DayStop[]; clientIds: (string | null)[] };

async function ownDay(
  db: Db,
  userId: string,
  dayStart: Date,
  dayEnd: Date,
  today: string,
): Promise<OwnDay> {
  const practitioner = await db.query<{ id: string }>(PRACTITIONER_SQL, [userId]);
  const practitionerId = practitioner.rows[0]?.id;
  // An owner or a lead practitioner may ask for their own day without being a
  // practitioner at all (canActor admits the role, section 2 gives them the
  // calendar). They have no stops of their own, and an empty day is the honest
  // answer rather than a refusal.
  if (practitionerId === undefined) {
    return { stops: [], clientIds: [] };
  }
  const { rows } = await db.query<OwnRow>(OWN_SQL, [dayStart, dayEnd, practitionerId]);
  return {
    stops: rows.map((r) => toDayStop(r, today)),
    clientIds: rows.map((r) => r.client_id),
  };
}

export function mountAppointmentList(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/appointments', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const query = Query.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const scope: AppointmentScope = query.data.scope;
    if (
      !canActor(actor, { type: 'appointment.list', scope }, { timeZone: PRACTICE_TIME_ZONE }, now())
    ) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const [dayStart, dayEnd] = dayRange(query.data.date);
    const db = c.get('db');

    if (scope === 'own') {
      const day = await ownDay(db, actor.userId, dayStart, dayEnd, practiceDate(now()));
      // The client id is resolved for the trail and dropped from the answer:
      // every read of a client's row is attributed to that client
      // (docs/SPEC/audit.md section 5), whether or not the id crosses the wire.
      await logReads(
        db,
        'appointment',
        day.stops.map((stop, index) => ({ id: stop.id, clientId: day.clientIds[index] ?? null })),
        'list',
      );
      return c.json(DayStopListResponse.parse({ appointments: day.stops }));
    }

    const { rows } = await db.query<PracticeRow>(PRACTICE_SQL, [dayStart, dayEnd]);
    const appointments = rows.map(toPracticeRow);
    await logReads(
      db,
      'appointment',
      appointments.map((a) => ({ id: a.id, clientId: a.client.id })),
      'list',
    );
    return c.json(AppointmentListResponse.parse({ appointments }));
  });
}
