# SPEC — Route planning: the day map, the optimised day, the week planner (pieces seventeen and eighteen)

*Worktree: `scheduling`. Entities: `appointment`, `drive_estimate`; reads
`practitioner`, `location`, `service_type`, `client`. Approved by the plan
`docs/PLAN/route-planning.md` when the operator approves it. Part A is piece
seventeen; part B is piece eighteen and builds after A is on staging.*

## 1. Purpose

The coordinator can see one day on a map, see what each drive between stops
costs in minutes, and, on one press, put the day's not-yet-agreed visits in
the order that drives least. Later, when booking, she can see which day and
which window add the least driving for a given household. Every figure is an
estimate and says so; nothing moves that a household has been told about;
what leaves the server for Google stays coordinates and a time.

The operator's decisions of 7 September 2026, 22:40: the map and the
optimisation live in the admin console and Today keeps its static picture;
Optimise re-times `proposed` visits and keeps confirmed ones as anchors; the
Flutter app's key is repurposed as the browser key; the scope includes a week
planner.

## 2. What exists on `main`, and what this adds

**Exists.** The routing seam (`domain/shared/routing.ts`, `docs/SEAMS.md`):
`driveMatrix(legs, factors)` and `dayPicture(points)`, a Google
implementation (Routes API compute route matrix, Maps Static API) and a
straight-line fallback, chosen by `ROUTING_PROVIDER`. The cache
`drive_estimate` (migration 204) keyed by two locations and an hour bucket,
fresh for thirty days. `GET /api/routing/day` and `day-picture` for the
practitioner's own day; `domain/scheduling/legs.ts` building the day's legs;
Today rendering the lines and the picture. The Schedule page (a table for one
day), the Week page (read only), the New appointment, Move and Cancel drawers;
`POST /api/appointments/:id/move` (two rows, never an edit; `x-reason`
required). The content security policy in
`app/api/_middleware/security.ts`, pinned by `tests/security/headers.test.ts`.
Production runs `ROUTING_PROVIDER=google` with the server key "McWellness
desk and platform server".

**Adds, part A.** A grid call on the seam. A practice-scope routing read and
an optimise call. A reorder route that applies a plan through the move rule.
The pure rule `optimiseDay`. The day map page with its own security policy,
loading Google's Maps JavaScript API under a browser key. **Adds, part B.**
The pure rule `bestInsertion`, an insertions read, the Plan a visit page, and
the hint in the New appointment drawer.

**No migration, no policy file, no new table.** The cache table already has
the shape the grid needs and its policies already admit owner, admin and lead
practitioner writes. Plans are applied as appointment rows the move rule
already writes.

## 3. Who uses it

Owner, admin and lead practitioner: the roles `canOpenSchedule` admits
(`appointment.list`, scope `practice`). A practitioner without those roles
sees none of it; their Today is unchanged. Finance and client contacts: nothing.

## Part A — piece seventeen

## 4. The day map

**4.1 Where.** `/admin/schedule/map?date=YYYY-MM-DD`, reached from the
Schedule page header by a plain anchor ("Day map"), beside the existing
"Week" link. A plain anchor and not a router `Link`, deliberately: the map
page is served as its own document with its own security policy (section 8),
and a client-side navigation would carry the strict policy into it and the
map would not load. The map page's own links back ("Schedule", the rail) are
plain anchors for the same reason. The page detects a blocked script load
(section 4.6) and says "Open the day map from the Schedule page", with the
anchor.

