**Applied in round 7b, 2026-09-02, pull request 29:** the check-in screen is
now routed and linked from the shell (item 1 below); items 2 and 3 were
already closed by pull request 23.

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

---
---

# Change requests — session-capture, the session runner

*Added by the pull request that builds the visit itself, from pre-flight to
check-out (docs/SPEC/session-capture.md sections 2 to 4 and 7). Everything
above this line is closed; everything below is open.*

The runner is built and tested, and it works offline as far as this stream's
own paths reach: every write during a visit goes to an IndexedDB outbox and
is posted whenever there is a connection. Four things it needs are outside
those paths.

---

## 1. The app is not installable, and there is no service worker

**What.** Add `public/manifest.webmanifest`, `public/icon.svg` and
`public/sw.js`, link the manifest from `index.html`, and register the worker
from `app/shell/main.tsx`.

**Why.** Section 7 of docs/SPEC/session-capture.md asks for exactly this:
"Installable (manifest, icons), standalone display. Service worker: cache app
shell and today's read data; background sync where available, foreground
retry every 30s otherwise (iOS)."

The foreground retry is built and lives in
`app/therapist/session/outbox/outbox.ts` — it does not depend on any of this.
What this adds is the other half: a practitioner who opens the app with no
signal at all currently gets the browser's offline page, because nothing has
cached the shell. The outbox survives that (IndexedDB is not the HTTP cache),
but the app they would resume the visit in does not load.

Every file here is the shell's: `public/**`, `index.html` and
`app/shell/**` are outside this stream's paths.

**A dependency is deliberately not asked for.** `vite-plugin-pwa` or Workbox
would precache the hashed build output for us, and both are a change to
`package.json` and the lockfile — a bigger ask than this needs. The worker
below is thirty lines of runtime caching with no build step and no new
package. If the trunk would rather take the plugin, that is a better answer
and this request is happy to be met that way instead.

### 1a. `public/manifest.webmanifest` (new file)

```json
{
  "name": "McWellness",
  "short_name": "McWellness",
  "start_url": "/today",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#10191d",
  "theme_color": "#10191d",
  "icons": [
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```

The two colours are `--paper` on the practitioner's dark ground, copied
verbatim from `app/shell/tokens.css`. A manifest is JSON and cannot read a
CSS custom property, so this is the one place in the repository where those
values are written out; if the token changes, this changes with it.

### 1b. `public/icon.svg` (new file)

Achromatic, one glyph, no gradient and no accent — the same restraint as the
rest of the chrome. iOS additionally wants a raster `apple-touch-icon`
(180×180 PNG); that is a binary asset for the operator to supply, and its
absence costs only the home-screen icon's polish, not installability.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="McWellness">
  <rect width="512" height="512" rx="96" fill="#10191d"/>
  <path d="M136 356V156h44l76 128 76-128h44v200h-42V232l-62 104h-32l-62-104v124z" fill="#eef2f1"/>
</svg>
```

### 1c. `index.html`

```diff
     <meta name="color-scheme" content="light" />
     <title>McWellness</title>
     <link rel="icon" href="data:," />
+    <link rel="manifest" href="/manifest.webmanifest" />
+    <link rel="apple-touch-icon" href="/icon.svg" />
   </head>
```

### 1d. `public/sw.js` (new file)

```js
// The practitioner app's service worker (docs/SPEC/session-capture.md
// section 7). Runtime caching only: no build step, no precache manifest and
// no new dependency.
//
// Three rules, and nothing else is cached at all:
//   1. a navigation falls back to the cached shell, so the app opens with no
//      signal and the outbox can resume the visit;
//   2. the built assets are served from cache and refreshed in the
//      background, because they are immutable and hashed;
//   3. exactly two GET reads — today's day sheet and the caller's own
//      services — keep their last good answer, which is section 2's "read
//      data is cached on every successful sync and served from cache when
//      offline. It is never edited on the device."
//
// Nothing else touching /api is cached, ever: no POST, no close, no audit
// read, and no route carrying anything the two named below do not.
const SHELL = 'mcwellness-shell-v1';
const ASSETS = 'mcwellness-assets-v1';
const READS = 'mcwellness-reads-v1';
const KEEP = [SHELL, ASSETS, READS];

