# Route Planning, Piece Seventeen: the Day Map and the Optimised Day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-screen map of one day in the admin console, the drive between stops in minutes, and one button that finds the order of the day's `proposed` visits that drives least and applies it through the existing move rule.

**Architecture:** The routing seam (`domain/shared/routing.ts`) gains a grid call; a pure rule `optimiseDay` in `domain/scheduling` searches orderings against a matrix the API fills from the `drive_estimate` cache and the seam; two routing reads and one reorder route serve the page; the map is Google's Maps JavaScript API loaded in the browser under a browser key, on one document (`/admin/schedule/map`) that the API serves with its own nonce-based security policy while every other document keeps the strict one.

**Tech Stack:** TypeScript, React 19 + Vite, Hono on Node, PostgreSQL (PostGIS), Zod, Vitest (+ jsdom, Testing Library), Google Maps JavaScript API (quarterly channel), Google Routes API compute route matrix.

**Spec:** `docs/SPEC/route-planning.md` (Part A, sections 1–11 and 13–17). The plan argues from the spec; read both. The operator's plan is `docs/PLAN/route-planning.md`.

## Global Constraints

- **Worktree and ports.** Build in `/Volumes/Storage/McWellness/mcwellness-scheduling` on branch `scheduling-5` (already checked out at `main` = `b3aa641`). Its `.env` carries `DB_PORT=5434`, `PORT=3002`, `WEB_PORT=5175`, `COMPOSE_PROJECT_NAME=mcwellness-scheduling`; the container `mcwellness-scheduling-db-1` is running. Never `cd` to another worktree.
- **Commands and timeouts.** `pnpm verify` (format, lint, typecheck, secrets audit, migrations audit, unit tests), `pnpm test:db` (needs the database), `pnpm build`. Run each with an explicit timeout of at least 600 seconds, never in a silent loop; while iterating run single files: `pnpm exec vitest run <file>` and `pnpm exec vitest run --config vitest.db.config.ts <file>`. `pnpm exec prettier --write <files>` before every commit.
- **Rules that lint enforces** (`eslint.config.js`, `tests/lint/*`): no hex colour literal in `app/**` (read tokens at runtime, section 4.5 of the spec); no ALL-CAPS labels, no middle dot, no arrow in a control's text, no `!important`; every staff screen English only (`tests/lint/console-is-english.test.ts`); no Node built-in reachable from a domain barrel or the browser entry.
- **Business rules are pure functions in `domain/` with tests written first** (CLAUDE.md rule 4, `.claude/rules/testing.md`): no clock read inside a rule — `now` is an argument.
- **No personal data in URLs or query strings**; opaque ids and calendar dates only.
- **What leaves the server for Google is coordinates and a departure time.** Never a name, record number, address, Makani number or id. The server key never reaches a log line or a browser.
- **No migration, no policy file, no schema change.** The cache table and its policies already admit owner, admin and lead practitioner.
- **Time zone.** `Asia/Dubai`, UTC+4 all year; `PRACTICE_UTC_OFFSET = '+04:00'` is stated per file where used, as the existing routes do.
- **Wording.** Every figure is an "estimate"; the source word is "estimate from traffic" or "straight-line estimate"; refusal sentences are the spec's (5.5) verbatim.
- **Commits.** Conventional messages, one task per commit (or two when a task says so), ending with:

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- **Never touch the practice's Google keys.** Re-restricting them and setting the spending cap is the integrator's console act at the staging pass (spec section 8.5). No key of any kind goes into the repository, a commit, a log line or a report; `pnpm verify` runs a secrets scan that will catch one.
- **Shared-zone edits ride in this pull request** (spec section 17); each is listed in `docs/CHANGE-REQUESTS/scheduling-05.md` (Task 13).

## File Structure

| File | Responsibility |
|---|---|
| `domain/shared/routing.ts` (modify) | `driveGrid` on `RoutingProvider`, `GRID_MAX_ELEMENTS`, `straightLineGrid` |
| `app/api/_middleware/routing/google.ts`, `straight-line.ts`, `seam.test.ts` (modify) | the grid in both implementations, tested against a fake fetch |
| `domain/scheduling/grid.ts`, `buffer.ts` (create) | quarter-hour rounding; the travel-buffer rule 6.2 |
| `domain/scheduling/optimise.ts` (create) | `optimiseDay`: the ordering search, the walk, totals, refusals |
| `domain/scheduling/index.ts` (modify) | exports |
| `app/api/routing/estimates.ts` (create) | the cache read/write, `estimateLegs` (moved from `day.ts`), `fillMatrix` |
| `app/api/routing/day.ts` (modify) | imports the moved helpers; mounts `practice-day.ts` |
| `app/api/routing/practice-day.ts` (create) | `GET /api/routing/practice-day`, `POST /api/routing/practice-day/optimise` |
| `app/api/routing/schema.ts` (modify) | the two new wire shapes |
| `app/api/appointments/move-one.ts` (create) | the per-visit move, extracted from `move.ts` |
| `app/api/appointments/move.ts` (modify) | composes `move-one.ts`; behaviour unchanged |
| `app/api/appointments/reorder.ts` (create) | `POST /api/appointments/reorder` |
| `app/api/appointments/schema.ts`, `routes.ts` (modify) | reorder shapes and mount |
| `app/api/_middleware/security.ts`, `request-context.ts`, `serve-app.ts` (modify) | the map document's policy, the nonce, the shell stamped with it |
| `app/admin/schedule/map/googleMaps.ts`, `mapStyle.ts` (create) | the loader; the basemap style from runtime tokens |
| `app/admin/schedule/map/overlays.ts`, `DayMap.tsx` (create) | pins and labels as `OverlayView`, lines as `Polyline` |
| `app/admin/schedule/map/DayMapPage.tsx`, `map.css` (create) | the page, the panel, the states |
| `app/admin/schedule/map/OptimiseDrawer.tsx` (create) | the plan, the figures, Apply |
| `app/admin/schedule/SchedulePage.tsx` (modify) | the "Day map" anchor |
| `app/shell/App.tsx` (modify) | the top-level route |
| `tsconfig.json`, `package.json`, `.env.example` (modify) | `google.maps` types, the dev dependency, the browser key line |
| `tests/scheduling/fakeGoogleMaps.ts` (create) | the fake namespace every map test injects |
| tests | named per task |
| docs | Task 13 |

---

### Task 1: The seam's grid call

**Files:**
- Modify: `domain/shared/routing.ts`
- Modify: `app/api/_middleware/routing/google.ts`
- Modify: `app/api/_middleware/routing/straight-line.ts`
- Test: `domain/shared/routing.test.ts`, `app/api/_middleware/routing/seam.test.ts`

**Interfaces:**
- Consumes: `straightLineSeconds`, `DriveEstimate`, `DriveFactors`, `GeoPoint`, `RoutingUnavailableError` (all already in `domain/shared/routing.ts`).
- Produces: `RoutingProvider.driveGrid(origins, destinations, departAt, factors): Promise<DriveEstimate[][]>`; `GRID_MAX_ELEMENTS = 625`; `straightLineGrid(origins, destinations, departAt, factors, timeZone): DriveEstimate[][]`.

- [ ] **Step 1: Write the failing test for the fallback's grid**

Append to `domain/shared/routing.test.ts` (imports: add `straightLineGrid` and `GRID_MAX_ELEMENTS` to the existing import list):

```ts
describe('straightLineGrid', () => {
  it('answers every origin to every destination, zero on the diagonal, labelled straight-line', () => {
    const grid = straightLineGrid([DUBAI, ABU_DHABI], [DUBAI, ABU_DHABI], MONDAY_1300, FACTORS, ZONE);
    expect(grid).toHaveLength(2);
    expect(grid[0]).toHaveLength(2);
    expect(grid[0]?.[0]).toEqual({ seconds: 0, metres: 0, source: 'straight-line' });
    expect(grid[1]?.[1]).toEqual({ seconds: 0, metres: 0, source: 'straight-line' });
    // Symmetric off the diagonal: the straight line has no direction.
    expect(grid[0]?.[1]).toEqual(grid[1]?.[0]);
    expect(grid[0]?.[1]?.seconds).toBeGreaterThan(0);
    expect(grid[0]?.[1]?.source).toBe('straight-line');
  });

  it('names the vendor ceiling on one call', () => {
    expect(GRID_MAX_ELEMENTS).toBe(625);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run domain/shared/routing.test.ts`
Expected: FAIL, `straightLineGrid` is not exported.

- [ ] **Step 3: Add the interface member and the arithmetic**

In `domain/shared/routing.ts`, add to `RoutingProvider` after `driveMatrix`:

```ts
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
```

Add after `straightLineMatrix`:

```ts
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
```

In `app/api/_middleware/routing/straight-line.ts`, import `straightLineGrid` and add to the returned object:

```ts
    driveGrid: (origins, destinations, departAt, factors) =>
      Promise.resolve(straightLineGrid(origins, destinations, departAt, factors, options.timeZone)),
```

- [ ] **Step 4: Run the domain test; it passes. Then write the failing seam tests for the real implementation**

Append inside `describe('the real implementation, against a fake fetch', …)` in `seam.test.ts` (imports: add `GRID_MAX_ELEMENTS` from the domain file):

```ts
  it('asks a grid for every origin and every destination in one call, and reads each cell by its two indexes', async () => {
    let sent: Record<string, unknown> = {};
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      now: BEFORE_DEPART,
      fetchImpl: fakeFetch((_url, init) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json([
          { originIndex: 1, destinationIndex: 0, duration: '1600s', distanceMeters: 18500 },
          { originIndex: 0, destinationIndex: 0, duration: '0s', distanceMeters: 0 },
          { originIndex: 1, destinationIndex: 1, duration: '0s', distanceMeters: 0 },
          { originIndex: 0, destinationIndex: 1, duration: '1500s', distanceMeters: 18000 },
        ]);
      }),
    });
    const grid = await routing.driveGrid([DUBAI, SHARJAH], [DUBAI, SHARJAH], DEPART, FACTORS);
    expect((sent.origins as unknown[]).length).toBe(2);
    expect((sent.destinations as unknown[]).length).toBe(2);
    expect(sent.departureTime).toBe('2026-09-07T04:00:00.000Z');
    expect(grid[0]?.[1]).toEqual({ seconds: 1500, metres: 18000, source: 'traffic' });
    expect(grid[1]?.[0]).toEqual({ seconds: 1600, metres: 18500, source: 'traffic' });
    expect(grid[0]?.[0]?.seconds).toBe(0);
  });

  it('refuses a grid past the vendor ceiling before sending anything', async () => {
    const fetchImpl = vi.fn();
    const routing = googleRouting({ apiKey: FAKE_KEY, timeZone: ZONE, fetchImpl });
    const many = Array.from({ length: 26 }, (_, i) => ({ lat: 25 + i * 0.01, lng: 55 }));
    await expect(routing.driveGrid(many, many, DEPART, FACTORS)).rejects.toBeInstanceOf(
      RoutingUnavailableError,
    );
    expect(26 * 26).toBeGreaterThan(GRID_MAX_ELEMENTS);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a grid with a cell the vendor could not answer', async () => {
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      fetchImpl: fakeFetch(() =>
        Response.json([
          { originIndex: 0, destinationIndex: 0, duration: '0s', distanceMeters: 0 },
          { originIndex: 0, destinationIndex: 1, condition: 'ROUTE_NOT_FOUND' },
          { originIndex: 1, destinationIndex: 0, duration: '900s', distanceMeters: 9000 },
          { originIndex: 1, destinationIndex: 1, duration: '0s', distanceMeters: 0 },
        ]),
      ),
    });
    await expect(
      routing.driveGrid([DUBAI, SHARJAH], [DUBAI, SHARJAH], DEPART, FACTORS),
    ).rejects.toBeInstanceOf(RoutingUnavailableError);
  });
```

And inside `describe('the fallback', …)`:

```ts
  it('answers a grid with no network, labelled straight-line', async () => {
    const routing = straightLineRouting({ timeZone: ZONE });
    const grid = await routing.driveGrid([DUBAI], [DUBAI, SHARJAH], DEPART, FACTORS);
    expect(grid).toHaveLength(1);
    expect(grid[0]?.map((cell) => cell.source)).toEqual(['straight-line', 'straight-line']);
    expect(grid[0]?.[0]?.seconds).toBe(0);
  });
```

- [ ] **Step 5: Run the seam test to verify the new cases fail**

Run: `pnpm exec vitest run app/api/_middleware/routing/seam.test.ts`
Expected: the four new cases FAIL (`driveGrid` is not a function on the Google implementation).

- [ ] **Step 6: Implement the grid in `google.ts`**

Extract the fetch-and-parse from `driveMatrix` into a helper inside `googleRouting`, and add `driveGrid`. Import `GRID_MAX_ELEMENTS` from the domain file. The helper:

```ts
  /** One compute-route-matrix call: the body in, the vendor's elements out, everything else an outage. */
  async function askMatrix(body: unknown): Promise<MatrixElement[]> {
    const response = await call(ROUTE_MATRIX_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': options.apiKey,
        'x-goog-fieldmask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
      },
      body: JSON.stringify(body),
    });
    let elements: unknown;
    try {
      elements = await response.json();
    } catch (cause) {
      throw new RoutingUnavailableError('The routing vendor answered something else.', { cause });
    }
    if (!Array.isArray(elements)) {
      throw new RoutingUnavailableError('The routing vendor answered something else.');
    }
    return elements as MatrixElement[];
  }

  function waypoint(point: GeoPoint) {
    return { waypoint: { location: { latLng: { latitude: point.lat, longitude: point.lng } } } };
  }

  /** The vendor's answer for one cell, or an outage: a figure is never invented. */
  function estimateOf(element: MatrixElement | undefined): DriveEstimate {
    const seconds = secondsFrom(element?.duration);
    if (seconds === null || element?.condition === 'ROUTE_NOT_FOUND') {
      throw new RoutingUnavailableError('The routing vendor found no route between two places.');
    }
    return { seconds, metres: Math.max(0, Math.round(element?.distanceMeters ?? 0)), source: 'traffic' };
  }
```

`driveMatrix` keeps its behaviour, now written as: build `body` (origins with `routeModifiers: { avoidFerries: true }` spread over `waypoint(leg.from)`, destinations `waypoint(leg.to)`, `travelMode`, `routingPreference`, the `departureTime` rule), `const elements = await askMatrix(body)`, collect the diagonal into `answers`, and `return legs.map((_, index) => estimateOf(answers.get(index)))`. Keep the existing comments. Then:

```ts
    async driveGrid(origins, destinations, departAt): Promise<DriveEstimate[][]> {
      if (origins.length === 0 || destinations.length === 0) return origins.map(() => []);
      if (origins.length * destinations.length > GRID_MAX_ELEMENTS) {
        throw new RoutingUnavailableError('That is more places than one grid can hold.');
      }
      const inFuture = departAt.getTime() > now().getTime();
      const body = {
        origins: origins.map((point) => ({ ...waypoint(point), routeModifiers: { avoidFerries: true } })),
        destinations: destinations.map(waypoint),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        ...(inFuture ? { departureTime: departAt.toISOString() } : {}),
      };
      const elements = await askMatrix(body);
      // Every cell, by both indexes: the vendor answers in any order.
      const cells = new Map<string, MatrixElement>();
      for (const element of elements) {
        if (element.originIndex !== undefined && element.destinationIndex !== undefined) {
          cells.set(`${element.originIndex}:${element.destinationIndex}`, element);
        }
      }
      return origins.map((_, i) => destinations.map((_, j) => estimateOf(cells.get(`${i}:${j}`))));
    },
```

- [ ] **Step 7: Run both test files and the typecheck**

