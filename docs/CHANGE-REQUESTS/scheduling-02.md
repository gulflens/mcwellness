# scheduling-02: the Day schedule screen's route and rail link

This pull request builds `app/admin/schedule/SchedulePage.tsx`, so the second
half of `scheduling-01.md`'s item 2 can now be made concrete rather than
illustrative. `app/shell/**` is shared (CLAUDE.md rule 10; this project's own
instructions to the `scheduling` stream), so the route and the rail link are
a change request rather than a direct edit — the same pattern billing's pull
request 16 used for `docs/CHANGE-REQUESTS/billing-01.md` item 2.

## 1. Route the schedule screen under `/admin`

**What.** In `app/shell/App.tsx`, import `SchedulePage` and add a route for
it alongside `clients`.

**Diff.**

```diff
--- a/app/shell/App.tsx
+++ b/app/shell/App.tsx
@@
 import { ClientsPage } from '../admin/clients/ClientsPage';
+import { SchedulePage } from '../admin/schedule/SchedulePage';
 import { PortalLanding } from '../client/PortalLanding';
@@
         <Route index element={<Navigate to="/admin/clients" replace />} />
         <Route path="clients" element={<ClientsPage />} />
+        <Route path="schedule" element={<SchedulePage />} />
```

## 2. Give the rail's "Schedule" entry a destination

**What.** In `app/shell/components/Rail.tsx`, the existing `schedule` entry
in `ADMIN_SECTIONS` (currently rendered disabled with an "Arriving" tag,
because it carries no `to`) gets `to: '/admin/schedule'`.

**Diff.**

```diff
--- a/app/shell/components/Rail.tsx
+++ b/app/shell/components/Rail.tsx
@@
   { key: 'clients', label: 'Clients', to: '/admin/clients', icon: <ClientsIcon /> },
-  { key: 'schedule', label: 'Schedule', icon: <ScheduleIcon /> },
+  { key: 'schedule', label: 'Schedule', to: '/admin/schedule', icon: <ScheduleIcon /> },
```

**Why both together.** Both edits were verified against the real
`SchedulePage.tsx` this pull request ships (not illustrative this time): the
screen was wired into a local copy of `App.tsx` to develop against, then that
edit was reverted before committing (`git status --short` on the
`scheduling-screen` branch shows nothing outside `app/admin/schedule/**` and
`tests/scheduling/**`), exactly as the operator's brief for this pull
request asked. `app/shell/components/Rail.test.tsx` on `main` currently
asserts `queryByRole('link', { name: /Schedule/ })` is null and counts four
"Arriving" sections; once this lands that assertion needs updating to expect
the link and three remaining "Arriving" sections — the same shape update
billing's own change request needed and got.

## 3. A gap this pull request found, not fixed: `domain/shared`'s barrel breaks in the browser

**What.** `NewAppointmentDrawer.tsx` is, as far as this pull request could
find, the first browser-side file in the repository to import from
`@domain/*` anything at all (every other `app/admin` and `app/shell` file
only imports from `app/api/*/schema.ts` and other `app/**` files).
Importing even one named export from `@domain/scheduling` — `WINDOW_MINUTES`,
wanted here to preview the 45-minute arrival window as the coordinator types
a start time — pulls in the whole module through `domain/scheduling/index.ts`,
which re-exports `conflicts.ts`, which imports `@domain/shared`. That
barrel, `domain/shared/index.ts`, does `export * from './identity'`, and
`identity.ts` opens with `import { createCipheriv, createDecipheriv,
createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'` — a Node
built-in Vite cannot bundle for the browser. The result in `pnpm dev` was a
blank screen and `Uncaught Error: Module "node:crypto" has been externalized
for browser compatibility` in the console, not a build failure, so it would
have shipped silently were it not for the operator's own instruction to
open the drawer locally before committing.

**What this pull request did instead.** `NewAppointmentDrawer.tsx` does not
import from `@domain/*` at all: `WINDOW_MINUTES` is kept as a local
`const WINDOW_MINUTES = 45;` literal, commented with exactly this reasoning
and a note that if it and `domain/scheduling/window.ts`'s own constant ever
diverge, that is this gap finally being felt. `domain/shared/**` is
shared-zone (`docs/SPEC/OWNERSHIP.md`); this pull request's hard constraint
was `app/admin/schedule/**` and `tests/scheduling/**` only, so the barrel
itself was left alone.

**Why this is worth the integrator's attention.** The Emirates ID
encryption `identity.ts` carries is legitimately server-only
(`domain/shared/identity.ts`'s own docstring: the master key it derives from
is refused outside development, and the columns it touches are never sent to
the browser). The fix is narrow — either split `domain/shared/index.ts` into
a browser-safe barrel and a server-only one (`identity.ts` moved out of the
default `export *`, re-exported from a `domain/shared/server.ts` instead, or
similar), or give `identity.ts` a lazy/dynamic import so a browser bundle
that never calls its functions never evaluates the `node:crypto` import at
module scope. Either is a `domain/shared/**` edit, so it is the integrator's
or a future shared-zone round's call, not this pull request's. Left as a
plain description rather than a proposed diff, since the two options trade
off differently and the module's own owner should choose.
