# scheduling-03: route the practitioner's Today, and let check-in read the record number

This pull request builds `app/therapist/today/TodayPage.tsx` (the day sheet
docs/SPEC/scheduling-manual.md section 5.1 asks for) and migration
`201_client_visible_to_practitioner.sql` (the schedule-based door
docs/SPEC/client-record.md sections 2 and 11 ask for). Three files it needs
changing belong to other people: `app/shell/App.tsx` and
`app/therapist/session/CheckInPage.tsx` and `app/api/clients/record.ts`
(CLAUDE.md rule 10, docs/SPEC/OWNERSHIP.md). Each is a request here rather
than an edit there.

Every diff below was applied to a local copy of `origin/main` at `af6c665`
(pull request 33) and checked, not written from memory: `pnpm format:check`,
`pnpm lint`, `pnpm typecheck` and `pnpm test` all pass with items 1 and 2
applied together, and the screen was driven end to end in a browser against
the seeded practice — signed in as a practitioner, a real day rendered, the
Navigate links carried the seeded parking coordinates, the stops behind the
practitioner folded and opened again in full, and "Check in" reached the
check-in screen with the field still empty, which is what item 2 fixes. Those
edits were then reverted before committing: `git status --short` on this
branch shows nothing outside the paths this stream owns, the same way
`docs/CHANGE-REQUESTS/scheduling-02.md` did it.

Sections 4, 5 and 6 are not requests. They record a decision this pull
request implements, and two things it found and did not fix because they are
not this stream's to touch.

---

## 1. `/today` renders `TodayPage` for anyone who treats

**What.** In `app/shell/App.tsx`, the `/today` route renders the new
`TodayPage` for an actor holding `practitioner` or `lead_practitioner`, and
`TodayLanding` for everyone else, exactly as it does today.

**Why not simply replace the landing.** `/today` is reachable by anyone
signed in — an admin, a finance account, a client contact who typed the
path — and for them there is no "own day" to show: `appointment.list` with
scope `own` refuses finance outright (`domain/shared/actor.ts`), and an
account with no practitioner row of its own would get a blank day. The
landing screen is the honest answer for them and stays.

**The role test already exists.** `canOpenToday` in
`app/shell/adminAccess.ts` is exactly this rule
(`roles.includes('practitioner') || roles.includes('lead_practitioner')`),
written in round 10 for the console's own "Today" link, and `/today/check-in`
gates on the same pair through `hasRole`. Using `canOpenToday` here keeps the
link, the check-in route and this route saying one thing.

**Diff.**

```diff
--- a/app/shell/App.tsx
+++ b/app/shell/App.tsx
@@
 import { CheckInPage } from '../therapist/session/CheckInPage';
+import { TodayPage } from '../therapist/today/TodayPage';
 import { TodayLanding } from '../therapist/TodayLanding';
 import { AdminLayout } from './AdminLayout';
-import { canOpenBilling, canOpenSchedule } from './adminAccess';
+import { canOpenBilling, canOpenSchedule, canOpenToday } from './adminAccess';
@@
-      <Route path="/today" element={<RequireAuth>{() => <TodayLanding />}</RequireAuth>} />
+      <Route
+        path="/today"
+        element={
+          <RequireAuth>
+            {(actor) => (canOpenToday(actor) ? <TodayPage /> : <TodayLanding />)}
+          </RequireAuth>
+        }
+      />
```

**One test on `main` changes with it.**
`app/shell/App.test.tsx`'s "shows a practitioner-only account no way into the
console from Today" waits for a `Check in` button, which the landing screen
has at the top and the day sheet does not: check-in belongs to a stop now, and
that test's own fetch stub answers `/api/appointments` with an empty list, so
the screen it lands on says the day is empty. The rest of the test — no
"Admin console" for a practitioner-only account — is unchanged and still the
point of it. This is the whole test-side change; the suite is green with it.

```diff
--- a/app/shell/App.test.tsx
+++ b/app/shell/App.test.tsx
@@
     mount(PRACTITIONER, '/today');
-    await screen.findByRole('button', { name: 'Check in' });
+    await screen.findByText('Nothing is booked for you today.');
     expect(screen.queryByRole('button', { name: 'Admin console' })).toBeNull();
```

**What this stream did instead, meanwhile.** Nothing that reaches around it.
`tests/scheduling/TodayPage.test.tsx` renders the page directly inside a
`MemoryRouter`, so the screen is fully tested without the shell; until this
lands, `/today` keeps showing the landing and the new screen is unreachable
in a running app.

**One knock-on for the trunk to decide.** `app/therapist/TodayLanding.tsx`
still carries a "Check in" primary and the copy "The day sheet, the session
runner and the route arrive with their own work. Nothing is scheduled yet.",
which stops being true for a practitioner the moment this lands (it stays
true for the admin and finance accounts who still see it). Rewording it is
the trunk's call, not this stream's; nothing here depends on it.

