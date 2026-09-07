import type { DriveEstimate, DriveSource } from '../shared/routing';
import { MIN_TRAVEL_BUFFER_MINUTES, travelBufferFor } from './buffer';
import { ceilToQuarterHour } from './grid';
import type { GeoPoint } from './navigation';
import type { AppointmentStatus } from './status';
import { windowFor } from './window';

/**
 * The optimised day (docs/SPEC/route-planning.md section 5.4). Pure: the
 * stops, the base, the clock and a matrix of drives go in; the order that
 * drives least comes out, with every moved visit's new window, or a refusal
 * that says why nothing should move.
 *
 * **What moves.** A `proposed` visit still more than an hour ahead of now.
 * Everything else is an anchor and keeps its window: a household that has
 * been told, a visit under way or over, a visit about to start.
 *
 * **How a day is walked.** Planned arrival is the top of a window, and the
 * practitioner leaves after the service's own length. A movable stop keeps
 * its window when the new arrival still falls inside it, and otherwise
 * takes the arrival rounded up to the quarter hour; an anchor whose window
 * the arrival has missed makes the whole order infeasible. With a base, the
 * first leg is timed to arrive at the first window and the drive home is
 * counted in the sum — never in the day's end, which is the last visit's
 * departure and the practitioner's own from there.
 *
 * **What is best.** The fewest seconds of driving; then the earlier end;
 * then the fewer households moved; then the order as it stands. The search
 * is exhaustive over orderings that keep the anchors in their own time
 * order, pruned by the best sum found so far, and refuses more than ten
 * stops rather than think for a minute.
 */

export type PlanStop = {
  id: string;
  status: AppointmentStatus;
  windowStart: Date;
  windowEnd: Date;
  durationMinutes: number;
  travelBufferMinutes: number;
  locationId: string;
  point: GeoPoint;
};
export type PlanBase = { locationId: string; point: GeoPoint };
/** A total function: the route fills it from the cache and the seam before calling. */
export type Matrix = (
  fromLocationId: string,
  toLocationId: string,
  departAt: Date,
) => DriveEstimate;
export type DayInput = { stops: readonly PlanStop[]; homeBase: PlanBase | null; now: Date };
export type Totals = { driveSeconds: number; driveMetres: number; dayEnd: Date };
export type PlannedStop = {
  id: string;
  windowStart: Date;
  windowEnd: Date;
  travelBufferMinutes: number;
  moved: boolean;
  anchor: boolean;
};
export type PlanSource = DriveSource | 'mixed';
export type DayPlan = {
  kind: 'plan';
  /** In the new order. */
  stops: PlannedStop[];
  before: Totals;
  after: Totals;
  savedSeconds: number;
  source: PlanSource;
};
export type PlanRefusalReason =
  'nothing_to_move' | 'no_improvement' | 'infeasible' | 'too_many_stops';
export type PlanRefusal = { kind: 'refusal'; reason: PlanRefusalReason };

export const MAX_PLAN_STOPS = 10;
/** A proposed visit closer than this to now is not moved: somebody may already be on the road. */
export const MOVABLE_LEAD_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

export function isMovable(stop: PlanStop, now: Date): boolean {
  return stop.status === 'proposed' && stop.windowStart.getTime() > now.getTime() + MOVABLE_LEAD_MS;
}

type Walk = { stops: PlannedStop[]; totals: Totals; sources: Set<DriveSource>; moves: number };

function inside(at: Date, stop: PlanStop): boolean {
  return at.getTime() >= stop.windowStart.getTime() && at.getTime() <= stop.windowEnd.getTime();
}

/**
 * One ordering, walked from the day's start. Null when an anchor's window is
 * missed or the running sum already exceeds `bound`.
 */
function walk(
  order: readonly PlanStop[],
  movable: ReadonlySet<string>,
  input: DayInput,
  matrix: Matrix,
  earliest: Date,
  bound: number,
): Walk | null {
  const sources = new Set<DriveSource>();
  let driveSeconds = 0;
  let driveMetres = 0;
  const take = (estimate: DriveEstimate): DriveEstimate => {
    sources.add(estimate.source);
    driveSeconds += estimate.seconds;
    driveMetres += estimate.metres;
    return estimate;
  };
  const planned: PlannedStop[] = [];
  const nextLeg: (DriveEstimate | undefined)[] = [];
  let previous: { locationId: string; departAt: Date } | null = null;
  let moves = 0;

  for (const [index, stop] of order.entries()) {
    const free = movable.has(stop.id);
    let arrival: Date;
    if (previous === null) {
      // The first stop: with a base, the leg is timed to arrive when the
      // window opens, so the estimate is asked for that hour.
      const target = free
        ? new Date(Math.max(earliest.getTime(), stop.windowStart.getTime()))
        : stop.windowStart;
      if (input.homeBase !== null) take(matrix(input.homeBase.locationId, stop.locationId, target));
      arrival = free ? earliest : stop.windowStart;
    } else {
      const leg = take(matrix(previous.locationId, stop.locationId, previous.departAt));
      nextLeg[index - 1] = leg;
      arrival = new Date(previous.departAt.getTime() + leg.seconds * 1000);
    }
    if (driveSeconds > bound) return null;

    let windowStart: Date;
    let plannedArrival: Date;
    if (free) {
      const notBefore = new Date(Math.max(arrival.getTime(), earliest.getTime()));
      if (inside(notBefore, stop) && stop.windowStart.getTime() >= earliest.getTime()) {
        windowStart = stop.windowStart;
        plannedArrival = notBefore;
      } else {
        windowStart = ceilToQuarterHour(notBefore);
        plannedArrival = windowStart;
      }
    } else {
      if (arrival.getTime() > stop.windowEnd.getTime()) return null;
      windowStart = stop.windowStart;
      plannedArrival = new Date(Math.max(arrival.getTime(), stop.windowStart.getTime()));
    }
    const moved = windowStart.getTime() !== stop.windowStart.getTime();
    if (moved) moves += 1;
    planned.push({
      id: stop.id,
      windowStart,
      windowEnd: windowFor(windowStart).end,
      travelBufferMinutes: stop.travelBufferMinutes,
      moved,
      anchor: !free,
    });
    previous = {
      locationId: stop.locationId,
      departAt: new Date(plannedArrival.getTime() + stop.durationMinutes * MINUTE_MS),
    };
  }

  const dayEnd = previous === null ? earliest : previous.departAt;
  if (previous !== null && input.homeBase !== null) {
    take(matrix(previous.locationId, input.homeBase.locationId, previous.departAt));
  }
  if (driveSeconds > bound) return null;

  // Rule 6.2 for every visit this plan moves: the drive to the next stop plus
  // ten; the last keeps the floor. Anchors and unmoved visits keep their own.
  for (const [index, here] of planned.entries()) {
    if (here.anchor || !here.moved) continue;
    const leg = nextLeg[index];
    here.travelBufferMinutes =
      leg === undefined ? MIN_TRAVEL_BUFFER_MINUTES : travelBufferFor(leg.seconds);
  }
  return { stops: planned, totals: { driveSeconds, driveMetres, dayEnd }, sources, moves };
}

