import type { Hono } from 'hono';
import { z } from 'zod';
import { PRACTICE_TIME_ZONE, practiceDate } from '@domain/scheduling';
import { ageOn, canActor } from '@domain/shared';
import { logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import {
  APPOINTMENT_SCOPES,
  AppointmentListResponse,
  type AppointmentRow,
  type AppointmentScope,
  type DeliveryMode,
} from './schema';

/**
 * GET /api/appointments: one tenant-local calendar day of appointments, in
 * one of two scopes.
 *
 * `scope=practice` (the default) is the admin console's day schedule
 * (scheduling-manual.md section 4.1), across every practitioner. `scope=own`
 * is the practitioner's Today (section 5.1): their own stops, and only
 * theirs. The two differ in more than a filter — the own scope also carries
 * the record number, the client's age and the location's coordinates, which
 * the practice scope must never carry (see the note on `AppointmentRow` in
 * schema.ts, and section 11's limit on what the coordinator's screen shows).
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

type Row = {
  id: string;
  window_start: Date;
  window_end: Date;
  status: AppointmentRow['status'];
  delivery_mode: DeliveryMode;
  client_id: string;
  client_given_name: string;
  client_family_name: string;
  client_given_name_ar: string | null;
  client_family_name_ar: string | null;
  practitioner_id: string;
  practitioner_display_name: string;
  service_type_id: string;
  service_type_name: string;
  location_id: string;
  location_label: string;
  location_emirate: string;
};

/** The own scope's extra columns; absent from a practice-scope row entirely. */
type OwnRow = Row & {
  client_mrn: string;
  client_date_of_birth: string | null;
  entrance_lng: number;
  entrance_lat: number;
  parking_lng: number | null;
  parking_lat: number | null;
};

const COLUMNS =
  'select a.id, a.window_start, a.window_end, a.status, a.delivery_mode, ' +
  'c.id as client_id, c.given_name as client_given_name, c.family_name as client_family_name, ' +
  'c.given_name_ar as client_given_name_ar, c.family_name_ar as client_family_name_ar, ' +
  'p.id as practitioner_id, u.display_name as practitioner_display_name, ' +
  'st.id as service_type_id, st.name as service_type_name, ' +
  'l.id as location_id, l.label::text as location_label, l.emirate::text as location_emirate';

// Only the own scope selects these. st_x/st_y against the geography cast to
// geometry is the same read app/api/clients/record.ts makes of a location.
const OWN_COLUMNS =
  ', c.mrn as client_mrn, c.date_of_birth as client_date_of_birth, ' +
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

// A cancelled visit is not a stop: nobody drives to it, and the day sheet is
// the list of doors still to knock on plus the ones already knocked on. The
// coordinator's own screen keeps them — a cancellation is a fact the ledger
// shows — which is why only the own scope carries this predicate.
//
// It also keeps the join above honest. app.client_visible_to_practitioner
// (201) opens a client's record to a practitioner for every appointment
// except a cancellation, so without this the `join client` would drop exactly
// these rows anyway, silently and only sometimes — a client with a second,
// live visit inside the window would still be visible, and the same cancelled
// stop would then appear. Filtering here makes it one deliberate rule rather
// than an emergent property of two. (An erased client's stop still disappears
// through that join, and should: erasure outranks a day sheet.)
const OWN_STATUS_FILTER = "and a.status not in ('cancelled', 'cancelled_late') ";

const PRACTICE_SQL = COLUMNS + FROM_AND_WHERE + ORDER;
const OWN_SQL =
  COLUMNS +
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

function toRow(r: Row): AppointmentRow {
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

/** The same row plus what a practitioner standing at the door needs. */
function toOwnRow(r: OwnRow, today: string): AppointmentRow {
  const base = toRow(r);
  return {
    ...base,
    client: {
      ...base.client,
      mrn: r.client_mrn,
      age: r.client_date_of_birth === null ? null : ageOn(r.client_date_of_birth, today),
    },
    location: {
      ...base.location,
      // entrance_point is `not null` in the schema (030_location.sql), so this
      // pair is always a real coordinate. parking_point is not, and st_x of a
      // null geography is null, which is what `point` folds back into one null.
      entrancePoint: { lat: r.entrance_lat, lng: r.entrance_lng },
      parkingPoint: point(r.parking_lng, r.parking_lat),
    },
  };
}

async function ownAppointments(
  db: Db,
  userId: string,
  dayStart: Date,
  dayEnd: Date,
  today: string,
): Promise<AppointmentRow[]> {
  const practitioner = await db.query<{ id: string }>(PRACTITIONER_SQL, [userId]);
  const practitionerId = practitioner.rows[0]?.id;
  // An owner or a lead practitioner may ask for their own day without being a
  // practitioner at all (canActor admits the role, section 2 gives them the
  // calendar). They have no stops of their own, and an empty day is the honest
  // answer rather than a refusal.
  if (practitionerId === undefined) {
    return [];
  }
  const { rows } = await db.query<OwnRow>(OWN_SQL, [dayStart, dayEnd, practitionerId]);
  return rows.map((r) => toOwnRow(r, today));
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
    const appointments =
      scope === 'own'
        ? await ownAppointments(db, actor.userId, dayStart, dayEnd, practiceDate(now()))
        : (await db.query<Row>(PRACTICE_SQL, [dayStart, dayEnd])).rows.map(toRow);
    await logReads(
      db,
      'appointment',
      appointments.map((a) => ({ id: a.id, clientId: a.client.id })),
      'list',
    );
    return c.json(AppointmentListResponse.parse({ appointments }));
  });
}