**4.2 The screen** (`docs/DESIGN-BRIEF.md` 6.2: "the one full-bleed
screen"). The map fills the viewport; the day's list overlays the inline
start as a panel of the ledger's own rows (44px, hairline rules); the page
header, date and the Optimise button sit above the panel. Practitioner
toggles appear only when the day has more than one practitioner. No hue for
practitioners: pins carry the stop number, and the practitioner's initials
when more than one is shown (the brief reserves hue for the bands and the
three status states).

**4.3 What is drawn.** Per shown practitioner: the home base as a pin marked
"H" when recorded; each stop as a pin numbered in time order; a hairline
straight polyline from each place to the next in order (the scheduling
specification's own 4.2: straight lines, not road geometry); at each line's
midpoint the estimate, "about 25 min", or "– –" until it arrives. Pins and
labels are the app's own DOM, positioned with `google.maps.OverlayView`
(supported, no Map ID needed); the lines are `google.maps.Polyline`. Nothing
is drawn with `google.maps.Marker` (deprecated) or `AdvancedMarkerElement`
(needs a Map ID and cloud styling).

**4.4 The list.** The same rows and the same facts as the Schedule table
(`AppointmentRow`), in window order, with the stop number at the start; the
drive line beneath each row from the second onwards ("about 25 min, 18 km,
estimate from traffic" or "about 25 min, straight-line estimate", the Today
wording). Click a pin: its row is emphasised and scrolled into view. Click a
row: the map pans to its pin. Each open row offers Confirm, Move and Call off
through the existing drawers, which are reused unchanged.

**4.5 Style.** The basemap is styled with the JSON `styles` option, light and
achromatic: saturation removed everywhere, roads at `--rule`, labels at
`--slate` on `--paper`, water at `--surface`, points of interest and transit
off, administrative geometry off. `disableDefaultUI: true`; the app draws its
own zoom buttons from the shell's controls; Google's attribution and terms
link remain as the API renders them. `colorScheme` stays light: the admin
console is the light ground.

**Amended in the build, 2026-09-07:** this is **not** a fourth place a
token's value is written out. `app/admin/schedule/map/mapStyle.ts` reads the
running document's own custom properties with `getComputedStyle`, so the
basemap follows `app/shell/tokens.css` with no copy at all and
`.claude/rules/ui.md`'s "never hardcode colours" holds here with no
exception. `docs/SPEC/practitioner-phone.md` 3.1 still names three places,
and this piece adds none.

**4.6 Loading Google.** `app/admin/schedule/map/googleMaps.ts` exports
`loadGoogleMaps(key, options)`: one script element per document,
`https://maps.googleapis.com/maps/api/js?key=…&v=quarterly&loading=async&callback=…&language=en&region=AE`,
with `nonce` copied from the first `script[nonce]` in the document (the shell
tag the API stamps, section 8.2) and
`referrerpolicy="strict-origin-when-cross-origin"`. Resolves with the
`google.maps` namespace on the callback; rejects on `error` or after eight
seconds. The version channel is `quarterly`, pinned in one constant. The key
is `import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY`, baked at build as
`VITE_SUPABASE_ANON_KEY` is; blank means "no map": the page shows the list
and the line "The map needs the practice's browser key", and Optimise still
works. A rejected load shows "The map could not be loaded" with a retry. The
loader is injected into the page component so tests never reach the network.
`@types/google.maps` is added as a development dependency, audited weekly.

**4.7 Offline.** The console is online-only. The worker's navigation handler
is network-first (`app/shell/sw.ts`), so the map document arrives from the
network with its own headers; the cached shell is used only offline, where the
map cannot load anyway.

## 5. The optimised day

**5.1 The button.** "Optimise the day" in the map page header, enabled when
the shown practitioner's day has at least two stops of which at least one is
movable (5.3). It asks `POST /api/routing/practice-day/optimise` and opens
the Optimise drawer (right side, beside rule) with the plan.

**5.2 The drawer.** Before anything changes: two rows of figures, "Now" and
"After": total driving in minutes and kilometres, and when the day ends; the
saving in minutes; the source line, "estimate from traffic", "straight-line
estimate" or "partly straight-line"; then the new order as a table, one row
per stop with the old window and the new window, anchors marked "kept
(confirmed)" or "kept (already begun)"; a reason field prefilled "Day
optimised on the map"; and Apply. On success: "N visits moved. The households
have not been told." and the map redraws. On a refusal from the rule: its
sentence (5.5) and no Apply. On `stale_plan` (6.3): "The day changed while
you were looking. Reload the day." Every drawer wording is English, per the
7 September rule.

**5.3 What moves.** A stop is **movable** when its status is `proposed` and
its `window_start` is later than now plus sixty minutes. Every other stop on
the day (`confirmed`, `checked_in`, `completed`, `no_show`, and a `proposed`
stop already within the hour or behind) is an **anchor** and keeps its
window. Cancelled and rescheduled rows are not on the day.

**5.4 The rule** — `optimiseDay(day, matrix, options)` in
`domain/scheduling/optimise.ts`, pure, no clock read (`now` is an argument),
tested with fixed matrices.

```
type PlanStop = {
  id: string; status: AppointmentStatus; windowStart: Date; windowEnd: Date;
  durationMinutes: number; locationId: string; point: GeoPoint;
};
type PlanBase = { locationId: string; point: GeoPoint };
type Matrix = (fromLocationId: string, toLocationId: string, departAt: Date) => DriveEstimate;
type DayInput = { stops: readonly PlanStop[]; homeBase: PlanBase | null; now: Date; timeZone: string };

optimiseDay(day: DayInput, matrix: Matrix): DayPlan | PlanRefusal
```

- **Planned arrival is the top of the window**, and departure is planned
  arrival plus the service's `durationMinutes`. For a movable stop planned
  arrival is its new `windowStart`; for an anchor it is the later of its
  `windowStart` and the arrival the previous leg allows, and if that arrival
  is later than the anchor's `windowEnd` the ordering is infeasible. This is
  the rule of the plan, not of Today's lines: `legs.ts` keeps its pessimistic
  hour (`windowEnd` plus duration) for the estimate it asks for, and the two
  differ only in which hour's traffic is looked up. `planned_arrival`
  (data model section 5) is not added: nothing reads it yet (section 15).
- **Home base first and last.** With a base recorded, the first leg is base
  to first stop, departing so as to arrive at the first window's start, and
  a return leg from the last stop to base is counted in the sum and in the
  day's end. Today draws no return leg and this does not change that.

  **Where a base comes from, from 2026-09-08:** Settings › Practitioners
  (`app/admin/settings/PractitionersPage.tsx`, `PUT
  /api/practitioners/:id/base`, migration 913). A practitioner sets their own
  and the office sets anybody's; before that round the only way was a data
  step (decision 14, overturned). Nothing in the arithmetic above changes: a
  day with no base still has no first leg and no return.

  **Amended in the build, 2026-09-07:** the day ends at the **last stop's
  departure** — its planned arrival plus the service's own length — and not
  at the arrival home. The return leg still counts in the driving sum. With
  the return in the end time, almost every better order was refused for
  "ending later", because the order that drives least puts the far household
  last and the drive back from it is the longest of the day.
- **The day's bounds are its own.** The earliest new `windowStart` is not
  before the current earliest `windowStart` of the day, and no new
  `windowStart` is before `now` plus sixty minutes; the new day's end (the
  last departure) is not later than the current plan's end computed the same
  way. No working hours exist yet.

  **Amended in the build, 2026-09-07:** the floor is placement as well as
  eligibility. No new `windowStart` is placed inside the coming hour, which
  is the same line `isMovable` draws for what may move at all.
- **A window kept.** **Amended in the build, 2026-09-07:** a movable stop
  keeps its own current window when the new arrival still falls inside it,
  and takes a new one only when it does not. A plan then moves the fewest
  households for the same driving, which is what the tie-break on moves was
  always for.
- **Quarter hours.** Each movable stop's new `windowStart` is the earliest
  arrival rounded up to the quarter hour in the practice's zone
  (`ceilToQuarterHour` in `domain/scheduling/grid.ts`; Asia/Dubai has no
  daylight saving and a whole-hour offset, so the rounding is plain UTC
  arithmetic and the test says so); `windowEnd` is `windowFor(start).end`.
- **Objective and ties.** Minimise total drive seconds over all legs, then
  the earlier day's end, then the fewer moves, then the current order.
- **Search.** Exhaustive over orderings of the stops in which anchors keep
  their chronological order; movable stops may take any position. At most
  ten stops on the day; more is `too_many_stops`. Ten stops with no anchors
  is 3.6 million orderings and well under a second; the seeded practice never
  exceeds six.

  **Amended in the fix round, 2026-09-08:** at most **eight** stops on the
  day, not ten, and the sentence above was wrong about the cost. Ten stops
  with no anchors is 3.6 million orderings and is nowhere near a second: the
  review of this piece measured eight at 8.5 s and gave up on ten after
  twelve minutes.

  The figure that decides the ceiling is not how long the arithmetic takes
  to finish but how long one request may hold the process. `optimiseDay` is
  synchronous and awaits nothing, so while it runs Node answers nothing else
  in the practice — not a practitioner's check-in on the road, not
  `/api/health/deep`, not the portal — and `timeout(REQUEST_TIMEOUT_MS)`
  cannot fire either, because its timer cannot run. It also runs inside the
  request's open transaction, so a pooled connection is held for the same
  span.

  Measured on this branch after the zone formatters were hoisted (below), on
  a day whose stops lie along one road and so prune well: six 0.01 s, seven
  0.03 s, eight 0.20 s, nine 1.6 s, ten 18 s. A day that prunes badly costs
  more — the guard test's own eight-stop day took 7.5 s before this round
  and about a third of a second after. Eight is what a request may spend on
  the bad days as well as the good ones; the practice does at most six stops
  in a day (`docs/SPEC/practitioner-phone.md` section 5.5), so the ceiling is
  still well past the real day.

  The second half of the fix is in `domain/shared/routing.ts`: `hourBucket`
  and the weekday reading behind `isPeakHour` hold one `Intl.DateTimeFormat`
  per zone instead of building one per call. A formatter costs about
  thirty-five microseconds to build and almost nothing to use, and the
  matrix calls `hourBucket` once per leg per walk.
- **Travel buffer.** Each stop's `travelBufferMinutes` becomes
  `travelBufferFor(driveSecondsToNext)` (`domain/scheduling/buffer.ts`, the
  scheduling specification's rule 6.2: the drive in whole minutes rounded up
  plus ten, clamped to 15–90); the last stop keeps 15. Anchors keep their
  buffer.
- **Source.** `traffic` if every leg used was traffic, `straight-line` if
  every one was straight-line, `mixed` otherwise.
- **Output.**

```
type Totals = { driveSeconds: number; driveMetres: number; dayEnd: Date };
type DayPlan = {
  kind: 'plan';
  stops: { id: string; windowStart: Date; windowEnd: Date; travelBufferMinutes: number; moved: boolean; anchor: boolean }[];  // in the new order
  before: Totals; after: Totals; savedSeconds: number;
  source: 'traffic' | 'straight-line' | 'mixed';
};
type PlanRefusal = { kind: 'refusal'; reason: 'nothing_to_move' | 'no_improvement' | 'infeasible' | 'too_many_stops' };
```

`no_improvement` when the best feasible ordering saves nothing;
`infeasible` when no ordering satisfies the anchors and the bounds (the
current order always does unless it is already late, which is reported as
`infeasible` too and the drawer says "The day cannot be improved around the
confirmed visits").

**5.5 Sentences for refusals** (in the drawer): `nothing_to_move` "Every
visit today has been agreed with its household, or is already under way."
`no_improvement` "This order already drives least." `infeasible` "The day
cannot be improved around the confirmed visits." `too_many_stops` "More than
ten stops in a day is not optimised."

**Amended in the fix round, 2026-09-08:** `too_many_stops` reads "More than
**eight** stops in a day is not optimised." — the ceiling 5.4 now sets, for
the reason it gives there: the search is exhaustive and synchronous, so what
it may cost is what one request may spend without stopping everything else.

**5.6 The matrix behind the rule.** `app/api/routing/practice-day.ts` fills
a total function from the cache and the seam before calling the rule, so the
rule never waits on I/O:

- The places are the distinct navigation targets of the day's stops and the
  base (`navigationTarget`, parking point else entrance).
- The hour buckets are those from the day's first `windowStart` hour to the
  last current departure hour plus two, capped at twelve.
- For each bucket, every pair already fresh in `drive_estimate` (thirty days)
  is read; if any pair is missing, the seam's `driveGrid` is asked for the
  whole grid departing at that bucket's half hour on the day, in the
  practice's zone, and every answer is written back with the
  cache's `on conflict` upsert (`WRITE_SQL` in `day.ts`, moved to
  `app/api/routing/estimates.ts` with `readFactors` and the cache read, and
  used by `day.ts` unchanged).
- A bucket the schedule reaches that was not asked for falls back to the
  nearest asked bucket.
- The vendor down: the buckets that answered are used and the rest come from
  the straight-line arithmetic with the practice's factors, and `source`
  says `mixed`. A day with no cached figure and the vendor down is answered
  by the fallback whole, `straight-line`.

At six places and nine buckets this is at most 9 × 36 = 324 elements the
first time a day is optimised and none for the same pairs and hours within
thirty days; Google's ceiling on one call is 625 elements, enforced in
`driveGrid` (section 7).

**5.7 Applying** — `POST /api/appointments/reorder` (section 9), which the
drawer calls with the plan's moved stops and the reason. The route runs
each move through the move rule in the request's one transaction: all the
old rows are retired first, then each new row is checked with
`checkConflicts` against the practitioner's and the client's other live
rows, where "other" is every live row not in the plan plus the new rows
inserted so far, then inserted with `rescheduled_from_id`. Any conflict or
any exclusion violation is **raised**, never returned, so the transaction
rolls back whole (a returned refusal would commit the retirements): an
`HTTPException` carrying the 409 body, the way `timedOut()` in
`security.ts` carries its 504. The new
rows keep `proposed`. The per-visit logic is extracted from `move.ts` into
`app/api/appointments/move-one.ts` and `move.ts` calls it; its behaviour and
its tests do not change.

## 6. The practice-day read, and its guards

**6.1** `GET /api/routing/practice-day?date=` answers, for every
practitioner with a stop that day, the base and the stops as opaque ids and
coordinates, and the legs in the day route's own `DayLegRow` shape, from the
cache and the seam exactly as `day.ts` does for one practitioner. The
statuses are the Schedule table's: `proposed`, `confirmed`, `checked_in`,
`completed`, `no_show`. Names are not here: the page already holds
`GET /api/appointments?date=&scope=practice`, whose read is what the trail
records, and this answer is about the road. No client row is read, so no
audit row is written, the reasoning `day.ts` records.

**6.2** `POST /api/routing/practice-day/optimise` `{ date, practitionerId }`
answers `DayPlan | PlanRefusal` in wire form (ISO datetimes). It writes only
the cache. Refused with 403 to a caller without the calendar role.

**6.3** The reorder carries, per move, `wasWindowStart`: the window the plan
was computed against. A row whose `window_start` no longer matches, or whose
status is no longer `proposed`, or which has an open session, refuses the
whole request with 409 `stale_plan`; the drawer says so (5.2). The `x-reason`
header is required, as on a move.

## 7. The seam, extended

`domain/shared/routing.ts` gains one call on `RoutingProvider`:

```
driveGrid(origins: readonly GeoPoint[], destinations: readonly GeoPoint[], departAt: Date, factors: DriveFactors): Promise<DriveEstimate[][]>
```

Rows in origin order, columns in destination order. `GRID_MAX_ELEMENTS =
625` beside it; a larger grid is refused with `RoutingUnavailableError`
before anything is sent. `straightLineGrid` is the pure arithmetic beside
`straightLineMatrix`. The Google implementation sends one compute-route-matrix
request with all origins and all destinations, the same field mask, modifiers
and `departureTime` rule as `driveMatrix`, and reads every element by its
two indexes. `driveMatrix` and `dayPicture` are unchanged. `seam.test.ts`
gains the grid cases and a forced-fallback case for the practice-day route.
`docs/SEAMS.md`'s row and interface block are amended.

## 8. The map document's security policy

**8.1 Why a second policy.** Google's Maps JavaScript API needs directives
the console's strict policy refuses (`script-src 'self'`; no third-party
host anywhere). Google documents two policies; the strict one uses a nonce
and `'strict-dynamic'`. The widening is confined to the documents that need
it, named one by one, never guessed from a prefix. From piece seventeen that
was the day map alone; from trunk round 43 it is two: the day map and the
pin picker (`/admin/clients/pin`), which needs the same script to draw its
own marker and its address search.

