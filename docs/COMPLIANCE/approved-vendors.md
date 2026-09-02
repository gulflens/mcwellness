# Approved vendors — anything that can receive data

| Vendor | Purpose | Data it receives | Region | Approved |
|---|---|---|---|---|
| AWS me-central-1 | Compute, RDS, S3, Secrets | All PHI | UAE | ✅ |
| Supabase (self-hosted) | Auth, PostgREST, Storage, Studio | All PHI | Runs in our AWS | ✅ |
| Supabase Cloud Pro | Staging | Synthetic only — NO PHI | Frankfurt | ✅ staging only |
| GitHub | Source code, CI | Code; the CI database holds only the synthetic rows the tests create, never PHI | US | ✅ code and synthetic tests only |
| Google Maps Platform | Distance matrix, geocoding | Coordinates only, never names | Global | ⚠️ send location ids only |
| Payment gateway | TBD | Amount, reference, payer contact | TBD | ❌ not yet |
| WhatsApp Business API | Phase 2 | Phone, message text (no clinical content) | Meta | ❌ not yet |
| Zoho Books | Accounting | Journals, invoice totals, no clinical | TBD | ❌ not yet |

Anything not on this list does not receive data. Error tracking, analytics SDKs and font CDNs are NOT approved — self-host fonts, no third-party analytics.