/** Every ordering in which the anchors keep their time order and the movable stops go anywhere. */
function* orderings(
  anchors: readonly PlanStop[],
  free: readonly PlanStop[],
): Generator<PlanStop[]> {
  const result: PlanStop[] = [];
  const used: boolean[] = free.map(() => false);
  function* step(anchorIndex: number, placed: number): Generator<PlanStop[]> {
    if (placed === anchors.length + free.length) {
      yield [...result];
      return;
    }
    const anchor = anchors[anchorIndex];
    if (anchor !== undefined) {
      result.push(anchor);
      yield* step(anchorIndex + 1, placed + 1);
      result.pop();
    }
    for (const [i, stop] of free.entries()) {
      if (used[i]) continue;
      used[i] = true;
      result.push(stop);
      yield* step(anchorIndex, placed + 1);
      result.pop();
      used[i] = false;
    }
  }
  yield* step(0, 0);
}

function better(a: Walk, b: Walk): boolean {
  if (a.totals.driveSeconds !== b.totals.driveSeconds) {
    return a.totals.driveSeconds < b.totals.driveSeconds;
  }
  if (a.totals.dayEnd.getTime() !== b.totals.dayEnd.getTime()) {
    return a.totals.dayEnd.getTime() < b.totals.dayEnd.getTime();
  }
  return a.moves < b.moves;
}

function planSource(sources: ReadonlySet<DriveSource>): PlanSource {
  if (sources.size === 0) return 'straight-line';
  if (sources.size === 1) return [...sources][0] ?? 'straight-line';
  return 'mixed';
}

export function optimiseDay(input: DayInput, matrix: Matrix): DayPlan | PlanRefusal {
  if (input.stops.length > MAX_PLAN_STOPS) return { kind: 'refusal', reason: 'too_many_stops' };
  const current = [...input.stops].sort(
    (a, b) => a.windowStart.getTime() - b.windowStart.getTime() || a.id.localeCompare(b.id),
  );
  const movable = new Set(current.filter((stop) => isMovable(stop, input.now)).map((s) => s.id));
  const first = current[0];
  if (movable.size === 0 || first === undefined) {
    return { kind: 'refusal', reason: 'nothing_to_move' };
  }
  // The day starts where it starts today, and never inside the coming hour.
  const earliest = new Date(
    Math.max(first.windowStart.getTime(), input.now.getTime() + MOVABLE_LEAD_MS),
  );
  // The day as it stands: every stop an anchor.
  const before = walk(
    current,
    new Set<string>(),
    input,
    matrix,
    earliest,
    Number.POSITIVE_INFINITY,
  );
  if (before === null) return { kind: 'refusal', reason: 'infeasible' };

  const anchors = current.filter((stop) => !movable.has(stop.id));
  const free = current.filter((stop) => movable.has(stop.id));
  // The current order first, so a tie keeps it.
  let best = walk(current, movable, input, matrix, earliest, Number.POSITIVE_INFINITY);
  if (best !== null && best.totals.dayEnd.getTime() > before.totals.dayEnd.getTime()) best = null;
  for (const order of orderings(anchors, free)) {
    if (order.every((stop, index) => stop === current[index])) continue;
    const bound = best === null ? Number.POSITIVE_INFINITY : best.totals.driveSeconds;
    const candidate = walk(order, movable, input, matrix, earliest, bound);
    if (candidate === null) continue;
    if (candidate.totals.dayEnd.getTime() > before.totals.dayEnd.getTime()) continue;
    if (best === null || better(candidate, best)) best = candidate;
  }
  if (best === null) return { kind: 'refusal', reason: 'infeasible' };

  const savedSeconds = before.totals.driveSeconds - best.totals.driveSeconds;
  const endsEarlier = best.totals.dayEnd.getTime() < before.totals.dayEnd.getTime();
  if (best.moves === 0 || (savedSeconds <= 0 && !endsEarlier)) {
    return { kind: 'refusal', reason: 'no_improvement' };
  }
  return {
    kind: 'plan',
    stops: best.stops,
    before: before.totals,
    after: best.totals,
    savedSeconds,
    source: planSource(best.sources),
  };
}
