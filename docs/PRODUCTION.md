# Wiring the Supabase production project

## Current project

Reference `ipiluvnlnzdbolbqwtpl`, name `mcwellness-production`, region
`ap-south-1` (Mumbai), created 2026-09-06 on the organisation's plan. This is
the platform's own production project — a different product from the old
app's production (`gqvpapvdqcfjlifgwhpk`), which this pass never touches and
which the repository's hook blocks by name.

## What was done on 2026-09-06: the first pass — no seed

The operator's instruction at 09:28 was exactly that: "Migrate it now, no
seed." This pass brings the project's schema level with `main` at `9d85d13`
and stops there. **No seed, no demo visit, no practice identity row.** The
project holds a schema and nothing else: `tenant`, `app_user`, `client` and
`public.audit_log` all read zero rows, confirmed by query, not assumed.

- **The runner's bookkeeping table was bootstrapped first**, exactly as
  `db/runner/apply.ts` does it before any migration file is read: `create
  table if not exists schema_migration (filename text primary key, checksum
  text, applied_at timestamptz not null default now())`, the `checksum`
  column added if missing, row level security enabled and no policy written
  for it — the table is nobody's business but the owner's.
- **Seventy migrations were applied**, in filename order, each under the
  runner's own audit context (`app.reason` naming the file, a fresh
  `app.request_id`, both transaction-local) and each followed immediately by
  its own bookkeeping row carrying the sha256 of the file's own text —
  independently computed two ways (Node's `crypto.createHash('sha256')` and a
  cross-check with `shasum -a 256` against the files on disk) and confirmed to
  match before anything was applied. For manageability the seventy were sent
  through Supabase's migration tool in sixteen ordered batches rather than
  seventy separate calls, each batch itself a sequence of individually
  `begin`/`commit`-wrapped migrations carrying their own audit context and
  bookkeeping insert — atomically identical in effect to seventy individual
  calls, and verified afterwards to be exactly that: `schema_migration` holds
  seventy rows, one per file in `db/migrations`, every checksum matching the
  file on disk, zero null.
- **104 and 105, then 106 and 107, ran in their ordinary filename position**,
  ahead of the 500s and 600s whose tables (`assessment`, `assessment_document`,
  `report`, `report_delivery`) they reach into. This is safe by construction —
  every such reach inside `app.erase_client` is guarded with
  `to_regclass('public.<table>')`, evaluated when the function is *called*,
  never when it is *created* — and it applied cleanly, as it does on every
  worktree's own fresh database.
- **502 and 911 met the same constraint they were always going to meet.**
  Both create `document_tenant_id_client_key ... if not exists`; 502 ran
  first by filename order and created it, and 911 followed as the no-op its
  own guard promises.
- **Twenty policy files were re-applied**, in path order, split across three
  calls for the tool's own size limit rather than the runner's single
  transaction — the same accommodation every staging pass has made, and one
  that changes nothing about what lands: every file is `drop policy if
  exists` then `create policy`, so a split across calls can never leave one
  half-applied. One hundred and thirty-nine policies stand on `public`
  afterwards.