**8.2 Mechanism.** `securityHeaders` gains `mapDocumentPaths` (the trunk
passes `MAP_DOCUMENT_PATHS`, `app/api/_middleware/security.ts`, which from
trunk round 43 lists both `/admin/schedule/map` and `/admin/clients/pin`).
For a `GET` whose path is exactly one of them, the middleware mints a nonce
(`randomBytes(16)`, base64), sets it as
`cspNonce` on the context (`ApiEnv` gains the variable) and sends the map
policy below; every other path sends the strict policy unchanged.
`mountApp`'s catch-all reads `cspNonce` and, when present, serves the shell
with `nonce="…"` added to every `<script` and `<link rel="modulepreload"`
tag; otherwise the shell as today. The map page's own loader copies the
nonce from that tag (4.6). Google's API applies it to what it injects.

**8.3 The map policy**, Google's strict list plus the app's own:

```
default-src 'self';
script-src 'nonce-N' 'strict-dynamic' https: 'unsafe-eval' blob:;
style-src 'self' 'nonce-N' https://fonts.googleapis.com;
img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com *.google.com *.googleusercontent.com;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self' <the Supabase origin> https://*.googleapis.com *.google.com https://*.gstatic.com data: blob:;
frame-src *.google.com;
worker-src 'self' blob:;
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';
```

