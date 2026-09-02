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
is approved for synthetic data only.

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

Seed it the same way, from a laptop, with `APP_ENV=staging` so the seed
accepts a non-local database:

```bash
APP_ENV=staging IDENTITY_KEY=<64 hex chars, generated with: openssl rand -hex 32> \
DATABASE_URL='postgresql://postgres:<database password>@db.<ref>.supabase.co:5432/postgres' pnpm seed
```

Keep that identity key with the API's secrets; the API needs the same one to
open the seeded Emirates IDs.

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
SERVE_APP=true
HOST=<what the reverse proxy reaches>
TRUSTED_PROXY_HOPS=<the number of proxies in front, exactly>
```

The API verifies tokens against the project's published keys (the JWKS URL),
so it needs no shared secret. The pooler connection is the transaction pooler
on port 6543 with the role name suffixed by the project reference; the API
refuses any other role name at startup.

## 6. The app's build settings

Set at build time, so they are baked into the bundle:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<the project's anon / publishable key>
```

`VITE_SUPABASE_URL` must name the same project as `SUPABASE_URL`: the API
trusts that project's tokens and names its origin in the content security
policy. Then `pnpm build` and `pnpm start`.

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
