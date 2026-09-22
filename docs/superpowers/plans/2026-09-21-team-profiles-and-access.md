# Team Profiles and Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings › Team becomes an employee's profile: editable details, four role switches that go on and off, two owners nobody can revoke, and the whole of it managed by owners alone.

**Architecture:** A switch is a role, so it binds at both layers that already exist: `canActor` in `domain/shared` and `app.actor_has_role` in the database. Pure rules in `domain/shared/staff.ts` are quoted by the route, the screen and the tests. The database is the floor: two triggers lock an owner's rows for every caller, one security definer function is the only way a role row is removed, and an owners-only table holds what `app_user` is too widely read to hold.

**Tech Stack:** TypeScript, React + Vite, Hono on Node, PostgreSQL with row level security, zod, vitest (`pnpm test` for units and screens, `pnpm test:db` for a real database), Supabase Auth admin behind `AuthAdminProvider`.

**Spec:** `docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md`. Read it first; this plan argues from it.

## Global Constraints

- **The repository is public.** Never a real person's name, email, phone or id in any file. Names only from `db/seed/names.ts`; emails at `example.com`; phones `+971 50 000 00xx`; ids `0000000K-0000-4000-8000-*`. Files written through the shell bypass `.claude/hooks/no-real-identifiers.sh`: sweep the diff with its two patterns before every commit.
- **Dates are the practice's, not the laptop's.** This Mac's clock is on +10. Run `TZ=Asia/Dubai date` before dating anything.
- **Business rules live in `domain/` as pure functions with tests** (CLAUDE.md rule 4). No rule in a component, a route or SQL that is not first a tested function, except where the database is deliberately the floor beneath one.
- **Console screens are English only** (`tests/lint/console-is-english.test.ts`). No `lang="ar"`, no `dir="rtl"`, no Arabic script under `app/admin/**`.
- **Colour only from `app/shell/tokens.css`.** No hex literal in a component or a stylesheet. No ALL-CAPS labels, no arrows on buttons, no middle dots joining metadata. Right-side drawer, never a modal.
- **Every screen `POST`, `PUT`, `PATCH` and `DELETE` sends `content-type: application/json`**, or the API answers 415.
- **Migrations are forward-only**, each with a `-- Needs:` line and a `-- rollback:` block, never edited once merged. Trunk range: `900–949` for core tables, `950–999` for what must sort after a stream's.
- **Policies are declarative files** under `db/policies/**`, re-applied by the runner on every `db:migrate`, and **by hand at a live pass**.
- **Every path touched is the trunk's own** (`docs/SPEC/OWNERSHIP.md`): `domain/shared/**`, `app/api/team/**`, `app/admin/settings/**`, `app/shell/**`, `db/migrations/9xx`, `db/policies/core/**`, `tests/db/`. Task 7 moves one file out of the client-record stream's path and says so in the round note, by the precedent of trunk round 36.
- **Use `git -C` and absolute paths.** A `cd` does not survive to the next shell call, and there are several worktrees. This work is in `/Volumes/Storage/McWellness/mcwellness-team`, branch `round-58/team-profiles-and-access`, database on port 5437 (`pnpm db:up && pnpm db:migrate` from that folder).
- **Run `pnpm -s format` before `pnpm verify`.** Prettier fails the gate before a single test runs.
- **Merged is not live.** Nothing in this plan deploys.

---

## File structure

| File | Responsibility |
|---|---|
| `domain/shared/staff.ts` (modify) | The pure rules: `isLocked`, `canSwitchRole`, `canEditProfile`, `canResetPassword` (narrowed to owners), `STAFF_ROLE_OPENS` (the plain-English line per role) |
| `domain/shared/actor.ts` (modify) | The action `staff.access.manage`, the owner's alone; `user_role.grant` narrowed |
| `db/migrations/922_staff_profile.sql` (create) | The owners-only table |
| `db/migrations/923_owner_lock_and_role_revoke.sql` (create) | Two lock triggers and `app.revoke_staff_role` |
| `db/migrations/967_audit_redact_staff_profile.sql` (create) | `app.audit_redact` restated with three more keys. **Numbered after 965 on purpose**: 965 restates the same function, and on a fresh database a lower number would be overwritten by it |
| `db/policies/core/staff_profile.sql` (create) | Row security for the new table |
| `db/policies/core/tenant_isolation.sql`, `role_guard.sql` (modify) | The new table joins the tenant fence; staff rows become the owner's, with the portal's carve-out |
| `app/api/portal/auth-admin.ts` (modify) | `setEmail` on both providers |
| `app/api/team/schema.ts`, `routes.ts` (modify) | The wire shapes and the eight routes of the spec's section 7 |
| `app/shell/components/Tabs.tsx` (moved from `app/admin/clients/`) | The tab strip two modules now need |
| `app/admin/settings/TeamMemberDrawer.tsx` (create) | The profile drawer: Profile tab, Access tab |
| `app/admin/settings/TeamPage.tsx` (modify) | The list, quieter, with Open |
| `docs/CHANGE-REQUESTS/trunk-round-58.md`, `docs/SPEC/00-data-model.md`, `docs/SECURITY.md`, `docs/COMPLIANCE/*`, `docs/RUNBOOK/second-owner.md` (create or modify) | The record |

---

### Task 1: The rules

**Files:**
- Modify: `domain/shared/staff.ts`, `domain/shared/staff.test.ts`
- Modify: `domain/shared/actor.ts`, `domain/shared/actor.test.ts`
- Modify: `domain/shared/index.ts`

**Interfaces:**
- Consumes: `Role`, `STAFF_ROLES`, `isStaffRole` (already in `staff.ts` and `actor.ts`).
- Produces:
  - `isLocked(roles: readonly Role[]): boolean`
  - `type RoleSwitchRefusal = 'not_a_working_role' | 'not_yourself' | 'locked' | 'last_role'`
  - `canSwitchRole(input: { actorUserId: string; targetUserId: string; targetRoles: readonly Role[]; role: string; on: boolean }): RoleSwitchRefusal | null` — `null` means allowed
  - `canEditProfile(input: { actorUserId: string; actorRoles: readonly Role[]; targetUserId: string; targetRoles: readonly Role[] }): boolean`
  - `canResetPassword(actorRoles, targetRoles): boolean` — signature unchanged, meaning narrowed
  - `STAFF_ROLE_OPENS: Record<StaffRole, string>`
  - Action `{ type: 'staff.access.manage' }`

- [ ] **Step 1: Write the failing tests.** Append to `domain/shared/staff.test.ts` (and add the four new names to its import):

