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
