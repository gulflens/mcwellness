# McWellness

The clinic's own software: one record per client from first enquiry to signed
report and paid invoice, and one map per day for every therapist. The rules are
in `CLAUDE.md`; what lives where is in `docs/SPEC/OWNERSHIP.md`; the product
record is `PRODUCT.md`.

## What you need once

- Node 24 (`node -v`)
- pnpm 11 (`pnpm -v`)
- Docker with Compose (`docker compose version`)

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
errors, the work is not done. The same command runs on every pull request.

## Database commands

- `pnpm db:migrate` applies any new SQL files in `db/migrations`.
- `pnpm db:reset` wipes the local database and rebuilds it. It refuses to run
  against anything that is not on this computer.
- `pnpm db:down` stops the database.

Migration files follow three rules: they are named `NNN_description.sql`, they
use the number range assigned to their worktree in `docs/SPEC/OWNERSHIP.md`, and
each carries a `-- rollback:` comment block describing how to reverse it. A file
without that block is refused. Everything in a file runs inside one transaction.

## Where things live

- `app/` the one React application: `shell`, `admin`, `therapist`, `client`, and `api`
- `domain/` pure business rules with tests, no I/O
- `db/` migrations, row-level security policies, synthetic seed generators
- `jobs/` background workers (later)
- `infra/` deployment definitions, UAE region only (later)
- `docs/` the specs, the design brief, the market study, decisions and compliance
