import type { Hono } from 'hono';
import { canActor } from '@domain/shared';
import { hourBucket, type DriveEstimate } from '../../../domain/shared/routing';
import { dayLegs, type DayLeg, type HomeBase, type LegStop } from '../../../domain/scheduling/legs';
import { navigationTarget } from '../../../domain/scheduling/navigation';
import {
  MAX_PLAN_STOPS,
  optimiseDay,
  type PlanBase,
  type PlanStop,
} from '../../../domain/scheduling/optimise';
import type { AppointmentStatus } from '../../../domain/scheduling/status';
import { PRACTICE_TIME_ZONE } from '../_middleware/routing';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { point, toLegStop, type StopRow } from './day';
import { dayRange, estimateLegs, fillMatrix, readFactors, type Place } from './estimates';
import {
  OptimiseDayRequest,
  OptimiseDayResponse,
  PracticeDayResponse,
  type DayLegRow,
} from './schema';

/**
 * `GET /api/routing/practice-day?date=` — every practitioner's stops that day,
 * where their day starts, and the drives between, for the console's day map.
 * `POST /api/routing/practice-day/optimise` — the order of one practitioner's
 * day that drives least (docs/SPEC/route-planning.md sections 5 and 6).
 *
 * **Both are about the road, not about anybody.** The answer carries opaque
 * ids, coordinates and times; the names on the map's own panel come from
 * `GET /api/appointments`, which is where the audit trail already records
 * that the day was read. Nothing here reads a client row, so nothing here
 * writes an audit row — the reasoning `day.ts` records for the same reads.
 *
 * **The plan is computed, never applied.** Applying it is
 * `POST /api/appointments/reorder`, which goes through the move rule
 * visit by visit and asks for a reason.
 */

/**
 * Every practitioner's stops for one day, in practitioner and then window
 * order. The Schedule table's own status list, so the map draws the day the
 * schedule already shows. Every joined table repeats the tenant predicate, as
 * every other route does and for the same reason.
 */
const STOPS_SQL =
  'select a.id, a.window_start, a.window_end, a.status::text as status, ' +
  'a.travel_buffer_minutes, a.practitioner_id, st.duration_minutes, l.id as location_id, ' +
  'extensions.st_x(l.entrance_point::extensions.geometry) as entrance_lng, ' +
  'extensions.st_y(l.entrance_point::extensions.geometry) as entrance_lat, ' +
  'extensions.st_x(l.parking_point::extensions.geometry) as parking_lng, ' +
  'extensions.st_y(l.parking_point::extensions.geometry) as parking_lat ' +
  'from appointment a ' +
  'join service_type st on st.id = a.service_type_id ' +
  'join location l on l.id = a.location_id ' +
  'where a.tenant_id = app.current_tenant_id() and st.tenant_id = app.current_tenant_id() ' +
  'and l.tenant_id = app.current_tenant_id() ' +
  'and a.window_start >= $1 and a.window_start < $2 ' +
  "and a.status in ('proposed', 'confirmed', 'checked_in', 'completed', 'no_show') " +
  'order by a.practitioner_id, a.window_start, a.id';

/** Where each practitioner's day starts, for the ones the practice records a base for. */
const BASES_SQL =
  'select p.id as practitioner_id, l.id as location_id, ' +
  'extensions.st_x(l.entrance_point::extensions.geometry) as entrance_lng, ' +
  'extensions.st_y(l.entrance_point::extensions.geometry) as entrance_lat, ' +
  'extensions.st_x(l.parking_point::extensions.geometry) as parking_lng, ' +
  'extensions.st_y(l.parking_point::extensions.geometry) as parking_lat ' +
  'from practitioner p join location l on l.id = p.home_base_location_id ' +
  'where p.tenant_id = app.current_tenant_id() and l.tenant_id = app.current_tenant_id()';

type PracticeStopRow = StopRow & {
  status: string;
  travel_buffer_minutes: number;
  practitioner_id: string;
};

