# McWellness

Home-delivered neurofeedback training for a wellness practice in Dubai. Single TypeScript web app, PostgreSQL on Supabase Cloud.

## Absolute rules
1. McWellness is a wellness business, not a clinic (founder's determination, 2026-09-02). No code, copy, schema or fixture describes a diagnosis, a treatment, a patient or a medical claim. Clients have goals, sessions and measurements.
2. Never write real or realistic personal data into any file, test, fixture, seed or commit. Use `db/seed/` generators only.
3. Client records are structured. Measurements, goals and observations are typed fields; free text may sit beside them, never replace them.
4. Business rules live in `domain/` as pure functions with tests. No business logic in components, routes or SQL.
5. Every read and write of personal data goes through the audit context middleware. Never log personal data to console, error trackers or APM.
6. VAT is computed by `domain/billing` from the standard-rate setting, never typed per invoice.
7. Closed sessions, signed reports, issued invoices, protocols and assessments get a new version, never an in-place edit.
8. Retention is a MINIMUM of 5 years after a client's last activity. Records may be kept indefinitely after that; nothing deletes on a timer. Erasure or anonymisation happens when the client asks for it, and financial records keep 5 years regardless (operator, 2026-09-09).
9. Anything that receives personal data is listed in `docs/COMPLIANCE/approved-vendors.md` first. No analytics SDKs, error trackers or font CDNs.
10. Edit only paths you own per `docs/SPEC/OWNERSHIP.md`. Shared-zone changes go in `docs/CHANGE-REQUESTS/`.

## Stack
TypeScript everywhere. React + Vite app with three role areas (admin, practitioner PWA, client). Hono API on Node. PostgreSQL + Supabase Cloud (Auth, RLS, Storage) in the region the owner chooses. pg-boss for jobs. Money in integer fils.

## Workflow
- Read `docs/SPEC/00-data-model.md` and the module spec before implementing anything.
- Plan mode first for any multi-file change. List spec ambiguities before proposing.
- Tests before implementation for everything in `domain/`.
- Run `pnpm verify` before declaring work done. Dispatch compliance-reviewer and security-reviewer on every PR, and schema-reviewer on any PR with migrations.
- Small, single-purpose commits. Conventional commit messages.
- The owner is not a developer. When asked, explain changes in plain language.

## Commands
pnpm dev · pnpm test · pnpm test:db · pnpm verify (includes the secrets scan) · pnpm audit:deps · pnpm db:migrate · pnpm db:reset · pnpm seed · pnpm job:erasure-files · pnpm job:post-books · pnpm build · pnpm start

## Visual system
Read docs/DESIGN-BRIEF.md before writing any UI.
- Colour comes only from app/shell/tokens.css. No hex literals in components.
- Hue inside a figure is reserved for EEG band data and three status states. Alongside them the inherited McWellness violet IS the interface's accent: the owner took that open decision on 2026-09-08, reversing the "no accent colour" of 2026-09-02 (docs/SPEC/coloured-shell.md). It is `--brand`, and it never enters a chart's plotting area, as no band hue is ever used for chrome.
- One typeface family. Tabular figures for all numerals. Never monospace for data.
- No ALL-CAPS labels, no arrows appended to button text, no middle-dot-joined metadata, no single-word colour accents in headings.
- Tables for homogeneous data. Cards only for heterogeneous content.
- Motion only in response to a user action, 160ms. One exception: the ribbon slice.
