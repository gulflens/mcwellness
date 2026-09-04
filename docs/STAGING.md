# Wiring the Supabase staging project

The code is ready for Supabase; the project is the missing piece. This is the
order of operations once it exists, written for the owner, with the one
command or setting each step needs. Staging holds synthetic data only
(docs/COMPLIANCE/approved-vendors.md); nothing here ever points at the old
app's production project, which the repository's hook blocks by name.


## Current project

Created 2026-09-02 by the owner's instruction, after the paused June project
was deleted: **`mcwellness`**, reference `ajjkvjtqxktkgrvcrzkh`, region
Mumbai (`ap-south-1`), on the organisation's Pro plan. It holds synthetic data
only. The old app's production project (`mcwellness-app`) is a different
project and is blocked by name in this repository's hooks.

- API URL: `https://ajjkvjtqxktkgrvcrzkh.supabase.co`
- Direct database host: `db.ajjkvjtqxktkgrvcrzkh.supabase.co`, port 5432
- Pooler: `aws-0-ap-south-1.pooler.supabase.com`, port 6543, role
  `mcwellness_api.ajjkvjtqxktkgrvcrzkh`
- Publishable key: public by design and safe in the browser, but it lives in
  `.env.staging` and the build settings, never in this repository; the
  dashboard's API settings show it.

The database password and the API role's password never appear in this
repository; on the laptop they live in the ignored `.env.staging`.


## What was done on 2026-09-02, and what is left

The schema and the seed went in without a database password on the laptop:
the permission layer of the assistant's tooling refuses to mint one, and the
password Supabase generated at creation was never retrieved. Nothing needed
it.

- The twelve migrations were applied one at a time, verbatim, through
  Supabase's migration tool, then the three policy files, then the runner's
  bookkeeping table and its twelve rows exactly as `db/runner/apply.ts`
  writes them, so a later `pnpm db:migrate` sees nothing pending.
- The hosted schema was fingerprinted against a freshly migrated local
  database (functions, columns, constraints, indexes, triggers, policies,
  row-level security, grants, partitions): all nine parts identical.
- The API role received a generated password, held only in `.env.staging`.
  From the laptop it connects over the session pooler at
  `aws-0-ap-south-1.pooler.supabase.com`, with its ten-second statement
  timeout in force and no rows visible without tenant context.
- The synthetic practice was rendered as SQL with `pnpm seed:sql` under the
  staging identity key and applied in one transaction. Every table's content
  fingerprint matches a local seed, all 159 audit rows carry the seed's
  reason and request id, the chain verifies, and the six sealed identifiers
  open under the staging key and match their keyed hashes.
- The API, started with `.env.staging` and serving the built app, answers
  health, keeps the development door closed, refuses forged tokens, and
  sends a content security policy naming the staging project.

Left for the owner, in the dashboard under Authentication, Users, "Add
user": four accounts with these exact emails, any password, and "Auto
Confirm User" ticked. The assistant must never create sign-in accounts.

| Email | Person in the seed |
|---|---|
| hazel.harbour@example.com | the owner |
| jasper.ridge@example.com | a practitioner |
| laurel.summit@example.com | a practitioner |
| rowan.meadow@example.com | an admin |

Once they exist, one statement links each account to its seeded person by
email (`update app_user set auth_id = ...`), then the exit test runs and
`trunk-v1` is tagged.

**Done differently, and done.** Instead of the four synthetic accounts the
owner chose two real staff accounts, created in the dashboard on
2026-09-02: the owner herself (role owner) and the practice mailbox (role
admin), each added as a person in the synthetic practice with no phone
number and linked by email. The exit test passed the same afternoon: the
owner signed in through Supabase Auth to the built app served with the
staging settings, the API resolved her as owner, the client list showed
the twenty synthetic clients, and the audit trail holds one `list` read
per client under her account with the owner role and a request id, chain
intact. `trunk-v1` is tagged on main. Real clients stay out of staging: it
is approved for synthetic data only. The six sealed identifiers seeded that
day predate the generator's Luhn check digit (trunk round 2): they will not
validate, and their keyed hashes differ from what the generator now produces,
so a hashed lookup would miss them. Nothing on staging reads them yet. The
trunk reseeds staging before the first feature that does (a fresh render with
`pnpm seed:sql` after the practice is cleared), and records it here.

## What was done on 2026-09-03