Run: `pnpm exec vitest run domain/shared/routing.test.ts app/api/_middleware/routing/seam.test.ts && pnpm exec tsc --noEmit -p .`
Expected: PASS, and the typecheck reports that `TodayPage.test.tsx`'s fake routing (if any) or any object literal typed `RoutingProvider` lacks `driveGrid` — search `grep -rn "kind: 'straight-line'\|kind: 'google'" app tests | grep -v _middleware` and give each fake a `driveGrid: async () => []`.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write domain/shared/routing.ts app/api/_middleware/routing/*.ts domain/shared/routing.test.ts
git add domain/shared/routing.ts domain/shared/routing.test.ts app/api/_middleware/routing/
git commit -m "feat(routing): the seam answers a grid of drives, at most 625 elements a call"
```

---

### Task 2: The quarter hour and the travel buffer

**Files:**
- Create: `domain/scheduling/grid.ts`, `domain/scheduling/grid.test.ts`
- Create: `domain/scheduling/buffer.ts`, `domain/scheduling/buffer.test.ts`
- Modify: `domain/scheduling/index.ts`

**Interfaces:**
- Produces: `ceilToQuarterHour(at: Date): Date`; `travelBufferFor(driveSeconds: number): number`; `MIN_TRAVEL_BUFFER_MINUTES = 15`, `MAX_TRAVEL_BUFFER_MINUTES = 90`, `BUFFER_ALLOWANCE_MINUTES = 10`.

- [ ] **Step 1: Write the failing tests**

`domain/scheduling/grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ceilToQuarterHour } from './grid';

/** Asia/Dubai is UTC+4 with no daylight saving: a quarter hour there is a quarter hour in UTC. */
describe('ceilToQuarterHour', () => {
  it('leaves a quarter hour where it is', () => {
    const at = new Date('2026-09-07T05:15:00Z');
    expect(ceilToQuarterHour(at).toISOString()).toBe('2026-09-07T05:15:00.000Z');
  });
  it('rounds up, never down', () => {
    expect(ceilToQuarterHour(new Date('2026-09-07T05:15:00.001Z')).toISOString()).toBe(
      '2026-09-07T05:30:00.000Z',
    );
    expect(ceilToQuarterHour(new Date('2026-09-07T05:52:30Z')).toISOString()).toBe(
      '2026-09-07T06:00:00.000Z',
    );
  });
});
```

`domain/scheduling/buffer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { travelBufferFor } from './buffer';