type BaseRow = {
  practitioner_id: string;
  location_id: string;
  entrance_lng: number;
  entrance_lat: number;
  parking_lng: number | null;
  parking_lat: number | null;
};

/** How far past the day's last departure the estimates are gathered for, and the ceiling on that. */
const BUCKETS_AFTER_LAST_DEPARTURE = 2;
const MAX_BUCKETS = 12;
const MINUTE_MS = 60_000;

function toHomeBase(row: BaseRow): HomeBase {
  return {
    id: row.location_id,
    entrancePoint: { lat: row.entrance_lat, lng: row.entrance_lng },
    parkingPoint: point(row.parking_lng, row.parking_lat),
  };
}

function toLegRow(leg: DayLeg, estimate: DriveEstimate | undefined): DayLegRow | null {
  if (!estimate) return null;
  return {
    toStopId: leg.toStopId,
    fromLocationId: leg.fromLocationId,
    toLocationId: leg.toLocationId,
    departAt: leg.departAt.toISOString(),
    seconds: estimate.seconds,
    metres: estimate.metres,
    source: estimate.source,
  };
}

/** The rows of one day, grouped by the practitioner whose day they are. */
function byPractitioner(rows: readonly PracticeStopRow[]): Map<string, PracticeStopRow[]> {
  const days = new Map<string, PracticeStopRow[]>();
  for (const row of rows) {
    const day = days.get(row.practitioner_id);
    if (day) day.push(row);
    else days.set(row.practitioner_id, [row]);
  }
  return days;
}

async function readDay(db: Db, date: string): Promise<PracticeStopRow[]> {
  const [dayStart, dayEnd] = dayRange(date);
  const { rows } = await db.query<PracticeStopRow>(STOPS_SQL, [dayStart, dayEnd]);
  return rows;
}

async function readBases(db: Db): Promise<Map<string, BaseRow>> {
  const { rows } = await db.query<BaseRow>(BASES_SQL);
  return new Map(rows.map((row) => [row.practitioner_id, row]));
}

function toPlanStop(row: PracticeStopRow): PlanStop {
  return {
    id: row.id,
    status: row.status as AppointmentStatus,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    durationMinutes: row.duration_minutes,
    travelBufferMinutes: row.travel_buffer_minutes,
    locationId: row.location_id,
    point: navigationTarget(toLegStop(row).location),
  };
}

/**
 * The hours the day's drives are priced for: from the hour the first window
 * opens to two past the hour of the last departure as the day stands, capped
 * at twelve. Wider than the day itself, because a reordered day departs later
 * from somewhere than it does today.
 */
function bucketsFor(stops: readonly PlanStop[]): number[] {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) return [];
  const from = hourBucket(first.windowStart, PRACTICE_TIME_ZONE);
  const lastDeparture = new Date(last.windowStart.getTime() + last.durationMinutes * MINUTE_MS);
  const to = hourBucket(lastDeparture, PRACTICE_TIME_ZONE) + BUCKETS_AFTER_LAST_DEPARTURE;
  const span = Math.min(MAX_BUCKETS, Math.max(1, to - from + 1));
  const hours = new Set<number>();
  for (let i = 0; i < span; i += 1) hours.add(Math.min(23, from + i));
  return [...hours];
}

/** The distinct places a day touches: every stop's navigation target, and the base. */
function placesFor(stops: readonly PlanStop[], base: PlanBase | null): Place[] {
  const places = new Map<string, Place>();
  for (const stop of stops)
    places.set(stop.locationId, { locationId: stop.locationId, point: stop.point });
  if (base !== null) places.set(base.locationId, base);
  return [...places.values()];
}