- **Caught up.** Staging had stopped at migration 096 while the trunk and
  the four streams added nine more. The nine were applied one at a time
  through Supabase's migration tool (097 to 099, 100, 200, 300, 301, 400,
  900), the eleven policy files re-applied, and the bookkeeping rows
  written, so `schema_migration` holds twenty-one rows. Fingerprinted
  against a fresh local database: functions, constraints, indexes,
  triggers, policies, row-level security and grants identical. One
  cosmetic difference stands and is accepted: on staging the
  `schema_migration.checksum` column was added by migration 900 (third
  column, nullable) whereas a fresh local database is bootstrapped with it
  second and not null. Nothing reads the column's position, and the runner
  treats an empty checksum as a legacy row.
- **A demo the owner can walk.** The owner's own account was given the
  `lead_practitioner` role alongside owner, a practitioner row
  (`00000005-0000-4000-8000-0000000000aa`), one neurofeedback credential
  whose certificate number is the literal `STAGING-DEMO` (not a real
  certificate; dates are placeholders), and one confirmed home visit on
  2026-09-03 at 10:00 Dubai time with the synthetic client MW-000005 at
  that client's seeded home. Every row was written under the owner's own
  actor id with the reason "Staging demo set-up", so the audit trail names
  it. The visit is only bookable to check in on its own day: the demo
  needs a fresh visit row for any later day.
- **How to walk it from another device.** On the laptop, build the app and
  start the API with the staging settings and `HOST=0.0.0.0` so it serves
  the built app on the local network (the development door stays closed
  under staging settings, so binding beyond loopback is allowed); then
  open the laptop's address on the same Wi-Fi from the iPad, sign in as
  the owner through Supabase Auth, and go to "Check in": MW-000005,
  neurofeedback session, home.
- **Staging carries no prices yet, and must be brought up to them.** The
  seed now writes the practice's own figures — a price for each service the
  practice charges for, and the Silver, Gold and Platinum programmes with
  their contents, their list price and their launch price (trunk round 15,
  `docs/CHANGE-REQUESTS/billing-03.md` section 2). Staging was seeded before
  they existed, so its price list and its bundle catalogue are both empty and
  the money screens there show nothing. Two ways out, and the trunk records
  which was taken: reseed staging from a fresh `pnpm seed:sql` render after
  clearing the practice — the same reseed the sealed identifiers above
  already owe — or, to keep the demo's own rows, apply just the price,
  package, package_component and package_price statements from a render,
  which reference nothing but the tenant and the service types already
  there. Either way it waits on billing's migration 401, without which the
  three package tables do not exist on staging at all.

## What was done on 2026-09-03, second pass: the rebuild

Staging was two things behind: thirteen migrations, and a practice seeded
before the price list, the programmes and the Luhn check digit existed. The
first of the two ways out named above was taken — clear the practice and reseed
it from a fresh render — so both debts are settled at once and nothing on
staging is a patched-up version of an older seed.

- **The practice was cleared**, in one transaction:
  `truncate public.tenant cascade`. Everything the synthetic practice owns
  hangs off that row, so one statement empties all of it and leaves the schema,
  the roles and the bookkeeping alone.
- **Thirteen migrations were applied** one at a time through Supabase's
  migration tool: 201, 302 to 304, 401 to 405, and 901 to 904.
  `schema_migration` now holds thirty-four rows. The legacy rows whose checksum
  was null were backfilled and the column set not null, which is what the
  runner itself does, so a later `pnpm db:migrate` sees nothing pending and
  nothing unexplained.
- **Twelve policy files were re-applied**, in path order, the way the runner
  applies them.
- **The practice was reseeded whole.** Rendered from main at `de84cd0` with
  `pnpm seed:sql` under the staging identity key, and applied as one
  transaction: the tenant, the people, the services, the price list and the
  three programmes, the twenty clients with their contacts, homes and consents.
  The catalogue is in this time, so the money screens have something to show.
- **Fingerprinted against a fresh local database**, table by table, and
  identical but for two differences that are expected and benign:
  `user_role.granted_at`, which defaults to the wall clock and so records when
  each row was written, and the position of `schema_migration.checksum`, which
  on staging was added as a third column by migration 900 where a fresh local
  database is bootstrapped with it second. Nothing reads either.
- **The two real accounts were restored and linked**: the owner (with
  `lead_practitioner` added alongside owner) and the practice mailbox as admin,
  each linked to their person in the practice by email. Real clients still stay
  out: staging is approved for synthetic data only.
