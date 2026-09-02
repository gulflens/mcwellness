# OWNERSHIP — who may edit what

*Read this before writing any file. A session edits only the paths it owns. Everything else is read-only for that session.*

## Repository layout

```
mcwellness/
├─ CLAUDE.md
├─ .claude/                  rules, agents, hooks, skills
├─ docs/
│  ├─ SPEC/                  one spec per module — source of truth
│  ├─ ADR/                   architecture decisions
│  ├─ COMPLIANCE/            regulatory register, approved vendors
│  └─ CHANGE-REQUESTS/       requests to change the shared zone
├─ domain/                   pure TypeScript business rules, no I/O, 100% tested
│  ├─ shared/                types every module imports
│  ├─ client/  scheduling/  session/  billing/  assessment/  reports/
├─ db/
│  ├─ migrations/            numbered SQL, see ranges below
│  ├─ policies/              row-level security
│  └─ seed/                  synthetic data generators only
├─ app/                      one React application
│  ├─ shell/                 layout, navigation, auth guard, role routing
│  ├─ admin/                 role: owner / admin / lead_practitioner / finance
│  ├─ therapist/             role: practitioner (installable PWA)
│  ├─ client/                role: client_contact (portal)
│  └─ api/                   server routes; thin — they call domain/
├─ jobs/                     pg-boss workers (PDF render, notifications)
├─ infra/                    deployment definitions, later, if any
└─ tests/                    integration and end-to-end
```

## The shared zone — `main` only

Edited only in the trunk session or by the integrator (the owner) on `main`. No worktree touches these.

| Path | Why |
|---|---|
| `CLAUDE.md`, `.claude/**` | Rules apply to everyone |
| `docs/SPEC/00-data-model.md`, `docs/SPEC/OWNERSHIP.md` | The contract |
| `domain/shared/**` | Types every module imports. Every domain barrel (`domain/*/index.ts` — shared, client, scheduling, session, billing) is browser-safe; `domain/shared/identity.ts` is the one server-only exception, imported by its own path and never through any barrel, direct or transitive. `tests/lint/no-node-imports-in-browser-bundle.test.ts` walks the real import graph from each stream's own barrel and from the browser entry point and proves it, rather than leaving it to a comment. |
| `db/migrations/000–099 and 900–999` | Core schema: tenant, user, role, practitioner, credential, service_type, location, client, contact, consent, document, audit_log. The core range is exhausted at 099, so the trunk's own migrations continue at 900. |
| `db/policies/core/**` | RLS on core tables |
| `db/seed/**` | Synthetic generators |
| `app/shell/**`, `app/api/_middleware/**` | Auth, audit context, routing |
| `infra/**`, `package.json`, lockfile, CI config | Build and deploy |

**If a worktree needs a change here:** write `docs/CHANGE-REQUESTS/<worktree>-NN.md` (what, why, proposed diff), commit it, and stop work that depends on it. The integrator applies it on `main`; all worktrees rebase.

## Stage 1 worktrees

| Worktree | Owns exclusively | Migrations | Spec |
|---|---|---|---|
| `client-record` | `domain/client/**`, `app/admin/clients/**`, `app/api/clients/**`, `db/policies/client/**`, `tests/client/**` | `100–199` | `SPEC/client-record.md` |