export function mountPracticeDay(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/routing/practice-day', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const date = c.req.query('date');
    if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    if (!canActor(actor, { type: 'routing.practiceDay.read' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const routing = c.get('routing');
    if (!routing) {
      // A deployment with no seam configured is refused cleanly rather than
      // assumed away, exactly as a missing document store is.
      return c.json({ error: 'routing_unavailable', requestId }, 503);
    }
    const db = c.get('db');
    const rows = await readDay(db, date);
    const bases = await readBases(db);
    const factors = await readFactors(db);

    const practitioners = [];
    for (const [practitionerId, day] of byPractitioner(rows)) {
      const baseRow = bases.get(practitionerId);
      const homeBase = baseRow === undefined ? null : toHomeBase(baseRow);
      const stops: LegStop[] = day.map((row) => toLegStop(row));
      const legs = dayLegs(stops, homeBase);
      const answers = await estimateLegs(db, legs, factors, routing, actor.userId);
      practitioners.push({
        practitionerId,
        homeBase:
          homeBase === null ? null : { locationId: homeBase.id, point: navigationTarget(homeBase) },
        stops: day.map((row) => ({
          appointmentId: row.id,
          locationId: row.location_id,
          point: navigationTarget(toLegStop(row).location),
          windowStart: row.window_start.toISOString(),
          windowEnd: row.window_end.toISOString(),
          status: row.status,
        })),
        legs: legs
          .map((leg) => toLegRow(leg, answers.get(leg.toStopId)))
          .filter((row): row is DayLegRow => row !== null),
      });
    }
    return c.json(PracticeDayResponse.parse({ practitioners }));
  });

  api.post('/api/routing/practice-day/optimise', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'routing.practiceDay.read' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const parsed = OptimiseDayRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const routing = c.get('routing');
    if (!routing) {
      return c.json({ error: 'routing_unavailable', requestId }, 503);
    }
    const { date, practitionerId } = parsed.data;
    const db = c.get('db');
    const rows = (await readDay(db, date)).filter((row) => row.practitioner_id === practitionerId);
    if (rows.length === 0) {
      return c.json(OptimiseDayResponse.parse({ kind: 'refusal', reason: 'nothing_to_move' }));
    }
    const stops = rows.map(toPlanStop);
    if (stops.length > MAX_PLAN_STOPS) {
      // Said here as well as in the rule, so the grid behind it is never paid
      // for on a day the rule will refuse anyway.
      return c.json(OptimiseDayResponse.parse({ kind: 'refusal', reason: 'too_many_stops' }));
    }
    const baseRow = (await readBases(db)).get(practitionerId);
    const base = baseRow === undefined ? null : toHomeBase(baseRow);
    const homeBase: PlanBase | null =
      base === null ? null : { locationId: base.id, point: navigationTarget(base) };

    const factors = await readFactors(db);
    const matrix = await fillMatrix(
      db,
      placesFor(stops, homeBase),
      bucketsFor(stops),
      date,
      factors,
      routing,
      actor.userId,
    );
    const plan = optimiseDay({ stops, homeBase, now: now() }, matrix);
    if (plan.kind === 'refusal') {
      return c.json(OptimiseDayResponse.parse(plan));
    }
    // Each planned row carries the window it was computed against, so the
    // reorder can refuse a plan the day has moved out from under.
    const wasWindowStart = new Map(stops.map((stop) => [stop.id, stop.windowStart.toISOString()]));
    return c.json(
      OptimiseDayResponse.parse({
        kind: 'plan',
        stops: plan.stops.map((stop) => ({
          appointmentId: stop.id,
          windowStart: stop.windowStart.toISOString(),
          windowEnd: stop.windowEnd.toISOString(),
          wasWindowStart: wasWindowStart.get(stop.id) ?? stop.windowStart.toISOString(),
          travelBufferMinutes: stop.travelBufferMinutes,
          moved: stop.moved,
          anchor: stop.anchor,
        })),
        before: {
          driveSeconds: plan.before.driveSeconds,
          driveMetres: plan.before.driveMetres,
          dayEnd: plan.before.dayEnd.toISOString(),
        },
        after: {
          driveSeconds: plan.after.driveSeconds,
          driveMetres: plan.after.driveMetres,
          dayEnd: plan.after.dayEnd.toISOString(),
        },
        savedSeconds: plan.savedSeconds,
        source: plan.source,
      }),
    );
  });
}
