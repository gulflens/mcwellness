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
│  ├─ admin/                 role: owner / admin / clinical_lead / finance
│  ├─ therapist/             role: practitioner (installable PWA)
│  ├─ client/                role: client_contact (portal)
│  └─ api/                   server routes; thin — they call domain/
├─ jobs/                     pg-boss workers (PDF render, notifications)
├─ infra/                    Terraform — me-central-1 only
└─ tests/                    integration and end-to-end
```

## The shared zone — `main` only

Edited only in the trunk session or by the integrator (the owner) on `main`. No worktree touches these.

| Path | Why |
|---|---|
| `CLAUDE.md`, `.claude/**` | Rules apply to everyone |
| `docs/SPEC/00-data-model.md`, `docs/SPEC/OWNERSHIP.md` | The contract |
| `domain/shared/**` | Types every module imports |
| `db/migrations/000–099` | Core schema: tenant, user, role, practitioner, credential, service_type, location, client, contact, consent, document, audit_log |
| `db/policies/core/**` | RLS on core tables |
| `db/seed/**` | Synthetic generators |
| `app/shell/**`, `app/api/_middleware/**` | Auth, audit context, routing |
| `infra/**`, `package.json`, lockfile, CI config | Build and deploy |

**If a worktree needs a change here:** write `docs/CHANGE-REQUESTS/<worktree>-NN.md` (what, why, proposed diff), commit it, and stop work that depends on it. The integrator applies it on `main`; all worktrees rebase.

## Stage 1 worktrees

| Worktree | Owns exclusively | Migrations | Spec |
|---|---|---|---|
| `client-record` | `domain/client/**`, `app/admin/clients/**`, `app/api/clients/**`, `db/policies/client/**`, `tests/client/**` | `100–199` | `SPEC/client-record.md` |
| `scheduling` | `domain/scheduling/**`, `app/admin/schedule/**`, `app/therapist/today/**`, `app/api/appointments/**`, `db/policies/scheduling/**`, `tests/scheduling/**` | `200–299` | `SPEC/scheduling-manual.md` |
| `session-capture` | `domain/session/**`, `app/therapist/session/**`, `app/api/sessions/**`, `db/policies/session/**`, `tests/session/**` | `300–399` | `SPEC/session-capture.md` |
| `billing` | `domain/billing/**`, `app/admin/billing/**`, `app/api/billing/**`, `db/policies/billing/**`, `jobs/billing/**`, `tests/billing/**` | `400–499` | `FINANCE-SPEC.md` |

## Stage 2 worktrees (open only after Stage 1 is merged)

| Worktree | Owns exclusively | Migrations | Spec |
|---|---|---|---|
| `assessment` | `domain/assessment/**`, `app/admin/assessments/**`, `app/api/assessments/**`, `tests/assessment/**` | `500–599` | `SPEC/assessment.md` |
| `reports` | `domain/reports/**`, `app/admin/reports/**`, `jobs/reports/**`, `app/api/reports/**`, `tests/reports/**` | `600–699` | `SPEC/reports-v1.md` |
| `client-portal` | `app/client/**`, `app/api/portal/**`, `tests/portal/**` | `700–799` | `SPEC/client-portal.md` |
| `audit-ui` | `app/admin/audit/**`, `app/api/audit/**`, `tests/audit/**` | `800–899` | `AUDIT-SPEC.md` §9 |

## Rules

1. **Never edit outside your owned paths.** If you find a bug elsewhere, write a change request, don't fix it.
2. **Migrations use your range only.** Filename `NNN_description.sql`. Never renumber.
3. **Import from `domain/shared` freely; never import from another module's `domain/`.** If two modules need the same type, it belongs in `shared` — change request.
4. **Each worktree has its own local Postgres.** `DATABASE_URL` in the worktree's `.env` points at a port unique to that worktree. Staging is for integration after merge only.
5. **One PR per worktree per day, small.** Both review agents run. Rebase on `main` before opening.
6. **A rebase conflict means the ownership map is wrong.** Stop, fix the map, then resolve.

## Local database ports

| Worktree | Port |
|---|---|
| `main` (trunk) | 5432 |
| `client-record` | 5433 |
| `scheduling` | 5434 |
| `session-capture` | 5435 |
| `billing` | 5436 |
| Stage 2 | 5437+ in table order |
