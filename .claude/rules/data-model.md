---
paths: ["db/**", "domain/**"]
---
# Data model rules
- `docs/SPEC/00-data-model.md` is authoritative. Do not invent entities; request changes.
- Every table: `id uuid pk`, `tenant_id uuid not null`, `created_at`, `updated_at`, `created_by`. RLS on `tenant_id`.
- `client_id` present (directly or via one join) on every table holding personal data so the audit trigger can denormalise it.
- Money: integer fils. Never float/numeric for currency.
- Versioned entities carry `version`, `supersedes_id`, `amendment_reason`. Current = no successor.
- Enums for closed sets; reference tables for open sets.
- Migrations: SQL files in your assigned range, forward-only, each with a `-- rollback:` comment block. Never edit a merged migration.
- Emirates ID, if collected at all: encrypted column + hash column, never plaintext, never required to enrol.
- Physical names: the `user` entity is the table `app_user` (`user` is reserved in SQL).
- Standard-column exemptions, recorded 2026-09-02: `tenant` has no `tenant_id` (it is the tenant); `audit_log` keeps a bigint chain id, uses `occurred_at` as its creation time, and has no `updated_at`, `created_by` or foreign keys because it is append-only (its `tenant_id` is not null); `app.audit_chain` and `schema_migration` are single-purpose bookkeeping tables. Nothing else is exempt.
- Policies: `db/policies/**/*.sql` are declarative (`drop policy if exists`, then `create policy`) and the runner re-applies every file on each `db:migrate`, after the migrations. A policy change never needs a migration. Core policies are the trunk's; a worktree owns `db/policies/<module>/`.
- A column named `client_id` references `public.client` and nothing else; the audit trail attributes rows by that name. An integration's or a vendor's client identifier is named otherwise (`zoho_customer_id`, not `client_id`).
- A stream's own audited table declares itself for `tests/db/audit.test.ts` with `comment on table` starting `'audited: client'` (it carries a uuid `client_id`) or `'audited: no client'` (it deliberately does not), set in the stream's own migration; the trunk's tables are classified in that test directly and need no comment.
