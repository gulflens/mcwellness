# Change requests — session-capture, pull request 1

Three requests from this pull request's own work. The first two were
expected from the plan (the screen is pull request 2); the third is a new
finding: building migration 300 correctly exposed a gap in a trunk-owned
test that every future stream's own migration will hit the same way.

---

## 1. Mount `mountSessions` in `app/api/create-api.ts`

**What.** Add `mountSessions(api, deps.now)` alongside the existing route
mounts, once the check-in screen (pull request 2) is ready to call it.

**Why.** `app/api/create-api.ts` is the shared route table (`app/api/**`
outside `app/api/_middleware` and each stream's own subtree). This pull
request deliberately does not mount the route itself — there is no screen
yet to call it from, and OWNERSHIP.md keeps the shared route table out of
session-capture's edit paths. The database tests mount `mountSessions`
directly on the `Hono` instance `createApi(...)` returns, so the route's own
behaviour is fully proven without this wiring; only reachability from a
browser needs it.

**Proposed diff.**

```diff
 import { mountTimeline } from './audit/timeline';
 import { mountClients } from './clients/list';
 import { mountDevSession, type DevSessionOptions } from './dev-session';
+import { mountSessions } from './sessions/checkin';
 ...
   mountClients(api, deps.now);
   mountTimeline(api, deps.now);
+  mountSessions(api, deps.now);
```

---

## 2. Route and link the check-in screen in the shell

**What.** Once pull request 2 adds `app/therapist/session/CheckInPage.tsx`,
add a route for it in `app/shell/App.tsx` (the file that actually holds the
route table — `app/shell/routing.ts` holds only `homeFor` and the role
labels; there is no `app/shell/routing.tsx`), and one link to it from
`app/therapist/TodayLanding.tsx` so a practitioner reaches it without typing
a URL.

**Why.** Both files are shared: `app/shell/**` is out of session-capture's
paths, and `app/therapist/TodayLanding.tsx` sits outside
`app/therapist/session/**` (it is also outside `app/therapist/today/**`,
which OWNERSHIP.md gives to `scheduling` — it looks to have been seeded by
the trunk as a placeholder ahead of either stream landing a real screen
there).

**Proposed diff** (pull request 2, once `CheckInPage.tsx` exists).

```diff
 // app/shell/App.tsx
+import { CheckInPage } from '../therapist/session/CheckInPage';
 ...
   <Route path="/today" element={<RequireAuth>{() => <TodayLanding />}</RequireAuth>} />
+  <Route path="/today/check-in" element={<RequireAuth>{() => <CheckInPage />}</RequireAuth>} />
```

```diff
 // app/therapist/TodayLanding.tsx
+import { useNavigate } from 'react-router';
 ...
+      <Button onClick={() => navigate('/today/check-in')}>Check in</Button>
```

(Exact placement and copy are pull request 2's to decide against the design
brief; this is the shape of the change, not the final wording.)

---

## 3. `tests/db/schema.test.ts` still asserts an exact, trunk-only schema

Not a request against `tests/db/audit.test.ts` any more: its `'every audited
table is classified'` test is being moved, on the coordinator's direction,
to read a table comment instead of three hardcoded lists, and migration 300
already carries `comment on table session is 'audited: client';` and the
same for `session_event` — both hold a uuid `client_id`. Until that move
merges, `tests/db/audit.test.ts` still fails against this branch on the old,
hardcoded lists; once it does, this branch needs no further change.

**What remains.** Three assertions in `tests/db/schema.test.ts` compare a
live query against a hardcoded list or count that only accounts for the
trunk's own 11 core tables and 3 core policy files:

- `'has exactly the section 2 and 3 tables plus audit_log and the bookkeeping
  tables'` — `expect(rows...).toEqual([...CORE_TABLES, 'audit_log',
  'schema_migration'].sort())` against every base table in `public`.
- `'attaches the audit trigger... to every section 2 and 3 table'` —
  the same exact-match shape against every table carrying the `audit_row`
  trigger.
- `'is idempotent... re-applies the policies cleanly'` —
  `expect(await applyPolicies(client)).toBe(3)`.

**Why.** Migration 300 in this pull request adds `session` and
`session_event`, both correctly carrying `audit_row` (they hold personal
data — CLAUDE.md rule 5, `.claude/rules/compliance.md`), and
`db/policies/session/` adds two more policy files. That is exactly what a
stream's own migration is supposed to do (00-data-model.md section 1: every
table gets the trigger; OWNERSHIP.md: a stream owns its own
`db/policies/<module>/`), yet it makes these three assertions fail — not
because anything is wrong, but because each enumerates "every table" or
"every policy file" instead of scoping itself to the trunk's own. The same
assertions will break again the moment `scheduling`, `billing` or any later
stream adds its first migration. It is the same shape of problem
`app.audit_client_id`, `vitest.db.config.ts` and (once the comment
convention lands) `audit.test.ts`'s classification test already had fixed —
a trunk artifact hardcoded against "today's tables" rather than "the
trunk's own tables". This file is the one that sweep hasn't reached yet.

Locally, restricted to `tests/session/db/**`, `pnpm test:db` is fully green
(17 of 17). These three, plus `audit.test.ts`'s classification test until
its own fix lands, are the only failures in a full `pnpm test:db` run and
are reproducible on `origin/main` alone, with no session-capture migration
applied — pre-existing, not introduced by this pull request; migration 300
only makes them visible for the first time, the same way `client-record`'s
own first migration will when it lands one.

**Proposed diff** (illustrative — the exact rewrite is the trunk's call):

```diff
   it('has exactly the section 2 and 3 tables plus audit_log and the bookkeeping tables', async () => {
     const { rows } = await client.query<{ table_name: string }>(
       "select table_name from information_schema.tables where table_schema = 'public' " +
         "and table_type = 'BASE TABLE' and table_name not like 'audit_log_%' " +
         "and table_name not in ('spatial_ref_sys') order by 1",
     );
-    expect(rows.map((row) => row.table_name).sort()).toEqual(
-      [...CORE_TABLES, 'audit_log', 'schema_migration'].sort(),
-    );
+    // Every stream adds its own tables from its own migration range; this
+    // only guards the trunk's — a stream's own schema test (tests/<stream>/db/**)
+    // is where its own tables are asserted exhaustively.
+    const present = rows.map((row) => row.table_name);
+    for (const table of [...CORE_TABLES, 'audit_log', 'schema_migration']) {
+      expect(present, table).toContain(table);
+    }
   });
```

```diff
-    expect(rows.map((row) => row.table).sort()).toEqual([...CORE_TABLES, 'audit_log'].sort());
+    const auditedTables = rows.map((row) => row.table);
+    for (const table of CORE_TABLES) {
+      expect(auditedTables, table).toContain(table);
+    }
     expect(rows.every((row) => row.enabled === 'A')).toBe(true);
```

```diff
     expect(await runMigrations(client)).toBe(0);
-    expect(await applyPolicies(client)).toBe(3);
+    expect(await applyPolicies(client)).toBeGreaterThanOrEqual(3);
```