- **The demo was rebuilt** on top: the owner's practitioner row
  `00000005-0000-4000-8000-0000000000aa`, one neurofeedback credential whose
  certificate number is the literal `STAGING-DEMO` (not a real certificate),
  and one confirmed home visit with MW-000005 at 10:00 Dubai time on the day of
  the rebuild, at that client's seeded home. Its `busy_end` was computed by the
  trigger to 11:15 rather than typed. A later day needs a fresh visit row, as
  before.
- **`checkin_context` was found and answers**, so the check-in screen has the
  visit, the client and the consents it reads.
- **The audit chain verifies** end to end, every row under its own reason.

### What the owner does next, in this order

1. **Make the bucket.** In the staging project, under Storage, "New bucket":
   name it `documents`, public **off**. The details are in section 5a below;
   nothing else about it needs deciding.
2. **Give the API a storage credential.** Copy a **service** key from the
   project's API settings — never the anon key, which the browser holds and
   which storage does not fence — into `.env.staging` as
   `SUPABASE_STORAGE_KEY`, and set `STORAGE_PROVIDER=supabase` in the same
   file. `SUPABASE_URL` must be there too, naming the project the bucket sits
   in; the store cannot be reached without it. That replaces the `local`
   stopgap that has been standing in, and its `STORAGE_DIR` line can go: a
   folder on the laptop was never where staging's documents belong — and the
   upload command in step 3 refuses to run in that state rather than filing
   eight files on the laptop while staging's rows point at nothing.
3. **Put the wording in the bucket**, from the repository, once:

   ```bash
   node --env-file=.env.staging --import tsx scripts/upload-consent-wording.mjs
   ```

   It prints one line per file — the key, the size, and whether it was uploaded
   or was already there — and uploads nothing the second time. Until it has
   run, the eight consent wording rows on staging point at nothing, which shows
   the moment anyone opens a consent.

## What was done on 2026-09-03, third pass: the patch

After the rebuild, main gained the client-record stream's consent capture
(migrations 101 to 103) and the seeded contact names (pull request 47). On
staging: the three migrations were applied through Supabase's migration
tool in filename order with their bookkeeping rows (37 rows now, none with
an empty checksum); all twelve policy files re-applied; the 23 contacts
were given their English and Arabic names from a render of the seed at the
merge of 47, applied as an update under the seed's own session settings,
which cost 23 audit rows a fresh seed would not write. Fingerprints of
columns, constraints, indexes, policies, functions and triggers identical
to a fresh local database; the audit chain verifies over 638 rows; the
owner's demo rows intact. The file store still runs as the local stopgap
until the operator's three steps above are done.

## What was done on 2026-09-03, fourth pass: the practice's identity

After pull request 49, migration 905 was applied to staging through
Supabase's migration tool with its bookkeeping row (38 rows now, every one
with a checksum; it carries no policy statements). Under the owner's own
actor settings the practice's registration facts were entered on the
tenant row from its licence and its Federal Tax Authority certificate:
legal name in English and Arabic, the Meydan Free Zone licence number and
its expiry, the corporate-tax registration number, the registered address
as the tenant's own location row, and VAT registration recorded as "not
registered" (no VAT certificate is among the practice's documents). The
identity guard was proved to refuse the same change from a lead
practitioner. `tenant` and `invoice` fingerprint byte-identical to a fresh
local database; the audit chain verifies over 641 rows. These facts are
the practice's own public registration data; they live on staging's tenant
row and in the operator's documents, never in the repository or the seed.

## What was done on 2026-09-04, fifth pass: catching up with main

Main had reached `5663f18` and staging had stopped at 905. Eight migrations
were missing — the client-record stream's erasure act and its reach into the
visit, scheduling's settings table and its move-and-cancel columns,
session-capture's check-in status, billing's VAT registration and its rendered
documents, and the trunk's own redaction of a requester's phone number.

- **Eight migrations were applied** one at a time through Supabase's migration
  tool, in filename order: 104, 105, 202, 203, 305, 406, 407 and 906. Each was
  applied under the same audit context the runner sets — `app.reason` naming
  the file, and a fresh request id — so anything a migration wrote is
  attributable to the migration that wrote it. `schema_migration` now holds
  **forty-six rows**, one per file in `db/migrations`, every one carrying a
  checksum. The thirty-eight rows already there were checked against the files
  on disk before anything was applied: all thirty-eight matched, so no merged
  migration had been edited behind the runner's back. Afterwards the whole
  bookkeeping table — filename and checksum, in filename order — hashes to
  the same value on staging, on a freshly migrated local database, and from
  the files themselves, so `pnpm db:migrate` pointed at staging would see
  nothing pending and nothing unexplained.
