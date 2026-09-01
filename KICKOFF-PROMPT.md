# Kickoff prompt — paste into your first Claude Code session, in the repo root, on `main`

You are building the trunk of McWellness. Start in plan mode.

Read, in this order: CLAUDE.md, docs/SPEC/00-data-model.md, docs/SPEC/OWNERSHIP.md, docs/SPEC/audit.md, .claude/rules/*.md, docs/ADR/*.md.

Then produce a plan — no code yet — for PR 1 of 6:

PR 1  Repo skeleton: pnpm; Vite + React + TypeScript app with `app/shell` and three empty role areas (admin, therapist, client); `domain/shared` with a placeholder type; `db/migrations`, `db/policies`, `db/seed` folders; a local Postgres via docker-compose on port 5432; `pnpm verify` = prettier check + eslint + tsc + vitest; GitHub Actions running verify on every PR.
PR 2  Core schema, migrations 000–099: exactly the tables in 00-data-model.md §2–§3 plus audit_log from audit.md §3, with triggers, hash chain, immutability grants and RLS on tenant_id.
PR 3  Auth (Supabase) + user/user_role/credential resolution + the audit session-context middleware (set_config actor/request/reason per request) + `canActor()` helpers in domain/shared.
PR 4  Synthetic seed generators: 1 tenant, 3 practitioners with credentials, 20 clients with contacts/locations/consents, using the reserved fake ranges (Emirates ID 784-1900-*, phones +971 50 000 xxxx, names from a fixed fictional list).
PR 5  App shell: login, role routing, navigation per docs/DESIGN-BRIEF.md §6, design tokens in app/shell/tokens.css, an admin table page listing seeded clients read via RLS.
PR 6  Record timeline component reading audit_log for one client in plain language (audit.md §9.1).

For PR 1 only: list anything ambiguous in the specs first, then the plan. Wait for my approval before writing code. After each PR is implemented, run pnpm verify, then dispatch compliance-reviewer and security-reviewer on the diff and fix what they find before telling me it's done. Explain each completed PR to me in plain language: what exists now that didn't before.

Exit test for the trunk (after PR 6): I can create a synthetic practitioner and client on staging, log in as each, and see the audit trail for that client. Then tag trunk-v1.
