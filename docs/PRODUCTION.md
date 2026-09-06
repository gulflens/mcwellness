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
  never to make a second practice.
- **The legal name is blank.** It is printed on every invoice.
- **No sign-in account id.** Step 1 has not been done, or the User UID was
  not pasted in.
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
(`app.audit_chain`, `app.erasure_active`, `app.setup_photo_filing`). This is
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
