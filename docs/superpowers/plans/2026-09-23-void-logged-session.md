# Void or correct a logged session (round 60) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office can void a session it logged from the records by mistake, or correct it, and the schedule, the credit, the books and the portal all follow.

**Architecture:** A void is a stamp on the closed record, never an edit of its facts: a new `voided` status on both `session` and `appointment` with `voided_at`, `voided_by` and `void_reason`, written by one security-definer function that also frees the calendar window and gives the credit back the way a waiver does. The close guard learns exactly that one transition. Correct = void plus log again in one transaction, the new session being version 2 of the old. Everything else reads `status = 'completed'` and stops counting a voided row on its own.

**Tech Stack:** SQL migrations 969 and 970 (trunk, second half), plpgsql definer function, Hono routes (`app/api/sessions/`), pure rules in `domain/session/`, React (`app/admin/schedule/`), Vitest + real database tests.

**Spec:** `docs/superpowers/specs/2026-09-23-void-logged-session-design.md` — read it first; it is the authority for every decision below.

## Global Constraints

- Only `recorded_from = 'records'` rows may be voided or corrected. A `device` row is refused everywhere: domain, function, route, screen.
- Roles: owner, admin, lead practitioner — the roles of `session.record_past` in `domain/shared/actor.ts` (~295-306). The function reads roles from `user_role`, never from the claim (migration 923's reason).
- `X-Reason` required and non-empty after trim (`from-records.ts:116` is the shape: 400 `reason_required`). The reason lands on the row (`void_reason`), on the audit row (`app.reason`) and, for a correction, on the new session's `amendment_reason`.
- The credit comes back as a waiver does: the consumed row → `status = 'waived'`, `waiver_reason`, `waived_at`, `waived_by`; a replacement row inserted with the same `client_id, service_type_id, source_type, package_purchase_id, invoice_id, allocated_net_fils, vat_rate_basis_points, vat_setting_version, expires_on` and `replaces_entitlement_id` = the waived row (`app/api/billing/waivers.ts:47-51` is the column list). Never `status = 'available'` on the consumed row: its consumption was posted to the books.
- Every refusal from the function is `restrict_violation` with a distinct message; the route maps messages to codes. Every route refusal is logged with `logRefusal(db, 'session', sessionId, clientId, [code])` before the answer; success is logged with `logSensitive(db, 'session_voided', 'session', sessionId, clientId)` (`app/api/sessions/audit.ts:18-51`).
- Audit narrative keys are `${entityType}.${action}`: add `session.session_voided` and `session.refused` (`domain/shared/audit-narrative.ts`, the `session.session_recorded_from_records` case at ~843 is the shape).
- Migration headers: `-- Needs: 968` on 969, `-- Needs: 969` on 970; each with a `-- rollback:` block that says the enum values cannot be removed and names the columns and constraints to drop instead. Migrations 2xx are scheduling's and 3xx session-capture's; altering `appointment` and `session` from the trunk's range is what 966 did and the change request records it under "files outside the trunk's paths".
- No real names or identifiers in tests (`.claude/rules/testing.md`); fixtures from `db/seed/`.
- `pnpm -s format` before `pnpm verify`; `pnpm test:db` on this worktree's database (port 5437; `pnpm db:migrate` first).

## Review Focus

1. A void must free the window: after voiding, logging the right visit at the same hour for the same client and practitioner must succeed (Task 2 tests it against both exclusion constraints).
2. The credit's replacement must keep the purchase's deferred allocation check happy (`403:235-294`): Task 2 commits a void on a sold package and reads the purchase's credits summing as before.
3. The books must see "Credit restored": Task 2 asserts the waived row appears in `unposted_money_events` (or whatever view `454` exposes) as `credit.waived`, exactly as a waiver does.
4. A correction whose new visit overlaps something else must roll the void back too: Task 3 arranges an overlap and asserts the old row is still `completed` afterwards.
5. The portal must not show a voided visit, and the review prompt and session numbering must not count it: Task 4 tests the portal list; Task 2's DB test reads `domain/session/sessionNumber` inputs (or the SQL the pickers use) to show the row is gone from "completed".

---

### Task 1: The rule and the action

**Files:**
- Create: `domain/session/voidSession.ts`, `domain/session/voidSession.test.ts`
- Modify: `domain/shared/actor.ts` (add `session.void` beside `session.record_past`, same roles), `domain/shared/actor.test.ts`

**Interfaces:**
- Produces:
```ts
export type VoidRefusal = 'wrong_role' | 'not_a_records_row' | 'not_completed' | 'already_voided' | 'session_in_use';
export function canVoidRecordedSession(input: {
  actorRoles: readonly string[];
  session: { recordedFrom: 'device' | 'records'; status: string; voidedAt: string | null };
  inUseBy: { assessments: number; invoices: number; exceptions: number };
}): { ok: true } | { ok: false; reason: VoidRefusal };
```
Order of checks: role, records row, completed, not already voided (a voided row's status is `voided`, so `not_completed` would also match — check `voidedAt` first and answer `already_voided`), in use.

- [ ] **Step 1: Failing tests** — one `it` per reason plus the happy path, named as requirements (`it('refuses a visit closed on the phone')`, `it('refuses a visit an assessment still names')` …), and `actor.test.ts` cases: owner/admin/lead_practitioner may `session.void`, practitioner/finance may not.
- [ ] **Step 2: Run red** — `pnpm vitest run domain/session/voidSession.test.ts domain/shared/actor.test.ts`.
- [ ] **Step 3: Implement; run green.**
- [ ] **Step 4: Commit** — `feat(session): the rule for voiding a visit logged from the records (round 60)`.

### Task 2: The migrations and the function

**Files:**
- Create: `db/migrations/969_void_recorded_session.sql`, `db/migrations/970_voided_frees_the_window.sql`
- Test: `tests/session/db/void.test.ts` (new; use `tests/session/db/from_records.test.ts` and `tests/db/spare_a_colleague.test.ts` as the shape for connections, actors and `asApiRole` — remember `asApiRole` rolls back its savepoint, so read audit rows inside it or use the pattern those files use)

**Interfaces:**
- Produces: `app.void_recorded_session(p_session_id uuid, p_reason text) returns jsonb` → `{"sessionId","appointmentId","creditRestored"}`; execute to `app_role`, revoked from `public`.

- [ ] **Step 1: Migration 969**

```sql
-- 969_void_recorded_session.sql
-- Needs: 968
-- A visit logged from the records by mistake is voided, never deleted
-- (round 60, docs/superpowers/specs/2026-09-23-void-logged-session-design.md).
alter type appointment_status add value if not exists 'voided';
alter type session_status add value if not exists 'voided';

alter table session
  add column voided_at   timestamptz,
  add column voided_by   uuid references app_user (id),
  add column void_reason text,
  add constraint session_void_columns_together check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0)
  );
-- The status check cannot name 'voided' in this transaction (a new enum value
-- is unusable until commit); 970 adds `session_void_only_when_voided`.
alter table appointment
  add column voided_at   timestamptz,
  add column voided_by   uuid references app_user (id),
  add column void_reason text,
  add constraint appointment_void_columns_together check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0)
  );

-- The close guard, restated as a diff of 302: one transition is allowed on a
-- closed row — completed -> voided, on a records row, with the three void
-- columns set and nothing else changed.
create or replace function app.session_refuse_update_after_close() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_keys text[] := array['status', 'voided_at', 'voided_by', 'void_reason', 'updated_at'];
begin
  if old.closed_at is null
     or exists (select 1 from app.erasure_active where txid = txid_current()) then
    return new;
  end if;
  if to_jsonb(new) is not distinct from to_jsonb(old) then
    return null;
  end if;
  if old.status = 'completed' and old.recorded_from = 'records'
     and new.status::text = 'voided'
     and new.voided_at is not null and new.voided_by is not null and length(btrim(new.void_reason)) > 0
     and (to_jsonb(new) - v_keys) = (to_jsonb(old) - v_keys) then
    return new;
  end if;
  raise exception 'session % is closed and cannot be changed; correct it with a new version', old.id
    using errcode = 'restrict_violation';
end $$;

create function app.void_recorded_session(p_session_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_tenant uuid := app.current_tenant_id();
  v_session session%rowtype;
  v_credit entitlement%rowtype;
  v_restored boolean := false;
begin
  if v_actor is null then raise exception 'no actor' using errcode = 'restrict_violation'; end if;
  if not exists (select 1 from user_role where user_id = v_actor and tenant_id = v_tenant
                 and role in ('owner', 'admin', 'lead_practitioner')) then
    raise exception 'wrong_role' using errcode = 'restrict_violation';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = 'restrict_violation';
  end if;
  select * into v_session from session where id = p_session_id and tenant_id = v_tenant for update;
  if not found then raise exception 'not_found' using errcode = 'restrict_violation'; end if;
  if v_session.voided_at is not null then raise exception 'already_voided' using errcode = 'restrict_violation'; end if;
  if v_session.recorded_from <> 'records' then raise exception 'not_a_records_row' using errcode = 'restrict_violation'; end if;
  if v_session.status <> 'completed' then raise exception 'not_completed' using errcode = 'restrict_violation'; end if;
  if exists (select 1 from assessment where session_id = p_session_id)
     or exists (select 1 from invoice where session_id = p_session_id)
     or exists (select 1 from billing_exception where session_id = p_session_id) then
    raise exception 'session_in_use' using errcode = 'restrict_violation';
  end if;

  update session set status = 'voided', voided_at = now(), voided_by = v_actor, void_reason = btrim(p_reason)
    where id = p_session_id;
  update appointment set status = 'voided', voided_at = now(), voided_by = v_actor, void_reason = btrim(p_reason)
    where id = v_session.appointment_id and tenant_id = v_tenant;

  select * into v_credit from entitlement
    where consumed_by_session_id = p_session_id and status = 'consumed' for update;
  if found then
    update entitlement set status = 'waived', waiver_reason = btrim(p_reason), waived_at = now(), waived_by = v_actor
      where id = v_credit.id;
    insert into entitlement (tenant_id, client_id, service_type_id, source_type, package_purchase_id, invoice_id,
      allocated_net_fils, vat_rate_basis_points, vat_setting_version, expires_on, replaces_entitlement_id, created_by)
    values (v_credit.tenant_id, v_credit.client_id, v_credit.service_type_id, v_credit.source_type,
      v_credit.package_purchase_id, v_credit.invoice_id, v_credit.allocated_net_fils, v_credit.vat_rate_basis_points,
      v_credit.vat_setting_version, v_credit.expires_on, v_credit.id, v_actor);
    v_restored := true;
  end if;

  return jsonb_build_object('sessionId', p_session_id, 'appointmentId', v_session.appointment_id, 'creditRestored', v_restored);
end $$;
revoke execute on function app.void_recorded_session(uuid, text) from public;
grant execute on function app.void_recorded_session(uuid, text) to app_role;
-- rollback:
--   Postgres cannot remove an enum value; leave 'voided' in place and drop
--   the function, the six columns and the two constraints above; restore
--   app.session_refuse_update_after_close from 302.
```

Read 302, 403 (the waiver columns; check whether `waived_at`/`waived_by`/`waiver_reason` are the exact column names in `entitlement`), 923 and 968 before writing; match their style of comment and their `search_path` choice (968 pins `pg_catalog, public, pg_temp` or names schemas explicitly — copy what it does). Verify the exact enum type names (`appointment_status`, `session_status`) in 200 and 300. If the audit trigger's `client_id` denormalisation needs `session.client_id` on the update, it is already on the row.

- [ ] **Step 2: Migration 970**

```sql
-- 970_voided_frees_the_window.sql
-- Needs: 969
-- A voided visit no longer holds its window (200's two exclusion constraints,
-- restated with 'voided' among the statuses they ignore) and a voided row is
-- the only row with void columns.
alter table appointment drop constraint <the practitioner overlap constraint name from 200>;
alter table appointment add constraint <same name> exclude using gist (
  practitioner_id with =, tstzrange(starts_at, busy_until_or_whatever_200_uses) with &&
) where (status not in ('cancelled', 'cancelled_late', 'no_show', 'rescheduled', 'voided'));
-- and the client overlap constraint the same way
alter table session add constraint session_void_only_when_voided check (voided_at is null or status = 'voided');
alter table appointment add constraint appointment_void_only_when_voided check (voided_at is null or status = 'voided');
-- rollback: drop the two check constraints; restore the two exclusion constraints from 200.
```

Copy the two constraints' exact definitions from `200_appointment.sql:75-85` (and any later restatement — grep `exclude using gist` across `db/migrations`), changing only the status list.

- [ ] **Step 3: Failing DB tests** (`tests/session/db/void.test.ts`), then run them red before the migrations are applied is not possible — instead write the tests, apply with `pnpm db:migrate`, and watch each assertion fail for the right reason by first asserting the OPPOSITE of the last step (a deliberate red), then correcting:

```ts
describe('voiding a visit logged from the records', () => {
  it('stamps the session and the appointment voided with when, who and why');
  it('frees the window: the right visit can then be logged at the same hour');           // POST /api/sessions/from-records at the same start → 201
  it('gives the credit back as a replacement and the books see a credit restored');       // waived row + replacement; the purchase's non-waived credits still sum to net_fils; unposted event kind 'credit.waived'
  it('restores nothing for a visit settled before the app');                               // creditRestored false, no new entitlement row
  it('refuses a visit closed on the phone');                                               // device row → not_a_records_row
  it('refuses a visit that is not completed');                                             // scheduled → not_completed
  it('refuses a visit already voided');
  it('refuses a visit an assessment still names');
  it('refuses a finance actor and a practitioner');
  it('still refuses every other change to a closed row, and any change to a voided row'); // update observations on a completed row → restrict_violation; update void_reason on a voided row → restrict_violation
  it('leaves the audit chain intact');                                                     // select app.verify_audit_chain() is null
});
```

Call the function under `asApiRole` with the actor stamp set as the other DB tests do (`set_config('app.actor_id', …)`).

- [ ] **Step 4: Apply, run green** — `pnpm db:migrate && pnpm test:db -- tests/session/db/void.test.ts tests/session/db/run.test.ts tests/billing/db/consumption.test.ts tests/scheduling/db/move_and_cancel.test.ts` (the last three prove nothing old broke).

- [ ] **Step 5: Commit** — `feat(db): a visit logged from the records can be voided; the window is freed and the credit restored (round 60)`.

### Task 3: The routes and the sentences

**Files:**
- Create: `app/api/sessions/void.ts` (mounted by `mountSessions` next to `from-records`)
- Modify: `app/api/sessions/from-records.ts` (optional `replaces`), the request/response schemas beside it
- Modify: `domain/shared/audit-narrative.ts` (+ its test), `app/admin/audit/RecordTimeline.tsx:220-221` only if the sentence needs the reason hidden (it prints `Reason:` — keep it; the reason is the office's own words)
- Test: `tests/session/db/void.test.ts` (route cases), `tests/session/db/from_records.test.ts` (`replaces` cases), `domain/shared/audit-narrative.test.ts`

**Interfaces:**
- Produces: `POST /api/sessions/:id/void` → 200 `{ sessionId, appointmentId, creditRestored }`; 400 `reason_required` | `invalid_request`; 403 `wrong_role`; 404; 409 `{ error: 'conflict', code }` with `code` ∈ `not_a_records_row` | `not_completed` | `already_voided` | `session_in_use`.
- `POST /api/sessions/from-records` body gains `replaces?: uuid`; success 201 gains `voided: { sessionId, appointmentId, creditRestored }` when it was set.

- [ ] **Step 1: Failing route tests**

```ts
it('voids over the API with a reason, logs session_voided, and answers what came back');
it('answers 400 without a reason, 403 for finance, 404 for another practice\'s visit, 409 with the code for each refusal');
it('logs every refusal before answering');            // audit_log action 'refused', reason = the code
// from_records.test.ts
it('corrects a visit: voids the old and logs the new in one act, the new being version 2 with the reason');
it('rolls the void back when the new visit is refused');  // overlap with a third visit → 422; old row still completed
```

- [ ] **Step 2: Run red; implement**

`void.ts`: shape of `from-records.ts` — actor, `canActor(actor, 'session.void')`, reason check, load the session row (id, client_id, recorded_from, status, voided_at, counts of assessment/invoice/billing_exception) under RLS → 404 when absent; `canVoidRecordedSession` → 409 with the domain's reason before touching the function (so the sentence is the domain's); then `select app.void_recorded_session($1, $2)`; map a `restrict_violation` message to the same codes as a belt-and-braces; `logSensitive(db, 'session_voided', 'session', id, clientId)`; answer.

`from-records.ts`: inside the existing savepoint, when `replaces` is set: run the same domain check on the old row (409 on refusal, logged), call the function, then insert the new session with three more columns: `supersedes_id = $replaces`, `version = old.version + 1` (read it from the old row), `amendment_reason = reason`. Check 302's constraints on those columns (`amendment_reason` may require `supersedes_id` and vice versa).

Narrative: `session.session_voided` → `${actor} voided a past visit that had been logged in error` / `${actor} ألغى زيارة سابقة سُجّلت بالخطأ`; `session.refused` → `${actor} was refused: <sentence per code>` with a small table for `no_credit_available` ("no credit was available on the visit's day"), `practitioner_overlap`, `client_overlap`, `in_the_future`, `too_old`, `blocked`, and the void codes; unknown code → the generic sentence without the raw code.

- [ ] **Step 3: Run green; commit** — `feat(session): void and correct over the API, with sentences on the Timeline`.

### Task 4: The screens and the portal

**Files:**
- Modify: `app/api/appointments/list.ts` (join `session` on `appointment_id`; add `sessionId: string | null`, `recordedFrom: 'device' | 'records' | null` to the row schema)
- Modify: `domain/scheduling/status.ts`, `app/admin/schedule/appointmentStatus.ts:24-33` (`voided` → label "Voided", grey), `domain/portal/visits.ts:20-60` (`voided` → not listed), `app/api/routing/day.ts` and the board's status filters if they enumerate statuses (the compiler will say)
- Modify: `app/admin/schedule/SchedulePage.tsx:245-281` (Change column: for a `completed` row with `recordedFrom === 'records'` and an actor holding `session.void` → "Correct" and "Void"; a `voided` row → nothing)
- Create: `app/admin/schedule/VoidSessionDrawer.tsx` (+ test): the client's name, the day and time, two sentences ("The window is freed for the right visit." and either "The session credit comes back to the household." or "Nothing comes back: the visit was settled before the app."), a required "Why" field, a Void button; POST with `x-reason` and `content-type: application/json`; on 200 reload the day; on 409 show the sentence for the code
- Modify: `app/admin/schedule/LogPastSessionDrawer.tsx` (accept an optional `replaces: { sessionId, clientId, serviceTypeId, locationId, practitionerId, deliveryMode, on, startTime, durationMinutes, billing }`; pre-fill; send `replaces` in the body; the title reads "Correct a past session")
- Test: `tests/scheduling/SchedulePage.test.tsx`, `tests/scheduling/LogPastSessionDrawer.test.tsx`, `tests/portal/…visits` (find the file with `grep -rl "domain/portal/visits" tests app`)

- [ ] **Step 1: Failing screen tests** — actions appear only on a records row for an owner, not on a device row, not for finance; the void drawer refuses an empty reason and posts the header + JSON; the correct drawer is pre-filled and sends `replaces`; a voided row shows "Voided" and no Change; the portal list omits a voided visit.
- [ ] **Step 2: Run red, build, run green.** Copy: English only; no ALL-CAPS; no arrows.
- [ ] **Step 3: Commit** — `feat(schedule): Void and Correct on a visit logged from the records; the portal shows no voided visit`.

### Task 5: Record and gate

**Files:**
- Modify: `docs/SPEC/00-data-model.md` (`session` and `appointment`: the `voided` status and the three columns, "Amended in trunk round 60"), `docs/SPEC/session-capture.md` §4 (void and correct, one paragraph after the round-51 amendment), `docs/SPEC/billing.md` §4.3 (a voided visit's credit comes back as a waiver's does; not a credit note), `docs/SPEC/client-portal.md` (a voided visit is not listed), `docs/SPEC/scheduling-manual.md` if it lists statuses
- Create: `docs/CHANGE-REQUESTS/trunk-round-60.md` in the shape of `trunk-round-59.md`: the ask, the decisions table from the spec, what it does (the function, the guard's one transition, the constraints), files outside the trunk's paths (`appointment`, `session`, `entitlement`, `app/api/appointments/list.ts`, `app/admin/schedule/**`, `domain/portal/visits.ts`), tests, "Going live": 969 then 970 by hand on staging then production, each with its ledger row in the same call (sha256 from main after the merge); no policy file expected — confirm with `git diff origin/main -- db/policies`; fingerprint `appointment` + `session` + `entitlement` columns/constraints/triggers and the two functions against the runner-built local DB; then the build; proof = "Voided" and "Correct a past session" in the served `SchedulePage-*.js` chunk and the old chunk 404.

- [ ] **Step 1: `pnpm -s format && pnpm verify && pnpm test:db`** — all green, 0 skipped.
- [ ] **Step 2: Commit** — `docs: round 60 — a visit logged in error is voided or corrected, never deleted`.
