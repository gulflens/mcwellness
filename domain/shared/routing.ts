/**
 * The routing seam (`docs/SEAMS.md`, `docs/SPEC/practitioner-phone.md`
 * section 5). How long the drive between two stops takes, and a picture of
 * the day.
 *
 * Browser-safe: types, one error class and the fallback's own arithmetic.
 * Nothing here imports a Node built-in or a vendor SDK — the two
 * implementations live under `app/api/_middleware/routing` and are
 * server-only, and the key never leaves that process.
 *
 * **What leaves the server is coordinates and a departure time.** Never a
 * name, a record number, an address, a Makani number or an id: the request is
 * built from `location.entrance_point` or `parking_point` and nothing else,
 * and `docs/COMPLIANCE/approved-vendors.md` approves exactly that.
 *
 * **Every answer is an estimate and says so**, on the screen and in `source`:
 * `traffic` from the real implementation, `straight-line` from the fallback.
 * Neither is a promise about when somebody arrives.
 */

/** A coordinate on the earth. The same shape `domain/scheduling/navigation.ts` uses. */
export type GeoPoint = { lat: number; lng: number };

/** Where an estimate came from, and the word the screen prints beside it. */
export type DriveSource = 'traffic' | 'straight-line';

/** One drive: from here to there, leaving then. */
export type DriveLeg = { from: GeoPoint; to: GeoPoint; departAt: Date };

/** What the seam answers for one leg. */
export type DriveEstimate = { seconds: number; metres: number; source: DriveSource };

/**
 * The seam itself. Two calls, and both may answer nothing useful: a
 * `dayPicture` of null is the fallback saying it draws no map, not a failure.
 */
export type RoutingProvider = {
  /** Which implementation this is, for the startup line and the seam's own tests. */
  readonly kind: 'google' | 'straight-line';
  /** One line naming the implementation. Never the key. */
  describe(): string;
  /**
   * One estimate per leg, in the order the legs were given.
   *
   * `factors` are the practice's own editable figures
   * (`scheduling_setting.drive_road_factor` and `drive_peak_multiplier`,
   * migration 204). They are on the call rather than on the implementation
   * because the fallback is the thing that reads them and the caller is the
   * thing that has the practice's row in hand; the real implementation ignores
   * them, because a vendor that measures the traffic has no use for a guess at
   * it. The spec's own sketch of this interface (section 5.1) shows one
   * argument; this second one is what keeps "the fallback's figures are data,
   * not code" true without the seam reading a table.
   */
  driveMatrix(legs: readonly DriveLeg[], factors: DriveFactors): Promise<DriveEstimate[]>;
  /**
   * Every origin to every destination, all leaving at one instant: rows in
   * origin order, columns in destination order. At most `GRID_MAX_ELEMENTS`
   * elements — the vendor's ceiling on one call — and refused above it
   * before anything is sent (docs/SPEC/route-planning.md section 7).
   */
  driveGrid(
    origins: readonly GeoPoint[],
    destinations: readonly GeoPoint[],
    departAt: Date,
    factors: DriveFactors,
  ): Promise<DriveEstimate[][]>;
  /** A PNG of the day's stops in order, or null when this implementation draws none. */
  dayPicture(points: readonly GeoPoint[]): Promise<Uint8Array | null>;
};

/**
 * The routing vendor could not be reached, or refused. Thrown by an
 * implementation and turned into a clean status by the API, so a vendor that
 * is down never reads as a bug in the day sheet — exactly as
 * `StorageUnavailableError` does for the document store.
 */
export class RoutingUnavailableError extends Error {
  /** Structural, so narrowing one away from a plain Error leaves something behind. */
  readonly routingUnavailable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RoutingUnavailableError';
  }
}

/**
 * The fallback's two figures, which are data rather than code: the owner edits
 * them on `scheduling_setting` (migration 204,
 * `docs/SPEC/practitioner-phone.md` section 5.6). The defaults are what a new
 * practice starts with and what every caller falls back to when the row cannot
 * be read.
 */
export const DEFAULT_ROAD_FACTOR = 1.35;
export const DEFAULT_PEAK_MULTIPLIER = 1.5;

export type DriveFactors = {
  /** Straight-line metres to road metres. */
  roadFactor: number;
  /** What the peak hours cost, applied on top. */
  peakMultiplier: number;
};

/**
 * How fast a car actually moves across the emirates, averaged over junctions,
 * roundabouts and a residential last mile: 40 km/h, in metres per second.
 *
 * A constant and not a setting, deliberately. The two figures the owner edits
 * are the ones the spec names, and a third dial that changes every estimate in
 * the same direction as the road factor would be two ways of saying one thing.
 */
export const FALLBACK_SPEED_METRES_PER_SECOND = 40_000 / 3_600;

/** The mean radius of the earth, in metres. */
const EARTH_RADIUS_METRES = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two coordinates, in metres. The straight line
 * a car cannot drive; `roadFactor` above is what turns it into a road.
 */
export function haversineMetres(from: GeoPoint, to: GeoPoint): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Which hour of the practice's own day a departure falls in, 0 to 23. The
 * cache key `drive_estimate` uses beside the two locations, so the same pair
 * at eight in the morning and at midday are two rows and not one overwriting
 * the other.
 *
 * Read in the given zone and never the server's: a laptop set to London would
 * otherwise file the school run under four in the morning.
 */
