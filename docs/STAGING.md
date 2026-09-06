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

## What was done on 2026-09-05: the VAT switch corrected

Not a pass: no migration merged, so the seventh pass is still the one that
follows the next merge adding one. One column changed, at the operator's
direction, and it is recorded here because the fifth and sixth passes both
said this was the thing to correct.

The operator confirmed on 2026-09-05 that the practice holds no VAT
registration: the AED 375,000 threshold has not been crossed, and the
registration recorded on 2026-09-04 was entered on the operator's word ahead
of any certificate. The tenant row now says **not registered for VAT** and
carries no VAT number, which is what the fourth pass recorded and what the
synthetic practice on a fresh local database says (`db/seed/generate.ts`),
so the laptop and staging agree again about the money on an invoice.

How it was done: one `update` on `tenant` through the SQL tool, inside a
transaction that stamped the owner's actor settings (`app.actor_id`,
`app.actor_roles` of `owner`, `app.tenant_id`, a fresh `app.request_id`) so
the identity guard admitted it and the audit trail names the owner, with
`app.reason` saying the change was a correction at the operator's direction,
entered by the assistant. Staging held no invoices, so nothing claimed a
registration the row no longer shows; migration 950's guard and constraint
had nothing to refuse. The demo server on port 3100 reads the row per
request and needed no restart.

What the switch means from here: it stays off until the Federal Tax
Authority registers the practice and issues a number. The threshold is on
taxable supplies over the trailing twelve months, or expected in the next
thirty days; expenses count only towards the voluntary threshold of AED
187,500. Turning the switch on is the operator's act in the practice
settings, with the number typed in, and the platform's job is to say when
the threshold is near (`docs/PLAN/pieces-seven-to-nine.md`, small things).

## What was done on 2026-09-05, seventh pass: the client portal