- **Thirteen policy files were re-applied**, in path order, in one
  transaction, the way the runner applies them. Twelve is the number the
  earlier passes record; the thirteenth is
  `db/policies/scheduling/scheduling_setting_access.sql`, which arrives with
  migration 202 and had nowhere to be applied before it. One hundred and four
  policies stand on `public` afterwards, matching a fresh local database
  exactly.
- **The practice got its notice period.** Migration 202 carries a data step
  for practices that already exist, and staging is the real one it was written
  for: the tenant now has a `scheduling_setting` row of twenty-four hours'
  notice and an unfit-to-attend fee of AED 150, the operator's two figures of
  2026-09-03. That insert is the only row this pass wrote to an audited table,
  and its audit row names `migration 202_scheduling_setting.sql` as the reason.
- **Nothing else was owed to the seed.** `git log de84cd0..5663f18 -- db/seed`
  shows the seed learned three things since the reseed: the contact names
  (already on staging from the third pass), the synthetic practice's own
  identity fields, and a script that files the consent wording in a bucket.
  None of them is a row staging lacks. Every table the seed writes was
  compared against a freshly seeded local database, column by column with the
  keyed identifiers left out, and all of them match byte for byte — the
  services, the price list, the three programmes and their contents, the
  twenty clients, the twenty-three contacts with their English and Arabic
  names, the forty-two consents and the eight wording documents. Two tables
  differ by their generated identifiers alone and by nothing else:
  `goal_category` and `vat_setting`, whose rows are written by migrations 100
  and 400 with `gen_random_uuid()` defaults, so their ids are per-database by
  construction and nothing reads them across one. With the ids set aside, both
  hash identically.
- **Fingerprinted against a fresh `pnpm db:reset && pnpm db:migrate`** on the
  trunk's own local database. Seven of the eight parts are identical:
  columns (1,077), constraints (409), indexes (398), policies (104),
  functions (57), triggers (198) and row-level security (60). Two differences
  stand, both expected and both benign:
  - **Grants.** Staging carries 939 table grants to a local database's 512.
    Every one of the extra rows belongs to Supabase's own `service_role`,
    which mirrors `postgres` and does not exist on a laptop. The grants that
    matter are identical: `app_role` holds the same eighty-five, hashing to
    the same value on both, and `anon` and `authenticated` hold nothing at all
    on `public`, which is what every migration's `revoke all` intends.
  - **The position of `schema_migration.checksum`**, third on staging where a
    fresh local database has it second, carried since migration 900 added it
    to a database that already had the table. The earlier passes record it and
    it still stands. Nothing reads the position, and the column is now `not
    null` on both.
- **The audit chain verifies** end to end, over 646 rows, with no broken link.
  Five of those rows arrived after the fourth pass and before this one — the
  VAT registration, the owner's psychology-degree credential replacing the
  `STAGING-DEMO` placeholder, and a demo visit re-booked for the current day —
  and the sixth is this pass's own, from migration 202.
- **The demo is intact and needed no rebuilding.** The owner's practitioner
  row `00000005-0000-4000-8000-0000000000aa` stands, her credential covers the
  neurofeedback service and has no expiry, and a confirmed home visit for
  MW-000005 sits on **2026-09-04 at 10:00 Dubai time**, window closing at
  10:45 with the trigger's own `busy_end` at 11:15, at that client's seeded
  home. `app.checkin_context` answers for it: the client resolves, and two
  consents are active. A later day still needs a fresh visit row, as before.

### What the tenant row says about VAT, and the caution that goes with it

Reported here without being changed, because it is the operator's own
statement and not the assistant's to revise: the tenant row currently records
the practice as **registered for VAT**, with a fifteen-character VAT number
against it, entered on 2026-09-04 at the operator's direction. Its
corporate-tax registration, legal name in English and Arabic, licence number
and expiry (2027-05-09) and registered address are all present from the fourth
pass.

Two things follow, and both are worth saying plainly.

