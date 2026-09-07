# scheduling-05: the day map, the optimised day, and the one document with a wider policy

This pull request builds piece seventeen: a full-screen map of one day in the
admin console, the drive between stops in minutes, and one button that finds
the order of the day's `proposed` visits that drives least and applies it
through the existing move rule (`docs/SPEC/route-planning.md` Part A,
approved by the operator on 7 September 2026 at 22:54; the operator's own plan
is `docs/PLAN/route-planning.md`). Nothing a household has been told about
moves, every figure on the screen says it is an estimate, and what leaves the
server for Google stays coordinates and a departure time.

Eight things it needs belong to other people: the routing seam and its two
implementations, the actor's action list, the security middleware and the
trunk that assembles it, the shell's route table, the example environment
file, the TypeScript configuration and the development dependency it names,
and the seed (CLAUDE.md rule 10, `docs/SPEC/OWNERSHIP.md`). Each is listed
here rather than assumed. All of them ride in this pull request, as
`docs/SPEC/route-planning.md` section 17 asks.

| # | Where | What | Why | Blocks |
|---|---|---|---|---|
| 1 | `domain/shared/routing.ts`, `app/api/_middleware/routing/**` (trunk) | `driveGrid` on `RoutingProvider`, `GRID_MAX_ELEMENTS = 625`, `straightLineGrid`, and the grid in both implementations | the optimiser prices every pair of places at once; leg-by-leg calls would be one request per pair | the optimiser, entirely |
| 2 | `domain/shared/actor.ts` (trunk) | `routing.practiceDay.read`, answered for owner, admin and lead practitioner | the map shows the day `appointment.list` with scope `practice` already shows | both practice-day routes |
| 3 | `app/api/_middleware/security.ts`, `app/api/_middleware/request-context.ts`, `app/api/serve-app.ts`, `app/api/create-api.ts`, `app/api/server.ts` (trunk) | `mapDocumentPaths`, `MAP_DOCUMENT_PATHS`, the `cspNonce` context variable, and the shell stamped with it | Google's map needs `'strict-dynamic'`, `'unsafe-eval'` and four of its own hosts; exactly one document gets them | the map draws nothing without it |
| 4 | `app/shell/App.tsx` (trunk) | A route for `/admin/schedule/map`, guarded by `canOpenSchedule` exactly as the week is | a reload of that address would otherwise land nowhere | the page is unreachable |
| 5 | `.env.example` (trunk) | `VITE_GOOGLE_MAPS_BROWSER_KEY`, blank, with the comment that says it is a browser key and not the server one | the value is baked at build time as `VITE_SUPABASE_ANON_KEY` is | the map, on a laptop and on staging |
| 6 | `package.json`, `pnpm-lock.yaml`, `tsconfig.json` (trunk) | `@types/google.maps` as a development dependency, and `"google.maps"` in `types` | the namespace is typed rather than cast | the typecheck |
| 7 | `db/seed/generate.ts`, `db/seed/apply.ts`, `db/seed/index.ts` (trunk) | `SeedAppointment`, `SeedData.appointments`, `SeedOptions.planningDay`, and five visits written last | a day map is worth nothing on a day with no visits on it | the demonstration, and Task 14's own walk-through |
| 8 | `tests/security/headers.test.ts`, `tests/security/static.test.ts` (trunk) | The cases that pin **both** policies: the map document's, and every other document's unchanged | a widening nobody pinned is a widening that spreads | the proof that item 3 is confined |

No migration, no policy file and no schema change: `drive_estimate`
(migration 204) already admits owner, admin and lead practitioner, and
`appointment` already carries everything the reorder writes.

---

## Left standing, deliberately

**No migration and no policy file.** The optimiser reads the cache the day
sheet already fills and writes back through its own `on conflict` upsert; the
reorder writes `appointment` rows through the move rule that has been there
since scheduling-04. Nothing here needed a column, and `planned_arrival`
(`docs/SPEC/00-data-model.md` section 5) is still not added because nothing
reads it.

**Nothing on the practitioner's phone.** `app/therapist/**` is untouched.
Today keeps the static picture from `GET /api/routing/day-picture`, which is
what works with no signal and on a device that should not be loading a
third-party map (`docs/SPEC/practitioner-phone.md`, decision 2).

**The week planner is not here.** Part B of the specification — the planner
rows of sections 12 and 13 — is piece eighteen and is planned after this one
is on staging.

**The two Google console acts are the integrator's**, at the staging pass
(`docs/SPEC/route-planning.md` section 8.5): re-restricting the practice's two
keys, and setting the spending cap. No key of any kind is in this repository,
this branch, a log line or a report, and `pnpm verify`'s secrets scan would
catch one if it were.
