import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '@domain/shared';
import { dayFingerprint, type DriveEstimate, type GeoPoint } from '../../../domain/shared/routing';
// By its own path, as the storage seam's own helpers are imported: this is the
// one file of domain/scheduling piece eight owns, and the scheduling barrel is
// not this piece's to add to (docs/SPEC/OWNERSHIP.md).
import {
  dayLegs,
  dayPoints,
  type DayLeg,
  type HomeBase,
  type LegStop,
} from '../../../domain/scheduling/legs';
import { isRoutingUnavailable } from '../_middleware/routing';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { dayRange, estimateLegs, readFactors } from './estimates';
import { pictureKey, readPicture, writePicture } from './picture-cache';
import { mountPracticeDay } from './practice-day';
import { RoutingDayResponse, type DayLegRow } from './schema';

/**
 * `GET /api/routing/day?date=` — the drives between a practitioner's own stops,
 * and where to fetch a picture of them.
 * `GET /api/routing/day-picture?date=&v=` — that picture, as a PNG.
 *
 * Both are the day sheet's, and both answer about the caller's own day and
 * nobody else's (docs/SPEC/practitioner-phone.md section 5).
 *
 * **What this route sends to a vendor is coordinates and a departure time.**
 * The stops are read here, the legs are built by `domain/scheduling/legs.ts`,
 * and what crosses the seam is two `GeoPoint`s and a `Date` per leg. No name,
 * no record number, no address, no Makani number, no id — and the audit trail
 * gets no coordinate either, because nothing here writes one.
 *
 * **One call per hour, never one call for the day.** A compute-route-matrix
 * request carries a single departure time, so the missing legs are gathered
 * into their hour buckets and each bucket is asked for on its own — otherwise
 * an afternoon drive is priced with the morning's traffic and then cached
 * under its own hour, which is a wrong figure kept for thirty days.
 *
 * **The cache is the reason this is affordable.** A leg's estimate is written
 * to `drive_estimate` keyed by the two locations and the hour of the practice's
 * own day, and read back for thirty days: a day of six stops is at most six
 * calls the first time it is opened and none after. A stop moved to another
 * hour is one more.
 *
 * **The picture is not a table.** It shows several households' positions and
 * has no single client to file it under, so it lives in this process until the
 * practice's day ends and on the device in the worker's cache (./picture-cache.ts).
 *
 * **Nothing personal is logged.** No read of a client's row happens here — the
 * appointment rows are read for their windows and their locations — so there is
 * no audit row to write, which is the same reasoning
 * `app/api/appointments/settings.ts` records for the practice's own settings.
 */

const Query = z.object({ date: z.iso.date() });
const PictureQuery = z.object({ date: z.iso.date(), v: z.string().min(1).max(64) });

export type StopRow = {
  id: string;
  window_start: Date;
  window_end: Date;
  duration_minutes: number;
  location_id: string;
  entrance_lng: number;
  entrance_lat: number;
  parking_lng: number | null;
  parking_lat: number | null;
};

type BaseRow = {
  location_id: string;
  entrance_lng: number;
  entrance_lat: number;
  parking_lng: number | null;
  parking_lat: number | null;
};

/**
 * The caller's own stops for one day, in window order — the same rows and the
 * same status list `app/api/appointments/list.ts` puts on the day sheet, so an
 * estimate can never appear above a card that is not there or be missing above
 * one that is. Every joined table repeats the tenant predicate, as that route
 * does and for the same reason.
 */
const STOPS_SQL =
  'select a.id, a.window_start, a.window_end, st.duration_minutes, l.id as location_id, ' +
  'extensions.st_x(l.entrance_point::extensions.geometry) as entrance_lng, ' +
  'extensions.st_y(l.entrance_point::extensions.geometry) as entrance_lat, ' +
  'extensions.st_x(l.parking_point::extensions.geometry) as parking_lng, ' +
  'extensions.st_y(l.parking_point::extensions.geometry) as parking_lat ' +
  'from appointment a ' +
  'join service_type st on st.id = a.service_type_id ' +
  'join location l on l.id = a.location_id ' +
  'where a.tenant_id = app.current_tenant_id() and st.tenant_id = app.current_tenant_id() ' +
  'and l.tenant_id = app.current_tenant_id() ' +
  'and a.practitioner_id = $3 ' +
  'and a.window_start >= $1 and a.window_start < $2 ' +
  "and a.status in ('confirmed', 'checked_in', 'completed', 'no_show') " +
  'order by a.window_start, a.id';

/** Where the caller's day starts, when the practice records one. */
const HOME_BASE_SQL =
  'select l.id as location_id, ' +
  'extensions.st_x(l.entrance_point::extensions.geometry) as entrance_lng, ' +
  'extensions.st_y(l.entrance_point::extensions.geometry) as entrance_lat, ' +
  'extensions.st_x(l.parking_point::extensions.geometry) as parking_lng, ' +
  'extensions.st_y(l.parking_point::extensions.geometry) as parking_lat ' +
  'from practitioner p join location l on l.id = p.home_base_location_id ' +
  'where p.id = $1 and p.tenant_id = app.current_tenant_id() ' +
  'and l.tenant_id = app.current_tenant_id()';

const PRACTITIONER_SQL =
  'select id from practitioner where user_id = $1 and tenant_id = app.current_tenant_id()';

