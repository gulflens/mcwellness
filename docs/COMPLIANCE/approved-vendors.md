# Approved vendors — anything that can receive data

| Vendor | Purpose | Data it receives | Region | Approved |
|---|---|---|---|---|
| Supabase Cloud, production project | Auth, Postgres, Storage | All client data | Owner's choice (the previous app runs in ap-south-1, Mumbai) | ✅ once created |
| Supabase Cloud, staging project `mcwellness` (`ajjkvjtqxktkgrvcrzkh`, Mumbai `ap-south-1`, Pro plan) | Auth, Postgres, Storage for staging | Synthetic data only; created 2026-09-02 | Approved 2026-09-02 (owner) |
| Supabase Cloud, staging project | Staging | Synthetic only, never client data | Same | ✅ staging only |
| GitHub | Source code, CI | Code; the CI database holds only the synthetic rows the tests create | US | ✅ code and synthetic tests only |
| Google Maps Platform | Distance matrix, geocoding | Coordinates only, never names | Global | ⚠️ send location ids only |
| Payment gateway | TBD | Amount, reference, payer contact | TBD | ❌ not yet |
| BNPL provider (Tabby or Tamara, candidates) | Packages | Amount, reference, payer contact | UAE | ❌ not yet |
| WhatsApp Business API | Phase 2 | Phone, message text (no session content) | Meta | ❌ not yet |
| Zoho Books | Accounting | Journals, invoice totals, no session content | TBD | ❌ not yet |

Anything not on this list does not receive data. Error tracking, analytics SDKs and font CDNs are NOT approved — self-host fonts, no third-party analytics.

Hosting outside the UAE is the owner's decision of 2026-09-02 (the business is a wellness company, not a licensed clinic), to be confirmed with the founder's lawyer under the UAE personal-data law, which treats health-type data as sensitive.
