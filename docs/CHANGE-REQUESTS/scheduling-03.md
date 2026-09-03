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
Navigate links carried the seeded parking coordinates, and "Check in" landed
on `/today/check-in?mrn=MW-000008` with the field still empty, which is what
item 2 fixes. Those edits were then reverted before committing:
`git status --short` on this branch shows nothing outside the paths this
stream owns, the same way `docs/CHANGE-REQUESTS/scheduling-02.md` did it.

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

## 2. Check-in reads the record number out of the query string

**What.** `app/therapist/session/CheckInPage.tsx` starts its record-number
field from a `mrn` query parameter when there is one, and behaves exactly as
it does now when there is not.

**Why.** Section 5.1 puts the check-in button on the stop itself, and the
practitioner has just tapped a row that names the client. Making them then
type `MW-000123` into a phone, standing at a door, is the one piece of
friction this screen exists to remove — and a mistyped record number is a
check-in against the wrong client, which the route can only refuse, never
catch. `TodayPage` already sends it: tapping "Check in" navigates to
`/today/check-in?mrn=MW-000008` (verified in a browser against the seeded
practice). Today that parameter is read by nobody and the field opens empty.

`app/therapist/session/**` belongs to session-capture, so this is a request.

**Diff.**

```diff
--- a/app/therapist/session/CheckInPage.tsx
+++ b/app/therapist/session/CheckInPage.tsx
@@
 import { useCallback, useEffect, useRef, useState } from 'react';
-import { useNavigate } from 'react-router';
+import { useNavigate, useSearchParams } from 'react-router';
@@
 export function CheckInPage() {
   const { apiFetch } = useAuth();
   const navigate = useNavigate();
+  // The day sheet knows which client this is and passes the record number
+  // through, so nobody types MW-000123 standing at a door
+  // (app/therapist/today/TodayPage.tsx). Normalised through the same function
+  // a typed value goes through, and validated on submit exactly as one is: a
+  // hand-edited URL gets the same hint as a typo, never a silent acceptance.
+  const [searchParams] = useSearchParams();
+  const prefilledRecordNumber = normalizeRecordNumber(searchParams.get('mrn') ?? '');
@@
-  const [recordNumber, setRecordNumber] = useState('');
+  const [recordNumber, setRecordNumber] = useState(prefilledRecordNumber);
```

**Why the initialiser rather than an effect.** The value is wanted once, at
mount; an effect would fight the practitioner if they corrected the field and
anything re-ran it. `useState`'s initialiser runs once, and every keystroke
afterwards is theirs.

**Whether the prefilled value should be trusted.** It should not, and it is
not: `submit` already runs `validateRecordNumber` on whatever is in the field
before it sends anything, and `checkin.ts` resolves the record number through
`app.checkin_context`, which finds a client only inside the caller's own
tenant and only with a visit booked for them today. A URL someone edits by
hand is refused by exactly the machinery a typo is refused by. Prefilling
saves typing; it grants nothing.

**A test worth having with it** (`tests/session/`, session-capture's own):
`/today/check-in?mrn=MW-000123` opens with the field carrying `MW-000123`,
and `/today/check-in` still opens empty.

---

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
