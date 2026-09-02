# billing-01: mounting the price list

Two requests left over from this pull request's plan. (A third — the
`billing.price.read` / `billing.price.write` actions in
`domain/shared/actor.ts` — is already done, on `shared-zone-round-1`.) Both
below are deliberately deferred to the second billing pull request, which
ships the screen: there is no reason to route to or mount an unused API
today, and doing both changes in the same pull request as the screen keeps
the shared-zone edit reviewable next to the thing it enables.

## 1. Mount the billing routes

**What.** In `app/api/create-api.ts`, mount the billing routes.

**Why.** Route mounting is centralised in this one file by design (it is
where `mountClients` and `mountTimeline` are already called). `app/api/billing/routes.ts`
exports `mountBilling(api, now)`, which mounts the price-list routes this
pull request adds (`GET /api/billing/service-types`, `GET` and
`POST /api/billing/prices`); nothing calls it in production yet. The
database tests in `tests/billing/db/prices.test.ts` mount it themselves on
the `api` object `createApi` returns, so this change is not required for
this pull request's own tests to pass — only for the screen in the next one
to have something to call.

**Proposed diff.**

```diff
--- a/app/api/create-api.ts
+++ b/app/api/create-api.ts
@@
+import { mountBilling } from './billing/routes';
 import { mountTimeline } from './audit/timeline';
 import { mountClients } from './clients/list';
 import { mountDevSession, type DevSessionOptions } from './dev-session';
@@
   mountClients(api, deps.now);
   mountTimeline(api, deps.now);
+  mountBilling(api, deps.now);
```

## 2. Route and rail link for the billing screen

**What.** In `app/shell/App.tsx`, register a `billing` route under `/admin`
that renders the price-list screen; in `app/shell/components/Rail.tsx`, give
the existing `billing` entry in `ADMIN_SECTIONS` a `to` destination.

**Why.** The route table is centralised in `App.tsx` (this repository's
`<Routes>` table — the ownership map's shorthand `routing.tsx` names the
concept; the actual file is `App.tsx`, while `routing.ts` holds only
`homeFor` and `describeRoles`). The rail already lists "Billing" as
"Arriving" (`app/shell/components/Rail.tsx`, `ADMIN_SECTIONS`); it should
become a real link once a screen exists to link to. Neither change has
anything to point at yet — this pull request ships no screen, by the
operator's instruction — so both are deferred to the pull request that adds
`app/admin/billing/BillingPage.tsx`.

**Proposed diff** (illustrative; the second pull request supplies the real
component import and path once `BillingPage.tsx` exists):

```diff
--- a/app/shell/App.tsx
+++ b/app/shell/App.tsx
@@
+import { BillingPage } from '../admin/billing/BillingPage';
 import { ClientsPage } from '../admin/clients/ClientsPage';
@@
         <Route index element={<Navigate to="/admin/clients" replace />} />
         <Route path="clients" element={<ClientsPage />} />
+        <Route path="billing" element={<BillingPage />} />
```

```diff
--- a/app/shell/components/Rail.tsx
+++ b/app/shell/components/Rail.tsx
@@
-  { key: 'billing', label: 'Billing', icon: <BillingIcon /> },
+  { key: 'billing', label: 'Billing', to: '/admin/billing', icon: <BillingIcon /> },
```

## 3. Four trunk-owned `pnpm test:db` assertions assume no stream has migrated yet

**What.** `tests/db/schema.test.ts` (three assertions) and `tests/db/audit.test.ts`
(one assertion) assert, with exact-equality, that the public schema contains
*only* the trunk's own core tables, that the audit trigger is attached to
*only* those tables, and that `applyPolicies` re-applies *exactly* three
policy files. All four now fail once `db/migrations/400_billing_catalogue.sql`
and `db/policies/billing/catalogue.sql` are applied to the same database —
which `pnpm test:db` always does, since `freshDatabase()` in `tests/db/helpers.ts`
runs every migration and policy file present, not only the trunk's.