// The read routes whose last good answer is worth keeping. Matched on the
// path alone; a query string is part of the cache key, so one day sheet per
// date is kept rather than one overwriting another.
const CACHEABLE_READS = ['/api/appointments', '/api/sessions/service-types'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.add('/')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, fallbackRequest) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(fallbackRequest ?? request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(fallbackRequest ?? request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL, new Request('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
    return;
  }
  if (CACHEABLE_READS.some((path) => url.pathname === path)) {
    event.respondWith(networkFirst(request, READS));
  }
});

// Background sync where the browser has it (Android Chrome). The queue
// itself lives in the page's IndexedDB and is flushed by the page, so this
// wakes whatever client is open rather than reimplementing the outbox here;
// where there is no client, the queue waits for the next open, which is what
// iOS does in every case anyway.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'session-outbox') return;
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: 'flush-outbox' });
    }),
  );
});

// Sign-out clears every cached read: the day sheet holds a given name and an
// initial, and a signed-out device keeps nothing of anybody.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'forget-reads') {
    event.waitUntil(caches.delete(READS));
  }
});
```

### 1e. `app/shell/main.tsx`

```diff
 createRoot(root).render(
   <StrictMode>
     ...
   </StrictMode>,
 );
+
+// The practitioner app is installable and opens with no signal
+// (docs/SPEC/session-capture.md section 7). Registered after render so it
+// never delays first paint, and only where the browser has it.
+if ('serviceWorker' in navigator && import.meta.env.PROD) {
+  window.addEventListener('load', () => {
+    void navigator.serviceWorker.register('/sw.js');
+  });
+}
```

`import.meta.env.PROD` keeps it out of the dev server, where a worker
caching the shell fights hot reload.

### 1f. `app/shell/auth/AuthContext.tsx`

```diff
   const signOut = useCallback(async () => {
     await provider.signOut();
+    // The cached day sheet holds a given name and an initial. A signed-out
+    // device keeps nothing of anybody (docs/SPEC/session-capture.md
+    // section 7, .claude/rules/compliance.md).
+    navigator.serviceWorker?.controller?.postMessage({ type: 'forget-reads' });
     setSession({ status: 'signed-out' });
   }, [provider]);
