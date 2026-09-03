# scheduling-04: cancelling a diary from a withdrawal, a route for the week, and two names the shared zone should hold

This pull request builds moving and cancelling visits, the notice-period
rule, the practitioner's stop-card balance and a read-only week
(`docs/SPEC/scheduling-manual.md` sections 2, 3, 4.1, 5.2, 6.4 and 9;
`docs/SPEC/billing.md` section 4.3; the operator's decisions of 2026-09-03 —
twenty-four hours' notice, AED 150 for a visit that cannot go ahead at the
door, both editable).

Four things it needs belong to other people: `app/shell/App.tsx`,
`domain/shared/actor.ts`, `app/admin/billing/money.ts` and the
client-record stream's withdrawal route (CLAUDE.md rule 10,
`docs/SPEC/OWNERSHIP.md`). Each is a request here rather than an edit there.

Sections 5 to 9 are not requests. One is a door this pull request built
*for* another stream, and the rest are findings and decisions recorded so
they are not discovered instead.

Every diff below was applied to this branch, run, and reverted before
committing: `git status --short` shows nothing outside the paths this stream
owns, the same way `docs/CHANGE-REQUESTS/scheduling-03.md` did it.

| # | Where | What | Blocks |
|---|---|---|---|
| 1 | `app/api/clients/consents.ts` (client-record) | Cancel the diary when a consent is withdrawn — the door now exists | the promise in client-record.md section 7 |
| 2 | `app/shell/App.tsx` (trunk) | A route for `/admin/schedule/week` | the week view is unreachable in a running app |
| 3 | `domain/shared/actor.ts` (trunk) | `appointment.move` and `appointment.cancel` | nothing — composed today |
| 4 | `app/admin/billing/money.ts` → `domain/shared` (billing) | One money formatter, importable from anywhere | nothing — imported today |
| 5 | `tests/client/**` (client-record) | Two tests that fail between midnight and 04:00 | `pnpm verify` and `pnpm test:db`, for four hours a day |

---

## 1. Withdrawing a consent cancels what is booked (client-record)

**The door exists now.** `docs/CHANGE-REQUESTS/client-record-03.md` CR-10
left this undone because "`appointment` is the scheduling worktree's table
and cancelling somebody's visits is not a thing to do across an ownership
line". Agreed, and this is that line answered from this side:

```sql
app.cancel_future_appointments(p_client_id uuid, p_reason text) returns integer
```

`db/migrations/203_appointment_move_and_cancel.sql`. It is security definer
and owner-or-admin only — exactly as wide as `client.write`, which is the
permission that opens a withdrawal in the first place. It cancels every
appointment of that client whose window has not yet opened and whose status
is still `proposed` or `confirmed`, as plain `cancelled`, with
`cancellation_reason = 'consent_withdrawn'`, **never** `cancelled_late`: a
person withdrawing a consent is exercising a right, and taking one of their
credits for the visits that right cancels would be a penalty on exercising
it. It stamps `p_reason` on every audit row it causes and returns how many
visits it reached. Everything already delivered, already called off, already
missed or already moved is left exactly as it was.

Proved in `tests/scheduling/db/move_and_cancel.test.ts`: forward only, never
late, no credit taken, the reason on the trail, refused for a practitioner,
refused for a blank reason, and nothing reached in another practice.

