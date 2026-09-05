import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '@domain/shared';
import {
  DEFAULT_PEAK_MULTIPLIER,
  DEFAULT_ROAD_FACTOR,
  dayFingerprint,
  hourBucket,
  type DriveEstimate,
  type DriveFactors,
  type GeoPoint,
  type RoutingProvider,
} from '../../../domain/shared/routing';
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
import { isRoutingUnavailable, PRACTICE_TIME_ZONE } from '../_middleware/routing';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { pictureKey, readPicture, writePicture } from './picture-cache';
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

const PRACTICE_UTC_OFFSET = '+04:00';
/** How long a cached estimate stands before it is asked again (section 5.2). */
const FRESH_FOR_DAYS = 30;

const Query = z.object({ date: z.iso.date() });
const PictureQuery = z.object({ date: z.iso.date(), v: z.string().min(1).max(64) });

type StopRow = {
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

const FACTORS_SQL =
  'select drive_road_factor::float8 as road, drive_peak_multiplier::float8 as peak ' +
  'from scheduling_setting where tenant_id = app.current_tenant_id()';

const CACHED_SQL =
  'select from_location_id, to_location_id, hour_bucket, seconds, metres, source::text as source ' +
  'from drive_estimate where tenant_id = app.current_tenant_id() ' +
  'and fetched_at > now() - make_interval(days => $1)';

/**
 * One figure in, or refreshed in place. `on conflict` on the cache's own key,
 * because two devices opening the same day at once is an ordinary thing and
 * neither should fail.
 */
const WRITE_SQL =
  'insert into drive_estimate (tenant_id, from_location_id, to_location_id, hour_bucket, ' +
  'seconds, metres, source, fetched_at, created_by) values ' +
  '(app.current_tenant_id(), $1, $2, $3, $4, $5, $6, now(), $7) ' +
  'on conflict (tenant_id, from_location_id, to_location_id, hour_bucket) do update set ' +
  'seconds = excluded.seconds, metres = excluded.metres, source = excluded.source, ' +
  'fetched_at = excluded.fetched_at';

function point(lng: number | null, lat: number | null): GeoPoint | null {
  return lng === null || lat === null ? null : { lat, lng };
}

function dayRange(date: string): [Date, Date] {
  const start = new Date(`${date}T00:00:00${PRACTICE_UTC_OFFSET}`);
  return [start, new Date(start.getTime() + 24 * 60 * 60_000)];
}

/** The instant the practice's day ends, which is when a picture of it stops being useful. */
function endOfDay(date: string): Date {
  return dayRange(date)[1];
}

function toLegStop(row: StopRow): LegStop {
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

async function readFactors(db: Db): Promise<DriveFactors> {
  const { rows } = await db.query<{ road: number; peak: number }>(FACTORS_SQL);
  // Migration 204 gives every practice this row and never lets it be deleted,
  // so the fallback is for a database mid-migration rather than for ordinary
  // life — and it falls back to the same two figures a new practice starts
  // with, so a screen and the arithmetic behind it cannot disagree.
  return {
    roadFactor: rows[0]?.road ?? DEFAULT_ROAD_FACTOR,
    peakMultiplier: rows[0]?.peak ?? DEFAULT_PEAK_MULTIPLIER,
  };
}

const cacheKey = (from: string, to: string, hour: number): string => `${from}:${to}:${hour}`;

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

/**
 * Every leg's estimate: the cache first, then one call to the seam for
 * whatever is missing, then the answers written back.
 *
 * A vendor that is down is not a failure of the day: the legs that were cached
 * are answered and the rest are left out, so the day sheet renders its "– –"
 * against them and the practitioner gets on with the drive.
 */
async function estimateLegs(
  db: Db,
  legs: readonly DayLeg[],
  factors: DriveFactors,
  routing: RoutingProvider,
  actorUserId: string,
): Promise<Map<string, DriveEstimate>> {
  const answers = new Map<string, DriveEstimate>();
  if (legs.length === 0) return answers;

  const cached = await db.query<{
    from_location_id: string;
    to_location_id: string;
    hour_bucket: number;
    seconds: number;
    metres: number;
    source: 'traffic' | 'straight-line';
  }>(CACHED_SQL, [FRESH_FOR_DAYS]);
  const fresh = new Map(
    cached.rows.map((row) => [
      cacheKey(row.from_location_id, row.to_location_id, row.hour_bucket),
      { seconds: row.seconds, metres: row.metres, source: row.source },
    ]),
  );

  const missing: { leg: DayLeg; hour: number }[] = [];
  for (const leg of legs) {
    const hour = hourBucket(leg.departAt, PRACTICE_TIME_ZONE);
    const hit = fresh.get(cacheKey(leg.fromLocationId, leg.toLocationId, hour));
    if (hit) {
      answers.set(leg.toStopId, hit);
      continue;
    }
    missing.push({ leg, hour });
  }
  if (missing.length === 0) return answers;

  let estimates: DriveEstimate[];
  try {
    estimates = await routing.driveMatrix(
      missing.map(({ leg }) => ({ from: leg.from, to: leg.to, departAt: leg.departAt })),
      factors,
    );
  } catch (error) {
    if (isRoutingUnavailable(error)) {
      // The cached legs stand; the rest render as "– –". A day sheet that
      // refused to open because a vendor was down would be worse than a day
      // sheet with a blank in it.
      return answers;
    }
    throw error;
  }

  for (const [index, { leg, hour }] of missing.entries()) {
    const estimate = estimates[index];
    if (!estimate) continue;
    answers.set(leg.toStopId, estimate);
    await db.query(WRITE_SQL, [
      leg.fromLocationId,
      leg.toLocationId,
      hour,
      estimate.seconds,
      estimate.metres,
      estimate.source,
      actorUserId,
    ]);
  }
  return answers;
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