- **The schema fingerprint was taken against a fresh `pnpm db:reset && pnpm
  db:migrate`** in the worktree `mcwellness-trunk-2` (its own database, port
  5442), after `git fetch origin && git checkout -q -B fingerprint-check
  origin/main` there (the worktree's own uncommitted edit to
  `docs/HANDOVER.md` was set aside before the checkout and restored byte for
  byte afterwards, never discarded). Seventy migrations and twenty policy
  files applied cleanly to an empty database. Nine parts were compared,
  canonicalised and hashed inside the query itself: columns (1,221, by
  schema, table, name, type, nullability and default), constraints (530,
  PostgreSQL 17's synthetic not-null constraint names folded to one label),
  indexes (471), triggers (222), policies (139), row-level security flags
  (72 tables), functions (82, by schema, name, argument list, return type,
  volatility, security and language), the table grants `app_role`, `anon`,
  `authenticated` and `PUBLIC` hold (106), and the same for function grants
  (47).

  **One real difference was found and corrected, not merely noted.** The
  columns hash disagreed once, on exactly one column:
  `schema_migration.checksum` was nullable on production and `not null`
  locally. The cause was a genuine gap in this pass's own method: the
  runner's `runMigrations()` always closes a run with `alter table
  schema_migration alter column checksum set not null` once every row
  carries a checksum, a bootstrap step that sits outside any migration file
  and so was not carried over when this pass replicated the runner's
  per-migration steps by hand. Production's seventy rows already all carried
  a checksum (verified before touching anything), so the statement was
  applied as the no-op in substance it is, and the columns hash then matched
  exactly. **A second apparent difference was investigated and found to be a
  measurement artifact, not a schema difference.** The function-grants hash
  disagreed because the query keyed rows by
  `information_schema.role_routine_grants.specific_name`, which embeds each
  database's own internal object id (`appointment_set_busy_end_20529` on
  production, `appointment_set_busy_end_4302089` locally) and can never
  match between two independently created databases by construction. Re-run
  keyed by function identity instead (schema, name, argument list, via
  `pg_proc` and `aclexplode`), the forty-seven rows on each side are
  byte-identical. All nine parts stand identical between production and a
  fresh local build.
- **`app.verify_audit_chain()` returns null** — nothing to break, since
  nothing has been written yet.
- **No migration inserted a practice row.** Every data step this schema
  carries that could seed a tenant-scoped default (goal categories, the VAT
  rate, the scheduling-setting row, the three number-series backfills) is
  written as `insert into ... select ... from tenant`, conditioned on a
  tenant that already exists; with zero rows in `tenant`, every one of them
  ran and inserted nothing. This was read from the migration files before
  the pass began and confirmed by row count afterwards, not assumed either
  way.

## The API role

`096_api_role.sql` creates `mcwellness_api` exactly as it does on every other
project: `login noinherit nobypassrls`, granted `app_role`, with its
search path and its three timeouts set, and **no password** — the migration
never sets one, on principle, and this pass did not either. The role exists
on production today and cannot authenticate until the operator sets one.

## What the operator must set by hand

None of the following was done by this pass, and none of it can be done from
here — not because the tooling is missing, but because setting a
production credential, minting an Auth user for a real person, and holding a
production connection string are all the operator's own acts, never a
migration's and never this session's.

1. **The `mcwellness_api` role's password.** Once, in the project's SQL
   editor, with the project reference `ipiluvnlnzdbolbqwtpl` confirmed in the
   address bar first:

   ```sql
   alter role mcwellness_api password '<a long random password>';
   ```

   Keep the password in the deployment's secret store only, never in this
   repository (docs/STAGING.md section 2 is the same instruction for
   staging, word for word).

2. **The pooler connection string**, built from that password, for the API's
   own secret store (`API_DATABASE_URL`, docs/STAGING.md section 5's shape):

   ```
   postgresql://mcwellness_api.ipiluvnlnzdbolbqwtpl:<the password from step 1>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
   ```

   Port 6543, the transaction pooler, role name suffixed by the project
   reference — the API refuses any other role name at startup.

3. **The founder's own Auth user**, for her own sign-in as owner. In the
   Supabase dashboard, under Authentication → Users → "Add user": her real
   email, a real password of her own choosing, "Auto Confirm User" ticked.
   This pass created no accounts of any kind and no user of any kind — the
   brief's own instruction. The assistant must never create sign-in accounts,
   on production any more than on staging. What that account is then linked
   to, and how the practice it belongs to comes into being, is the next
   section: **The first practice**, which does that linking in one statement
   rather than by hand.

## The first practice

The project has a schema and nothing in it, so nobody can sign in: there is
no practice for an account to belong to. This section is how the practice and
its owner come into being. It is done once, it takes a few minutes, and every
step of it is the operator's own work — the assistant never creates a sign-in
account and never holds a production connection.

**Before anything, migration `956_bootstrap_practice.sql` must be on the
project.** It is applied the way every other migration on this project was:
one file through the Supabase migration tool, under its own audit context,
followed by its bookkeeping row in `schema_migration`. Until it is there, the
statement below answers that the function does not exist.

### Step 1 — the owner's sign-in account

Supabase dashboard → **Authentication** → **Users** → **Add user** → **Create
new user**. Her real email address, a password she chooses herself, and tick
**Auto Confirm User** so there is no confirmation email to wait for. The
dashboard then shows the account in the list with a **User UID** beside it: a
long string of letters, digits and dashes. Copy it — the next step needs it,
and it is the one thing that ties the sign-in to the practice.

### Step 2 — the practice, in one statement

Open the **SQL editor**, with the project reference `ipiluvnlnzdbolbqwtpl`
confirmed in the address bar first, and run this, replacing each bracketed
line with the real value:

```sql
select * from app.bootstrap_practice(
  '[the practice''s legal name, exactly as on the trade licence]',
  '[the same name in Arabic, or null if there is not one yet]',
  '[the User UID copied in step 1]',
  '[the owner''s name, as the app should greet her]',
  '[the owner''s email, the same address as the account in step 1]'
);
```

An apostrophe inside a name is typed twice, as in the brackets above. There
is a sixth argument, the practice's time zone; leaving it off means
`Asia/Dubai`, which is what a practice in the UAE wants.

The statement answers with two ids — the practice's and the owner's — and
that is the whole of it. It creates the practice under those two names, the
owner's record bound to the sign-in account from step 1, and her owner role.
It also gives the practice every setting a practice cannot open without: the
six starting goal categories, the twenty-four-hour cancellation notice period
and the call-out fee, the VAT rate every price is stamped with, and the three
counters that number invoices, receipts and reports. It checks that each of
those arrived before it finishes, so a half-made practice is not possible.

**What it refuses.** Every refusal leaves the database exactly as it was;
nothing is written by halves.

- **A practice already exists.** It makes the first one and only the first
  one. If the owner cannot sign in and a practice is already there, the
  answer is to point the existing owner record at the new sign-in account,
  never to make a second practice. That is one statement, run in the same SQL
  editor, with the two bracketed values replaced:

  ```sql
  update app_user set auth_id = '[the new User UID]' where email = '[the owner''s email]';
  ```

  It should answer `UPDATE 1`. Anything else means the email does not match
  the record, and the row wants finding by name first.

- **The legal name is blank.** It is printed on every invoice.
- **No sign-in account id.** Step 1 has not been done, or the User UID was
  not pasted in.
- **No sign-in account has that id.** The User UID was mistyped, or copied
  from a different project. Copy it again from **Authentication** →
  **Users**, beside the account made in step 1 — it is the User UID, not the
  email address and not the project reference.
- **The owner's name is blank**, or **the owner's email is blank.**
- **The time zone is not one Postgres knows** — a typo such as `Asia/Duabi`
  is refused rather than quietly deciding dates wrong.
- **A setting the practice must have did not arrive.** This one is not about
  anything the operator typed: it means the migrations on this project are
  incomplete or a trigger is switched off, and the message says which setting
  is missing. Nothing is written, and it wants a developer.

**What it deliberately leaves blank**, because only the owner holds these and
a placeholder that later reads as a fact is worse than a gap: the corporate
tax registration number, the trade licence number with who issued it and when
it lapses, the VAT registration, and the practice's own address. All of them
are typed once inside the app, under **Settings**, by the owner herself.
Until the address is entered there an invoice prints without a supplier
address, which is true rather than wrong.

### Step 3 — the secrets, then sign in

Nothing else touches the database. What remains is the wiring above: the
`mcwellness_api` password (step 1 of "What the operator must set by hand"),
the pooler connection string built from it (step 2), and the project's URL
and publishable key baked into the app's build, exactly as docs/STAGING.md
sections 5 and 6 describe for staging. Then open the app and sign in with the
email and password from step 1 of this section. The practice's name is on the
settings screen; the day is empty, because nothing has happened yet.

## Advisors, after the pass

**Security.** Thirty-two `INFO`-level `rls_enabled_no_policy` findings, every
one a bookkeeping or partition table carrying row level security by design
and no policy on purpose: `schema_migration`, `invoice_number_series`, the
twenty-five monthly `audit_log_*` partitions plus `audit_log_default`, and
three `app`-schema tables reached only through security-definer functions
(`app.audit_chain`, `app.erasure_active`). **From 2026-09-09 (migration 960) the setup-photograph objects are gone:** `app.setup_photo_filing`, `app.setup_photo_consent_active`, `app.file_setup_photo_document`, `app.file_setup_photo` and `app.previous_setup_photo`. A pass run after that migration should not expect to find them. This is
the same list, for the same reason, every staging pass has carried. Nothing
at `WARN` or above.

**Performance.** Three hundred and fifty-four findings, and every one is
either expected on an empty database or already known and unrelated to this
pass:

- 295 `INFO` `unused_index` — trivially true of every index in a database
  with zero rows and zero query traffic; not a finding about the schema.
- 52 `INFO` `unindexed_foreign_keys` — the same: nothing has run a query this
  advisory could judge yet.
- 6 `WARN` `auth_rls_initplan`, naming `assessment.assessment_record`,
  `appointment.scheduling_read_scope`, `visit_actuals.practitioner_scope`,
  `kit.kit_read`, `session.practitioner_scope` and
  `session_event.practitioner_scope`. Each policy resolves the acting
  practitioner with `current_setting('app.actor_id', true)` rather than
  `(select current_setting('app.actor_id', true))`, which Postgres
  re-evaluates per row rather than once per statement. This is a property of
  the policy files themselves (`db/policies/scheduling`,
  `db/policies/session`), present on every worktree's own database as much
  as here, not something this pass introduced or is positioned to correct —
  recorded for the operator and the trunk, not fixed in passing.
- 1 `INFO` `auth_db_connections_absolute` — the Auth server's own connection
  ceiling (ten), unrelated to this pass's schema work.

## Out of scope for this pass, on purpose

No seed, no demo visit, no synthetic row of any kind, no password set, no
user created. The next pass that gives this project a practice to run
against inherits an empty, schema-complete, checksum-verified database and
nothing else.

That next pass is written above, as "The first practice": the trunk's round
32 (docs/CHANGE-REQUESTS/trunk-notes.md) built `app.bootstrap_practice` so
the step is one statement rather than a hand-written sequence of inserts.
Building the door is the trunk's work; walking through it stays the
operator's, and this document still describes no key, no password and no
account that anyone but she creates.

## What was done on 2026-09-06: the second pass — the door itself, `app.bootstrap_practice`

Main had not moved since the first pass: still `f06e666` (pull request 95,
trunk round 32), the same commit the first pass already brought this project
level with. The one thing that had changed underneath it was the file this
pass exists to apply: `db/migrations/956_bootstrap_practice.sql`, the
function "The first practice" above describes and asks for.

- **The seventy rows already there were checked before anything was
  touched.** Every file's sha256, computed straight off the files on disk
  (`shasum -a 256`), matched the checksum production had recorded for it
  exactly — nothing merged since the first pass had edited a file already
  applied.
- **`956_bootstrap_practice.sql` was applied through Supabase's migration
  tool**, under the runner's own audit context (`app.reason` naming the
  file, a fresh `app.request_id`, both transaction-local, `db/runner/
  apply.ts`'s own shape), immediately followed by its own bookkeeping row
  carrying the sha256 of the file's own text
  (`db144edc006f6884463ec4cee42101250dcfa5e0bba9fa6000190dea2d0c745b`).
  `schema_migration` now holds **seventy-one rows**, one per file in
  `db/migrations`, the new one's checksum confirmed against the row
  afterwards.
- **`db/policies` has not changed since the first pass's own commit**
  (`git log 9cecbb2..HEAD -- db/policies` is empty), so nothing was
  re-applied. One hundred and thirty-nine policies still stand on `public`,
  unmoved.
- **No seed, no row, nothing called.** `tenant`, `app_user` and `client`
  still read zero rows, confirmed by query, not assumed. `app.
  bootstrap_practice` was not invoked by this pass or by anything it ran —
  the brief's own instruction, and the function's own advisory lock and
  one-practice check stand untested by this pass on purpose. The function
  exists now and nothing else about the project's data does.
- **The grants were checked, on both projects this migration reached.**
  `app.bootstrap_practice(text, text, uuid, text, text, text)` shows
  `execute` revoked from `public` and from `app_role` on both production
  and staging, `service_role` holding it on both (plus the function's own
  owner, `postgres`, which every function answers to regardless of an
  explicit grant), and neither `anon` nor `authenticated` appears for it on
  either project. Unreachable through the API, exactly as migration 956's
  own comment claims.
- **The audit chain still verifies**, `app.verify_audit_chain()` returning
  null before and after. `audit_log` stood at zero rows before this pass and
  stands at zero after it: creating a function is DDL, not a data step
  against a tenant that does not exist, so nothing here was ever going to be
  audited.
- **The schema fingerprint was taken again**, the same way the first pass
  took it: a fresh `pnpm db:reset && pnpm db:migrate` on the worktree
  `mcwellness-trunk-2` (its own database, port 5442), after `git fetch
  origin && git checkout -q -B fingerprint-check origin/main` there (the
  worktree was clean this time — no edit to set aside). Seventy-one
  migrations and twenty policy files applied cleanly to an empty database.
  Nine parts were compared, canonicalised and hashed inside the query
  itself, the first pass's own method: columns (1,221), constraints (530),
  indexes (471), triggers (290), policies (139), row-level security flags
  (72 tables), functions (83 — the one new one being `app.
  bootstrap_practice` itself), the table grants `app_role`, `anon`,
  `authenticated` and `PUBLIC` hold (106), and the same for function grants,
  keyed by function identity rather than `specific_name` as the first pass's
  own correction requires (47). Production matched the fresh local build
  exactly on every one of the nine, including physical column order.
- **Production and staging were also compared against each other on the
  same nine parts, and eight matched exactly.** The ninth — columns —
  matched in substance (every column identical in name, type, nullability
  and default; a comparison ordered by column name rather than physical
  position hashes the same on both, `2c82cd6d…`, 1,221 rows each) but
  differed when ordered by physical position, on exactly two tables:
  `schema_migration` (`checksum` sits second on production, third on
  staging) and `invoice` (`supplied_on` sits mid-table on production, last
  on staging). Both are measurement artifacts of how each project acquired
  its columns, not a schema difference: production's seventy pre-956
  migrations ran as one continuous bootstrap (the first pass), so a
  column's physical slot follows the file that added it in one unbroken
  sequence, while staging accumulated the same files across ten separate
  passes, where a column added by `alter table ... add column` after a
  same-named column had already been dropped and never reused its old slot.
  Nothing here is a difference this pass made or one migration 956 touches.
- **Advisors were checked after the migration.** Every `rls_enabled_no_policy`
  finding is the same list the first pass already carried and none of it
  is new: `schema_migration`, `invoice_number_series`, the twenty-five
  monthly `audit_log_*` partitions plus `audit_log_default`, and the three
  `app`-schema tables reached only through security-definer functions —
  thirty-one `INFO` rows, counted directly against `pg_class` rather than
  assumed. Nothing at `WARN` or above on production; staging carries the
  same thirty-one plus its own already-known leaked-password-protection
  `WARN`, unrelated to this pass. (Corrected 10 September 2026: the same
  `WARN` was on production too, and both were closed that night by switching
  leaked-password protection on — `docs/SECURITY.md`, "Switched on".)

Still out of scope, still on purpose: no seed, no demo visit, no password
set, no user created, and `app.bootstrap_practice` still uncalled. The door
this pass built is open; walking through it is still "The first practice"
above, and still the operator's own act.

## What was done on 2026-09-06: the third pass — the fee and the assessment door

Main had reached `6c99fac` (pull request 100, merged after 99 and 98) since
the second pass's own `f06e666` — thirty-eight commits, two migrations this
project did not yet have: `408_billing_call_out_fee.sql` (one call-out fee,
never a session, replacing 404's credit-consuming trigger whole) and
`503_assessment_document_roles.sql` (the assessment door's vocabulary:
`raw` renamed to `raw_recording`, `session_export` added, and a recording's
condition). `git log f06e666..HEAD -- db/policies` and `-- db/seed` are both
empty, so neither owed a re-apply.

- **The seventy-one rows already there were checked before anything was
  touched.** Every file's sha256, computed with Node's `crypto.createHash`
  and cross-checked with `shasum -a 256` against the files on disk, matched
  the checksum production had recorded for it exactly.
- **408 was applied first, then 503**, each through Supabase's migration
  tool, under the runner's own audit context (`app.reason` naming the file, a
  fresh `app.request_id`, both transaction-local), each followed immediately
  by its own bookkeeping row carrying the sha256 of the file's own text
  (`d2830c24…98916` for 408, `07a4a8c9…e1979` for 503). `schema_migration`
  now holds **seventy-three rows**.
- **Both functions' grants were checked afterwards.**
  `app.waive_call_out_fee(uuid, text)` and
  `app.file_assessment_document(..., assessment_recording_condition)` are
  granted to `app_role` and revoked from `public`, as their own files say.
  `app.next_invoice_number(uuid)` — the named-practice form the billing
  trigger calls — is granted to nobody but the function's own owner, exactly
  as 408's own comment demands; the no-argument form keeps 402's original
  `app_role` grant. `app.billing_on_appointment_charged()`, a trigger
  function, is granted to nobody.
- **The three new enum values are in place**: `invoice_kind` carries
  `call_out_fee`, `billing_exception_kind` carries `uncharged_call_out_fee`,
  and `assessment_document_role` reads `{raw_recording, vendor_report,
  session_export}` — the rename landed and the addition followed it.
- **No row was written.** `tenant`, `app_user` and `client` still read zero
  rows, confirmed by query. `app.verify_audit_chain()` returns null;
  `audit_log` stands at zero rows before and after, since two DDL files wrote
  no data against a tenant that does not exist.
- **The schema fingerprint was taken against a fresh `pnpm db:reset && pnpm
  db:migrate`** on `mcwellness-trunk-2` (its own database, port 5442), after
  `git fetch origin && git checkout -q -B fingerprint-check origin/main`
  there (the worktree was already clean). Seventy-three migrations and
  twenty policy files applied cleanly to an empty database. Nine parts were
  compared, canonicalised and hashed inside the query itself, the same
  method the first two passes used: columns (1,226 — five more than the
  second pass's 1,221, from `invoice`'s four new columns and
  `assessment_document`'s one), constraints (536), indexes (474), triggers
  (222), policies (139), row-level security flags (73 tables), functions
  (85, the two new ones being `app.waive_call_out_fee` and the two-argument
  `app.next_invoice_number`), the grants `app_role`, `anon`, `authenticated`
  and `PUBLIC` hold (106 table grants, 44 function grants keyed by function
  identity rather than `specific_name`). **Eight of the nine matched the
  fresh build exactly.** The ninth — columns, ordered by physical position —
  differed from the fresh build for the same reason the first and second
  passes already found and explained: production's migrations ran as one
  unbroken bootstrap, so a column's physical slot follows the file that
  added it in sequence, while a rebuilt-from-migrations database orders
  columns by when each `alter table` ran across the whole history. Ordered
  by column name instead, production's 1,226 columns hash identically to the
  fresh local build (`2aac01e9…7de`); nothing here is a schema difference.
- **No consent wording step.** No wording has been loaded onto production —
  the second pass's own account stands — so pull request 98's two wordings
  moving to `0.2-draft` had nothing to touch here. That step is staging's
  alone (docs/STAGING.md, this same date, twelfth pass).
- **Advisors were checked after the migration.** Thirty-two `INFO`
  `rls_enabled_no_policy` findings, the same list the first two passes
  carried (`schema_migration`, `invoice_number_series`, twenty-five monthly
  `audit_log_*` partitions plus `audit_log_default`, and the three
  `app`-schema tables reached only through security-definer functions),
  counted directly against `pg_class` rather than assumed. Performance
  carried 356 findings, all `INFO` but the same six pre-existing `WARN`
  `auth_rls_initplan` rows the first pass already named and unrelated to
  this pass's own files; the `unused_index` count rose from 295 to 297,
  which is the new indexes 408 adds (`invoice_appointment_idx`,
  `invoice_one_per_appointment`, `invoice_waived_by_idx`) reporting unused on
  a database with zero rows and zero query traffic — not a finding about the
  schema. Nothing new at `WARN` or above.

Still out of scope, still on purpose: no seed, no demo visit, no password
set, no user created, and `app.bootstrap_practice` still uncalled.

## What was done on 2026-09-07: the first live pass — the site answers

Between 23:00 on 6 September and 00:20 on 7 September (Dubai), on the
operator's instruction ("do the hostinger integration as i can not do it"),
the session placed the secrets and got the process running. No secret value
passed through the conversation: a script, `Documents/tools/go-live.py`
outside the repository, read the two API tokens already on the laptop, fetched
or generated every value, wrote them to one file readable by the operator alone
(`~/Documents/mcwellness-production-secrets.env`, to be moved into the password
manager and deleted), and sent them to the host.

**What was set.** The eleven public settings of the runbook, and:
`SUPABASE_STORAGE_KEY` and `SUPABASE_AUTH_ADMIN_KEY` (the service key, read
through the signed-in Supabase command-line tool), `API_DATABASE_URL` (a new
forty-character password set on `mcwellness_api` through the tool's own query
door, in the transaction-pooler form on port 6543), `IDENTITY_KEY` (freshly
generated, this system's own, never to change), and `GOOGLE_MAPS_API_KEY` with
`ROUTING_PROVIDER=google` (the practice's key, the operator's decision of 6
September). **`SUPABASE_JWT_SECRET` is deliberately not set**: the project
signs sign-ins with an ES256 key published at its JWKS address, which the API
already verifies against; the legacy shared secret signs only the old-style API
keys. If the runtime log ever says "HS256 is not configured", the secret is
added from the dashboard by hand.

**Three things stood between the secrets and a running process**, found in
order and each recorded so nobody rediscovers them:

1. **The site had to be its own website.** `app.mcwellnessuae.com` had been
   made as a folder-style subdomain of `mcwellnessuae.com`. Hostinger's
   documentation says a Node.js web app "must be deployed as a new website";
   a subdomain of that kind gets the build pipeline and never a runtime. The
   subdomain was removed (its document root was empty) and the name created
   as an addon website on the same order (`vhost_type: addon`, root
   `~/domains/app.mcwellnessuae.com/public_html`). Hostinger dropped the
   subdomain's CDN alias record with it; the `A` and `AAAA` records for `app`
   remain and point at the server directly, and the certificate was issued.
2. **The output directory must be the app root.** With `dist` as the output
   directory the host deployed nothing and wrote no routing file, and every
   address answered the web server's own 404. With `.` it deploys the whole
   root to `~/domains/app.mcwellnessuae.com/hbuilds/versions/<build>/nodejs`,
   writes the routing, and starts the entry file on the first request. The
   stored build settings now say `.`; `docs/RUNBOOK/go-live.md` is amended.
3. **The loader's helper program arrived without its execute bit.** The
   process then started and failed at once: `spawn
   node_modules/@esbuild/linux-x64/bin/esbuild EACCES`, nineteen times. The
   entry file `app/api/start.mjs` now restores the bit before registering the
   loader, and falls back to a copy in the temporary directory if the tree
   refuses execution (pull request 106, branch `hosted-start-2`, proved on the
   laptop with the bit removed). **Production runs commit `5ed7702`, one
   ahead of `main`**, until 106 merges.

**The checks.** `GET /api/health` answers `{"ok":true,"service":"mcwellness-api"}`;
`GET /api/health/deep` answers `{"ok":true}` — the API reaches the database as
`mcwellness_api` through the pooler; `GET /` serves the built app. The runtime
log shows the four start-up lines and nobody's data. Two things the log also
shows: the port prints as `undefined`, because the host intercepts the listen
call and hands the process its own socket, so `PORT` is neither set nor
needed; and the process is started on demand and stopped after a short idle
period (the start-up lines repeat every fifty seconds under a probe every ten),
which is the runbook's section 5 exactly — each cold start took about a second
and the deep check passed on the first one.

**Still to do on this pass.** `TRUSTED_PROXY_HOPS` stays at `1` and is not yet
measured (the method: exhaust a rate-limited route from one address, then
repeat with a spoofed `X-Forwarded-For`; a fresh budget for the spoof means
the count is too high). **The first practice is created** (00:30, 7 September, on the operator's
next message): the founder's sign-in account was made with a strong generated
password and confirmed, so no email was sent; `app.bootstrap_practice` ran
with the practice's legal name in English and Arabic, her account id, her
first name and her email, and answered with the practice's and the owner's
ids; then a sign-in as her returned an ES256 token and `GET /api/practice`
on the live address answered 200 naming the practice. Her email and password
are two lines in the secrets file for the password manager. The Hostinger vendor row in `docs/COMPLIANCE/approved-vendors.md`
still waits for the operator's tick.

**The sign-in round, deployed (02:00, 7 September).** On the operator's request
at 00:43 the sign-in page gained a show-or-hide button on the password and a
"Keep me signed in on this browser" box (pull request 107, branch `signin-2`,
stacked on 106; reviewed, fixed and re-checked under the usual rules, the
record on the pull request). Production now runs `dd90787`: `main` plus 106
plus 107, until both merge. Two things learned on this deploy: Hostinger's
deploy tool uploads an archive and starts a build with settings it guesses
from `package.json` (pnpm, `dist/index.js`), which fails harmlessly, and the
explicit build then runs against the same uploaded archive; and for about
twenty minutes after two builds in a row the site answered slowly (a shallow
health request took over two minutes, no error in the log, the process never
restarting), then returned to under two seconds, which was then traced to something
else: **Hostinger's CDN does not answer over IPv6 from this network** (the
name's IPv6 addresses are the CDN's, and a connection to them waits 150
seconds and fails; the sibling `intake` site fails the same way, while Google
answers over IPv6 in under a second, so the laptop's IPv6 is sound). Over
IPv4 the site answers in about a second. A browser races both and settles on
IPv4 within a fraction of a second, so people are unaffected; a tool that
tries IPv6 first and waits sees the stall. Nothing in the zone to change (the
CDN overrides the `app` records it serves); worth a line to Hostinger. The name now resolves to
Hostinger's CDN edge (`server: hcdn`), so the CDN is in the path again and
`TRUSTED_PROXY_HOPS` is still to be measured with that in mind.

## What was done on 2026-09-07: the second live pass — the trunk rounds land and the process runs `main`

Between 02:50 and 13:12 on 7 September (Dubai), on the operator's
instructions ("Make the repo public", then "lets finish whatever is opened",
then "keep going with the migration"), the five pull requests that had been
reviewed and waiting were merged, the two migrations they added were applied
to production, `TRUSTED_PROXY_HOPS` was measured, and the process was rebuilt
from `main`.

**Why the merges had waited, and how they were freed.** Every GitHub check on
the repository had been refused since 6 September 13:03 UTC — not a code fault
but the account's 2,000 free Actions minutes, spent for the month. On the
operator's instruction the repository was made public (public repositories get
unlimited Actions), after the whole history was scanned for secrets and personal
data first: 786 commits and 3,466 blobs, the project's own
`scripts/audit-secrets.mjs` patterns, nothing live and no real personal data —
every connection string a documentation placeholder, every licence and
registration identifier synthetic. Checks ran again at once.

**The five merged, in order, each on its own green run:** 103 (trunk round 33),
104 (the evening hand-over), 106 (the hosted-start fix), 107 (the sign-in
options), and 105 (trunk round 34). 105 was stacked on 103, so after 103 landed
it was retargeted to `main` and rebased onto it — the reviewed `442f25c`
replayed as `a5f128b`, fifteen commits with no conflict, pushed once with
`--force-with-lease`, its own run green — before its merge. `main` is at
`e6d08ae` and its own `verify` run is green; no pull requests remain open.

**The two migrations these rounds added — 205 and 957 — applied to production**
(project `ipiluvnlnzdbolbqwtpl`), staging taken first. Each was applied through
Supabase's migration tool as the file's own DDL followed by its bookkeeping row
`insert into schema_migration (filename, checksum) … on conflict do nothing`, so
the runner records them exactly as `pnpm db:migrate` would:

- `205_unfit_fee_is_the_call_out_fee.sql` — a `comment on column` on
  `scheduling_setting.unfit_fee_fils`, bringing the note up to what migration
  408 now charges. Checksum `84d44a08…`.
- `957_vat_taxable_supplies_excludes_waived.sql` — `create or replace function
  app.vat_taxable_supplies_fils(date)` with one added clause, `and i.waived_at
  is null`, so a forgiven call-out fee no longer counts towards the AED 375,000
  VAT registration threshold. Checksum `dd609894…`. `create or replace` keeps
  953's grants; verified afterwards that the installed body carries the clause.

Both are DDL only and wrote no data, so the practice's rows and
`app.verify_audit_chain()` were untouched.

**The whole schema was then reconciled, not just the two new files.**
`schema_migration` holds **seventy-five rows** on production and seventy-five on
staging — every migration on `main`, no gap and no extra. A single digest over
all seventy-five `(filename, checksum)` pairs is
`md5 = 8d3ce8c49bca45a65172baa25cca2bbd` on production, the same on staging, and
the same computed from `main`'s files on the laptop. So every recorded checksum
matches the committed file byte for byte in all three places: production,
staging and `main` are in lockstep, and a later `pnpm db:migrate` against either
database finds nothing pending and no mismatch.

**`TRUSTED_PROXY_HOPS` was measured and stays `1`.** By the method this doc's
first live pass named: a rate-limited route was drawn down from one address
while watching the `RateLimit-Remaining` header, then again with a spoofed
`X-Forwarded-For` and with a two-hop spoof. The spoof never bought a fresh
budget (297, 296, 295, 294, 293 across the attempts), so the count is not too
high; and the draw-down was exactly one per request with no other traffic
interfering, so the limiter keys on the real client address and not a shared
upstream, so it is not too low. One is right; nothing changed.

**The process was rebuilt from `main`.** An archive was built with `git archive
--prefix=mcwellness/ origin/main` (tracked source only, no `node_modules`, about
5.2 MB), uploaded over TUS, and built with the proven settings (root
`mcwellness`, output `.`, entry `app/api/start.mjs`, npm, Node 24, build
`build:production`; Hostinger build `01a07b21`). `GET /api/health` and
`/api/health/deep` answer `{"ok":true}`; `GET /` serves the app; the owner's app
renders (Shauna, Owner; practice set up, no clients yet). The served bundle
`index-CaQ0rorp.js` carries what the rounds added and the old bundle lacked: the
five Arabic band names, the portal "Waived" line, the audit screen's "who has
opened" one-press, and 107's sign-in options. Production is now level with
`main`; the earlier note that it ran a side branch no longer holds.

**Still to do on this pass.** The Hostinger vendor row in
`docs/COMPLIANCE/approved-vendors.md` still waits for the operator's tick; the
IPv6-edge stall is still the CDN's and worth a line to Hostinger; and the deep
security scan against the first release tag matters more now that the code is
public.

## What was done on 2026-09-07: the third live pass — the books' six migrations, and the process runs `main` again

Between 18:28 and 18:50 on 7 September (Dubai), on the operator's word ("lets
go live"), piece eleven's six migrations were applied to production and the
live process was rebuilt from `main` at `727310e`, so app.mcwellnessuae.com
now carries Books.

**The six migrations, applied first** (project `ipiluvnlnzdbolbqwtpl`; staging
had carried them since the afternoon's fourteenth pass). Before anything,
`schema_migration` held seventy-five rows against eighty-one files on `main`,
and the six missing were exactly `450_accounting_setting.sql`,
`451_account.sql`, `452_fiscal_year.sql`, `453_journal.sql`,
`454_unposted_money_events.sql` and `958_bootstrap_knows_the_books.sql`;
`tenant` held one row and `audit_log` twenty-six. Each file went through
Supabase's migration tool as one call: the runner's audit context
(`app.reason` naming the file, a fresh `app.request_id`), the file's text
unchanged, then the bookkeeping row `insert into schema_migration (filename,
checksum) … on conflict do nothing` with the sha256 computed on the laptop
(450 `daa3baa6…`, 451 `1e575bad…`, 452 `67273091…`, 453 `8c11bdad…`, 454
`5d5657df…`, 958 `f6895f86…`, each identical to the staging record's). All six
succeeded first time, in order; then the twenty-two policy files were
re-applied in one transaction under `app.reason = 'policies'`, as the runner
does. The pass ran on Sonnet from a written brief, about 0.23 million tokens.

**What the two data steps wrote to the practice.** 450 gave the one practice
its `accounting_setting` row: books start on 2026-09-07 (the day the practice
was created), year end 31 December, no lock, corporate tax 9% above AED
375,000, Small Business Relief elected with the AED 3,000,000 watch, next entry
number 1. 451 gave it sixteen accounts with twelve roles, codes 1010 to 6200 as
`docs/SPEC/accounting.md` section 4.1 lists. `audit_log` gained exactly
seventeen rows — one reasoned `migration 450_accounting_setting.sql`, sixteen
reasoned `migration 451_account.sql` — and stands at forty-three;
`app.verify_audit_chain()` returns null (the chain verifies). No personal
column was read at any point: every check was a count, a catalogue read, or a
row of the two new tables, which name nobody.

**The whole schema reconciled again.** `schema_migration` holds eighty-one rows
on production, eighty-one on staging, eighty-one files on `main`; the digest
`md5(string_agg(filename || ' ' || checksum, E'\n' order by filename collate
"C"))` is `ddb7a8c2056ba457c1892537b5bb66bc` in all three places. The catalogue
fingerprint of production equals staging's count for count: 1,280 columns, 601
constraints, 501 indexes, 155 policies, 95 functions in `app` and `public`, 240
triggers, 74 tables with row security. The ten new `app` functions exist;
`execute` on `app.unposted_money_events()` and `app.fiscal_year_for(date)` is
held by `app_role` and the owner only; the five accounting tables have row
security on and the five policies where the spec puts them, and `app_role` may
delete from none of them. `app.bootstrap_practice` now names both new
per-practice defaults.

**The process was rebuilt from `main`.** An archive of `origin/main` at
`727310e` (`git archive --prefix=mcwellness/`, tracked source only, 5.6 MB) was
uploaded over TUS as `mcwellness-727310e-npm.tar.gz` and built with the stored
settings (root `mcwellness`, output `.`, entry `app/api/start.mjs`, npm, Node
24, `build:production`). The first start request came back as a 500 from
Hostinger's API and created no build; the archive was confirmed present and
readable (the host's own settings detection read its `package.json`), and the
second request created build `01a07c56`, which completed in fifty-five seconds
(18:47:39 to 18:48:34). The served bundle changed from `index-CaQ0rorp.js` to
`index-CW0A6csP.js` eighteen seconds later; `GET /api/health` and
`/api/health/deep` answer `{"ok":true}`; the runtime log shows the start-up
lines for three cold starts, no error and nobody's data. The new bundle carries
the Books page and its call to `POST /api/accounting/post`. Every API path
refuses an anonymous caller with 401 before routing, so no unauthenticated
probe can tell a mounted route from an absent one; the route's presence rests
on the merged code and its tests, which is the same footing every earlier
route stood on.

**What happens next, by design.** The books on production are empty. The first
time the owner opens Books, the page asks the API once to post everything
billing already holds — every issued invoice, payment, and credit consumed,
waived or expired — into the journal under the posting rules of
`docs/SPEC/accounting.md` section 7. The books start on 7 September, the
practice's own first day, so nothing predates them and the start day needs no
change. The nightly catch-up (`pnpm job:post-books`) is not scheduled on
Hostinger; the page's own posting covers a practice with one owner until a cron
job is added.

**Still to do on this pass.** The three the second live pass left: the
Hostinger vendor row awaits the operator's tick; the IPv6-edge stall is the
CDN's and worth a line to Hostinger; the deep security scan against the first
release tag. New: a cron job for the nightly poster, and the tax adviser's
confirmation of the Small Business Relief election (`docs/HANDOVER.md`,
section 8).

## What was done on 2026-09-07: the catalogue loaded — the price list of 7 September

At 19:07 on 7 September (Dubai), on the operator's instruction ("i need it
ingested to my database", 18:57, with the practice's price-list PDF) and their
four answers (the PDF's 15% figures, not the 20% the message said; five service
types; no certification requirement for now; load it now), the practice's
opening catalogue was written to production in one transaction, as a data step
through the Supabase tools, under the audit reason "Price list of 7 September
2026, launch pricing; ends on the founder's word." and with no author recorded,
the way the migrations' own data steps write. The script is
`~/Documents/mcwellness-catalogue-2026-09-07.sql` on the operator's laptop,
outside the repository; a second run fails on the unique keys, so it cannot
double-load.

Production had no service type, price or package before this. The app lists
service types but does not create them, so this could not have been typed in;
the seed generator (`db/seed/generate.ts`) already carried the same catalogue
in the founder's decisions of 3 September, and its shapes were copied.

- **Five service types**, `requires_certification` null on all (the operator's
  choice for now; the seed's QEEG-vendor and BCIA gates can be switched on
  later): discovery call (60 minutes, remote), consultation (45, home or
  remote), brain map (QEEG) (90, home), results call (30, remote),
  neurofeedback session (60, home, carrying the seed's five-item pre-session
  checklist and three 0–10 ratings as drafts to edit in Settings).
- **Five prices** valid from 7 September, VAT stamped at 500 basis points from
  setting version 1: brain map AED 825, neurofeedback session AED 700;
  discovery call, consultation and results call AED 0, each with a reason
  saying it is included or free and never billed — a zero price, not a
  missing one, so delivering them raises no billing exception.
- **Three packages**, twelve months' expiry, the list price stored as the
  "normally" figure and the launch price as the selling price, no percentage
  stored anywhere (401's rule): Silver, 1 consultation + 2 brain maps + 15
  sessions, list AED 12,150, launch AED 10,325; Gold, 2 + 3 + 25, list 19,975,
  launch 16,975; Platinum, 3 + 4 + 40, list 31,300, launch 26,605. The launch
  figures are the PDF's own, rounded to a five where 15% is not exact.
- **Read back**: five service types, five prices, three packages with nine
  components and three package prices; twenty-five audit rows carry the
  reason; `app.verify_audit_chain()` verifies. The practice is not
  VAT-registered, so these amounts are what clients pay; 5% goes on top once
  it is.

**Left to the founder, in the app.** Her practitioner row and credentials
before the first assignment; the certification requirement when she wants it;
the launch prices superseded with a reason when the launch ends; Compassionate
Inquiry added when it has a price.

## What was done on 2026-09-07: the fourth live pass waits — round 35 merged, the rebuild refused in auto mode

At 20:20 trunk round 35 merged as pull request 114 (`main` at `9fc6cb5`):
the console and the practitioner app are English only, on the operator's
decision of 19:37; the portal and the documents stay bilingual. **No
migration, no policy, no data change**, so nothing in this database moves for
it; the live process alone needs rebuilding.

The same recipe as the third pass was started at 20:25: the archive built
from `origin/main` (`git archive --prefix=mcwellness/`, 5.65 MB), the upload
URL issued, and then the auto-mode classifier refused the TUS upload (the
`curl` carries the upload's auth headers). Per the standing rule the step is
retried outside auto mode and never routed around. **Until it is, the live
process still runs `main` at `727310e` (bundle `index-CW0A6csP.js`)** and the
staff screens on app.mcwellnessuae.com still show Arabic beneath English.

**To finish the pass, outside auto mode:** build the archive from `main` at
`9fc6cb5` or later; `hosting_generateUploadURLV1`; the two `curl` calls (POST
then PATCH) with `-4` and a User-Agent; `hosting_startNode_jsBuildV1` with the
stored settings (root `mcwellness`, output `.`, entry `app/api/start.mjs`,
script `build:production`, npm, Node 24, `source_type` archive) — a first 500
from that call creates no build, call it again; watch the served bundle name
flip with `curl -4`; then `/api/health` and `/api/health/deep`, and the
clients table or the Settings page signed in as the founder to see no Arabic
line. Record it here as the fourth live pass. *(It was finished at 20:26 the
same evening; the next section is its record, carried from pull request 116
by trunk round 41.)*

## What was done on 2026-09-07: the fourth live pass — VAT follows the registration on the Billing screens

Between 19:23 and 20:26 on 7 September (Dubai), on the operator's instruction
("toggle off the VAT … keep it in the build but toggled off", then "do it"), the
practice's VAT position was confirmed and a defect found beside it was fixed,
merged and deployed.

**VAT was already off, by design.** `tenant.vat_registered` is false on
production; every sale resolves VAT through `resolveSaleVat` from
`app.tenant_charges_vat()` (migration 406), so an invoice carries no VAT, names
no rate and shows one AED figure, and `app.guard_invoice_vat` refuses any
invoice that says otherwise. The catalogue's prices are net; registering later
adds five per cent on top of the same net prices and changes nothing already
issued. The switch lives in Settings, Practice ("Registered for VAT"), and
refuses to save without the fifteen-digit registration number.

**The defect.** `app/api/billing/prices.ts` and `packages.ts` computed the
`vatFils` and `grossFils` they returned at the row's stamped standard rate
whatever the registration, and the Sell drawer sends the API's gross as the
payment taken at the point of sale. Selling Silver with payment ticked would
have recorded AED 10,841.25 against an invoice of AED 10,325 and left a five
per cent overpayment on the family's balance. Beside it, the Billing page's
price list and packages table showed a five per cent VAT column and a total
including it, and two sentences in Settings said the switch "does not change
what an invoice charges", untrue since 406.

**The fix** (pull request 113, branch `billing-vat-display`, merged as
`52fc1a9` at 20:21; the builder on Opus from a written brief, about 0.27
million tokens; the integrator's review in conversation and three small
commits of its own). `app/api/billing/supplier.ts` reads the registration once
per request; both catalogue routes resolve the money with `resolveSaleVat` at
the row's own stamped rate and return the stamp untouched; `PricesResponse` and
`PackagesResponse` carry `vatRegistered`; both tables show one line while it is
false ("The practice is not registered for VAT, so no VAT is charged and the
total is the price"); the Sell drawer names its percentage only while something
is charged at it; both Settings sentences now say what the switch decides
(`docs/CHANGE-REQUESTS/billing-07.md`, both items applied before the merge).
The proof: `tests/billing/db/packages.test.ts` sells Gold sending exactly the
catalogue's gross and finds the payment equal to the invoice and the balance
zero. Gates green on the builder's head, including the whole database suite
(1,211 tests); the integrator's first test commit went up red because a piped
`tail` hid the exit code, and a formatting miss followed — both corrected on
the branch, checks green on the final head.

**The process was rebuilt from `main`** at `52fc1a9`: archive
`mcwellness-52fc1a9-npm.tar.gz` (5.7 MB) over TUS, build `01a07caf` with the
stored settings, completed in two minutes two seconds (20:24:16 to 20:26:18);
the served bundle changed from `index-CW0A6csP.js` to `index-BdMsUpd4.js` and
carries the new sentence; `GET /api/health` and `/api/health/deep` answer
`{"ok":true}`; the runtime log shows no error or warning. No migration in this
round, so the database was not touched.

**Left as a decision, not built.** `POST /api/billing/package-purchases`
records whatever `payment.amountFils` it is sent; with this round the drawer's
figure equals the invoice, but an API caller could still record an overpayment
silently. Whether the route should refuse a mismatch, warn, or allow it (part
payments would then need their own rule) is the operator's to decide;
`tests/billing/db/idempotency.test.ts` still carries an overpayment fixture
and is the natural place to prove whichever rule is chosen.

## What was done on 2026-09-08 and 2026-09-09: live passes five to eleven

Seven more rebuilds of the live process, recorded here by trunk round 41 from
the sessions' own notes, because each was done by hand and none had been
written into this file. **Times in this section are UTC**; Dubai is four
hours ahead, and the operator's own clock (the one the sessions' timestamps
and the headings dated 2026-09-10 below use) is eight hours ahead. The
recipe was the third pass's every time: `git archive --prefix=mcwellness/
origin/main | gzip -9`, TUS upload, `hosting_startNode_jsBuildV1` with the
stored settings, then the served bundle name polled with `curl -4` until it
flipped, then both health routes. Every migration named was applied to
production before the build that needed it, one at a time with its ledger
row, so a build that hung would have left a correct schema behind.

- **Fifth, 8 September 11:28–11:31 UTC.** `main` at `ba478fa` (pull request
  130, piece twenty: the practice's colour, the mark, the full-width console
  and the pinning sidebar). Build `01a080c7`; bundle `index-BeqsYANG.js` with
  `index-CqfcCS09.css`, the stylesheet hash matching a local `pnpm build`
  exactly, which is the cheapest proof the right tree shipped. No migration.
  Clean, and the first pass the auto-mode classifier did not refuse at the
  upload step.
- **Sixth, 8 September 12:54–13:02 UTC.** `main` at `a44ae2d` (pull requests
  131 and 132: the harmonised neutrals and the household's portal as an
  application shell). No migration. **The build completed and the site was
  dead for six minutes**: every request timed out at 25 s while TCP connected
  at once, the runtime log showed a clean start and nothing after it, and the
  sibling site on the same account answered in under a second, which is what
  placed the fault in this process rather than the network.
  `hosting_restartNode_jsApplicationV1` cured it on the first poll. **A
  completed build is not a serving app**: after every build, check health and
  restart if it hangs. The origin's addresses had also moved since the morning;
  re-resolve before any `--resolve`, because a stale address times out exactly
  as a hung app does.
- **Seventh, 9 September 05:50–05:56 UTC.** `main` at `df87023` (pull request
  133, the compact tier walked). No migration, no restart needed; the bundle
  took about 80 s to flip after the build, so poll the bundle name rather
  than trusting a 200 from health, which can still be the previous build.
- **Eighth, 9 September 15:20–15:27 UTC.** `main` at `1eb7cf5` (pull request
  134, the approved wording: the advisor's four recommendations and the
  photograph retired), by session mcwellness-93. Migrations 915, 960 and 961
  first, each verified; then the `documents` storage bucket, which
  **production had never had** (so every consent signature upload would have
  failed since go-live; nothing was lost because no consent had been taken);
  then the wording rows and bytes under the real practice; then the build.
  Bundle `index-CwClJgCs.js` → `index-ByYGKqZl.js` about 65 s after the start
  call; the stylesheet hash unchanged, as a round that touches schema and copy
  and no styles should leave it. `schema_migration` 89 of 89. The origin's
  addresses had moved again. A test enrolment was walked and erased.
- **Ninth, 9 September 16:43–16:50 UTC.** `main` at `6387a30` (pull request
  135, the enquiries). Recorded in the section headed 2026-09-10 below, which
  is the same evening on the operator's clock: migration 916, the four
  `enquiry` policies, build `01a0870f`, bundle `index-CAWv1yV5.js`.
  `schema_migration` 90 of 90. **The count is the evidence, not the maximum
  filename**: 916 sorts before 961, so `max(filename)` did not move.
- **Tenth, 9 September 18:38–18:42 UTC.** `main` at `6e2cd20` (pull request
  136, the completeness audit's fixes: Settings › Team, the contact details,
  the in-process scheduler, the uptime probe). Migrations 917 and 962 with
  their ledger rows, `schema_migration` 92 of 92. Build `01a08778`; bundle
  `index-k3jZFJR_.js` with `index-C0329E7s.css`. **The process now runs the
  scheduler** (`app/api/scheduler.ts`): the books posted at 03:00 Asia/Dubai
  and the erasure sweep hourly, so any second instance on the same database
  must set `SCHEDULER=off` (`docs/SPEC/hosting.md`). Verified from a second
  session afterwards: both health routes 200 in about a third of a second, the
  served bundle as named.
- **Eleventh, 9 September 19:37–19:41 UTC.** `main` at `8c44acc` (pull
  request 138, trunk round 40: change your password). No migration; ledger
  still 92 of 92. Build `01a087ad`; bundle `index-DmtijWVz.js`. Both health
  routes green.

**Two sessions, one host.** Two of these passes were done while another
session was working on the same repository. A build started while another's
archive sits in `public_html` destroys that archive with no error and no log,
so before every upload the deploying session lists the other sessions on the
machine and sends a hold message, and releases it when the bundle has flipped.

**The host's IPv6 edge does not answer.** A client that tries IPv6 first stalls
about 150 s before falling back to IPv4; browsers cope, `curl` does not, so
every probe here is `curl -4`. It is Hostinger's CDN and not this process; a
line to Hostinger is the operator's to send (`docs/OPERATOR/2026-09-10-decisions.md`).

## What was done on 2026-09-10: the enquiries live, and the completeness audit's fixes

**The enquiries round** (pull request 135, `main` at `6387a30`): migration 916 applied at 16:43 UTC with its ledger row (sha256 `24dd1d11…`), the four `enquiry` policies applied, the process rebuilt (build `01a0870f`, served bundle `index-CAWv1yV5.js` with `index-ZBZu5Mhp.css`, the CSS hash matching a local build exactly), the door verified live — a preflight from the site's origin answered 204, a honeypot post answered `{"ok":true}` and wrote nothing, an unsigned GET met the fence with 401 — and the website's twenty-two pages redeployed with their `ENDPOINT` on `https://app.mcwellnessuae.com/api/enquiries`. One enquiry submitted through the live page in a browser landed as a `new` row within a second (a synthetic person, a reserved test number) and was left for the operator to dismiss from the screen. The old project's `lodge_enquiry` is untouched: it is the revert path until real submissions have landed.

**The completeness audit's fixes, the same night**, each as an act on the live system and the rest as pull request 136:

- The founder's account holds `lead_practitioner` alongside `owner` (one audited insert into `user_role` under her own id, reason recorded), so the practitioner side opens for her.
- The practice's logo is filed and its telephone, email and website are set, through the API under her account (`scripts/practice-brand.mjs`); the three fields are now on Settings › Practice too.
- The host's environment no longer holds `FOUNDER_EMAIL` and `FOUNDER_PASSWORD`, which the app never read; `go-live.py --env-only` now skips them, and the process was restarted with both health routes green.
- The off-site weekly backup is live: project `mcwellness-backups` (`ap-southeast-1`), role `mcwellness_backup` on production, three repository secrets, first dump filed by hand (`docs/SPEC/hosting.md` section 6).
- The vendor register approves Hostinger, adds Web3Forms (the website's form-to-email path, kept by the operator's decision) and notes the GitHub uptime probe; Better Stack remains the recommended upgrade.
- Settings › Team, the in-process scheduler (migration 917) and the uptime probe reach production with the next rebuild.

**The Google keys, 02:55**, from the Google Cloud CLI signed in on the operator's laptop (`docs/SPEC/route-planning.md` section 8.5): the browser key admits the Maps JavaScript API from `https://app.mcwellnessuae.com/*` alone; the server key admits the Routes API and Maps Static, the two products `app/api/_middleware/routing/google.ts` calls, and no longer Geocoding (a request answers `REQUEST_DENIED`); the project's daily caps are 500 map loads (`maps-backend.googleapis.com/billable_default`) and 3,000 route-matrix elements (`routes.googleapis.com/compute_route_matrix_elements`), set as quota overrides. One route-matrix call and one static map answered on the server key afterwards. The two keys the old app's Firebase project created are untouched and belong to it.

**Left with the operator:** registering the amplifier, laptop and electrode set under Settings › Kit with the amplifier's calibration date.

## What was done on 2026-09-10: the twelfth live pass — trunk round 41, the loose ends

At 21:23 UTC on 9 September (01:23 on 10 September in Dubai; 05:23 on the
operator's clock), on the operator's word ("go live"), the live process was
rebuilt from `main` at `05d5358` (pull request 139, trunk round 41). **No
migration, no policy, no data change**; `schema_migration` stays at 92.

**The recipe, as the third pass wrote it.** No other session was running, so
the hold protocol needed no message. `git archive --prefix=mcwellness/
origin/main | gzip -9` (6,139,977 bytes, sha256 `dc5e1b45…`); TUS create 201
and PATCH 204 with the offset equal to the size; `hosting_startNode_jsBuildV1`
with the stored settings, 200 first time: build `01a0880d`, created 21:23:12,
completed 21:24:07. The served bundle flipped from `index-DmtijWVz.js` to
`index-CYEXN7VE.js` at 21:24:09, with `index-Cuv2GmjJ.css`; the stylesheet
hash matches a local `vite build --mode production` of the same tree exactly
(the script hash does not, and is not expected to: the browser key and the
Supabase address are baked in from the host's own environment). No restart
needed: `/api/health` 200 in 0.30 s and `/api/health/deep` 200 in 0.70 s on
the first poll after the flip.

**What the served bundle proves.** Fetched at its own path (a nonsense asset
path answers 404, so the 200 is evidence): no `rail__item--later`, no
"Arriving", no Sessions icon; `/portal/password`, the Arabic "تغيير كلمة
المرور" and "كلمة مرورك" present. **The door's header reaches the browser**: a
preflight to `/api/enquiries` from `https://mcwellnessuae.com` answers 204 with
`access-control-allow-origin` echoing the site and
`cross-origin-resource-policy: cross-origin`, while `/api/health` still
carries `same-origin`. The edge passes this header through, unlike the content
security policy it replaces.

**Left as it was.** The archive `mcwellness-05d5358.tar.gz` in `public_html`
beside the earlier ones. Production is level with `main`.

## What production owed as of 2026-09-10, 15:30 on the operator's clock (paid by the thirteenth pass below)

Production runs `main` `05d5358` (the twelfth pass). `main` is now `4f89a46`:
trunk round 42 (the enquiry "Waiting N days" chip, the check-in gate for a
visit not yet confirmed, the assessments "coming soon" mark; no migration) and
piece twenty-two, the dispatcher's board (pull request 147; **migration 210**,
`appointment.reassigned_from_practitioner_id` with its check and partial
index). The recipe is the one above; the migration goes to the production
project through `apply_migration` in the seventeenth staging pass's shape
(`docs/STAGING.md`), outside auto mode if the classifier refuses the write,
then the archive, the upload, the build and the bundle poll, then a restart if
the health check hangs. **Nothing here happens until the operator says so.**

## What was done on 2026-09-10: the thirteenth live pass — trunk round 42, the dispatcher's board, migration 210

At 07:51 UTC on 10 September (11:51 in Dubai; 15:51 on the operator's clock),
on the operator's word ("Go live now"), the live process was rebuilt from
`main` at `c4ecea0` — trunk round 42 (pull request 144), piece twenty-two,
the dispatcher's board (pull request 147), and the two records (146, 148).
**One migration:** 210, `appointment.reassigned_from_practitioner_id` with
its check and partial index, applied to the production project first.

**The migration, first.** `schema_migration` read 92 rows, last
`962_erasure_guard_admits_the_sweep.sql`; `appointment` held 0 rows, so the
column, the check and the index touched nothing. Applied as one
`apply_migration` call in the runner's shape (the transaction-local audit
context with `app.reason = 'migration 210_appointment_reassigned_from.sql'`
and a fresh `app.request_id`, the file's full text, the bookkeeping row with
the file's sha256
`61da0bc1f9a8d3386fe555d417f29d10cc1b556db69e4ac4eea35ed7caf6d1c1`), first
try. Read back: **93 rows**, the row's checksum equal to the file's, the
column, the constraint `appointment_reassigned_implies_rescheduled` and the
index `appointment_reassigned_from_practitioner_idx` present. No policy file
changed since the twelfth pass, so none was re-applied.

**The recipe, as the third pass wrote it.** Hold protocol: one peer session
(`mcwellness-cf`) was running and acknowledged the hold before the upload.
`git archive --prefix=mcwellness/ origin/main | gzip -9` (6,247,527 bytes,
sha256 `f217789d…`), carrying `db/migrations/210_*`; TUS create 201 and PATCH
204 with the offset equal to the size; `hosting_startNode_jsBuildV1` with the
stored settings (read back identical): build `01a08a4d`, created 07:51:50,
completed 07:52:43. The served bundle flipped from `index-CYEXN7VE.js` to
`index-ejvQq2uB.js` with `index-iaBRRWeR.css` within the first minute. No restart
needed: `/api/health` 200 in 0.33 s and `/api/health/deep` 200 in 0.41 s on
the first poll after the flip.

**What the served process proves.** `GET /api/appointments/board?date=…` and
`POST /api/appointments/:id/reassign` answer 401 to a stranger (the routes
exist; before this pass they were 404), `/admin/schedule/board` serves the
console document, and `/api/enquiries` still answers 401.

**Left as it was.** The archive `mcwellness-c4ecea0.tar.gz` in `public_html`
beside the earlier ones. Production is level with `main`: 93 migrations.

## What was done on 2026-09-10: the fourteenth live pass — trunk round 43, the walk's fixes

At 18:31 UTC on 10 September (22:31 in Dubai; 02:31 on the operator's clock),
on the operator's word, the live process was rebuilt from `main` at `a03a0fc`
— trunk round 43 in four pull requests (150, 153, 154, 155), the package terms
(151) merged earlier the same day, and the console's code split (152).
**Three migrations:** 410, 411 and 963, applied to the production project
first.

**The migrations, first.** `schema_migration` read 93 rows, last
`962_erasure_guard_admits_the_sweep.sql`. Applied one at a time in the
runner's shape (the transaction-local audit context, the file's statements,
then the bookkeeping row with the file's own sha256):
`410_package_terms.sql` (`d4581ea4…`), `411_billing_single_session.sql`
(`79b5e3d0…`) and `963_backfill_primary_location.sql` (`d00c4e77…`). Then the
two policy files this round changed, `db/policies/billing/ledger.sql` and
`db/policies/portal/money.sql`, re-applied as the runner re-applies every
policy file on each run. Read back: **96 rows**, each checksum equal to its
file's.

**Proved rather than assumed.** The affected tables' schema — every column,
constraint, index, policy, trigger and the `invoice_kind` enum across
`client`, `location`, `package`, `package_extension` and `invoice` — was
fingerprinted on production and compared against a freshly migrated local
database: **`237b902727b5743f6a3d2b6065a57fa7`, 221 items, identical**, and
identical to staging's. The first production fingerprint read 217; the four
missing items were `package_extension`'s policies, which live in policy files
rather than in the migration, and applying them closed the gap exactly.

**963 refused on staging, and that was the point.** Staging's tenant carried
two locations both flagged `is_primary` — a `studio` and a `base`, both seeded
on 2026-09-03, before `913_practitioner_base.sql` existed — so the file's
pre-flight check raised rather than let `create unique index
location_one_primary_per_owner` fail with a bare duplicate-key error. It named
the owner and both rows, so the repair was obvious: the newer `base` was
demoted with an audited reason and the migration then ran. **Production was
checked before it was touched and had no such duplicate**, so 963 ran there
first try. This is the whole value of the named exception the task's review
insisted on.

**The recipe, as the third pass wrote it.** Hold protocol: `ListAgents`
reported no other session running. `git archive --prefix=mcwellness/
origin/main | gzip -9` (6,432,078 bytes, sha256 `1ffa9c0f…`), carrying all
three migrations; TUS create 201 and PATCH 204 with the offset equal to the
size; `hosting_startNode_jsBuildV1` with the stored settings read back
identical: build `01a08c96`, created 18:31:16. The served bundle flipped from
`index-ejvQq2uB.js` to `index-B8NXW7WB.js`. No restart needed:
`/api/health` 200 in 0.38 s and `/api/health/deep` 200 in 0.62 s.

**What the served process proves.** `POST /api/billing/session-purchases` and
`POST /api/clients/:id/consents/bundle` answer 401 to a stranger — the routes
exist, where before this pass they were 404. `/admin/clients/pin` serves the
picker's document with the widened policy (`script-src 'strict-dynamic' https:
'unsafe-eval'`) while `/admin/clients` beside it still serves `script-src
'self'`: the confinement part two's design rests on, holding on the live site
through the build, the host's header rewriting and the service worker.

**The two test records were removed first.** Before the pass, on the operator's
word ("they were both test subjects"), the two client records made while the
system was being built were deleted: one still at `lead` from 7 September, one
already `erased` on 9 September. Neither carried an invoice, a payment, a
visit, a session or a stored document, so nothing rule 8 retains was touched.
Children first (3 consents, 2 erasure requests, 2 contacts, 1 location), after
clearing `client.primary_contact_id`, which references `contact` and made the
first attempt fail and roll back whole. The audit trail was not touched and
does not reference `client` by foreign key: **379 rows, and
`app.verify_audit_chain()` returns null** — intact. The removal itself is in
that trail, 12 rows carrying the old values and the operator's reason.

**Left as it was.** The archive `mcwellness-a03a0fc.tar.gz` in `public_html`
beside the earlier ones. Production is level with `main`: 96 migrations, and
**zero client records** — the practice's own books, catalogue, practitioner and
identity stand as they were.

**Owed after this pass.** The three live programmes still run twelve months;
moving them to six is a data step on the operator's word
(docs/CHANGE-REQUESTS/billing-10.md). The day map draws an empty day as a grey
panel — found by the operator immediately after this pass, fixed in pull
request 156, not in this build.

## What was done on 2026-09-10: the fifteenth live pass — the day map draws an empty day

At 18:48 UTC on 10 September, minutes after the fourteenth pass, the operator
opened the day map on the new build and reported a flat grey rectangle: "the
map in the browser is not working and it never worked before". It was not a
broken map. It was no map at all.

**What it was.** `DayMapPage` rendered `DayMap` only when Google's script had
loaded **and** a practitioner's day was in hand, falling through otherwise to
`<div className="daymap daymap--absent" />`, whose background is `--paper`
(`#e9e7ec`) — exactly the grey reported. `/api/routing/practice-day` builds its
practitioner list by looping over appointments, so a day with nothing booked
names no practitioner and the plain panel is what gets drawn. Production has
never had a visit booked, so the map had never once been drawn there.

**What was ruled out first, before any code changed.** The browser key is baked
into the served bundle and is byte-identical to the key in Google Cloud and in
`~/Documents/mcwellness-production-secrets.env`; that key's `apiTargets` carry
both `maps-backend.googleapis.com` and `places.googleapis.com`, and its
referrer restriction still refuses a foreign site (`API_KEY_HTTP_REFERRER_
BLOCKED`); the document carries the widened policy in its meta tag and the
host's own header adds only `upgrade-insecure-requests`; and Google's script
does load — the page carries three separate failure notes and showed none of
them. The absence of an error was the tell: a component that fails loudly and
shows nothing is not failing, it is not running.

**The fix** (pull request 156, merged as `f80efbc`). The map is drawn as soon
as the script is here. `DayMap` already fell back to `DEFAULT_CENTRE` — Dubai
at zoom eleven — when it had no places to fit; that path was simply
unreachable. `day` becomes nullable and the three readers of a stop stand down
when it is null. The test drives the answer the route really gives for an empty
day and was watched failing on the old page for the right reason: no map object
was ever constructed.

**The pass.** No migration. Hold protocol clear. Archive
`mcwellness-f80efbc.tar.gz` (6,434,536 bytes); TUS create 201 and PATCH 204
with the offset equal to the size; build `01a08ca6` with the stored settings.
The served bundle flipped from `index-B8NXW7WB.js` to `index-Bw4G3Mcz.js`. No
restart needed: `/api/health` 200 in 1.32 s and `/api/health/deep` 200 in
0.42 s. `/admin/schedule/map` still serves its widened policy (`script-src
'strict-dynamic' https: 'unsafe-eval'`).

**Still open, and separate.** The basemap paints all geometry `--paper`
(`#e9e7ec`) and roads `--rule` (`#d0cbd6`), which is very low contrast. Nothing
has yet been seen with a real stop on it; if it reads as washed out when the
first visit is booked, that is a styling tune in `app/shell/maps/mapStyle.ts`
and not this defect.

## What was done on 2026-09-11: the sixteenth live pass — the basemap keeps Google's colours

At 19:19 UTC on 10 September (03:19 on the operator's clock), on the operator's
word, `main` at `6b07ce3` was built and served: pull request 157, the basemap's
colours, and nothing else.

**Why.** With the day map drawing at last (the fifteenth pass, above), the
operator could see it, and asked for the original colours back.
`app/shell/maps/mapStyle.ts` had painted every feature from the console's own
tokens — all geometry `--paper` (`#e9e7ec`) and the roads `--rule` (`#d0cbd6`).
Those sit about 1.2:1 apart, so the roads were very nearly invisible and the
map read as an empty grey panel. The intent was the design brief's (a basemap
that does not shout under the pins) and the execution took it far enough to
stop being a map.

**What changed.** Nothing is painted. Google's palette separates land, water and
road legibly and is the one a coordinator already knows. Both browser maps —
the day map and the pin picker — take it. What stays turned off is noise rather
than colour: a shop, a bus route and an emirate's boundary are not what either
map is for.

Two consequences, stated rather than discovered later. The basemap no longer
follows the console's dark mode, because Google's palette does not; a light map
under a dark console is the ordinary trade. And the file now names no colour at
all, from a token or otherwise, which is the plainest reading of
`.claude/rules/ui.md`'s "never hardcode colours" — it used to have to argue with
that rule. The test asserts the absence: no styler may carry a `color`, `hue`,
`saturation` or `lightness`, so the next person who reaches for a token here
meets a failing test rather than a comment.

**The pass.** No migration. Hold protocol clear. Archive
`mcwellness-6b07ce3.tar.gz` (6,435,203 bytes); TUS create 201 and PATCH 204 with
the offset equal to the size; build `01a08cc2` with the stored settings. The
served bundle flipped from `index-Bw4G3Mcz.js` to `index-ClUTgBuE.js`. No
restart needed: `/api/health` 200 in 0.58 s and `/api/health/deep` 200 in
0.66 s, and `/admin/schedule/map` still serves its widened policy.

## What was done on 2026-09-12: the seventeenth live pass — a programme's term is optional

At 21:36 UTC on 11 September (05:36 on the operator's clock, 12 September), on
the operator's word — *"Deploy and blank all three"* — `main` at `0fcbc68` was
built and served: pull request 159, billing round 44.

**Why.** On 11 September the operator ruled that a household keeps every
session it paid for, and on 12 September set the shape: an empty term means the
credits never expire; a number with a unit beside it — days or months, chosen
per programme or price — means that term, for that exact programme or price.
The Extend feature is removed entirely. This reverses the six-month programmes
of the fourteenth pass.

**The migration.** `412_optional_package_term.sql`, after the nineteenth
staging pass (`docs/STAGING.md`), applied with the runner's bookkeeping row
(sha256 `f24cbb84…1495`) in the same transaction; its pre-flight read no
extension and no purchase, as the controller's own reading had. Then
`db/policies/billing/ledger.sql` and `db/policies/portal/money.sql`. Read
back: 97 rows. The fingerprint across `package`, `price`, `package_purchase`,
`entitlement` and the dropped `package_extension`, with the body of
`app.oldest_available_entitlement`, is **`ecbb3fcf5b6eb1518102acec561ea585`,
209 items — identical to staging and to a freshly migrated local database**.

**The data step, on the operator's word.** At 21:35:22 UTC, under the
production tenant, the terms of `gold`, `platinum` and `silver` were cleared —
both columns in one statement, because `package_expiry_term_is_whole` refuses
one without the other. Three audit rows, one per programme, each an `update`
of `expiry_amount` and `expiry_unit` from `12 month` to empty, carrying the
reason *"operator 2026-09-12: credits never expire unless the practice sets a
term; blank the three live programmes' terms (billing-11 item 2)"* and a
request id. `app.verify_audit_chain()` returned null. No purchase existed, so
no household's credit was touched, and nothing in this pass rewrites the date
of anything already sold.

**The window, stated.** 412 drops `package.expiry_months`, which the previous
build read, so for about five minutes between the migration and the flip the
catalogue screens on the old build could not load. One person uses the console
today and there are no clients; a pass that drops a column the running code
reads should keep that gap as short as this one did.

**The pass.** Hold protocol clear. Archive `mcwellness-0fcbc68.tar.gz`
(6,197,704 bytes); TUS create 201 and PATCH 204 with the offset equal to the
size; build `01a09266` with the stored settings. The served bundle flipped from
`index-ClUTgBuE.js` to `index-8E9aID3n.js`. No restart needed: `/api/health`
200 in 1.65 s and `/api/health/deep` 200 in 0.75 s, and `/admin/schedule/map`
still serves its widened policy. **The served code was read, not assumed:** the
bundle and its 56 lazily loaded chunks carry *"Leave blank and these credits
never expire."*, *"No expiry"*, *"Runs for"*, *"Counted in"* and the
household's *"These sessions do not expire."*, and nothing of the Extend drawer
or its route.

**Not done.** Nobody has signed in and opened the changed screens against the
live catalogue: staging has had no running server since the 11 September
tidy-up, and the strings prove the code is served, not that each screen reads
the live rows well. The first sign-in to Billing — the programme and price
lists showing "No expiry", a programme's drawer opening with its term blank — is
that check.

## What was done on 2026-09-12: the eighteenth live pass — a section lists its pages

At 23:25 UTC on 11 September (07:25 on the operator's clock, 12 September), on
the operator's word — *"go live"* — `main` at `66b8a0d` was built and served:
pull request 161, the rail's page rows, and nothing else.

**Why.** The operator, earlier the same morning: *"i need the sub menu in
schedule, billing and books to be as well visible in the sidebar. once i click
one of these, i need the submenu to expand and show underneath as well, keep
the current layout in addition to the sidebar submenu."* Settings joined the
three on their answer, having three screens of its own.

**What it does.** Four sections list their pages beneath themselves in the
rail: Schedule (Day, Week, Board, Day map), Billing (Prices, Packages,
Balances, Invoices, Receipts), Books (Overview, Journal, Accounts, Statements,
Books settings) and Settings (Practice, Practitioners, Team). The list showing
is the one for the section being read, derived from the address on every render
rather than remembered, so nothing can drift out of step with the page and no
third fact joins the rail's open and pinned. Each page's own tabs are exactly
as they were: the rail is a second door, which is what was asked for.

**No migration, and nothing touched the database.** `schema_migration` stands
at 97 rows where round 44's pass left it, no policy file changed, and no data
step ran. This pass therefore had none of the seventeenth's window, in which
the running code and the schema disagreed for about five minutes.

**Walked in a browser before it was merged.** Signed in against a local
database as a seeded person and read all three widths: the desk column with
Billing's five rows and Invoices marked; the 64px strip, where a label-only row
has nothing to show and the list is not drawn at all; and the rail covering the
page on a tablet, where the rows return. The DOM was asked rather than the
picture trusted: exactly one section and one page row carried `aria-current`.

**One thing seen once and not reproduced.** In the first, uninstrumented run a
click on the collapse toggle appeared to change Billing's section. With the
page instrumented to record every address change, neither the toggle nor a
resize produced any navigation at all, and the address held. It is recorded
here as a stray click rather than as an explained fault.

**The review's finding, and the guard it earned.** The rail lists Billing's and
Books' sections by hand — the shell otherwise knows nothing about either screen,
and importing their constants would give it a bundle dependency on two pages it
never renders. Nothing made the resulting drift loud: renaming a section on the
page would have left a dead rail row, an unmarked page and a green test suite.
`tests/lint/rail-pages-match.test.ts` now reads both files and fails if they
part company.

**The pass.** Hold protocol clear. Archive `mcwellness-66b8a0d.tar.gz`
(6,208,948 bytes); TUS create 201 and PATCH 204 with the offset equal to the
size; build `01a092c9` with the stored settings. The served bundle flipped from
`index-8E9aID3n.js` to `index-Cn-nc2fr.js` in about seventy seconds. No restart
needed: `/api/health` 200 in 0.44 s and `/api/health/deep` 200 in 0.55 s, and
`/admin/schedule/map` still serves its widened policy. **The served code was
read, not assumed:** the bundle and its 56 chunks carry the page rows' own
markup, all five Billing rows, all five Books rows and Schedule's week, board
and map.

**Two things left open, deliberately.** The rail now scrolls when a section's
pages are showing: on a 900px-tall window Portal, Kit and Today fall below the
fold. The rows are the console's own 44px and shortening them would save forty
pixels, which does not fix it; it waits on the operator's eye. And the check
still owed from the seventeenth pass stands — nobody has signed in and opened
Billing against the live catalogue to see the three programmes read "No expiry".

## What was done on 2026-09-12: the nineteenth live pass — one switcher, and the violet on the one you are on

At 00:24 UTC on 12 September (08:24 on the operator's clock), on the operator's
word — *"go live"* — `main` at `aad77b9` was built and served: pull request
163, and nothing else.

**Why.** The operator, the same morning: *"enhance the UI of the submenu in the
setting, books, schedule,... make it look like tabs or buttons and make the
active 1 inherit the violet color."* Three variants were built in a browser and
shown to them; they chose buttons. A resting tab is a white button with a
hairline border, hover turns it violet, and the one being read is filled
`--brand` with white text — on Billing, Books, Settings, the client record and
the schedule's week, board and day map.

**Why a violet fill here when the rail refuses one.** These sit on the page's
light paper, where white on the brand's violet measures 14.65. The rail's own
violet ground is what cannot carry a violet state — every candidate measured
1.14 to 1.99 against a floor of 3.0 (`docs/SPEC/coloured-shell.md` section 4.2)
— so the rail keeps its white pill and this is no precedent against it.

**A defect this fixed, older than the round.** `.sections__tab` was defined in
`app/admin/billing/billing.css`, which only `BillingPage` imports, while
`BooksPage` renders those classes and imports only its own stylesheet. Screens
are code-split, so **Books' tabs were styled only for a reader who had opened
Billing first**. Measured in a browser before the change: on a fresh load of
`/admin/books`, no stylesheet in the document defined them at all and five bare
browser buttons rendered. Four copies of the pattern existed in all. They are
now defined once, in the stylesheet `main.tsx` loads at start-up, and
`tests/lint/tabs-are-always-styled.test.ts` refuses them any other home — a
guard proved by negative control, since the review of PR 163 showed the first
version of it was porous enough to miss a re-added modifier rule.

**The operator's own decision inside the round.** The client record's drawer
carries nine tabs; as buttons they wrap to three rows and take 172px of the
drawer against 128px before. That measurement was put to them with the
alternatives, and they chose one look everywhere.

**No migration, no policy file, no data step.** `schema_migration` stands at 97
rows where the seventeenth pass left it; the database was not touched.

**The hold protocol earned its keep.** `ListAgents` showed a peer session
running on the same machine. It was asked, in as many words, whether it was
deploying; it answered that it held no upload and was doing read-only work.
Nothing was sent to the host until that answer came back — which is the whole
point of the rule written after two sessions built twelve seconds apart on
8 September.

**The pass.** Archive `mcwellness-aad77b9.tar.gz` (6,214,207 bytes); TUS create
201 and PATCH 204 with the offset equal to the size; build `01a09300` with the
stored settings. The served bundle flipped from `index-Cn-nc2fr.js` to
`index-B5pQpsPt.js` in about a hundred seconds. No restart was needed — the peer
session's warning about a completed build serving stale output did not arise,
as it has not since the 8 September passes. `/api/health` 200 in 0.95 s and
`/api/health/deep` 200 in 1.05 s, and `/admin/schedule/map` still serves its
widened policy. **The served stylesheet was read, not assumed:**
`/assets/index-lrxFLvP_.css` carries the one shared rule, with the current tab
filled `var(--brand)`, and none of the old ink-underline rules remain.

**Still open, and unchanged by this pass.** The rail scrolls when a section's
pages are showing, which waits on the operator's eye; and the check owed since
the seventeenth pass stands — nobody has signed in and read Billing against the
live catalogue to see the three programmes say "No expiry".

## What was done on 2026-09-12: the twentieth live pass — the rail's rows, and an app that installs

At 01:08 UTC on 12 September (09:08 on the operator's clock), on the operator's
word — *"go"* — `main` at `771d0b1` was built and served: pull request 165.

**Why.** The operator, against three things left open, wrote one word: *"fix"*.

**The rail's rows.** A page listed under its section is 36px where the only
pointer is a mouse and the console's full 44px wherever a coarse pointer exists
at all. With tighter spacing the rail's overflow at 1440×900 falls from 135px
to 99px, and at 1137px — an ordinary desk monitor — there is none. The
arithmetic is in `docs/SPEC/coloured-shell.md` section 7.1 rather than implied:
ten sections at 44px and five pages do not fit a 900px window and no honest row
height makes them, so the pages that open are scrolled into view as well.

**An app that installs.** The manifest opened at `/today` — the practitioner's
day sheet, because it was written for her phone — so installing it on the
office's PC opened the wrong screen every launch. It opens at `/` now, which
routes each person home by role. The portrait lock is gone, three shortcuts put
Clients, Schedule and Billing on a taskbar right-click, and four PNG icons
carry the sizes Windows, Android and Safari each ask for.

**And the icon had never worked.** `public/icon.svg`'s comment named two design
tokens by their CSS spelling, and a double hyphen is illegal inside an XML
comment, so the file has never parsed — here or on the live site. Every browser
asked for the installable icon got a parse error rather than a mark, and
nothing caught it because the console draws its own mark from a PNG and a
browser that cannot parse an icon simply shows none. Found while rasterising
it; `tests/lint/svg-parses.test.ts` now refuses one that does not parse.

**The icons were nearly shipped wrong twice.** The first rasterisation used
macOS Quick Look, which composites onto a white matte: all three came out with
opaque white wedges where the mark's rounded square is transparent — on a dark
Windows taskbar, precisely the poor icon the round set out to end. The review
of the pull request measured it before it shipped. They are rendered by an
exact rasteriser now, and each file is what its own platform wants: rounded
with transparent corners for a browser, full bleed and opaque for the maskable
icon Android crops itself and for Apple, which paints transparency black.

**The hold protocol, with three peers.** `ListAgents` showed three other
sessions on the machine. One (`t-ca`) ended before it could be asked; the other
two were asked in as many words and both answered that they held no upload and
were doing read-only work, and both stayed off the host until they were told
the build had finished. One of them checked the other before answering, which
is the rule working as written. The archive was uploaded while waiting — it
carries its own commit in its name and can overwrite nobody — and **the build,
which is the destructive step, was held until both answers were in**.

**The pass.** Archive `mcwellness-771d0b1.tar.gz` (6,232,820 bytes); TUS create
201 and PATCH 204 with the offset equal to the size; build `01a09328` with the
stored settings. The served bundle flipped from `index-B5pQpsPt.js` to
`index-Sda6hf_P.js` in about two minutes. No restart was needed, as none has
been since the 8 September passes. `/api/health` 200 in 0.46 s and
`/api/health/deep` 200 in 0.52 s.

**The icons were read back from the live site**, not assumed: all four answer
`image/png` at their declared sizes, with the two plain ones transparent in the
corner and the maskable and Apple ones opaque, which is the property that went
wrong in the first cut.

**One thing observed and only partly explained.** The PNG bytes served are not
the bytes committed — 2,740 against 1,802 for `icon-192.png`. Every property
checked is identical: dimensions, colour type, corner alpha, PNG validity. And
`public/brand/mark.png`, untouched since 8 September, is transformed the same
way (28,446 bytes against 29,956), so this deploy did not cause it.

**Found while the record was being written, and it is the CDN.** The same
address serves two formats: `GET /icon-192.png` with `Accept: image/webp`
returns **`content-type: image/webp`**, 1,428 bytes, RIFF/WEBP magic, and with
`Accept: image/png` returns PNG, 2,740 bytes. Every response says `server:
hcdn`. Two things in that are worse than the byte counts:

- **No `Vary: Accept` on either variant**, with `cache-control: max-age=31536000,
  public`. Two formats at one URL, a year-long shared TTL, and nothing telling a
  downstream cache that the answer depends on the request. A corporate proxy or
  an ISP cache may store the WebP body and later hand it to a client that asked
  for PNG only, labelled `image/webp` at a `.png` address.
- **It often costs bytes rather than saving them.** `brand/mark.png` is 28,446
  committed and 33,956 as WebP; its PNG variant is 29,956.

That is an operator-level hosting setting rather than anything in this
repository, and it is recorded in `docs/SPEC/hosting.md` beside the manifest's
content type, which is the same layer.

**What is ruled out, and what is not.** The app's build is ruled out by
reading it: `build:production` is a plain `vite build` with no pre- or post-step,
the icons live in `public/` which Vite copies verbatim, there is no image
tooling in the dependencies at all, and `vite-plugin-pwa` runs
`injectManifest` with `manifest: false`, so it writes the asset list into the
worker and generates nothing. Fetching origin-direct, bypassing the edge,
returns the same transformed bytes — but that does **not** clear the serving
layer, because LiteSpeed is the origin: it is the same layer that serves
`/manifest.webmanifest` off disk as `text/plain`, above. The WebP proves the CDN transforms images; it does **not**
prove the PNG variant is its doing, and the origin-direct reading of 2,740
argues the file on disk may already be 2,740 with the CDN adding only the WebP.
The hosting file API exposes only the document root, which holds `.htaccess` and
nothing else, so the extracted file's size cannot be read with the tools here:
the CDN transcoding is confirmed, the PNG re-encode's origin is not.
Recorded as observed rather than attributed, because the next person to diff a
deployed asset against the repository will otherwise think the build is at
fault.

**And one that is already known.** `/manifest.webmanifest` still comes back as
`text/plain`: LiteSpeed serves it straight off disk and the app's own content
type never applies. That is the open operator item in `docs/SPEC/hosting.md`,
unchanged by this pass.

**The check owed since the seventeenth pass is done.** Signed in on production
as the founder and read what the Billing screen reads: Silver, Gold and
Platinum each return no term, and none of the five prices carries one. The
endpoints answer normally, which is what round 44's five-year ceiling exists to
protect.

## What was done on 2026-09-13: the twenty-first live pass — the country's own formats

**Why.** A native `<input type="date">` draws itself in the locale of the
browser, not of the page. `lang` does not move it and the application has no
say, so on a machine whose browser is set to English (United States) the date
of birth on the enrolment wizard read `MM/DD/YYYY` while the same record on
another machine read `DD/MM/YYYY`. The stored value was identical and correct
in both; only the person reading it was misled. Twenty-six date boxes and two
time boxes were affected. The display side was already right everywhere and was
not touched.

**What went live.** Round 48, merged as `47d567f` (pull request 169). Every
date box is a masked `DD/MM/YYYY` field with a calendar button; both time boxes
are twenty-four hour; three phone boxes are a country selector beside the rest
of the number; the Emirates ID groups itself as it is typed; and every drawer
has a draggable width remembered on the machine. Browser-side only: **no
migration, no policy file, no API route, no schema.**

**The hold protocol.** Two other sessions were live. Both were asked in as many
words and both answered clear; one of them checked the other before answering.
The archive was uploaded while the answers were outstanding — it carries its
own commit in its name and can overwrite nobody — and the build, which is the
destructive step, was held until both were in.

**The pass.** Archive `mcwellness-47d567f.tar.gz` (6,333,404 bytes); TUS create
201 and PATCH 204 with the offset equal to the size; build `01a09a5b` with the
stored settings, 10:41:09Z to 10:42:11Z. The served bundle flipped from
`index-Sda6hf_P.js` to `index-D4Rebdzl.js` and the stylesheet from
`index-9wyYdq0f.css` to `index-DfMyZ8W0.css`. No restart was needed — the
fourth consecutive pass where it flipped on its own. `/api/health` 200 in
0.49 s and `/api/health/deep` 200 in 0.51 s.

**The archive needs the root folder, and this nearly cost the pass.** The
stored build settings say `root_directory: "mcwellness"`, not `.`. The archive
must therefore contain a top-level `mcwellness/` folder holding
`package.json`. A `git archive` without `--prefix=mcwellness/` puts every file
at the root of the tar, the host finds no manifest where it expects one, and
the build fails in a way that reads like a broken tree rather than a wrong
shape. **Read the stored settings back before building rather than
reconstructing them from memory**; that is what caught it here.

**A moved hash proves a build happened, not that it was yours.** Three markers
were read back off the live site to prove round 48's own code is being served:
`drawer__resize`, a class that did not exist before this round, is in the main
bundle; `DD/MM/YYYY` is in the code-split chunk `DateField-Bzgv7edf.js`; and
the Emirates ID placeholder is in `ClientsPage-DNYMsLo5.js`.

**Two checks worth making the default, from the session that held the watch.**
The old bundle `index-Sda6hf_P.js` now answers **404**, which rules out a
half-extracted state where the old and new assets coexist and the page happens
to reference the new one. A deliberately nonsense asset path also answers 404,
which proves the host is not blanket-200ing and makes the two 200s evidence
rather than noise. A baseline armed before the upload also gave a flip
timestamp of 10:42:16Z, which a check run afterwards cannot.

> **Corrected the same day, before the check was used again.** As written above,
> the 404 rule is wrong for any pass that does not change everything. It held on
> this pass only because BOTH hashes moved. Vite hashes each asset on its own
> content, so a CSS-only round leaves the JS hash alone — and the old JS is then
> still the CURRENT JS, which must answer **200**. Applying "the old asset must
> 404" to it would report a failed deploy on a good one. The rule is:
> **for each asset whose hash MOVED, the superseded file must 404; an asset whose
> hash did not move must still 200.** On a CSS-only pass a static JS hash is the
> expected result and not a warning — while a JS hash that DID move is worth a
> look, because it says something changed that was not meant to. Caught by the
> session holding the watch for the twenty-second pass, before that pass ran.

**Not chased, and neither is new.** The CDN transcodes images — the same
address returns `image/webp` or PNG depending on the `Accept` header, with no
`Vary` and a year-long cache — so a served asset's bytes never match the
committed bytes and a default `curl` and a browser see different files at one
URL. `/manifest.webmanifest` still serves as `text/plain` off disk. Both are
recorded in `docs/SPEC/hosting.md`, both predate this round, and both are
operator-level switches.

**Owed from this round.** A `00`-prefixed **foreign** number whose length lands
inside the E.164 range is still accepted (`0012125551234` becomes
`+971012125551234`). The UAE case overflows the range and is refused loudly, so
the practice's own numbers are unaffected. Two lines, and it belongs to a later
round. Separately, `useDrawer.ts` exists in three copies — `app/shell/components`,
`app/admin/accounting`, `app/admin/billing` — and this round demonstrated the
cost: a focus-trap fix landed in one copy and left the drag handle
keyboard-unreachable in eleven drawers until a whole-branch review caught it.
Three copies of a behavioural hook is three chances to be one edit behind, and
no test would say so.

## What was done on 2026-09-13: the twenty-third live pass — a calendar the page draws

**Why.** The operator, **on Safari**, opened the calendar button on the New
appointment drawer and got the browser's own date picker falling off the outer
edge of the drawer, clipped by the window, and drawn as small grey browser
chrome that matched nothing else on the page. Their words: "every calendar
button in the app should be revised, the calendar open inward towards the
browser window and not outside and being clipped."

**Why re-anchoring it was the wrong fix, and a branch was closed to say so.**
The first diagnosis was the anchor, and it was correct as far as it went: the
hidden native input was a 1px dot pinned to the field's inline end, so in a
drawer docked to the inline end of the screen the picker had almost no room and
opened outward. Pull request 173 fixed that and was **closed unmerged**. A
native picker's panel has **no CSS surface in any browser** — only the indicator
icon is exposed — so moving the anchor answers the clipping and leaves the
second complaint, that it does not match the app, permanently unanswerable. The
whole native control is gone instead.

**What went live.** Main `1e39647` (pull request 174). `CalendarPanel`, drawn in
the page: the app's own type, `--brand` on the chosen day, a hairline for today,
tabular figures. It portals to the body and is `position: fixed`, so the
drawer body's `overflow: auto` cannot clip it. Placement is a **pure function**,
`placeCalendarPanel({ anchor, panel, viewport, direction, gap, margin })`,
unit-tested over fabricated rects — including a case written for this bug and a
sweep of 180 combinations of position, viewport width and direction. Typing is
untouched and still the primary way in; `value` and `onChange` remain ISO
`YYYY-MM-DD` and all 26 call sites are unchanged.

**A timezone trap handled deliberately.** `new Date('1986-09-30')` parses as UTC
midnight and `toISOString()` on a locally-built date crosses the boundary. The
practice is UTC+4. Every date is built with `new Date(year, monthIndex, day)`
and read with local getters; nothing round-trips through an ISO parse. Tested at
1 January and 31 December.

**The pass.** Archive `mcwellness-1e39647.tar.gz` (6,349,125 bytes); TUS create
201 and PATCH 204 with the offset equal to the size; build `01a09aec`. Bundle
`index-CTFM9aAd.js` → `index-BQknus28.js`, stylesheet `index-BWDEBIWx.css` →
`index-CxD9fCWF.css`. `/api/health` 200 in 0.76 s, `/api/health/deep` 200 in
0.83 s. No restart — the sixth consecutive pass.

**The served stylesheet hash was byte-identical to the one the local
`pnpm build` produced** before anything was uploaded. Same input, same output:
proof the host built this tree and not something else. Worth doing every pass —
it costs nothing, because the build has already been run locally to verify.

**A third correction to the hash rule, and the previous two were too simple.**
The entry bundle's byte count was **identical** across this pass — 475,526
before and after — despite a whole new component and a substantially rewritten
`DateField`. The entry bundle does not *contain* the screen components; it
contains their **filenames**. So an identical entry-bundle size does not mean
"no real code changed"; it means "nothing in the entry bundle changed", which is
nearly always true on a code-split app. **The check that works is to follow the
chunk:** the entry named `DateField-CThzYZHq.js`, the previous
`DateField-Bzgv7edf.js` now 404s, and the new one is 8,656 bytes carrying
`calendar__day` and the dialog's accessible name with zero `showPicker`. That is
the change, in the served bytes, in the file that holds it. Entry-bundle byte
counts tell you almost nothing here.

**Verified by the operator, in Safari, on the real screen.** This is the pass
where that mattered most and where this session could not do it: WebKit could
not be installed in the environment, so placement was proved as a pure function
rather than measured in a live panel in the browser the defect was reported
from. That gap was stated before the upload rather than after, and the operator
closed it: "it work amazing".

## What was done on 2026-09-14: the twenty-fourth live pass — the health answers, and the readings go dormant

**The largest pass so far: five merges and five migrations at once.** Production
had been left four merges behind while two streams worked in parallel, and the
fifth landed on top of them. Main `1b15107` carries pull request 176 (the
manifest the app serves), 178 (reference lists remembered for the session, and a
booking defaulted), 177 and 179 (concerns, and the six health answers the
agreement asks for, with their screens), and 180 (the practice's own software
takes the readings; ours go dormant).

**What the practice gets.** The six things every household is asked to disclose
before a first session — epilepsy or any seizure, a pacemaker or any implanted
electrical device, a head injury at any time, pregnancy, medication that affects
mood, sleep or attention, and a skin condition or sensitivity on the scalp — now
have somewhere to live. Until this pass they were told to a person and
remembered by that person. A "yes" shows on the record and on the practitioner's
own card for that visit, so it is seen at the door, and it blocks nothing.
Concerns are stored apart from goals so that a worry can never appear in
somebody's progress report as a goal they never set. And a visit no longer asks
the practitioner to transcribe three figures off the vendor's screen: the
professional software's export is attached to the visit instead.

**The order the databases were done in, and why it is not arbitrary.** Staging
first, then production, each migration through the hosted console with the
file's own sha256 written into `schema_migration` by hand. Both went from 97 to
**102**: `108` (concern, health_declaration), `307` (a session's export
document), `918` (`tenant.record_readings`, shipped false), `964` (the erasure
reaches concerns and the health answers), `965` (the six answers dropped from
the audit trail). Then the three changed policy files under
`db/policies/client/` — `readers.sql`, `writers.sql`, `tenant_isolation.sql` —
re-applied by hand, **after** `108` rather than before it, because all three
name `concern` and `health_declaration` and neither table exists until `108`
runs. Policies are declarative and are not carried by migrations; the runner
re-applies every file on each migrate, so a hand-applied pass must re-apply the
changed ones or the fingerprint comes up short.

**All five migrations are additive, so the window in which the schema led the
code was the safe direction.** The upload was delayed after the databases were
finished, and both health endpoints answered 200 throughout that gap. A pass
that has to stop half way should stop here, not the other way round.

**Fingerprint: staging and production identical on all seven categories.**
Columns `c79efc8f` (212), constraints `83850f2b` (118), indexes `67b4a932` (90),
policies `c5e2a4e2` (41), triggers `1bd12056`, functions `36c1780d`, comments
`9894eac7`. Three probes on both: `app.erase_client` names
`public.health_declaration` and `public.concern`; `app.audit_redact` drops
`seizures`; and the new foreign key on `session.export_document_id` reads
`confdeltype = 'n'`, which is `set null`. `app.verify_audit_chain()` returns
null on production, which is what intact looks like.

**Two databases agreeing is not a fingerprint of the file.** It proves only that
the same text was pasted twice, which is exactly the mistake a hand-applied pass
is prone to. `108` carries a long deliberate table comment, so the comment
literals were extracted from the migration files themselves and hashed:
`84407166` for the `health_declaration` table comment and `51c22d59` for
`session.export_document_id`. Both match what the databases store, byte for
byte. Do this on any pass that hand-applies a comment.

**Why the export needs no mention in the erasure, which is a design decision and
not an omission.** `964` is now the highest definer of `app.erase_client`, above
`954`, and it never names `session.export_document_id`. It does not need to. The
foreign key is `on delete set null`, so the erasure's generic
`delete from public.document where client_id = …` takes the file and the
reference clears itself — where `setup_photo_document_id`, whose foreign key has
no `on delete` clause, must be unlinked by hand first or the whole erasure
aborts on the first household that ever filed one. The export's storage key also
lands in `storage_keys_to_delete`, so the bytes are swept with everything else.
A column that cannot be forgotten by whoever writes migration `970` is worth the
asymmetry.

**The pass.** Archive `mcwellness-1b15107.tar.gz` (6,420,096 bytes); TUS create
201 and PATCH 204 with the offset equal to the size; build `01a09d0d`, 66
seconds. Bundle `index-BQknus28.js` → `index-BcybMQ1y.js`. `/api/health` 200 in
0.50 s, `/api/health/deep` 200 in 0.52 s. **No restart — the seventh consecutive
pass**, so the restart the 8 September pass needed keeps receding.

**A third failure mode for the hash rule: both cheap checks can be blind at
once.** The twenty-first to twenty-third passes established that the entry
bundle's byte count proves nothing on a code-split app, and that the stylesheet
hash is a free proof the host built this tree. This pass breaks the second one
too. A local `pnpm build` of `1b15107` emitted `index-CxD9fCWF.css` — **already
the stylesheet production was serving** — because two whole rounds of new
screens added no new styles. And the entry bundle came back 475,620 bytes
against 475,526, a 94-byte move across all of that work. So on any pass that
happens not to touch CSS, the stylesheet trick cannot discriminate and the byte
count cannot either, and the chunk marker is the only evidence left. Budget for
it rather than discovering it at the end.

**Capture the before state before uploading, or the marker check proves
nothing.** An absence that was never measured is not evidence. Before the
upload: `ClientsPage-23lzaGsu.js` contained no `Not asked yet`, and
`PracticePage-qY3pzmOF.js` contained no `recordReadings`. After:
`ClientsPage-CLIS61Bv.js` carries the first, and `PracticePage-Cy2y_-hh.js` and
`CheckInPage-Bgv0-Eyk.js` both carry the second. All four previous chunk names
now 404, which rules out a half-extracted deploy, and a nonsense asset path
404s as well — that last check is what makes the other four mean anything,
because a host answering 200 to everything would look identical otherwise.

**The guard that locks a door nobody uses.** `.claude/hooks/no-prod-in-dev.sh`
refuses any command naming the production project and states that production is
never touched from a working session. It is a pre-tool hook on shell commands
only, so it does not see the hosted console through which every live pass in
this document has actually applied its migrations, and both locks it names guard
`pnpm db:migrate`, which cannot reach a hosted database anyway because no owner
password exists on the machine. It was found by tripping it while writing a
note, not by reading it. Nothing was changed: either its wording overstates what
it protects, or the console path needs a lock of its own, and that is the
operator's decision rather than a thing to quietly adjust.

**Still open, and deliberately untouched.** `docs/CONSENT/erasure-letter/en.md`
and `ar.md` list what an erasure removes and do not mention the health answers,
which `964` now deletes outright. It under-states rather than mis-states.
Changing approved wording is a new version and the operator's call; it has been
put to them twice and remains theirs.

**Both of the above were then answered by the operator, within the hour.** The
letter is at `0.5-draft` in both languages and now names the concerns and the
health answers, reusing the phrasing the health-data consent already uses so a
household meets the same words twice; the hook's message was corrected to say
what it actually guards, with its patterns and matcher left byte-identical.
Recorded in `docs/CHANGE-REQUESTS/trunk-notes.md`, round 52. Asked about the
one line left over — both languages still said the wording stood "until the
practice's lawyer approves a final version", though that route closed on 9
September — the operator answered that nothing waits on a lawyer and approved
the wording themselves. **The erasure letter is `1.0`, `status: approved`, in
both languages**, and the caveat is gone from the four other places that
repeated it. Nothing in `docs/CONSENT/` is a draft any more except the
superseded texts, which are history.

**A rule for the hold protocol, which this pass needed and did not have.** Two
sessions were asked to stand down. One answered in under a minute; the other
never answered at all, across three messages and about half an hour, and the
pass went ahead on the judgment that it was dormant rather than working. That
judgment was right, but it was made without a rule, and the next pass should
not have to make it again. **The rule: a peer that does not answer is not a
peer that has cleared.** Ask twice, wait, and then treat silence as permission
to proceed only when nothing about the pass is destructive to a third party —
which an upload is not, because the failure mode is a build that loses its own
archive and is recovered by re-uploading. Say plainly in the record that you
proceeded on silence, name the session, and never write it up as a clean
two-way handshake. If the pass had involved something a silent peer could not
undo, silence would have meant stop and ask the operator.

## What was done on 2026-09-14: the twenty-fifth live pass — the erasure letter is approved

**Why a pass for a docs change.** The confirmation letter a household receives
is read from disk at the moment of erasure, so until this pass every letter
production cut still said the wording stood "until the practice's lawyer
approves a final version", and the office screen still said a filed letter was
"pending the practice's lawyer". The operator's answer on 14 September — nothing
waits on a lawyer; their own approval is final — was in `main` at `7a1e94c`
(pull request 182) and not on the server. Leaving that gap open would have meant
a household erased that week receiving a caveat the practice had already
withdrawn.

**What went live.** The erasure letter at `1.0`, `status: approved`, in both
languages, naming the concerns and the health answers migration `964` deletes;
one line of office copy in `ErasureSection`; the corrected wording in
`.claude/hooks/no-prod-in-dev.sh`; and the hold-protocol rule recorded in the
twenty-fourth pass. No migration; the databases are unchanged at 102.

**The pass.** Archive `mcwellness-7a1e94c.tar.gz` (6,425,531 bytes); TUS create
201 and PATCH 204 with the offset equal to the size; build `01a09d38`, 67
seconds; bundle `index-BcybMQ1y.js` → `index-DvdVXFyE.js`, about 70 seconds
after the build. `/api/health` 200 in 0.46 s, `/api/health/deep` 200 in 0.49 s.
No restart — the eighth consecutive pass.

**Verified by the chunk, as the rule now says.** `ClientsPage-jU7hsZFL.js` no
longer contains "pending the practice" and does contain "from wording"; the
previous entry and the previous `ClientsPage` chunk both 404; a nonsense asset
path 404s. The one string this pass removed is gone from the served bytes and
the one it added is present, which is the whole of what a docs pass can prove.

**Hold protocol.** One peer cleared earlier the same night and was told; the
other did not answer this hold either. Proceeded on silence under the rule from
the twenty-fourth pass — an upload harms nobody else — and recorded as silence.

## What was done on 2026-09-18: the twenty-sixth live pass — the expo's form, past sessions, the review line

On the operator's word ("go", 22:04 in Dubai), production was brought level
with `main` at `57220de` — pull requests 184, 185 and 186, three of the owner's
four requests of 16 September, with 187 (the push notifications memo) and 188
(the staging pass's record) beside them. The fourth request is a decision for
the owner and is not built. The staging pass the same evening is in
`docs/STAGING.md`, and this pass did on production exactly what that one did on
staging.

**The pass ran in two halves, an hour and a half apart, and the gap was the
safe kind.** The databases were finished at 18:06 UTC. The next step, making
the archive, was refused by the session's auto-mode gate as a production
deploy, twice; it was not worked around. The operator cleared it and the upload
ran at 19:34 UTC. In between, the 25th pass's code served a 106-migration
database: `/api/health` and `/api/health/deep` answered 200 throughout, the
four existing sessions read `recorded_from = device` by default, and the only
behaviour the old code gained was the practice's ceiling of three hundred
enquiries an hour. All four migrations are additive, which is what made
stopping there an ordinary thing to do.

**Read first.** 102 rows and none of the four new files; both constraints 919
drops present under the names it drops them by; four enquiries, every one
already actioned, so the rebuilt scrub constraint had nothing to refuse; one
tenant; `app.verify_audit_chain()` null. No other session on the laptop, at
either half.

**Applied** in the runner's order — `704_portal_review_prompt`,
`919_expo_enquiry`, `920_practice_review_url`, `966_session_from_records` —
then the four bookkeeping rows with the sha256 of each file as staging holds
them, then `db/policies/portal/access.sql` and
`db/policies/session/practitioner_scope.sql` whole, as `policies_after_966`.
Read back: **106 rows.**

**Fingerprint: production, staging and a freshly migrated local database
identical on all nine categories.** Columns `ca33becc` (143), comments
`c1c3475c` (143), constraints `79a273a6` (112), functions `87bd3eda` (3),
grants `187277a1` (20), indexes `2c2cb893` (60), policies `f6e4cb66` (23),
triggers `1ca1ee9f` (29), and the whole ledger `8a2b0ce2` — 106 filenames with
their checksums. The local database is the leg that matters: it was built by
the runner from the files, so agreement with it says the text pasted into two
hosted databases is the text in the repository.

**The build.** Archive `mcwellness-57220de.tar.gz`, 6,537,909 bytes, made with
`--prefix=mcwellness/`, no env file inside; TUS create 201, PATCH 204 with the
returned offset equal to the size. Settings read back from the host before
building and unchanged: node 24, hono, root `mcwellness`, output `.`,
`build:production`, entry `app/api/start.mjs`, npm. Build `01a0b604`, 63
seconds. **No restart — the ninth consecutive pass without one.** Health 200 in
0.30 s, deep 200 in 0.18 s.

**Verified by the chunks, with the absence measured first.** Before the
upload: entry `index-DvdVXFyE.js` (475,620 bytes), stylesheet
`index-CxD9fCWF.css`, no `ExpoEnquiryPage` chunk at all, and none of "Log a
past session", "Expo poster", "Google review link" or "Leave a review" in the
chunks that would carry them. After: entry `index-Cz_UgTLO.js` (476,584
bytes), stylesheet `index-DSJRZKuA.css`, and

- `SchedulePage-BVMU_c2b.js` carries "Log a past session";
- `EnquiriesPage-Cr8OcWX-.js` carries "Expo poster", and
  `ExpoEnquiryPage-dSuReCU3.js` and `ExpoPosterPage-BD_yzUx2.js` exist;
- `PracticePage-BlfbxJlA.js` carries "Google review link";
- `HomeScreen-CLjlQAWI.js` calls `review-prompts`, which the old chunk did not.

The old entry, the old stylesheet and the four old chunks all 404, and a
nonsense asset path 404s too, which is what makes the rest evidence. `/expo`
answers 200; `POST /api/sessions/from-records`, `GET /api/enquiries/expo.csv`
and `POST /api/portal/review-prompts` each answer 401 to a stranger.

**A marker that was not where it was looked for.** "Leave a review" is absent
from the `HomeScreen` chunk and that is correct: the portal's words live in
`app/client/i18n/dictionary.ts`, which ships in the entry bundle, and the entry
went from no occurrence to one in English and one in Arabic. For any portal
string, read the entry; for any console string, read the screen's chunk.

**Left as it was found.** No expo row and no records session exists on
production: nothing was written to prove the pass, because the staging and
local walks had already proved the behaviour and a synthetic row in the
practice's own list is a cost. `tenant.review_url` is null, so the review line
is off for every household until the owner records the practice's review page
in Settings › Practice. `app.verify_audit_chain()` is null.

**For the owner.** Print the stand's poster from
`https://app.mcwellnessuae.com/admin/enquiries/poster` and from nowhere else:
its code encodes the address of the page it is printed from. Scan it once with
a phone before the print run. The review line appears only after the review
link is recorded.

## What was done on 2026-09-18: the twenty-seventh live pass — the stand's poster in the practice's own dress

**21:01 UTC on 18 September, which is 01:01 on 19 September in Dubai.** On the
operator's word, "push it live", given at 00:57 +04. `main` at `78cab68` —
pull request 190, and with it 189, the twenty-sixth pass's own record, which
is this file and changes nothing that runs.

**No migration and no policy file; both hosted databases stay at 106.**
Between `57220de`, which production ran, and `78cab68` nothing under `db/`
moved and no dependency manifest moved. Five files did: the poster's page, its
stylesheet and its test, the amendment to
`docs/CHANGE-REQUESTS/trunk-round-50.md`, and this file. So there was no
window in which the running code and the schema disagreed.

**What the pass carries.** The stand's poster at `/admin/enquiries/poster` is
one white A4 sheet headed by the whole lockup, with a violet bar above and
below, the code in a violet frame, and the address in the violet on one line.
In the old 24rem column the address broke as `…/exp` and `o`. The code, its
encoder, its quiet zone and the words on the sheet did not change. The three
decisions a later reader might otherwise undo are in the round's amendment.

**Before it merged.** `verify` and `verify-db` each read SUCCESS, read as
conclusions and not taken from a watcher's exit code; the merge was pinned to
the head the reviewers read, `a7b6fdfa`. Compliance and security reviews both
passed. Compliance left one note that is the owner's to weigh and not a gap:
the lockup's tagline reads "Mind • Balance • Healing", and this sheet is the
first public, printed surface it reaches. It is the owner's own mark and was
not altered. If the word is not wanted on the stand, the rail's pairing — the
round mark with the name set in type — is the alternative.

**The hold protocol.** `ListAgents` showed no other session on the machine, so
there was nobody to ask and nobody to collide with.

**The build.** Archive `mcwellness-78cab68.tar.gz`, 6,541,979 bytes, made with
`--prefix=mcwellness/`, no env file inside; TUS create 201, PATCH 204 with the
returned offset equal to the size. The upload's two keys were read by `curl`
from a file of mode 0600 that was deleted in the same command, so they were
never on a command line. Settings read back from the host before building and
unchanged: node 24, hono, root `mcwellness`, output `.`, `build:production`,
entry `app/api/start.mjs`, npm. Build `01a0b651`: asked for at 20:59:27,
running at 20:59:41, completed at 21:01:01 — eighty seconds of building.
**No restart — the tenth consecutive pass without one.** Health 200 in 0.24 s,
deep 200 in 0.28 s, and health answered 200 at every fifteen-second poll
across the whole build.

**The site served the new build four seconds before the host called the build
complete.** The entry's name was seen to change at 21:00:57, and the build's
own record says 21:01:01. The assets are in place
before the state changes, so a poll of the served name is the earlier signal
and the build's state the later one. Neither is wrong; do not read a build
still marked `running` as proof the old code is still being served.

**Verified by the chunk, with the absence measured first.** Before the upload:
entry `index-Cz_UgTLO.js`, and `ExpoPosterPage-BD_yzUx2.js` (21,634 bytes)
holding `plain poster` and neither `brand/lockup` nor `poster__sheet`, beside
`ExpoPosterPage-FCN9khqN.css` at 295 bytes. After: entry `index-BxCLftPf.js`,
and

- `ExpoPosterPage-CTvhCcV-.js` (22,031 bytes) holds `brand/lockup` and
  `poster__sheet`, and `plain poster` is gone;
- `ExpoPosterPage-BSHEAOpT.css` (1,890 bytes) holds `@page poster` and
  `100cqi` — **and that is the name a local build of this tree wrote**, which
  says the host built this tree and not a stale one;
- the shell's stylesheet did not move, `index-DSJRZKuA.css` before and after,
  and still answers 200. That is the right signature: the poster's styles are
  the screen's own and load with it, so the shell had nothing to change.

The old entry and both old poster files 404, and a nonsense asset path 404s
too, which is what makes the rest evidence. `/brand/lockup.png` answers as
`image/png`, read by its type because an unknown path here answers 200 with
the app's own document. `/expo` answers 200.

**The entry's size would have said nothing, again.** It came back 476,584
bytes, the figure the twenty-sixth pass recorded to the byte: the entry holds a
chunk's name, the new name is as long as the old one, and so a whole screen
was restyled without the entry changing length. The rule of the last five
passes holds. Follow the chunk.

**How the sheet was proved before it shipped.** Printed to PDF by headless
Chrome from a throwaway page that rendered the component without sign-in: the
named page came out as one page of A4, 595 by 842 points, with none of the
browser's own lines on it. The fallback for a browser that does not understand
a named page was imitated by overriding the three declarations it differs by,
and at full width **it ran onto a second page**, the address alone at the top
of it. That is where the 180mm cap came from, and with it the fallback is one
page of US Letter inside the browser's own margins. It was found by printing
and would not have been found by looking.

**Not tested: Safari — and that is where it was wrong.** It was written here
that Safari could not be run from this machine and was the browser most likely
to take the fallback. Both were mistaken, and the second was the fault: Safari
passes the test the full sheet was gated on, keeps its own margins anyway, and
printed a blank second page. It was found an hour later, on the operator's
asking to make sure of one sheet, by driving the system's own WebKit to a PDF.
The poster of this pass was therefore live with that fault from 21:01 to the
twenty-eighth pass, which is the next section and mends it. Nothing else in
this section is withdrawn.

**Left as it was found.** Nothing was written to either database.

**For the owner.** Print the poster from
`https://app.mcwellnessuae.com/admin/enquiries/poster` and from nowhere else:
its code encodes the address of the page it is printed from, and the preview
image made on the way to this pass holds a code for a laptop. Scan the printed
sheet once with a phone before the print run; it should open
`app.mcwellnessuae.com/expo`.

## What was done on 2026-09-18: the twenty-eighth live pass — the poster prints on one sheet in Safari

**21:32 UTC on 18 September, which is 01:32 on 19 September in Dubai**, half an
hour after the twenty-seventh, and mending it. `main` at `42d15d2` — pull
request 192. The operator had printed the new poster and asked, at 01:05 +04,
to make sure it prints on one sheet; mending the poster that was live is what
that asked for, and the pass ran on it.

**No migration and no policy file; both hosted databases stay at 106.**
Between `78cab68` and `42d15d2` three files moved: the poster's stylesheet, its
test, and the round's note. Nothing under `db/` and no dependency manifest.

**What was wrong with the twenty-seventh.** Printed from Safari, the poster
came out whole on its first page and was followed by a blank second sheet. The
whole sheet, 210 by 296 millimetres, was given wherever
`@supports (page: auto)` held, on the reading that such a browser would give
the named page its margins. Safari has understood the `page` property since
its first release, has honoured `@page` at all only since 18.2, and refuses
`size: A4 portrait`. The sheet sat inside Safari's own margins. The check made
before that pass was an imitation in Chrome and could not have shown it:
Chrome shrinks an over-wide sheet to fit, and the shrunken sheet is one page.
The account of the mend, its bounds and its one failing case is the
correction at the end of `docs/CHANGE-REQUESTS/trunk-round-50.md`.

**Safari can be tested from this machine after all.** `docs/PRODUCTION.md` has
said since the twenty-third pass that it cannot. A short Swift program drives
the system's own WebKit through `WKWebView.printOperation(with:)`, with the
job's disposition set to save and no print panel, and what comes out is
Safari's real print pagination as a PDF. A second reads the code on a PDF's
first page with the Vision framework. Both are kept outside the repository
with the practice's other tools, as `wkprint.swift` and `qrdecode.swift`. Two
things they do not reach: Safari's own date and address lines, which the app
draws and WebKit alone does not, and any Safari but the one installed, 27.2.

**Before it merged.** `verify` and `verify-db` each read SUCCESS for the head
that merged, `95c1ad80`, and the merge was pinned to it. Security passed with
nothing. Compliance passed with three notes, all taken before the merge: the
bounds were looser than their own arithmetic ("at any margin" is true on A4
only of margins equal on all four sides), decision 3 of the first amendment
had nothing pointing to its correction, and "the cure" became "the fix". The
commit that took them moved comments and documents only, and the built
stylesheet's name did not change across it, which is how it is known that the
reviewers read the rules that shipped.

**The hold protocol.** `ListAgents` showed no other session on the machine.

**The build.** Archive `mcwellness-42d15d2.tar.gz`, 6,544,694 bytes, made with
`--prefix=mcwellness/`; TUS create 201, PATCH 204 with the returned offset
equal to the size; the keys read by `curl` from a file of mode 0600 deleted in
the same command. Settings read back before building and unchanged. Build
`01a0b66d`: asked for at 21:30:26, completed at 21:32:06. The served name was
seen changed at 21:32:08. **No restart — the eleventh consecutive pass without
one.** Health 200 in 0.24 s, deep 200 in 0.25 s, and 200 at every
fifteen-second poll across the build.

**Verified by the chunk, with the absence measured first.** Before:
`ExpoPosterPage-BSHEAOpT.css` holding `@supports (page` and `A4 portrait` and
no `poster-paper`. After: `ExpoPosterPage-DVtRjwF2.css`, 1,990 bytes, holding
`poster-paper` and `170mm`, with `@supports (page` and `A4 portrait` gone —
and that is the name a local build of this tree wrote. The page's script
moved from `ExpoPosterPage-CTvhCcV-.js` to `ExpoPosterPage-qg0W7m25.js` at the
same 22,031 bytes, because it names the stylesheet and nothing else in it
changed. The entry moved from `index-BxCLftPf.js` to `index-COOzlje7.js` and
is 476,584 bytes for the third pass running. The shell's stylesheet did not
move. The old entry and both old poster files 404, and a nonsense path 404s.

**The minifier rewrote the rule, so the served bytes were printed too.** What
was written as `(min-width: 209.5mm) and (max-width: 210.5mm)` is served as
`(width>=209.5mm) and (width<=210.5mm)`, and every print before the pass had
been of the unminified rule. So production's own stylesheets, its fonts and
its lockup were fetched, set beside the poster's markup, and printed: through
WebKit, **one page on A4 at the system's default margins, at 36 points, at 18
and at none**; through Chrome, one full page of A4. The code was then read off
every one of those five PDFs and says `https://app.mcwellnessuae.com/expo`,
including from Safari's smaller sheet.

**The browser's own small lines, which the operator asked next to have
removed.** In Chrome they are gone without anybody touching a setting, and
that was printed rather than assumed: with "Headers and footers" left on,
Chrome draws none, because the named page leaves it no margin to draw them
in. In Safari they cannot be removed by the page. An unnamed
`@page { margin: 0 }`, added through the CSSOM as the app's policy would
require, was tried in WebKit: the top margin went, the print system drew
"Page 1 of 1" over the corner regardless, and the sheet was left against the
top edge with the bottom of the page empty. It was not adopted. In Safari the
lines go when "Print headers and footers" is unticked in the print dialog,
and by no other means a page has.

**A file for the printer, made outside the app.** Because Safari cannot be
made clean from the page, a print-ready PDF was made for the operator: the
real page and the real stylesheet, the code drawn for the production address
by the page's own encoder, printed by Chrome as one page of A4 with no lines
on it. Its code was read back from the finished file, and again from the copy
as delivered, and says `https://app.mcwellnessuae.com/expo`. The earlier
laptop-made preview was read the same way as a control and says
`http://127.0.0.1:5199/expo`, which is why it was marked not for printing. A
PDF opened in Preview carries no browser's lines at all.

**Left as it was found.** Nothing was written to either database.

**Offered and not built:** a "Download PDF" on the poster's page, made by the
practice's own PDF writer, which would give every browser the clean sheet
without a setting. It needs the lockup as a plain RGB PNG, which the writer
can embed and the present palette file is not, and a route to serve it. It is
the operator's to ask for.

## What was done on 2026-09-18: the twenty-ninth live pass — the poster as a file, for Safari's own lines

**22:15 UTC on 18 September, which is 02:15 on 19 September in Dubai.** `main`
at `b1a2571` — pull request 193, and with it 191, the records of the two
passes before, which change nothing that runs. The third pass of one night on
one screen, each asked for by the operator from the printer's side: make it
the practice's own; make sure it is one sheet; take the small lines off.

**No migration and no policy file; both hosted databases stay at 106.**
Between `42d15d2` and `b1a2571` nothing under `db/` moved and no dependency
manifest moved.

**What the operator asked for, in their words:** to remove "McWellness", the
date and time, the page's address and "Page 1 of 1" from the print. Those four
are Safari's. A page cannot remove them, and the account of what was tried is
in `docs/CHANGE-REQUESTS/trunk-round-50.md`; what a page *can* do is hand
over a PDF, on which Safari has nothing to write. So the poster's page gained
"Download PDF" beside "Print": the same sheet drawn in the browser at 300 dots
to the inch and wrapped as one page of A4, with no route, no dependency and
nothing sent anywhere.

**Before it merged.** `verify` and `verify-db` each read SUCCESS for the head
that merged, `e358306d`, and the merge was pinned to it. Both reviews passed
on the first commit and what they found was taken in the second: security, a
canvas of some 35MB that WebKit counts against one ceiling until it is
collected, now given back at once; compliance, a failure message that hid the
sentence somebody then needs, three places that claimed the file "prints
clean" when it had been made and read and never printed, and a sentence that
said a box exists without naming it. The second commit was run again in both
engines, three files in a row, before it was pushed.

**The hold protocol.** `ListAgents` showed no other session on the machine.

**The build.** Archive `mcwellness-b1a2571.tar.gz`, 6,560,237 bytes, made with
`--prefix=mcwellness/`; TUS create 201, PATCH 204 with the returned offset
equal to the size; the keys read by `curl` from a file of mode 0600 deleted in
the same command. Settings read back before building and unchanged. Build
`01a0b695`: asked for at 22:13:55, completed at 22:15:29. The served name was
seen changed at 22:15:38. **No restart — the twelfth consecutive pass without
one.** Health 200 in 0.14 s, deep 200 in 0.18 s, and 200 at every
fifteen-second poll across the build.

**Verified by the chunk, with the absence measured first.** Before:
`ExpoPosterPage-qg0W7m25.js`, 22,031 bytes, with no "Download PDF", no
`DCTDecode` and no `poster__tools`, and holding `poster__print`. After:
`ExpoPosterPage-DoLbIQNV.js`, 27,853 bytes, holding "Download PDF",
`DCTDecode`, "untick" and `poster__tools`, with `poster__print` gone. The
stylesheet moved from `ExpoPosterPage-DVtRjwF2.css` to
`ExpoPosterPage-BNgYkyjd.css`, 2,206 bytes, **the name a local build of this
tree wrote**, and it still holds `poster-paper`, so the twenty-eighth pass's
mend came through. The entry moved from `index-COOzlje7.js` to
`index-BzxO880l.js` and is 476,584 bytes for the fourth pass running. The
shell's stylesheet did not move. The old entry and both old poster files 404,
and a nonsense path 404s.

**Why the page's script does not carry the local build's name and its
stylesheet does.** A local build wrote `ExpoPosterPage-Bes4Kl2c.js`. The
script imports the entry by name, the entry's name differs on the host because
the host's `VITE_*` values are built into it, and so the script's own bytes
differ by that one name. A stylesheet imports nothing. Compare stylesheets.

**The served stylesheet, printed.** As in the twenty-eighth pass, production's
own stylesheets, fonts and lockup were fetched and set beside the page's
markup, this time with the buttons and the sentence above the sheet: one page
through WebKit at the system's margins and at 18 points, one full page
through Chrome with its headers left on. The text of each page was read out
of the PDF and is the poster's five lines and nothing else, and the code on
each says `https://app.mcwellnessuae.com/expo`.

**The generator itself was not run from the served script**, and that is a
limit of this record rather than an oversight. The served script imports the
entry, which starts the whole app behind its sign-in, so it cannot be run
alone. What was run, in Chrome and in WebKit, is the same source before the
bundler, three files in a row, each one page of 210 by 297 millimetres with
the code read back. A bundler renames; it does not change what a canvas
draws.

**Not checked, and the owner's to try once:** Safari the application pressing
"Download PDF" and saving the file. It cannot be driven unattended. Its
engine made the file here; the press is the same five lines that already
deliver the books' CSVs and the expo's leads file in this app. Nor was the
file printed from Safari or Preview here: that neither writes its own lines
on a PDF is how both are known to behave.

**Left as it was found.** Nothing was written to either database.

**For the owner.** On `https://app.mcwellnessuae.com/admin/enquiries/poster`,
press "Download PDF", open the file, and print it. Scan the printed sheet
once with a phone; it should open `app.mcwellnessuae.com/expo`.

## What was done on 2026-09-19: the thirtieth live pass — enquiries in three tables, and a dismissed person's contact details kept where they were told

**00:39 to 00:50 UTC on 19 September, which is 04:39 to 04:50 in Dubai**, on
the operator's word ("go", to one pass shipping both rounds). `main` at
`b1e71c1f`: pull request 195 (the enquiries screen by status, with paging),
196 (kept details, migration 921) and 197, a record, which changes nothing
that runs. Between `70dee5ca`, where `verify` and `verify-db` had both read
SUCCESS, and `b1e71c1f` one file moved,
`docs/CHANGE-REQUESTS/trunk-round-54.md`; `verify` on `b1e71c1f` itself has
since read SUCCESS as well. 197 was merged pinned to the head whose two checks
each read SUCCESS, `97e72d71`.

**The gate this pass waited on.** The expo's form now tells a visitor that
their contact details are kept for follow-up, and the website's privacy page
had said enquiries are never used for advertising. The page was changed first,
with the operator's approval of the wording, at about 00:30 UTC; the account
is in `trunk-round-54.md`. The form's new wording went live only after it.

**The hold protocol.** `ListAgents` showed no other session on the machine,
before the database and again before the upload.

**The database first, after staging** (`docs/STAGING.md`, the pass of the same
night). Read before anything was written: 106 ledger rows and no `921`; 23
columns on `enquiry`; five rows, one waiting and four actioned, and **none of
the four would fail the constraint that replaces
`enquiry_actioned_is_scrubbed`**, because every one had been scrubbed whole.
Then, through Supabase's migration tool, `921_enquiry_kept_details` at
00:39:55, the statements staging took, word for word; its bookkeeping row with
the file's sha256 `473b3eb7…8858` at 00:42:25; and
`db/policies/enquiry/writers.sql`, whole, as `policies_after_921` at 00:42:32.
Read back: **107 rows.** The two and a half minutes between the migration and
its row are the record's to own: for that long the database had the change and
its ledger did not say so. Nothing reads that ledger on production but these
passes, and nothing ran between.

**Fingerprinted: all nine identical, production against staging against a
local database the runner built.** Columns `b0601857` (25), comments
`2a695ed2` (16), constraints `902f69ee` (20), functions `373e23e9` (2), grants
`d49c4fd3` (2), indexes `5a29c7bf` (6), policies `378a800f` (4), triggers
`554f6608` (2), ledger `ad77ad98` (107). What each category hashes is said in
the staging record.

**And the two things the round's own checklist says a hash or a count can
hide, read by eye on production.** `enquiry_guard_actioned` reads
`tgenabled = 'A'`, enabled always, which a plain `create trigger` does not
give. `enquiry_actioners` reads, in its `using`, `status = 'new' OR (status =
'dismissed' AND name IS NOT NULL)` with the three roles: the text that lets
"Erase details" reach a kept row, and without which it answers not found.
Fifteen check constraints, and `enquiry_actioned_is_scrubbed` is gone.

**Nothing was tried on production.** The refusals were proved on staging and
rolled back there. Here the five rows were read after the change and are as
they were: five, one waiting, four actioned and none of them named, all five
under the first wording (the column's default, which is the truth: each was
lodged under the promise that nothing personal is kept once replied to), the
news tick set on none. `app.verify_audit_chain()` returns null, its word for
intact.

**The schema led the code for eight minutes, 00:39:55 to 00:47:37, by
design.** The code then live lodged without naming a wording, which the new
function reads as the first; and it dismissed by scrubbing the row whole,
which is one of the two shapes the new constraint admits. So nothing the old
code could write was refused.

**The build.** Archive `mcwellness-b1e71c1f.tar.gz`, 6,606,592 bytes, made
with `--prefix=mcwellness/`; TUS create 201, PATCH 204 with the returned
offset equal to the size; the keys read by `curl` from a file of mode 0600
deleted in the same command. Settings read back before building and
unchanged. Build `01a0b721`: asked for at 00:46:37, completed at 00:47:42. The
served name was seen changed at 00:47:37. **No restart — the thirteenth
consecutive pass without one.** Health and deep health 200 throughout, deep in
0.15 to 0.27 s across six polls after the build.

**Verified by the chunk, with the absence measured first.** Before:
`EnquiriesPage-Cr8OcWX-.js` and `ExpoEnquiryPage-dSuReCU3.js`, holding none of
"Download news list", `sections__tab`, "Erase their details", "Show older" or
"Keep me posted", and the form still holding "keeps nothing personal". After:
`EnquiriesPage-_-AQd5OT.js`, 12,323 bytes, holding the first four, with "This
person was not told their details would be kept", "Keep their contact details
for follow-up", "Details erased" and the two-year chip's "still needed";
`ExpoEnquiryPage-DgRgK-P-.js`, 5,363 bytes, holding "Keep me posted", "such as
Instagram or TikTok", "we keep your contact details so we can follow up with
you later" and "You can ask us to delete them at any time", with "keeps
nothing personal" gone. The screen's stylesheet moved from
`EnquiriesPage-CKTI_GyE.css` to `EnquiriesPage-HA5XWOTi.css`, **the name a
local build of this tree wrote**; the form's, the poster's and the shell's
stylesheets did not move, and a local build agrees on all three. The entry
moved from `index-BzxO880l.js` to `index-DhCqp1J-.js`, 476,584 bytes for the
fifth pass running. The old entry, both old scripts and the old stylesheet
404, and a nonsense path 404s. `/expo` and the lockup answer 200, and the
served document still carries its content policy as a meta tag.

**That the running server is the new code was read from its own log, because
nothing else can show it.** The three new addresses (the list by status, the
news file, erase) each answer 401 to a stranger, but so does a made-up address
beside them: this API refuses a stranger before it looks at the path, so a 401
says nothing about which code is running, and earlier records that read it
that way read too much. The files prove only what is on the disk. The runtime
log does show it: a first line at 00:47:37.658, the process announcing its
storage, its scheduler and "Serving the built app from dist/"; the same six
lines three more times by 00:47:51, which reads as the host opening workers
under this pass's own burst of requests and not as a process falling over,
since there is no error, no line after it, and health never missed.

**Not checked, and why.** No enquiry was sent through the form to production:
it would be an invented person in the practice's real table, and the rule is
that nothing synthetic is written there. So the door's handing of the wording
and the tick to `app.lodge_enquiry` is held by the unit tests, the database
tests and the signed-in walk on a local database before 196 merged, and the
function itself by the block on staging. The first real enquiry from `/expo`
will be the first row under the second wording; on the Enquiries screen it is
the first that offers "Keep their contact details for follow-up" when
dismissed.

**Left as it was found.** Production's five enquiries are untouched. Staging
holds none.

**For the owner.** Enquiries now opens on Active, with Converted and Dismissed
beside it. Dismissing someone who came through the expo's new form keeps their
name and number unless "Erase their details" is chosen; dismissing anyone who
enquired before tonight, or through the website, erases them as before,
because that is what they were told. "Download news list" appears on Dismissed
once somebody who ticked the news box has been dismissed and kept. No list
goes to a social platform until that platform is in the vendor register.

## What was done on 2026-09-19: a data step, not a pass — the three test clients removed, and the first real client and invoice numbered one

No code changed, nothing was built and nothing was uploaded. Production stays
on `main` `b1e71c1f`, build `01a0b721`, 107 migrations. This is a record of rows
removed and two numbers changed, on the operator's word.

**What was asked.** The operator, 19:06 +04: the first three clients in the
database were entered as tests; remove them, keep the fourth, and renumber it
`MW-000001`. Asked whether the fourth client's invoice had reached them yet —
on paper, by email or by WhatsApp — the operator answered that it had not.
That answer decided the route, because the invoice's filed PDF prints the
record number and is locked. The choice was put to the operator on that
footing — an invoice already in a household's hands keeps its numbers, one that
is not can be put right before it goes — and the operator chose the full
renumbering.

**What production held.** Four clients, `MW-000001` to `MW-000004`. The second
and third were bare leads: a contact, the test enquiry each was converted from,
an unused portal invitation. The first was a full walk of the system: four
appointments, four sessions with 27 events and four visit records, five
consents, a goal, a draft report, a package purchase with 30 credits, a portal
login that had been used, a home address with four cached drive estimates, and
`INV-000001` for AED 0 with its filed PDF. The fourth, the real one, held five
consents, a package with 13 credits, and `INV-000002`, issued and unsent, with
its filed PDF. No payment, no receipt and no journal entry
existed anywhere, and both number series behind receipts and reports still
read 1.

**Rehearsed on production itself, inside a block that cannot commit.** Staging
holds no copy of these rows, so the whole step was written as one `do` block
whose last statement raises an exception carrying the counts. An exception
rolls the block back, so the rehearsal runs against the real rows and the real
foreign keys and leaves nothing. It is safe for the audit trail only because
`audit_log.id` is handed out by the chain's own anchor inside the transaction
and not by a sequence: `app.verify_audit_chain()` insists the ids are
contiguous, and a sequence would have burnt 86 of them on the rollback. Check
that before borrowing the method anywhere else. The first rehearsal failed, and
rolled back whole, on `drive_estimate`, which references `location` and carries
no `client_id` to find it by. The second passed, with every count matching the
inventory taken beforehand.

**The order, for whoever does this next.** Children first, since every foreign
key to `client` is `no action`: `session_event`, `visit_actuals`,
`entitlement`, `billing_document`, `invoice_line`, `report`; then `invoice` and
`package_purchase` **in one statement** (a data-modifying `with`), because each
references the other: the purchase's reference to its invoice is checked at the
end of the statement and the invoice's reference to its purchase is
`deferrable initially deferred` (`403_billing_entitlement.sql`) and checked at
commit, so one statement satisfies both; then `session`, `appointment`, `consent`, `document`, `goal`, `portal_invite`,
`enquiry`; then `client.primary_contact_id` and `primary_location_id` set to
null, `contact`, `client`; then `drive_estimate` and `location`; then
`user_role`, `app_user`, and the one `auth.users` row behind the login that had
been used. The guards on `document` and `report` both stand aside for the
owner's own maintenance, which is a connection with no `app.actor_roles` set;
the report was a draft, which may be abandoned in any case.

**The two numbers.** `client.mrn` went from `MW-000004` to `MW-000001`.
`invoice.number` went from 2 to 1; `reference` is generated from it and reads
`INV-000001` without being touched. `invoice_number_series.next_number` went
from 3 back to 2. There is no series behind the record number: `app.next_mrn`
reads the highest one in use, and answers `MW-000002`. The invoice's filed PDF
and its `billing_document` row were removed with the rest, so that the first
time the invoice is opened the app files it afresh through its own renderer,
under the numbers it now carries.

**Rules 7 and 8, said plainly.** Rule 7 as written covers this invoice: it was
issued in the app, and an issued invoice gets a new version, never an edit in
place. It was set aside for this one invoice, on the operator's choice, because
the invoice had reached nobody; the old number and the old record number are in
the audit trail, and this is not a precedent for an invoice that has been sent.
Rule 8 keeps financial records five years: the rows removed were a test entry's
AED 0 invoice, its line and its purchase, which record no supply to anyone. The
real client's invoice, line and purchase were kept.

**Counts removed.** 27 session events, 4 visit records, 30 credits, 2 billing
documents, 1 invoice line, 1 draft report, 1 package purchase with its invoice,
4 sessions, 4 appointments, 5 consents, 5 documents (four of the test client's
and the real invoice's PDF), 1 goal, 4 portal invitations, 2 enquiries, 3
contacts, 3 clients, 4 drive estimates, 1 location, 3 role grants, 3 portal
users and 1 sign-in. The block checked its own result before it was allowed to
finish: one client, numbered `MW-000001`; one invoice, `INV-000001`; the next
record number `MW-000002`; the real client still holding 13 credits and 5
consents; the audit chain verifying.

**Read back afterwards.** One client, a lead. One invoice, `INV-000001`, its
amount and issue date as they were. Next invoice number 2. Thirteen credits, five
consents, one purchase, one invoice line, one contact. Two stored documents,
both the real client's signatures. Three enquiries, none naming a client. No
`client_contact` role left, and no sign-in without a user behind it.

**The files.** Five objects had lost their rows: the test client's invoice PDF
and three signature images, and the real invoice's old PDF. They were removed
through the storage API, 200 with five names returned, the key read by `curl`
from a file of mode 0600 deleted in the same command. Two objects remain under
client paths and both have rows.

**The audit trail.** 1,735 rows before and 1,833 after. 86 of the new rows are
this step, every one carrying the operator's reason, a request id, the old
values, and `system` as the actor, the same shape as the removal of
2026-09-10. The other 12 are the operator reading the client list and a client
record in the app while the step ran. `app.verify_audit_chain()` returns null,
before, after the failed rehearsal, after the step and after the files went.
`enquiry` has no audit trigger by design, so the two test enquiries leave no
row of their own; nor do the 27 session events, whose trigger fires on insert
only; nor does the one sign-in, which lives in `auth` and is not the app's
table. This section is their record. That is how 86 reconciles: the other 80
rows removed left one each, the three clients' unlinking left three more, and
the two numbers and the series left three.

**Not done, and why.** The fresh PDF was not filed from here: filing is a
signed-in act of the invoice book's audience, and the app does it the first
time the invoice is opened. The off-site backup's weekly dumps taken before
tonight still hold the test rows; they were never real people, and
`.github/workflows/backup.yml` drops a dump once it is ninety days old.

**For the owner.** The client list shows one client, `MW-000001`. Open their
invoice once before sending it: that files the new PDF, which will read
`INV-000001` and record number `MW-000001`. The next client enrolled becomes
`MW-000002` and the next invoice `INV-000002`.

## What was done on 2026-09-19: the thirty-first live pass — the clients list's record, age and status fit what they hold

Production runs `main` `90a4a6ba`, build `01a0bacb`, on the operator's "go
live" at 21:50 +04. Front end only: no migration, both databases stay at 107,
and nothing was written to either.

**What went live.** Pull request 201. On the clients list the Record, Age and
Status columns are as wide as what is in them and no wider, which the operator
asked for with a picture of the live screen at 19:31 +04. The shared `Table`'s
`Column` gains `fit`, answered by one rule in `app/shell/shell.css`; the table
is as wide as the page and an automatic layout had been sharing the spare room
among every column, so a record number took 321px for a 115px value. Measured
in a browser before it merged, at 1786px and at 390px: no spare pixel on the
three columns, nothing clipped, the first column still pinned. Pull requests
198 and 200 are in the same archive and are records only.

**The pass.** No other session was working (one peer, idle for a day). The
before-state was taken first: entry `index-DhCqp1J-.js`, shell stylesheet
`index-DSJRZKuA.css`, at 17:50:36 UTC. The stored build settings were read back
and sent unchanged. Archive `mcwellness-90a4a6ba.tar.gz`, 6,614,848 bytes, made
with its `mcwellness/` root folder from `origin/main`; TUS create 201 and PATCH
204 with the offset equal to the size, the keys read by `curl` from a file of
mode 0600 deleted in the same command. Build asked 17:51:31 UTC, the served
names changed 17:53:03, the build read `completed` 17:53:08.

**Proved to be this tree, not only a build.** A local `pnpm build` of
`90a4a6ba` wrote `index-CfzNQSKK.css`; the site serves a stylesheet of that
name, and the two are the same bytes, 37,762 of them, with the same sha256
(`fe6070b8…`). This round changed the shell's own stylesheet, so that is the
file to compare. The served bytes hold
`.ledger th.fit,.ledger td.fit{white-space:nowrap;inline-size:1%}`. The entry
is now `index-DfRDHcin.js`; the clients screen's script, read out of it, is
`ClientsPage-DiKvdXle.js`, and it carries the switch three times. Both old
names answer 404, and so does a name that never existed, so the host is not
answering 200 to everything.

**The process is the new one.** The runtime log holds a fresh start-up block
stamped 17:53:03, the second the names changed, ending "Serving the built app
from dist/" and "API listening", with `started_at` 17:53:03 against
`last_deployed_at` 17:53:08 and no error line. The block appears four times in
seventeen seconds, which is the host opening workers under this pass's own
burst of requests, as on the thirtieth. **No restart — fourteenth consecutive.**
Health 200 in 0.24 s, deep 200 in 0.33 s.

**One red run on the way, and not this change's.** Pull request 201's second
commit, which changed two comments and a lint test, failed `verify` once on
`tests/accounting/BooksPage.test.tsx`, the case that lets Tab reach the drawer's
width handle. It had passed on the first commit, passes every time on a laptop,
and is the only time this case has failed in the last sixty `verify` runs. The
other red run in that span, on `main` on 13 September, was
`app/shell/App.test.tsx`'s lazy-chunk case, read back from its log; a first
attempt that failed the same evening and passed on its rerun no longer has a
log to read. This one went green on a rerun of the failed job. The assertion showed focus still on a button after Shift+Tab, not
on the handle, which reads as the drawer's key listener not yet attached when
the test pressed Tab: a test that does not wait for the drawer to settle. That
is a reading and not a finding: it was not reproduced.

**Not checked, and why.** The screen was not opened signed in from here: it
sits behind the owner's sign-in, and the served stylesheet and the screen's
script are what a browser will be handed. The widths themselves were measured
before merge against the same stylesheet source.

**For the owner.** Reload the Clients screen. Record, Age and Status now sit
tight to their contents and the name, the contact and the emirate take the
room. Status grows by a few pixels when a row says "Active" or "Paused"
rather than "Lead", because it fits whatever is in it.

## What was done on 2026-09-20: the thirty-second live pass — an emirate filter, a rule between every column, and a window that finds out there is a newer build

Production runs `main` `336dac4d`, build `01a0bce5`. No migration: `main` holds
107 migration files and both databases stand at 107, and nothing was written to
either.

**Why it began.** The operator, 06:51 +04, nine hours after the thirty-first
pass: the tightened client table was still not showing. The pass was sound. The
site served the new stylesheet byte for byte; the index page is sent `no-store`
and the host's cache marks it `DYNAMIC`; the worker's precache list was pulled
out of `/sw.js` and all 111 files answered 200 with the right types, so a new
worker could install; no module stylesheet overrides the rule; and the real
Clients screen, signed in on a laptop against the seeded practice at the
operator's window width, showed the three columns with no spare pixel. What had
not changed was the operator's window: the console is run installed, with no
reload button, and a single-page app fetches its code once. Reloading it shows
the build. `docs/CHANGE-REQUESTS/trunk-round-56.md` has the whole of it.

**No "go" was given; one was inferred.** At 07:35 +04 the operator wrote: "so
is it done and i can move to another edit or not yet, i still did not see the
filter by emirate live nor the columns borders". Rounds 55 and 56 were merged
and not deployed, which had been said. The operator was looking for them on the
live site, and that was read as the instruction to put them there; they were
told so before anything was uploaded, and the pass began at 07:36. That is a
reading, not a quotation of an instruction, and the thirtieth and thirty-first
passes had the plain word that this one did not.

**What went live.**

- Round 55, pull request 203. `GET /api/clients` takes `emirate`, one of the
  seven codes or a 400; it reads the client's primary address, the one the
  Emirate column shows; it narrows with status and search. The Clients screen
  gains an Emirate select beside Status, not offered to a finance account, which
  reads no address and would always be answered "nobody". A practitioner's empty
  list says nobody matched when a filter is on. Every `.ledger` table gains a
  hairline between every pair of columns.
- Round 56, pull request 204. When the window is looked at again, at most once
  in five minutes once it has had an answer, it fetches `/` with no cookies and
  no cache and reads the
  entry script's name; once that differs from the one it is running, the rail's
  links load the document afresh. It never reloads by itself and does not ask
  the service worker to update.

**The pass.** No other session was working: one peer idle for a day, one that
opened seconds before and was not this machine's work. Before-state at 03:36:03
UTC: entry `index-DfRDHcin.js`, shell stylesheet `index-CfzNQSKK.css`. Stored
build settings read back and sent unchanged. Archive
`mcwellness-336dac4d.tar.gz`, 6,629,341 bytes, with its `mcwellness/` root
folder; TUS create 201 and PATCH 204 with the offset equal to the size, the keys
read by `curl` from a file of mode 0600 deleted in the same command. Build asked
03:39:42 UTC; one poll at 03:40:49 went unanswered while the host switched; the
served names changed 03:40:58; the build read `completed` 03:41:00.

**Proved to be this tree.** A local `pnpm build` of `336dac4d` wrote
`index-DH9UTXuv.css`; the site serves a stylesheet of that name and the two are
the same 38,332 bytes with the same sha256 (`f379810d…`). It holds the column
rule as written and still holds the fitted-column rule. The entry is
`index-xXdM6r0T.js`; the clients screen's script, read out of it, is
`ClientsPage-cBdstWRH.js`, which holds "Any emirate", sets the `emirate`
parameter beside `status` and `q`, and still carries the fit switch three
times. The entry holds the build check, `cache: no-store` with
`credentials: omit`, and `reloadDocument`. Both old names answer 404, and so
does a name that never existed.

**A search that finds nothing is not a finding.** Two of the first greps came
back zero, for the `emirate` parameter and for the build check, and both were
there: the minifier writes strings in backticks, and the patterns had asked for
double quotes. Read a stretch of the served bytes around the word before
believing a count of nought.

**The process is the new one**, which matters more than usual because half of
round 55 is a route. The runtime log holds fresh start-up blocks from 03:40:58,
ending "Serving the built app from dist/" and "API listening", with
`started_at` 03:40:58 against `last_deployed_at` 03:41:00 and no error line.
**No restart — fifteenth consecutive.** Health 200 in 0.34 s, deep 200 in
0.29 s.

**Not checked, and why.** The filter was not used signed in on production: it
sits behind the owner's sign-in. It was walked signed in on a laptop against the
seeded practice before merge (the seed's 20 invented clients: 3 in Abu Dhabi, 1
of them active, 2 in Fujairah, 20 again), its route is held by nine database
tests including a booked practitioner and a
finance account, and an unsigned request to it answers 401 like every other,
which says nothing either way. The new-build check was walked end to end on a
laptop against a production build with its service worker active, and cannot be
seen on the live site until the pass after this one gives it something to find.

**For the owner.** Reload the window once, with Cmd+R or by quitting and
reopening: this is the last pass that needs it. Clients then has an Emirate
filter beside Status, and every list in the console has a line between its
columns. A client with no address yet appears only under "Any emirate". After
future passes, clicking back into the window and choosing any section in the
sidebar brings the new version by itself.

## What was done on 2026-09-21: the thirty-third live pass — an admin never mints a password for an owner

Production runs `main` `190620fb`, build `01a0c518`. No migration and no policy
file: `main` holds 107 migration files and both databases stand at 107, and
nothing was written to either.

**Why it began.** The operator asked for Settings › Team to become an
employee's profile with access that switches on and off. Reading the team's
routes to design that found a fault in one of them, which was fixed first, by
the operator's choice, as round 57 (pull request 207,
`docs/CHANGE-REQUESTS/trunk-round-57.md`). It was found by reading. Nothing in
the trail suggests it was ever used.

**The word was one word.** With round 57 merged, the operator was told that
production still had the fault until a build and a restart, that the repository
is public and the merge describes it, and was asked when it should go live,
with the recommendation "soon". The answer, at 21:49 +04, was "Soon". That was
read as the instruction, said back to the operator as such before anything was
uploaded, and the pass began at 21:50. It is a reading of one word, not a
quotation of "go live".

**What went live.**

- `POST /api/team/:id/password` reads the target's roles and answers 403 for an
  owner unless the person asking is an owner, before a password is minted and
  before the sign-in service is called. Until this pass an admin could be shown
  a working password for the owner's sign-in: suspending an owner was always
  refused by row security underneath, and a password is set at the sign-in
  service, where nothing is underneath.
- The refusal is written to the trail as `password_reset_refused`, under the
  asker's id. With the button gone from the screen, that 403 can only be a
  request made by hand.
- The rule refuses an empty list of roles, so a check that could not see the
  target never answers yes.
- Settings › Team offers an admin no **New temporary password** on an owner's
  row. An owner may still mint one for another owner.

**The pass.** No other session was running on this machine. Before-state at
17:50:44 UTC: entry `index-xXdM6r0T.js`, shell stylesheet `index-DH9UTXuv.css`,
team screen `TeamPage-CZ6CXZet.js`, health 200. Stored build settings read back
and sent unchanged (Node 24, `hono`, root `mcwellness`, output `.`,
`build:production`, `app/api/start.mjs`, npm). Archive
`mcwellness-190620fb.tar.gz`, 6,600,315 bytes, with its `mcwellness/` root
folder, and `canResetPassword` read back out of the archive before it left. TUS
create 201 and PATCH 204 with the offset equal to the size. The upload keys were
passed on the command line this time and not from a file of mode 0600 as the
thirty-second pass did; they are the file browser's own, scoped to the upload
and expiring in six hours. Build asked 17:51:59 UTC, read `completed` 17:52:54;
the served names changed by 17:53:17.

**Proved to be this tree.** The stylesheet's name did not move, and should not
have: the round changed no style. So the proof is the rule itself, read off the
live site. The entry is `index-7HRUk0iB.js`; the team screen's script, read out
of it, is `TeamPage-MhA2bxdf.js`, 5,957 bytes against the old 5,816, and it
holds

`t.length===0?!1:!t.includes(`owner`)||e.includes(`owner`)`

which is `canResetPassword` as the minifier writes it, the empty-list refusal
from the round's reviews included. The old chunk, saved before the upload,
holds no `includes` of `owner` at all. Both old names answer 404, and so does a
name that never existed.

**The process is the new one**, which is the half that matters: the rule on the
screen is a courtesy and the rule in the route is the boundary, and both came
out of one archive into one build. The runtime log holds fresh start-up blocks
at 17:52:49, 17:52:55 and 17:53:17, each ending "Serving the built app from
dist/" and "API listening", with `started_at` 17:52:49 against
`last_deployed_at` 17:52:54 and no error line. **No restart — sixteenth
consecutive.** Health 200 in 0.49 s, deep 200 in 0.39 s.

**Not checked, and why.** The refusal was not provoked on production: it takes
an admin's sign-in, which is a colleague's, and an attempt on the owner's
password is not something to stage against the practice's real sign-in service.
It was watched answering 200 and then 403 against a real database before merge,
with the sign-in provider spied on and never called, and CI's `verify-db` ran
the same test on the merged commit. Round 56's new-build check, which the
thirty-second pass said could first be seen on the pass after it, was not
watched either: it needs the owner's own open window.

**Corrected in this record's pull request.** Round 57's note, one comment in
`domain/shared/staff.ts` and two in its tests were dated 22 September. The
laptop they were written on keeps a clock ten hours ahead of Dubai; in the
practice's time the round, its merge (21:45 +04) and this pass all fell on the
21st. Dates only.

**For the owner.** Nothing to do, and nothing looks different on your own
screen. Click back into the window and choose any section in the sidebar and it
brings this version by itself; this is the first pass where that can be seen.
For an admin, the owner's row on Settings › Team no longer shows **New temporary
password**.