```ts
const A = '00000002-0000-4000-8000-000000000010';
const B = '00000002-0000-4000-8000-000000000011';

describe('a locked row', () => {
  it('is any row that holds ownership, whatever else it holds', () => {
    expect(isLocked(['owner'])).toBe(true);
    expect(isLocked(['finance', 'owner'])).toBe(true);
    expect(isLocked(['admin', 'lead_practitioner'])).toBe(false);
    expect(isLocked([])).toBe(false);
  });
});

describe('switching a role', () => {
  const base = { actorUserId: A, targetUserId: B, targetRoles: ['admin', 'finance'] as const };

  it('is allowed on and off for a colleague who keeps a role', () => {
    expect(canSwitchRole({ ...base, role: 'practitioner', on: true })).toBeNull();
    expect(canSwitchRole({ ...base, role: 'finance', on: false })).toBeNull();
  });

  it('never offers ownership or a household contact, in either direction', () => {
    expect(canSwitchRole({ ...base, role: 'owner', on: true })).toBe('not_a_working_role');
    expect(canSwitchRole({ ...base, role: 'client_contact', on: false })).toBe('not_a_working_role');
    expect(canSwitchRole({ ...base, role: 'nonsense', on: true })).toBe('not_a_working_role');
  });

  it('is never your own to do', () => {
    expect(canSwitchRole({ ...base, targetUserId: A, role: 'finance', on: false })).toBe('not_yourself');
  });

  it('is refused on an owner, whatever working roles sit beside ownership', () => {
    expect(
      canSwitchRole({ ...base, targetRoles: ['finance', 'owner'], role: 'finance', on: false }),
    ).toBe('locked');
    expect(
      canSwitchRole({ ...base, targetRoles: ['owner'], role: 'admin', on: true }),
    ).toBe('locked');
  });

  it('refuses to take the last working role, because suspending is how somebody is shut out', () => {
    expect(canSwitchRole({ ...base, targetRoles: ['finance'], role: 'finance', on: false })).toBe('last_role');
  });

  it('lets a role the person does not hold be switched off, which changes nothing', () => {
    expect(canSwitchRole({ ...base, targetRoles: ['finance'], role: 'admin', on: false })).toBeNull();
  });
});

describe('editing a profile', () => {
  it('is an owner’s, for anybody who is not an owner', () => {
    expect(canEditProfile({ actorUserId: A, actorRoles: ['owner'], targetUserId: B, targetRoles: ['admin'] })).toBe(true);
    expect(canEditProfile({ actorUserId: A, actorRoles: ['admin'], targetUserId: B, targetRoles: ['finance'] })).toBe(false);
  });

  it('is that owner’s alone, for an owner’s row', () => {
    expect(canEditProfile({ actorUserId: A, actorRoles: ['owner'], targetUserId: B, targetRoles: ['owner'] })).toBe(false);
    expect(canEditProfile({ actorUserId: A, actorRoles: ['owner'], targetUserId: A, targetRoles: ['owner'] })).toBe(true);
  });
});

describe('what each role opens, in words', () => {
  it('has a sentence for each of the four working roles and no other', () => {
    expect(Object.keys(STAFF_ROLE_OPENS).sort()).toEqual([...STAFF_ROLES].sort());
    for (const line of Object.values(STAFF_ROLE_OPENS)) expect(line.length).toBeGreaterThan(10);
  });
});
```

Then **change** round 57's three password tests, because the operator's answer of 21 September narrows the rule to owners:

```ts
describe('minting a temporary password', () => {
  it('is an owner’s and nobody else’s, because a password is the sign-in', () => {
    expect(canResetPassword(['owner'], ['finance'])).toBe(true);
    expect(canResetPassword(['owner'], ['owner'])).toBe(true);
    expect(canResetPassword(['admin'], ['finance'])).toBe(false);
    expect(canResetPassword(['admin', 'lead_practitioner'], ['practitioner'])).toBe(false);
    expect(canResetPassword(['admin'], ['owner'])).toBe(false);
  });

  it('is refused when the target’s roles could not be read, so a blind check never permits', () => {
    expect(canResetPassword(['owner'], [])).toBe(false);
  });
});
```

In `domain/shared/actor.test.ts`, following the file's own pattern for an action's audience, add: `staff.access.manage` is true for `['owner']` and false for each of `['admin']`, `['lead_practitioner']`, `['practitioner']`, `['finance']`, `['client_contact']`; `user_role.grant` with `role: 'finance'` is now false for `['admin']` and true for `['owner']`, and with `role: 'client_contact'` stays true for `['admin']`.

- [ ] **Step 2: Run them and watch them fail.**

Run: `pnpm exec vitest run domain/shared/staff.test.ts domain/shared/actor.test.ts`
Expected: FAIL — `isLocked is not a function`, and the narrowed password test fails with `expected true to be false` for `(['admin'], ['finance'])`.

- [ ] **Step 3: Write the rules.** In `domain/shared/staff.ts`:

```ts
/** A row that holds ownership. Nothing on it is anybody's to change (spec section 3). */
export function isLocked(roles: readonly Role[]): boolean {
  return roles.includes('owner');
}

export type RoleSwitchRefusal = 'not_a_working_role' | 'not_yourself' | 'locked' | 'last_role';

/**
 * Whether a role may be switched on or off for somebody; null means yes. The
 * order is the order a person would want to be told in. The database asks the
 * off half again in `app.revoke_staff_role` (migration 923), which binds.
 */
export function canSwitchRole(input: {
  actorUserId: string;
  targetUserId: string;
  targetRoles: readonly Role[];
  role: string;
  on: boolean;
}): RoleSwitchRefusal | null {
  if (!isStaffRole(input.role)) return 'not_a_working_role';
  if (input.actorUserId === input.targetUserId) return 'not_yourself';
  if (isLocked(input.targetRoles)) return 'locked';
  if (!input.on) {
    const left = input.targetRoles.filter((r) => isStaffRole(r) && r !== input.role);
    const holds = input.targetRoles.includes(input.role);
    // With no working role a person falls out of the team list and could
    // never be found to be given one back. Suspending is how somebody is shut out.
    if (holds && left.length === 0) return 'last_role';
  }
  return null;
}

/** An owner edits anybody who is not an owner; an owner's row is that owner's alone. */
export function canEditProfile(input: {
  actorUserId: string;
  actorRoles: readonly Role[];
  targetUserId: string;
  targetRoles: readonly Role[];
}): boolean {
  if (!input.actorRoles.includes('owner')) return false;
  return !isLocked(input.targetRoles) || input.actorUserId === input.targetUserId;
}

/** One line of plain English under each switch. English only, like the console. */
export const STAFF_ROLE_OPENS: Record<StaffRole, string> = {
  admin: 'Clients, enquiries, the schedule, billing, the portal and the practice’s settings.',
  finance: 'Billing, prices and packages, and the books.',
  practitioner: 'Their own day, sessions and measurements, for the services they are certified in.',
  lead_practitioner: 'The whole schedule and board, reports, the kit and the audit trail.',
};
```

Replace the body of `canResetPassword` and the last paragraph of its comment:

```ts
  // An owner, and nobody else (operator, 21 September 2026): a password minted
  // for a colleague holding Finance is the books by one remove.
  if (targetRoles.length === 0) return false;
  return actorRoles.includes('owner');
```

In `domain/shared/actor.ts` add `| { type: 'staff.access.manage' }` beside `staff.manage` in the `Action` union, and in `canActor`:

