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
  `WARN`, unrelated to this pass.

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
line. Record it here as the fourth live pass.

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