`'unsafe-eval'` is on Google's own list and is the one grant the practice
would rather not make; it applies to this document alone. The map
document's `Referrer-Policy` is `strict-origin-when-cross-origin` rather
than `no-referrer`: the browser key is restricted by HTTP referrer (8.5) and
a request with no referrer is refused by Google; only the origin crosses,
and no URL of the app carries personal data (`.claude/rules/ui.md`). Every
other header stays as it is.

**8.4 Tests.** `tests/security/headers.test.ts`: `/admin/schedule/map`
carries the map policy with a nonce, two requests carry two nonces, the
shell's script tags carry that nonce (`static.test.ts`), and `/admin/clients`,
`/today`, `/api/health` and `/nothing` carry exactly the strict policy
pinned today. `docs/SECURITY.md` item 2 gains the paragraph.

**8.5 The keys**, a console act done with `gcloud` at the staging pass, by
the operator's decision of 7 September:

- The Flutter key (uid `face28b8…`, "McWellness app key") is renamed
  "McWellness browser map key", API-restricted to the Maps JavaScript API
  (`maps-backend.googleapis.com`) only, and referrer-restricted to
  `https://app.mcwellnessuae.com/*`, `http://localhost:*/*` and
  `http://127.0.0.1:*/*`, with a hosted staging address added if one
  appears. The old Flutter builds stop showing maps at that moment.
