# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Decided by the brief (ADR 0001), not delegated: one TypeScript codebase; React +
Vite app with three role areas (admin desk, therapist installable PWA, client
portal); Hono API on Node; PostgreSQL with Supabase (Auth, RLS, Storage),
self-hosted in AWS me-central-1 for production; pg-boss jobs; Terraform.
Staging is Supabase Cloud with synthetic data only.

## Users
- Field practitioners (therapists and technicians): standing in a family's
  living room in Dubai, phone in one hand, EEG kit in the other, dim light,
  often no signal; running session N of 30 for a child and recording it so the
  record reaches the server intact. The highest-stakes surface.
- Clinical lead (DHA-licensed psychologist) and the admin coordinator: on
  desktop with dense data and many clients; scheduling by hand, checking
  credentials and consent, reviewing and signing reports.
- Client households: a parent on their phone at 11pm wanting to know whether
  their nine-year-old is improving; anxious, not clinical; many read Arabic
  first. Their reports go on to schools, psychiatrists and insurers.
- The owner: solo and non-technical, driving the build with Claude Code; every
  change must be explainable in plain language.

## Product Purpose
The operating system for a DHA-licensed clinic delivering clinical
neurofeedback in clients' homes across Dubai: one record per client from first
enquiry to signed report and paid invoice, and one map per day per therapist.
Success: the first paid session runs on the system within three months of
kickoff. The trunk's exit test: a synthetic practitioner and client can log in
on staging and the audit trail for that client is visible.

## Positioning
A field-service platform with a clinical core, built under UAE health-data law
from the first commit: PHI only in the UAE, coded clinical data ready for
NABIDH, append-only clinical records with a hash-chained audit log of reads as
well as writes, VAT derived from the clinical record. Neighbouring products are
either clinic-bound EMRs hosted abroad or field-scheduling tools with no
clinical core; the join, executed under UAE compliance, is the moat. Home
delivery removes the travel that drives programme drop-out.

## Operating Context
- Programmes run 20 to 40 sessions, two or three a week, over three to six
  months. Clients are promised a 45-minute arrival window, never a clock time.
- Practitioners drive personal cars; Salik and parking are reimbursed.
- Dubai addressing: Makani numbers plus verified entrance and parking
  coordinates; arrival intelligence accumulates per location.
- Therapists work offline routinely (underground parking, villas). Session
  capture is a single-writer outbox, never a sync engine (ADR 0002).
- Consent, credential validity and kit calibration gate every session start.
  Clinical records are versioned, never edited in place.
- Reports are the tangible product: bilingual PDFs signed by a licensed
  clinician, circulated to schools, doctors and insurers.
- Money is integer fils; an entitlement ledger; deferred revenue; per-line VAT
  (0% clinical care to the patient, 5% otherwise); PINT AE e-invoicing
  mandatory from 1 July 2027.
- WhatsApp is the client channel (Phase 2). Email never carries PHI.
- Regulator: DHA. Classification received in writing as an outpatient clinic
  with off-site activity; NABIDH scope confirmation pending.

## Capabilities and Constraints
- Phase 1 trunk, six PRs: repo skeleton; core schema and audit log; auth and
  audit middleware; synthetic seed; app shell with role routing and an admin
  client table; the record timeline.
- Stage 1 worktrees after the trunk: client record, manual scheduling, session
  capture, billing. Stage 2: assessment, reports, client portal, audit UI.
  Route solver, kit logistics, HIE submission, insurance and corporate accounts
  are Phase 2 or later.
- Absolute rules (CLAUDE.md): PHI only in me-central-1; no real or realistic
  patient data anywhere in the repo; coded clinical data; business rules as
  pure functions in `domain/`; every PHI read and write audited; VAT never
  hand-entered; append-only clinical records; the ownership map.
- Terminology: client (the person receiving care, usually a minor), contact
  (parent or guardian), practitioner, clinical lead, appointment (a promise of
  a session), session, entitlement (one credit), protocol, assessment, report,
  MRN in the form `MW-000001`.
- Undecided, recorded not invented: font licence (Greta Sans and Greta Arabic,
  or IBM Plex); the band colour ramp against the clinic's EEG software; whether
  the session ribbon works with real data; the tax point on prepaid packages
  (tax advisor, in writing); BNPL provider; refund wording (lawyer); DHA NABIDH
  scope.

## Brand Commitments
- Name: McWellness. The platform inherits the existing McWellness UAE
  identity: the Latin wordmark in every locale, the store name "McWellness
  UAE", the website mcwellnessuae.com, the practice mark at
  `assets/brand/logo.png` in the `gulflens/mcwellness-uae` repository (660 by
  222 pixels, printed on invoices and receipts), and the founding violet
  `#4B1173` carried from the QEEG report tool.
- Voice: accurate, unhyped, no growth language; British English; no emoji;
  plain-language copy first with the clinical number on tap; no gamification,
  streaks or nagging.
- Owner-supplied visual direction: `docs/DESIGN-BRIEF.md` in this repository
  (colour is signal, the band spectrum, no accent colour, one typeface family,
  tables not cards, the session ribbon as the signature element). It disagrees
  with the inherited violet accent on one point; the visual-world step must
  settle that with the owner. Recorded here, not resolved here.

## Evidence on Hand
- `docs/market-study.md`: UAE market sizing, a competitor table with published
  prices, and a regulatory map with sources, dated September 2026.
- The DHA classification is stated in
  `.claude/skills/uae-compliance/SKILL.md`; the letter itself is not in the
  repository.
- No real session or qEEG data, no testimonials, no case studies, no
  photography. Every name, figure and outcome in the product is synthetic from
  `db/seed/` until real material exists. The ribbon's viability (design brief
  section 10, item 3) is unvalidated.

## Product Principles
1. Compliance is the foundation, not a retrofit: residency, coding, audit and
   consent gates come before any feature.
2. One record per client; every fact coded, every change a new version, every
   access logged.
3. The field practitioner's screen is the simplest and the highest-stakes; it
   works offline and one-handed.
4. Make invisible neurological change visible and trustworthy, in plain
   language, with the number on tap.
5. Business rules are pure functions with tests; screens and SQL carry no
   logic.

## Accessibility & Inclusion
- Therapist surface: dark-first, 48px targets, 17px minimum body text, read at
  arm's length in dim rooms, unusable while driving (motion lock).
- Client surface: anxious, non-clinical parents; plain language; Arabic-first
  readers served by bilingual reports in v1 and RTL-safe layout throughout.
- `prefers-reduced-motion` respected everywhere.