**Only a corporate-tax certificate has been seen.** The practice's documents
hold a corporate-tax registration and no VAT certificate — that is what the
fourth pass recorded when it set the row to "not registered", and it is why
`db/migrations/406_billing_vat_registration.sql` and
`docs/SPEC/billing.md` section 5.1 both say the AED 375,000 threshold has not
been crossed. The switch now says otherwise on the operator's word alone. If
the certificate exists it should be filed; if it does not, the switch is the
thing to correct, and correcting it is a one-column update, not a migration.

**The switch is now load-bearing.** Before migration 406 the flag was
decoration: `app.charge_single_visit` wrote VAT on every sale whatever the
practice was registered for. From this pass it is the question the charge
paths ask. With the switch true, a visit charged on staging will carry VAT at
the price row's stamped rate, and the two guard triggers 406 installs
(`zz_guard_invoice_vat` and `zz_guard_invoice_line_vat`) will admit it. The
synthetic practice a fresh local database seeds is not registered, so the
laptop and staging will disagree about the money on an invoice until the two
are brought into line. That is a difference to decide about, not a defect to
patch quietly.

## What was done on 2026-09-04, sixth pass: round 24

Main had reached `de36bab` and staging had stopped at 906. Four migrations
were missing, all of them round 24's: the trunk's consent-wording
completeness check, its redaction of every audit row, the practice's logo,
and the first migration in the new 950 range.

- **The forty-six rows already there were checked before anything was
  applied.** Every one's recorded checksum still matches the file on disk, so
  no merged migration has been edited behind the runner's back.
- **Four migrations were applied** one at a time through Supabase's migration
  tool, in filename order: 907, 908, 909 and 950. Each was applied under the
  audit context the runner sets — `app.reason` naming the file, and a fresh
  request id. `schema_migration` now holds **fifty rows**, one per file in
  `db/migrations`, every one carrying a checksum, and the whole bookkeeping
  table — filename and checksum, in filename order — hashes to the same value
  on staging as it does from the files themselves. `pnpm db:migrate` pointed
  at staging would see nothing pending and nothing unexplained.
- **Nothing was applied blindly.** Two of the four could in principle have met
  a row they would refuse, so both were asked about first. Migration 950's new
  constraint refuses an invoice that carries VAT for an unregistered supplier:
  staging holds no invoices at all, so there was nothing for it to refuse.
  Migration 907's refuses a consent wording missing any of its four columns:
  all eight wordings on staging name a purpose, a language, a version and a
  status. Migration 909 found no `practice_logo` document to trip over.
- **The audit chain was counted on both sides of 908**, which is the one
  migration here that replaces the function every audit row passes through.
  Six hundred and forty-six rows before, six hundred and forty-six after, the
  chain verifying with no broken link either time. That is the migration's own
  claim proved on real rows rather than taken on trust: it changes a function,
  not a row, so every existing row keeps its values and the hash taken over
  them, and the two still agree.
- **Thirteen policy files were re-applied**, in path order, in one
  transaction, the way the runner applies them. None of them has changed since
  the fifth pass and none of the four migrations touches a policy, so this
  changed nothing; it is done because the runner does it, and because it
  proves the files still apply cleanly to the schema they now sit on. One
  hundred and four policies stand on `public` afterwards, the same number as
  before and the same number a fresh local database carries.
- **Nothing was owed to the seed.** `git log 5663f18..de36bab -- db/seed` is
  empty: the seed has learned nothing since the fifth pass, and none of the
  four migrations carries a data step for practices that already exist. The
  tables the seed writes were compared against a freshly seeded local database
  all the same, hashing each row's own columns with the generated ids, the
  timestamps and the keyed identifiers left out. Ten of the eleven match byte
  for byte — the price list, the three programmes and their contents and
  prices, the twenty clients, the twenty-three contacts, the forty-two
  consents, the eight wording documents, `goal_category` and `vat_setting`.
  The eleventh, `service_type`, differs in exactly one field and for a reason
  the fifth pass already recorded: the neurofeedback service on staging
  requires a `psychology_degree` where the seed asks for `bcia_bcn`, because
  the owner's own credential is her psychology degree and the demo was made to
  match it. That is a deliberate staging edit, not drift.
