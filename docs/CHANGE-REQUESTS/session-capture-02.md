# Change requests — session-capture, pull request 2

The check-in screen (`app/therapist/session/CheckInPage.tsx`) is built and
tested against `app/api/sessions/schema.ts` and `checkin.ts` as they stand
on `main`, but it is not reachable from the shell yet, and it is built
against two gaps in `app/api/sessions/**` — the trunk's call, not this pull
request's paths (`app/therapist/session/**` and `tests/session/**` only).

---

## 1. Route and link the check-in screen in the shell

**What.** In `app/shell/App.tsx`, add a route for the screen; in
`app/therapist/TodayLanding.tsx`, add a link to it. Exactly the diff
`session-capture-01.md` item 2 already described, now that `CheckInPage.tsx`
exists.

**Why.** Both files are shared (`app/shell/**`, and `TodayLanding.tsx` sits
outside `app/therapist/session/**`), so neither is this pull request's to
edit. The screen was mounted locally to build and screenshot it (dev-only;
reverted before this commit — `git status` shows nothing outside this pull
request's own paths).

**Proposed diff.**

```diff
--- a/app/shell/App.tsx
+++ b/app/shell/App.tsx
@@
 import { PortalLanding } from '../client/PortalLanding';
+import { CheckInPage } from '../therapist/session/CheckInPage';
 import { TodayLanding } from '../therapist/TodayLanding';
@@
   <Route path="/today" element={<RequireAuth>{() => <TodayLanding />}</RequireAuth>} />
+  <Route path="/today/check-in" element={<RequireAuth>{() => <CheckInPage />}</RequireAuth>} />
```

```diff
--- a/app/therapist/TodayLanding.tsx
+++ b/app/therapist/TodayLanding.tsx
@@
+import { useNavigate } from 'react-router';
 import { useAuth } from '../shell/auth/AuthContext';
 import { Button, Note } from '../shell/components/Controls';
 import { describeRoles } from '../shell/routing';
@@
 export function TodayLanding() {
   const { session, signOut } = useAuth();
+  const navigate = useNavigate();
   const roles = session.status === 'signed-in' ? describeRoles(session.actor.roles) : '';
   return (
     <div className="ground" data-ground="dark">
       <main className="plain plain--instrument">
         <h1>Today</h1>
         <div className="small muted">{roles}</div>
         <Note>
           The day sheet, the session runner and the route arrive with their own work. Nothing is
           scheduled yet.
         </Note>
+        <Button onClick={() => navigate('/today/check-in')}>Check in</Button>
         <Button onClick={() => void signOut()}>Sign out</Button>
       </main>
     </div>
   );
 }
```

(Exact placement and copy — button order, whether "Check in" wants
`checkin__primary`'s taller thumb-zone treatment — is the trunk's call
against `docs/DESIGN-BRIEF.md` and `DESIGN.md`; the shape of the change is
what matters here.)

---

## 2. `GET /api/sessions/service-types` does not exist

**What.** `app/api/sessions/**` has no route serving the caller's own
certified services. `CheckInPage.tsx` calls `GET /api/sessions/service-types`
expecting `{ serviceTypes: { id, code, name, nameAr }[] }` (recorded in this
pull request's own `app/therapist/session/schema.ts`, mirroring the existing
`GET /api/billing/service-types` shape in `app/api/billing/schema.ts`
exactly, so there is one convention to match rather than two).

**Why not built here.** `app/api/sessions/**` is outside this pull request's
paths (`app/therapist/session/**` and `tests/session/**` only, per this
stream's own brief for the screen). Until the route exists, the screen shows
its own "The service list could not be loaded. Try again." note — verified
against the real API locally: the endpoint 404s, and the screen degrades to
that note rather than breaking.

**Shape, for whoever picks this up** (session-capture's own next small pull
request, since `app/api/sessions/**` is this stream's, not a shared-zone
request): a query against `credential` joined to `service_type` for the
caller's own `practitioner_id`, restricted to a `certification` capability
that covers `session.execute` and valid today — the same test
`domain/session/canCheckIn.ts`'s `canActor(..., 'session.execute', ...)`
already runs per service type, just listed instead of checked one at a time.

**Closed by pull request 23.** `GET /api/sessions/service-types`
(`app/api/sessions/service-types.ts`) now exists and is mounted, merged into
this branch: the caller's own credentialed, in-date service types, exactly
the `{ serviceTypes: { id, code, name, nameAr }[] }` shape this screen
already expected.

---

## 3. `CheckInRequest.clientId` is a uuid; the screen sends a record number

**What.** `app/api/sessions/schema.ts` types `CheckInRequest.clientId` as
`z.uuid()`, and `checkin.ts` reads it straight into a `client` lookup by
`id`. `CheckInPage.tsx` collects the record number the practitioner reads
off the household (`MW-000000`, validated locally against that shape) and
sends it as `clientId`, normalised to upper case — there is no client-facing
uuid anywhere in this screen's brief, and no endpoint the `practitioner` role
can call to resolve one today (`GET /api/clients` answers a plain
practitioner with an empty list and `note: 'schedule'`, by design, until
scheduling exists).

**Why not built here.** Same reason as item 2: `app/api/sessions/**` is
outside this pull request's paths. Sending the record number is what this
pull request's own brief specifies ("a session_started event carrying
clientId by record number or id"); today's schema only accepts the second
half of that. Until it accepts the first too, a real check-in comes back as
the screen's generic "Something went wrong. Try again." — confirmed locally:
typing a valid `MW-000123` and submitting reaches the server, which 400s on
the uuid shape, and the screen shows that message rather than crashing.

**Shape, for whoever picks this up** (also this stream's own, not the
trunk's): widen `CheckInRequest.clientId` to accept either shape, and in
`checkin.ts` resolve a record-number string against `client.mrn` (scoped to
`tenant_id`, as every other lookup here already is) before falling back to
`client.id`.

**Closed by pull request 23.** `CheckInRequest` now takes `clientMrn`
(`app/api/sessions/schema.ts`'s `ClientMrn`, `MW-` followed by six or more
digits) as an alternative to `clientId` — exactly one of the two, enforced
by the schema's own refine — and `app.checkin_context`
(`db/migrations/301_checkin_context.sql`) resolves whichever the caller
sent, also tying the resolved client to today's booked appointment with
this practitioner. Merged into this branch; `CheckInPage.tsx` now sends
`{ clientMrn: <normalised record number> }` instead of overloading
`clientId`.

---

Both gaps recorded above are closed by pull request 23 (merged into this
branch): the services endpoint exists, and the screen sends the record
number as `clientMrn`, its own field, rather than through `clientId`. Item
1 (routing and linking the screen from the shell) remains open — still the
trunk's call, not this stream's.
