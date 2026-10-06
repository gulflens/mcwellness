---
paths: ["db/**", "domain/**", "app/api/**", "jobs/**", "infra/**"]
---
# Compliance rules
- Positioning: McWellness is a wellness business. No diagnosis, treatment, patient or medical-claim language in code, copy, schema or fixtures; clients have goals, sessions and measurements.
- Personal data: collect only what the service needs, and a new personal field states its need. Emirates ID, if collected at all, is encrypted plus a keyed hash, never plaintext, never an image, never required to enrol.
- Consent: check the specific `consent.purpose` at execution time; never cache a "has consent" boolean on the client. A guardian consents for a minor.
- Certification: check `credential` capability and validity dates at the moment of authorship or assignment.
- Audit: every table holding personal data has the audit trigger, with two named exceptions recorded in `.claude/rules/data-model.md`: `enquiry` and `practitioner_position` (a practitioner's shared location, kept two days and never audited, migration 211); every request sets `app.actor_id`, `app.actor_roles`, `app.request_id`, `app.reason` and `app.tenant_id` via `set_config(..., true)` inside the request transaction, under `set local role app_role`.
- VAT: computed by `domain/billing/resolveVat` from the standard-rate setting, stored per line with the setting version, immutable on an issued invoice. Never typed by hand.
- Retention: a minimum of 5 years after the last activity, and indefinitely after that; nothing deletes on a timer. Erasure or anonymisation happens when the client asks; financial records keep 5 years regardless (CLAUDE.md rule 8, operator 2026-09-09). This rule is about client records. A staff member's shared location (`practitioner_position`) is not a client record: it is deleted two days after it was recorded, by design, by the hourly job (docs/SPEC/dispatch.md section 15); a staff consent and its audit rows are kept as any audit row is.
- Erasure: personal fields are anonymised and documents deleted from storage; invoices keep what tax law requires; the client row stays as `erased` so history reconciles.
- Vendors: anything that receives personal data must be listed in `docs/COMPLIANCE/approved-vendors.md` first.