```ts
    // Adding a person, editing a profile, switching a role, suspending and
    // minting a temporary password: the owner's alone (operator, 21 September
    // 2026). `staff.manage` below keeps the list for an admin and nothing else.
    case 'staff.access.manage':
      return hasRole(actor, 'owner');
```

and change `user_role.grant` to:

```ts
    case 'user_role.grant':
      // A household's contact row is the portal's, and an admin invites a
      // household. Every other role is the owner's to hand out; RLS says the same.
      if (action.role === 'client_contact') return hasRole(actor, 'owner', 'admin');
      return hasRole(actor, 'owner');
```

Export `isLocked`, `canSwitchRole`, `canEditProfile`, `STAFF_ROLE_OPENS` and `type RoleSwitchRefusal` from `domain/shared/index.ts`.

- [ ] **Step 4: Run them and watch them pass.**

Run: `pnpm exec vitest run domain/shared/staff.test.ts domain/shared/actor.test.ts`
Expected: PASS. Then `pnpm -s typecheck`: `TeamPage.tsx` still compiles (it calls `canResetPassword` with the same signature).

- [ ] **Step 5: Commit.**

```bash
git -C /Volumes/Storage/McWellness/mcwellness-team add domain/shared
git -C /Volumes/Storage/McWellness/mcwellness-team commit -m "feat(team): the rules for a locked row, a role switch and an owner's profile"
```

---

### Task 2: The profile's own table

**Files:**
- Create: `db/migrations/922_staff_profile.sql`, `db/migrations/967_audit_redact_staff_profile.sql`, `db/policies/core/staff_profile.sql`
- Modify: `db/policies/core/tenant_isolation.sql` (add `'staff_profile'` to its array)
- Modify: `tests/db/audit.test.ts` (add `'staff_profile'` to `WITHOUT_CLIENT`), `docs/SPEC/00-data-model.md`
- Test: `tests/db/staff_profile.test.ts` (create)

**Interfaces:**
- Produces: table `public.staff_profile (id, tenant_id, user_id unique, job_title, started_on, emergency_contact_name, emergency_contact_phone, private_notes, created_at, updated_at, created_by)`; readable and writable by `app_role` only when `app.actor_has_role('owner')`.

- [ ] **Step 1: Write the failing database test.** `tests/db/staff_profile.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, asApiRole, freshDatabase, rejectsWith, seedTenant, seedUser, setAuditContext } from './helpers';
import type pg from 'pg';

const STAFF = '00000001-0000-4000-8000-0000000000c1';
let db: pg.Client;

beforeAll(async () => {
  db = await freshDatabase();
  await seedTenant(db, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await seedUser(db, { id: STAFF, tenantId: IDS.tenantA, authId: null, displayName: 'Fern Bay', roles: ['finance'] });
  await db.query(
    "insert into staff_profile (tenant_id, user_id, job_title, emergency_contact_name, emergency_contact_phone, private_notes, created_by) " +
      "values ($1, $2, 'Coordinator', 'Ember Cliff', '+971500000041', 'Contract renews in March.', $3)",
    [IDS.tenantA, STAFF, IDS.ownerA],
  );
});
afterAll(async () => { await db.end(); });

describe('staff_profile', () => {
  it('is read by an owner and by nobody else, the person themselves included', async () => {
    const seen = (roles: string) =>
      asApiRole(db, IDS.tenantA, async () => (await db.query('select 1 from staff_profile')).rowCount, roles);
    expect(await seen('owner')).toBe(1);
    for (const roles of ['admin', 'finance', 'lead_practitioner', 'practitioner', 'admin,lead_practitioner']) {
      expect(await seen(roles), roles).toBe(0);
    }
  });

  it('is written by an owner and refused to an admin', async () => {
    await asApiRole(db, IDS.tenantA, async () => {
      const r = await db.query("update staff_profile set job_title = 'Office lead' where user_id = $1", [STAFF]);
      expect(r.rowCount).toBe(1);
    }, 'owner');
    await asApiRole(db, IDS.tenantA, async () => {
      const r = await db.query("update staff_profile set job_title = 'Mine now' where user_id = $1", [STAFF]);
      expect(r.rowCount).toBe(0);
      await rejectsWith(db, '42501',
        'insert into staff_profile (tenant_id, user_id) values ($1, $2)', [IDS.tenantA, IDS.ownerA]);
    }, 'admin');
  });

  it('is invisible from another practice', async () => {
    expect(await asApiRole(db, IDS.tenantB, async () => (await db.query('select 1 from staff_profile')).rowCount, 'owner')).toBe(0);
  });

  it('says in the trail that the three private columns changed, and never what they said', async () => {
    await setAuditContext(db, { actorId: IDS.ownerA, roles: 'owner', tenantId: IDS.tenantA });
    await db.query("update staff_profile set private_notes = 'Asked about part time.', emergency_contact_phone = '+971500000042' where user_id = $1", [STAFF]);
    const { rows } = await db.query<{ changed: string[]; text: string }>(
      "select changed_fields as changed, coalesce(old_values::text,'') || coalesce(new_values::text,'') as text " +
        "from audit_log where entity_type = 'staff_profile' and action = 'update' order by id desc limit 1");
    expect(rows[0]?.changed).toEqual(expect.arrayContaining(['private_notes', 'emergency_contact_phone']));
    for (const leaked of ['part time', 'March', '0000042', '0000041', 'Ember']) {
      expect(rows[0]?.text, leaked).not.toContain(leaked);
    }
  });

  it('holds one row for one person and a telephone in E.164', async () => {
    await rejectsWith(db, '23505', 'insert into staff_profile (tenant_id, user_id) values ($1, $2)', [IDS.tenantA, STAFF]);
    await rejectsWith(db, '23514', "update staff_profile set emergency_contact_phone = '050 000 0041' where user_id = $1", [STAFF]);
  });
});
```

Before running, open `tests/db/helpers.ts` and match `setAuditContext`'s real parameter shape and whether `IDS.tenantB` exists (it is used by `tests/db/rls.test.ts`); adjust the two calls, not the assertions.