- The server key (uid `4ec65b5c…`) loses `maps-backend.googleapis.com`,
  which it never used, keeping Routes, Static Maps and Geocoding.
- Recommended caps (plan decision 2): 500 map loads and 3,000 matrix
  elements per day on the project.
- The value reaches builds as `VITE_GOOGLE_MAPS_BROWSER_KEY`: `.env.example`
  blank with a comment; the runbook's section 1 table and a step 6b; the
  go-live script's list; the staging notes. Never in the repository.

**8.6 The vendor row.** `docs/COMPLIANCE/approved-vendors.md`, Google Maps
Platform, gains: "From piece seventeen the coordinator's browser loads the
Maps JavaScript API under a browser key restricted to the practice's own
address; Google receives the browser's IP address, the map viewport and the
key, as any map page sends. The pins and lines are drawn by the app; no
household coordinate is sent to Google by the map. The grid request from
the API carries the coordinates of the day's places and one departure time."
Trunk round 43 amends the same row again, for the pin picker's address
search — see `docs/COMPLIANCE/approved-vendors.md` itself for the wording.

## 9. API (part A)

| Route | Who | Body / query | Answers |
|---|---|---|---|
| `GET /api/routing/practice-day` | owner, admin, lead | `date` | `{ practitioners: [{ practitionerId, homeBase: { locationId, point } \| null, stops: [{ appointmentId, locationId, point, windowStart, status }], legs: DayLegRow[] }] }` |
| `POST /api/routing/practice-day/optimise` | owner, admin, lead | `{ date, practitionerId }` | `DayPlan \| PlanRefusal` (wire form) |
| `POST /api/appointments/reorder` | owner, admin, lead; `x-reason` | `{ date, practitionerId, moves: [{ appointmentId, windowStart, travelBufferMinutes, wasWindowStart }] }` | `{ appointments: AppointmentRow[], movedFrom: [{ id, windowStart }] }`; 409 `stale_plan`; 400 `reason_required` \| `invalid_request`; 409 `ConflictResponse` on a conflict |

