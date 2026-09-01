---
name: uae-compliance
description: UAE health-data, DHA, NABIDH, VAT and e-invoicing rules for McWellness. Load whenever working on clinical records, billing, data storage, infra, consent, or integrations.
---
# UAE compliance facts (from docs/market-study.md §8; lawyer/tax advisor confirm before relying)

## Data
- Federal Law No. 2 of 2019: health data physically stored in UAE; digital records retained 25 years after last visit; no unauthorised secondary use.
- Dubai Health Data Law No. 11 of 2018 + Cabinet Decision 32/2020 govern NABIDH.
- Only AWS me-central-1 (or Azure UAE North) for anything holding PHI: databases, object storage, backups, logs, analytics, error tracking.
- Erasure requests: non-clinical data erased; clinical record locked, never deleted.

## Facility & licensing
- Regulator: DHA (Sheryan). Classification received in writing: outpatient clinic with off-site activity. Physical clinic exists; sessions delivered at home or in clinic.
- HIE: NABIDH. Certified EMR required; self-certification not accepted. Grace period under 6 months from launch; own-system certification intended — a jurisdiction-aware adapter interface is required so a licensed EMR can be slotted in if needed. Scope confirmation from DHA pending.
- Structured/coded only: Emirates ID mandatory; ICD-10-CM diagnoses; meds with generic name/dose; allergies; vitals; procedures; referrals. Free text rejected as primary value. FHIR R4 / CDA.
- Practitioners: DHA professional licence, scope-limited. Only licensed clinicians author protocols and sign reports; only certified technicians execute sessions.

## VAT (FTA)
- Qualifying healthcare to the patient: zero-rated. Wellness/no diagnosis: 5%. Recipient ≠ patient (corporate): 5%. School/immigration-purpose reports: 5%.
- Rate is computed per invoice line from the clinical record and stored with evidence. Never hand-entered.
- Registration threshold AED 375,000 (zero-rated counts). Quarterly returns within 28 days. Records 5 years (separate from 25-year clinical).
- Tax point on prepaid packages: pending written advice — do not assume.

## E-invoicing
- PINT AE (Peppol UBL/XML). Second wave: appoint Accredited Service Provider by 31 Mar 2027, mandatory 1 Jul 2027. Build invoices as structured objects now.

## Audit
- Immutable, hash-chained audit log of every PHI read and write. See docs/SPEC/audit.md.