- [ ] **Step 2: Run it and watch it fail.**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/db/staff_profile.test.ts`
Expected: FAIL — `relation "staff_profile" does not exist`.

- [ ] **Step 3: Write the migration.** `db/migrations/922_staff_profile.sql`, with a header in the house style (what, why, the spec, why this range, `-- Needs: 010 (tenant), 020 (app_user), 080 (app.audit_row), 090 (app_role)`), then:

```sql
create table staff_profile (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenant (id),
  user_id                  uuid not null unique references app_user (id),
  job_title                text check (job_title is null or char_length(job_title) between 1 and 120),
  started_on               date,
  emergency_contact_name   text check (emergency_contact_name is null or char_length(emergency_contact_name) between 1 and 120),
  emergency_contact_phone  text check (emergency_contact_phone is null or emergency_contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  private_notes            text check (private_notes is null or char_length(private_notes) <= 4000),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references app_user (id)
);
create index staff_profile_tenant_idx on staff_profile (tenant_id);
create index staff_profile_created_by_idx on staff_profile (created_by);

comment on table public.staff_profile is
  'What the practice keeps about a member of its own staff beyond the sign-in: a job title, a '
  'start date, who to call if something happens to them on a home visit, and the owners'' own '
  'notes. Owners only, the person themselves excluded, because app_user is read practice-wide '
  '(docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md section 6). An '
  'emergency contact is a third person''s data, kept for the safety of somebody working alone.';

create trigger set_updated_at before update on staff_profile
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.staff_profile
  for each row execute function app.audit_row();
alter table public.staff_profile enable always trigger audit_row;

do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.staff_profile enable row level security;
  revoke all on public.staff_profile from public;
  if has_api_roles then
    revoke all on public.staff_profile from anon, authenticated;
  end if;
  grant select, insert, update on public.staff_profile to app_role;
end
$$;

-- rollback:
--   drop table if exists public.staff_profile;
```

`db/policies/core/staff_profile.sql`:

```sql
-- The owners' alone, for reading and for writing. Restrictive, so it is combined
-- with (never replaces) tenant_isolation on the same table. Not the person
-- themselves: a note about somebody that they can read is a different thing from
-- the one the operator asked for on 21 September 2026. Declarative and idempotent.
drop policy if exists owners_only on public.staff_profile;
create policy owners_only on public.staff_profile as restrictive for all to app_role
  using (app.actor_has_role('owner'))
  with check (app.actor_has_role('owner'));
```

Add `'staff_profile'` to the array in `db/policies/core/tenant_isolation.sql`.

`db/migrations/967_audit_redact_staff_profile.sql`: copy `965_audit_redact_health_answers.sql`'s `create or replace function app.audit_redact` **verbatim, whole**, add `'emergency_contact_name', 'emergency_contact_phone', 'private_notes'` to the end of the array, keep the `revoke`, and write the rollback as 965's body verbatim. The header says why it is 967 and not 924: 965 restates this function, the runner applies in numeric order, and on a fresh database a lower number would be overwritten. `-- Needs: 922, 965`.

- [ ] **Step 4: Migrate and watch the test pass.**

Run: `pnpm db:migrate && pnpm exec vitest run --config vitest.db.config.ts tests/db/staff_profile.test.ts tests/db/audit.test.ts`
Expected: PASS, after adding `'staff_profile'` to `WITHOUT_CLIENT` in `tests/db/audit.test.ts`. If a seed or schema test enumerates every table (`grep -rn "portal_review_prompt" tests`), add the new one beside it.

- [ ] **Step 5: Record the entity.** In `docs/SPEC/00-data-model.md`, beside `user`, add `staff_profile` with its columns, "owners only", and the spec's path.

- [ ] **Step 6: Commit.**

```bash
git -C /Volumes/Storage/McWellness/mcwellness-team add db tests/db docs/SPEC/00-data-model.md
git -C /Volumes/Storage/McWellness/mcwellness-team commit -m "feat(db): staff_profile, the owners' alone, and three columns the trail never repeats"
```

---

### Task 3: The owner lock, and the one way a role is taken away

**Files:**
- Create: `db/migrations/923_owner_lock_and_role_revoke.sql`
- Modify: `db/policies/core/role_guard.sql`
- Test: `tests/db/owner_lock.test.ts` (create)

**Interfaces:**
- Produces: `app.revoke_staff_role(p_user_id uuid, p_role public.role_kind) returns boolean` (true when a row was removed, false when there was none), raising `42501` for each refusal; triggers `guard_owner_role` on `user_role` and `guard_owner_identity` on `app_user`.

- [ ] **Step 1: Write the failing test.** `tests/db/owner_lock.test.ts` seeds, as the superuser, tenant A with `IDS.ownerA`, a **second owner** (`…00d1`, "Hazel Lagoon", also holding `finance`), an admin (`…00d2`, "Iris Harbour"), a finance colleague (`…00d3`, "Pearl Quarry", roles `finance` and `practitioner`), and one household contact (`…00d4`, "Cedar Meadow", `client_contact`). Every case below is one `it`, named as written:

```ts
// The lock holds for every caller: these run as the SUPERUSER, not as app_role.
it('refuses any update or delete of an ownership row, for every caller', async () => {
  await rejectsWith(db, '42501', "delete from user_role where user_id = $1 and role = 'owner'", [SECOND_OWNER]);
  await rejectsWith(db, '42501', "update user_role set role = 'admin' where user_id = $1 and role = 'owner'", [SECOND_OWNER]);
});
it("refuses to suspend or archive an owner, or to move an owner's sign-in", async () => {
  await db.query('update app_user set auth_id = $1 where id = $2', ['00000001-0000-4000-8000-0000000000d9', SECOND_OWNER]); // null -> linked is allowed
  await rejectsWith(db, '42501', "update app_user set status = 'suspended' where id = $1", [SECOND_OWNER]);
  await rejectsWith(db, '42501', "update app_user set status = 'archived' where id = $1", [SECOND_OWNER]);
  await rejectsWith(db, '42501', 'update app_user set auth_id = $1 where id = $2', ['00000001-0000-4000-8000-0000000000da', SECOND_OWNER]);
});
it("lets an owner change their own name and refuses the other owner's", async () => {
  await setActor(db, IDS.ownerA);           // set_config('app.actor_id', ..., true) inside a savepoint
  await rejectsWith(db, '42501', "update app_user set display_name = 'Somebody Else' where id = $1", [SECOND_OWNER]);
  await setActor(db, SECOND_OWNER);
  expect((await db.query("update app_user set display_name = 'Hazel Lagoon' where id = $1", [SECOND_OWNER])).rowCount).toBe(1);
});
it('leaves a colleague who is not an owner editable and suspendable', async () => {
  expect((await db.query("update app_user set status = 'suspended' where id = $1", [FINANCE])).rowCount).toBe(1);
  await db.query("update app_user set status = 'active' where id = $1", [FINANCE]);
});

// The revoke function, as app_role.
it('removes a working role for an owner and leaves a delete in the trail', async () => { /* as owner: select app.revoke_staff_role(FINANCE,'practitioner') -> true; user_role row gone; audit_log has action 'delete', entity_type 'user_role' */ });
it('answers false, and changes nothing, for a role the person does not hold', async () => { /* -> false */ });
it('refuses an admin', async () => { /* roles 'admin' -> 42501 */ });
it('refuses ownership and a household contact as the role', async () => { /* 'owner', 'client_contact' -> 42501 */ });
it('refuses an owner as the target, working roles included', async () => { /* SECOND_OWNER,'finance' -> 42501 and the row still there */ });
it('refuses yourself', async () => { /* actor = target -> 42501 */ });
it('refuses the last working role', async () => { /* after practitioner is gone, 'finance' -> 42501 */ });
it('refuses a colleague in another practice', async () => { /* tenant B user -> 42501 */ });

// role_guard.sql, as app_role.
it('lets an admin invite and suspend a household contact, and nothing else on these tables', async () => {
  // as 'admin': insert app_user (no role) OK; insert user_role 'client_contact' OK;
  //             insert user_role 'finance' -> 42501; update the household contact's status OK (1 row);
  //             update FINANCE's display_name -> 0 rows.
});
it('lets an owner do all of it', async () => { /* as 'owner': insert user_role 'finance' OK; update FINANCE OK */ });
```

Write each body out in full in the file: the comments above are this plan's shorthand for the assertion, and every one is a `rejectsWith(db, '42501', …)` or a row count. The revoke calls run inside `asApiRole(db, IDS.tenantA, fn, roles)` with `app.actor_id` set by `set_config` first; finish the file with `expect((await db.query('select app.verify_audit_chain() as broken')).rows[0]?.broken).toBeNull()`.

- [ ] **Step 2: Run it and watch it fail.**

Run: `pnpm exec vitest run --config vitest.db.config.ts tests/db/owner_lock.test.ts`
Expected: FAIL — the first case deletes the ownership row successfully (`expected SQLSTATE 42501, got success`).

- [ ] **Step 3: Write the migration.** `db/migrations/923_owner_lock_and_role_revoke.sql`, house-style header, `-- Needs: 020, 080, 095 (app.actor_has_role, app.current_tenant_id)`:

```sql
-- An ownership row does not change. No bypass setting: a setting the API role
-- could set is not a lock. Undoing this is a migration's act.
create function app.guard_owner_role() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.role = 'owner' then
    raise exception 'an ownership row does not change' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
revoke execute on function app.guard_owner_role() from public;

create trigger guard_owner_role before update or delete on public.user_role
  for each row execute function app.guard_owner_role();
alter table public.user_role enable always trigger guard_owner_role;

-- An owner's sign-in stays theirs and stays open. Security definer because it
-- must see the role row whoever is asking; it reads and never writes.
create function app.guard_owner_identity() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
begin
  if not exists (select 1 from public.user_role r
                  where r.user_id = old.id and r.tenant_id = old.tenant_id and r.role = 'owner') then
    return new;
  end if;
  if new.status is distinct from old.status and new.status <> 'active' then
    raise exception 'an owner is not suspended or archived' using errcode = '42501';
  end if;
  -- Linking a sign-in for the first time is how an owner arrives; moving one is not.
  if old.auth_id is not null and new.auth_id is distinct from old.auth_id then
    raise exception 'an owner''s sign-in is not moved' using errcode = '42501';
  end if;
  if (new.display_name is distinct from old.display_name
      or new.email is distinct from old.email
      or new.phone is distinct from old.phone)
     and v_actor is distinct from old.id then
    raise exception 'an owner''s details are their own to change' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function app.guard_owner_identity() from public;

create trigger guard_owner_identity before update on public.app_user
  for each row execute function app.guard_owner_identity();
alter table public.app_user enable always trigger guard_owner_identity;

-- The one way a working role is taken away. The API role holds no delete on
-- user_role and gains none. Deleted, not marked: a reader that forgot a
-- revoked_at column would treat a revoked role as live, and a row that is gone
-- fails closed. app.audit_row keeps the old values.
create function app.revoke_staff_role(p_user_id uuid, p_role public.role_kind) returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor  uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_tenant uuid := app.current_tenant_id();
  v_gone   integer;
begin
  if not app.actor_has_role('owner') then
    raise exception 'only an owner takes a role away' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'finance', 'practitioner', 'lead_practitioner') then
    raise exception 'not a working role' using errcode = '42501';
  end if;
  if v_actor is null or v_actor = p_user_id then
    raise exception 'nobody changes their own access' using errcode = '42501';
  end if;
  if not exists (select 1 from public.app_user u where u.id = p_user_id and u.tenant_id = v_tenant) then
    raise exception 'no such colleague' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_role r
              where r.user_id = p_user_id and r.tenant_id = v_tenant and r.role = 'owner') then
    raise exception 'an owner''s access does not change' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_role r
              where r.user_id = p_user_id and r.tenant_id = v_tenant and r.role = p_role)
     and not exists (select 1 from public.user_role r
                      where r.user_id = p_user_id and r.tenant_id = v_tenant
                        and r.role in ('admin', 'finance', 'practitioner', 'lead_practitioner')
                        and r.role <> p_role) then
    raise exception 'a person keeps at least one working role' using errcode = '42501';
  end if;
  delete from public.user_role r
   where r.user_id = p_user_id and r.tenant_id = v_tenant and r.role = p_role;
  get diagnostics v_gone = row_count;
  return v_gone > 0;