**The exact call**, for `api.post('/api/clients/:id/consents/:consentId/withdraw')`
in `app/api/clients/consents.ts`, immediately after the `update consent set
status = 'withdrawn'` statement and before the photograph handling (the
database work all together, then the bytes — that route's own ordering):

```ts
// Withdrawing a consent the visits depend on takes the diary with it
// (docs/SPEC/client-record.md section 7). The appointment table is the
// scheduling stream's, so this goes through its door rather than round it:
// forward-only, never late, and audited with this route's own reason
// (db/migrations/203_appointment_move_and_cancel.sql).
const visitsCancelled =
  row.purpose === 'participation' || row.purpose === 'minor_participation'
    ? ((
        await db.query<{ cancelled: number }>(
          'select app.cancel_future_appointments($1, $2) as cancelled',
          [clientId, `Consent withdrawn: ${row.purpose}.`],
        )
      ).rows[0]?.cancelled ?? 0)
    : 0;
```

and `visitsCancelled` on `WithdrawConsentResponse`, so the Consent tab can
say what happened — "3 booked visits were cancelled" — rather than the
current line, "Appointments already in the diary are not cancelled by this;
tell whoever keeps the schedule", which stops being true the moment this
lands.

**The decision the operator still owes, and what this stream would do
meanwhile.** CR-10 asked which purposes cancel a booking, and that is not a
coding question. The condition above is a **recommendation, not a decision**:
`participation` and `minor_participation` are the two purposes a session
cannot proceed without, and `photo_video`, `marketing` and `research` plainly
do not stop a visit. `home_visit` is the interesting one — withdrawing it
does not end the programme, it ends visits *at the house* — and the honest
answer there is probably to leave the appointments alone and tell the
coordinator, not to cancel them. Put whichever condition the operator settles
on in that ternary; the door itself does not care and needs no change.

The second half of CR-10's question — "is a cancellation a cancellation or a
request to the practice to ring the household?" — this stream would answer
the first way, on the grounds that the row must not say a visit is going
ahead when the consent for it has gone, and that telling the household is
already a manual step in Phase 1 for every other status change too
(scheduling-manual.md section 3). Nothing here notifies anybody.

---

## 2. A route for the week (trunk)

**What.** `/admin/schedule/week` renders `WeekPage`, behind the same
`canOpenSchedule` guard the day already sits behind.

**Why it cannot wait.** The week view is built, styled and tested
(`app/admin/schedule/WeekPage.tsx`, `tests/scheduling/WeekPage.test.tsx`),
and the day view links to it — but `app/shell/**` is the shared zone, so
until this lands the link goes to the catch-all and the screen is
unreachable in a running app. The same shape as
`docs/CHANGE-REQUESTS/scheduling-03.md` item 1, which the trunk applied in
its round.

**Diff.** Applied to this branch and run: `pnpm typecheck` and the shell's
own seven test files pass with it, and no existing test changes.

```diff
--- a/app/shell/App.tsx
+++ b/app/shell/App.tsx
@@
 import { SchedulePage } from '../admin/schedule/SchedulePage';
+import { WeekPage } from '../admin/schedule/WeekPage';
 import { PracticePage } from '../admin/settings/PracticePage';
@@
         <Route
+          path="schedule/week"
+          element={
+            <RequireAuth>
+              {(actor) =>
+                canOpenSchedule(actor, new Date()) ? (
+                  <WeekPage />
+                ) : (
+                  <Navigate to={homeFor(actor)} replace />
+                )
+              }
+            </RequireAuth>
+          }
+        />
+        <Route
           path="settings/practice"
```

`canOpenSchedule` is already imported in that file and is already the rule
for the day; the week shows strictly less than the day does and should not
have a rule of its own.

---

## 3. Two action names in `domain/shared/actor.ts` (trunk)

**What.** Add `appointment.move` and `appointment.cancel` beside
`appointment.list` and `appointment.create`.

**Why.** `app/api/appointments/move.ts` and `cancel.ts` each compose their
audience out of `hasRole` today, exactly as `create.ts` does for the booking
role. That is honest as a stop-gap and wrong as a destination: "may this
person move a visit" and "may this person book one" are one audience today
and two decisions the first time the practice hires a coordinator who may
rearrange the diary but not fill it. The billing stream made the same request
for the same reason (`docs/CHANGE-REQUESTS/billing-03.md` item 1) and it was
granted.

| Action | owner | admin | finance | lead practitioner | practitioner | client contact |
|---|---|---|---|---|---|---|
| `appointment.move` | yes | yes | no | yes | no | no |
| `appointment.cancel` | yes | yes | no | yes | own stop | no |

```diff
--- a/domain/shared/actor.ts
+++ b/domain/shared/actor.ts
@@
   | { type: 'appointment.create'; practitionerId: string; serviceTypeId: string; on: IsoDate }
+  | { type: 'appointment.move' }
+  | { type: 'appointment.cancel'; ownStop: boolean }
@@
     case 'appointment.create':
@@
       );
+    case 'appointment.move':
+      // Rearranging the diary: the three calendar roles. A practitioner
+      // "request[s] a change (Stage 2)" (docs/SPEC/scheduling-manual.md
+      // section 2) rather than making one, and the row policy on appointment
+      // says the same underneath.
+      return hasRole(actor, 'owner', 'admin', 'lead_practitioner');
+    case 'appointment.cancel':
+      // The same three, for any visit — and a practitioner, for their own
+      // stop alone. They are the person who arrives at a door to find the
+      // visit cannot go ahead. Whether the stop is theirs is the route's to
+      // resolve and pass in, the way ctx.assigneeCapabilities already is;
+      // app.cancel_own_appointment (203) asks it again in the database,
+      // which is the answer that binds.
+      if (hasRole(actor, 'owner', 'admin', 'lead_practitioner')) {
+        return true;
+      }
+      return hasRole(actor, 'practitioner') && action.ownStop;
```

**What scheduling changes when it lands.** The two `hasRole` calls at the top
of `move.ts` and `cancel.ts` become `canActor` calls with these actions. No
route's behaviour changes: the audiences above are exactly what is composed
today, and `tests/scheduling/db/move_and_cancel.test.ts` asserts each of them
against the running routes either way.

---

## 4. One money formatter, where anything may import it (billing)

**What.** Move `formatFils` from `app/admin/billing/money.ts` into
`domain/shared` (`fils.ts` is where it belongs — the type is already there),
and re-export it from `money.ts` so billing's own callers do not move.

**Why.** `docs/CHANGE-REQUESTS/billing-03.md` item 4 invited this import
("import `formatFils` rather than writing a second formatter, and if that
import crossing … is unwelcome, say so"). It is not unwelcome and this pull
request does exactly that: the practitioner's stop card
(`app/therapist/today/TodayPage.tsx`) shows what a household owes and formats
it through `money.ts`, which is the one place money is formatted (CLAUDE.md).

But `money.ts` also carries `previewVat`, which imports `@domain/billing`, so
an `app/therapist` file now reaches billing's domain transitively. Nothing
breaks — there is one browser bundle and `BillingPage` already pulls that
module into it — but it is the shape `docs/SPEC/OWNERSHIP.md` rule 3 exists to
prevent, and it is why `app/therapist/session/dirhams.ts` (session-capture)
duplicated the arithmetic instead, with a comment saying it would stop once
this move happened. Two streams have now met the same wall.

`formatFils` is nine lines of integer arithmetic with no billing dependency
at all. In `domain/shared` it is importable by everyone, `dirhams.ts` becomes
a re-export and then goes, and nobody has to think about this again.

---

## 5. Two tests that fail between midnight and 04:00 (client-record)

**Not caused by this pull request**, and confirmed against `origin/main` at
`f385bd6` in a clean worktree before it was written down: both fail there too,
at the same hour, and pass again after 04:00 Dubai.

- `app/admin/clients/EnrolmentWizard.test.tsx` — "refuses a date of birth in
  the future, naming the field"
- `tests/client/db/identity.test.ts` — "refuses one in the future on create
  and on edit, naming the field"

**What is wrong.** Both build the future date as

```ts
const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
```

which is tomorrow **in UTC**. The rule they are testing is judged in the
practice's own zone — `record-schema.ts`'s `DateOfBirth` refines against
`isoDateIn(new Date(), 'Asia/Dubai')`, and deliberately so, "so a client born
today in Dubai is not refused because the server is still on yesterday". Dubai
is UTC+4, so between 00:00 and 04:00 local, tomorrow-in-UTC *is* today in
Dubai: the date is not in the future, the rule correctly accepts it, and the
test fails.

The rule is right and the fixture is wrong. Either fix works:

```diff
-const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
+// Tomorrow in the practice's own zone, which is what the rule is judged in.
+// One UTC day ahead is still today in Dubai for the first four hours of it.
+const future = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(
+  new Date(Date.now() + 86_400_000),
+);
```

or, more bluntly, `2 * 86_400_000`, which clears any offset the practice could
ever be in. The first says what it means.

**Its effect on this pull request.** `pnpm verify` and `pnpm test:db` are
green here except for these two, and the branch was pushed with them failing
at 00:30 Dubai rather than held until morning, because holding a branch for
four hours to make somebody else's clock-dependent fixture pass would have
been the wrong kind of tidy. Everything this pull request owns is green at
every hour.

---

## 6. Not a request: the unfit fee is recorded, and nothing charges it

The operator set AED 150 for a visit that cannot go ahead once the
practitioner has arrived (2026-09-03). It lives in
`scheduling_setting.unfit_fee_fils`, the owner may change it, and the cancel
drawer shows it when that reason is chosen — saying, in as many words, that
it is not charged automatically and has to be added on the client's account.

**Nothing charges it**, and nothing in this pull request pretends otherwise —
the same discipline the trunk applied to `tenant.vat_registered`
(`docs/CHANGE-REQUESTS/trunk-notes.md`, round 20): a column that reads like a
switch while nothing acts on it is worse than no column at all.

**And there is a question underneath it, for billing and the operator
together.** `unfit_to_attend` is written `cancelled_late`, so billing's
trigger takes one of the client's credits for it — a whole session, around
AED 700 at the practice's own price. If the AED 150 fee is then *also*
charged, the household pays twice for one wasted journey. Three readings are
possible and this stream will not pick between them:

1. the credit is the charge and the AED 150 is a legacy figure to retire;
2. the AED 150 is the charge, and an unfit visit should be plain `cancelled`
   with a fee raised beside it;
3. both, deliberately — the session is consumed and the journey is charged.

The brief this pull request was built to says `unfit_to_attend` "counts as
late", so (3) is what is built, minus the fee nothing charges. Changing to (2)
is one line: move `'unfit_to_attend'` out of `ALWAYS_LATE_REASONS` in
`domain/scheduling/cancellation.ts`, and its two tests with it.

---

## 7. Not a request: billing's waiver has a route and no screen

`POST /api/billing/entitlements/:id/waiver` exists, is tested, and is the way
back from a late cancellation that should not have cost a session
(`docs/SPEC/billing.md` section 4.3 — "a one-click waiver with a reason
field"). Nothing on any screen calls it.

`POST /api/appointments/:id/cancel` now answers with `waiverEntitlementId`:
the exact credit billing's trigger took, or null when it took none. So the
moment a waiver screen exists, the coordinator can go straight from the
cancellation to the credit. Until then the cancel drawer says what happened
and offers a link to Billing, which is as far as an honest screen can go.

---

## 8. Not a request: a moved visit keeps its status

`POST /api/appointments/:id/move` gives the new appointment the status the old
one had, rather than dropping it back to `proposed`.

The argument for dropping it is real: `confirmed` means the client was
informed (scheduling-manual.md section 3) and the household has not been
informed of the *new* window. The argument against is that nothing in this
phase can move a row back to `confirmed` — no route sets that status, and the
"manual toggle in Phase 1" section 3 describes has not been built — so a moved
visit would leave its practitioner's day sheet permanently, since
`app/api/appointments/list.ts` puts on a day sheet only the statuses that are
really stops, and `proposed` is deliberately not one of them.

Losing a visit off a day sheet with no way to put it back is a worse fault
than a status word being ahead of a phone call, so the status carries over and
the Move drawer says on its face that the household still has to be told. The
right fix is the confirm toggle section 3 already asks for; it is a small
route and a smaller button, and it is this stream's to build next.

---

## 9. Not a request: what a move deliberately does not do

Section 2 lists "move, cancel, reassign" as three things a coordinator may do.
This builds the first two. **Reassigning a visit to a different practitioner
is not built** — the move route carries the practitioner over untouched — and
that is a choice, not an omission to be quietly filled in later: reassignment
needs the credentialed-practitioner list the booking drawer already fetches,
and a decision about whether a reassignment is a new appointment or the same
one in different hands. Section 6's continuity warning ("different
practitioner from the client's last 3 sessions") is the same conversation.

Also not built here, and named in `docs/SPEC/scheduling-manual.md` rather than
forgotten: the week's drag-to-move (4.1). A drag with no conflict feedback
beside it is worse than no drag; it belongs with the real calendar grid.

---

## 10. Not a request: the trunk's fixture ask, done

`docs/CHANGE-REQUESTS/trunk-notes.md` (round 14, item 1) asked this stream to
change two `tests/scheduling/db` fixtures from a `consent_text` document to a
`referral` one, so the trunk could add the completeness constraint on the
practice's own consent wording. Both are changed, and the third fixture this
pull request adds (`tests/scheduling/db/move_and_cancel.test.ts`) files a
`referral` too. Nothing in this stream files a bare `consent_text` row any
more; the constraint is clear to land.