---

## 2. Check-in reads the record number the day sheet hands it

**What.** `app/therapist/session/CheckInPage.tsx` starts its record-number
field from the router state the day sheet navigates with, and behaves exactly
as it does now when there is none.

**Why.** Section 5.1 puts the check-in button on the stop itself, and the
practitioner has just tapped a row that names the client. Making them then
type `MW-000123` into a phone, standing at a door, is the one piece of
friction this screen exists to remove — and a mistyped record number is a
check-in against the wrong client, which the route can only refuse, never
catch.

**Why router state and not a query string.** `.claude/rules/ui.md`: "No
personal data in URL paths or query strings. Route by opaque ids only." A
record number identifies a person to anyone holding it, and an address is the
least private place in a browser — it lands in history, in a bookmark, in a
screenshot, in a shared link, and in the access log of anything the URL is
ever sent to. Router state is carried in memory between the two screens and
reaches none of those. `TodayPage` already navigates that way:
`navigate('/today/check-in', { state: { record: stop.client.mrn } })`, and
`tests/scheduling/TodayPage.test.tsx` asserts both halves — that the state
carries the record number, and that the address does not.

`app/therapist/session/**` belongs to session-capture, so this is a request.

**Diff.**

```diff
--- a/app/therapist/session/CheckInPage.tsx
+++ b/app/therapist/session/CheckInPage.tsx
@@
 import { useCallback, useEffect, useRef, useState } from 'react';
-import { useNavigate } from 'react-router';
+import { useLocation, useNavigate } from 'react-router';
@@
 export function CheckInPage() {
   const { apiFetch } = useAuth();
   const navigate = useNavigate();
+  // The day sheet knows which client this is and hands the record number over
+  // in router state, so nobody types MW-000123 standing at a door
+  // (app/therapist/today/TodayPage.tsx). Never a query string: a record
+  // number is personal data, and .claude/rules/ui.md keeps personal data out
+  // of paths and query strings. Normalised through the same function a typed
+  // value goes through, and validated on submit exactly as one is.
+  const location = useLocation();
+  const handedOver = (location.state as { record?: string } | null)?.record ?? '';
+  const prefilledRecordNumber = normalizeRecordNumber(handedOver);
@@
-  const [recordNumber, setRecordNumber] = useState('');
+  const [recordNumber, setRecordNumber] = useState(prefilledRecordNumber);
```

**Why the initialiser rather than an effect.** The value is wanted once, at
mount; an effect would fight the practitioner if they corrected the field and
anything re-ran it. `useState`'s initialiser runs once, and every keystroke
afterwards is theirs.

**Whether the handed-over value should be trusted.** It should not, and it is
not: `submit` already runs `validateRecordNumber` on whatever is in the field
before it sends anything, and `checkin.ts` resolves the record number through
`app.checkin_context`, which finds a client only inside the caller's own
tenant and only with a visit booked for them today. Prefilling saves typing;
it grants nothing.