/**
 * One formatter per zone, held for the life of the process.
 *
 * Building an `Intl.DateTimeFormat` costs about thirty-five microseconds and
 * using one costs almost nothing, and the two readings below are made
 * millions of times inside a single `optimiseDay` search — `hourBucket` once
 * per leg per walk, `isWorkingDay` once per straight-line estimate. Built
 * afresh each time, that alone was most of the eight and a half seconds a
 * full day of eight stops spent blocking the event loop (the review of the
 * day map's pull request, finding B1). A formatter is immutable and its
 * answer depends only on the zone and the instant, so holding one per zone
 * changes no figure; the zones a practice ever asks about are one or two.
 */
const hourFormatters = new Map<string, Intl.DateTimeFormat>();
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
  cache: Map<string, Intl.DateTimeFormat>,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const held = cache.get(timeZone);
  if (held !== undefined) return held;
  const made = new Intl.DateTimeFormat('en-GB', { timeZone, ...options });
  cache.set(timeZone, made);
  return made;
}

export function hourBucket(departAt: Date, timeZone: string): number {
  const hour = formatterFor(hourFormatters, timeZone, {
    hour: '2-digit',
    hour12: false,
  }).format(departAt);
  // en-GB renders midnight as "24" in some engines; both spellings mean hour 0.
  return Number(hour) % 24;
}

/** Monday to Friday: the working week the practice keeps. */
function isWorkingDay(departAt: Date, timeZone: string): boolean {
  const day = formatterFor(weekdayFormatters, timeZone, { weekday: 'short' }).format(departAt);
  return day !== 'Sat' && day !== 'Sun';
}

/**
 * Whether an hour of a working day is one of the two the practice pays for in
 * traffic: 06:00 to 10:00 and 16:00 to 20:00
 * (`docs/SPEC/practitioner-phone.md` section 5.6). Half-open at the top, so
 * ten o'clock is not still the morning peak.
 */
export function isPeakHour(departAt: Date, timeZone: string): boolean {
  if (!isWorkingDay(departAt, timeZone)) return false;
  const hour = hourBucket(departAt, timeZone);
  return (hour >= 6 && hour < 10) || (hour >= 16 && hour < 20);
}

/**
 * The fallback's whole answer for one leg: straight-line distance times the
 * road factor for the metres, and those metres at an average speed times the
 * peak multiplier for the seconds.
 *
 * Pure, and the clock is an argument: `departAt` decides only whether the peak
 * applies, and it is judged in `timeZone` rather than wherever the process
 * happens to be running.
 */
export function straightLineSeconds(
  from: GeoPoint,
  to: GeoPoint,
  departAt: Date,
  factors: DriveFactors,
  timeZone: string,
): { seconds: number; metres: number } {
  const metres = Math.round(haversineMetres(from, to) * factors.roadFactor);
  const peak = isPeakHour(departAt, timeZone) ? factors.peakMultiplier : 1;
  const seconds = Math.round((metres / FALLBACK_SPEED_METRES_PER_SECOND) * peak);
  return { seconds, metres };
}

/**
 * The fallback as the seam sees it: one estimate per leg, every one labelled
 * `straight-line`, and no picture.
 */
export function straightLineMatrix(
  legs: readonly DriveLeg[],
  factors: DriveFactors,
  timeZone: string,
): DriveEstimate[] {
  return legs.map((leg) => ({
    ...straightLineSeconds(leg.from, leg.to, leg.departAt, factors, timeZone),
    source: 'straight-line' as const,
  }));
}

/** Google's own ceiling on one compute-route-matrix call: origins times destinations. */
export const GRID_MAX_ELEMENTS = 625;

/**
 * The fallback's grid: the same arithmetic as `straightLineMatrix`, for every
 * pair. The diagonal is a drive of no distance, which is an honest zero.
 */
export function straightLineGrid(
  origins: readonly GeoPoint[],
  destinations: readonly GeoPoint[],
  departAt: Date,
  factors: DriveFactors,
  timeZone: string,
): DriveEstimate[][] {
  return origins.map((from) =>
    destinations.map((to) => ({
      ...straightLineSeconds(from, to, departAt, factors, timeZone),
      source: 'straight-line' as const,
    })),
  );
}

/**
 * The fingerprint of a day's ordered coordinates, used as the picture's cache
 * key and as the `v=` on its address. Coordinates only, rounded to five
 * decimal places — about a metre, which is finer than any entrance the
 * practice records and coarse enough that a jittery reading does not mint a
 * new picture.
 *
 * Not a hash: a hash would need a crypto call this browser-safe file must not
 * make, and there is nothing to hide here — the fingerprint is derived from
 * coordinates the caller already holds, and it names no person.
 */
export function dayFingerprint(points: readonly GeoPoint[]): string {
  if (points.length === 0) return 'empty';
  const round = (value: number): string => value.toFixed(5);
  let sum = 0;
  for (const [index, point] of points.entries()) {
    for (const part of `${round(point.lat)},${round(point.lng)},${index}`) {
      // A plain 32-bit rolling sum, the cheapest thing that changes when any
      // coordinate or its position does.
      sum = (sum * 31 + part.charCodeAt(0)) >>> 0;
    }
  }
  return `${points.length}-${sum.toString(36)}`;
}