- **Fingerprinted against a fresh `pnpm db:reset && pnpm db:migrate`** on the
  trunk's own local database, which applied all fifty migrations and the
  thirteen policy files from empty. Nine of the eleven parts are identical,
  hash for hash: columns (1,077, by name, type, nullability and default),
  constraints (413), indexes (399), policies (104), functions (58), triggers
  (198), row-level security (61), the grants `app_role` holds (85, unchanged),
  and what `PUBLIC`, `anon` and `authenticated` hold on `public`, which is
  nothing at all — what every migration's `revoke all` intends. The four new
  objects are all present and all match: 907's constraint, 909's two
  constraints, its partial unique index and `app.remove_practice_logo`, 950's
  constraint, and the two replaced functions, `app.audit_chain_link` now
  redacting and `app.guard_invoice_vat` now refusing a claimed registration
  the practice does not hold.

  Two differences stand, both expected and both benign, and both are about
  the order columns sit in rather than what they are:
  - **The position of `schema_migration.checksum`**, third on staging where a
    fresh local database has it second. Carried since migration 900 added it
    to a database that already had the table; the earlier passes record it and
    it still stands.
  - **The position of `invoice.supplied_on`**, twenty-fifth on staging where a
    fresh local database has it twentieth, with 905's five `supplier_` columns
    shifted by one to match. This is the shape of catching staging up out of
    numeric order across two passes: the fourth pass applied 905 on its own,
    and 406 — which adds `supplied_on` — did not arrive until the fifth. On a
    fresh database 406 runs first and the column lands earlier. Same
    twenty-five columns, same names, same types, same defaults, same
    nullability; only the order differs. Nothing reads a column's position:
    every query in the codebase names its columns.

  The grants differ in count and not in substance, as before: staging carries
  939 table grants to a local database's 512, and every extra row belongs to
  Supabase's own `service_role`, which mirrors `postgres` and does not exist
  on a laptop. Set that role aside and both sides hold the same 512, hashing
  to the same value.
- **The audit chain verifies** end to end, over 646 rows, with no broken link.
  The number is the same as the fifth pass left it: this pass wrote no audited
  rows at all. None of the four migrations writes data, the policy files write
  none, and the one read taken to prove the demo still works is a function
  call that logs nothing.
- **The demo is intact and needed no rebuilding.** The owner's practitioner
  row `00000005-0000-4000-8000-0000000000aa` stands, her psychology-degree
  credential covers the neurofeedback service and has no expiry, and a
  confirmed home visit for MW-000005 sits on **2026-09-04 at 10:00 Dubai
  time**, window closing at 10:45 with the trigger's own `busy_end` at 11:15,
  at that client's seeded home. It was already on the current day, so nothing
  was re-booked. `app.checkin_context` answers for it: the client resolves and
  two consents are active, participation and the home visit. A later day still
  needs a fresh visit row, as before.

### What the tenant row still says about VAT, and the caution that still stands

Reported again without being changed, because it is the operator's own
statement and not the assistant's to revise: the tenant row records the
practice as **registered for VAT**, with a fifteen-character VAT number
against it, entered on 2026-09-04 at the operator's direction. Its
corporate-tax registration, legal name in English and Arabic, Meydan Free Zone
licence number and expiry (2027-05-09) and registered address are all present
from the fourth pass, and none of them was touched this pass.

**Only a corporate-tax certificate has been seen.** The practice's documents
hold a corporate-tax registration and no VAT certificate. That is what the
fourth pass recorded when it set the row to "not registered", and it is why
`db/migrations/406_billing_vat_registration.sql` and `docs/SPEC/billing.md`
section 5.1 both say the AED 375,000 threshold has not been crossed. The
switch says otherwise on the operator's word alone. If the certificate exists
it should be filed; if it does not, the switch is the thing to correct, and
correcting it is a one-column update, not a migration.

**Migration 950 gives the switch a second job.** It was already the question
the charge paths ask (406). From this pass it is also the question asked of
any invoice that names its own supplier: `app.guard_invoice_vat` now refuses a
row claiming a registration `tenant.vat_registered` does not show, and a check
constraint that cannot be disabled says the same thing from the other side.
So while the switch is true, staging will write VAT and accept it; were it
corrected to false, every invoice claiming the registration would be refused
at the door rather than quietly written. The synthetic practice a fresh local
database seeds is still not registered, so the laptop and staging still
disagree about the money on an invoice. That remains a difference to decide
about, not a defect to patch quietly.

## 1. The project

Either restore the paused `mcwellness` project on the account (created June
2026, region Tokyo, contents unknown until restored) or create a new one. A
free-tier organisation holds two projects; the old app's production is one of
them. Any region serves staging, since only synthetic people live there.

Record the project reference (the `abcdefghij` part of its URL) and its
region; they appear in every URL below.

## 2. The database schema