/** Scheduling rule 6.2: the drive in whole minutes, rounded up, plus ten, clamped to 15–90. */
describe('travelBufferFor', () => {
  it('is the drive plus ten, in whole minutes rounded up', () => {
    expect(travelBufferFor(25 * 60)).toBe(35);
    expect(travelBufferFor(25 * 60 + 1)).toBe(36);
  });
  it('never drops below fifteen', () => {
    expect(travelBufferFor(0)).toBe(15);
    expect(travelBufferFor(3 * 60)).toBe(15);
    expect(travelBufferFor(-5)).toBe(15);
  });
  it('never exceeds ninety', () => {
    expect(travelBufferFor(3 * 3600)).toBe(90);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run domain/scheduling/grid.test.ts domain/scheduling/buffer.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`domain/scheduling/grid.ts`:

```ts
/**
 * The next quarter hour at or after `at` (docs/SPEC/route-planning.md 5.4).
 * Asia/Dubai has a whole-hour offset and no daylight saving, so a quarter
 * hour in the practice's zone is a quarter hour in UTC: plain arithmetic,
 * no calendar. Pure.
 */
const QUARTER_MS = 15 * 60_000;

export function ceilToQuarterHour(at: Date): Date {
  return new Date(Math.ceil(at.getTime() / QUARTER_MS) * QUARTER_MS);
}
```

`domain/scheduling/buffer.ts`:

```ts
/**
 * The travel buffer after a visit (docs/SPEC/scheduling-manual.md rule 6.2):
 * the estimated drive to whatever comes next, in whole minutes rounded up,
 * plus ten, never under fifteen and never over ninety — the same bounds
 * `appointment_travel_buffer_range` keeps in the database. Pure.
 */
export const MIN_TRAVEL_BUFFER_MINUTES = 15;
export const MAX_TRAVEL_BUFFER_MINUTES = 90;
export const BUFFER_ALLOWANCE_MINUTES = 10;

export function travelBufferFor(driveSeconds: number): number {
  const minutes = Math.ceil(Math.max(0, driveSeconds) / 60) + BUFFER_ALLOWANCE_MINUTES;
  return Math.min(MAX_TRAVEL_BUFFER_MINUTES, Math.max(MIN_TRAVEL_BUFFER_MINUTES, minutes));
}
```

Add to `domain/scheduling/index.ts`:

```ts
export { ceilToQuarterHour } from './grid';
export {
  BUFFER_ALLOWANCE_MINUTES,
  MAX_TRAVEL_BUFFER_MINUTES,
  MIN_TRAVEL_BUFFER_MINUTES,
  travelBufferFor,
} from './buffer';
```

- [ ] **Step 4: Run the tests; they pass. Commit**

```bash
pnpm exec prettier --write domain/scheduling/grid.ts domain/scheduling/grid.test.ts domain/scheduling/buffer.ts domain/scheduling/buffer.test.ts domain/scheduling/index.ts
git add domain/scheduling/grid.ts domain/scheduling/grid.test.ts domain/scheduling/buffer.ts domain/scheduling/buffer.test.ts domain/scheduling/index.ts
git commit -m "feat(scheduling): the quarter hour and the travel-buffer rule, pure and tested"
```

---

### Task 3: The rule — `optimiseDay`

**Files:**
- Create: `domain/scheduling/optimise.ts`, `domain/scheduling/optimise.test.ts`
- Modify: `domain/scheduling/index.ts`

**Interfaces:**
- Consumes: `ceilToQuarterHour` (Task 2), `travelBufferFor`, `MIN_TRAVEL_BUFFER_MINUTES` (Task 2), `windowFor` (`./window`), `GeoPoint` (`./navigation`), `AppointmentStatus` (`./status`), `DriveEstimate`, `DriveSource` (`../shared/routing`, imported by path — the shared barrel does not export routing).
- Produces: the types and function below, all exported from the scheduling barrel.

**One refinement of the spec, recorded here and in Task 13's spec amendment:** the day's end is the **last stop's departure** (planned arrival plus the service's duration), not the arrival home; the return leg still counts in the driving sum when a base is recorded. With the return in the end time, almost every better order was refused for "ending later", because the far household ends up last. And a movable stop **keeps its current window when the new arrival still falls inside it** — fewer households moved for the same driving.

- [ ] **Step 1: Write the failing tests**

`domain/scheduling/optimise.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Matrix, PlanStop } from './optimise';
import { MAX_PLAN_STOPS, optimiseDay } from './optimise';

/**
 * The optimised day (docs/SPEC/route-planning.md 5.4). Four synthetic places:
 * a base B, two households near it (L1, L3, five minutes apart) and one far
 * away (L2). Seconds between them are fixed by the table below; metres are
 * ten times the seconds. Dubai is UTC+4: "09:00" here is 05:00Z.
 */
const SECONDS: Record<string, number> = {
  'B:L1': 600,
  'B:L2': 3000,
  'B:L3': 900,
  'L1:L2': 2700,
  'L1:L3': 300,
  'L2:L3': 2400,
};

const matrix: Matrix = (from, to) => {
  if (from === to) return { seconds: 0, metres: 0, source: 'traffic' };
  const seconds = SECONDS[`${from}:${to}`] ?? SECONDS[`${to}:${from}`];
  if (seconds === undefined) throw new Error(`no leg between ${from} and ${to}`);
  return { seconds, metres: seconds * 10, source: 'traffic' };
};

const straightLine: Matrix = (from, to, at) => ({ ...matrix(from, to, at), source: 'straight-line' });

const BASE = { locationId: 'B', point: { lat: 25.2, lng: 55.27 } };
/** The evening before: every stop is comfortably ahead of now plus an hour. */
const NOW = new Date('2026-09-06T12:00:00Z');

function dubai(hhmm: string): Date {
  return new Date(`2026-09-07T${hhmm}:00+04:00`);
}

function stop(id: string, start: string, status: PlanStop['status'] = 'proposed'): PlanStop {
  return {
    id,
    status,
    windowStart: dubai(start),
    windowEnd: new Date(dubai(start).getTime() + 45 * 60_000),
    durationMinutes: 60,
    travelBufferMinutes: 15,
    locationId: id,
    point: { lat: 25.2, lng: 55.27 },
  };
}

describe('optimiseDay', () => {
  it('finds the order that drives least, ties broken by the fewer households moved', () => {
    // Far first, then near, then near: 6,900 seconds with the drive home.
    const plan = optimiseDay(
      { stops: [stop('L2', '09:00'), stop('L1', '10:30'), stop('L3', '12:00')], homeBase: BASE, now: NOW },
      matrix,
    );
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    // Two orders drive 6,300; L2, L3, L1 moves two households, L1, L3, L2 moves three.
    expect(plan.stops.map((s) => s.id)).toEqual(['L2', 'L3', 'L1']);
    expect(plan.before.driveSeconds).toBe(6900);
    expect(plan.after.driveSeconds).toBe(6300);
    expect(plan.savedSeconds).toBe(600);
    expect(plan.after.driveMetres).toBe(63000);
    expect(plan.source).toBe('traffic');
    const [l2, l3, l1] = plan.stops;
    expect(l2?.moved).toBe(false);
    expect(l2?.windowStart.toISOString()).toBe('2026-09-07T05:00:00.000Z');
    // Leaves L2 at 10:00, forty minutes to L3: 10:40, on the quarter hour 10:45.
    expect(l3?.windowStart.toISOString()).toBe('2026-09-07T06:45:00.000Z');
    expect(l3?.windowEnd.toISOString()).toBe('2026-09-07T07:30:00.000Z');
    expect(l3?.moved).toBe(true);
    // Leaves L3 at 11:45, five minutes to L1: 11:50, so 12:00.
    expect(l1?.windowStart.toISOString()).toBe('2026-09-07T08:00:00.000Z');
    // The day ends when the last visit does, 13:00, exactly as it did before.
    expect(plan.after.dayEnd.toISOString()).toBe('2026-09-07T09:00:00.000Z');
    expect(plan.before.dayEnd.toISOString()).toBe('2026-09-07T09:00:00.000Z');
    // Rule 6.2 on the moved stops: five minutes to L1 is the floor of fifteen; the last keeps fifteen.
    expect(l3?.travelBufferMinutes).toBe(15);
    expect(l1?.travelBufferMinutes).toBe(15);
    expect(l2?.travelBufferMinutes).toBe(15);
  });

  it('marks anchors and never moves them, and a confirmed visit can hold the whole day', () => {
    const plan = optimiseDay(
      {
        stops: [stop('L2', '09:00'), stop('L1', '10:30', 'confirmed'), stop('L3', '12:00')],
        homeBase: BASE,
        now: NOW,
      },
      matrix,
    );
    // Every other order either misses L1's window or ends the day later.
    expect(plan).toEqual({ kind: 'refusal', reason: 'no_improvement' });
  });

  it('treats a proposed visit within the hour, or behind, as an anchor', () => {
    const soon = new Date(dubai('09:00').getTime() - 30 * 60_000);
    const plan = optimiseDay(
      { stops: [stop('L2', '09:00'), stop('L1', '10:30', 'checked_in')], homeBase: BASE, now: soon },
      matrix,
    );
    expect(plan).toEqual({ kind: 'refusal', reason: 'nothing_to_move' });
  });

  it('refuses more than ten stops', () => {
    const stops = Array.from({ length: MAX_PLAN_STOPS + 1 }, (_, i) =>
      stop(`L${i + 1}`, `0${Math.min(9, i)}:00`),
    );
    expect(optimiseDay({ stops, homeBase: null, now: NOW }, matrix)).toEqual({
      kind: 'refusal',
      reason: 'too_many_stops',
    });
  });

  it('says so when the current order already drives least', () => {
    // Windows that the drives already reach: L1 leaves at 10:00, L3 is five
    // minutes on and its window opens at 10:00, L2 is forty minutes after L3.
    const plan = optimiseDay(
      { stops: [stop('L1', '09:00'), stop('L3', '10:00'), stop('L2', '11:45')], homeBase: BASE, now: NOW },
      matrix,
    );
    expect(plan).toEqual({ kind: 'refusal', reason: 'no_improvement' });
  });

  it('works without a base, counting only the drives between stops', () => {
    const plan = optimiseDay(
      { stops: [stop('L2', '09:00'), stop('L1', '10:30'), stop('L3', '12:00')], homeBase: null, now: NOW },
      matrix,
    );
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    // L2 → L1 → L3 is 3,000; L2 → L3 → L1 is 2,700, and keeps L2 where it is.
    expect(plan.stops.map((s) => s.id)).toEqual(['L2', 'L3', 'L1']);
    expect(plan.after.driveSeconds).toBe(2700);
  });

  it('labels a plan by the source of every leg it used', () => {
    const plan = optimiseDay(
      { stops: [stop('L2', '09:00'), stop('L1', '10:30'), stop('L3', '12:00')], homeBase: BASE, now: NOW },
      straightLine,
    );
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.source).toBe('straight-line');
  });

  it('never starts the day earlier than now plus an hour, whatever the windows say', () => {
    const lateMorning = dubai('08:30');
    const plan = optimiseDay(
      { stops: [stop('L2', '10:00'), stop('L1', '11:30'), stop('L3', '13:00')], homeBase: BASE, now: lateMorning },
      matrix,
    );
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    for (const planned of plan.stops) {
      expect(planned.windowStart.getTime()).toBeGreaterThanOrEqual(dubai('09:30').getTime());
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run domain/scheduling/optimise.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the rule**

`domain/scheduling/optimise.ts`:

```ts
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
export type Matrix = (fromLocationId: string, toLocationId: string, departAt: Date) => DriveEstimate;
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
export type PlanRefusalReason = 'nothing_to_move' | 'no_improvement' | 'infeasible' | 'too_many_stops';
export type PlanRefusal = { kind: 'refusal'; reason: PlanRefusalReason };

export const MAX_PLAN_STOPS = 10;
/** A proposed visit closer than this to now is not moved: somebody may already be on the road. */
export const MOVABLE_LEAD_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

export function isMovable(stop: PlanStop, now: Date): boolean {
  return (
    stop.status === 'proposed' && stop.windowStart.getTime() > now.getTime() + MOVABLE_LEAD_MS
  );
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
      const target = free ? new Date(Math.max(earliest.getTime(), stop.windowStart.getTime())) : stop.windowStart;
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
function* orderings(anchors: readonly PlanStop[], free: readonly PlanStop[]): Generator<PlanStop[]> {
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
  const before = walk(current, new Set<string>(), input, matrix, earliest, Number.POSITIVE_INFINITY);
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
```

Add to `domain/scheduling/index.ts`:

```ts
export { MAX_PLAN_STOPS, MOVABLE_LEAD_MS, isMovable, optimiseDay } from './optimise';
export type {
  DayInput,
  DayPlan,
  Matrix,
  PlanBase,
  PlanRefusal,
  PlanRefusalReason,
  PlanSource,
  PlanStop,
  PlannedStop,
  Totals,
} from './optimise';
```

- [ ] **Step 4: Run the test until every case passes**

Run: `pnpm exec vitest run domain/scheduling/optimise.test.ts`
Expected: PASS. If the first case picks `L1, L3, L2`, the tie-break on `moves` is not reached — check `moved` is computed against the stop's *own* current window. If "an anchor can hold the whole day" answers `infeasible`, check that the current order is evaluated with `movable` before the loop and that its walk is kept when its end is not later.

- [ ] **Step 5: Run the browser-bundle lint and the whole unit suite once**

Run: `pnpm exec vitest run tests/lint/no-node-imports-in-browser-bundle.test.ts domain/`
Expected: PASS (the rule imports nothing but the shared routing file, which is browser-safe).

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write domain/scheduling/optimise.ts domain/scheduling/optimise.test.ts domain/scheduling/index.ts
git add domain/scheduling/optimise.ts domain/scheduling/optimise.test.ts domain/scheduling/index.ts
git commit -m "feat(scheduling): optimiseDay, the order that drives least around the visits already agreed"
```

---

### Task 4: The estimates module — the cache, and a matrix filled from it

**Files:**
- Create: `app/api/routing/estimates.ts`
- Modify: `app/api/routing/day.ts` (remove what moved; import it instead)
- Test: the existing `tests/scheduling/db/today.test.ts` and `tests/session/db/*` must still pass unchanged

**Interfaces:**
- Consumes: `driveGrid`, `GRID_MAX_ELEMENTS`, `straightLineSeconds` (Task 1); `Matrix`, `PlanBase` (Task 3); `hourBucket`, `DriveFactors`, `DriveEstimate`, `RoutingProvider` (`domain/shared/routing`); `dayLegs`, `DayLeg` (`domain/scheduling/legs`).
- Produces: `FRESH_FOR_DAYS`, `PRACTICE_UTC_OFFSET`, `dayRange(date)`, `readFactors(db)`, `estimateLegs(db, legs, factors, routing, actorUserId)`, `Place`, `fillMatrix(db, places, buckets, date, factors, routing, actorUserId)`.

- [ ] **Step 1: Move the cache helpers out of `day.ts` unchanged**

Create `app/api/routing/estimates.ts` and move into it, verbatim with their comments: `PRACTICE_UTC_OFFSET`, `FRESH_FOR_DAYS`, `CACHED_SQL`, `WRITE_SQL`, `FACTORS_SQL`, `cacheKey`, `readFactors`, `estimateLegs`, and `dayRange` (which `day.ts` also uses). Export `PRACTICE_UTC_OFFSET`, `FRESH_FOR_DAYS`, `dayRange`, `readFactors` and `estimateLegs`; keep `cacheKey`, `CACHED_SQL` and `WRITE_SQL` module-private for now. Add the file's own header:

```ts
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
```

In `day.ts`, delete those declarations and import them:

```ts
import { dayRange, estimateLegs, readFactors } from './estimates';
```

`day.ts` keeps `endOfDay`, `STOPS_SQL`, `HOME_BASE_SQL`, `PRACTITIONER_SQL`, `toLegStop`, `point`, `readDay`, `toLegRow` and `mountRouting`. `endOfDay` now calls the imported `dayRange`.

- [ ] **Step 2: Run the existing suites to prove the move changed nothing**

Run: `pnpm exec tsc --noEmit -p . && pnpm exec vitest run --config vitest.db.config.ts tests/session/db 2>&1 | tail -20`
Expected: PASS. (If `tests/session/db` needs a database that is not up: `docker compose up -d --wait` first.)

- [ ] **Step 3: Write the matrix filler**

Append to `estimates.ts`:

```ts
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
```

Add the imports it needs at the top of `estimates.ts`:

```ts
import {
  GRID_MAX_ELEMENTS,
  hourBucket,
  straightLineSeconds,
  type DriveEstimate,
  type DriveFactors,
  type GeoPoint,
  type RoutingProvider,
} from '../../../domain/shared/routing';
import type { Matrix } from '../../../domain/scheduling/optimise';
import { isRoutingUnavailable, PRACTICE_TIME_ZONE } from '../_middleware/routing';
import type { Db } from '../_middleware/request-context';
```

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm exec tsc --noEmit -p .`

```bash
pnpm exec prettier --write app/api/routing/estimates.ts app/api/routing/day.ts
git add app/api/routing/estimates.ts app/api/routing/day.ts
git commit -m "refactor(routing): the cache in its own module, and a matrix the optimiser can walk"
```

---

### Task 5: The practice-day read and the optimise call

**Files:**
- Create: `app/api/routing/practice-day.ts`
- Modify: `app/api/routing/schema.ts`, `app/api/routing/day.ts` (mount), `domain/shared/actor.ts`
- Test: `tests/scheduling/db/practice_day.test.ts`

**Interfaces:**
- Consumes: `fillMatrix`, `readFactors`, `estimateLegs`, `dayRange`, `Place` (Task 4); `optimiseDay`, `MAX_PLAN_STOPS`, `PlanStop`, `PlanBase` (Task 3); `dayLegs` and `navigationTarget`.
- Produces: `mountPracticeDay(api, now)`; the wire shapes `PracticeDayResponse`, `OptimiseDayRequest`, `OptimiseDayResponse`.

- [ ] **Step 1: Add the actor action**

In `domain/shared/actor.ts`, add to the `Action` union beside `routing.day.read`:

```ts
  | { type: 'routing.practiceDay.read' }
```

and beside its case:

```ts
    case 'routing.practiceDay.read':
      // The whole practice's day on a map, and the plan that reorders it
      // (docs/SPEC/route-planning.md section 6). The calendar's own three
      // roles, exactly as `appointment.list` with scope 'practice': the map
      // shows the day the schedule already shows, drawn instead of listed.
      return hasRole(actor, 'owner', 'admin', 'lead_practitioner');
```

- [ ] **Step 2: Add the wire shapes**

Append to `app/api/routing/schema.ts`:

```ts
/**
 * A coordinate, declared here rather than imported from the appointments
 * schema: this file is the routing answer's own contract and a screen that
 * draws a map should not have to depend on the booking shapes to read it.
 */
const GeoPoint = z.object({ lat: z.number(), lng: z.number() });

/** One stop on the practice's day map: opaque ids, a coordinate and a window. Never a name. */
export const PracticeDayStop = z.object({
  appointmentId: z.uuid(),
  locationId: z.uuid(),
  point: GeoPoint,
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  status: z.string(),
});
export type PracticeDayStop = z.infer<typeof PracticeDayStop>;

export const PracticeDayPractitioner = z.object({
  practitionerId: z.uuid(),
  /** Where their day starts, when the practice records one. */
  homeBase: z.object({ locationId: z.uuid(), point: GeoPoint }).nullable(),
  /** In window order. */
  stops: z.array(PracticeDayStop),
  /** One per drive between consecutive places, in the same order. */
  legs: z.array(DayLegRow),
});
export type PracticeDayPractitioner = z.infer<typeof PracticeDayPractitioner>;

export const PracticeDayResponse = z.object({
  practitioners: z.array(PracticeDayPractitioner),
});
export type PracticeDayResponse = z.infer<typeof PracticeDayResponse>;

export const OptimiseDayRequest = z.object({
  date: z.iso.date(),
  practitionerId: z.uuid(),
});
export type OptimiseDayRequest = z.infer<typeof OptimiseDayRequest>;

export const PLAN_SOURCES = ['traffic', 'straight-line', 'mixed'] as const;
export const PLAN_REFUSALS = [
  'nothing_to_move',
  'no_improvement',
  'infeasible',
  'too_many_stops',
] as const;

export const PlanTotals = z.object({
  driveSeconds: z.number().int().min(0),
  driveMetres: z.number().int().min(0),
  dayEnd: z.iso.datetime(),
});

/** One visit in the plan, in the new order. `wasWindowStart` is what the reorder is checked against. */
export const PlannedStopRow = z.object({
  appointmentId: z.uuid(),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  wasWindowStart: z.iso.datetime(),
  travelBufferMinutes: z.number().int().min(15).max(90),
  moved: z.boolean(),
  anchor: z.boolean(),
});
export type PlannedStopRow = z.infer<typeof PlannedStopRow>;

export const OptimiseDayResponse = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('plan'),
    stops: z.array(PlannedStopRow),
    before: PlanTotals,
    after: PlanTotals,
    savedSeconds: z.number().int(),
    source: z.enum(PLAN_SOURCES),
  }),
  z.object({ kind: z.literal('refusal'), reason: z.enum(PLAN_REFUSALS) }),
]);
export type OptimiseDayResponse = z.infer<typeof OptimiseDayResponse>;
```

- [ ] **Step 3: Write the failing database test**

Create `tests/scheduling/db/practice_day.test.ts`, in the shape of `tests/scheduling/db/today.test.ts` (mint a token with `jose`, build the API with `createApi`, seed with `tests/db/helpers`). Use the `7100`-block of synthetic ids, distinct from every other file's. Seed: one tenant, one owner (auth), one practitioner with a **home base** location owned by the tenant, one finance user, one service type of 60 minutes, and three client households at three different synthetic coordinates with `proposed` visits at 09:00, 10:30 and 12:00 Dubai **two days ahead** (so nothing is inside the movable hour). Give the API a fake routing provider:

```ts
const seam = {
  kind: 'google' as const,
  describe: () => 'a fake seam',
  driveMatrix: async (legs: readonly { from: unknown; to: unknown }[]) =>
    legs.map(() => ({ seconds: 600, metres: 6000, source: 'traffic' as const })),
  driveGrid: async (origins: readonly unknown[], destinations: readonly unknown[]) =>
    origins.map((_, i) => destinations.map((__, j) => ({
      seconds: i === j ? 0 : 600,
      metres: i === j ? 0 : 6000,
      source: 'traffic' as const,
    }))),
  dayPicture: async () => null,
};
api = createApi({ pool, verifier, now: () => NOW, routing: seam });
```

The cases:

```ts
describe('GET /api/routing/practice-day', () => {
  it('answers every practitioner with a stop that day, their base, their stops and the drives between', async () => {
    const res = await get(AUTH_OWNER, `date=${DAY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PracticeDayResponse;
    expect(body.practitioners).toHaveLength(1);
    const [only] = body.practitioners;
    expect(only?.practitionerId).toBe(PRACTITIONER);
    expect(only?.homeBase?.locationId).toBe(BASE_LOCATION);
    expect(only?.stops.map((s) => s.appointmentId)).toEqual([APPT_FIRST, APPT_SECOND, APPT_THIRD]);
    // A leg per stop, the first from the base.
    expect(only?.legs).toHaveLength(3);
    expect(only?.legs[0]?.fromLocationId).toBe(BASE_LOCATION);
    expect(only?.legs.every((leg) => leg.source === 'traffic')).toBe(true);
  });

  it('names nobody: no client, no practitioner name, no address anywhere in the answer', async () => {
    const res = await get(AUTH_OWNER, `date=${DAY}`);
    const wire = JSON.stringify(await res.json()).toLowerCase();
    for (const forbidden of ['mrn', 'mw-', 'givenname', 'familyname', 'displayname', 'villa', 'makani']) {
      expect(wire).not.toContain(forbidden);
    }
  });

  it('refuses finance and a practitioner: the map is the calendar roles’', async () => {
    expect((await get(AUTH_FINANCE, `date=${DAY}`)).status).toBe(403);
    expect((await get(AUTH_PRACTITIONER, `date=${DAY}`)).status).toBe(403);
  });

  it('writes what the seam answered into the cache, and asks it no second time', async () => {
    await get(AUTH_OWNER, `date=${DAY}`);
    const before = await count('drive_estimate');
    expect(before).toBeGreaterThan(0);
    calls = 0;
    await get(AUTH_OWNER, `date=${DAY}`);
    expect(calls).toBe(0);
  });
});

describe('POST /api/routing/practice-day/optimise', () => {
  it('answers a plan whose order drives least, with the figures before and after', async () => {
    const res = await post(AUTH_OWNER, { date: DAY, practitionerId: PRACTITIONER });
    expect(res.status).toBe(200);
    const body = OptimiseDayResponse.parse(await res.json());
    expect(body.kind === 'plan' || body.kind === 'refusal').toBe(true);
    if (body.kind === 'refusal') {
      // Every drive costs the same in this fixture, so no order is better.
      expect(body.reason).toBe('no_improvement');
    }
  });

  it('refuses a caller without the calendar roles', async () => {
    expect((await post(AUTH_FINANCE, { date: DAY, practitionerId: PRACTITIONER })).status).toBe(403);
  });

  it('answers a plain refusal, never a 500, when the vendor is down', async () => {
    // A seam whose grid always throws: the fallback fills every leg.
    const res = await postWithBrokenSeam({ date: DAY, practitionerId: PRACTITIONER });
    expect(res.status).toBe(200);
    const body = OptimiseDayResponse.parse(await res.json());
    if (body.kind === 'plan') expect(body.source).toBe('straight-line');
  });
});
```

Make the third household's coordinate far from the other two and give the fake grid **distance-dependent** seconds (`Math.round(haversineMetres(a, b) / 10)`), so the "drives least" case can assert a real reordering; keep one fixture with equal drives for the `no_improvement` case. Track `calls` with a counter the fake increments.

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/scheduling/db/practice_day.test.ts`
Expected: FAIL — the routes 404.

- [ ] **Step 5: Write the routes**

Create `app/api/routing/practice-day.ts` with this header and shape:

```ts
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
```

The SQL:

```ts
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

const BASES_SQL =
  'select p.id as practitioner_id, l.id as location_id, ' +
  'extensions.st_x(l.entrance_point::extensions.geometry) as entrance_lng, ' +
  'extensions.st_y(l.entrance_point::extensions.geometry) as entrance_lat, ' +
  'extensions.st_x(l.parking_point::extensions.geometry) as parking_lng, ' +
  'extensions.st_y(l.parking_point::extensions.geometry) as parking_lat ' +
  'from practitioner p join location l on l.id = p.home_base_location_id ' +
  'where p.tenant_id = app.current_tenant_id() and l.tenant_id = app.current_tenant_id()';
```

`GET`: parse `date`; `canActor(actor, { type: 'routing.practiceDay.read' }, {}, now())` or 403; `c.get('routing')` or 503; read the stops and the bases; group by `practitioner_id`; per practitioner build `LegStop[]` (the `toLegStop` shape `day.ts` uses, exported from `day.ts` or duplicated locally — export it) and `HomeBase | null`; `dayLegs(stops, base)`; `estimateLegs(...)`; answer `PracticeDayResponse.parse({ practitioners })` with each stop's `point` from `navigationTarget`.

`POST`: parse the body; the same role check and seam check; read that practitioner's stops (filter the same rows by `practitioner_id`) and their base; if no stops, answer `{ kind: 'refusal', reason: 'nothing_to_move' }`; build `PlanStop[]`; build the places (each stop's `navigationTarget`, plus the base) **de-duplicated by `locationId`**; build the buckets from the day's first `window_start` hour to the last current departure hour plus two, capped at twelve hours, in the practice's zone; `const factors = await readFactors(db)`; `const matrix = await fillMatrix(db, places, buckets, date, factors, routing, actor.userId)`; `const plan = optimiseDay({ stops, homeBase, now: now() }, matrix)`; map to the wire shape, carrying each stop's own `wasWindowStart` from the row it came from. A `RoutingUnavailableError` escaping anything here is already turned into a clean 503 by `createApi`'s error handler, but `fillMatrix` swallows the outage, so in practice the answer is a straight-line plan.

Mount both from `mountRouting` in `day.ts`:

```ts
export function mountRouting(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountPracticeDay(api, now);
  // …the two existing routes, unchanged
```

- [ ] **Step 6: Run the test until it passes, then the whole database suite**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/scheduling/db/practice_day.test.ts`
Then: `pnpm exec vitest run --config vitest.db.config.ts tests/scheduling/db`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write app/api/routing/ domain/shared/actor.ts tests/scheduling/db/practice_day.test.ts
git add app/api/routing/ domain/shared/actor.ts tests/scheduling/db/practice_day.test.ts
git commit -m "feat(routing): the practice's day and its best order, computed and never applied"
```

---

### Task 6: The move, in pieces — and the reorder that applies a plan

**Files:**
- Create: `app/api/appointments/move-one.ts`
- Modify: `app/api/appointments/move.ts` (composes the pieces; behaviour unchanged)
- Create: `app/api/appointments/reorder.ts`
- Modify: `app/api/appointments/schema.ts`, `app/api/appointments/routes.ts`
- Test: `tests/scheduling/db/reorder.test.ts`; `tests/scheduling/db/move_and_cancel.test.ts` must still pass **unchanged**

**Interfaces:**
- Consumes: `checkConflicts`, `windowFor`, `CLIENT_OVERLAP_MESSAGE`, `PRACTITIONER_OVERLAP_MESSAGE` (`@domain/scheduling`); `canActor`, `hasRole`, `isoDateIn` (`@domain/shared`); `requiredConsentPurposes` (`./create`); `logRead`, `cleanText`.
- Produces from `move-one.ts`: `LIVE_STATUSES_EXCLUDED`, `EXCLUSION_VIOLATION`, `PRACTICE_TIME_ZONE`, `REASON_MAX`, types `AppointmentDbRow`/`ClientDbRow`/`CreatedRow`/`MoveContext`, and `readAppointment(db, id)`, `hasOpenSession(db, id)`, `readMoveContext(db, appointment, windowStart)`, `retire(db, id)`, `insertMoved(db, args)`, `exclusionConflict(error)`, `appointmentRow(appointment, client, created)`.
- Produces from `reorder.ts`: `mountAppointmentReorder(api, now)`.

**The rule this task exists to keep:** a refusal **returned** from a route commits its transaction; only a refusal **raised** rolls it back (`app/api/_middleware/request-context.ts`). So every check that can refuse a reorder happens before the first write, and anything that goes wrong after it is raised as an `HTTPException` carrying the 409 body — the shape `timedOut()` in `app/api/_middleware/security.ts` already uses.

- [ ] **Step 1: Extract the pieces, changing no behaviour**

Create `app/api/appointments/move-one.ts` and move into it, verbatim with their comments, from `move.ts`: `REASON_MAX`, `PRACTICE_TIME_ZONE`, `EXCLUSION_VIOLATION`, `LIVE_STATUSES_EXCLUDED`, `APPOINTMENT_SQL`, `OPEN_SESSION_SQL`, `CLIENT_SQL`, `CREDENTIALS_SQL`, `CONSENTS_SQL`, `RETIRE_SQL`, `INSERT_SQL`, the four row types and `toExisting`. Add its own header:

```ts
/**
 * One visit's move, in the pieces both callers need: the drawer's own
 * `POST /api/appointments/:id/move`, which moves one visit and answers, and
 * `POST /api/appointments/reorder`, which moves several inside one
 * transaction and must retire every old row before it takes any new slot
 * (docs/SPEC/route-planning.md section 5.7).
 *
 * The rule they share is `docs/SPEC/scheduling-manual.md` section 3: a move
 * is two rows, never an edited one. Nothing here decides *whether* a visit
 * may move — that is the route's, because the two routes refuse in different
 * shapes — and nothing here opens or closes a transaction.
 */
```

Then export these functions, each holding exactly the code `move.ts` runs today:

```ts
export async function readAppointment(db: Db, id: string): Promise<AppointmentDbRow | undefined>;
export async function hasOpenSession(db: Db, id: string): Promise<boolean>;

export type MoveContext = {
  client: ClientDbRow;
  assigneeCapabilities: Capability[];
  activeConsentPurposes: string[];
  practitionerAppointments: ExistingAppointment[];
  clientAppointments: ExistingAppointment[];
  /** The candidate's own calendar date: a credential is judged on the day of the visit. */
  on: IsoDate;
};
/** Everything the conflict check needs, read in the caller's own transaction. Null: the client is gone. */
export async function readMoveContext(
  db: Db,
  appointment: AppointmentDbRow,
  windowStart: Date,
): Promise<MoveContext | null>;

/** `proposed` or `confirmed` becomes `rescheduled`, freeing its slot. False: somebody else settled it first. */
export async function retire(db: Db, id: string): Promise<boolean>;

export async function insertMoved(
  db: Db,
  args: {
    tenantId: string;
    appointment: AppointmentDbRow;
    windowStart: Date;
    windowEnd: Date;
    travelBufferMinutes: number;
    status: AppointmentRow['status'];
    rescheduledFromId: string;
    createdBy: string;
  },
): Promise<CreatedRow | undefined>;

/** Which exclusion constraint a write hit, or null when the error is something else. */
export function exclusionConflict(error: unknown): 'client_overlap' | 'practitioner_overlap' | null;

/** The wire row both routes answer with. */
export function appointmentRow(
  appointment: AppointmentDbRow,
  client: ClientDbRow,
  created: CreatedRow,
): AppointmentRow;
```

`readMoveContext` runs the client, credentials, consents and two other-appointment queries `move.ts` runs today, in the same order, and calls `logRead(db, 'client', clientId, clientId)` exactly where `move.ts` calls it. Rewrite `move.ts` to call these, keeping every one of its own refusals, its `canActor` check, its `checkConflicts` call and its response builder where they are. **Nothing about the move route's behaviour changes.**

- [ ] **Step 2: Prove the extraction changed nothing**

Run: `pnpm exec tsc --noEmit -p . && pnpm exec vitest run --config vitest.db.config.ts tests/scheduling/db/move_and_cancel.test.ts`
Expected: PASS, with the test file untouched. If anything fails, the extraction is wrong — fix the extraction, never the test.

- [ ] **Step 3: Commit the refactor on its own**

```bash
pnpm exec prettier --write app/api/appointments/move.ts app/api/appointments/move-one.ts
git add app/api/appointments/move.ts app/api/appointments/move-one.ts
git commit -m "refactor(appointments): one visit's move in pieces two routes can compose"
```

- [ ] **Step 4: Add the reorder's wire shapes**

Append to `app/api/appointments/schema.ts`:

```ts
/**
 * Applying an optimised day (docs/SPEC/route-planning.md section 5.7). One
 * request, several moves, one transaction: every old row is retired before
 * any new slot is taken, so an order that swaps two visits is not refused by
 * the exclusion constraints for clashing with itself.
 *
 * `wasWindowStart` is the window the plan was computed against. A row whose
 * window has moved since — or which is no longer `proposed` — refuses the
 * whole request as `stale_plan`, rather than applying half a plan to a day
 * that has changed underneath it.
 */
export const ReorderRequest = z.object({
  date: z.iso.date(),
  practitionerId: z.uuid(),
  moves: z
    .array(
      z.object({
        appointmentId: z.uuid(),
        windowStart: z.iso.datetime(),
        wasWindowStart: z.iso.datetime(),
        travelBufferMinutes: z.number().int().min(15).max(90),
      }),
    )
    .min(1)
    .max(10),
});
export type ReorderRequest = z.infer<typeof ReorderRequest>;

export const ReorderResponse = z.object({
  /** The visits that now stand, in the order they were asked for. */
  appointments: z.array(AppointmentRow),
  /** What each replaced, so the screen can say what moved from where. */
  movedFrom: z.array(z.object({ id: z.uuid(), windowStart: z.iso.datetime() })),
});
export type ReorderResponse = z.infer<typeof ReorderResponse>;

/** Why a reorder was refused before anything was written. */
export const REORDER_ACTION_CODES = [
  'invalid_request',
  'reason_required',
  'appointment_not_found',
  'appointment_settled',
  'session_open',
  // The day moved while the plan was on screen: a window, a status or a
  // session is no longer what the plan was computed against.
  'stale_plan',
] as const;
export type ReorderActionCode = (typeof REORDER_ACTION_CODES)[number];
```

- [ ] **Step 5: Write the failing database test**

Create `tests/scheduling/db/reorder.test.ts` in the shape of `move_and_cancel.test.ts`, with the `8100` block of ids. Seed one tenant, an owner (auth), a finance user (auth), a practitioner with a credential, three active clients with consents (`participation`, `home_visit`) and locations, and three `proposed` visits **three days ahead** at 09:00, 10:30 and 12:00 Dubai. The cases:

```ts
describe('POST /api/appointments/reorder', () => {
  it('swaps two visits in one transaction: three rows retired, three standing, each linked to what it replaced', async () => {
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments/reorder', {
      date: DAY,
      practitionerId: PRACTITIONER,
      moves: [
        { appointmentId: APPT_A, windowStart: iso('12:00'), wasWindowStart: iso('09:00'), travelBufferMinutes: 20 },
        { appointmentId: APPT_C, windowStart: iso('09:00'), wasWindowStart: iso('12:00'), travelBufferMinutes: 25 },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReorderResponse;
    expect(body.appointments).toHaveLength(2);
    expect(body.movedFrom.map((m) => m.id)).toEqual([APPT_A, APPT_C]);
    expect((await statusOf(APPT_A)).status).toBe('rescheduled');
    expect((await statusOf(APPT_C)).status).toBe('rescheduled');
    // The window each household was promised is still on the row it was promised on.
    expect((await statusOf(APPT_A)).window_start.toISOString()).toBe(iso('09:00'));
    const standing = await rowsFor(PRACTITIONER, DAY);
    expect(standing.filter((r) => r.status === 'proposed')).toHaveLength(3);
    for (const row of body.appointments) expect(row.status).toBe('proposed');
    expect(await linkedFrom(body.appointments[0]!.id)).toBe(APPT_A);
  });

  it('records the reason on every row it writes', async () => {
    // …reorder two visits, then read audit_log for the two new appointment ids
    expect(reasons).toEqual([REASON, REASON]);
  });

  it('refuses without a reason, and writes nothing', async () => {
    const before = await proposedWindows();
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments/reorder', validBody, null);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('reason_required');
    expect(await proposedWindows()).toEqual(before);
  });

  it('refuses a plan computed against a window that has since moved, and writes nothing', async () => {
    const before = await proposedWindows();
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments/reorder', {
      ...validBody,
      moves: [{ ...validBody.moves[0], wasWindowStart: iso('08:00') }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('stale_plan');
    expect(await proposedWindows()).toEqual(before);
  });

  it('refuses a visit the household has already been told about', async () => {
    // APPT_CONFIRMED is `confirmed`: an anchor, never in a plan's moves.
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments/reorder', {
      ...validBody,
      moves: [{ appointmentId: APPT_CONFIRMED, windowStart: iso('14:00'), wasWindowStart: iso('13:00'), travelBufferMinutes: 15 }],
    });
    expect(res.status).toBe(409);
  });

  it('rolls the whole thing back when one new window clashes with a visit outside the plan', async () => {
    const before = await proposedWindows();
    // APPT_OTHER belongs to the same practitioner and is not in the moves;
    // the second move lands on top of it.
    const res = await call(AUTH.ownerA, 'POST', '/api/appointments/reorder', {
      date: DAY,
      practitionerId: PRACTITIONER,
      moves: [
        { appointmentId: APPT_A, windowStart: iso('12:00'), wasWindowStart: iso('09:00'), travelBufferMinutes: 20 },
        { appointmentId: APPT_C, windowStart: OTHER_WINDOW, wasWindowStart: iso('12:00'), travelBufferMinutes: 15 },
      ],
    });
    expect(res.status).toBe(409);
    // Nothing retired, nothing inserted: the transaction rolled back whole.
    expect(await proposedWindows()).toEqual(before);
    expect((await statusOf(APPT_A)).status).toBe('proposed');
  });

  it('refuses a caller who is not the calendar', async () => {
    expect((await call(AUTH_FINANCE, 'POST', '/api/appointments/reorder', validBody)).status).toBe(403);
    expect((await call(AUTH.practitionerA, 'POST', '/api/appointments/reorder', validBody)).status).toBe(403);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/scheduling/db/reorder.test.ts`
Expected: FAIL — the route 404s.

- [ ] **Step 7: Write the route**

Create `app/api/appointments/reorder.ts`:

```ts
/**
 * `POST /api/appointments/reorder` — several visits of one practitioner's day
 * moved to new windows in one transaction, which is how the day map applies
 * an optimised order (docs/SPEC/route-planning.md section 5.7).
 *
 * **Every old row is retired before any new one is inserted.** The exclusion
 * constraints in 200_appointment.sql hold every live appointment apart, so
 * inserting the first new row while the second old one still held its slot
 * would refuse most reorders for clashing with themselves. `rescheduled` is
 * outside the constraint's own WHERE, so retiring frees the slot.
 *
 * **Every check that can refuse happens before the first write.** A refusal
 * this route *returns* commits its transaction (the rule
 * app/api/_middleware/request-context.ts states); only one it *raises* rolls
 * back. So the reads and their refusals come first, and anything that goes
 * wrong after the first retire is raised as an HTTPException carrying the
 * same 409 body — the shape `timedOut()` uses in
 * app/api/_middleware/security.ts.
 *
 * **It moves and nothing else.** It does not book, cancel, reassign, or move
 * a visit a household has been told about: every row it touches is
 * `proposed`, which is the whole of what the plan is allowed to reorder.
 * The households still have to be told nothing, because nobody has been told
 * anything: that is what `proposed` means (scheduling-manual.md section 3).
 */
```

Body, in order: the calendar role or 403; a non-empty `x-reason` (`cleanText(..., REASON_MAX)`) or 400 `reason_required`; `ReorderRequest.safeParse` or 400 `invalid_request`; no repeated `appointmentId` or 400 `invalid_request`. Then **phase one, reads only** — for each move: `readAppointment`; 404 `appointment_not_found` when absent; 400 `invalid_request` when its `practitioner_id` is not the body's; 409 `stale_plan` when the status is not `proposed`, when `window_start` differs from `wasWindowStart`, or when `hasOpenSession`; `readMoveContext` or 404; `canActor(actor, { type: 'appointment.create', practitionerId, serviceTypeId, on }, { assigneeCapabilities }, now())` or 403. Collect the rows and their contexts.

Then **phase two, writes only**, each failure raised:

```ts
  const conflictBody = (code: 'client_overlap' | 'practitioner_overlap') => ({
    error: 'conflict',
    issues: [
      {
        code,
        message: code === 'client_overlap' ? CLIENT_OVERLAP_MESSAGE : PRACTITIONER_OVERLAP_MESSAGE,
        conflictsWithAppointmentId: null,
      },
    ],
    requestId,
  });
  /** After the first write, a refusal must roll the transaction back, so it is raised. */
  function raise(status: 409, body: unknown): never {
    throw new HTTPException(status, {
      res: new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    });
  }

  for (const { move } of planned) {
    if (!(await retire(db, move.appointmentId))) {
      raise(409, { error: 'conflict', code: 'stale_plan', requestId });
    }
  }

  const appointments: AppointmentRow[] = [];
  const movedFrom: { id: string; windowStart: string }[] = [];
  for (const { move, appointment, context } of planned) {
    const windowStart = new Date(move.windowStart);
    const { end: windowEnd } = windowFor(windowStart);
    // The other live rows are re-read per visit, so each new row is checked
    // against the ones already inserted in this same transaction as well as
    // against everything outside the plan. The retired rows are `rescheduled`
    // and so are already out of the way.
    const fresh = await readMoveContext(db, appointment, windowStart);
    if (fresh === null) raise(409, { error: 'conflict', code: 'stale_plan', requestId });
    const report = checkConflicts(
      {
        practitionerId: appointment.practitioner_id,
        clientId: appointment.client_id,
        serviceTypeId: appointment.service_type_id,
        windowStart,
        windowEnd,
        travelBufferMinutes: move.travelBufferMinutes,
        on: fresh.on,
      },
      {
        practitionerAppointments: fresh.practitionerAppointments,
        clientAppointments: fresh.clientAppointments,
        practitionerCredentials: fresh.assigneeCapabilities,
        clientActive: fresh.client.status === 'active',
        requiredConsentPurposes: requiredConsentPurposes(
          appointment.delivery_mode,
          fresh.client.date_of_birth,
          fresh.on,
        ),
        activeConsentPurposes: fresh.activeConsentPurposes,
      },
    );
    const blocking = report.blocking[0];
    if (blocking) {
      raise(409, {
        error: 'conflict',
        issues: report.blocking.map((issue) => ({
          code: issue.code,
          message: issue.message,
          conflictsWithAppointmentId: issue.conflictsWithAppointmentId ?? null,
        })),
        requestId,
      });
    }
    let created;
    try {
      created = await insertMoved(db, {
        tenantId: actor.tenantId,
        appointment,
        windowStart,
        windowEnd,
        travelBufferMinutes: move.travelBufferMinutes,
        status: 'proposed',
        rescheduledFromId: move.appointmentId,
        createdBy: actor.userId,
      });
    } catch (error) {
      const code = exclusionConflict(error);
      if (code === null) throw error;
      raise(409, conflictBody(code));
    }
    if (!created) raise(409, { error: 'conflict', code: 'stale_plan', requestId });
    appointments.push(appointmentRow(appointment, fresh.client, created));
    movedFrom.push({ id: move.appointmentId, windowStart: appointment.window_start.toISOString() });
  }
  return c.json(ReorderResponse.parse({ appointments, movedFrom }));
```

Mount it in `routes.ts` beside `mountAppointmentMove`.

- [ ] **Step 8: Run the test until it passes, then the whole scheduling database suite**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/scheduling/db`
Expected: PASS, `move_and_cancel.test.ts` included and unedited.

- [ ] **Step 9: Commit**

```bash
pnpm exec prettier --write app/api/appointments/ tests/scheduling/db/reorder.test.ts
git add app/api/appointments/ tests/scheduling/db/reorder.test.ts
git commit -m "feat(appointments): a plan applied as moves, retired first and rolled back whole"
```

---

### Task 7: One document, one wider policy

**Files:**
- Modify: `app/api/_middleware/security.ts`, `app/api/_middleware/request-context.ts`, `app/api/serve-app.ts`, `app/api/create-api.ts`
- Test: `tests/security/headers.test.ts`, `tests/security/static.test.ts`

**Interfaces:**
- Produces: `securityHeaders(appEnv, { supabaseUrl?, mapDocumentPaths? })`; `MAP_DOCUMENT_PATHS = ['/admin/schedule/map']`; `ApiEnv.Variables.cspNonce: string | undefined`; `mountApp` stamping the shell.

**Why this shape.** Google's Maps JavaScript API needs `'strict-dynamic'`, `'unsafe-eval'` and four of its own hosts — directives the console's policy refuses and should go on refusing. So exactly one document gets the wider policy, chosen by its path, and the shell it serves carries a per-response nonce. Everything else, the phone app included, keeps the policy `tests/security/headers.test.ts` already pins.

- [ ] **Step 1: Write the failing tests**

In `tests/security/headers.test.ts`, add a describe block:

```ts
describe('the day map document, and only it', () => {
  const withMap = { ...deps, mapDocumentPaths: ['/admin/schedule/map'] };

  it('carries the wider policy Google needs, with a nonce, on that one path', async () => {
    const res = await createApi(withMap).request('/admin/schedule/map');
    const csp = res.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
    expect(nonce, csp).toBeTruthy();
    const directives = csp.split(';').map((d) => d.trim());
    expect(directives).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-eval' blob:`);
    expect(directives).toContain(`style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`);
    expect(directives).toContain('frame-src *.google.com');
    expect(directives).toContain("worker-src 'self' blob:");
    expect(csp).toContain('https://*.googleapis.com');
    // The protections that never move.
    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives).toContain("object-src 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    // The key is restricted by referrer, and Google refuses a request with none.
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('mints a new nonce for every response', async () => {
    const api = createApi(withMap);
    const first = (await api.request('/admin/schedule/map')).headers.get('content-security-policy');
    const second = (await api.request('/admin/schedule/map')).headers.get('content-security-policy');
    expect(first).not.toBe(second);
  });

  it('leaves every other document, and every API answer, exactly as they were', async () => {
    const api = createApi(withMap);
    for (const path of ['/admin/schedule', '/admin/clients', '/today', '/api/health', '/nothing']) {
      const csp = (await api.request(path)).headers.get('content-security-policy') ?? '';
      expect(csp, path).toContain("script-src 'self'");
      expect(csp, path).not.toContain('googleapis');
      expect(csp, path).not.toContain('unsafe-eval');
      expect((await api.request(path)).headers.get('referrer-policy'), path).toBe('no-referrer');
    }
  });

  it('is the strict policy again when no map path is configured', async () => {
    const csp = (await createApi(deps).request('/admin/schedule/map')).headers.get(
      'content-security-policy',
    );
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('widens nothing for a POST to that path', async () => {
    const csp = (await createApi(withMap).request('/admin/schedule/map', { method: 'POST' }))
      .headers.get('content-security-policy');
    expect(csp).toContain("script-src 'self'");
  });
});
```

In `tests/security/static.test.ts`, extend `build()`'s `index.html` to
`'<!doctype html><html><head><title>McWellness</title><link rel="modulepreload" href="/assets/app-abc123.js"><script type="module" crossorigin src="/assets/app-abc123.js"></script></head><body><div id="root"></div></body></html>'`
and add:

```ts
  it('stamps the shell with the map document’s own nonce, and leaves every other page unstamped', async () => {
    const api = createApi({ ...deps, mapDocumentPaths: ['/admin/schedule/map'] });
    mountApp(api, build());
    const res = await api.request('/admin/schedule/map');
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(
      res.headers.get('content-security-policy') ?? '',
    )?.[1];
    const html = await res.text();
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script nonce="${nonce}"`);
    expect(html).toContain(`<link rel="modulepreload" nonce="${nonce}"`);
    // Google's API copies the nonce off the first style element it finds, so
    // the document carries one for it to find.
    expect(html).toContain(`<style nonce="${nonce}"></style>`);
    const plain = await (await api.request('/admin/clients')).text();
    expect(plain).not.toContain('nonce=');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run tests/security/headers.test.ts tests/security/static.test.ts`
Expected: FAIL — `mapDocumentPaths` is not an option; the map path answers the strict policy.

- [ ] **Step 3: Implement the second policy**

In `app/api/_middleware/request-context.ts`, add to `ApiEnv['Variables']`:

```ts
    /**
     * The content security policy nonce this response was minted with, on the
     * one document that loads a third-party map (docs/SPEC/route-planning.md
     * section 8). Undefined on every other response, which is every other
     * response's answer: they carry the strict policy and stamp nothing.
     */
    cspNonce: string | undefined;
```

In `app/api/_middleware/security.ts`, add `import { randomBytes } from 'node:crypto';`, `import { createMiddleware } from 'hono/factory';` and `import type { ApiEnv } from './request-context';`, then rewrite `securityHeaders`:

```ts
/**
 * The one path served with the wider policy a browser map needs. A constant
 * rather than a guess: the middleware compares the request path against this
 * list exactly, so no `/admin/schedule/map-something` can widen itself into
 * it (docs/SPEC/route-planning.md section 8.2).
 */
export const MAP_DOCUMENT_PATHS: readonly string[] = ['/admin/schedule/map'];

export function securityHeaders(
  appEnv: string | undefined,
  options: {
    supabaseUrl?: string | undefined;
    /** Paths served with the map document's policy. Empty: nothing is widened. */
    mapDocumentPaths?: readonly string[];
  } = {},
): MiddlewareHandler {
  const connectSrc = ["'self'"];
  if (options.supabaseUrl) {
    try {
      connectSrc.push(new URL(options.supabaseUrl).origin);
    } catch {
      // An unparseable URL adds nothing; sign-in then fails visibly, never silently.
    }
  }
  const shared = {
    referrerPolicy: 'no-referrer' as const,
    strictTransportSecurity:
      appEnv === 'production' ? ('max-age=31536000; includeSubDomains' as const) : (false as const),
    xFrameOptions: 'DENY' as const,
    crossOriginResourcePolicy: 'same-origin' as const,
    permissionsPolicy: { camera: [], microphone: [], geolocation: ['self'] },
  };

  const strict = secureHeaders({
    ...shared,
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      // …the existing comment about blob: kept verbatim
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      connectSrc,
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
    },
  });

  /**
   * The day map's own document (docs/SPEC/route-planning.md section 8.3):
   * Google's own strict list, plus what this app already needs. Three of its
   * grants are ones the console would rather not make — `'strict-dynamic'`,
   * `'unsafe-eval'` and `https:` for scripts — and they reach exactly one
   * page. The nonce is what makes `'strict-dynamic'` safe: only the shell's
   * own tags carry it, and only what they load is trusted onwards.
   *
   * The referrer is the origin rather than nothing, because the browser key
   * is restricted by HTTP referrer and Google refuses a request that carries
   * none. Only the origin crosses; no address of this app names a person
   * (.claude/rules/ui.md).
   */
  const mapDocument = (nonce: string): MiddlewareHandler =>
    secureHeaders({
      ...shared,
      referrerPolicy: 'strict-origin-when-cross-origin',
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: [`'nonce-${nonce}'`, "'strict-dynamic'", 'https:', "'unsafe-eval'", 'blob:'],
        styleSrc: ["'self'", `'nonce-${nonce}'`, 'https://fonts.googleapis.com'],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://*.googleapis.com',
          'https://*.gstatic.com',
          '*.google.com',
          '*.googleusercontent.com',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: [
          ...connectSrc,
          'https://*.googleapis.com',
          '*.google.com',
          'https://*.gstatic.com',
          'data:',
          'blob:',
        ],
        frameSrc: ['*.google.com'],
        workerSrc: ["'self'", 'blob:'],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    });

  const mapPaths = new Set(options.mapDocumentPaths ?? []);
  return createMiddleware<ApiEnv>(async (c, next) => {
    if (c.req.method !== 'GET' || !mapPaths.has(c.req.path)) {
      return strict(c, next);
    }
    const nonce = randomBytes(16).toString('base64');
    c.set('cspNonce', nonce);
    return mapDocument(nonce)(c, next);
  });
}
```

In `app/api/create-api.ts`, add `mapDocumentPaths?: readonly string[]` to `ApiOptions` (documented: "Paths served with the day map's own content security policy; the server passes `MAP_DOCUMENT_PATHS`") and pass it:

```ts
  api.use(
    '*',
    securityHeaders(deps.appEnv, {
      supabaseUrl: deps.supabaseUrl,
      mapDocumentPaths: deps.mapDocumentPaths,
    }),
  );
```

In `app/api/server.ts`, pass `mapDocumentPaths: MAP_DOCUMENT_PATHS` (imported from the middleware) into `createApi`.

- [ ] **Step 4: Stamp the shell**

In `app/api/serve-app.ts`, replace the catch-all with:

```ts
/**
 * The nonce on every tag that loads a script, for the one document whose
 * policy needs it (docs/SPEC/route-planning.md section 8.2). `'strict-dynamic'`
 * ignores `'self'` and every host for scripts, so the shell's own tags are
 * trusted by their nonce and everything they load is trusted onwards.
 *
 * The empty `<style nonce>` is not decoration: Google's Maps JavaScript API
 * copies the nonce off the first style element it finds and puts it on the
 * styles it injects, and the built page has stylesheet links and no style
 * element of its own.
 */
function stamp(html: string, nonce: string): string {
  return html
    .replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`)
    .replace(/<link rel="modulepreload"/g, `<link rel="modulepreload" nonce="${nonce}"`)
    .replace('</head>', `<style nonce="${nonce}"></style></head>`);
}

  api.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    c.header('Cache-Control', 'no-store');
    const nonce = c.get('cspNonce');
    return c.html(nonce === undefined ? index : stamp(index, nonce));
  });
```

- [ ] **Step 5: Run the security tests, then the whole unit suite**

Run: `pnpm exec vitest run tests/security && pnpm exec vitest run`
Expected: PASS. Every existing assertion about the strict policy still holds; nothing else changed.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write app/api/_middleware/security.ts app/api/_middleware/request-context.ts app/api/serve-app.ts app/api/create-api.ts app/api/server.ts tests/security/
git add app/api/_middleware/security.ts app/api/_middleware/request-context.ts app/api/serve-app.ts app/api/create-api.ts app/api/server.ts tests/security/
git commit -m "feat(security): the day map's own document policy, nonce and all, and nothing else widened"
```

---

### Task 8: Loading Google's map, and styling it from the tokens

**Files:**
- Create: `app/admin/schedule/map/googleMaps.ts`, `app/admin/schedule/map/mapStyle.ts`
- Test: `tests/scheduling/googleMaps.test.ts`, `tests/scheduling/mapStyle.test.ts`
- Modify: `package.json`, `tsconfig.json`, `.env.example`

**Interfaces:**
- Produces: `GoogleMaps` (the `google.maps` namespace type), `MAPS_VERSION`, `browserMapKey()`, `loadGoogleMaps(key, doc?)`, `mapStyle(root)`.

**A refinement of the spec, recorded in Task 13:** section 4.5 called the basemap style "the fourth place a token's value is written out". It is not: the style is read from the running document's own custom properties, so the map follows `app/shell/tokens.css` with no copy at all, and `.claude/rules/ui.md`'s "never hardcode colours" holds here with no exception.

- [ ] **Step 1: Add the types and the key's name**

```bash
pnpm add -D @types/google.maps
```

In `tsconfig.json`, `"types": ["node", "vite/client", "google.maps"]`.

In `.env.example`, after the routing block:

```
# The coordinator's day map (docs/SPEC/route-planning.md section 8.5). A BROWSER
# key, restricted to the Maps JavaScript API and to the practice's own address, and
# baked into the bundle at build time like VITE_SUPABASE_ANON_KEY: anyone who opens
# the page can read it, which is why it is restricted rather than secret. It is NOT
# GOOGLE_MAPS_API_KEY above, which is a server key and never reaches a browser.
# Empty here and on a laptop: the map says it needs the practice's key, and the day,
# the drives and the optimiser all work without it.
VITE_GOOGLE_MAPS_BROWSER_KEY=
```

- [ ] **Step 2: Write the failing tests**

`tests/scheduling/mapStyle.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mapStyle } from '../../app/admin/schedule/map/mapStyle';

/** The style is read from the running document, so a token change moves the map with it. */
describe('mapStyle', () => {
  it('takes every colour from the document’s own custom properties', () => {
    const root = document.documentElement;
    root.style.setProperty('--paper', '#eef2f1');
    root.style.setProperty('--rule', '#cbd5d6');
    root.style.setProperty('--slate', '#6b7c82');
    root.style.setProperty('--surface', '#ffffff');
    const style = mapStyle(root);
    const colours = style.flatMap((rule) => rule.stylers.map((s) => (s as { color?: string }).color));
    expect(colours).toContain('#eef2f1');
    expect(colours).toContain('#cbd5d6');
    expect(colours).toContain('#6b7c82');
    expect(colours).toContain('#ffffff');
  });

  it('turns the noise off: points of interest, transit and administrative geometry', () => {
    const style = mapStyle(document.documentElement);
    const off = style.filter((rule) =>
      rule.stylers.some((s) => (s as { visibility?: string }).visibility === 'off'),
    );
    expect(off.map((rule) => rule.featureType)).toEqual(
      expect.arrayContaining(['poi', 'transit', 'administrative']),
    );
  });

  it('leaves a colour out rather than inventing one when a token is missing', () => {
    const bare = document.createElement('div');
    document.body.append(bare);
    expect(() => mapStyle(bare)).not.toThrow();
  });
});
```

`tests/scheduling/googleMaps.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGoogleMaps, MAPS_VERSION, resetGoogleMapsLoader } from '../../app/admin/schedule/map/googleMaps';

afterEach(() => {
  resetGoogleMapsLoader();
  document.head.innerHTML = '';
  delete (window as unknown as { google?: unknown }).google;
});

describe('loadGoogleMaps', () => {
  it('adds one script, pinned to a version, asking for no library it does not use', () => {
    void loadGoogleMaps('a-restricted-browser-key');
    const script = document.head.querySelector('script');
    const src = script?.getAttribute('src') ?? '';
    expect(src).toContain('https://maps.googleapis.com/maps/api/js');
    expect(src).toContain('key=a-restricted-browser-key');
    expect(src).toContain(`v=${MAPS_VERSION}`);
    expect(src).toContain('loading=async');
    expect(src).toContain('region=AE');
    expect(src).toContain('language=en');
  });

  it('copies the document’s nonce onto the script, so the map document’s policy admits it', () => {
    const shell = document.createElement('script');
    shell.setAttribute('nonce', 'a-nonce');
    document.head.append(shell);
    void loadGoogleMaps('k');
    const added = [...document.head.querySelectorAll('script')].at(-1);
    expect(added?.nonce || added?.getAttribute('nonce')).toBe('a-nonce');
  });

  it('resolves with the namespace once Google calls back, and adds no second script', async () => {
    const promise = loadGoogleMaps('k');
    const second = loadGoogleMaps('k');
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    const maps = { Map: class {} } as unknown as typeof google.maps;
    (window as unknown as { google: { maps: unknown } }).google = { maps };
    const callback = /callback=([A-Za-z0-9_.]+)/.exec(
      document.head.querySelector('script')?.getAttribute('src') ?? '',
    )?.[1];
    (window as unknown as Record<string, () => void>)[callback ?? '']?.();
    await expect(promise).resolves.toBe(maps);
    await expect(second).resolves.toBe(maps);
  });

  it('rejects when the script is blocked, so the page can say the map could not load', async () => {
    const promise = loadGoogleMaps('k');
    document.head.querySelector('script')?.dispatchEvent(new Event('error'));
    await expect(promise).rejects.toBeInstanceOf(Error);
  });

  it('rejects when nothing answers in time', async () => {
    vi.useFakeTimers();
    const promise = loadGoogleMaps('k');
    const settled = expect(promise).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(9_000);
    await settled;
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm exec vitest run tests/scheduling/googleMaps.test.ts tests/scheduling/mapStyle.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`app/admin/schedule/map/mapStyle.ts`:

```ts
/**
 * The day map's basemap, in Google's own styling vocabulary
 * (docs/SPEC/route-planning.md section 4.5): a quiet, achromatic ground with
 * the roads legible and everything else out of the way, so the pins and the
 * lines are what the eye finds.
 *
 * **Every colour is read from the running document**, not written out here:
 * `getComputedStyle` on the element the page hands in resolves the same
 * custom properties `app/shell/tokens.css` declares, so a token that changes
 * moves the map with it and no value is ever duplicated
 * (.claude/rules/ui.md, "never hardcode colours" — with no exception).
 * A property that resolves to nothing leaves its rule out rather than
 * inventing a colour, which is what happens under a test renderer that
 * computes no styles.
 */
export function mapStyle(root: Element): google.maps.MapTypeStyle[] {
  const computed = getComputedStyle(root);
  const token = (name: string): string | null => {
    const value = computed.getPropertyValue(name).trim();
    return value === '' ? null : value;
  };
  const paint = (
    featureType: string,
    elementType: string,
    name: string,
  ): google.maps.MapTypeStyle[] => {
    const color = token(name);
    return color === null ? [] : [{ featureType, elementType, stylers: [{ color }] }];
  };
  return [
    // The ground, the roads, and a label that reads without shouting.
    ...paint('all', 'geometry', '--paper'),
    ...paint('road', 'geometry', '--rule'),
    ...paint('all', 'labels.text.fill', '--slate'),
    ...paint('all', 'labels.text.stroke', '--paper'),
    // Water as a band lifted off the ground rather than as a colour.
    ...paint('water', 'geometry', '--surface'),
    // The noise: nothing on this map is a shop, a bus route or a border.
    { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  ];
}
```

`app/admin/schedule/map/googleMaps.ts`:

```ts
/**
 * Loading the Maps JavaScript API into the coordinator's browser
 * (docs/SPEC/route-planning.md section 4.6). One script per document, pinned
 * to a version channel, asking for nothing it does not draw.
 *
 * **The nonce is copied from the shell's own script tag.** The map document
 * is served with `'strict-dynamic'` and a per-response nonce (section 8), so
 * a tag without it is refused by the browser and nothing is said out loud.
 * Google's own loader does the same thing internally for what it injects.
 *
 * **The key is a browser key and is meant to be readable.** It is restricted
 * to this one product and to the practice's own address, which is what makes
 * it useless to anyone who lifts it off the page. The server key that prices
 * the drives is a different key and never leaves the API process.
 *
 * Nothing here is called by a test: the page takes its loader as a prop, so
 * a test hands it a fake namespace and no test ever reaches the network.
 */

export type GoogleMaps = typeof google.maps;

/** The quarterly channel: a version that moves four times a year, not weekly. */
export const MAPS_VERSION = 'quarterly';
const CALLBACK = '__mcwellnessGoogleMapsReady';
const TIMEOUT_MS = 8_000;

/** The browser key this build was made with, or null when the practice has none. */
export function browserMapKey(): string | null {
  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
  return typeof key === 'string' && key.trim() !== '' ? key.trim() : null;
}

let pending: Promise<GoogleMaps> | null = null;

/** For the tests only: forgets the one script this module remembers adding. */
export function resetGoogleMapsLoader(): void {
  pending = null;
}

export function loadGoogleMaps(key: string, doc: Document = document): Promise<GoogleMaps> {
  if (pending !== null) return pending;
  const already = (window as unknown as { google?: { maps?: GoogleMaps } }).google?.maps;
  if (already) {
    pending = Promise.resolve(already);
    return pending;
  }
  pending = new Promise<GoogleMaps>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The map did not load.'));
    }, TIMEOUT_MS);
    const finish = (): void => {
      clearTimeout(timer);
      const maps = (window as unknown as { google?: { maps?: GoogleMaps } }).google?.maps;
      if (maps) resolve(maps);
      else reject(new Error('The map did not load.'));
    };
    (window as unknown as Record<string, () => void>)[CALLBACK] = finish;

    const script = doc.createElement('script');
    const parameters = new URLSearchParams({
      key,
      v: MAPS_VERSION,
      loading: 'async',
      callback: CALLBACK,
      language: 'en',
      region: 'AE',
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${parameters.toString()}`;
    script.async = true;
    // Origin only, never the path: the key is restricted by referrer and a
    // request with none is refused (section 8.3).
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    const nonce = doc.querySelector('script[nonce]')?.getAttribute('nonce');
    if (nonce) script.setAttribute('nonce', nonce);
    script.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('The map could not be loaded.'));
    });
    doc.head.append(script);
  });
  return pending;
}
```

- [ ] **Step 5: Run the tests until they pass, then typecheck and commit**

Run: `pnpm exec vitest run tests/scheduling/googleMaps.test.ts tests/scheduling/mapStyle.test.ts && pnpm exec tsc --noEmit -p .`

```bash
pnpm exec prettier --write app/admin/schedule/map/ tests/scheduling/googleMaps.test.ts tests/scheduling/mapStyle.test.ts package.json tsconfig.json .env.example
git add app/admin/schedule/map/ tests/scheduling/ package.json pnpm-lock.yaml tsconfig.json .env.example
git commit -m "feat(schedule): the map's loader and its basemap read from the practice's own tokens"
```

---

### Task 9: The map itself — pins, lines and the drives between

**Files:**
- Create: `app/admin/schedule/map/DayMap.tsx`, `app/admin/schedule/map/overlays.ts`, `app/admin/schedule/map/map.css`
- Create: `tests/scheduling/fakeGoogleMaps.ts`
- Test: `tests/scheduling/DayMap.test.tsx`

**Interfaces:**
- Consumes: `mapStyle` (Task 8); `GoogleMaps` (Task 8); `PracticeDayPractitioner`, `PracticeDayStop`, `DayLegRow` (Task 5).
- Produces: `createProjectionBridge(maps, onProjection)`; `DayMap({ maps, day, selectedId, onSelect, driveLine })`; `driveLine(leg)` in `DayMapPage`'s own module (Task 10) — **declared here** as `formatDrive(leg: DayLegRow | undefined): string`, exported from `DayMap.tsx` and reused by the page's panel.

**Why the pins are the app's own DOM.** A marker drawn by Google is a picture: it cannot be tabbed to, read aloud, or asserted on. So one `OverlayView` is created for its projection alone, and the pins and the drive labels are React elements in a layer above the canvas — real buttons, in the tab order, that a test can find by name. The lines stay `Polyline`s, which are geometry and carry no text.

- [ ] **Step 1: Write the fake namespace**

`tests/scheduling/fakeGoogleMaps.ts`:

```ts
/**
 * Enough of `google.maps` for the day map's own tests: a map that records
 * what it was given, an overlay whose projection is a plain linear one, and
 * a polyline that remembers its path. Nothing here reaches a network, and no
 * test in this repository ever loads Google's own script.
 *
 * The projection maps a coordinate to a pixel by a fixed scale about a fixed
 * origin, so a test can assert that two stops are drawn in different places
 * without asserting anything about Mercator.
 */
export type FakeMapsState = {
  maps: typeof google.maps;
  polylines: { path: { lat: number; lng: number }[] }[];
  fitted: number;
};

export function fakeGoogleMaps(): FakeMapsState {
  const state: FakeMapsState = { maps: null as never, polylines: [], fitted: 0 };

  class LatLngBounds {
    extend(): this {
      return this;
    }
    isEmpty(): boolean {
      return false;
    }
  }
  class MapClass {
    constructor(
      public element: HTMLElement,
      public options: unknown,
    ) {}
    fitBounds(): void {
      state.fitted += 1;
    }
    panTo(): void {}
    setOptions(): void {}
    addListener(): { remove: () => void } {
      return { remove: () => undefined };
    }
  }
  class OverlayView {
    private map: unknown = null;
    setMap(map: unknown): void {
      this.map = map;
      if (map === null) {
        (this as unknown as { onRemove?: () => void }).onRemove?.();
        return;
      }
      (this as unknown as { onAdd?: () => void }).onAdd?.();
      (this as unknown as { draw?: () => void }).draw?.();
    }
    getMap(): unknown {
      return this.map;
    }
    getPanes(): Record<string, HTMLElement> {
      return { overlayMouseTarget: document.createElement('div') };
    }
    getProjection(): {
      fromLatLngToDivPixel: (point: { lat: number; lng: number }) => { x: number; y: number };
    } {
      return {
        fromLatLngToDivPixel: (point) => ({
          x: Math.round((point.lng - 55) * 1000),
          y: Math.round((26 - point.lat) * 1000),
        }),
      };
    }
  }
  class Polyline {
    constructor(public options: { path?: { lat: number; lng: number }[] }) {
      state.polylines.push({ path: options.path ?? [] });
    }
    setMap(): void {}
  }

  state.maps = {
    Map: MapClass,
    OverlayView,
    Polyline,
    LatLngBounds,
  } as unknown as typeof google.maps;
  return state;
}
```

- [ ] **Step 2: Write the failing component test**

`tests/scheduling/DayMap.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DayMap, formatDrive } from '../../app/admin/schedule/map/DayMap';
import { fakeGoogleMaps } from './fakeGoogleMaps';

afterEach(cleanup);

const day = {
  practitionerId: '00000009-0000-4000-8000-000000000001',
  homeBase: { locationId: 'base', point: { lat: 25.2, lng: 55.27 } },
  stops: [
    { appointmentId: 'a1', locationId: 'l1', point: { lat: 25.3, lng: 55.3 }, windowStart: '2026-09-10T05:00:00.000Z', windowEnd: '2026-09-10T05:45:00.000Z', status: 'proposed' },
    { appointmentId: 'a2', locationId: 'l2', point: { lat: 25.35, lng: 55.4 }, windowStart: '2026-09-10T07:00:00.000Z', windowEnd: '2026-09-10T07:45:00.000Z', status: 'confirmed' },
  ],
  legs: [
    { toStopId: 'a1', fromLocationId: 'base', toLocationId: 'l1', departAt: '2026-09-10T05:00:00.000Z', seconds: 900, metres: 9000, source: 'traffic' as const },
    { toStopId: 'a2', fromLocationId: 'l1', toLocationId: 'l2', departAt: '2026-09-10T06:45:00.000Z', seconds: 1500, metres: 18000, source: 'traffic' as const },
  ],
};

describe('DayMap', () => {
  it('draws a numbered pin per stop and a base, each a button that names its stop', () => {
    const state = fakeGoogleMaps();
    render(<DayMap maps={state.maps} day={day} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Stop 1 on the map' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop 2 on the map' })).toBeTruthy();
    expect(screen.getByText('H')).toBeTruthy();
  });

  it('draws one line per drive, through the places in order', () => {
    const state = fakeGoogleMaps();
    render(<DayMap maps={state.maps} day={day} selectedId={null} onSelect={() => undefined} />);
    expect(state.polylines).toHaveLength(1);
    expect(state.polylines[0]?.path).toHaveLength(3);
    expect(state.fitted).toBeGreaterThan(0);
  });

  it('writes the drive beside the line, always as an estimate', () => {
    const state = fakeGoogleMaps();
    render(<DayMap maps={state.maps} day={day} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByText('about 15 min')).toBeTruthy();
    expect(screen.getByText('about 25 min')).toBeTruthy();
  });

  it('hands the stop back when its pin is pressed, and marks the selected one', () => {
    const state = fakeGoogleMaps();
    const onSelect = vi.fn();
    const { rerender } = render(
      <DayMap maps={state.maps} day={day} selectedId={null} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop 2 on the map' }));
    expect(onSelect).toHaveBeenCalledWith('a2');
    rerender(<DayMap maps={state.maps} day={day} selectedId="a2" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Stop 2 on the map' }).getAttribute('aria-current')).toBe('true');
  });

  it('says nothing at all about a day with no stops', () => {
    const state = fakeGoogleMaps();
    render(
      <DayMap maps={state.maps} day={{ ...day, stops: [], legs: [] }} selectedId={null} onSelect={() => undefined} />,
    );
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
  });
});

describe('formatDrive', () => {
  it('is a sentence with the word estimate, and no distance under the fallback', () => {
    expect(formatDrive({ seconds: 1500, metres: 18000, source: 'traffic' })).toBe(
      'about 25 min, 18 km, estimate from traffic',
    );
    expect(formatDrive({ seconds: 1500, metres: 18000, source: 'straight-line' })).toBe(
      'about 25 min, straight-line estimate',
    );
    expect(formatDrive(undefined)).toBe('– –');
  });
});
```

- [ ] **Step 3: Run it to verify it fails, then implement**

`app/admin/schedule/map/overlays.ts`:

```ts
import type { GoogleMaps } from './googleMaps';

/**
 * One overlay, for its projection alone (docs/SPEC/route-planning.md section
 * 4.3). Google's own markers are pictures: they cannot be tabbed to, read
 * aloud or asserted on, so the pins this map draws are the app's own DOM in
 * a layer above the canvas, and this is the only thing that has to be an
 * `OverlayView` — the object that can turn a coordinate into a pixel and
 * says when the map has moved.
 *
 * The class is built after the API has loaded, because `maps.OverlayView`
 * does not exist before it.
 */
export type Projection = { toPixel(point: { lat: number; lng: number }): { x: number; y: number } };

export function createProjectionBridge(
  maps: GoogleMaps,
  onProjection: (projection: Projection | null) => void,
): google.maps.OverlayView {
  class ProjectionBridge extends maps.OverlayView {
    override onAdd(): void {}
    override draw(): void {
      const projection = this.getProjection();
      onProjection(
        projection === undefined
          ? null
          : {
              toPixel: (point) => {
                const pixel = projection.fromLatLngToDivPixel(
                  point as unknown as google.maps.LatLng,
                );
                return { x: pixel?.x ?? 0, y: pixel?.y ?? 0 };
              },
            },
      );
    }
    override onRemove(): void {
      onProjection(null);
    }
  }
  return new ProjectionBridge();
}
```

`app/admin/schedule/map/DayMap.tsx` — the component: a `<div className="daymap">` holding the canvas div (`ref`), and above it `<div className="daymap__layer">` with one button per stop positioned by `transform: translate(Xpx, Ypx)` from the projection, one non-interactive marker for the base, and one label per leg at the midpoint of its two places. Effects, in order:

1. On `maps` and the canvas ref: `new maps.Map(canvas, { center, zoom: 11, disableDefaultUI: true, clickableIcons: false, styles: mapStyle(document.documentElement), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || undefined })`, then `createProjectionBridge(...)` with `setMap(map)`, then a `LatLngBounds` extended over every place and `fitBounds`. Clean up by `setMap(null)`.
2. On `day.legs`: one `new maps.Polyline({ path, map, strokeOpacity: 1, strokeWeight: 1, strokeColor: token('--slate'), clickable: false })` through the base and every stop in order, replaced whenever the day changes and removed on cleanup.
3. Positions in `useState`, written by the projection callback and on every day change.

`formatDrive` is the Today screen's own sentence, exported for the panel:

```ts
/**
 * "about 25 min, 18 km, estimate from traffic", or "about 25 min,
 * straight-line estimate" (docs/SPEC/practitioner-phone.md section 5.4, the
 * same wording the practitioner reads). Commas and no middle dot; always the
 * word estimate; never a point time. The fallback carries no distance: a
 * straight line's kilometres beside the word estimate offer a precision the
 * arithmetic does not have.
 */
export function formatDrive(leg: { seconds: number; metres: number; source: string } | undefined): string {
  if (leg === undefined) return '– –';
  const minutes = Math.max(1, Math.round(leg.seconds / 60));
  if (leg.source !== 'traffic') return `about ${minutes} min, straight-line estimate`;
  return `about ${minutes} min, ${Math.round(leg.metres / 1000)} km, estimate from traffic`;
}
```

The short label on the map is `about ${minutes} min` alone; the panel prints the full sentence.

`map.css`: `.daymap { position: relative; inline-size: 100%; block-size: 100%; }`, `.daymap__canvas { position: absolute; inset: 0; }`, `.daymap__layer { position: absolute; inset: 0; pointer-events: none; }`, and inside it pins with `pointer-events: auto`, `position: absolute`, `translate: -50% -50%`, a circular hairline chip on `--surface` with `--ink` text, tabular figures, `--tap` minimum size, `aria-current` marked by a filled ground. Labels: a small `--surface` chip with a hairline, `--slate` text, `translate: -50% -50%`. Tokens and logical properties only.

- [ ] **Step 4: Run the test until it passes**

Run: `pnpm exec vitest run tests/scheduling/DayMap.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write app/admin/schedule/map/ tests/scheduling/
git add app/admin/schedule/map/ tests/scheduling/
git commit -m "feat(schedule): the day drawn — numbered pins in the tab order, lines, and the drive beside each"
```

---

### Task 10: The day map page

**Files:**
- Create: `app/admin/schedule/map/DayMapPage.tsx`
- Modify: `app/admin/schedule/map/map.css`, `app/admin/schedule/SchedulePage.tsx`, `app/shell/App.tsx`
- Test: `tests/scheduling/DayMapPage.test.tsx`

**Interfaces:**
- Consumes: `DayMap`, `formatDrive` (Task 9); `loadGoogleMaps`, `browserMapKey`, `GoogleMaps` (Task 8); `PracticeDayResponse` (Task 5); `AppointmentListResponse`, `AppointmentRow`; `MoveAppointmentDrawer`, `CancelAppointmentDrawer`, `formatWindow`, `practiceDay`, `APPOINTMENT_STATUS_LABELS`, `APPOINTMENT_STATUS_TONES`.
- Produces: `DayMapPage({ loadMaps? })` — the loader is a prop so no test reaches the network.

**Copy, exactly.** Title "Day map". The three notes: `The map needs the practice's browser key.` / `The map could not be loaded.` / `Open the day map from the Schedule page — a map cannot load on a screen you reached from another one.` Load failure: `The day could not be loaded. Try again.` Empty: `No appointments are booked for this day.` The panel's heading is the practitioner's own name.

- [ ] **Step 1: Write the failing test**

`tests/scheduling/DayMapPage.test.tsx`, in the shape of `SchedulePage.test.tsx` (an `AuthProviderBoundary` with a fake `fetchImpl`, wrapped in a `MemoryRouter` at `/admin/schedule/map?date=2026-09-10`). The fake `fetchImpl` answers `/api/appointments?` with two rows and `/api/routing/practice-day?` with the matching geometry. `loadMaps` is `() => Promise.resolve(fakeGoogleMaps().maps)`.

```tsx
describe('DayMapPage', () => {
  it('lists the day beside the map, in window order, with the drive beneath each stop after the first', async () => {
    renderPage(fetchImpl());
    expect(await screen.findByRole('button', { name: /Iris Cliff/ })).toBeTruthy();
    expect(screen.getByText('09:00–09:45', plainText)).toBeTruthy();
    expect(screen.getByText('about 25 min, 18 km, estimate from traffic')).toBeTruthy();
    // Nothing above the first stop: there is no drive before the day begins.
    expect(screen.queryAllByText(/estimate/)).toHaveLength(1);
  });

  it('draws the map when the practice has a browser key', async () => {
    renderPage(fetchImpl(), { key: 'a-restricted-browser-key' });
    expect(await screen.findByRole('button', { name: 'Stop 1 on the map' })).toBeTruthy();
    expect(screen.queryByText("The map needs the practice's browser key.")).toBeNull();
  });

  it('says the map needs a key, and still shows the whole day, when there is none', async () => {
    renderPage(fetchImpl(), { key: null });
    expect(await screen.findByText("The map needs the practice's browser key.")).toBeTruthy();
    expect(screen.getByRole('button', { name: /Iris Cliff/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Optimise the day' })).toBeTruthy();
  });

  it('says how to reach a map that could not load on a page reached from another screen', async () => {
    renderPage(fetchImpl(), { key: 'k', loadMaps: () => Promise.reject(new Error('blocked')) });
    expect(
      await screen.findByText(
        'Open the day map from the Schedule page — a map cannot load on a screen you reached from another one.',
      ),
    ).toBeTruthy();
  });

  it('says plainly when the day could not be loaded', async () => {
    renderPage(() => Promise.resolve(new Response('no', { status: 500 })));
    expect(await screen.findByText('The day could not be loaded. Try again.')).toBeTruthy();
  });

  it('picks a stop out when its pin is pressed, and shows the practitioner’s own name over the panel', async () => {
    renderPage(fetchImpl(), { key: 'k' });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop 2 on the map' }));
    expect(screen.getByRole('listitem', { current: true })).toBeTruthy();
    expect(screen.getByText('Cedar Ridge')).toBeTruthy();
  });

  it('offers Move and Call off on an open visit, and Confirm only on one nobody has been told about', async () => {
    renderPage(fetchImpl(), { key: 'k' });
    expect(await screen.findByRole('button', { name: /^Move Iris Cliff/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Confirm Juniper Valley/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Confirm Iris Cliff/ })).toBeNull();
  });

  it('is English throughout, whatever the wire carries', async () => {
    renderPage(fetchImpl(), { key: 'k' });
    await screen.findByRole('button', { name: /Iris Cliff/ });
    expect(screen.queryByText('إيريس كليف')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then write the page**

`app/admin/schedule/map/DayMapPage.tsx`:

```tsx
/**
 * The practice's day, drawn (docs/SPEC/route-planning.md sections 4 and 5;
 * docs/SPEC/scheduling-manual.md section 4.2; docs/DESIGN-BRIEF.md 6.2, "the
 * one full-bleed screen"). The map fills the content area and the day's own
 * rows sit over its inline start, carrying the same facts the Schedule table
 * carries and the same three actions.
 *
 * **Two reads, joined by an id.** `GET /api/appointments?date=` carries who
 * is behind each door and is where the audit trail records that the day was
 * read; `GET /api/routing/practice-day?date=` carries the coordinates and the
 * drives and names nobody. Neither would be enough on its own, and neither is
 * widened to do the other's work.
 *
 * **This page is opened by a plain anchor, never by the router.** It is
 * served as its own document with the wider content security policy a
 * browser map needs (section 8); a client-side navigation would carry the
 * strict policy in with it and Google's script would be refused silently. If
 * that happens anyway, the page says which door to come in by rather than
 * showing an empty frame.
 *
 * **The map is never the day.** With no key, a blocked script or a vendor
 * that is down, the rows, the estimates and the optimiser all still work:
 * what is lost is a picture.
 */
```

Structure: `<section className="page page--bleed">` containing `<DayMap …/>` (or a `.daymap--absent` panel-only ground) and an aside `.daymap__panel` holding: the title "Day map"; a date `<Field type="date">` that writes `?date=` through `useSearchParams`; a plain anchor `Schedule` back to `/admin/schedule?date=…`; the practitioner picker (a `Select`, rendered only when the day has more than one practitioner); the `Optimise the day` button (disabled while the day is loading, or when the shown practitioner has fewer than two stops); the notes; and the `<ol className="daymap__rows">` of stops. Each row: `aria-current` when selected, the window in tabular figures, the client's name as a button that selects it, the service, the location's label and emirate, a `StatusChip`, the drive sentence beneath every row after the first, and the three action buttons with the accessible names `Confirm <name>`, `Move <name>`, `Call off <name>` (the Schedule page's own wording). Confirm posts to `/api/appointments/:id/confirm` exactly as `SchedulePage` does, with the same two error sentences; Move and Call off open the existing drawers.

The map's own state: `browserMapKey()` unless the test passes a key; `loadMaps ?? loadGoogleMaps`; on mount, when a key exists, load and hold the namespace, and on rejection set the note — the "come in by the other door" sentence when `document.querySelector('script[nonce]')` is absent, and "The map could not be loaded." otherwise.

`map.css` gains the full-bleed rule, the panel and the rows:

```css
/* The one full-bleed screen (docs/DESIGN-BRIEF.md 6.2). The rail stays; the
   content area's own padding and measure stand down for this page alone. */
.admin__main:has(.page--bleed) {
  padding: 0;
  max-inline-size: none;
}
```

Wire the route into `app/shell/App.tsx` beside `schedule/week`, guarded by `canOpenSchedule` exactly as that one is, and add the anchor to `SchedulePage`'s toolbar beside "See the week":

```tsx
        {/* A plain anchor, not a Link: the map is served as its own document
            with the policy a browser map needs (docs/SPEC/route-planning.md
            section 4.1), and a client-side navigation would carry this
            screen's stricter policy into it. */}
        <a className="link schedule__week-link" href={`/admin/schedule/map?date=${date}`}>
          Open the day map
        </a>
```

- [ ] **Step 3: Run the page test and the Schedule page's own test**

Run: `pnpm exec vitest run tests/scheduling/DayMapPage.test.tsx tests/scheduling/SchedulePage.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write app/admin/schedule/ app/shell/App.tsx tests/scheduling/
git add app/admin/schedule/ app/shell/App.tsx tests/scheduling/
git commit -m "feat(schedule): the day map page, the day beside it, and the door in from the schedule"
```

---

### Task 11: Optimise the day

**Files:**
- Create: `app/admin/schedule/map/OptimiseDrawer.tsx`
- Modify: `app/admin/schedule/map/DayMapPage.tsx`, `app/admin/schedule/map/map.css`
- Test: `tests/scheduling/OptimiseDrawer.test.tsx`

**Interfaces:**
- Consumes: `OptimiseDayResponse`, `PlannedStopRow` (Task 5); `ReorderRequest`, `ReorderResponse` (Task 6); `AppointmentRow`; `useDrawer` (`app/shell/components/useDrawer`); `formatWindow`.
- Produces: `OptimiseDrawer({ date, practitionerId, stops, onClose, onApplied })`, where `stops` is the panel's rows so the drawer can name each visit.

**Copy, exactly.** Title "Optimise the day". The figures are labelled `Now` and `After`. The saving reads `Saves about 12 min of driving.` The source line is one of `Estimates from traffic.` / `Straight-line estimates.` / `Some estimates from traffic, some straight-line.` The reason field is labelled `Why is the day changing?` and starts as `Day optimised on the map`. The button is `Apply the new order`, and while it runs `Applying…`. The four refusals are the spec's sentences verbatim (section 5.5). After a success: `N visits moved. The households have not been told.` (`1 visit moved.` in the singular). On 409 `stale_plan`: `The day changed while you were looking. Reload the day.` On any other refusal: `The new order could not be applied. Reload the day and try again.` On 403: `Only the owner, an admin or a lead practitioner can change the day.`

- [ ] **Step 1: Write the failing test**

`tests/scheduling/OptimiseDrawer.test.tsx`:

```tsx
describe('OptimiseDrawer', () => {
  it('shows the driving now and after, the saving, and where the figures came from', async () => {
    renderDrawer(plan());
    expect(await screen.findByText('Saves about 10 min of driving.')).toBeTruthy();
    expect(screen.getByText('Estimates from traffic.')).toBeTruthy();
    expect(screen.getByText('1 h 55 min')).toBeTruthy();  // Now
    expect(screen.getByText('1 h 45 min')).toBeTruthy();  // After
  });

  it('names every visit with the window it had and the window it would take, and marks the kept ones', async () => {
    renderDrawer(plan());
    const rows = await screen.findAllByRole('row');
    expect(rows.some((row) => row.textContent?.includes('kept (confirmed)'))).toBe(true);
    expect(screen.getByText('12:00–12:45', plainText)).toBeTruthy();
  });

  it('applies the moved visits only, with the reason, and says the households have not been told', async () => {
    const fetchImpl = spyFetch(plan());
    renderDrawer(plan(), fetchImpl);
    fireEvent.click(await screen.findByRole('button', { name: 'Apply the new order' }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent?.headers['x-reason']).toBe('Day optimised on the map');
    expect(sent?.body.moves.map((m) => m.appointmentId)).toEqual(['a1', 'a3']);
    expect(sent?.body.moves[0]?.wasWindowStart).toBe('2026-09-10T05:00:00.000Z');
    expect(await screen.findByText('2 visits moved. The households have not been told.')).toBeTruthy();
  });

  it('refuses to apply without a reason', async () => {
    renderDrawer(plan());
    fireEvent.change(await screen.findByLabelText('Why is the day changing?'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Apply the new order' }).hasAttribute('disabled')).toBe(true);
  });

  it('says the day changed underneath it, and offers no second attempt', async () => {
    renderDrawer(plan(), () => Promise.resolve(new Response(JSON.stringify({ error: 'conflict', code: 'stale_plan' }), { status: 409 })));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply the new order' }));
    expect(await screen.findByText('The day changed while you were looking. Reload the day.')).toBeTruthy();
  });

  it.each([
    ['nothing_to_move', 'Every visit today has been agreed with its household, or is already under way.'],
    ['no_improvement', 'This order already drives least.'],
    ['infeasible', 'The day cannot be improved around the confirmed visits.'],
    ['too_many_stops', 'More than ten stops in a day is not optimised.'],
  ])('says why nothing should move: %s', async (reason, sentence) => {
    renderDrawer({ kind: 'refusal', reason });
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply the new order' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then write the drawer**

`app/admin/schedule/map/OptimiseDrawer.tsx`, in the shape of `MoveAppointmentDrawer.tsx` (an `<aside className="drawer" role="dialog" aria-labelledby="optimise-title">` with `useDrawer` for focus, the close button, a `.drawer__body`, and `.stepper` sections). It asks `POST /api/routing/practice-day/optimise` on open, holds `OptimiseDayResponse`, and on Apply sends `POST /api/appointments/reorder` with `moves` built from the plan's `moved` stops only, each carrying `appointmentId`, `windowStart`, `wasWindowStart` and `travelBufferMinutes`, and the `x-reason` header.

The durations are written by one helper, exported for its own test:

```ts
/**
 * A span of driving, as a person says it: "1 h 45 min", or "12 min" under the
 * hour. Never a decimal and never seconds — this is an estimate of a drive,
 * and a figure to the second would claim a precision no estimate has.
 */
export function formatDriveSpan(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}
```

The order is a `Table` from the shell (`columns`: Stop, Now, After, Change), so the figures land in the ledger's own rhythm; "kept (confirmed)" is what the Change column reads for an anchor, "kept" for a movable visit the plan did not move, and the new window for one it did.

Wire it into `DayMapPage`: the `Optimise the day` button opens it for the shown practitioner; `onApplied` closes it and reloads both reads.

- [ ] **Step 3: Run the test until it passes, then the whole unit suite**

Run: `pnpm exec vitest run tests/scheduling && pnpm exec vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write app/admin/schedule/map/ tests/scheduling/
git add app/admin/schedule/map/ tests/scheduling/
git commit -m "feat(schedule): Optimise the day — the plan, its figures, and the households still to tell"
```

---

### Task 12: A day worth optimising, in the seed

**Files:**
- Modify: `db/seed/generate.ts`, `db/seed/apply.ts`, `db/seed/index.ts`
- Test: `db/seed/generate.test.ts`, `tests/db/seed.test.ts`

**Interfaces:**
- Produces: `SeedAppointment`, `SeedData.appointments`, `SeedOptions.planningDay`.

**Why a `planningDay` option.** `generateSeed()` is deterministic and anchored to `SEED_TODAY` (2026-09-02), which every existing test depends on. A day map is worth nothing on a day already past, so the planning day is its own option: it defaults to two days after the seed's `today`, so `generateSeed()` stays byte-for-byte deterministic, and `pnpm seed` passes two days after the *real* Dubai date so a laptop's map opens on a day whose visits can still be moved.

- [ ] **Step 1: Write the failing tests**

In `db/seed/generate.test.ts`:

```ts
  it('books a day worth optimising: five visits in a deliberately poor order, one already agreed', () => {
    const data = generateSeed();
    expect(data.appointments).toHaveLength(5);
    expect(data.appointments.every((a) => a.windowStart.startsWith(data.planningDay))).toBe(true);
    expect(data.appointments.filter((a) => a.status === 'confirmed')).toHaveLength(1);
    expect(data.appointments.filter((a) => a.status === 'proposed')).toHaveLength(4);
    // Three emirates, so the order actually costs something.
    const emirates = new Set(
      data.appointments.map(
        (a) => data.locations.find((l) => l.id === a.locationId)?.emirate,
      ),
    );
    expect(emirates.size).toBeGreaterThanOrEqual(3);
    // Every household on it is one that may be visited.
    for (const appointment of data.appointments) {
      const client = data.clients.find((c) => c.id === appointment.clientId);
      expect(client?.status).toBe('active');
    }
  });

  it('takes the planning day from its option, so the seed itself stays the same every time', () => {
    expect(generateSeed({ planningDay: '2026-10-01' }).appointments[0]?.windowStart).toContain(
      '2026-10-01',
    );
    expect(generateSeed()).toEqual(generateSeed());
  });
```

In `tests/db/seed.test.ts`, extend the "writes every generated row and reports what it wrote" case with `appointment` in the counts, and add:

```ts
  it('seeds a day the map can draw: every visit has a place with a coordinate and a practitioner who may deliver it', async () => {
    const { rows } = await owner.query<{ n: string }>(
      'select count(*)::text as n from appointment a ' +
        'join location l on l.id = a.location_id ' +
        'join credential c on c.practitioner_id = a.practitioner_id ' +
        'and c.service_type_id = a.service_type_id and c.can_execute_session ' +
        'where l.entrance_point is not null',
    );
    expect(Number(rows[0]?.n)).toBe(5);
  });
```

- [ ] **Step 2: Implement**

In `generate.ts`, add the type, the option and the day:

```ts
/**
 * A visit on the planning day (docs/SPEC/route-planning.md section 14). Five
 * of them, in an order that crosses the country and back, so the day map has
 * something to draw and the optimiser something to improve; one of them
 * `confirmed`, because a plan that never met an anchor would prove nothing.
 */
export type SeedAppointment = {
  id: string;
  clientId: string;
  practitionerId: string;
  serviceTypeId: string;
  locationId: string;
  windowStart: string;
  windowEnd: string;
  travelBufferMinutes: number;
  status: 'proposed' | 'confirmed';
};
```

`SeedData` gains `planningDay: string` and `appointments: SeedAppointment[]`; `SeedOptions` gains `planningDay?: string`. Build the day after the clients and the practitioners exist: take the five active client households whose emirates differ most (Dubai, Sharjah, Abu Dhabi among them), the first practitioner, the `nf-session` service type and the credential that already pairs them; windows at 09:00, 10:30, 12:00, 13:30 and 15:00 in `+04:00`, each 45 minutes, buffer 15; the third is `confirmed`, the rest `proposed`; ids from `seedId('a', n)` — **check first that the `'a'` prefix is unused** (`grep -n "seedId('" db/seed/generate.ts`) and take the next free one if it is not.

In `apply.ts`, insert them after the credentials and the clients, in the file's own style:

```ts
    // The planning day (docs/SPEC/route-planning.md section 14): the visits
    // the day map draws and the optimiser reorders. Last of the practice's
    // rows, because an appointment names a client, a practitioner, a service
    // and a place, and every one of them has to exist first.
    for (const a of data.appointments) {
      await insert('appointment', {
        id: a.id,
        tenant_id: t.id,
        client_id: a.clientId,
        practitioner_id: a.practitionerId,
        service_type_id: a.serviceTypeId,
        location_id: a.locationId,
        delivery_mode: 'home',
        window_start: a.windowStart,
        window_end: a.windowEnd,
        travel_buffer_minutes: a.travelBufferMinutes,
        status: a.status,
        created_by: owner,
      });
    }
```

In `db/seed/index.ts`, pass the planning day:

```ts
      // Two days from the real day this laptop is seeded on, so the day map
      // opens on visits that can still be moved. The rest of the seed keeps
      // its own fixed "today", which is what makes it reproducible.
      const planningDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(
        new Date(Date.now() + 2 * 24 * 60 * 60_000),
      );
      const data = generateSeed({ planningDay });
```

- [ ] **Step 3: Rebuild the local database and look at it**

Run: `pnpm db:up && pnpm seed --fresh && pnpm exec vitest run db/seed && pnpm exec vitest run --config vitest.db.config.ts tests/db/seed.test.ts`
Expected: PASS, and the seed reports five appointments.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write db/seed/ tests/db/seed.test.ts
git add db/seed/ tests/db/seed.test.ts
git commit -m "feat(seed): a planning day of five visits across three emirates, one already agreed"
```

---

### Task 13: The change request, and the documents that must agree

**Files:**
- Create: `docs/CHANGE-REQUESTS/scheduling-05.md`
- Modify: `docs/SEAMS.md`, `docs/SECURITY.md`, `docs/COMPLIANCE/approved-vendors.md`, `docs/RUNBOOK/go-live.md`, `docs/STAGING.md`, `docs/SPEC/OWNERSHIP.md`, `docs/SPEC/scheduling-manual.md`, `docs/SPEC/practitioner-phone.md`, `docs/SPEC/route-planning.md`, `docs/HANDOVER.md`

- [ ] **Step 1: Write the change request**

`docs/CHANGE-REQUESTS/scheduling-05.md`, in the shape of `scheduling-04.md`: a heading, two paragraphs naming what the pull request builds and which spec sections require it, then the table of everything it touched outside `docs/SPEC/OWNERSHIP.md`'s row for `scheduling`, one row each: the seam's grid (`domain/shared/routing.ts`, `app/api/_middleware/routing/**`); the actor's `routing.practiceDay.read`; the map document's policy and nonce (`app/api/_middleware/security.ts`, `request-context.ts`, `serve-app.ts`, `create-api.ts`, `server.ts`); the route in `app/shell/App.tsx`; `VITE_GOOGLE_MAPS_BROWSER_KEY` in `.env.example`; `@types/google.maps` in `package.json` and `tsconfig.json`; the planning day in `db/seed/**`; the security tests. Each row says what, where, why and what it blocks. Close with a "Left standing, deliberately" section naming the three things this piece does not do: no migration, no policy file, and no change to what the practitioner's phone shows.

- [ ] **Step 2: Amend the specification where the build learned better**

In `docs/SPEC/route-planning.md`, make five edits and mark each `**Amended in the build, 2026-09-07:**`:

1. **Section 5.4, the day's end.** The day ends at the last stop's departure, not at the arrival home; the return leg counts in the driving sum and not in the end time. Otherwise almost every better order is refused for "ending later", because the far household ends up last.
2. **Section 5.4, a window kept.** A movable stop keeps its own window when the new arrival still falls inside it, so a plan moves the fewest households for the same driving.
3. **Section 5.4, the floor.** No new window is placed inside the coming hour, which is the same line `isMovable` draws and now holds for placement too.
4. **Section 4.5, the style.** The basemap's colours are read from the running document's own custom properties, so this is **not** a fourth place a token is written out and `.claude/rules/ui.md` holds here with no exception.
5. **Section 9, the plan's rows.** `PlannedStopRow` carries `wasWindowStart`, so the drawer can send the reorder the window each plan was computed against without holding a second copy of the day.

- [ ] **Step 3: Amend the rest**

- `docs/SEAMS.md`: the routing row and the interface block gain `driveGrid`; the paragraph gains the browser map's own sentence — the map in the coordinator's browser is not this seam, carries no household coordinate to Google, and is described in `docs/SPEC/route-planning.md` section 8.
- `docs/SECURITY.md` item 2: the paragraph naming the one document served with the wider policy, what it grants, why (`'strict-dynamic'` with a per-response nonce; `'unsafe-eval'` on Google's own list), that its referrer is the origin so a referrer-restricted key works, and that `tests/security/headers.test.ts` pins both policies.
- `docs/COMPLIANCE/approved-vendors.md`: the Google Maps Platform row gains the browser map, verbatim from spec section 8.6.
- `docs/RUNBOOK/go-live.md`: `VITE_GOOGLE_MAPS_BROWSER_KEY` in section 1's table, and a step 6b in the operator's own voice — where the browser key comes from, that it is restricted to the map and to the practice's address, that it is baked into the build and not pasted into the running process, and that leaving it out costs the picture and nothing else.
- `docs/STAGING.md` section 6: the same name beside the two `VITE_` build settings.
- `docs/SPEC/OWNERSHIP.md`: a `> Widened for piece seventeen (2026-09-07, docs/SPEC/route-planning.md)` note under the `scheduling` row, naming every file touched outside it, grouped as the round-31 note groups them, and returning `app/api/routing/**` and `app/api/_middleware/routing/**` to this stream for this piece.
- `docs/SPEC/scheduling-manual.md`: section 4.2 marked built and pointing at the new spec; section 8's "No route optimisation" and section 10's "Route solver" amended to say that the day's own order is optimised from piece seventeen, within one day and around the visits already agreed, and that a dispatch board and live tracking stay out.
- `docs/SPEC/practitioner-phone.md`: one sentence under decision 2 — the console has an interactive map from piece seventeen, on its own document; Today keeps the static picture, which is what works with no signal.
- `docs/HANDOVER.md` section 10, item 6(e): the piece built, the pull request number, and the two console acts still owed (the keys and the cap), which are the integrator's at the staging pass and not the builder's.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write docs/
git add docs/
git commit -m "docs: the change request and every document the day map changes"
```

---

### Task 14: The whole gate

**Files:** none new.

- [ ] **Step 1: Rebuild the database from nothing and run every test**

```bash
pnpm db:up
pnpm db:reset && pnpm db:migrate && pnpm seed --fresh
pnpm verify
pnpm test:db
pnpm build
```

Each with a timeout of at least 600 seconds. Expected: all green. `pnpm verify` includes `format:check`, so run `pnpm exec prettier --write .` first if anything is unformatted.

- [ ] **Step 2: Look at it in a browser, with no key**

```bash
pnpm dev
```

Open `http://localhost:5175/admin/schedule?date=<the planning day>`, sign in through the laptop door as the owner, press **Open the day map**. Expected: the five stops listed in the panel, the drive sentence beneath each after the first, "The map needs the practice's browser key.", and **Optimise the day** offering a plan whose figures say `Straight-line estimates.` Apply it with the default reason, then reload: four visits moved, the `confirmed` one unmoved, and the Schedule table showing the new windows.

- [ ] **Step 3: Look at it with a key, if the integrator has supplied one**

Put a browser key in the worktree's own git-ignored `.env` as `VITE_GOOGLE_MAPS_BROWSER_KEY`, restart `pnpm dev`, and reload the map. Expected: a light achromatic basemap, five numbered pins and the base, hairline lines between them and a drive label on each. **If no key has been supplied, stop here and say so in the report** — this is the integrator's console act, not the builder's, and no key is ever put into the repository.

- [ ] **Step 4: Prove nothing else moved**

```bash
git diff --stat origin/main
git status --short
```

Expected: nothing outside the file list of this plan; `docs/CHANGE-REQUESTS/scheduling-05.md` naming every shared-zone file; no `.env`, no key, no `node_modules`.

- [ ] **Step 5: Open the pull request**

```bash
git push -u origin scheduling-5
gh pr create --base main --head scheduling-5 \
  --title "Piece seventeen: the day map and the optimised day" \
  --body "$(cat <<'BODY'
Builds `docs/SPEC/route-planning.md` Part A, approved by the operator on 7 September 2026 at 22:54.

**What it adds.** A full-screen map of one day in the console, numbered pins in time order with the drive between them, and one button that finds the order of the day's `proposed` visits that drives least and applies it through the existing move rule, leaving every agreed visit where it is.

**What it does not touch.** No migration, no policy file, no schema change. Nothing on the practitioner's phone: Today keeps the static picture that works with no signal.

**The one widening.** `/admin/schedule/map` is served with its own content security policy and a per-response nonce, because Google's map needs `'strict-dynamic'` and `'unsafe-eval'`. Every other document, the phone app included, carries exactly the policy it carried before, and `tests/security/headers.test.ts` pins both.

**Shared-zone edits** ride here, listed in `docs/CHANGE-REQUESTS/scheduling-05.md`.

**Still owed, and the integrator's not the builder's:** re-restricting the practice's two Google keys and setting the spending cap, at the staging pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 6: Write the record**

Post one comment on the pull request in the shape piece eleven's record uses: what was built, task by task; every file touched outside the stream's own paths; what was checked and what came back; the agents used and their approximate token use; and the two things left for the staging pass.

---

## Self-review, run against the spec before the first task

- **Spec coverage.** Section 4.1 → Task 10 (the anchor, the route, the blocked-load sentence). 4.2 → Task 10 (the panel, the toggles, no hue). 4.3 → Task 9. 4.4 → Task 10. 4.5 → Task 8, amended. 4.6 → Task 8. 4.7 → nothing to build: the worker's navigation handler is already network-first. 5.1–5.2 → Task 11. 5.3–5.5 → Task 3. 5.6 → Task 4. 5.7 → Task 6. 6.1–6.3 → Tasks 5 and 6. 7 → Task 1. 8.1–8.4 → Task 7. 8.5–8.6 → Task 13 (documents) and the integrator's console act. 9 → Tasks 5 and 6. 10 → nothing to build. 11 → nothing to build. 13 → Tasks 10 and 11. 14 → Tasks 12 and 14. 15–16 → the code's own comments. 17 → Task 13.
- **Not built, on purpose, and named so nobody looks for them:** the practitioner picker's colours (numbers and initials only); `planned_arrival`; road geometry on the lines; a settings field for the home base.
- **Types across tasks.** `Matrix`, `PlanStop`, `PlanBase`, `DayPlan` and `PlanRefusal` are declared once in Task 3 and used by Tasks 4, 5 and 11 under those names; `DriveEstimate` and `DriveFactors` are the seam's own, unchanged; `DayLegRow` is the existing wire row and is reused rather than re-declared; `AppointmentRow` is the existing one.
- **Part B, the week planner, is a separate plan** written after this piece is on staging.