```

**Verify.** Chrome's application panel shows the app as installable; with the
network throttled to offline, opening `/today/check-in` loads the shell and
the resume offer appears from the device's own outbox note. The full drill is
in this pull request's body.

---

## 2. The setup photo's bytes have nowhere to go

**What.** Two things, both the trunk's:

1. A `PUT /api/sessions/:id/photo` route is *not* asked for here — that path
   is this stream's own and will be built once the second half exists. What is
   asked for is the second half: `c.get('storage')`, the `StorageProvider`
   with `put(key, bytes, mimeType) → { sha256, size }` that shared-zone round
   14 is landing.
2. An exemption from the 64 KB body cap in `app/api/create-api.ts` for that
   one path, since a compressed photo is up to 1 MB (section 7).

**Why.** `app/therapist/session/photo.ts` already compresses a photo to at
most 1 MB and digests it; `app/api/sessions/close.ts` already writes the
`document` row against the key the provider will store it under
(`sessions/<sessionId>/setup-photo.<ext>`, derived from the session id and
never from anything the device sent). The only missing piece is a door wide
enough for the bytes.

The body cap is a single middleware line and applies to every `/api/*` route:

```diff
-  api.use('/api/*', bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: payloadTooLarge }));
+  api.use('/api/*', bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: payloadTooLarge }));
+  // One exception, and it is an upload: the setup photo is compressed on the
+  // device to at most 1 MB (docs/SPEC/session-capture.md section 7). The
+  // route itself refuses anything that is not an image and verifies the
+  // digest the device declared.
+  api.use(
+    '/api/sessions/:id/photo',
+    bodyLimit({ maxSize: PHOTO_LIMIT_BYTES, onError: payloadTooLarge }),
+  );
```

with `export const PHOTO_LIMIT_BYTES = 1024 * 1024;` beside
`BODY_LIMIT_BYTES`. Note the ordering: in Hono the more specific
registration must come after the wildcard for its own limit to apply, and
`jsonOnly` (also mounted on `/api/*`) will need to let this one path through
with an image content type.

**Until then.** Nothing is lost and nothing is broken: the photo is taken,
compressed and digested on the device, the `photo_captured` event records
its size and digest, and the close files the document row. The row points at
a key the bytes have not reached yet, which is stated plainly in
`tests/session/db/run.test.ts`'s own comment on that case. When the provider
lands, the bytes follow.

---

## 3. A note to scheduling, not a request

Two things this pull request found in the seam between the two streams. Both
are working as built; neither is this stream's to change.

**3a. The close flips the appointment through a definer door.**
`db/policies/scheduling/appointment_access.sql` gives `update` on
`appointment` to the owner, the admin and the lead practitioner — a
practitioner "cannot create" or change the calendar, which is right for the
calendar. But section 4.3 of docs/SPEC/session-capture.md makes
`appointment.status = completed` part of closing a visit, and the
practitioner is who closes it.

Rather than widen that policy from outside the stream that owns it,
`db/migrations/302_session_close.sql` adds
`app.complete_appointment_for_session(p_session_id)`: security definer,
granted to `app_role`, taking no status argument, and doing exactly one thing
— setting `completed` on the appointment its own session names, when the
caller is that session's own practitioner, when the session is closed, and
when the appointment is not already settled.

If scheduling would rather own this transition itself, that function is the
shape of what it needs to replace and dropping it is a one-line rollback.

**3b. `proposed` and `confirmed` disagree between two doors.**
`app.checkin_context` (301) admits a check-in against an appointment whose
status is `proposed`, `confirmed` or `checked_in`.
`app.client_visible_to_practitioner` (201) opens its window on `confirmed`
onwards and excludes `proposed`.

So a practitioner can check a client in against a `proposed` appointment and
then not be able to read that client's own name or consent rows. This stream
works around it — the resume offer degrades to the time alone, and the two
facts the runner genuinely needs come through the narrow doors in
`db/migrations/304_session_reads.sql` — but the disagreement is real and one
of the two is probably wrong. Whichever it is, it is not this stream's call.

---

## 4. Two columns, read defensively until round 14

`service_type.preflight_checklist` and `service_type.rating_questions` are
the trunk's, landing in shared-zone round 14. This stream reads them as
`to_jsonb(st) -> 'preflight_checklist'` rather than naming the column
(`app/api/sessions/service-types.ts`), because naming a column that does not
exist is a parse-time error that would take the whole route down, whereas
asking a row-as-jsonb for a key it may not have is a plain null.

No change is asked for. This is a note to whoever rebases after round 14:
those two expressions can become ordinary column references, and the two
`alter table` statements in `tests/session/db/service_types.test.ts` can be
deleted. The shape they parse into does not change, so nothing else does.

---
---

# Change requests — session-capture, the fix round

*Added by the round that answers four reviews of the runner (security,
compliance, schema and design). Everything above section 5 stands as it was
written; these are the five things the fix round could not do inside its own
paths, and the two decisions it took while waiting.*

---

## 5. Sign-out must empty the shell's own cache too

**What.** Exactly the diff in section 1f above, and it is now the only half
of the sign-out rule this stream does not hold itself.

**Why, restated.** The device's own half is done and tested: the outbox
observes the auth session and empties both IndexedDB stores the moment it
becomes signed out (`app/therapist/session/SessionRunner.tsx`,
`outbox/store.ts`), a store claimed by a different practitioner is wiped
before it is used, and nothing survives seven days. What that cannot reach is
the service worker's `mcwellness-reads-v1` cache, which holds the day sheet —
a given name and a family initial per household — and belongs to
`app/shell/**`.

So the rule reads: **a signed-out device keeps nothing of anybody.** Two
caches, two owners, one sentence. Until 1f lands, a practitioner who signs
out on a shared phone leaves the day sheet behind in the HTTP cache, and
nothing in this stream's paths can take it out.

---

## 6. Withdrawing photo consent must delete the photographs

**What.** A path — a screen, a job, or a hand-written runbook, the trunk's
call — that deletes the stored setup photos of a household that withdraws
`photo_video` consent, and the `document` rows that name them.

**Why.** `consent.status = 'withdrawn'` stops the next photograph. It does
nothing about the ones already taken, and a photograph kept after the
household has said stop is the plainest kind of breach there is. This stream
holds the door that refuses a new one (`app.session_consent_active`,
304_session_reads.sql) and it holds nothing at all after that: `document` is
the trunk's table (060), its rows are `is_immutable`, and deletion crosses
storage, the audit trail and the retention rule in
`domain/client/computeRetentionUntil.ts` — none of which is session-capture's.

**What this stream will do when the path exists.** Nothing, and that is the
point: the photo's own key is derived from the session id
(`sessions/<id>/setup-photo.jpg`, `app/api/sessions/close.ts`), so every
photograph of a household is reachable from that household's sessions without
a new index or a new column.

**Not urgent today, and it will be.** No photograph exists yet — the camera
is off until the storage seam lands (section 2 above, and section 8 below) —
so there is nothing to delete and nothing at risk. The request is filed now
rather than later precisely because the day the camera is switched on is the
day this becomes a live obligation, and a compliance path built after the
first photograph is a path built too late.

---

## 7. A note about `child_assents`, not a request

Shared-zone round 14 seeds a fourth item into the neurofeedback service's
`preflight_checklist`: `child_assents`, "For a child: they agreed to take
part today", beside the guardian's presence. Nothing here needs changing —
the checklist is data, the pre-flight step renders whatever the service
carries, and the answer is filed in the `preflight` observation event like
every other item. Two things are worth writing down anyway.

First, it renders in both languages, because the runner now shows every
checklist item's Arabic beneath its English (`PreflightStep.tsx`, marked
`lang="ar" dir="rtl"`). The wording the trunk seeds is the wording the
practitioner reads.

Second, it records the promise; it does not enforce it. The
minor-participation wording says a child's "no" ends the session, and this
item is what makes that promise showable afterwards. It is a toggle the
practitioner may leave unticked and still continue, exactly as they may with
"environment suitable" — the pre-flight step counts what is outstanding and
never blocks. If the practice wants a child's refusal to *stop* a visit, that
is a rule and belongs in `domain/session/canCheckIn.ts` with a reason of its
own, not a checklist item that quietly behaves differently from its four
neighbours. Whoever wants it should ask for it as a rule.

---

## 8. `proposed` versus `confirmed`: still open, and decided narrowly meanwhile

Section 3b above stands unanswered: `app.checkin_context` (301) admits a
check-in against a `proposed` appointment, and
`app.client_visible_to_practitioner` (201) opens its window on `confirmed`.
One of the two is wrong and it is not this stream's call which.

**What changed while waiting.** The close's own door,
`app.complete_appointment_for_session` (302_session_close.sql), used to
complete an appointment whose status was `proposed`, `confirmed` or
`checked_in`. It now admits `confirmed` and `checked_in` only, with a test
(`tests/session/db/doors.test.ts`).

**Why narrow.** A visit nobody confirmed is not one this door should quietly
mark completed on the strength of a practitioner having stood in the room; a
coordinator can still settle it from the calendar, which is where an
unconfirmed appointment's questions belong. Narrow is the reversible side of
a disagreement: widening later is one word in one migration, and un-completing
appointments that were never confirmed is a data repair.

**If scheduling answers "proposed counts".** Add it back to that one `in`
list and delete this section. If scheduling answers the other way, 301 is
where the fix goes, and this door is already there.

---

## 9. The storage seam, and what is switched off until it lands

Section 2 above asked for `c.get('storage')` and a body-cap exemption. Round
14 has built the first half on `origin/shared-zone-round-14` —
`put(key, bytes, mimeType, { overwrite })` returning `{ sha256, size }`, and
migration 904, which drops `checked_out_point` from the audit trail and
strips a `point` key from inside any jsonb payload. It has not merged.

**So the camera is off, in one place.**
`app/api/sessions/photo-availability.ts` is a single constant, and everything
turns on it: the post step does not offer to take a photograph, the events
route refuses a `photo_captured` event by name
(`photo_storage_unavailable`), and the close files no `document` row. The
review that asked for this was right that the previous behaviour was worse
than nothing — a document row against a key nothing ever uploaded to is a
record of a photograph that does not exist, and a practitioner who takes one
and is told it was saved has been lied to.

When the seam merges, that constant becomes a check for `c.get('storage')`,
the upload happens inside the close's own transaction before the row is
filed, the hash comes from the seam rather than from the device, and a store
that is unavailable at that moment lets the close succeed with the photograph
dropped and the practitioner told so plainly. The body-cap exemption in
section 2 is still needed for the route that carries the bytes.

Two smaller notes for the same rebase: section 4's two defensive
`to_jsonb(st) -> '...'` expressions can become ordinary column references now
that migration 901 exists, and the `alter table` statements in
`tests/session/db/service_types.test.ts` can go with them.