**Why this is a trunk fix, not a billing one.** `tests/db/` is not listed as
owned by any stream in `docs/SPEC/OWNERSHIP.md`, and `vitest.db.config.ts`
says outright: "the trunk's under tests/db; each stream's under
tests/<stream>/db." These four assertions were written before any stream had
landed its own migration; billing is the first (`domain/billing`,
`app/admin/billing`, `app/api/billing`, `db/policies/billing`, `jobs/billing`,
`tests/billing` all start empty per `docs/SPEC/OWNERSHIP.md` at the top of
this pull request), so this is the first time the gap shows up — every other
stream will hit the same four failures the moment its own first migration
lands. Nothing about the failures relates to billing's own logic:
`tests/billing/db/prices.test.ts` proves, for `price` and `vat_setting`
specifically, exactly what these four assertions check in general — RLS,
tenant isolation, and the audit row with its correct (`null`) `client_id`
classification (docs/CHANGE-REQUESTS's own reasoning: neither table carries
a `client_id` column, so `app.audit_client_id` correctly returns null, as it
already does for `tenant` and `service_type`).

**Proposed diff.** Loosen the three exact-equality list checks to "contains
at least the core list" (each keeps its own follow-on assertion — the
per-row `client_id` classification loop, and the "every trigger fires
always" check — which already work correctly against any extra tables, so
the real protection barely changes) and make the policy-file count dynamic
rather than hand-typed:

```diff
--- a/tests/db/schema.test.ts
+++ b/tests/db/schema.test.ts
@@
   it('has exactly the section 2 and 3 tables plus audit_log and the bookkeeping tables', async () => {
     const { rows } = await client.query<{ table_name: string }>(
       "select table_name from information_schema.tables where table_schema = 'public' " +
         "and table_type = 'BASE TABLE' and table_name not like 'audit_log_%' " +
         "and table_name not in ('spatial_ref_sys') order by 1",
     );
-    expect(rows.map((row) => row.table_name).sort()).toEqual(
-      [...CORE_TABLES, 'audit_log', 'schema_migration'].sort(),
-    );
+    // A stream's own migrations (docs/SPEC/OWNERSHIP.md) add their own tables
+    // to this same local database once applied; this proves the core ones
+    // are still exactly present, not that nothing else exists.
+    expect(rows.map((row) => row.table_name)).toEqual(
+      expect.arrayContaining([...CORE_TABLES, 'audit_log', 'schema_migration']),
+    );
   });
@@
   it('attaches the audit trigger, set to fire always, to every section 2 and 3 table', async () => {
     const { rows } = await client.query<{ table: string; enabled: string }>(
       'select c.relname as table, t.tgenabled as enabled from pg_trigger t ' +
         "join pg_class c on c.oid = t.tgrelid where t.tgname = 'audit_row' order by 1",
     );
-    expect(rows.map((row) => row.table).sort()).toEqual([...CORE_TABLES].sort());
+    expect(rows.map((row) => row.table)).toEqual(expect.arrayContaining([...CORE_TABLES]));
     expect(rows.every((row) => row.enabled === 'A')).toBe(true);
   });
@@
   it('is idempotent: a second migrate applies nothing and re-applies the policies cleanly', async () => {
     const { runMigrations, applyPolicies } = await import('../../db/runner/apply');
+    const { readdir } = await import('node:fs/promises');
+    const policyFiles = (
+      await readdir(new URL('../../db/policies', import.meta.url), { recursive: true })
+    ).filter((f) => f.endsWith('.sql'));
     expect(await runMigrations(client)).toBe(0);
-    expect(await applyPolicies(client)).toBe(3);
+    expect(await applyPolicies(client)).toBe(policyFiles.length);
   });
```

```diff
--- a/tests/db/audit.test.ts
+++ b/tests/db/audit.test.ts
@@
     const audited = rows.map((r) => r.table).sort();
-    expect(audited).toEqual([...WITH_CLIENT, ...NAMES_ITSELF, ...WITHOUT_CLIENT].sort());
+    // As above (tests/db/schema.test.ts): a stream's own audited tables now
+    // live in this database too. The loop below still classifies every one
+    // of them correctly, whether or not it is named here.
+    expect(audited).toEqual(
+      expect.arrayContaining([...WITH_CLIENT, ...NAMES_ITSELF, ...WITHOUT_CLIENT]),
+    );
     for (const r of rows) {
       if (WITH_CLIENT.includes(r.table)) expect(r.client_id_type, r.table).toBe('uuid');
       else expect(r.client_id_type, r.table).toBeNull();
     }
```

Until this lands, `pnpm test:db` on the billing branch reports these four
pre-existing trunk assertions as failing, for the reason above, alongside
`tests/billing/db/prices.test.ts` passing in full.
