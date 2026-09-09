---
name: uae-compliance
description: UAE personal-data, VAT, e-invoicing and positioning rules for McWellness, a wellness business. Load whenever working on client records, billing, data storage, consent, retention, erasure or integrations.
---
# UAE wellness-business compliance facts (lawyer and tax advisor to confirm before relying)

## Positioning
- Founder's determination, 2026-09-02: McWellness is a wellness company, not a licensed healthcare facility. No DHA facility licence, no NABIDH, no 25-year health-record retention.
- Consequence: the product never describes, claims or records a diagnosis or a treatment. It records goals, sessions, measurements and observations. Marketing makes no medical claims.
- If the business ever offers services for diagnosed conditions, this classification must be revisited with a lawyer before the first such session.

## Personal data (Federal Decree-Law No. 45 of 2021, the PDPL)
- Applies to personal data of people in the UAE. Health-related data is sensitive and needs explicit consent for the specific purpose.
- Rights: access, correction, erasure, withdrawal of consent. Processing is limited to the stated purpose.
- Minimisation: collect only what the service needs. Emirates ID is optional and never required to enrol; if collected (only to verify the adult who consents for a minor or who is refunded) it is encrypted plus a keyed hash, and no image of an identity document is ever stored.
- Minors: a guardian consents.
- Retention (product decision, aligned with tax record-keeping; CLAUDE.md rule 8, operator 2026-09-09): a minimum of 5 years after the last activity, and indefinitely after that; nothing deletes on a timer. Erasure or anonymisation happens when the client asks. Financial records keep 5 years regardless. Audit rows written before an erasure keep the identifiers for the log's own minimum of 5 years: the lawyer confirms this exception before the first erasure.
- Hosting: Supabase Cloud in the region the owner chooses (decision of 2026-09-02, to be confirmed with the lawyer). Every vendor receiving personal data is listed in `docs/COMPLIANCE/approved-vendors.md`. No analytics SDKs, error trackers or font CDNs.

## VAT (FTA)
- Wellness services are standard-rated at 5%. Healthcare zero-rating applies only to qualifying healthcare by licensed providers, which this business is not.
- The rate is computed by `domain/billing` from the standard-rate setting and stored per invoice line; nobody types it.
- Registration threshold AED 375,000 of taxable supplies. Quarterly returns within 28 days. Records kept 5 years.
- Tax point on prepaid packages: written advice pending. Do not assume.

## E-invoicing
- PINT AE (Peppol UBL/XML). Second wave: appoint an Accredited Service Provider by 31 Mar 2027, mandatory 1 Jul 2027. Build invoices as structured objects now.

## Consumer protection
- Refund, expiry and cancellation terms are shown at point of sale in wording the lawyer has reviewed.
- No medical claims in advertising or in the product.

## Audit
- Immutable, hash-chained audit log of every read and write of personal data, kept at least 5 years and never dropped on a timer. See docs/SPEC/audit.md.
