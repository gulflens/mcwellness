---
paths: ["db/**", "domain/**", "app/api/**", "jobs/**", "infra/**"]
---
# Compliance rules
- Positioning: McWellness is a wellness business. No diagnosis, treatment, patient or medical-claim language in code, copy, schema or fixtures; clients have goals, sessions and measurements.
- Personal data: collect only what the service needs, and a new personal field states its need. Emirates ID, if collected at all, is encrypted plus a keyed hash, never plaintext, never an image, never required to enrol.
- Consent: check the specific `consent.purpose` at execution time; never cache a "has consent" boolean on the client. A guardian consents for a minor.
- Certification: check `credential` capability and validity dates at the moment of authorship or assignment.
- Audit: every table holding personal data has the audit trigger; every request sets `app.actor_id`, `app.request_id`, `app.reason` and `app.tenant_id` via `set_config(..., true)` inside the request transaction.
- VAT: computed by `domain/billing/resolveVat` from the standard-rate setting, stored per line with the setting version, immutable on an issued invoice. Never typed by hand.
- Retention: 5 years after the last activity, then erasure or anonymisation on request; financial records 5 years regardless; audit partitions older than 5 years are dropped by the retention job.
- Erasure: personal fields are anonymised and documents deleted from storage; invoices keep what tax law requires; the client row stays as `erased` so history reconciles.
- Vendors: anything that receives personal data must be listed in `docs/COMPLIANCE/approved-vendors.md` first.
