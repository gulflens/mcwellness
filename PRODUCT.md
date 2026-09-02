# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Decided by the brief (ADR 0001) and re-baselined on 2026-09-02: one TypeScript
codebase; React + Vite app with three role areas (admin desk, practitioner
installable PWA, client portal); Hono API on Node; PostgreSQL with Supabase
Cloud (Auth, RLS, Storage) in the region the owner chooses; pg-boss jobs.
Staging is a separate Supabase Cloud project with synthetic data only.

## Users
- Field practitioners: standing in a family's living room in Dubai, phone in
  one hand, EEG kit in the other, dim light, often no signal; running session N
  of 30 for a child and recording it so the record reaches the server intact.
  The highest-stakes surface.
- The lead practitioner and the admin coordinator: on desktop with dense data
  and many clients; scheduling by hand, checking certifications and consent,
  reviewing and signing reports.
- Client households: a parent on their phone at 11pm wanting to know whether
  their nine-year-old is improving; anxious, not technical; many read Arabic
  first. Their reports go on to schools, coaches and whoever the family
  chooses.
- The owner: solo and non-technical, driving the build with Claude Code; every
  change must be explainable in plain language.

## Product Purpose
The operating system for a wellness practice delivering neurofeedback
training in clients' homes across Dubai: one record per client from first
enquiry to signed report and paid invoice, and one map per day per
practitioner. Success: the first paid session runs on the system within three
months of kickoff. The trunk's exit test: a synthetic practitioner and client
can log in on staging and the audit trail for that client is visible.

## Positioning
A field-service platform with a measurement core, built privacy-first as a
product choice: purpose-specific consent, a hash-chained audit trail of reads
as well as writes, a stated retention period, structured records rather than
free text. Neighbouring products are either practice-management tools with no
measurement core or field-scheduling tools with no client record; the join is
the moat. Home delivery removes the travel that drives programme drop-out. The
product makes no diagnosis or treatment claims: clients bring goals, and the
product makes their progress visible.

## Operating Context
- McWellness is a wellness business, not a clinic (founder's determination,
  2026-09-02): no DHA facility licence, no NABIDH, no 25-year retention. The
  UAE personal-data law still treats health-type data as sensitive, so consent,
  minimisation, retention and erasure are handled deliberately; hosting outside
  the UAE is the owner's decision, to be confirmed with the founder's lawyer.
- Programmes run 20 to 40 sessions, two or three a week, over three to six
  months. Clients are promised a 45-minute arrival window, never a clock time.
- Practitioners drive personal cars; Salik and parking are reimbursed.
- Dubai addressing: Makani numbers plus verified entrance and parking
  coordinates; arrival intelligence accumulates per location.
- Practitioners work offline routinely (underground parking, villas). Session
  capture is a single-writer outbox, never a sync engine (ADR 0002).
- Consent, certification validity and kit calibration gate every session
  start. Closed sessions and signed reports are versioned, never edited in
  place.
- Reports are the tangible product: bilingual PDFs signed by the lead
  practitioner, shared with whoever the family chooses.
- Money is integer fils; an entitlement ledger; deferred revenue; VAT at the
  standard rate of 5% on every service, computed from a setting and never
  typed (tax advisor to confirm); PINT AE e-invoicing mandatory from 1 July
  2027.
- Retention: 5 years after the last activity, then erasure or anonymisation on
  request; financial records 5 years regardless.
- WhatsApp is the client channel (Phase 2). Email never carries client data.

## Capabilities and Constraints
- Phase 1 trunk, six PRs: repo skeleton; core schema and audit log; auth and
  audit middleware; synthetic seed; app shell with role routing and an admin
  client table; the record timeline.
- Stage 1 worktrees after the trunk: client record, manual scheduling, session
  capture, billing. Stage 2: assessment, reports, client portal, audit UI.
  Route solver, kit logistics, insurance and corporate accounts are Phase 2 or
  later.
- Absolute rules (CLAUDE.md): wellness positioning with no diagnosis or
  treatment language; no real or realistic personal data anywhere in the repo;
  structured records; business rules as pure functions in `domain/`; every
  read and write of personal data audited; VAT never hand-entered;
  append-only closed records; 5-year retention then erasure; the vendor
  register; the ownership map.
- Terminology: client (the person receiving sessions, usually a minor),
  contact (parent or guardian), practitioner, lead practitioner, goal (what
  the client wants from the programme), appointment (a promise of a session),
  session, entitlement (one credit), protocol, assessment (a measurement,
  never a diagnosis), report, MRN in the form `MW-000001`.
- Undecided, recorded not invented: the production Supabase region; whether
  the Emirates ID is collected at all (kept optional, never required to
  enrol); font licence (Greta Sans and Greta Arabic, or IBM Plex); the band
  colour ramp against the practice's EEG software; whether the session ribbon
  works with real data; the tax point on prepaid packages (tax advisor, in
  writing); BNPL provider; refund wording (lawyer); the lawyer's confirmation
  of hosting and retention under the personal-data law.

## Brand Commitments
- Name: McWellness. The platform inherits the existing McWellness UAE
  identity: the Latin wordmark in every locale, the store name "McWellness
  UAE", the website mcwellnessuae.com, the practice mark at
  `assets/brand/logo.png` in the `gulflens/mcwellness-uae` repository (660 by
  222 pixels, printed on invoices and receipts), and the founding violet
  `#4B1173` carried from the QEEG report tool.
- Voice: accurate, unhyped, no growth language, no medical claims; British
  English; no emoji; plain-language copy first with the measurement on tap; no
  gamification, streaks or nagging.
- Owner-supplied visual direction: `docs/DESIGN-BRIEF.md` in this repository
  (colour is signal, the band spectrum, no accent colour, one typeface family,
  tables not cards, the session ribbon as the signature element; a wellness
  business whose product reads as measurement). It disagrees with the
  inherited violet accent on one point; the visual-world step must settle that
  with the owner. Recorded here, not resolved here.

## Evidence on Hand
- `docs/market-study.md`: UAE market sizing, a competitor table with published
  prices, and an operations blueprint, dated September 2026. Its regulatory
  section assumed a clinic and is superseded; its status note says so.
- No real session or qEEG data, no testimonials, no case studies, no
  photography. Every name, figure and outcome in the product is synthetic from
  `db/seed/` until real material exists. The ribbon's viability (design brief
  section 10, item 3) is unvalidated.

## Product Principles
1. Privacy and integrity are the foundation: consent, the audit trail and the
   retention rule come before any feature.
2. One record per client; every fact structured, every change a new version,
   every access logged.
3. The field practitioner's screen is the simplest and the highest-stakes; it
   works offline and one-handed.
4. Make invisible change visible and trustworthy, in plain language, with the
   measurement on tap, and never as a diagnosis.
5. Business rules are pure functions with tests; screens and SQL carry no
   logic.

## Accessibility & Inclusion
- Practitioner surface: dark-first, 48px targets, 17px minimum body text, read
  at arm's length in dim rooms, unusable while driving (motion lock).
- Client surface: anxious, non-technical parents; plain language; Arabic-first
  readers served by bilingual reports in v1 and RTL-safe layout throughout.
- `prefers-reduced-motion` respected everywhere.