Main had reached `c80a17a`, pull request 69's merge of the client-portal
stream, and staging had stopped at 950 with the VAT switch just corrected
above. Five migrations were missing, not four: 700, 701, 702 and 703 are the
portal's own range, and 910 is the trunk's — the practice's WhatsApp number,
which rewrites `tenant` and so must sort after every stream's range
(docs/SPEC/OWNERSHIP.md). Two new policy files arrived with them,
`db/policies/portal/access.sql` and `db/policies/portal/money.sql`, and two
existing ones were amended, `db/policies/scheduling/appointment_access.sql`
(a client contact's own visits join the read scope) and
`db/policies/client/writers.sql` (a contact may correct its own telephone,
email and WhatsApp preference).

- **The fifty rows already there were checked before anything was applied.**
  Every one's recorded checksum still matches the file on disk, so no merged
  migration has been edited behind the runner's back.
- **Five migrations were applied** one at a time through Supabase's migration
  tool, in filename order: 700, 701, 702, 703, 910. Each was applied under
  the audit context the runner sets — `app.reason` naming the file, and a
  fresh request id. `schema_migration` now holds **fifty-five rows**, one per
  file in `db/migrations`, every one carrying a checksum, and the whole
  bookkeeping table — filename and checksum, in filename order — hashes to
  the same value on staging, on a freshly migrated local database, and from
  the files themselves, so `pnpm db:migrate` pointed at staging would see
  nothing pending and nothing unexplained.
- **Nothing was refused.** All five were asked, as every pass asks, whether
  they could meet a row they would refuse. 700 and 701 create tables that did
  not exist; there was nothing for either to meet. 702 adds a trigger and a
  function and touches no existing row. 703 adds a function alone. 910 adds
  `tenant.whatsapp_number` nullable with a check that admits null, and
  staging's one tenant row had no number recorded, so the check had nothing
  to refuse either. All five went in clean.
- **Fifteen policy files were re-applied**, in path order, the way the runner
  applies them — split across three calls for the tool's own size limit
  rather than the runner's single transaction, which changes nothing about
  what lands: every file is `drop policy if exists` then `create policy`, so
  re-running the same file twice is a no-op and the split cannot leave a
  policy half-applied. One hundred and eighteen policies stand on `public`
  afterwards (104 before this pass, plus fourteen new: four each on
  `portal_invite` and `portal_request`, and `portal_money_adults` on the six
  tables `db/policies/portal/money.sql` names), matching a fresh local
  database exactly.
- **The seed owed two households and a number, and only that.** `git log
  de36bab..c80a17a -- db/seed` shows one commit, adding `tenant.whatsappNumber`
  and a `user_id` on two contacts. `pnpm seed:sql` was rendered against
  `.env.staging` (never printed, and deleted once the diff below was taken
  from it) and checked against staging column by column before anything was
  written: both destination rows —the contact on client 5's own record and
  the mother of client 17 — stood exactly as a fresh seed leaves an
  unconnected contact, `user_id` null, and the tenant's `whatsapp_number` was
  null. Nothing else in the render differed from staging's existing rows, so
  only the render's own new statements were applied, verbatim: two
  `app_user` rows (Clover Quarry, English; Dahlia Bay, Arabic), two
  `user_role` rows granting each `client_contact`, the two contacts'
  `user_id` linked to them, and the tenant's `whatsapp_number` set to the
  seed's reserved synthetic number. Applied in one transaction under the
  seed's own audit reason (`synthetic seed`) with the owner stamped as
  actor, exactly as the render itself stamps its own inserts. No Supabase
  Auth user was created for either contact — the owner does that from the
  dashboard if she wants a demo login for one of them, exactly as the two
  staff accounts were made, and nothing in this pass touched Authentication.
- **Fingerprinted against a fresh `pnpm db:reset && pnpm db:migrate`** on
  `mcwellness-trunk-2` (its own database, port 5442, never the main
  checkout's), after fetching and checking out `main` there. All fifty-five
  migrations and all fifteen policy files applied cleanly to an empty
  database. Nine parts compared, hash for hash, this time with the noise
  filtered at the query rather than eyeballed afterwards: columns (1,117, by
  schema, table, name, type, nullability and default — never ordinal
  position, which is why the standing `schema_migration.checksum`
  difference from earlier passes has nothing to show up in), constraints
  (443), indexes (416), triggers (204), policies (118), row-level security
  flags (64 tables), functions (65, by schema, name, arguments, return type,
  language, security and volatility), the grants `app_role` holds (92,
  `public`+`app` together) and what `anon`, `authenticated` and `PUBLIC` hold
  on either schema (0, on both sides — every migration's `revoke all` still
  intends exactly that). All nine hashes matched exactly; nothing stood
  aside as expected-and-benign this time.
- **The audit chain verifies** end to end, over 657 rows: 646 after the
  sixth pass, 654 after the VAT correction above, and this pass added seven
  audited rows of its own from the seed catch-up (the tenant update, two
  `app_user` inserts, two `user_role` inserts, two `contact` updates) and
  three more from the demo visit below (an insert, its own deletion, and the
  corrected insert), landing on 657.
- **The demo needed a fresh visit row.** The one the sixth pass left was
  dated 2026-09-04; today is 2026-09-05, and `app.checkin_context` is tied to
  the practice's own "today" in Dubai, so a demo walked today would have
  found nothing to check in against. A replacement was booked for
  MW-000005 at the client's seeded home, 10:00–10:45 Dubai time, under the
  real owner account's own actor stamp (the practice's staff account,
  `Shauna McGuinness`, not the seed's synthetic placeholder) — the same
  account that booked the ones before it. The first attempt computed the
  window with `current_date at time zone 'Asia/Dubai'`, which is the wrong
  half of that operator for a plain `date` and landed the visit at 18:00
  Dubai instead of 10:00; it was deleted before anything read it and
  replaced with the form `current_date::timestamp at time zone 'Asia/Dubai'`
  that `app.checkin_context` itself uses, landing correctly at 06:00–06:45
  UTC with `busy_end` computed by the trigger to 07:15 UTC. `checkin_context`
  now answers `found: true` for MW-000005 with two active consents,
  confirmed against the query itself rather than assumed. A later day still
  needs a fresh visit row, as before.
- **Advisors were checked after the DDL.** Every `rls_enabled_no_policy`
  finding is a table this pass did not touch and every earlier pass already
  carries by design (`schema_migration`, `payment_receipt_series`, the
  audit-log partitions and their default), and the one `WARN` is leaked-
  password protection, unrelated to this pass and already known
  (docs/SECURITY.md). Nothing new.

## What was done on 2026-09-06, eighth pass: the practitioner's phone

Main had reached `4258ded`, pull request 73's merge of the practitioner's-phone
stream, and staging had stopped at 950 (the fifty-five rows the seventh pass
left, VAT correction included). Before anything else, main was fast-forwarded
to `0c99ff2`: two further pull requests had merged behind the brief's back
(75, hosting-spec; 76, piece-ten-specs), both documentation only —
`git diff --stat 4258ded..0c99ff2` touches nothing under `db/`, `app/` or
`domain/` — so the base moved but nothing this pass owed changed.

- **The fifty-five rows already there were checked before anything was
  applied.** Every file's own sha256, computed straight off the files on
  disk, matched the checksum staging had recorded for it exactly, so no
  merged migration had been edited behind the runner's back.
- **Two migrations were applied** one at a time through Supabase's migration
  tool, in filename order: `204_drive_estimate.sql` and
  `306_kit_and_setup_photo.sql` (the brief's guess of `306_kit.sql` was close
  but not the file's actual name). Each was applied under the audit context
  the runner sets — `app.reason` naming the file, and a fresh request id —
  with the bookkeeping row written immediately after, carrying the same
  sha256 the runner would compute. `schema_migration` now holds
  **fifty-seven rows**, one per file in `db/migrations`.
- **Both were asked, as the brief asked, whether either could meet a row it
  would refuse.** 204 creates `drive_estimate` from nothing and adds two
  columns to `scheduling_setting` with defaults, so there was no existing row
  either statement could refuse. 306 is the one the brief flagged by name: it
  drops and recreates `app.checkin_context` (PostgreSQL will not let
  `create or replace` change a function's return columns, and 306 adds two)
  and adds a nullable `kit_id` to `session`. Neither met a row it would
  refuse either — `checkin_context` is called by the API, not stored in a
  view or another function's body, and `session.kit_id` carries no default
  and no not-null. The grants were checked afterwards, as asked:
  `has_function_privilege` on the five callable functions 306 adds
  (`checkin_context`, `setup_photo_consent_active`,
  `file_setup_photo_document`, `file_setup_photo`, `previous_setup_photo`)
  shows `app_role` holding execute and `public` holding none on every one;
  the sixth, the trigger function `session_refuse_update_after_close`, holds
  neither grant on either side, which is correct — a trigger function is
  never called directly, only fired — and table grants on `drive_estimate`
  and `kit` both show `app_role` with exactly insert, select, update, no
  delete, matching what each migration's own `do $$ ... $$` block grants.
- **Seventeen policy files were re-applied**, in path order, split across
  three calls for the tool's own size limit (the same reason the seventh
  pass split its fifteen across three): `db/policies/scheduling/drive_estimate.sql`
  and `db/policies/session/kit.sql` are the two new arrivals, one per
  migration. One hundred and twenty-six policies stand on `public`
  afterwards — one hundred and eighteen before this pass, plus four each on
  `drive_estimate` and `kit` (a tenant-isolation policy and one restrictive
  policy per verb the table grants) — matching what a fresh local database
  carries for the same fifty-seven migrations.
- **The seed owed the kit register, and only that.**
  `git log c80a17a..4258ded -- db/seed` shows one commit
  (`0b62ca0`, "an amplifier per practitioner, and one overdue on the shelf"):
  an amplifier for each of the three seed practitioners, in date, and one
  unassigned amplifier whose calibration lapsed. `pnpm seed:sql` was
  rendered against `.env.staging` (read once, never printed, and deleted the
  moment its four `insert into kit` statements were taken from it) and
  checked against staging first: the tenant id and the three practitioner
  ids the render names are the exact ids already seeded on staging, and the
  `kit` table itself held zero rows before this pass, so there was nothing
  to reconcile — the render's four statements were applied verbatim, in one
  transaction, under the seed's own reason (`synthetic seed`) with the owner
  stamped as actor and holding the same roles the seed itself would stamp
  (`owner,admin,lead_practitioner,finance`). All four rows now stand
  exactly as rendered.
- **Fingerprinted against a fresh `pnpm db:reset && pnpm db:migrate`** on
  `mcwellness-trunk` (its own database, port 5441), after fetching and
  fast-forwarding it to the same `0c99ff2` the laptop checkout now sits on.
  Fifty-seven migrations and seventeen policy files applied cleanly to an
  empty database. Nine parts compared by content, not by count alone:
  columns (1,145, by schema, table, name, type, nullability and default),
  indexes (428), triggers (263), policies (126), row-level security flags
  (67 tables), functions (69, by schema, name, argument list, return type,
  volatility, security definer and language), the grants `app_role` holds
  on `public` and `app` together (98), and what `PUBLIC`, `anon` and
  `authenticated` hold on either schema (nothing, on both sides). All eight
  hashed identically. The ninth, constraints, hashed identically too once
  one thing was normalised: PostgreSQL 17 catalogues an unnamed `not null`
  column constraint under a system-generated name that embeds internal
  object ids (`1726018_1727415_10_not_null` and the like), and those ids are
  never the same across two independently-created databases even from
  byte-identical DDL. With every such synthetic name folded to one label and
  every explicitly-named constraint compared in full, both sides hash to the
  same value over the same 1,039 rows. This is a new note, not a new
  problem — it stands beside the two the fifth and sixth passes already
  recorded (the position of `schema_migration.checksum`, and of
  `invoice.supplied_on`) as a difference in a name or a position that
  nothing in the codebase reads, never a difference in what the schema
  means.
- **The audit chain verifies** end to end. It stood at 930 rows before this
  pass touched any data; the kit seed catch-up added four (one insert per
  row), and proving the routing fallback actually writes an estimate (next
  paragraph) added and then removed one appointment and one cache row,
  netting one insert and one delete each side of that check. The chain
  verifies at every point checked, `app.verify_audit_chain()` returning
  null throughout.
- **The demo needed a fresh visit row**, as every pass before it has. The
  one the seventh pass left was dated 2026-09-05; the server's own clock
  read 2026-09-05 21:22 UTC when this pass ran, which is already
  2026-09-06 past midnight in Dubai, so a plain `current_date` (server-side,
  UTC) still names yesterday in the practice's own day — the same trap the
  seventh pass hit from the other direction. The form `app.checkin_context`
  itself uses, `(date_trunc('day', now() at time zone 'Asia/Dubai'))::date`,
  was used instead: a confirmed home visit for MW-000005 at 10:00–10:45
  Dubai time (06:00–06:45 UTC), `busy_end` computed by the trigger to 07:15
  UTC, at that client's seeded home, under the real owner's own actor
  stamp. `app.checkin_context` now answers `found: true` with two active
  consents, and, new from this pass, `kit_calibration_overdue: false` and
  `kit_id: null` — correct, because the owner's own demo practitioner row
  carries no assigned amplifier (only the three seed practitioners do), so
  "nothing assigned is no block" is exactly what should show.
- **The routing fallback was proved end to end, not just configured.** A
  second, temporary appointment was booked for the same practitioner later
  the same day at a different client's location, a magic link was minted
  server-side for the real owner's account (`generateLink`, which returns a
  link without sending mail) and exchanged for a session with the anon key,
  and `GET /api/routing/day?date=2026-09-06` was called with that session's
  token against the rebuilt staging server. It answered one leg,
  `"source":"straight-line"`, a plausible distance and duration between the
  two seeded addresses, and the same row appeared in `drive_estimate` under
  hour bucket 11 — the cache the route itself writes to. Both the temporary
  appointment and its cache row were deleted immediately afterwards, under
  their own audit reason, so the demo stands at its usual one visit and the
  cache stands empty until the day sheet itself asks. `mapAvailable: false`
  in the same response is expected and unrelated: the picture needs a
  Google Maps key the practice has not yet supplied (docs/HANDOVER.md).

### The routing fallback and the laptop's own database

Per docs/HANDOVER.md sections 4 and 5: `.env.staging` was checked for
`ROUTING_PROVIDER` and did not carry it, so `ROUTING_PROVIDER=straight-line`
was appended — the practice has not supplied a routing vendor key, so
staging runs the fallback until it does, and the route's own response above
confirms it is actually taking effect rather than merely being set.
`pnpm db:migrate` in the laptop checkout found nothing pending: both
migrations were already applied there before this pass began. The staging
bundle was rebuilt with `pnpm exec vite build --mode staging` (866 kB main
chunk, service worker precache rewritten to 23 entries). The keep-alive
script (see below) restarted the server on port 3100 within its own
sixty-second poll once the old process was stopped; `curl` afterwards
confirmed `/api/health` answers `{"ok":true,...}`, `/manifest.webmanifest`
serves as `application/manifest+json`, and `/sw.js` serves as
`text/javascript`.

**A keep-alive script was running throughout** (`ps -ef | grep keepalive`
shows it, PID 96432, polling every sixty seconds), restarting both the
staging server and the laptop's own `pnpm dev` if either drops. It was not
fought: the staging server was stopped once, deliberately, so the rebuilt
bundle would be served by a fresh process, and the script picked that up
and relaunched it with the exact command docs/HANDOVER.md section 5 names
before this pass checked the endpoints.

**A mistake, corrected, and worth recording plainly.** While adding the
`ROUTING_PROVIDER` line, a shell redirection appended it to `.env.staging`
without a leading newline, which landed it stuck onto the end of the
`SUPABASE_STORAGE_KEY` line instead of on a line of its own; a diagnostic
command run immediately afterwards to locate the fault then printed that
corrupted line — service-role key included — into this session's own tool
output before the fault was understood. The file was repaired within the
same minute (the stray suffix stripped back off the key, `ROUTING_PROVIDER`
re-added on its own line, both confirmed by grepping variable names rather
than values), and nothing beyond that one tool result ever saw the key: it
was not committed, not logged to a file, and not repeated afterwards. The
key is a service-role credential for the staging project alone, which holds
synthetic data only — but it is still a credential that briefly left the
place it belongs, and rotating it from the project's API settings is the
operator's call to make, not this pass's to skip past.

## What was done on 2026-09-06, ninth pass: brain maps and reports

Main was fast-forwarded from `ad4428d` to `5e008fb`: pull requests 78
(the trunk's writer move, and a copied-Arabic fix, application code only),
79 (a documentation-only hand-over update), 80 (piece nine's hosting build),
81 (the assessment stream), 82 (the trunk's audit fix — an identifier read
as a telephone number and was wrongly redacted) and 83 (the reports
stream). Of the five the brief named, only 81 and 83 touch `db/`; 78, 80 and
82 are application code, tests and documentation, and owed staging nothing
of their own.

- **The fifty-seven rows already there were checked before anything was
  applied.** Every file's own sha256, computed straight off the files on
  disk, matched the checksum staging had recorded for it exactly (a small
  script, not the runner itself, since the runner needs a database password
  the laptop does not hold) — no merged migration had been edited behind the
  runner's back.
- **Six migrations were applied** one at a time through Supabase's migration
  tool, in filename order: `106_erase_assessment.sql`,
  `107_erase_report.sql`, `500_assessment.sql`, `501_assessment_document.sql`,
  `600_report.sql` and `601_report_delivery.sql`. Each was applied under the
  audit context the runner sets — `app.reason` naming the file, and a fresh
  request id — with the bookkeeping row written immediately after, carrying
  the same sha256 the runner would compute. `schema_migration` now holds
  **sixty-three rows**, one per file in `db/migrations`.
- **106 and 107 were read before being trusted to run out of the order they
  look like they need.** Both replace `app.erase_client` and both reach into
  `assessment`, `assessment_document`, `report` and `report_delivery` —
  tables that do not exist until 500, 501, 600 and 601 run after them in the
  runner's own numeric order. Reading the bodies shows why that is fine: every
  reach is guarded with `to_regclass('public.<table>')`, evaluated inside the
  function each time `app.erase_client` is *called*, not when it is
  *created*. `create or replace function` never touches the tables its body
  mentions, so 106 and 107 applied cleanly against a database that did not
  yet have the 500s or the 600s, exactly as 105 and 104 already do for the
  ranges ahead of them.
- **601's new key on `contact` was checked, not assumed.** It adds
  `contact_tenant_id_client_key unique (tenant_id, id, client_id)`, which the
  reports change request itself argues can never fail — `id` is already the
  primary key, so the triple is a superset of a key that already holds.
  Checked anyway: `select count(*), count(distinct (tenant_id, id,
  client_id))` on the table's 23 rows before applying, 23 and 23, so nothing
  stood to be refused.
- **Grants were checked after 500 and after 600**, as the eighth pass checked
  them after 306. `assessment` and `report_delivery` grant `app_role` select
  and insert; `assessment_document` grants select alone; `report` grants
  select, insert and update; `report_number_series` grants app_role nothing
  at all, not even select, matching the counter's own comment — the only door
  onto it is `app.next_report_number()`. On the callable functions
  (`assessment_context`, `file_assessment_document`, `issue_report`,
  `file_report_document`, `next_report_number`, `report_was_delivered`),
  `app_role` holds execute and nothing else does; the five trigger and guard
  functions behind them (`assessment_refuse_rewrite`,
  `assessment_document_is_the_clients`, `guard_report_write`,
  `guard_report_delivery_write`, `default_report_number_series`) hold no
  grant to `app_role` at all, correct for functions that are only ever fired,
  never called.
- **Twenty policy files were re-applied**, in path order, split across three
  calls for the tool's own size limit (the same reason the seventh and
  eighth passes split theirs): `db/policies/assessment/access.sql` and
  `tenant_isolation.sql`, and `db/policies/reports/reports.sql`, are the
  three new arrivals. One hundred and thirty-nine policies stand on `public`
  afterwards — one hundred and twenty-six before this pass, plus five on the
  assessment tables and eight on the report tables — matching what a fresh
  local database carries for the same sixty-three migrations.
- **The seed owed nine rows, and only that.** `git log ad4428d..5e008fb --
  db/seed` shows one commit, adding a baseline brain map, a re-map ninety
  days later, and one questionnaire total for each of three synthetic
  households — six qEEG rows and three questionnaire rows, nine in all — and
  nothing for the reports stream, which seeds no report (`docs/SPEC/reports-v1.md`
  section 11 asks for a synthetic report drafted, signed and delivered on
  staging itself, not seeded rows, and that is a walk for the operator's own
  session, not this pass's to shortcut). `pnpm seed:sql`'s renderer was run
  with `.env.staging` as the environment file
  (`node --env-file=.env.staging --import tsx db/seed/render-cli.ts`), read
  once into a scratch file, never printed, and deleted once the nine
  `insert into assessment` statements were taken from it. `assessment` held
  zero rows before this pass, so there was nothing to reconcile against —
  the nine statements were applied verbatim, in one transaction, under the
  seed's own reason (`synthetic seed`) with the real owner account stamped as
  actor and holding her own roles (`owner, lead_practitioner`; the seed's
  synthetic `created_by` on each row is the render's own fixed placeholder
  id, exactly as the render writes it, and is a separate thing from who
  performed the write).

  **One row was mistyped by hand and caught before this record was written,
  not after.** Copying the ninth statement's four-thousand-character `derived`
  payload by eye dropped one figure (`O1` `gamma`) and duplicated two others
  in its place. A full programmatic comparison — every one of the nine rows
  parsed back out of the rendered file and diffed field by field, and every
  brain-map row's twenty-five figures compared as a set rather than eyeballed
  — caught the one mismatch afterwards. `assessment` refuses every update and
  delete outside an erasure, by design (migration 500's own guard), so the
  fix was not a quiet `update`: `app.begin_erasure()`, a `delete` of the one
  row, the correct `insert`, then `app.end_erasure()`, under a reason naming
  the mistake plainly. The three functions are owned by the migration role
  and granted to nobody else, and the connection this pass used holds that
  role's own privileges, so the call needed no special door. Re-run of the
  same full comparison afterwards found all nine rows byte-identical to the
  render. The lesson taken, plainly: a payload this size is copied by a
  script's own diff, not by an eye reading four thousand characters twice.
- **Fingerprinted against a fresh `pnpm db:reset && pnpm db:migrate`** on
  `mcwellness-trunk-2` (its own database, port 5442), already fetched to the
  same `5e008fb` this pass's own checkout sits on. Sixty-three migrations and
  twenty policy files applied cleanly to an empty database. Eight parts
  compared by content rather than by count alone, with ordinal position left
  out of every one of them (the standing note from the fifth, sixth and
  eighth passes about `schema_migration.checksum` and `invoice.supplied_on`
  sitting in a different column position is therefore not a difference this
  method could ever surface, by construction, not by luck): columns (1,221,
  by schema, table, name, type, nullability and default), constraints
  (1,144, with PostgreSQL 17's synthetic not-null constraint names folded to
  one label as the eighth pass's own note describes), indexes (469),
  triggers (292), policies (139), row-level security flags (72 tables),
  functions (80, by schema, name, argument list, return type, volatility,
  security and language), and the grants `app_role` holds on `public` and
  `app` together (146: 106 table grants and 40 function grants) against what
  `PUBLIC`, `anon` and `authenticated` hold on either schema (nothing, on
  both sides). All eight matched exactly — for the first time across every
  pass this file records, with no difference left standing aside as expected
  and benign.
- **The audit chain verifies** end to end, `app.verify_audit_chain()`
  returning null throughout, over 947 rows. Twelve carry this pass's own
  request ids: one insert into `report_number_series` (migration 600's own
  data step, backfilling the counter for the practice that already exists,
  the same thing 402 once did for the invoice number), nine assessment
  inserts, and the delete-then-insert pair that corrected the mistyped row
  above.
- **The demo needed no fresh visit row, for the first time.** The confirmed
  home visit for MW-000005 already stood on **2026-09-06 at 10:00–10:45
  Dubai time** (06:00–06:45 UTC, `busy_end` 07:15 UTC) — today, when this
  pass ran — left over from work earlier the same day that this pass's brief
  did not touch. `app.checkin_context` answers `found: true`, two active
  consents (`home_visit`, `participation`), `kit_calibration_overdue: false`,
  `kit_id: null`, exactly as the eighth pass left it. MW-000005 is also one
  of the three households the assessment seed just gave a brain map to, so
  the same client now carries both a bookable visit and a measurement
  history.
- **The two authenticated routes named in the brief were called, not just
  reasoned about.** A magic link was minted server-side for the real owner's
  account (`generateLink`, which returns a link without sending mail) and
  exchanged for a session with the anon key, exactly as the eighth pass did
  to prove the routing fallback. `GET /api/routing/day?date=2026-09-06`
  answered `200` with `{"legs":[],"pictureUrl":null,"mapAvailable":false}` —
  an empty leg list is correct with one confirmed visit and nothing to draw a
  line between, and `mapAvailable: false` is the same standing wait on the
  practice's Google Maps key the eighth pass recorded, unrelated to this
  pass. `GET /api/clients/00000008-0000-4000-8000-000000000005/assessments`
  answered `200` with MW-000005's own two qEEG readings and their figures,
  proving the new route, the new table and the new seed rows all agree end
  to end under the owner's own account.
- **Advisors were checked after the DDL.** Every `rls_enabled_no_policy`
  finding is a table this pass did not touch and every earlier pass already
  carries by design (`schema_migration`, `invoice_number_series`, the
  audit-log partitions and their default, and `app`'s own bookkeeping
  tables); `assessment`, `assessment_document`, `report`, `report_delivery`
  and `report_number_series` all carry policies and none is flagged. The one
  `WARN` is leaked-password protection, unrelated to this pass and already
  known (`docs/SECURITY.md`). Nothing new.

### What the reports stream defaults for a minor's own login, named for the operator

`docs/CHANGE-REQUESTS/reports-01.md` item 4 records a default this build took
without asking: **a young person's own portal login can read an issued report
about themselves.** The client app already hides the money screen from a
minor's own sign-in, because a household's balance is the household's
business and not a child's to see; a report is treated differently on
purpose. Specification section 7.3 gives the household "issued reports for
their own client, and nothing else" without carving the client's own age out
of that sentence, and the build read that literally: the report itself is
about the person, not the household's finances, so their own login is not
narrowed the way the money screen is. Nothing about consent or
`can_receive_reports` changes — those still govern what the *practice sends
out*; this is only about a household member reading their own record on the
device they are already signed into. Worth the operator's own view, since it
was Claude's default and not an instruction: if a minor should not read their
own clinical report unaccompanied, the fix is a narrowing on
`db/policies/reports/reports.sql`'s `report_readers` policy, in the same
shape `portal/money.sql` already narrows the money tables, not a rewrite of
the table or the route.

## What was done on 2026-09-06, tenth pass: the takings figure, the session link, and the narrower report room

Main had reached `5e008fb` (the ninth pass's own base) and staging had
stopped at 63 rows. The checkout was fast-forwarded twice: first through
pull requests 86 (the ninth pass's own report), 87 (trunk round 31, the
brief's own subject), 88 (a security scan) and 89 (a QA walk) to `3e7c403`;
then, once that work was under way, origin gained pull request 85 as well
and the checkout was fast-forwarded again to `2ef44f7`. 85 merged out of
order — opened before 86 to 89 but landing after them — and is
documentation only (`docs/OPERATOR/2026-09-06-decisions.md`, `git diff
--stat` touching nothing under `db/`, `app/` or `domain/`); 88 and 89
between them net to nothing under `db/` either, once both are counted (88's
merge diff shows the seven migrations below and `db/policies/reports/reports.sql`
disappearing, and 89's restores them byte for byte — a history artefact of
how 88 branched, not a real edit; the files were verified byte-identical to
what 87 wrote before anything on staging was touched). Only 87 owed staging
anything, and it is the seven migrations the brief named, found by exactly
that name: `502_assessment_document_key.sql`, `911_document_client_key.sql`,
`951_assessment_session.sql`, `952_practice_money_ledger.sql`,
`953_vat_taxable_supplies.sql`, `954_drop_invoice_document_id.sql` and
`955_report_guardian_reader.sql` — the last one filed under a different
name than the brief's guess (`955_report_readers_guardians.sql`), close but
not it.

- **The sixty-three rows already there were checked before anything was
  applied.** Every file's own sha256, computed straight off the files on
  disk, matched the checksum staging had recorded for it exactly — no
  merged migration had been edited behind the runner's back.
- **Seven migrations were applied** one at a time through Supabase's
  migration tool, in filename order, each under the audit context the
  runner sets (`app.reason` naming the file, a fresh request id) with the
  bookkeeping row written immediately after, carrying the same sha256 the
  runner would compute. `schema_migration` now holds **seventy rows**, one
  per file in `db/migrations`.
- **502 and 911 were read together before either ran, as the brief asked.**
  Both create `document_tenant_id_client_key` under the same
  `if not exists` guard and whichever the runner reaches first is the one
  that actually creates it. 502 ran first by filename order: afterwards the
  key existed (checked directly against `pg_constraint`), and 911 then ran
  as the no-op its own guard promises — its `comment on constraint`
  statement re-set the same comment, and nothing else. 502 also replaced
  501's guard trigger with the wider foreign key, dropping
  `app.assessment_document_is_the_clients` and the trigger that called it.
- **951 was checked against live `session` rows before its new key could
  meet one.** `session` held zero rows on staging, so
  `session_tenant_id_client_key unique (tenant_id, id, client_id)` had
  nothing to refuse; the nullable `assessment.session_id` and its partial
  index followed cleanly.
- **954 was checked for a code path that still reads the dropped column,
  against the code actually running** — the ninth pass's build, since this
  pass had not yet rebuilt anything. `git grep document_id` at the
  then-running commit (`5e008fb`) turned up only `bd.document_id`
  (`billing_document`'s own column, in `invoices.ts` and `receipts.ts`) and
  a comment in `invoices.ts` naming `invoice.document_id` as the thing to
  avoid reading. Nothing running on staging read the column, so dropping it
  left no window where a live request would have failed. Afterwards
  `pg_get_functiondef('app.erase_client(uuid, uuid)')` was pulled and
  diffed against `107_erase_report.sql`'s own body: identical but for arm
  (b) — the block reading `invoice.document_id` — removed, exactly as
  954's own comment describes.
- **955 was checked against the demo household's own contacts, as the
  brief asked, and found nothing to fix.** MW-000005's one contact is
  `relationship = 'self'`, `is_legal_guardian = false`, born 1988 — an adult
  by thirty-eight years, so `app.actor_may_read_reports_of`'s second branch
  (self, and eighteen or older) admits her regardless of the first. No
  report exists on staging yet (`select count(*) from report` returned
  zero), so nothing was actually being read either way; the check was of
  the shape the rule would take the day a report is issued, not of a
  present failure.
- **Grants were checked after 952 and 953**, as the eighth and ninth passes
  checked them after their own new functions. `app.practice_money_ledger()`,
  `app.vat_taxable_supplies_fils(date)` and `app.actor_may_read_reports_of(uuid)`
  (955, checked the same way) all show `app_role` holding execute and
  `public`, `anon` and `authenticated` holding none, on every one.
- **Twenty policy files were re-applied**, in path order, split across
  three calls for the tool's own size limit as every pass since the
  seventh has split theirs. None of the twenty is new this pass — round 31
  only amended `db/policies/reports/reports.sql`'s `report_readers` policy
  to ask `app.actor_may_read_reports_of` instead of the wider
  `app.actor_is_adult_contact_of` — so the count is unchanged: **one
  hundred and thirty-nine** policies stand on `public` afterwards, the same
  number the ninth pass left.
- **Nothing was owed to the seed, and round 31 adds none.** `git log
  5e008fb..2ef44f7 -- db/seed` is empty. Said here as the brief asked, and
  left at that.
- **Fingerprinted against a fresh `pnpm db:reset`** on `mcwellness-trunk-2`
  (its own database, port 5442), fetched and checked out to `2ef44f7` for
  the comparison and returned to its own branch
  (`handover-2026-09-06-builds`) afterwards. Seventy migrations and twenty
  policy files applied cleanly to an empty database. Eleven parts compared
  by content, each canonicalised and hashed inside the query itself rather
  than pulled into a client and hashed there — the earlier passes' own
  method stops working once a result set is large enough to overflow a
  tool's own output, which columns and constraints both now are: columns
  (1,221, by schema, table, name, type, nullability and default),
  constraints (530, with PostgreSQL 17's synthetic not-null constraint
  names folded to one label, the seventh and eighth passes' own method),
  indexes (471), triggers (290), policies (139), row-level security flags
  (72 tables), functions (82, by schema, name, argument list, return type,
  volatility, security and language), the grants `app_role` holds on
  `public` and `app` together (106 table grants, 43 function grants), and
  what `PUBLIC`, `anon` and `authenticated` hold on either schema (zero
  table grants on both sides; four function grants on both sides, all four
  `PUBLIC` execute on trigger-adjacent or context functions —
  `appointment_set_busy_end`, `audit_row_hash`, `current_tenant_id`,
  `set_updated_at` — present identically on staging and on the fresh
  database, so a standing fact carried since before this pass rather than
  anything round 31 touched). All eleven matched exactly.
- **The audit chain verifies** end to end, `app.verify_audit_chain()`
  returning null throughout. It stood at 950 rows before this pass touched
  any data — twelve more than the ninth pass's own count of 947, all three
  of them harmless drift: three untouched-since `list` reads of `assessment`
  logged on 2026-09-06 by other work between the ninth pass's report and
  this one, plus the ninth pass's own closing count already having grown
  by other hands. This pass's own six migrations and its policy re-apply
  wrote no audited row at all — no data step in any of the seven files —
  so the count did not move until the endpoint proof below wrote and then
  undid four rows of its own, and the two calls to `/api/audit/activity`
  logged two more read events against themselves. Final count: 956.
- **The demo needed no fresh visit row, for the second time running.** The
  confirmed home visit for MW-000005 already stood on **2026-09-06 at
  10:00–10:45 Dubai time** (06:00–06:45 UTC, `busy_end` 07:15 UTC) — the
  ninth pass's own visit, still today when this pass ran. `app.checkin_context`
  answers `found: true`, two active consents (`home_visit`, `participation`),
  `kit_calibration_overdue: false`, `kit_id: null`, unchanged from the ninth
  pass.
- **The laptop's own database was rebuilt from nothing, not merely
  migrated**, per the operator's own finding of 6 September named in the
  brief: `pnpm db:reset` (seventy migrations, twenty policy files) then
  `pnpm db:migrate` (nothing pending, confirming the reset left nothing
  unexplained) then `pnpm seed --fresh`, which reported six `app_user` rows,
  nine `user_role` rows and four `kit` rows among the rest — the portal
  accounts and the equipment register the stale seed had been missing, both
  present now.
- **The staging bundle was rebuilt** with `pnpm exec vite build --mode
  staging` (936 kB main chunk, service worker precache rewritten to 23
  entries covering 1,274 KiB).
- **Both demo servers were stopped and left to the keep-alive script.** The
  staging server on port 3100 and the laptop's API on port 3000 (and its
  paired Vite server on 5173, which the keep-alive script restarts
  together with 3000) were killed; the keep-alive script polling every
  sixty seconds — left running from an earlier session's scratch directory,
  which is exactly what docs/HANDOVER.md says to expect — picked up both
  within its next poll and relaunched them with the same commands section 5
  names. Afterwards `/api/health` and `/api/health/deep` answered `{"ok":true,...}`
  on both port 3100 and port 3000.
- **The three authenticated routes named in the brief were called, not just
  reasoned about**, exactly as the eighth and ninth passes proved the
  routing fallback and the assessment route: a magic link was minted
  server-side for the real owner's account (`generateLink`) and exchanged
  for a session with the anon key. `GET /api/billing/summary` answered
  `200` with a zeroed month (staging holds no payments or entitlements yet).
  `GET /api/audit/activity` answered `200` with the trail's own recent
  events. `GET /api/routing/day?date=2026-09-06` first answered `200` with
  an empty leg list and `mapAvailable: true` — a change from the ninth pass,
  which recorded `mapAvailable: false` while the practice's Google Maps key
  was still outstanding; it is wired in now — but no leg exists to read a
  source from with only one confirmed visit that day and nothing to draw a
  line between. A second, temporary appointment was booked for the same
  practitioner and a different client's location, under the owner's own
  actor stamp, and the route was called again: it answered one leg with
  `"source":"traffic"`, which is the exact value `app/api/_middleware/routing/google.ts`
  stamps on an estimate it computes — `'traffic' | 'straight-line'` is the
  whole of `DriveSource` (`domain/shared/routing.ts`), and the provider
  `kind` a request chooses between is `'google' | 'straight-line'`; there
  is no field anywhere in this codebase that ever reads `"google"` as a
  drive's own source. The brief's own words asked for `source: "google"`,
  which is not a value this system produces; `"traffic"` is what the same
  fact looks like once it is the actual field the code writes, and the
  server's own start-up line — "Drive estimates: Google Maps Platform drive
  estimates and day picture in Asia/Dubai." — says where it came from. The
  temporary appointment and its `drive_estimate` cache row were deleted
  immediately afterwards, under their own audit reason, so the demo stands
  at its usual four confirmed visits for MW-000005 and the cache is empty
  again until the day sheet itself asks.
- **Advisors were checked after the DDL.** Every `rls_enabled_no_policy`
  finding is a table this pass did not touch: the by-design bookkeeping
  tables every earlier pass already carries (`schema_migration`,
  `invoice_number_series`, the audit-log partitions and their default) and
  three `app`-schema tables reached only through security-definer functions
  (`app.audit_chain`, `app.erasure_active`, `app.setup_photo_filing`), none
  of which this pass's migrations touch. `assessment`, `assessment_document`,
  `report`, `report_delivery`, `report_number_series`, `kit`,
  `drive_estimate`, `scheduling_setting`, `portal_invite` and
  `portal_request` all carry policies and none is flagged. The one `WARN`
  is leaked-password protection, unrelated to this pass and already known
  (`docs/SECURITY.md`). Nothing new.

## What was done on 2026-09-06, eleventh pass: the door itself, `app.bootstrap_practice`

Main had reached `f06e666` (pull request 95, trunk round 32) since the
tenth pass's own `2ef44f7` — thirty-four commits, one migration this
project did not yet have: `db/migrations/956_bootstrap_practice.sql`, the
function that gives a fresh database its first practice. This pass owed
staging exactly that one file and nothing else; `git log 2ef44f7..HEAD --
db/policies` and `-- db/seed` are both empty, so neither the policies nor
the seed owed anything.

- **The seventy rows already there were checked before anything was
  touched.** Every file's sha256, computed straight off the files on disk,
  matched the checksum staging had recorded for it exactly.
- **956 was applied through Supabase's migration tool**, under the
  runner's own audit context (`app.reason` naming the file, a fresh
  `app.request_id`), with the bookkeeping row written immediately after,
  carrying the same sha256 the runner would compute
  (`db144edc006f6884463ec4cee42101250dcfa5e0bba9fa6000190dea2d0c745b`).
  `schema_migration` now holds **seventy-one rows**.
- **No policy re-apply owed**, confirmed above; one hundred and thirty-nine
  policies stand on `public`, unchanged from the tenth pass.
- **Nothing was owed to the seed, and round 32 adds none** — said here as
  every pass since the seed existed has said it, and true again. The
  synthetic practice made by the second pass stands unchanged: `tenant`
  holds its one row, and nothing this pass did touched it.
- **`app.bootstrap_practice` was not called.** This pass's job was the door,
  not walking through it — staging already has its practice, made by an
  earlier pass, and the function's own advisory lock and one-practice
  check would refuse a second one regardless.
- **Grants checked**: `execute` on `app.bootstrap_practice(text, text,
  uuid, text, text, text)` is revoked from `public` and from `app_role`,
  held by `service_role` (and by `postgres`, the function's owner, which
  needs no explicit grant), and absent for `anon` and `authenticated` — the
  same shape as production's own copy of the same migration.
- **The audit chain still verifies**, `app.verify_audit_chain()` returning
  null. `audit_log` stood at 956 rows before this pass — exactly where the
  tenth pass's own report left it — and stands at 956 after: creating a
  function wrote no row against any tenant-scoped table, so the count did
  not move.
- **The demo needed no fresh visit row, for the third time running.** The
  confirmed home visit for MW-000005 still stands on **2026-09-06 at
  10:00–10:45 Dubai time**, one of the same four confirmed visits the
  tenth pass counted.
- **The schema fingerprint was taken against a fresh `pnpm db:reset &&
  pnpm db:migrate`** on `mcwellness-trunk-2` (its own database, port 5442),
  fetched and checked out to `f06e666` for the comparison (the worktree was
  clean; nothing needed setting aside this time) and left there afterwards.
  Seventy-one migrations and twenty policy files applied cleanly to an
  empty database. Nine parts were compared, canonicalised and hashed
  inside the query itself: columns (1,221), constraints (530), indexes
  (471), triggers (290), policies (139), row-level security flags (72
  tables), functions (83, the one new one being `app.bootstrap_practice`),
  the grants `app_role`, `anon`, `authenticated` and `PUBLIC` hold on
  `public` and `app` together (106 table grants, 47 function grants keyed
  by function identity rather than `specific_name`). Eight of the nine
  matched the fresh build exactly.
- **The ninth — columns — matched in substance, not in physical position,
  and the difference was chased down rather than waved past.** Ordered by
  column name instead of ordinal position, staging's 1,221 columns hash
  identically to production's and to the fresh local build (`2c82cd6d…`).
  Ordered by physical position, two tables disagree with production:
  `schema_migration` (`checksum` is staging's third column, production's
  second) and `invoice` (`supplied_on` sits last on staging, mid-table on
  production). Every column in both tables is identical in name, type,
  nullability and default on both projects — this is column-slot history,
  not schema drift: production's seventy pre-956 migrations ran as one
  unbroken bootstrap, so a column's physical slot follows the file that
  added it in a single pass, while staging acquired the same files across
  eleven passes spread from 2026-09-02 to today, where `alter table ...
  add column` claims the next free slot rather than a slot a same-named,
  later-dropped column once held. Nothing here is this pass's own doing,
  and nothing reads a column by position anywhere in this codebase.
- **The laptop's own database took the one pending migration**, `pnpm
  db:migrate` applying `956_bootstrap_practice.sql` alone (seventy already
  stood, twenty policy files re-applied as every run does).
- **The staging bundle was rebuilt** with `pnpm exec vite build --mode
  staging` (938 kB main chunk, service worker precache rewritten to 23
  entries covering 1,276 KiB — both within a hair of the tenth pass's own
  figures).
- **Both demo servers were stopped and left to the keep-alive script.** The
  staging server on port 3100 and the laptop's API on port 3000 (with its
  paired Vite server on 5173) were killed; the keep-alive script — still
  the tenth pass's own instance, polling every sixty seconds from its own
  scratch directory — picked up both within thirty seconds and relaunched
  them with the same commands section 6 names. Afterwards `/api/health`
  and `/api/health/deep` answered `{"ok":true,...}` on both port 3100 and
  port 3000.
- **Advisors were checked after the DDL.** The same thirty-one
  `rls_enabled_no_policy` `INFO` findings the tenth pass carried, none of
  them a table this pass's own migration touches, counted directly against
  `pg_class` rather than assumed. The one `WARN` is the same
  leaked-password-protection finding, unrelated to this pass and already
  known. Nothing new.

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
