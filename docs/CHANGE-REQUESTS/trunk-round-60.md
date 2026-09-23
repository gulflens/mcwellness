## Round 60 — a visit logged in error is voided or corrected, never deleted (2026-09-23)

The owner is logging a month of visits from the practice's own records, the
work round 51 made possible (`docs/CHANGE-REQUESTS/trunk-round-51.md`), and
booked one of them wrongly. She found that nothing could change or remove it,
and on 23 September 2026 asked for a way to edit or delete a session already
logged, in case anything is entered incorrectly. The operator approved the
design the same evening ("go", 21:18 +04), taking every default put to him, and
the round was built the same night. The spec is
`docs/superpowers/specs/2026-09-23-void-logged-session-design.md`, amended
where the build found something it had not said.

Nothing could touch the row, and by design. A completed session is closed on
insert and `app.session_refuse_update_after_close` (302, restated by 960)
refuses every change to a closed row except inside an erasure; no role holds a
delete grant on `session`, `appointment` or `entitlement`; the credit the visit
consumed had been posted to the books. Round 51 said a wrong visit "is a new
version by the amendment path, which is still unbuilt". Worse for the owner on
the day: the wrong entry was a `completed` appointment, which still held its
window under the calendar's exclusion constraints, so the right visit could not
even be logged beside it.

### The decisions

| Decision | Choice | By |
|---|---|---|
| Delete or void | **Void.** Nothing is deleted: the row stays, stamped with when, by whom and why, and everything that counted it stops counting it | the repository's own rules (CLAUDE.md 7, no delete grants, the hashed audit chain) |
| What "edit" means | **Correct = void the wrong one and log the right one, in one transaction.** The right one is version 2 of the wrong one (`supersedes_id`, `amendment_reason`), which is the amendment path the data model always named | design, on the owner's ask |
| Which sessions | **Only sessions logged from the records** (`recorded_from = 'records'`). A visit closed on the phone carries events, readings and actuals, and unwinding one the household actually had is a credit note, unbuilt and a different piece (`docs/SPEC/billing.md` section 4.3) | operator, 23 September, default taken |
| Who may | owner, admin, lead practitioner: the three who may log one | design, mirrors `session.record_past` |
| The credit | comes back **the way a waiver gives one back**: the consumed row is marked `waived` with the reason and a replacement credit is written pointing back at it, so the books post "Credit restored" against the income they already recognised. A row marked settled before the app restores nothing | design; `app/api/billing/waivers.ts` is the shape |

### The one design call

**A void is a stamp on a closed record, not an edit of it.** The invoice
waiver stamps `waived_at`, `waived_by` and `waiver_reason` onto an append-only
invoice, and a consent withdrawal stamps `withdrawn_at` onto a consent; neither
rewrites a fact the record holds. A voided session keeps its date, its
service, its practitioner and its length exactly as logged. What it gains is a
status and three columns saying it was withdrawn from the record. The close
guard admits **exactly that transition and nothing else**, and any change to a
voided row is refused as any change to a closed row always was.

### What it does now

