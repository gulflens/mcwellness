# McWellness

Home-delivered neurofeedback platform for a DHA-licensed outpatient clinic in Dubai. Single TypeScript web app, PostgreSQL, self-hosted Supabase in AWS me-central-1.

## Absolute rules
1. All PHI lives in AWS me-central-1 (UAE). Never configure a service, bucket, log sink, SDK, font CDN or third-party call outside UAE for anything that can carry patient data.
2. Never write real or realistic patient data into any file, test, fixture, seed or commit. Use `db/seed/` generators only.
3. Clinical data is structured and coded. Free text may accompany a coded field, never replace it.
4. Business rules live in `domain/` as pure functions with tests. No business logic in components, routes or SQL.
5. Every PHI read/write goes through the audit context middleware. Never log PHI to console, error trackers or APM.
6. VAT treatment is derived from the clinical record, never hand-entered.
7. Clinical records are append-only: closed sessions, signed reports, issued invoices, protocols and assessments get a new version, never an in-place edit.
8. Edit only paths you own per `docs/SPEC/OWNERSHIP.md`. Shared-zone changes go in `docs/CHANGE-REQUESTS/`.

## Stack
TypeScript everywhere. React + Vite app with three role areas (admin, therapist PWA, client). Node API routes. PostgreSQL + Supabase (Auth, RLS, Storage). pg-boss for jobs. Terraform for me-central-1. Money in integer fils.

## Workflow
- Read `docs/SPEC/00-data-model.md` and the module spec before implementing anything.
- Plan mode first for any multi-file change. List spec ambiguities before proposing.
- Tests before implementation for everything in `domain/`.
- Run `pnpm verify` before declaring work done. Dispatch compliance-reviewer and security-reviewer on every PR.
- Small, single-purpose commits. Conventional commit messages.
- The owner is not a developer. When asked, explain changes in plain language.

## Commands
pnpm dev · pnpm test · pnpm verify · pnpm db:migrate · pnpm db:reset · pnpm seed

## Visual system
Read docs/DESIGN-BRIEF.md before writing any UI.
- Colour comes only from app/shell/tokens.css. No hex literals in components.
- Hue is reserved for EEG band data and three status states. Whether the inherited McWellness violet is an accent is an open decision (PRODUCT.md, Brand Commitments); until it is taken, there is no accent colour.
- One typeface family. Tabular figures for all numerals. Never monospace for data.
- No ALL-CAPS labels, no arrows appended to button text, no middle-dot-joined metadata, no single-word colour accents in headings.
- Tables for homogeneous data. Cards only for heterogeneous content.
- Motion only in response to a user action, 160ms. One exception: the ribbon slice.
