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