export function point(lng: number | null, lat: number | null): GeoPoint | null {
  return lng === null || lat === null ? null : { lat, lng };
}

/** The instant the practice's day ends, which is when a picture of it stops being useful. */
function endOfDay(date: string): Date {
  return dayRange(date)[1];
}

export function toLegStop(row: StopRow): LegStop {
  return {
    id: row.id,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    durationMinutes: row.duration_minutes,
    location: {
      id: row.location_id,
      // entrance_point is `not null` in the schema (030_location.sql).
      entrancePoint: { lat: row.entrance_lat, lng: row.entrance_lng },
      parkingPoint: point(row.parking_lng, row.parking_lat),
    },
  };
}

/** The caller's own day, resolved once: their practitioner row, stops and home base. */
async function readDay(
  db: Db,
  userId: string,
  date: string,
): Promise<{ practitionerId: string; stops: LegStop[]; homeBase: HomeBase | null } | null> {
  const practitioner = await db.query<{ id: string }>(PRACTITIONER_SQL, [userId]);
  const practitionerId = practitioner.rows[0]?.id;
  // An owner or a lead practitioner may ask for their own day without being a
  // practitioner at all. They have no stops, and an empty day is the honest
  // answer rather than a refusal — exactly as the day sheet answers.
  if (practitionerId === undefined) return null;

  const [dayStart, dayEnd] = dayRange(date);
  const stops = await db.query<StopRow>(STOPS_SQL, [dayStart, dayEnd, practitionerId]);
  const base = await db.query<BaseRow>(HOME_BASE_SQL, [practitionerId]);
  const baseRow = base.rows[0];
  return {
    practitionerId,
    stops: stops.rows.map(toLegStop),
    homeBase:
      baseRow === undefined
        ? null
        : {
            id: baseRow.location_id,
            entrancePoint: { lat: baseRow.entrance_lat, lng: baseRow.entrance_lng },
            parkingPoint: point(baseRow.parking_lng, baseRow.parking_lat),
          },
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

export function mountRouting(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountPracticeDay(api, now);

  api.get('/api/routing/day', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const query = Query.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    if (!canActor(actor, { type: 'routing.day.read', scope: 'own' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const routing = c.get('routing');
    if (!routing) {
      // A deployment with no seam configured is refused cleanly rather than
      // assumed away, exactly as a missing document store is.
      return c.json({ error: 'routing_unavailable', requestId }, 503);
    }
    const db = c.get('db');
    const day = await readDay(db, actor.userId, query.data.date);
    if (day === null) {
      return c.json(RoutingDayResponse.parse({ legs: [], pictureUrl: null, mapAvailable: false }));
    }

    const legs = dayLegs(day.stops, day.homeBase);
    const factors = await readFactors(db);
    const answers = await estimateLegs(db, legs, factors, routing, actor.userId);
    const rows = legs
      .map((leg) => toLegRow(leg, answers.get(leg.toStopId)))
      .filter((row): row is DayLegRow => row !== null);

    const points = dayPoints(day.stops, day.homeBase);
    const fingerprint = dayFingerprint(points);
    const mapAvailable = routing.kind !== 'straight-line' && points.length > 0;
    return c.json(
      RoutingDayResponse.parse({
        legs: rows,
        // A path on this API's own origin, with no coordinate and no id in it:
        // the fingerprint is derived from coordinates but is not one, and
        // .claude/rules/ui.md keeps personal data out of every address.
        pictureUrl: mapAvailable
          ? `/api/routing/day-picture?date=${query.data.date}&v=${fingerprint}`
          : null,
        mapAvailable,
      }),
    );
  });

  api.get('/api/routing/day-picture', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const query = PictureQuery.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    if (!canActor(actor, { type: 'routing.day.read', scope: 'own' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const routing = c.get('routing');
    if (!routing || routing.kind === 'straight-line') {
      // The fallback draws none, and says so plainly rather than serving an
      // empty frame (section 5.3).
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const db = c.get('db');
    const day = await readDay(db, actor.userId, query.data.date);
    if (day === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const points = dayPoints(day.stops, day.homeBase);
    if (points.length === 0) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    // The fingerprint the caller asked with must be this day's own: a stale
    // `v=` is a picture of a day that has since moved, and answering it would
    // be showing a practitioner yesterday's route.
    const fingerprint = dayFingerprint(points);
    if (fingerprint !== query.data.v) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const key = pictureKey(day.practitionerId, query.data.date, fingerprint);
    let bytes = readPicture(key, now());
    if (bytes === null) {
      try {
        bytes = await routing.dayPicture(points);
      } catch (error) {
        if (isRoutingUnavailable(error)) {
          return c.json({ error: 'routing_unavailable', requestId }, 503);
        }
        throw error;
      }
      if (bytes === null) {
        return c.json({ error: 'not_found', requestId }, 404);
      }
      writePicture(key, bytes, endOfDay(query.data.date));
    }
    // `no-store` still goes on, as it does on every /api answer
    // (app/api/_middleware/security.ts). That is not a contradiction with
    // section 3.4: the worker puts this answer into its own cache explicitly
    // rather than letting the HTTP cache keep it, so the lift shows the day
    // the practitioner last saw and nothing is left in a shared cache
    // anywhere else.
    c.header('content-type', 'image/png');
    return c.body(bytes as unknown as ArrayBuffer);
  });
}
