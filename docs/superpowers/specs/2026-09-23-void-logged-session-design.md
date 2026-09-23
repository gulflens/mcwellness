# A logged session that was wrong: void it, or correct it

**Date:** 23 September 2026. **Status:** design approved by the operator ("go",
21:18 +04, taking the defaults put to him); building as trunk round 60.

## Why

The owner is logging a month of visits from the practice's records
(`docs/superpowers/specs/2026-09-16-past-sessions-design.md`, round 51) and
booked one of them wrongly. She found there is no way to edit or delete it and
asked for one: "we definitely need the ability to edit or delete previously
logged sessions in case anything is entered incorrectly."

Today nothing can touch a logged session. A completed session is closed on
insert and `app.session_refuse_update_after_close` (migration 302, `enable
always`) refuses every change to a closed row except inside an erasure; no
role holds a delete grant on `session`, `appointment` or `entitlement`; the
credit the visit consumed is a row whose status moved to `consumed` and whose
consumption was posted to the books. Round 51 said a wrong visit "is a new
version by the amendment path, which is still unbuilt". Worse for the owner
right now: the wrong entry is a `completed` appointment, and a completed
appointment still holds its window under the calendar's exclusion
constraints, so the right visit cannot even be logged beside it.

## Decisions

| Decision | Choice | By |
|---|---|---|
| Delete or void | **Void.** Nothing is deleted: the row stays, stamped with when, by whom and why, and everything that counted it stops counting it | the repository's own rules (CLAUDE.md 7, no delete grants, the hashed audit chain) |
| What "edit" means | **Correct = void the wrong one and log the right one, in one transaction.** The right one is version 2 of the wrong one (`supersedes_id`, `amendment_reason`), which is the amendment path the data model always named | design, on the owner's ask |
| Which sessions | **Only sessions logged from the records** (`recorded_from = 'records'`). A visit closed on the phone carries events, readings and actuals, and unwinding one the household actually had is a credit note, unbuilt and a different piece (`docs/SPEC/billing.md` section 4.3) | operator, 23 September, default taken |
| Who may | owner, admin, lead practitioner: the three who may log one | design, mirrors `session.record_past` |
| The credit | comes back **the way a waiver gives one back**: the consumed row is marked `waived` with the reason and a replacement credit is written pointing back at it, so the books post "Credit restored" against the income they already recognised. A row marked settled before the app restores nothing | design; `app/api/billing/waivers.ts` is the shape |

## The one design call this spec makes

**A void is a stamp on a closed record, not an edit of it.** The invoice
waiver stamps `waived_at`, `waived_by` and `waiver_reason` onto an append-only
invoice and a consent withdrawal stamps `withdrawn_at` onto a consent; neither
rewrites a fact the record holds. A voided session keeps its date, its
service, its practitioner and its length exactly as logged; what it gains is
a status and three columns saying it was withdrawn from the record. The close
guard is restated to allow **exactly that transition and nothing else**: from
`completed` to `voided`, on a `records` row, with the three void columns
filled and every other column unchanged. Any other change to a closed row is
refused as it always was, including any change to a voided row.

## Shape

### Migration `969_void_recorded_session.sql` (trunk, second half; after 968)

- `alter type appointment_status add value 'voided'` and
  `alter type session_status add value 'voided'`. A new value cannot be used
  in the transaction that adds it, so the two exclusion constraints that must
  learn it are the next file's.
- `session` and `appointment` each gain `voided_at timestamptz`, `voided_by
  uuid references app_user (id)` and `void_reason text`, with one check per
  table: the three are all null or all set, and set only when `status =
  'voided'`; `void_reason` is non-empty after trimming, the same rule the
  `X-Reason` header already has on every session route.
