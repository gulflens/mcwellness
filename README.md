# McWellness

The practice's own software: one record per client from first enquiry to signed
report and paid invoice, and one map per day for every practitioner. The rules are
in `CLAUDE.md`; what lives where is in `docs/SPEC/OWNERSHIP.md`; the product
record is `PRODUCT.md`.

## What you need once

- Node 24 (`node -v`)
- pnpm 11 (`pnpm -v`)
- Docker with Compose (`docker compose version`). The local database is Supabase's own Postgres image at the same version production runs, so what passes here behaves the same there.

On a Mac that uses Colima instead of Docker Desktop, install Compose with
`brew install docker-compose`, add its plugin directory to `~/.docker/config.json`
as the install notes say, and run `colima start` before the database commands.

## First time

```
pnpm install
cp .env.example .env
```

The defaults in `.env.example` are right for local work. Never put staging or
production values in `.env`.

## Every day

```
pnpm db:up     # starts the local database
pnpm dev       # starts the app and the API together
```

Then open http://localhost:5173. The address http://localhost:5173/api/health
should answer `{"ok":true,"service":"mcwellness-api"}`.

## Checking work

```
pnpm verify
```

It runs four checks in order: formatting, code rules, types, tests. If it prints
errors, the work is not done. The same command runs on every pull request. The
tests include the sign-in rules and the token checks, with no database needed.

```
pnpm test:db
```

The database tests need the local database running (`pnpm db:up`). They wipe
it and rebuild it from the migrations, then prove the schema, the constraints,
the audit trail and the tenant isolation. They run on every pull request too,
against a fresh database that only ever holds synthetic rows.

## Signing in and the API

Every request to the API carries the person's Supabase sign-in token. The API
checks the token itself, works out who the person is and what they may do, and
records who did what on every change and every read of a client's record. It talks to the database as its own
limited user, `mcwellness_api`, never as the owner, so a mistake in the API can
never bypass the access rules.

- Locally, the API user's password is the one in `API_DATABASE_URL` in `.env`;
  `pnpm db:reset` and `pnpm db:migrate` set it on the database for you.
- On Supabase, the owner runs the migrations, then sets that user's password
  once in the SQL editor: `alter role mcwellness_api password '...'` (a password
  from the password manager, never written down in the repository), and fills
  `SUPABASE_URL` and `SUPABASE_JWKS_URL` in the deployment's settings.

## Opening the app

Run `pnpm dev` and open http://localhost:5173. On a laptop the sign-in screen lists the four seeded people as one-click sign-ins: the API opens that door only when `APP_ENV=development`, the database is local and the local secret is set, and it does not exist anywhere else. The owner lands on the admin console, the ledger: a rail on the left, the clients table on the right, read through the database's row security as the signed-in person and recorded in the audit trail. A practitioner lands on the practitioner app's ground and a client contact on the portal's; both are landing pages until their own work arrives. Staging and production sign in through Supabase: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and the door is never offered.

Every colour, size and timing on screen comes from `app/shell/tokens.css`, following docs/DESIGN-BRIEF.md: no accent colour, one typeface family (IBM Plex Sans with its Arabic companion, bundled), tables not cards. Lint refuses a hex colour or one of the brief's tells in app code.

## The record timeline

Click a client's name in the table and a drawer opens on the right with the record's timeline: everything that has ever touched the record, newest first, grouped by day, in plain sentences. "Hazel Harbour created the record", "Rowan Meadow viewed this record", "Hazel Harbour withdrew marketing consent" with the reason beneath. The sentences are composed on the server from the audit trail; the browser never sees a raw audit row, a contact's phone or email is never repeated in a sentence, and an identity number never appears at all. The owner, an admin and the lead practitioner may read it; opening it is itself recorded. The same sentences exist in Arabic (`?locale=ar`) for the switch to come.

## Running in production

`pnpm build` writes the app to `dist/`; `pnpm start` runs the API with `SERVE_APP=true`, which serves that folder as well, so one process answers everything with the same protective headers. Set `HOST` to the address the reverse proxy reaches, `TRUSTED_PROXY_HOPS` to the number of proxies in front, and the rate limits if the defaults do not suit. docs/SECURITY.md describes every layer.

## Synthetic data

No real person is ever written into this repository, so `pnpm seed` invents a whole practice to build and test with: one studio, four people with logins (an owner who is also the lead practitioner, two more practitioners, a coordinator), six services, and twenty clients with contacts, home locations and consents. The same data comes out every run. Every value sits in a range reserved for fakes: names from a fixed fictional list, phones in the `+971 50 000 xxxx` block, emails at `example.com`, Emirates IDs from `784-1900-*`, only on a parent who has consented, sealed with the key in `IDENTITY_KEY`. The two local placeholders (the sign-in secret and the identity key) are accepted only when `APP_ENV=development` is set explicitly. Running the command again adds nothing; `pnpm seed --fresh` wipes the local database and rebuilds it. The seed refuses production always, and a Supabase project unless `APP_ENV=staging`.

## Database commands

- `pnpm db:migrate` applies any new SQL files in `db/migrations`, then re-applies
  every policy file in `db/policies`.
- `pnpm db:reset` wipes the local database and rebuilds it. It refuses to run
  against anything that is not on this computer.
- `pnpm db:down` stops the database.

Migration files follow three rules: they are named `NNN_description.sql`, they
use the number range assigned to their worktree in `docs/SPEC/OWNERSHIP.md`, and
each carries a `-- rollback:` comment block describing how to reverse it. A file
without that block is refused. Everything in a file runs inside one transaction.
Policy files in `db/policies` are different: they are re-applied on every run,
so each is written as `drop policy if exists` followed by `create policy`.

## Where things live

- `app/` the one React application: `shell`, `admin`, `therapist`, `client`, and `api`
- `domain/` pure business rules with tests, no I/O
- `db/` migrations, row-level security policies, synthetic seed generators
- `jobs/` background workers (later)
- `infra/` deployment definitions, later, if anything needs them
- `docs/` the specs, the design brief, the market study, decisions and compliance