end
$$;
revoke execute on function app.revoke_staff_role(uuid, public.role_kind) from public;
grant execute on function app.revoke_staff_role(uuid, public.role_kind) to app_role;

-- rollback:
--   drop function if exists app.revoke_staff_role(uuid, public.role_kind);
--   drop trigger if exists guard_owner_identity on public.app_user;
--   drop function if exists app.guard_owner_identity();
--   drop trigger if exists guard_owner_role on public.user_role;
--   drop function if exists app.guard_owner_role();
```

- [ ] **Step 4: Rewrite `db/policies/core/role_guard.sql`.** `credential` and `service_type` keep today's two policies exactly. `app_user` and `user_role` come out of that loop and get:

```sql
-- Who works at the practice is the owner's to say (operator, 21 September 2026).
-- One carve-out the portal depends on: an admin invites a household, which
-- inserts an app_user and a client_contact role row and later suspends that row
-- (app/api/portal/access.ts).
drop policy if exists admin_inserts_only on public.app_user;
create policy admin_inserts_only on public.app_user as restrictive for insert to app_role
  with check (app.actor_has_role('owner') or app.actor_has_role('admin'));  -- a row with no role is inert

drop policy if exists admin_updates_only on public.app_user;
create policy admin_updates_only on public.app_user as restrictive for update to app_role
  using (app.actor_has_role('owner')
         or (app.actor_has_role('admin')
             and not exists (select 1 from public.user_role r
                              where r.user_id = app_user.id and r.tenant_id = app_user.tenant_id
                                and r.role <> 'client_contact')));

drop policy if exists admin_inserts_only on public.user_role;
create policy admin_inserts_only on public.user_role as restrictive for insert to app_role
  with check (app.actor_has_role('owner')
              or (role = 'client_contact' and app.actor_has_role('admin')));

drop policy if exists admin_updates_only on public.user_role;
create policy admin_updates_only on public.user_role as restrictive for update to app_role
  using (app.actor_has_role('owner'));
