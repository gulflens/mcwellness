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
- The founder-practitioner, Shauna McGuinness: owner of McWellness UAE and
  its only practitioner today (BSc Psychology, University of Dundee;
  neurofeedback practitioner certifications through Bee Medic; Compassionate
  Inquiry training under way). She delivers every consultation, brain map,
  session and results call herself, in clients' homes, and holds the admin
  and finance roles until there is staff. Standing in a family's living room,
  phone in one hand, EEG kit in the other, dim light, often no signal; running
  session N of 25 and recording it so the record reaches the server intact.
  The highest-stakes surface.
- Future practitioners and a coordinator: the same shell with roles admitted
  per capability, on desktop with dense data once there are many clients.
- Client households: adults and adolescents across Dubai, Abu Dhabi, Sharjah,
  Al Ain and the Northern Emirates, coming for stress and anxiety, sleep,
  focus and attention, emotional regulation, peak performance or general
  wellbeing (the site's own list); professionals such as administrators,
  accountants and business owners; a parent books for an adolescent. Anxious,
  not technical; many read Arabic first. A parent on their phone at 11pm
  wanting to know whether their child is improving. Their reports go on to
  schools, coaches and whoever the family chooses.
- The developer: Gulf Lens Studio builds and operates the software for the
  founder with Claude Code; every change must be explainable to her in plain
  language.

## Product Purpose
The operating system for a wellness practice delivering neurofeedback
training in clients' homes across the UAE: one record per client from the
free discovery call to signed report and paid invoice, and one map per day per
practitioner. The journey the practice sells is Understand (consultation and
QEEG brain map), Regulate (neurofeedback), Reconnect (Compassionate Inquiry),
Thrive (long-term resilience); the product makes each stage visible. Success:
the first paid session runs on the system within three months of kickoff. The
trunk's exit test: a synthetic practitioner and client can log in on staging
and the audit trail for that client is visible.

## Positioning
A field-service platform with a measurement core, built privacy-first as a
product choice: purpose-specific consent, a hash-chained audit trail of reads
as well as writes, a stated retention period, structured records rather than
free text. Neighbouring products are either practice-management tools with no
measurement core or field-scheduling tools with no client record; the join is
the moat. Home delivery removes the travel that drives programme drop-out. The
practice's own line is "neuroscience-informed care", and its terms say the
services do not diagnose, treat, cure or prevent any condition: clients bring
goals, and the product makes their progress visible.

## Operating Context
- McWellness is a wellness business, not a clinic (founder's determination,
  2026-09-02, and the website's terms): no DHA facility licence, no NABIDH, no
  25-year retention. The UAE personal-data law still treats health-type data
  as sensitive, so consent, minimisation, retention and erasure are handled
  deliberately; the site's privacy policy already names that law. Hosting
  outside the UAE is the owner's decision, to be confirmed with the founder's
  lawyer.
- Services and launch prices, all net of VAT: QEEG brain mapping, 23 channels
  with a tomographic report, AED 825, 90 minutes door to door, including a
  30-minute results video call within 24 hours that is never sold on its own;
  a neurofeedback session, AED 700, 60 minutes door to door; a consultation,
  45 minutes, bundled and never sold alone; Compassionate Inquiry, a somatic
  approach, not yet priced. First contact is a free discovery call of 45 to
  60 minutes.
- Packages (list price, then a 15% launch discount that ends): Silver, 1
  consultation, 2 brain maps, 15 sessions, AED 12,150 or 10,325; Gold, 2, 3,
  25, AED 19,975 or 16,975; Platinum, 3, 4, 40, AED 31,300 or 26,605. A
  package price is a figure the founder sets, never derived. Packages are not
  transferable between households.
- Money is integer fils; an entitlement ledger; deferred revenue; VAT at the
  standard rate of 5% on every service, computed from a setting and never
  typed (tax advisor to confirm), and shown wherever a price appears as price,
  VAT beneath, total. Payment by cash at the door, bank transfer or payment
  link; tax invoices and receipts issued through the app. PINT AE e-invoicing
  mandatory from 1 July 2027.
- Programmes run 15 to 40 sessions, two or three a week, over three to six
  months. Clients are promised a 45-minute arrival window, never a clock time.
  Moving or cancelling needs the notice period shown in the app (24 hours in
  the previous app); a fee applies when the practitioner arrives and cannot
  safely proceed (AED 150 in the previous app, under a clinical name this
  product does not use). A pre-visit checklist: access and security, parking,
  a suitably set-up room, no distractions, fresh hair with no oils or products.
- The practitioner drives a personal car; Salik and parking are reimbursed.
  Dubai addressing: Makani numbers plus verified entrance and parking
  coordinates; arrival intelligence accumulates per location.
- Practitioners work offline routinely (underground parking, villas). Session
  capture is a single-writer outbox, never a sync engine (ADR 0002).
- Consent, certification validity and kit calibration gate every session
  start. Closed sessions and signed reports are versioned, never edited in
  place.
- Reports are the tangible product: bilingual PDFs signed by the lead
  practitioner, shared with whoever the family chooses.
- Retention: a minimum of 5 years after the last activity, and kept after
  that; nothing deletes on a timer, and erasure or anonymisation happens when
  the client asks; financial records 5 years regardless (rule 8, operator
  2026-09-09).
- WhatsApp is the client channel (Phase 2); the website's booking form asks
  for a preferred contact method of phone, WhatsApp or email and a preferred
  time of morning, afternoon, evening or flexible. Email never carries client
  data.

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
  append-only closed records; a five-year minimum retention with erasure on
  request and nothing deleted on a timer; the vendor
  register; the ownership map.
- Terminology: client (the person receiving sessions), contact (parent or
  guardian, or the adult client), practitioner, lead practitioner, goal (what
  the client wants from the programme; the booking form's categories are the
  starting list), discovery call, consultation, brain map (QEEG), results
  call, session, entitlement (one credit), package (Silver, Gold, Platinum),
  protocol, assessment (a measurement, never a diagnosis), report, programme
  stage (Understand, Regulate, Reconnect, Thrive), MRN in the form
  `MW-000001`.
- Undecided, recorded not invented: the production Supabase region; whether
  the Emirates ID is collected at all (kept optional on the adult contact,
  never required to enrol); the price of Compassionate Inquiry; package expiry
  and extension terms; the notice period and fee for this product; font
  licence (Greta Sans and Greta Arabic, or IBM Plex); the band colour ramp
  against the practice's EEG software; whether the session ribbon works with
  real data; the tax point on prepaid packages (tax advisor, in writing); BNPL
  provider; refund wording (lawyer); the lawyer's confirmation of hosting and
  retention under the personal-data law.

## Brand Commitments
- Name: McWellness. The platform inherits the existing McWellness UAE
  identity: the Latin wordmark in every locale, the store name "McWellness
  UAE", the website mcwellnessuae.com (English and Arabic), the practice mark
  at `assets/brand/logo.png` in the `gulflens/mcwellness-uae` repository (660
  by 222 pixels, printed on invoices and receipts), and the founding violet
  `#4B1173` carried from the QEEG report tool.
- The site's own words: "Mind . Balance . Healing"; "neuroscience-informed
  care"; sessions "in the comfort, privacy and familiarity of your own home";
  values of compassion, neuroscience-informed care, personalised support and
  safety; "individual experiences and outcomes vary".
- Voice: accurate, unhyped, no growth language, no medical claims; British
  English; no emoji; plain-language copy first with the measurement on tap; no
  gamification, streaks or nagging.
- Owner-supplied visual direction: `docs/DESIGN-BRIEF.md` in this repository
  (colour is signal, the band spectrum, one typeface family, tables not cards,
  the session ribbon as the signature element; a wellness business whose
  product reads as measurement). It disagreed with the inherited violet accent
  on one point. **Settled by the owner on 8 September 2026: the violet is the
  accent.** The interface takes `#380473`, sampled from the mark itself and the
  same value already printed on every invoice, for the rail, the primary
  action, links, the active section and the focus ring; the band spectrum and
  the three status states keep the inside of every figure to themselves. The
  founding `#4B1173` from the QEEG report tool is superseded by the sampled
  value, so one number describes the practice everywhere. See
  `docs/SPEC/coloured-shell.md`.

## Evidence on Hand
- mcwellnessuae.com, live in English and Arabic: services, the founder's
  profile, a booking form, terms, a privacy policy, and a testimonials page
  with real client accounts that may be used only with the founder's
  permission and are never paraphrased into new claims.
- The previous McWellness app (`gulflens/mcwellness-uae`, `docs/CATALOGUE.md`
  and `docs/BRIEF-AUDIT.md`): the founder's own brief of 2026-08-04 with the
  services, durations, prices, packages, VAT display rule, results-call
  design, pre-visit checklist, notice period and fee, and the six client
  status states.
- `docs/market-study.md`: UAE market sizing, a competitor table with published
  prices, and an operations blueprint, dated September 2026. Its regulatory
  section assumed a clinic and is superseded; its status note says so.
- No real session or qEEG data, no case studies, no photography in this
  repository. Every name, figure and outcome in the product is synthetic from
  `db/seed/` until real material is shared. The ribbon's viability (design
  brief section 10, item 3) is unvalidated.

## Product Principles
1. Privacy and integrity are the foundation: consent, the audit trail and the
   retention rule come before any feature.
2. One record per client; every fact structured, every change a new version,
   every access logged.
3. The practitioner's screen is the simplest and the highest-stakes; it works
   offline and one-handed.
4. Make invisible change visible and trustworthy, in plain language, with the
   measurement on tap, and never as a diagnosis.
5. Business rules are pure functions with tests; screens and SQL carry no
   logic.

## Accessibility & Inclusion
- Practitioner surface: dark-first, 48px targets, 17px minimum body text, read
  at arm's length in dim rooms, unusable while driving (motion lock).
- Client surface: anxious, non-technical adults and parents; plain language;
  Arabic-first readers served by bilingual reports in v1 and RTL-safe layout
  throughout.
- `prefers-reduced-motion` respected everywhere.
