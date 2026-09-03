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

Check the first line, which names the environment it was rendered for. Open
the project's SQL editor, confirm the project reference in the address bar,
paste the whole file and run it once: the script opens and commits its own
transaction, refuses a database that already holds a practice, and stops if
it is applied piecemeal, but it carries no other target check. Afterwards
delete the file and the editor's saved snippet; a rendered script is never
committed (`*.seed.sql` is ignored).

Either way, keep that identity key with the API's secrets; the API needs the
same one to open the seeded Emirates IDs.

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

**The consent wording has to be uploaded once, by hand.** `pnpm seed` writes
those eight files into the local folder, but a rendered seed script carries
only the rows: each consent wording document row holds a `storage_key` and
the sha256 of its file, and the bytes travel separately. After applying a
rendered seed to a hosted project, upload each file in `docs/CONSENT` (all
but `README.md`) into the `documents` bucket at exactly the `storage_key` its
row names — the script's own header repeats this. Until that is done the rows
exist and point at nothing, which is visible the moment anyone opens a
consent. The mapping is stable: the seed's document ids are fixed, so
`select purpose, locale, storage_key from document where kind = 'consent_text'
order by purpose, locale` gives the list to work from.

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
