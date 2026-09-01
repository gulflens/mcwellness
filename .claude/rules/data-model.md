---
paths: ["db/**", "domain/**"]
---
# Data model rules
- `docs/SPEC/00-data-model.md` is authoritative. Do not invent entities; request changes.
- Every table: `id uuid pk`, `tenant_id uuid not null`, `created_at`, `updated_at`, `created_by`. RLS on `tenant_id`.
- `client_id` present (directly or via one join) on every PHI table so the audit trigger can denormalise it.
- Money: integer fils. Never float/numeric for currency.
- Versioned entities carry `version`, `supersedes_id`, `amendment_reason`. Current = no successor.
- Enums for closed sets; reference tables for open sets.
- Migrations: SQL files in your assigned range, forward-only, each with a `-- rollback:` comment block. Never edit a merged migration.
- Emirates ID: encrypted column + hash column. Never store plaintext.
