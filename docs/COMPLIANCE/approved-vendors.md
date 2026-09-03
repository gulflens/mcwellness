# Approved vendors — anything that can receive data

| Vendor | Purpose | Data it receives | Region | Approved |
|---|---|---|---|---|
| Supabase Cloud, production project | Auth, Postgres, Storage (the private `documents` bucket) | All client data. The bucket holds signed consents, session and QEEG reports, setup photos and practitioner certificates; a storage key is made of ids alone and never a name or a record number | Owner's choice (the previous app runs in ap-south-1, Mumbai) | ✅ once created |
| Supabase Cloud, staging project `mcwellness` (`ajjkvjtqxktkgrvcrzkh`, Pro plan) | Auth, Postgres, and Storage for staging: one private bucket `documents` holding the practice's files (docs/SEAMS.md) | Synthetic data only; created 2026-09-02. Bucket contents are documents; a storage key is made of ids alone and never a name or a record number | Mumbai, ap-south-1 (outside the UAE) | Approved 2026-09-02 (owner); the bucket confirmed in trunk round 14, 2026-09-03 |
| GitHub | Source code, CI | Code; the CI database holds only the synthetic rows the tests create | US | ✅ code and synthetic tests only |
| Google Maps Platform | Distance matrix, geocoding, and the practitioner's navigation hand-off | Coordinates only, never names or identities; the hand-off sends a client's entrance coordinates only on the practitioner's deliberate tap (operator decision 2026-09-03) | Global | Approved for coordinates; no name, record number or identity may accompany them |
| Payment gateway | TBD | Amount, reference, payer contact | TBD | ❌ not yet |
| BNPL provider (Tabby or Tamara, candidates) | Packages | Amount, reference, payer contact | UAE | ❌ not yet |
| WhatsApp, as a hand-off | Sending a family their invoice or receipt (docs/SEAMS.md, the sending seam) | **Nothing from this server.** The platform composes a `wa.me` link carrying a drafted bilingual message and a short-lived signed link to the document; the person opens it and presses send in their own WhatsApp. The only number involved is the household's own, which is already in the record; opening the link hands that number and the message to Meta from the sender's device, before send is pressed | Meta (global), from the moment the sender opens the link | Approved as a hand-off: nothing is sent from this server; the household's number and the drafted message, signed link included, reach Meta only from the sender's own device and account, and only when the sender opens the link |
| WhatsApp Business API | Phase 2 — sending on the practice's behalf | Phone, message text (no session content) | Meta | ❌ not yet — **and not needed for the hand-off above**, which sends nothing from this server. Approval is needed only to send on the practice's own account, which nothing does |
| Zoho Books | Accounting | Journals, invoice totals, no session content | TBD | ❌ not yet |

Anything not on this list does not receive data. Error tracking, analytics SDKs and font CDNs are NOT approved — self-host fonts, no third-party analytics.

Hosting outside the UAE is the owner's decision of 2026-09-02 (the business is a wellness company, not a licensed clinic), to be confirmed with the founder's lawyer under the UAE personal-data law, which treats health-type data as sensitive.