**Migration `969_void_recorded_session.sql`**, in the trunk's second half. It
alters `appointment` (scheduling's) and `session` (session-capture's) and
writes `entitlement` (billing's), so it sorts after all three, as 966 did.

1. `voided` added to `appointment_status` and `session_status`.
2. `voided_at`, `voided_by` and `void_reason` on both `session` and
   `appointment`, with one check on each: the three are all null, or all set
   with a reason that is more than whitespace — the rule the `X-Reason` header
   already has on every session route. A partial index on each `voided_by`.
3. **`app.void_active`** (`txid`, `session_id`), a transaction marker in the
   shape of 098's `app.erasure_active`: no grant to `app_role` or `public`, row
   security on with no policies. Exempt from the standard columns on 098's
   footing, now written into `.claude/rules/data-model.md`.
4. **The close guard**, restated as a diff of 960, its latest text. One
   transition is admitted on a closed row: `completed` to `voided`, on a
   `records` row, with the three void columns filled, every other column
   standing still (compared as `to_jsonb` with the five void keys removed), and
   **only while `app.void_active` names this session in this transaction**.
   The erasure branch is unchanged.
5. **`app.void_recorded_session(p_session_id, p_reason) returns jsonb`**,
   security definer, `search_path` pinned to `pg_catalog, pg_temp` with every
   table schema-qualified, as 968 does; execute granted to `app_role` and
   revoked from `public`. It reads the actor's roles from `user_role`, not the
   claim (923's reason), and refuses anyone but the owner, an admin or the lead
   practitioner; locks the session `for update` in the actor's practice;
   refuses a missing row, a row already voided, a `device` row, a row not
   completed, and a row an `assessment`, an `invoice` or a `billing_exception`
   still names — every refusal `restrict_violation` with its code as the
   message, the family's shape. Then it writes its marker, stamps the session
   and the appointment it fulfils, removes the marker, and gives back the
   consumed credit exactly as `app/api/billing/waivers.ts` does: the row marked
   `waived`, a replacement written from the same purchase, service, value and
   expiry with `replaces_entitlement_id` pointing back. It answers
   `{ sessionId, appointmentId, creditRestored }`.

**Migration `970_voided_frees_the_window.sql`**: everything that must name the
new value in a constraint, which the transaction that added it cannot.

1. The two exclusion constraints on `appointment` (200), dropped and recreated
   exactly as 200 wrote them with `voided` beside `cancelled`,
   `cancelled_late`, `no_show` and `rescheduled`. This is what frees the
   window.
2. 302's `session_closed_is_settled`, restated with `voided` among the statuses
   a closed row may hold, because a voided row keeps its `closed_at` — which is
   what keeps the guard in front of it.
3. `session_void_only_when_voided` and `appointment_void_only_when_voided`:
   the stamp and the status go together **both ways** — the stamp only on a
   `voided` row, and a `voided` row only with its stamp. On `session`, also
   `session_voided_is_a_closed_records_row`: `voided` only on a closed row
   logged from the records.
4. **`app.refuse_void_without_marker()`**, a `before insert or update` trigger
   on `session` and on `appointment` alike, `enable always`, security definer
   with `search_path` pinned as 968's family is and execute revoked from
   `public`. A row becomes `voided` — inserted so, or updated to it from any
   other status, open or closed — only while `app.void_active` names it in
   this transaction: the session by its id, the appointment through the
   session that points at it. Anything else is `restrict_violation`
   `void_needs_the_function`. The function removes its marker only after the
   appointment's update, so its own two writes pass. And a voided appointment
   is final: any change to one that is not a no-op is refused
   `voided_appointment_is_final`, unless an erasure is under way (971 rewrites
   its reason). A voided session needs no such branch; the close guard already
   refuses every change to a closed row. (Added by the final reviews and their
   re-review; see below.)

**Migration `971_erasure_reaches_the_void_reason.sql`** (added by the final
reviews):

1. `app.erase_client`, restated as a diff of 968 (it must sit above the highest
   file that defines the function, 964's rule): step 4c's session statement
   also replaces `void_reason` with the fixed phrase `amendment_reason` already
   takes, "Erased with the record", and a new step 4c' does the same for the
   voided appointments' `void_reason`. A phrase and not a null, because the
   together-checks forbid a voided row without a reason. The credit's
   `waiver_reason` is **not** touched: a waiver's reason is part of the
   financial record and is kept five years, as every waiver's is.
2. `session_supersedes_same_client_fk`: `(tenant_id, client_id,
   supersedes_id)` references `session (tenant_id, client_id, id)`, so a
   correction's version 2 belongs to the household its version 1 was logged
   for. The unique key it needs was already there (`session_tenant_id_client_key`,
   the one assessment's composite key relies on).

**The rule and the routes.** `domain/session/voidSession.ts` is the pure rule
(`canVoidRecordedSession`, reasons `wrong_role`, `not_a_records_row`,
`not_completed`, `already_voided`, `session_in_use`), and `session.void` joins
`domain/shared/actor.ts` with the roles of `session.record_past`. The route
asks the rule first so a refusal is a sentence before it is an exception; the
function asks again under its lock.

- `POST /api/sessions/:id/void`, `X-Reason` required, body `{}`. 400
  `invalid_request` for an id that is not a uuid, 400 `reason_required`, 403
  `wrong_role`, 404 when the visit is not the caller's to see (never a 403 that
  would confirm it exists), 409 `conflict` with one of the four codes. A
  refusal the function raises in a race maps to the same codes. Success is 200
  and the sensitive action `session_voided` under the reason; every refusal is
  logged before the answer.
- `POST /api/sessions/from-records` gains an optional `replaces`. **Correct is
  one act**: inside the existing savepoint the function voids the wrong visit
  first, which frees the window, and the new appointment and session are then
  written with `version` one more than the old, `supersedes_id` the old, and
  `amendment_reason` the reason. A refusal of either half rolls back both, so
  the wrong visit is never gone while the right one is missing. The 201 answer
  gains `voided`. This is the first real use of `supersedes_id` and
  `amendment_reason` on `session`. **A correction stays with the same
  household**: when the visit it replaces was logged for another household,
  the route refuses 409 `conflict` with `different_client`, logged before the
  answer and before the function is called, and the correction drawer says "A
  correction stays with the same household. Void this visit and log the right
  one instead." (971's composite key refuses the same underneath.)

**The screens** (`app/admin/schedule/`). The day list's rows carry the visit's
`sessionId`, `recordedFrom`, `settledOutsideApp` and `sessionMinutes`, from the
newest session on each appointment. A `completed` row logged from the records
shows **Correct** and **Void** to the three roles. **Void** opens
`VoidSessionDrawer`, which says in two sentences what will happen — the window
is freed; the credit comes back, or nothing does because the visit was settled
before the app — takes the reason and posts. **Correct** opens
`LogPastSessionDrawer` as "Correct a past session", pre-filled from the row
(household, service, place, practitioner, day, start, length, billing), with
`replaces` set and a fresh reason required. A `voided` row shows the chip
"Voided", greyed, and no actions. `create.ts` and `move-one.ts` leave a voided
visit out of their conflict read, as 970 leaves it out of the constraints.
**The dispatch board does not show a voided visit at all** (ruled in the final
wave: it never happened and nobody expected it, so it is not a call-off).

**The portal.** `domain/portal/visits.ts` does not list a voided visit: it is
not a visit the household had. The money screen reads credits by status, so the
replacement credit shows as available and the waived one does not, untouched.

**The Timeline.** `domain/shared/audit-narrative.ts` gains `session.session_voided`
in both languages, and `session.refused` now reads as a sentence per code —
the past-session route's codes, the four void codes, and five the older session
routes write — rather than printing the raw code the owner saw before. A code
it has no phrase for reads as a refusal with no reason given, never as the code.

### The reviews

Each task was reviewed read-only as it landed, and one found a hole the plan
itself had written in.

- **The marker** (the second task's review). As first built, the guard admitted
  `completed` to `voided` on the row's shape alone. The API role holds a
  table-wide update grant on `session`, so a plain `update session set status =
  'voided' …` from any code path would have passed it — skipping the role read,
  the in-use refusal and the credit's return, and leaving a consumed credit
  standing against a visit that no longer counted. The fix is the erasure's own
  pattern: `app.void_active`, written and cleared only by the function, and a
  guard that admits the transition only while it names the session. A case now
  runs the function's very update as the API role, outside the function, and
  is refused; another proves no marker outlives the call.
- **The finance test** (the fourth task's review). The case that finance sees no
  Correct or Void slept 20 ms and then looked for the buttons' absence, so it
  passed whether or not anyone had signed in. It now waits on the signed-in
  answer itself, runs the owner through the same wait first as a control, and
  was shown to fail when the role gate is removed.
- **The five phrases** (the third task's ruling). Once `session.refused` became
  a sentence per code, the generic sentence would have hidden five codes the
  check-in, close and events routes already write (`already_checked_in`,
  `service_type_not_found`, `session_closed`, `session_not_open`,
  `not_checked_out`), where the Timeline had at least printed them. They have
  phrases now, in both languages, so the Timeline says no less than it did.

**The final reviews** (whole-branch, security, schema and compliance, read-only
on the finished branch) converged on three more, all fixed in this round:

- **The voided status could be written outside the function** (security,
  must close). The marker opened the close guard, but the close guard returns
  early on an OPEN row, there was no insert guard, and `appointment` had no
  guard at all. So the API role could move an open session straight to
  `voided` (a practitioner on their own rows included), insert a session
  already `voided`, or `update appointment set status = 'voided'` and free a
  window with the visit behind it still completed. Fixed in 970: the two-way
  checks, the closed-records check on `session`, and
  `app.refuse_void_without_marker` on both tables. Three cases were watched
  red first — each write went through against the old 970 — and are refused
  now with `void_needs_the_function` (or `23001` for the owner's own
  appointment update); a fourth proves `app_role` can neither read nor write
  `app.void_active`. The re-review found one residual: `appointment` has no
  close guard, so a voided appointment could be moved back to `completed` or
  `cancelled` with its stamp nulled, re-occupying the window with the session
  still voided, or have its reason or author rewritten. The same trigger now
  refuses any change to a voided appointment outside an erasure
  (`voided_appointment_is_final`). The move to `cancelled` and both rewrites
  were watched go through first; the move to `completed` was already stopped,
  but only by the exclusion constraint of the visit logged in its place.
- **The erasure missed the void reason** (compliance). `app.erase_client`
  cleared `amendment_reason` but not the new `void_reason` on the session or
  the appointment, free text about the household that would have outlived
  the erasure. Fixed by 971; a case erases a household with a voided visit and
  finds both reasons read "Erased with the record", the waiver's reason
  untouched, and the audit chain intact.
- **A correction could cross households** (compliance and schema).
  `supersedes_id` was bound to the practice only, so a version 2 for one
  household could name another's visit as its version 1. Fixed by the route's
  `different_client` refusal and 971's composite key, each with a case.

The same pass took the small ones: 969's credit update names its tenant
(`and tenant_id = v_tenant`); 969's `-- Needs:` header lists 951 so the
runner's parser counts it; the void drawer's `session_in_use` sentence no
longer tells anyone to remove a measurement ("A measurement or a billing
record still names this visit, so it cannot be voided." — a measurement is
versioned, never removed); the schedule's `isCorrectable` moved into the
domain as `isVoidableRow` (`domain/session/voidSession.ts`, CLAUDE.md rule 4)
with its own cases; the office's three roles are named once, `OFFICE_ROLES` in
`domain/shared/actor.ts`, and used by `session.record_past`, `session.void` and
`voidSession.ts`; a cross-tenant `not_found` case at the function; and a unit
test for `voidFunctionRefusal` (`app/api/sessions/void.test.ts`).

### Found beside it, and not fixed here

1. **The credit's reason is cut to 200 characters.** 403 caps
   `entitlement.waiver_reason` at 200, while `X-Reason` allows 500. The
   function stores the first 200 on the waived credit; the session and the
   appointment keep the whole reason, and the audit row carries it whole. The
   alternative, refusing a long reason, would have needed a code the design did
   not name.
2. **The Arabic.** The new Timeline sentences carry Arabic, as every sentence
   in the catalogue must. It was written in the build and has not been read by
   an Arabic speaker; the console is English only, so it is seen only where the
   narrative is asked for in Arabic.
3. **`pnpm test:db -- <file>` runs everything.** The `--` is passed through and
   the filter is lost, so it runs the whole database suite; `pnpm test:db
   <file>` runs one file. A trap for anyone checking one file, harmless
   otherwise.
4. **A pre-existing `DeprecationWarning` from `pg`** (a second `client.query`
   before the first resolves) prints in the void and from-records runs. It
   comes from `app/api/billing/packages.ts:149` through the harness, not from
   this round.
5. **Small things the reviews deferred**, none a fault in what ships:
   - no test isolates `already_voided` from `not_a_records_row` on a voided
     `device` row (a row real data cannot produce, and 970 now forbids);
   - only the session's audit row asserts the actor; the appointment's and the
     credit's rows are covered by the chain check alone;
   - the database cases depend on each other's order;
   - `logged` is shadowed in one from-records case;
   - the "logs before answering" case checks that the row is there, not that it
     came first;
   - no database case for two sessions on one appointment;
   - `sessionMinutes` is read from the session's start and end, so a visit
     logged with no length pre-fills the service's default length as if the
     office had typed it;
   - the table of 409 sentences lives in a component file
     (`VoidSessionDrawer.tsx`), shared with the correction drawer from there;
   - a fresh log follows the day the drawer opened on, not the page's current
     date;
   - no test for the correction drawer's 409 path or for the page reloading
     after one.

Two further minors from the fourth task's review were taken in this round
rather than deferred: the void drawer's `session_in_use` sentence (since
reworded again by the final reviews, above); and `ReplacedVisit.deliveryMode`,
which nothing read, is removed with its fill on the schedule — the correction
drawer reads the delivery mode from the chosen place, as a fresh log does.

### Every file this round touched outside the trunk's own paths

The function writes three streams' tables — `appointment` (scheduling),
`session` (session-capture) and `entitlement` (billing) — from a trunk
migration, as 966 did. The code rides in this round's pull request by the
integrator's widening for one round, as rounds 41, 51, 52, 58 and 59 were
widened (`docs/SPEC/OWNERSHIP.md`):

- `session-capture`: `domain/session/voidSession.ts` (new) with its test and
  the barrel; `app/api/sessions/void.ts` (new) with `void.test.ts` (new),
  `from-records.ts`, `schema.ts` and `checkin.ts` (the mount); `tests/session/db/void.test.ts` (new) and
  `from_records.test.ts`.
- `scheduling`: `domain/scheduling/status.ts` with its test;
  `app/admin/schedule/SchedulePage.tsx`, `LogPastSessionDrawer.tsx`,
  `VoidSessionDrawer.tsx` (new) and `appointmentStatus.ts`;
  `app/api/appointments/list.ts`, `schema.ts`, `create.ts` and `move-one.ts`;
  under `tests/scheduling/`, `SchedulePage.test.tsx`,
  `LogPastSessionDrawer.test.tsx`, `VoidSessionDrawer.test.tsx` (new) and
  `db/list_sessions.test.ts` (new), and four null fields added to the row
  fixtures of `DayMapPage`, `MoveAndCancelDrawers`, `NewAppointmentDrawer`,
  `OptimiseDrawer` and `WeekPage`'s tests.
- `dispatch`: `domain/scheduling/lateness.ts` with its test,
  `app/api/appointments/board.ts`, and `tests/dispatch/db/board.test.ts`.
- `client-portal`: `domain/portal/visits.ts` with its test, and
  `docs/SPEC/client-portal.md` section 3.2.
- The streams' documents: `docs/SPEC/session-capture.md` sections 4, 8 and 9,
  `docs/SPEC/scheduling-manual.md` section 3, `docs/SPEC/dispatch.md` 4.4 and
  `docs/SPEC/billing.md` 4.3.

The trunk's own half is migrations 969, 970 and 971, `domain/shared/actor.ts`
(with `OFFICE_ROLES`) and
`audit-narrative.ts` with their tests, `.claude/rules/data-model.md`,
`docs/SPEC/00-data-model.md` (`session`, `appointment`, `entitlement`),
`docs/SPEC/OWNERSHIP.md` and this record. **No policy file**: `git diff
origin/main -- db/policies` is empty on the branch. The function is the
boundary for the void, and the routes read as the caller under the policies
already there.

### Proof

Tests first, each watched red before the code that made it green (the task
reports hold the red runs):

- `tests/session/db/void.test.ts` (new, 22 cases, six of them the final
  reviews': a voided appointment is final outside an erasure; the voided status refused outside the function on an open row, an
  insert and an appointment; the marker out of `app_role`'s reach; the
  function's cross-tenant `not_found`; a correction naming another household's
  visit refused by 971's key; and an erasure reaching both void reasons while
  the waiver's stays): a void frees the window and
  the right visit can be logged at the same hour; the credit comes back as a
  replacement matching the original on every copied column, the purchase's
  credits still total what was paid, and the books' event is `credit.waived`
  with its replacement; a settled row restores nothing; a `device` row, an
  unfinished row, a voided row, a row a measurement names, and a finance actor
  are each refused with their own code; the guard still refuses every other
  change to a closed row and every change to a voided one; the API role's own
  update outside the function is refused; no marker outlives the call; the
  route's 200, 400s, 403s, 404s and four 409s, every refusal logged; and
  `app.verify_audit_chain()` is null at the end.
- `tests/session/db/from_records.test.ts` (4 cases added): a correction is
  version 2 superseding the old with the reason and both trail rows; a second
  correction of the same visit is `already_voided` and an unknown one 404; a
  correction for another household is 409 `different_client`, logged, nothing
  voided; an overlap on the new visit rolls the void back too.
- `tests/scheduling/db/list_sessions.test.ts` (new, 3 cases): the day list
  carries the visit's session fields.
- `tests/dispatch/db/board.test.ts` (1 case added): a voided visit is not on the
  board and writes no list row; shown to fail with the board reading every
  status.
- `domain/session/voidSession.test.ts` (new, 12 cases): every reason, in
  order; `isVoidableRow`; the office roles named once.
- `app/api/sessions/void.test.ts` (new, 3 cases): `voidFunctionRefusal` reads a
  known code, answers null for an unknown message and for another SQLSTATE.
- `domain/shared/actor.test.ts` (1), `audit-narrative.test.ts` (5),
  `domain/portal/visits.test.ts` (1), `domain/scheduling/status.test.ts` (1),
  and `lateness.test.ts` (voided never taken for the previous visit).
- `tests/scheduling/SchedulePage.test.tsx` (5 cases added),
  `VoidSessionDrawer.test.tsx` (new, 6) and `LogPastSessionDrawer.test.tsx` (2
  added: the pre-fill, and `replaces` in the body).

`pnpm verify` and `pnpm test:db` both green on the branch's head; the counts
are in the pull request.

### Going live

**Merged is not live.** Three migrations and no policy file. **This pass comes
after passes 34 and 35**: 971 restates `app.erase_client` as a diff of 968,
which pass 35 makes live, and the ledger count below assumes both have run.

1. **The pre-pass read**, on production:
   `select count(*) from session where recorded_from = 'records';` — how many
   visits logged from the records exist, and so how many rows a void could
   ever reach. Say the number in the pass's record. Nothing is voided by the
   pass itself. And `select count(*) from session where supersedes_id is not
   null;`, **expect 0**: 971's composite key would fail the pass on a
   correction that already names another household's visit, and none can
   exist before this round.
2. The hold protocol.
3. `969_void_recorded_session.sql` by hand, **staging first and then
   production**, the file's statements whole and **its ledger row in the same
   call**, with the sha256 of the file's text taken from `main` after the
   merge. Then `970_voided_frees_the_window.sql` the same way, in its own call:
   970 names the value 969 adds, and a new enum value cannot be used in the
   transaction that added it. Then `971_erasure_reaches_the_void_reason.sql`
   the same way, in its own call. The ledgers go from **111 to 114**. Never
   `pnpm db:reset` and never the runner against a hosted database.
4. **No policy file is expected**: confirm on `main` after the merge with `git
   diff <the live commit> -- db/policies` — empty on the branch against
   `origin/main` — and re-apply nothing.
5. **Fingerprint** against a runner-built local database, on both hosted ones:
   the columns, constraints and triggers of `appointment`, `session` and
   `entitlement`; the values of `appointment_status` and `session_status`;
   `app.void_recorded_session`, `app.session_refuse_update_after_close`,
   `app.refuse_void_without_marker` (its trigger on both tables, `enable
   always`) and `app.erase_client`,
   each with its definer flag, its pinned search path and who may execute it
   (`app_role` for the void and the erasure, nobody for the two trigger
   functions, `public` for none); `app.void_active`'s grants —
   **none to `app_role` or `public`**, row security on and no policy; and the
   ledger.
6. Then the code, by the recipe. The proof is read out of the served bytes:
   "Correct a past session" and "Voided" in the served schedule chunk
   (`SchedulePage-*.js`, or the chunk that carries the drawer or the status
   words if the bundler splits them), and the old chunk answering 404.

**Old code on the new schema is safe.** No old path writes `voided`, and every
old reader filters by the statuses it already knows: the old schedule's day
list would show a voided row's raw status only if one existed, and none can
until the new code is live to call the function. So the window between the
migrations and the build is the safe direction.

**Rollback, and the stale window.** An installed window still on the OLD
build parses an appointment's `status` with a zod enum that lacks `voided`.
Once anything is voided, the schedule day, or the board for that date, fails
on that window until it reloads. The shell's newer-build check from round 56
picks this up; if the owner reports a day that will not open, say Cmd+R first.
The same holds after a rollback of the code with voided rows left standing.

**Why a void may waive a session-consumed credit.** `app/api/billing/waivers.ts`
says unwinding a delivered session is a credit note, not a waiver. That
applies to a visit the household had. A void is for a visit that never
happened (logged in error), so nothing was delivered, and giving the credit
back as a waiver is correct. That is why the books post "Credit restored" and
no credit note is raised.

**The erasure letter is unchanged.** The approved wording (version 1.1) is the
operator's, and this round does not reword it. 971 makes the erasure reach the
void reason; whether the letter should say so in as many words is the
operator's call, not this round's.

**Nothing to run on production's rows.** The migrations change no data: no row
is voided, no credit moves, the constraints recreated in 970 accept every row
they accepted before, and 971's composite key holds for every correction that
exists, because none does before this round.