- `app.void_active (txid bigint, session_id uuid)`, a bookkeeping table in the
  shape of `app.erasure_active` (098): no grant to `app_role` or `public`;
  written and cleared only by the function below, so that the one door is the
  only door. _Added in the build (task review, 23 September): without it the
  API role's table-wide update grant let a plain `update session set status =
  'voided' …` pass the guard, skipping the role check, the in-use refusal and
  the credit restoration._ It is exempt from the standard columns as
  `app.erasure_active` is (`.claude/rules/data-model.md`).
- `app.session_refuse_update_after_close`, restated in full as a diff of its
  latest text (960): before the existing comparison, allow the row through
  when `old.status = 'completed'`, `old.recorded_from = 'records'`, `new.status
  = 'voided'`, the three void columns are set on `new`, `to_jsonb(new)` with
  the keys `status`, `voided_at`, `voided_by`, `void_reason` and `updated_at`
  removed equals `to_jsonb(old)` with the same keys removed, **and
  `app.void_active` names this session in this transaction**. The erasure
  branch stays.
- `app.void_recorded_session(p_session_id uuid, p_reason text) returns jsonb`,
  security definer, `search_path` pinned, execute granted to `app_role` and
  revoked from `public`, in the family 968 set. It:
  1. reads the actor from the request stamp and their roles **from
     `user_role`**, not from the claim (the reason 923 gives), and refuses
     unless one of them is owner, admin or lead practitioner;
  2. locks the session row `for update` in the actor's practice; refuses a
     missing row, a `device` row, a row not `completed`, a row already
     `voided`, and a row an `assessment`, an `invoice` or a
     `billing_exception` still names (`session_in_use`); every refusal is
     `restrict_violation` told apart by its message, the family's shape;
  3. writes its marker into `app.void_active`, stamps the session `voided`
     with `now()`, the actor and the reason;
  4. stamps the appointment it fulfils `voided` the same way, which is what
     frees the window, and removes its marker;
  5. finds the credit with `consumed_by_session_id = p_session_id` and
     `status = 'consumed'`, marks it `waived` with `waiver_reason = p_reason`
     (cut to the 200 characters migration 403 allows a waiver reason; the
     session and the appointment keep the whole reason), `waived_at`,
     `waived_by`, and inserts the replacement credit exactly as
     `app/api/billing/waivers.ts` does (same purchase, service, value and
     expiry, `replaces_entitlement_id` pointing back). A settled-outside row
     has no such credit and this step writes nothing;
  6. returns `{ "sessionId", "appointmentId", "creditRestored": bool }`.

### Migration `970_voided_frees_the_window.sql` (trunk, second half)

The two exclusion constraints on `appointment` (migration 200) are dropped and
recreated with `voided` added to the statuses they ignore, beside `cancelled`,
`cancelled_late`, `no_show` and `rescheduled`; 302's `session_closed_is_settled`
check is restated to admit `voided` beside the five statuses it already admits,
because a voided row keeps its `closed_at`; and each table gains a check that
the void columns are set only when the status is `voided`. Nothing else.

### Domain (`domain/session/voidSession.ts`, pure, tested first)

`canVoidRecordedSession({ actorRoles, session: { recordedFrom, status,
voidedAt }, inUseBy: { assessments, invoices, exceptions } })` returns `{ ok:
true }` or `{ ok: false, reason }` with the reasons `wrong_role`,
`not_a_records_row`, `not_completed`, `already_voided`, `session_in_use`. The
database function enforces the same rule; the route asks the domain first so
a refusal is a sentence before it is an exception. `session.void` joins
`domain/shared/actor.ts` with the roles of `session.record_past`.

### Routes (session-capture's paths, mounted by `mountSessions`)

- `POST /api/sessions/:id/void`, `X-Reason` required (400 `reason_required`),
  no body. 403 `wrong_role`; 404 when the row is not the actor's to see; 409
  `not_a_records_row`, `not_completed`, `already_voided`, `session_in_use`.
  Success 200 `{ sessionId, appointmentId, creditRestored }`, audited as the
  sensitive action `session_voided` under the reason; every refusal logged
  through `logRefusal` before the answer.
- `POST /api/sessions/from-records` gains an optional `replaces: uuid`. With
  it, the route calls `app.void_recorded_session(replaces, reason)` first,
  inside the same savepoint as the two inserts, then inserts the new session
  with `supersedes_id = replaces`, `version = old.version + 1` and
  `amendment_reason = reason`. A refusal of either half rolls the whole act
  back: the wrong visit is never gone while the right one is missing. The
  consumption trigger then takes the oldest credit valid on the new date,
  which may be the replacement credit just written. Success 201 adds
  `voided: { sessionId, appointmentId, creditRestored }`.

### Screens (`app/admin/schedule/`)

- The day list's rows carry `sessionId` and `recordedFrom` (the list query
  joins `session` on `appointment_id`). A `completed` row logged from the
  records shows two actions in the Change column: **Correct** and **Void**.
  A `voided` row shows the chip "Voided", greyed, and no actions.
- **Void** opens a drawer that says what will happen in two sentences (the
  window is freed; the credit comes back, or nothing comes back because the
  visit was settled before the app), takes the reason, and posts. The day
  reloads.
- **Correct** opens `LogPastSessionDrawer` pre-filled from the row (client,
  service, location, practitioner, day, start, length, billing choice) with
  `replaces` set and a fresh reason; on success the day reloads and the new
  visit stands in the list as completed.
- `appointmentStatus.ts` and `domain/scheduling/status.ts` learn `voided`;
  filters treat it as they treat `cancelled`.

### The portal and every other reader

- `domain/portal/visits.ts`: `voided` is not a visit the household had, so
  it is not listed. The money screen already reads credits by status, so the
  replacement credit appears as available and the waived one does not.
- Session numbering, the report and assessment pickers, the review prompt and
  the books all read `status = 'completed'` and stop counting a voided row
  without being touched. Anything that enumerates the status union in
  TypeScript is completed by the compiler.

### The Timeline

`domain/shared/audit-narrative.ts` gains `session.session_voided` in both
languages, and a `session.refused` case so the refusal codes the past-session
route already writes (`no_credit_available` first among them) read as
sentences rather than as the raw code the owner sees today.

## Tests

- `tests/session/db/void.test.ts`: a void frees the window (the right visit
  can then be logged at the same hour); the credit comes back as a
  replacement and the books' event reads "Credit restored"; a settled row
  restores nothing; a device row, a scheduled row, a voided row, a row an
  assessment names, and a finance actor are each refused with their own
  message; the close guard still refuses every other change to a closed row,
  and every change to a voided row; `app.verify_audit_chain()` is null after
  all of it.
- `tests/session/db/from_records.test.ts`: `replaces` voids and logs in one
  act; the new row is version 2 superseding the old with the reason; an
  overlap on the new visit rolls the void back too.
- `domain/session/voidSession.test.ts`: every reason.
- `tests/scheduling/SchedulePage.test.tsx`, a `VoidSessionDrawer.test.tsx`,
  `LogPastSessionDrawer.test.tsx` (pre-fill and `replaces` in the body).
- `tests/portal/`: a voided visit is not listed.
- `domain/shared/audit-narrative.test.ts`: the two new sentences.

## Not in this round

A void or credit note for a visit closed on the phone. Editing a logged
session's fields in place. A note on a voided visit beyond its reason.

## Risks stated

- A replacement credit carries the original expiry, so a credit restored
  months after the package expired is restored expired, exactly as a waiver
  would restore it; the household keeps what it paid for under
  `docs/SPEC/billing.md` section 4.3 either way, because nothing here changes
  what "expired" means.
- The two enum additions are permanent; Postgres cannot remove a value. The
  rollback comment says so and names the columns to drop instead.
- Old code on the new schema is safe: no old path writes `voided`, and every
  old reader filters by the statuses it already knows.