> Seeded by the trunk in PR 5 (2026-09-02): `app/admin/clients/ClientsPage.tsx`, `app/api/clients/list.ts` and `app/api/clients/schema.ts` carry the first client table so the shell has a real screen. The client-record worktree owns them from here; the trunk does not touch them again without a change request.
>
> Seeded by the trunk in PR 6 (2026-09-02): `app/admin/clients/ClientDrawer.tsx` (client-record owns it from here) and `app/admin/audit/RecordTimeline.tsx`, `app/api/audit/timeline.ts`, `app/api/audit/schema.ts` (audit-ui owns them from here). The sentence catalogue `domain/shared/audit-narrative.ts` stays with the trunk.
| `scheduling` | `domain/scheduling/**`, `app/admin/schedule/**`, `app/therapist/today/**`, `app/api/appointments/**`, `db/policies/scheduling/**`, `tests/scheduling/**` | `200–299` | `SPEC/scheduling-manual.md` |
| `session-capture` | `domain/session/**`, `app/therapist/session/**`, `app/api/sessions/**`, `db/policies/session/**`, `tests/session/**` | `300–399` | `SPEC/session-capture.md` |
| `billing` | `domain/billing/**`, `app/admin/billing/**`, `app/api/billing/**`, `db/policies/billing/**`, `jobs/billing/**`, `tests/billing/**` | `400–499` | `SPEC/billing.md` |

## Stage 2 worktrees (open only after Stage 1 is merged)

| Worktree | Owns exclusively | Migrations | Spec |
|---|---|---|---|
| `assessment` | `domain/assessment/**`, `app/admin/assessments/**`, `app/api/assessments/**`, `tests/assessment/**` | `500–599` | `SPEC/assessment.md` |
| `reports` | `domain/reports/**`, `app/admin/reports/**`, `jobs/reports/**`, `app/api/reports/**`, `tests/reports/**` | `600–699` | `SPEC/reports-v1.md` |
| `client-portal` | `app/client/**`, `app/api/portal/**`, `tests/portal/**` | `700–799` | `SPEC/client-portal.md` |
| `audit-ui` | `app/admin/audit/**`, `app/api/audit/**`, `tests/audit/**` | `800–899` | `SPEC/audit.md` section 9 |

**Apply order across these ranges is not fixed.** Every worktree runs its own local Postgres (see the ports below), and each one only ever applies the migrations it has: the trunk's, and its own. Which of another stream's migrations, if any, a given database has seen depends on integration order, not on the numbers themselves — a database can carry billing's `400` without ever having carried the trunk's `099`, or the reverse. `db/runner/plan.ts` reflects this: a pending migration numbered below the highest one already applied is planned, not refused (the missing-file and duplicate-number checks still catch genuinely edited history). A migration may therefore depend only on what it names in its own `Needs` comment at the top of the file; it must never assume another stream's range is present just because its own number is higher.

## Rules

1. **Never edit outside your owned paths.** If you find a bug elsewhere, write a change request, don't fix it.
2. **Migrations use your range only.** Filename `NNN_description.sql`. Never renumber.
3. **Import from `domain/shared` freely; never import from another module's `domain/`.** If two modules need the same type, it belongs in `shared` — change request.
4. **Database tests live under `tests/<worktree>/db/` and nowhere else.** That is the only path the database runner scans outside the trunk's `tests/db/`; a database test anywhere else runs in the plain suite and fails for want of a database.
5. **Each worktree has its own local Postgres.** `DATABASE_URL` in the worktree's `.env` points at a port unique to that worktree. Staging is for integration after merge only.
6. **One PR per worktree per day, small.** Both review agents run. Rebase on `main` before opening.
7. **A rebase conflict means the ownership map is wrong.** Stop, fix the map, then resolve.

## Local ports, one set per worktree

Every port is a setting, so several worktrees run at once without collision
(docs/PARALLEL-SESSIONS.md). Each worktree's own `.env` carries its row, plus
`COMPOSE_PROJECT_NAME` so its database container and volume are its own.

| Worktree | Database (`DB_PORT`) | API (`PORT`) | Web (`WEB_PORT`) |
|---|---|---|---|
| `main` (trunk) | 5432 | 3000 | 5173 |
| `client-record` | 5433 | 3001 | 5174 |
| `scheduling` | 5434 | 3002 | 5175 |
| `session-capture` | 5435 | 3003 | 5176 |
| `billing` | 5436 | 3004 | 5177 |
| Stage 2 | 5437+ in table order | 3005+ | 5178+ |
