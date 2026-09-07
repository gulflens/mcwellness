/**
 * The drive-estimate cache (`drive_estimate`, migration 204) and the two ways
 * this piece reads it: leg by leg for one practitioner's day sheet
 * (`estimateLegs`, moved here from `day.ts` when the practice's day map came
 * to need the same rows), and as a whole matrix for the optimiser
 * (`fillMatrix`, docs/SPEC/route-planning.md section 5.6).
 *
 * **Both write back only what the seam actually answered.** A vendor that is
 * down is filled in locally with the practice's own straight-line arithmetic
 * and nothing is written: a guess kept for thirty days under the label of an
 * outage is worse than asking again tomorrow.
 */

import {
  DEFAULT_PEAK_MULTIPLIER,
  DEFAULT_ROAD_FACTOR,
  GRID_MAX_ELEMENTS,
  hourBucket,
  straightLineSeconds,
  type DriveEstimate,
  type DriveFactors,
  type GeoPoint,
  type RoutingProvider,
} from '../../../domain/shared/routing';
import type { Matrix } from '../../../domain/scheduling/optimise';
import type { DayLeg } from '../../../domain/scheduling/legs';
import { isRoutingUnavailable, PRACTICE_TIME_ZONE } from '../_middleware/routing';
import type { Db } from '../_middleware/request-context';

/** The practice's own offset, stated per file where it is used, as the routing routes do. */
export const PRACTICE_UTC_OFFSET = '+04:00';
/** How long a cached estimate stands before it is asked again (section 5.2). */
export const FRESH_FOR_DAYS = 30;

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

export function dayRange(date: string): [Date, Date] {
  const start = new Date(`${date}T00:00:00${PRACTICE_UTC_OFFSET}`);
  return [start, new Date(start.getTime() + 24 * 60 * 60_000)];
}

