import { navigationTarget, type GeoPoint } from './navigation';

/**
 * The drives between a practitioner's stops
 * (docs/SPEC/practitioner-phone.md section 5.2). Pure: the day's stops in
 * order and the practitioner's home base go in, the ordered legs come out.
 * No clock is read inside — every time on a leg is derived from a time on a
 * stop.
 *
 * **Where a leg starts and when.** From the previous stop's `windowEnd` plus
 * that service's own duration: the arrival window is when the practitioner
 * turns up, and the visit runs from there, so the earliest they can leave is
 * the end of the window plus the length of the session. That is deliberately
 * pessimistic — a visit that starts at the top of its window finishes sooner —
 * because an estimate that has the practitioner leaving before the session
 * ends is an estimate nobody can act on.
 *
 * **Home base first, and no return leg.** A practitioner with a home base on
 * file (`practitioner.home_base_location_id`) drives from it to the first
 * stop, departing at that stop's `windowStart` less nothing: the leg is
 * estimated for the hour they arrive, which is the hour the traffic they will
 * be sitting in belongs to. There is no leg home at the end: the day ends at
 * the last household, and the drive home is the practitioner's own.
 *
 * **Where a leg ends** is `navigationTarget` — the parking point when the
 * practice has one on file, the entrance otherwise — which is the same
 * coordinate the Navigate hand-off already uses, so the estimate is for the
 * journey the deep link actually sends them on.
 */

export type LegStop = {
  /** The appointment's own id: the leg is named for the stop it arrives at. */
  id: string;
  windowStart: Date;
  windowEnd: Date;
  /** The service's own length, from `service_type.duration_minutes`. */
  durationMinutes: number;
  location: { id: string; entrancePoint: GeoPoint; parkingPoint: GeoPoint | null };
};

/** Where the practitioner's day starts, when the practice records one. */
export type HomeBase = { id: string; entrancePoint: GeoPoint; parkingPoint: GeoPoint | null };

export type DayLeg = {
  /** The stop this leg arrives at. The day sheet renders the line above that stop's card. */
  toStopId: string;
  fromLocationId: string;
  toLocationId: string;
  from: GeoPoint;
  to: GeoPoint;
  /** When the practitioner can set off, which is what the estimate is asked for. */
  departAt: Date;
};

const MINUTE_MS = 60_000;

/**
 * The ordered legs of one day. An empty day has none; a single stop has one
 * only when there is a home base to leave from; a stop whose location repeats
 * the one before it still gets a leg, because a household with two clients at
 * one address is a real day and a leg of no distance is an honest answer.
 *
 * The stops are taken in the order given — the day sheet's own order, which
 * `app/api/appointments/list.ts` sorts by window — and never re-sorted here: a
 * route solver is deliberately out of scope (section 11).
 */
export function dayLegs(stops: readonly LegStop[], homeBase: HomeBase | null): DayLeg[] {
  const legs: DayLeg[] = [];
  for (const [index, stop] of stops.entries()) {
    const previous = index === 0 ? null : stops[index - 1];
    if (previous === null || previous === undefined) {
      // The first stop: only when the practice knows where the day starts.
      if (homeBase === null) continue;
      legs.push({
        toStopId: stop.id,
        fromLocationId: homeBase.id,
        toLocationId: stop.location.id,
        from: navigationTarget(homeBase),
        to: navigationTarget(stop.location),
        departAt: stop.windowStart,
      });
      continue;
    }
    legs.push({
      toStopId: stop.id,
      fromLocationId: previous.location.id,
      toLocationId: stop.location.id,
      from: navigationTarget(previous.location),
      to: navigationTarget(stop.location),
      departAt: new Date(previous.windowEnd.getTime() + previous.durationMinutes * MINUTE_MS),
    });
  }
  return legs;
}

/**
 * The coordinates the day's picture is drawn from, in stop order, with the
 * home base at the front when there is one. Exactly the points the legs
 * already carry, so the picture and the estimates describe the same day.
 */
export function dayPoints(stops: readonly LegStop[], homeBase: HomeBase | null): GeoPoint[] {
  const points = stops.map((stop) => navigationTarget(stop.location));
  return homeBase === null ? points : [navigationTarget(homeBase), ...points];
}