**A test worth having with it** (`tests/session/`, session-capture's own):
rendering the page at `/today/check-in` with router state `{ record:
'MW-000123' }` opens with the field carrying `MW-000123`, and rendering it
with no state still opens empty.

## 3. The client record still refuses a practitioner on that client's schedule

**What.** `app/api/clients/record.ts` resolves `scheduledClientIds` for
`canViewClient` instead of passing `[]`.

**Why.** `GET /api/clients/:id` reads:

```ts
// scheduledClientIds is always empty: app.client_visible_to_practitioner
// (100_client_record.sql) has no schedule to consult yet, and this context
// mirrors that honestly rather than guessing.
const view = canViewClient(
  actor,
  { id: clientId, tenantId: actor.tenantId, status },
  { scheduledClientIds: [], contactClientIds },
  now(),
);
```

That comment was true when it was written and is not any more. Migration
`201_client_visible_to_practitioner.sql` in this pull request replaces the
stub, so the row policies now open a client's record to a practitioner who
holds a visit with them. The route's own rule has not moved, so a
practitioner **on** the client's schedule is still answered 403 and still has
a `refused` row written about them — the database says yes and the API says
no.

Nothing in this pull request depends on that: `TodayPage` reads
`/api/appointments`, never `/api/clients/:id`. But client-record.md section 11
turns on it ("a practitioner not on that client's schedule cannot open the
record"), and half of that promise now misfires, so it is recorded here
rather than left to be found.

**No diff proposed.** `app/api/clients/**` is client-record's, and the shape
of the fix is theirs to choose. Two that would work:

- Ask the database the same question the policies ask, before the
  `canViewClient` call — `select app.client_visible_to_practitioner($1)` — and
  pass `[clientId]` or `[]` accordingly. One statement, one source of truth,
  and `canViewClient` keeps its pure signature.
- Or resolve the practitioner's scheduled clients as a list, the way
  `contactClientIds` is resolved just above it.

The first keeps the API and the row policies answering from one place, which
is what went wrong here in the first place; the second matches the code
immediately above it. Either closes the gap.

**Proved, not asserted.** `tests/scheduling/db/client_visibility.test.ts` in
this pull request holds the route to what it does *today* — 403 and one
`refused` audit row for a practitioner with no visit at all, which is correct
and stays correct — and exercises the granting case against the row policies
directly rather than through that route. When this item lands, the granting
case is worth adding at the HTTP level too.

---

## 4. The visibility window, as decided

Not a request. Recorded here because it is the rule
`db/migrations/201_client_visible_to_practitioner.sql` now enforces, and
because the numbers in it are the operator's to change.

**The decision** (trunk session, 2026-09-03, on the reviewers'
recommendation; the operator was told). A client is on a practitioner's
schedule when that practitioner holds an appointment with them which:

1. really counts as a visit — its status is `confirmed`, `checked_in`,
   `completed`, `no_show` or `rescheduled`; and
2. starts on a day between **90 days before today** and **30 days after
   today**, counted in the practice's own zone.

The five granting statuses are written out rather than the three that do not
grant, so a status added to `appointment_status` later opens nothing until
somebody names it on purpose.

`proposed` is not among them: the client has not been told about that visit
(scheduling-manual.md section 3), so it is a plan and not a schedule. Both
cancelled statuses are absent for the plainer reason that a visit called off
is a visit that is not happening. A `no_show` is not a cancellation — the
practitioner was genuinely sent to that door — and a `rescheduled` row
records a visit that really was theirs before it moved.

**The two edges the operator may want moved.**

- **A visit that has not happened yet opens the record up to 30 days
  early.** A practitioner can read the brief of somebody they have not met,
  a month before they meet them. That is the point — a home visit wants
  preparing — but 30 days is a number, not a law. Shorter is safer and
  leaves less time to prepare; longer is the reverse.
- **One completed visit keeps the record open for 90 days afterwards.** A
  client seen once and never again stays readable to that practitioner for
  three months. That covers writing up a session, a follow-up call and a
  client who returns after a gap, at the cost of a door left open longer
  than the work needs.

Both numbers live in one place, and changing either is a new migration in
this stream's range plus the four edge tests in
`tests/scheduling/db/client_visibility.test.ts` that pin them (a confirmed
visit 29 days ahead grants, 31 days ahead does not; a completed visit 89 days
back grants, 91 days back does not).

**A consequence worth naming.** Because a merely proposed visit opens
nothing, the practitioner's own day sheet cannot show one either — there is
no readable client and no readable location behind it, so the row could not
render at all. `app/api/appointments/list.ts` therefore names the statuses
that are stops (`confirmed`, `checked_in`, `completed`, `no_show`) rather
than letting the join drop them silently, and that list is deliberately a
subset of the five above.

---

## 5. The same gap, in two places this stream may not edit

Not a request either — a finding, for the trunk and for session-capture.

Migration 201 requires the acting practitioner's own row to be
`status = 'active'`. Without it, an employee who has been deactivated but
whose user account still carries the `practitioner` role would keep every
client of their last 90 days open behind them: deactivating someone should
close their doors on the day, not a quarter later.

Two other places resolve a practitioner from `app.actor_id` and do **not**
make that check:

- `app.checkin_context` (`db/migrations/301_checkin_context.sql`, owned by
  session-capture) — its `caller` CTE selects the practitioner row by
  `user_id` and tenant alone, so a deactivated practitioner with a visit
  booked today could still check that visit in.
- `scheduling_read_scope` (`db/policies/scheduling/appointment_access.sql`).
  This one is this stream's own file, and it is deliberately left alone in
  this pull request: changing who may read the appointment table is a wider
  change than the pull request under review, and it should land with its own
  deny tests rather than ride along with a client-visibility migration. It
  is named here so it is not lost.

Neither is a new hole — both predate this pull request — and neither is
touched here.

---

## 6. One thing the audit trail could say and does not

`GET /api/appointments` writes one `list` row per stop read, in both scopes,
and the two scopes are not distinguishable in the trail: the rows differ only
in which appointments they name.

Stamping the scope would want the `reason` column, which
`app/api/_middleware/audit.ts` fills from `current_setting('app.reason')` —
the request context's own setting, not a parameter `logRead`/`logReads`
accept. Giving the helper a reason argument, or having the route set
`app.reason` for its own transaction, are both edits to
`app/api/_middleware/**`, which is shared. Recorded rather than reached
around.

Worth doing only if somebody wants to ask the trail "which reads were a
practitioner looking at their own day?" — the answer is currently derivable
from the actor's role and the row set, but not directly readable.
