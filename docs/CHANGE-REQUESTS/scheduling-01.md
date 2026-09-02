# scheduling-01: mount the appointment routes, then give them a screen

> **Applied in round 5** (2026-09-02, PR 18): item 1, mounting
> `mountAppointments` in `app/api/create-api.ts`, is live. Item 2 (the Day
> schedule screen's route and rail link) stays open, deferred to
> scheduling's second pull request exactly as this file already said.

Two requests from the `scheduling` stream. The first is needed now, so this
pull request's routes are reachable outside the test suite (the database
tests mount them directly on the instance `createApi` returns, per the
operator's direction, so this stream's own tests do not depend on it). The
second is only needed for `scheduling`'s second pull request, once
`app/admin/schedule/SchedulePage.tsx` exists; it is recorded now so the shape
is agreed ahead of time.

## 1. Mount `mountAppointments` in `app/api/create-api.ts`

**What.** Add the import and the mount call, next to the existing
`mountClients`/`mountTimeline` calls.

**Why.** `app/api/create-api.ts` is shared (CLAUDE.md rule 10, this
project's own instructions to the `scheduling` stream); a new route is a
change request rather than a direct edit. Without this, `GET
/api/appointments`, `GET /api/appointments/options` and `POST
/api/appointments` exist only inside the test suite, not in a running
server.

**Diff.**

```diff
--- a/app/api/create-api.ts
+++ b/app/api/create-api.ts
@@
 import { mountTimeline } from './audit/timeline';
 import { mountClients } from './clients/list';
+import { mountAppointments } from './appointments/routes';
 import { mountDevSession, type DevSessionOptions } from './dev-session';
@@
   mountClients(api, deps.now);
   mountTimeline(api, deps.now);
+  mountAppointments(api, deps.now);
```

(Exact insertion points: the import sits alphabetically before
`mountDevSession`'s import if the file's own convention is preserved, and the
mount call goes wherever the other two currently sit — the file was not
re-read at the moment of writing this request, so the integrator should
place both by that existing convention rather than by this diff's line
numbers.)

## 2. The Day schedule screen's route and rail link (for the second pull request)

**What.** In `app/shell/components/Rail.tsx`, give the existing "Schedule"
section (currently listed as `{ key: 'schedule', label: 'Schedule', icon:
<ScheduleIcon /> }`, rendered disabled with an "Arriving" tag because it
carries no `to`) a `to: '/admin/schedule'`. In `app/shell/App.tsx`, add a
route for it under the existing `/admin` layout route, alongside `clients`.

**Why.** `app/shell/**` is shared (the same rule as above); a stream's
screen still needs the shell to link to it and route to it. The rail
section and its "Arriving" placeholder already exist and were built to be
finished this way — this is completing a seam the shell already left open,
not adding a new one.

**Diff (illustrative; the second pull request supplies the real
`SchedulePage` import and confirms the exact lines against the file as it
stands then).**

```diff
--- a/app/shell/components/Rail.tsx
+++ b/app/shell/components/Rail.tsx
@@
   { key: 'clients', label: 'Clients', to: '/admin/clients', icon: <ClientsIcon /> },
-  { key: 'schedule', label: 'Schedule', icon: <ScheduleIcon /> },
+  { key: 'schedule', label: 'Schedule', to: '/admin/schedule', icon: <ScheduleIcon /> },
```

```diff
--- a/app/shell/App.tsx
+++ b/app/shell/App.tsx
@@
 import { ClientsPage } from '../admin/clients/ClientsPage';
+import { SchedulePage } from '../admin/schedule/SchedulePage';
@@
         <Route index element={<Navigate to="/admin/clients" replace />} />
         <Route path="clients" element={<ClientsPage />} />
+        <Route path="schedule" element={<SchedulePage />} />
```

Not requested yet: the practitioner's own `/today` route already exists as
`TodayLanding` (a placeholder) — wiring it to a real per-practitioner day
view is `scheduling`'s later work, once `appointment.list` with `scope:
'own'` has a screen to serve, and will be its own change request when it is
ready.