```

Leave `owner_grants_owner`, `owner_keeps_owner` and `owner_keeps_identity` standing: they are now the courtesy above the triggers, and they agree with them.

- [ ] **Step 5: Migrate, then run the new file AND everything that could have leaned on the old rules.**

Run: `pnpm db:migrate && pnpm test:db`
Expected: `tests/db/owner_lock.test.ts` PASS. **`tests/db/team.test.ts` will now FAIL** wherever it acts as an admin (creating a colleague, granting a role, suspending, resetting): that is this task proving itself, and Task 5 rewrites those cases. Anything else that fails is a real finding: read it before touching it. The likeliest are a portal test whose admin did something to a staff row, and any fixture that updates an owner's name as the superuser with no `app.actor_id` set. Fix a fixture by setting the actor, never by weakening the trigger.

- [ ] **Step 6: Commit** (with `tests/db/team.test.ts`'s admin cases marked `it.skip` and a comment naming Task 5, so the branch is not left red).

```bash
git -C /Volumes/Storage/McWellness/mcwellness-team add db tests/db
git -C /Volumes/Storage/McWellness/mcwellness-team commit -m "feat(db): two owners nobody can revoke, and the one way a role is taken away"
```

---

### Task 4: An email is two writes

**Files:**
- Modify: `app/api/portal/auth-admin.ts`, `app/api/portal/auth-admin.test.ts`

**Interfaces:**
- Produces: `AuthAdminProvider.setEmail(authId: string, email: string): Promise<void>`, throwing `EmailInUseError` when the address is taken and `AuthAdminUnavailableError` otherwise.

- [ ] **Step 1: Failing tests**, in the file's existing style (it stubs `fetch`): the Supabase provider `PUT`s `users/{id}` with `{ email, email_confirm: true }`; a 422 `email_exists` throws `EmailInUseError`; a 500 throws `AuthAdminUnavailableError`. The fake: `setEmail` to a free address moves it (the old address is then free for `createUser`, the new one is refused); to an address another sign-in holds throws `EmailInUseError`; to the sign-in's own current address is a no-op.

- [ ] **Step 2:** Run `pnpm exec vitest run app/api/portal/auth-admin.test.ts`. Expected: FAIL, `setEmail is not a function`.

- [ ] **Step 3: Implement.** Add to the type, with the file's tone of comment ("the address is the sign-in, so it changes here first"). Supabase:

```ts
    async setEmail(authId: string, email: string): Promise<void> {
      const response = await call(`users/${encodeURIComponent(authId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // Confirmed without a message, as createUser is: the practice typed it.
        body: JSON.stringify({ email, email_confirm: true }),
      });
      if (await saysEmailInUse(response)) throw new EmailInUseError();
      if (!response.ok) throw refused(response, 'change that address');
    },
```

Fake:

```ts
    async setEmail(authId: string, email: string): Promise<void> {
      const key = email.trim().toLowerCase();
      const holder = byEmail.get(key);
      if (holder !== undefined && holder !== authId) throw new EmailInUseError();
      const old = byAuthId.get(authId);
      if (old !== undefined) byEmail.delete(old);
      byEmail.set(key, authId);
      byAuthId.set(authId, key);
    },
```

- [ ] **Step 4:** Run the file again, PASS; `pnpm -s typecheck` (any other object typed `AuthAdminProvider` in tests must gain the method).

- [ ] **Step 5: Commit** `feat(auth): the sign-in provider changes an address`.

---

### Task 5: The API

**Files:**
- Modify: `app/api/team/schema.ts`, `app/api/team/routes.ts`
- Modify: `tests/db/team.test.ts`

**Interfaces:**
- Consumes: Task 1's rules, Task 3's `app.revoke_staff_role`, Task 4's `setEmail`.
- Produces, in `schema.ts`:

```ts
export const TeamMember = z.object({
  id: z.uuid(), displayName: z.string(), email: z.string().nullable(),
  status: z.enum(STAFF_STATUSES), roles: z.array(z.string()), isYou: z.boolean(),
  /** Holds ownership: nothing on the row is anybody's to change. */
  locked: z.boolean(),
  /** Sent to an owner only; null otherwise and when none is recorded. */
  jobTitle: z.string().nullable(),
});

const E164 = /^\+[1-9][0-9]{6,14}$/;
const optionalText = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable();

export const TeamProfile = TeamMember.extend({
  phone: z.string().nullable(),
  preferredLocale: z.enum(['en', 'ar']),
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
  privateNotes: z.string().nullable(),
  /** Whether the person reading may save this profile (`canEditProfile`). */
  editable: z.boolean(),
});
export type TeamProfile = z.infer<typeof TeamProfile>;

export const ProfileBody = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: InviteBody.shape.email,
  phone: z.string().regex(E164).nullable(),
  preferredLocale: z.enum(['en', 'ar']),
  jobTitle: optionalText(120),
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: z.string().regex(E164).nullable(),
  privateNotes: optionalText(4000),
});
export const TEAM_REFUSALS = ['locked', 'last_role', 'not_yourself', 'not_a_working_role'] as const;
```

Remove `GrantBody`: the role is a path segment now.

- [ ] **Step 1: Rewrite `tests/db/team.test.ts` first.** Un-skip Task 3's skipped cases and change who acts: every case that created, granted, suspended or reset **as the admin** now does it as the owner (`OWNER_AUTH`), and gains a twin asserting the admin is answered **403** and nothing changed. Then add, each its own `it`:

  1. `GET /api/team` as owner carries `locked: true` on the owner's row and a `jobTitle`; as admin every `jobTitle` is `null` and the list is still 200.
  2. `GET /api/team/:id` as owner answers the profile and writes one `read` row to `audit_log` for `app_user`; as admin 403; an unknown id 404; a household contact's id 404.
  3. `PATCH /api/team/:id` as owner changes the name, the phone and all five profile fields; a second PATCH with `privateNotes: ''` stores null; the trail's rows for `staff_profile` never contain the note's words.
  4. `PATCH` that changes the email calls `h.authAdmin.setEmail` once with the new address (spy on the harness's own provider, as round 57's test does) and the row follows. With `setEmail` made to throw `EmailInUseError` (`vi.spyOn(h.authAdmin, 'setEmail').mockRejectedValueOnce(new EmailInUseError())`) the answer is 409 `email_in_use` and the row is **unchanged**. **The put-back:** make the database refuse after the address has moved, with a `ProfileBody` that changes the email and carries `startedOn: '2026-02-31'`. It passes the body's regex, and Postgres refuses it as a date (SQLSTATE 22008), so the failure lands exactly where the put-back has to work. Assert the answer is a 5xx, that `setEmail` was called **twice** — the new address, then the old — and that `app_user.email` is unchanged.
  5. `PATCH` on the second owner's row by the first owner: 409 `locked`, nothing changed. By that owner themselves: 200.
  6. `PUT /api/team/:id/roles/practitioner` as owner: 200, idempotent twice; `/roles/owner`: 400 `not_a_working_role`; on yourself: 400 `not_yourself`; on the second owner: 409 `locked`; as admin: 403.
  7. `DELETE /api/team/:id/roles/practitioner`: 200 and the row is gone and `/api/me` for that person no longer lists it **on the very next request**; deleting the last working role: 409 `last_role`; a role not held: 200 and nothing changes; on the second owner: 409 `locked`; as admin 403.
  8. `POST /api/team/:id/status` on the second owner by the first: 409 `locked`.
  9. `POST /api/team/:id/password` by an **admin for a finance colleague**: 403, `setPassword` never called, one `password_reset_refused` row. (Round 57's owner cases stay.)

- [ ] **Step 2:** Run `pnpm exec vitest run --config vitest.db.config.ts tests/db/team.test.ts`. Expected: FAIL across the new cases (404s for routes that do not exist, 200s where 403 is now expected).

- [ ] **Step 3: Implement the routes.** In `routes.ts`:

  - One helper reads a target once, as the actor:

```ts
type Target = { id: string; auth_id: string | null; display_name: string; email: string | null;
  phone: string | null; preferred_locale: 'en' | 'ar'; status: Row['status']; roles: Role[] };

const TARGET_SQL =
  'select u.id, u.auth_id, u.display_name, u.email, u.phone, u.preferred_locale::text as preferred_locale, ' +
  'u.status::text as status, ' +
  '(select array_agg(r.role::text order by r.role) from user_role r where r.user_id = u.id and r.tenant_id = u.tenant_id) as roles ' +
  'from app_user u where u.id = $1 and u.tenant_id = app.current_tenant_id() ' +
  "and exists (select 1 from user_role r where r.user_id = u.id and r.role <> 'client_contact')";
```

  - `GET /api/team`: `staff.manage`. Add `locked: isLocked(row.roles as Role[])`. Left-join `staff_profile` for `job_title` **only when the actor is an owner** (row security would answer null for an admin anyway; do not rely on that alone: select it only for an owner).
  - `POST /api/team`, `/status`: the guard becomes `staff.access.manage`. `/status` reads the target first and answers 409 `locked` for an owner's row, before the update.
  - `GET /api/team/:id`: `staff.access.manage`; `TARGET_SQL`; 404 when none; `logReads(db, 'app_user', [{ id, clientId: null }], 'read')`; then `select … from staff_profile where user_id = $1`; answer `TeamProfile.parse({... , editable: canEditProfile({...}) })`.
  - `PATCH /api/team/:id`: `staff.access.manage`; parse `ProfileBody` (400); read target (404); `canEditProfile` false → 409 `locked`. If the email changed and `auth_id` is not null: `await options.authAdmin.setEmail(authId, newEmail)` first (409 `email_in_use`, 503 `sign_ins_unavailable`, exactly as `POST /api/team` maps them). Then, in a `try`, `update app_user set display_name, email, phone, preferred_locale` and an upsert:

```sql
insert into staff_profile (tenant_id, user_id, job_title, started_on, emergency_contact_name,
                           emergency_contact_phone, private_notes, created_by)
values ($1, $2, $3, $4, $5, $6, $7, $8)
on conflict (user_id) do update set job_title = excluded.job_title, started_on = excluded.started_on,
  emergency_contact_name = excluded.emergency_contact_name,
  emergency_contact_phone = excluded.emergency_contact_phone, private_notes = excluded.private_notes
```

    and in the `catch`, if the address was moved, put it back (`setEmail(authId, oldEmail)`, its own failure swallowed with the same never-the-address `console.warn` that `POST /api/team` uses) and rethrow.
  - `PUT /api/team/:id/roles/:role` and `DELETE …`: `staff.access.manage`; read target (404); `const refusal = canSwitchRole({ actorUserId: actor.userId, targetUserId: id, targetRoles, role, on })`; map `locked` and `last_role` to 409, the other two to 400, each `{ error: refusal, requestId }`. On: today's `insert … on conflict (user_id, role) do nothing`. Off: `select app.revoke_staff_role($1, $2::role_kind)`.
  - `POST /api/team/:id/password`: the guard stays `staff.manage` **on purpose**, so that an admin's attempt reaches `canResetPassword`, is refused there, and is written as `password_reset_refused`; a bare 403 at the first guard would leave no row.
  - Delete the old `POST /api/team/:id/roles` and rewrite the file's header comment: who may, what changed on 21 September, and why the password route keeps the wider first guard.

- [ ] **Step 4:** Run the file again. Expected: PASS. Then `pnpm test:db` whole: PASS.

- [ ] **Step 5: Commit** `feat(team): a profile to open and edit, roles on and off, owners only`.

---

### Task 6: The audit trail says it in words

**Files:**
- Modify: `domain/shared/audit-narrative.ts`, `domain/shared/audit-narrative.test.ts`

- [ ] **Step 1:** Read how the catalogue keys its sentences (`grep -n "user_role\|app_user\|password" domain/shared/audit-narrative.ts`). Add failing tests, in the file's own pattern, for: a `delete` on `user_role` ("took a role away from a colleague"), an `insert` and an `update` on `staff_profile` ("recorded" / "changed a colleague's staff profile"), and the two application actions `password_reset` and `password_reset_refused` ("minted a temporary password for a colleague" / "was refused a temporary password for a colleague") if the catalogue holds application actions at all. If it does not, this step adds only the two table sentences and the round note says so.
- [ ] **Step 2:** Run, FAIL. **Step 3:** add the sentences; they name no role and no field value. **Step 4:** PASS. **Step 5: Commit** `feat(audit): sentences for a role taken away and a staff profile`.

---

### Task 7: The tab strip moves to the shell

**Files:**
- Move: `app/admin/clients/Tabs.tsx` → `app/shell/components/Tabs.tsx` (and `Tabs.test.tsx` if one exists beside it), unaltered
- Modify: `app/admin/clients/ClientDrawer.tsx` (its import line and nothing else)
- Modify: `app/shell/shell.css` (add `.tabs__panel`, copied from `app/admin/clients/clients.css`)

By the precedent of trunk round 36 (`CoordinateFields`): two modules need it, which is `docs/SPEC/OWNERSHIP.md`'s rule for a thing two modules share. `clients.css` is **not** touched; its identical rule is that stream's to remove.

- [ ] **Step 1:** `git -C … mv`, change the one import, copy the one CSS rule. **Step 2:** `pnpm exec vitest run app/admin/clients app/shell` and `pnpm -s typecheck`: PASS with no test changed. **Step 3:** Add the paragraph to `docs/SPEC/OWNERSHIP.md` in the form of round 36's. **Step 4: Commit** `refactor(shell): the tab strip is the shell's, because two modules need it`.

---

### Task 8: The screen

**Files:**
- Create: `app/admin/settings/TeamMemberDrawer.tsx`, `app/admin/settings/TeamMemberDrawer.test.tsx`
- Modify: `app/admin/settings/TeamPage.tsx`, `TeamPage.test.tsx`, `settings.css`

**Interfaces:**
- Consumes: `TeamProfile`, `ProfileBody`, `TeamMember` (Task 5); `STAFF_ROLES`, `STAFF_ROLE_LABELS`, `STAFF_ROLE_OPENS`, `canSwitchRole`, `isLocked` (Task 1); `Tabs`, `TabPanel` (Task 7); `useDrawer`, `useDrawerWidth`, `DrawerResizeHandle`, `PhoneField`, `DateField`, `Field`, `Select`, `Button`, `Note` from the shell.
- Produces: `<TeamMemberDrawer memberId={string} onClose={() => void} onChanged={() => void} />`.

Read `docs/DESIGN-BRIEF.md` and `app/admin/settings/PractitionerBaseDrawer.tsx` first: the second is the pattern to copy for the `<aside className="drawer" role="dialog" aria-modal="true">`, its header, its close button, `useDrawer(drawerRef, closeRef, onClose)` and its error handling.

- [ ] **Step 1: Failing tests.** `TeamPage.test.tsx`, replacing the cases that counted "Add …" buttons:

  1. An owner sees one **Open** button per row and no "Add …" button anywhere; a job title shows under the name when there is one.
  2. An admin sees the rows and **no button at all**; "Add a person" is absent.
  3. Pressing Open mounts the drawer for that row's id.

  `TeamMemberDrawer.test.tsx`, with a `fetch` stub answering `GET /api/team/:id`:

  4. It shows the person's name as its title and two tabs, Profile and Access; arrow keys move between them.
  5. Profile saves with one `PATCH`, `content-type: application/json`, carrying every field; a 409 `email_in_use` says "That email address already has a sign-in." and keeps what was typed.
  6. Under Private notes it reads: "Contract terms and reminders. Nothing about health. The person may ask to see what is written here."
  7. Access shows four switches (`role="switch"`, `aria-checked`), each with its `STAFF_ROLE_OPENS` line; turning one on sends `PUT …/roles/finance`, off sends `DELETE`.
  8. A 409 `last_role` returns the switch to where it was and says: "A person keeps at least one role. To shut somebody out, suspend them."
  9. A locked profile shows "Owner. Full access. Cannot be changed.", every switch `disabled`, and no Suspend; with `editable: false` the Profile fields are read-only and there is no Save.
  10. New temporary password shows the password once, as the list does today; Suspend becomes Reactivate.
  11. Escape closes it and focus returns to the row's Open button.

- [ ] **Step 2:** Run both files. Expected: FAIL.

- [ ] **Step 3: Build it.** The switch is a real control, not a styled div:

```tsx
<button
  type="button"
  role="switch"
  aria-checked={on}
  aria-describedby={`${id}-opens`}
  disabled={busy || locked}
  className="switch"
  onClick={() => void flip(role, !on)}
>
  <span className="switch__label">{STAFF_ROLE_LABELS[role]}</span>
</button>
<p id={`${id}-opens`} className="small muted">{STAFF_ROLE_OPENS[role]}</p>
```

`flip` sets the switch optimistically, sends the request, and on any refusal sets it back and shows the sentence for the code. The five sentences live in one `const REFUSALS: Record<string, string>` at the top of the file. `.switch` goes in `settings.css`, colours from tokens only, a 160ms transition on the thumb and nothing else moving. In `TeamPage.tsx`, the actions column renders `Open` when `canManage` (the viewer's own row holds `owner`), and nothing otherwise; "Add a person" likewise. Update the page's `aside` sentence and the file's header comment to say who may.

- [ ] **Step 4:** Run both files, PASS. Then **look at it**: `pnpm dev` from the worktree (API port 3005), sign in through the development door as the seeded owner, open a profile, flip a switch, open the owner's own row, then sign in as the seeded admin. Check 1200px and 768px. Screens that pass their tests and look wrong are not done.

- [ ] **Step 5: Commit** `feat(team): a profile drawer with access switches, and a quieter list`.

---

### Task 9: The record, the gate and the reviews

**Files:**
- Create: `docs/CHANGE-REQUESTS/trunk-round-58.md`, `docs/RUNBOOK/second-owner.md`
- Modify: `docs/SECURITY.md` ("Who may read what": `staff_profile`, and the team's new audiences), the staff-data entry under `docs/COMPLIANCE/` (find the data inventory with `grep -rln "emergency\|category" docs/COMPLIANCE`), `docs/SPEC/OWNERSHIP.md` if Task 7 has not already

- [ ] **Step 1: The round note**, in the shape of `trunk-round-57.md`: the ask, the six decisions with their dates, what each layer does now, the proof, every file touched outside the trunk's own paths (Task 7's two), and **Going live**: three migrations in the order 922, 923, 967 with their sha256 bookkeeping rows; `tenant_isolation.sql`, `role_guard.sql` and `staff_profile.sql` re-applied by hand; staging first; the second owner's data step; the two admins told beforehand.

- [ ] **Step 2: `docs/RUNBOOK/second-owner.md`.** The audited data step, written as a do-block that **ends in `raise`** for the rehearsal and has the raise removed for the act, the way the test clients were removed on 19 September: set `app.tenant_id`, `app.actor_id` (the founder's), `app.actor_roles = 'owner'` and `app.reason`; `insert into user_role (tenant_id, user_id, role, granted_by, created_by) values (…, 'owner', founder, founder)`; select the person's roles back; `select app.verify_audit_chain()` is null. It names nobody: the two ids are read from the live database at the pass and never written into the repository.

- [ ] **Step 3: The gate.**

Run: `pnpm -s format && pnpm verify && pnpm test:db`
Expected: all green. Then sweep the whole diff with the identifier hook's patterns and a names grep (`git -C … diff origin/main | grep -n -i -E "<the hook's two patterns>"`).

- [ ] **Step 4: Push and open the pull request**, then dispatch **three** reviews in parallel, each told to read by ref and never to switch the checkout: `.claude/agents/schema-reviewer.md` (three migrations, two triggers, a definer function), `security-reviewer.md` (try to revoke an owner by any path; try to reach `staff_profile` as anybody but an owner; the email's two writes; the portal's carve-out), `compliance-reviewer.md` (a third person's data; the notes' hint; no real identifier in a public repository). Take their findings test-first. Merge only when every check on the head commit reads `SUCCESS`, in a command of its own, pinned with `--match-head-commit`.

- [ ] **Step 5: Say at merge time that merged is not live**, and ask for the word in the same breath.

---

## Self-review

**Spec coverage.** Section 1 (a switch is a role): Tasks 1, 5, 8. Section 2 (round 57): already merged and live; narrowed further in Task 1 by the operator's later answer. Section 3 (owner lock): Task 3's two triggers and Task 9's runbook. Section 4 (switching off): Task 3's function, Task 1's `last_role`. Section 5 (who may): Task 1's action, Task 3's policies, Task 5's guards. Section 6 (the profile's table, redaction, the hint): Task 2 and Task 8 case 6. Section 7 (API, email as two writes): Tasks 4 and 5. Section 8 (screen): Tasks 7 and 8. Section 10 (tests): each task's first step. Section 11 (going live): Task 9. Section 9 is what this plan deliberately does not build.

**Known judgement calls an executor should not re-open:** the password route's first guard stays wide so a refusal is a row; redaction is migration 967, not 924; the `auth_id` lock admits a first link from null, because that is how the test harness and a bootstrap give an owner their sign-in.