Run the migrations once, from a laptop, with the project's direct connection
string as the owner:

```bash
DATABASE_URL='postgresql://postgres:<database password>@db.<ref>.supabase.co:5432/postgres' pnpm db:migrate
```

The runner applies the twelve migrations and the policy files, and skips the
local-only password sync. It creates the `mcwellness_api` role without a
password. Then, once, in the project's SQL editor:

```sql
alter role mcwellness_api password '<a long random password>';
```

Keep that password in the deployment's secret store, never in the repository.

## 3. The synthetic practice

Two routes. With a database password on the laptop, seed it the way the local
database is seeded, with `APP_ENV=staging` so the seed accepts a non-local
database:

```bash
APP_ENV=staging IDENTITY_KEY=<64 hex chars, generated with: openssl rand -hex 32> \
DATABASE_URL='postgresql://postgres:<database password>@db.<ref>.supabase.co:5432/postgres' pnpm seed
```

Without one, render the practice as SQL and paste it. The environment file
must say `APP_ENV=staging` and carry the staging identity key, since that key
seals the identifiers in the script:

```bash
node --env-file=.env.staging --import tsx db/seed/render-cli.ts > ../mcwellness-staging.seed.sql
```

`pnpm seed:sql` runs the same renderer, and elsewhere in this file that is
what a past render is described as. It is written out in full here because the
script reads `.env` — the laptop's own database and the laptop's own identity
key — and a staging render has to read `.env.staging` or the identifiers it
seals will not open on staging. Same command, different environment file, and
the environment file is the whole of the difference.

Check the first line, which names the environment it was rendered for. Open
the project's SQL editor, confirm the project reference in the address bar,
paste the whole file and run it once: the script opens and commits its own
transaction, refuses a database that already holds a practice, and stops if
it is applied piecemeal, but it carries no other target check. Afterwards
delete the file and the editor's saved snippet; a rendered script is never
committed (`*.seed.sql` is ignored).

Either way, keep that identity key with the API's secrets; the API needs the
same one to open the seeded Emirates IDs.

**Then the wording's bytes**, which neither route carries. Both write eight
`document` rows naming eight storage keys; the files themselves travel
separately, and until they are in the bucket every consent points at nothing.
Once the bucket exists (section 5a) and `.env.staging` names the store, one
command files them, from the repository:

```bash
node --env-file=.env.staging --import tsx scripts/upload-consent-wording.mjs
```

On a laptop, where `.env` already says everything, it is `pnpm seed:wording`.
Either way it reads each wording row through the API's own connection, refuses
any file whose sha256 no longer matches the row that points at it, writes
nothing over anything, and prints one line per file: the key, the size, and
whether it was uploaded or was already there. Running it twice uploads nothing
the second time, so it is safe to repeat if a run is interrupted.

## 4. The sign-in accounts

In the Supabase dashboard, under Authentication, create one user per seeded
person (four: the owner, two practitioners, the coordinator) with a synthetic
email at `example.com` and a strong password. Supabase assigns each a user
id. Then link each seeded person to their account by updating `auth_id`:

```sql
update app_user set auth_id = '<supabase user id>' where display_name = 'Hazel Harbour';
```

Never create Supabase users with the seed's fixed ids; the seed's ids are
public in the repository and the link runs the other way.

Under Authentication settings, switch on: password strength requirements,
leaked-password protection, refresh token rotation with reuse detection, and
multi-factor sign-in for the owner and admin accounts (docs/SECURITY.md).

## 5. The API's settings

The deployment's secret store holds, for the API:

```
APP_ENV=staging
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_JWKS_URL=https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_SECRET=                       # empty: the placeholder is refused outside development
API_DATABASE_URL=postgresql://mcwellness_api.<ref>:<api role password>@aws-0-<region>.pooler.supabase.com:6543/postgres
IDENTITY_KEY=<the key from step 3>
STORAGE_PROVIDER=supabase             # or "local"; unset, the API refuses to start on staging
SUPABASE_STORAGE_KEY=<the project's service role key>   # never the anon key
SERVE_APP=true
HOST=<what the reverse proxy reaches>
TRUSTED_PROXY_HOPS=<the number of proxies in front, exactly>
```

The API verifies tokens against the project's published keys (the JWKS URL),
so it needs no shared secret. The pooler connection is the transaction pooler
on port 6543 with the role name suffixed by the project reference; the API
refuses any other role name at startup.