**Amended in the build, 2026-09-07:** the plan's own rows carry
`wasWindowStart` as well — `PlannedStopRow` in `app/api/routing/schema.ts` is
`{ appointmentId, windowStart, windowEnd, wasWindowStart, travelBufferMinutes,
moved, anchor }` — so the drawer can send the reorder the window each plan was
computed against without holding a second copy of the day beside the plan.

Shapes in `app/api/routing/schema.ts` and `app/api/appointments/schema.ts`.
`practice-day` and `optimise` mount from `app/api/routing/practice-day.ts`
through the existing `mountRouting`; `reorder` from
`app/api/appointments/reorder.ts` through `mountAppointments`.

## 10. Permissions and row security

No policy changes. The read routes check `appointment.list` with scope
`practice` through `canActor`; the reorder checks the calendar role and, per
visit, `appointment.create` on the new date as `move.ts` does. The cache's
policies already admit owner, admin and lead practitioner to insert and
update (`db/policies/scheduling/drive_estimate.sql`). Row security scopes
every read to the practice.

## 11. Audit, erasure, retention

A reorder writes the same rows a move writes, under the same reason stamp,
so the trail carries the same sentences; nothing new is narrated. The
routing reads read locations and the cache and no client row, so they write
no audit row, as `day.ts` records. The cache names no person; erasure and
retention are unchanged.

## Part B — piece eighteen

## 12. The week planner

**12.1 The rule** — `bestInsertion(day, candidate, matrix)` in
`domain/scheduling/insertion.ts`, pure and tested. Given one practitioner's
stops for a day (all statuses on the day are anchors here), the base, and a
candidate `{ locationId, point, durationMinutes }`, it tries every gap:
before the first stop, between each pair, after the last. For a gap the
arrival is the previous departure plus the drive to the candidate (from the
base for the first gap, departing to arrive at the day's first window when
there is no earlier stop); the candidate's `windowStart` is that arrival
rounded up to the quarter hour, its departure `windowStart` plus duration;
the gap is feasible when the next stop is still reached by the end of its
window. Planned arrival and departure follow 5.4. The gap's cost is the drive
seconds added: to the candidate plus onwards, less the drive it replaced,
counting the return to base after a last gap. The best gap is the least
added seconds, then the earlier window. A day with no stops answers the
drive from the base, or "any time" without one. Output:

```
type Insertion = { kind: 'slot'; windowStart: Date; windowEnd: Date; addedSeconds: number; addedMetres: number; after: string | null; before: string | null; source: DriveSource | 'mixed' }
                | { kind: 'none'; reason: 'no_gap_fits' | 'too_many_stops' }
```

**12.2 The read.** `GET /api/routing/insertions?clientId=&practitionerId=&locationId=&serviceTypeId=&from=YYYY-MM-DD&days=14`
(owner, admin, lead; `days` 1 to 28; the location must be that client's own
or the studio, checked as `create.ts` checks `location_mismatch`; the service
gives the duration). One answer per day, computed with
the matrix filled as 5.6 fills it, from the cache first; the legs a gap needs
are known before any call, so the calls are batched by hour bucket. It
writes only the cache and reads no client row.