export async function readFactors(db: Db): Promise<DriveFactors> {
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

export /**
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

  // The missing legs, gathered into the hour they leave in. One call per hour
  // and not one call for the day: a compute-route-matrix request carries a
  // single departureTime, so a day sheet asked in one call priced the
  // afternoon's drive with the morning's traffic and then cached that figure
  // under the afternoon's own hour — a wrong answer, kept. A day of six stops
  // is at most six legs, so this is a handful of calls at the very worst and
  // usually two or three.
  const missing = new Map<number, DayLeg[]>();
  for (const leg of legs) {
    const hour = hourBucket(leg.departAt, PRACTICE_TIME_ZONE);
    const hit = fresh.get(cacheKey(leg.fromLocationId, leg.toLocationId, hour));
    if (hit) {
      answers.set(leg.toStopId, hit);
      continue;
    }
    const bucket = missing.get(hour);
    if (bucket) bucket.push(leg);
    else missing.set(hour, [leg]);
  }
  if (missing.size === 0) return answers;

  // In the day's own order, so the drives are asked for in the order they will
  // be driven and a vendor that goes down mid-day answers the earlier stops.
  for (const hour of [...missing.keys()].sort((a, b) => a - b)) {
    const bucket = missing.get(hour) ?? [];
    let estimates: DriveEstimate[];
    try {
      estimates = await routing.driveMatrix(
        bucket.map((leg) => ({ from: leg.from, to: leg.to, departAt: leg.departAt })),
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

    for (const [index, leg] of bucket.entries()) {
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
  }
  return answers;
}

/** One place the day touches: a location's id and the coordinate drives are measured to. */
export type Place = { locationId: string; point: GeoPoint };

/** The instant a bucket's estimates are asked for: the middle of that hour, in the practice's day. */
function bucketDeparture(date: string, hour: number): Date {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:30:00${PRACTICE_UTC_OFFSET}`);
}

/**
 * A total function answering the drive between any two of `places` at any
 * instant, filled from the cache and — for whatever is missing — from one
 * grid call per hour bucket (docs/SPEC/route-planning.md section 5.6).
 *
 * Never throws and never waits once it is built: the optimiser walks
 * thousands of orderings and must not touch the network inside the search.
 * A pair the vendor could not answer falls back to the practice's own
 * straight-line arithmetic, so a plan is always computable and the screen is
 * told which figures it is looking at.
 */
export async function fillMatrix(
  db: Db,
  places: readonly Place[],
  buckets: readonly number[],
  date: string,
  factors: DriveFactors,
  routing: RoutingProvider,
  actorUserId: string,
): Promise<Matrix> {
  const points = new Map(places.map((place) => [place.locationId, place.point]));
  const answers = new Map<string, DriveEstimate>();
  const filled = new Map<string, number[]>();

  const cached = await db.query<{
    from_location_id: string;
    to_location_id: string;
    hour_bucket: number;
    seconds: number;
    metres: number;
    source: 'traffic' | 'straight-line';
  }>(CACHED_SQL, [FRESH_FOR_DAYS]);
  for (const row of cached.rows) {
    if (!points.has(row.from_location_id) || !points.has(row.to_location_id)) continue;
    answers.set(cacheKey(row.from_location_id, row.to_location_id, row.hour_bucket), {
      seconds: row.seconds,
      metres: row.metres,
      source: row.source,
    });
  }

  const remember = (from: string, to: string, hour: number): void => {
    const key = `${from}:${to}`;
    const hours = filled.get(key);
    if (hours) hours.push(hour);
    else filled.set(key, [hour]);
  };
  for (const from of places) {
    for (const to of places) {
      if (from.locationId === to.locationId) continue;
      for (const hour of buckets) {
        if (answers.has(cacheKey(from.locationId, to.locationId, hour))) {
          remember(from.locationId, to.locationId, hour);
        }
      }
    }
  }

  const coordinates = places.map((place) => place.point);
  for (const hour of [...buckets].sort((a, b) => a - b)) {
    const missing = places.some((from) =>
      places.some(
        (to) =>
          from.locationId !== to.locationId &&
          !answers.has(cacheKey(from.locationId, to.locationId, hour)),
      ),
    );
    if (!missing) continue;
    if (places.length * places.length > GRID_MAX_ELEMENTS) break;
    const departAt = bucketDeparture(date, hour);
    let grid: DriveEstimate[][];
    try {
      grid = await routing.driveGrid(coordinates, coordinates, departAt, factors);
    } catch (error) {
      if (isRoutingUnavailable(error)) {
        // The hours already answered stand; this one falls back below, and
        // nothing of it is written: a cache is not the place for an outage.
        continue;
      }
      throw error;
    }
    for (const [i, from] of places.entries()) {
      for (const [j, to] of places.entries()) {
        if (i === j) continue;
        const estimate = grid[i]?.[j];
        if (!estimate) continue;
        answers.set(cacheKey(from.locationId, to.locationId, hour), estimate);
        remember(from.locationId, to.locationId, hour);
        await db.query(WRITE_SQL, [
          from.locationId,
          to.locationId,
          hour,
          estimate.seconds,
          estimate.metres,
          estimate.source,
          actorUserId,
        ]);
      }
    }
  }

  return (fromLocationId, toLocationId, departAt) => {
    if (fromLocationId === toLocationId) return { seconds: 0, metres: 0, source: 'traffic' };
    const hour = hourBucket(departAt, PRACTICE_TIME_ZONE);
    const exact = answers.get(cacheKey(fromLocationId, toLocationId, hour));
    if (exact) return exact;
    // The nearest hour this pair was actually asked about: a plan that walks
    // past the hours the day was priced for is answered with the closest
    // figure rather than with an invention.
    const hours = filled.get(`${fromLocationId}:${toLocationId}`);
    const nearest = hours?.reduce(
      (best: number | null, candidate) =>
        best === null || Math.abs(candidate - hour) < Math.abs(best - hour) ? candidate : best,
      null,
    );
    if (nearest !== null && nearest !== undefined) {
      const near = answers.get(cacheKey(fromLocationId, toLocationId, nearest));
      if (near) return near;
    }
    const from = points.get(fromLocationId);
    const to = points.get(toLocationId);
    if (!from || !to) return { seconds: 0, metres: 0, source: 'straight-line' };
    return {
      ...straightLineSeconds(from, to, departAt, factors, PRACTICE_TIME_ZONE),
      source: 'straight-line' as const,
    };
  };
}
