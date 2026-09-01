---
paths: ["db/**", "domain/**", "app/api/**", "jobs/**", "infra/**"]
---
# Compliance rules
- Region: only `me-central-1` may appear in any AWS config. Any other region string is a defect.
- Retention: clinical documents and records are kept 25 years from last clinical activity. Erasure requests lock the clinical record; they never delete it.
- Consent: check the specific `consent.purpose` at execution time — never cache a "has consent" boolean on the client.
- Credential: check `credential` capability + validity dates at the moment of authorship or assignment.
- Audit: every table carrying PHI has the audit trigger; every request sets `app.actor_id`, `app.request_id`, `app.reason` via `set_config(..., true)`.
- NABIDH-ready: Emirates ID mandatory on active clients; diagnoses ICD-10-CM; no free text as a primary clinical value.
- VAT: computed by `domain/billing/resolveVat`, stored with evidence reference, immutable on issued invoice.
- Vendors: anything that receives data must be listed in `docs/COMPLIANCE/approved-vendors.md` first.