**12.3 The screen.** `/admin/schedule/plan`, "Plan a visit", reached from the
Schedule header beside "Day map"; a router route, no special policy. Choose
the client (the New appointment drawer's own search, extracted to a shared
component within the stream), the service, the address (the client's, primary
first, or the studio), the practitioner (those credentialed, as the options
route lists; preselected when there is one), and the first day (tomorrow by
default). Then a table of `days` rows: the day; what is booked (count and the
emirates); the suggested window; the driving added, "about 12 min"; the source
word; and "Book", which opens the New appointment drawer with `initial`
props: client, service, location, practitioner, date and start. The drawer
gains those optional props and behaves as before when they are absent. A row
that cannot fit says "No window fits around the visits already booked."

**12.4 The hint in the drawer.** Once client, service, location, practitioner
and date are chosen, the drawer asks `insertions` for that one day and shows
"Least driving on Tue 9 Sep: 14:00 to 14:45, adds about 12 min" with "Use
this time", which sets the start field. It never sets it unasked. With the
fallback the line ends "straight-line estimate".

## 13. Screens summary, both parts

| Route | Page | Owner |
|---|---|---|
| `/admin/schedule/map?date=` | `app/admin/schedule/map/DayMapPage.tsx` (`DayMap.tsx`, `StopOverlay.ts`, `googleMaps.ts`, `mapStyle.ts`, `OptimiseDrawer.tsx`, `map.css`) | scheduling |
| `/admin/schedule/plan` | `app/admin/schedule/plan/PlanVisitPage.tsx` (`plan.css`) | scheduling |
| Schedule header | two anchors, "Day map" (plain anchor) and "Plan a visit" (router link) | scheduling |

## 14. Seed, tests, done when

**Seed.** `db/seed/generate.ts` adds a planning day, two days after the
seed's own today: five `proposed` stops for the seeded practitioner across Dubai,
Sharjah and Abu Dhabi households in a deliberately poor order, one of them
`confirmed` at 12:00 as an anchor. The seeded practitioner already has a base.

**Tests.** `domain/scheduling/optimise.test.ts`: a fixed four-place matrix
where the best order is known; an anchor that forces the order; the day's
bounds refusing a longer day; `no_improvement`; `too_many_stops`; the quarter
hour; the buffer rule. `buffer.test.ts`, `grid.test.ts`, `insertion.test.ts`
likewise. `tests/scheduling/db/practice_day.test.ts`: the read under each
role, the cache filled from a fake seam grid, the fallback whole when the
seam throws. `tests/scheduling/db/reorder.test.ts`: a plan applied writes
two rows per moved stop with `rescheduled_from_id`, anchors untouched, the
reason on the trail, `stale_plan` on a changed window, whole rollback on a
conflict (the exclusion constraint fired by a deliberate overlap).
`tests/scheduling/DayMapPage.test.tsx` and `OptimiseDrawer.test.tsx` with an
injected fake `google.maps` (`Map`, `OverlayView`, `Polyline`,
`LatLngBounds` as small classes): pins numbered, lines labelled, the
no-key line, the blocked-load line, the drawer's figures and refusal
sentences. `PlanVisitPage.test.tsx` and the drawer's hint. `seam.test.ts` for
the grid. `tests/security/headers.test.ts` and `static.test.ts` per 8.4.
`tests/lint/console-is-english.test.ts` keeps holding.

**Done when.** On the seeded laptop with `ROUTING_PROVIDER=straight-line`
and no browser key: the map page lists the planning day, says the map needs
the key, and Optimise shows a saving labelled straight-line and applies it,
the confirmed stop unmoved, the trail carrying the reason. With a browser key
in `.env`: the map draws five numbered pins, the base and four labelled
lines. Every other document carries today's policy exactly. `pnpm verify`,
`pnpm test:db` and `pnpm build` green. On staging with the real seam: the
same day optimised "from traffic". Part B: the planner ranks fourteen days
for a seeded client and Book opens the drawer filled in; the drawer's hint
appears and "Use this time" fills the start.

## 15. Decisions taken by default

1. *The map document is its own document.* Confining the widened policy to
   one path costs two plain anchors and a nonce; the alternative widens the
   phone app's policy for a map it never shows.
2. *Overlays, no Map ID.* `OverlayView` for pins and labels, `Polyline` for
   lines, JSON `styles` for the basemap. Advanced markers need a Map ID and
   cloud styling the practice would have to manage in the console.
3. *Quarterly channel*, one constant.
4. *No hue per practitioner.* Numbers and initials.
5. *The top of the window is the planned arrival* in the plan's arithmetic;
   `legs.ts` keeps its pessimistic hour for Today's estimate; `planned_arrival`
   stays unbuilt.