`STORAGE_PROVIDER` has no default outside development: the API says so at
startup and stops, rather than quietly writing the practice's documents to a
folder on the server. It is checked when the API starts and the project is
not reached until a document call is made, so a bucket that is missing or
down never stops the API from starting — a call against it answers 503
`storage_unavailable` (docs/SEAMS.md).

## 5a. The documents bucket

One bucket, in the same project, **once**, from the dashboard under Storage,
"New bucket":

The bucket sits in the project, so it sits where the project sits: **Mumbai,
`ap-south-1`, outside the UAE** (docs/COMPLIANCE/approved-vendors.md). It holds
synthetic files only, for the same reason the database does.

- Name: `documents`
- Public: **off**. Nothing in it is ever served from a public URL; the API
  signs a link good for five minutes when someone needs to see a file.
- File size limit and allowed MIME types: leave as they are for now.
- Versioning, if the project offers it: on. A document is never rewritten in
  the ordinary course of things, and a version history costs nothing.

No storage policies are needed: the API reaches the bucket with the service
credential and is the only thing that does. The browser never holds a storage
credential, and `SUPABASE_ANON_KEY` is never `SUPABASE_STORAGE_KEY`.

Keys inside the bucket are built by the platform and never by hand:
`tenant/<tenantId>/client/<clientId>/<documentId>` for anything filed against
a client, `tenant/<tenantId>/practice/<documentId>` for a document with no
client. They are made of ids alone, so a key says nothing about whose file it
is.

**The consent wording has to be uploaded once, whichever route seeded the
rows.** `pnpm seed` writes those eight files into the local folder and nowhere
else, deliberately — it holds no storage credential and never reaches a bucket
— so pointing it at a hosted database fills the rows and leaves the bytes on
the laptop. It says so on the way past: seeding a non-local database prints the
same warning this section carries. The rendered seed script carries only the
rows either way: each consent wording document row holds a `storage_key` and
the sha256 of its file, and the bytes travel separately. Until they are in the
bucket at exactly the key each row names, `exists()` answers false and anyone
opening a consent sees nothing behind the wording.

One command does it, from the repository, once the bucket exists and
`.env.staging` names the store (`STORAGE_PROVIDER=supabase` and
`SUPABASE_STORAGE_KEY`):

```bash
node --env-file=.env.staging --import tsx scripts/upload-consent-wording.mjs
```

It reads each wording row, refuses any file whose sha256 differs from the row
that points at it — the row is what a recorded consent points at, and a changed
text is a new version and a new row, never new bytes at an old key — writes
nothing over anything, and prints one line per file. Running it twice uploads
nothing the second time.

By hand is still possible and the mapping is stable, since the seed's document
ids are fixed: `select purpose, locale, storage_key from document where kind =
'consent_text' order by purpose, locale` gives the list, and each file in
`docs/CONSENT` (all but `README.md`) goes to exactly the `storage_key` its row
names.

## 6. The app's build settings

Set at build time, so they are baked into the bundle:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<the project's anon / publishable key>
```

`VITE_SUPABASE_URL` must name the same project as `SUPABASE_URL`: the API
trusts that project's tokens and names its origin in the content security
policy. Build with the staging file named as the mode, because a plain
`pnpm build` reads `.env`, not `.env.staging`, and the sign-in page then
falls back to the laptop door with "Email sign-in is not configured on this
laptop" (found on 2026-09-03):

```bash
pnpm exec vite build --mode staging
```

Then serve it with the staging settings: `SERVE_APP=true node --env-file=.env.staging --import tsx app/api/server.ts`
(add `HOST=0.0.0.0 PORT=3100` to reach it from another device on the same
network while the laptop demo keeps port 3000).

## 7. The exit test

Sign in as the owner, open a client, see the timeline. Sign in as a
practitioner, see the empty table with its note. Then tag the trunk:

```bash
git tag trunk-v1 && git push origin trunk-v1
```

## What the code already handles

- Token verification against the project's JWKS (ES256 or RS256) or, for a
  legacy project, its HS256 secret, chosen by the token's own algorithm.
- The connection through the transaction pooler, with the role name the
  pooler expects.
- Row security under the `mcwellness_api` role, which owns nothing and bypasses
  nothing.
- The local `auth.uid()` shim that yields to Supabase's own function.
- Extensions installed into Supabase's `extensions` schema.
- The laptop sign-in door, which cannot open on staging: it needs a local
  database, a local Supabase URL and the development environment, all three.