6. *The drive home counts* in the objective when a base is recorded.
7. *The day is its own bound*: never earlier, never later.
8. *Anchors are everything not `proposed`, and any `proposed` stop within the
   hour.*
9. *Exhaustive search, ten stops at most.* **Amended in the fix round,
   2026-09-08: eight at most** (5.4), because a synchronous exhaustive search
   blocks every other request in the practice while it runs.
10. *The buffer is the drive plus ten*, rule 6.2 as written.
11. *One grid per hour bucket, cached*, rather than one representative hour:
    migration 204's own reason.
12. *The reason defaults to "Day optimised on the map"* and is editable.
13. *The referrer policy on the map document is origin-only*, so the key can
    be referrer-restricted.
14. *The home base reaches production by a data step*, not a settings field.
    **Overturned on the operator's instruction, 2026-09-08 03:16 Dubai:** *"This
    is Shauna's home, every practioner can add their own address."* The field
    exists — Settings › Practitioners, `PUT /api/practitioners/:id/base`,
    migration 913 — and a practitioner sets their own base while the owner, an
    admin and the lead practitioner set anyone's (`domain/shared/actor.ts`,
    `practitioner.base.write`). The data step that put the founder's own base on
    production stands; what changes is that it is no longer the only way. The
    practice keeps the coordinate and the emirate and nothing else: no address,
    no access notes, no Makani number, because a base is a member of staff's own
    home rather than a household the practice visits — and, from migration 914,
    not in the audit trail either, which keeps the fact of the change and not
    the point. The rail's Settings entry is offered to anyone who may open
    either settings screen and lands on the first one they may open
    (`settingsHomeFor`, `app/shell/adminAccess.ts`), so a lead practitioner and
    a practitioner standing in the console have a door to it and not only an
    address they could type. And a practitioner whose only screen is `/today`
    has one on that screen: **"Your home base"**, beside "Sign out" in the
    account controls of both `app/therapist/today/TodayPage.tsx` and
    `app/therapist/TodayLanding.tsx`, going to `/admin/settings/practitioners`.
    It is shown to whoever `canOpenPractitioners` admits and who does not
    already have the "Admin console" button, so nobody is offered two doors to
    the same place, and "Admin console" goes on meaning "the console is your
    workplace" rather than being widened to mean something else. Sending a
    practitioner into the console is reasonable on two counts: it lays out at
    phone widths (`docs/SPEC/responsive-console.md`, piece nineteen), so a
    phone gets a usable screen and not a desk one; and a home base is one field
    a person sets once, not a flow they live in.
15. *The week planner looks fourteen days ahead*, at most twenty-eight.

## 16. Deliberately left out

A live map on Today; moving confirmed visits; Salik, parking and time-cost
terms (`docs/SPEC/navigation.md` section 4); working hours and Ramadan
tables; re-optimising on a cancellation; **(built 2026-09-08: a settings
field for the base, on the operator's instruction — decision 14)**;
`planned_arrival`; road geometry on the lines; several vehicles; recurring
bookings; an interactive map for households; any tile, script or style from a
third party on any document but the map's.

## 17. Change requests to the shared zone

`docs/CHANGE-REQUESTS/scheduling-05.md` (part A) and `scheduling-06.md`
(part B), each riding in its piece's pull request by the precedent of pieces
seven to eleven:

1. `domain/shared/routing.ts`: `driveGrid`, `GRID_MAX_ELEMENTS`,
   `straightLineGrid`; both implementations and `seam.test.ts` under
   `app/api/_middleware/routing/**`.
2. `app/api/_middleware/security.ts`: `mapDocumentPaths`, the nonce, the
   map policy, the referrer policy on that document;
   `app/api/_middleware/request-context.ts`: `cspNonce` on `ApiEnv`;
   `app/api/serve-app.ts`: the nonce in the shell; `app/api/create-api.ts`:
   the option passed.
3. `app/shell/App.tsx`: routes `schedule/map` and, in part B,
   `schedule/plan`, guarded by `canOpenSchedule`.
4. `.env.example`: `VITE_GOOGLE_MAPS_BROWSER_KEY`; `package.json`:
   `@types/google.maps` (dev).
5. `docs/SEAMS.md`, `docs/SECURITY.md`, `docs/COMPLIANCE/approved-vendors.md`,
   `docs/RUNBOOK/go-live.md`, `docs/STAGING.md`, `docs/SPEC/OWNERSHIP.md`
   (the widening: `app/api/routing/**` and the seam's implementations to
   scheduling for these pieces), `docs/SPEC/scheduling-manual.md` (4.2 built,
   8 and 10 amended), `docs/SPEC/practitioner-phone.md` (a note under
   decision 2), `docs/HANDOVER.md`.

`docs/SPEC/00-data-model.md` is deliberately not edited: nothing in the
schema changes.
