# Neurofeedback in the UAE — Market Study & Operating-System Blueprint

> **Status note, 2026-09-02.** This study assumed McWellness would operate as a DHA-licensed clinic. The founder has since determined that the business is a wellness company, not a clinic: no DHA licence, no NABIDH, no 25-year retention. Section 8 (regulatory map), the hosting constraint in section 18 and the phase 0 pre-work in section 19 are superseded by that determination and by the repo's CLAUDE.md and `.claude/skills/uae-compliance`. The market, pricing, operations and product analysis stands. The document is kept unedited as source material.

*Prepared September 2026. All figures in AED unless stated. Regulatory dates were accurate at time of writing and shift often — verify against DHA Sheryan, DOH, MOHAP and mof.gov.ae before committing budget.*

---

## Part 0 — Executive summary

**The opportunity.** Neurofeedback in the UAE sits at the intersection of three markets that are all growing faster than the healthcare average: global neurofeedback systems (~USD 1.4–1.6bn in 2026, 7–11% CAGR depending on the analyst), UAE home healthcare (USD 1.31bn in 2026 → USD 2.19bn by 2031, 10.8% CAGR), and UAE telehealth/digital health (18–23% CAGR). Nobody in the UAE currently owns "clinical-grade neurofeedback delivered at home, at scale."

**The gap you can take.** Every established UAE provider is clinic-bound. Positive Living states plainly that neurofeedback is offered in-person only at its Dubai centre because it needs specialist equipment and real-time monitoring. Only MindTune advertises a home option, and only for the brain map (AED 1,250 at home vs AED 950 in-clinic promotional). Meanwhile the treatment protocol itself — 20 to 40 sessions, 2–3 times a week, over 3–6 months — is the single biggest reason clients drop out. Travel is the churn driver. Whoever removes travel wins the retention economics.

**The hard constraint.** This is a *licensed clinical activity*, not a wellness service. Delivering it in a client's home in Dubai means a DHA facility licence with the right activity scope, DHA-licensed clinicians, NABIDH connectivity as a condition of licence, and patient data physically stored inside UAE borders with 25-year retention. Abu Dhabi means DOH + Malaffi separately. Northern Emirates means MOHAP + Riayati. Build the software with that as the foundation, not as a compliance retrofit — retrofitting data residency and HIE integration is the single most expensive mistake in this sector.

**The system.** What you need is not an EMR and not a CRM. It is a **field-service platform with a clinical core**: one record per client that carries intake → qEEG map → protocol → session-by-session EEG telemetry → outcome measures → PDF report → invoice → payment → VAT/e-invoice, with a routing and kit-logistics layer on top because your therapists and your hardware are moving around the city every day. Roughly 60% of that is buildable on existing rails; the differentiated 40% is the home-delivery operations engine.

---

# PART 1 — MARKET STUDY

## 1. Global market sizing

Analyst estimates for "neurofeedback systems" cluster tightly, which is a good sign the category is real and measurable:

| Source | 2025/2026 value | Forecast | CAGR |
|---|---|---|---|
| Mordor Intelligence | USD 1.5bn (2026) | USD 2.14bn by 2031 | 7.33% |
| Precedence Research | USD 1.56bn (2026) | USD 2.95bn by 2035 | 7.35% |
| Straits Research | USD 1.43bn (2026) | USD 2.56bn by 2034 | 7.53% |
| The Business Research Company | USD 1.75bn (2026) | USD 2.61bn by 2030 | 10.5% |
| Spherical Insights | USD 1.68bn (2025) | USD 4.92bn by 2035 | 11.35% |

**Read this as: a ~USD 1.5bn hardware-and-systems market growing at 7–11%.** Note that these figures measure *systems* (devices, software, platform licences), not the service revenue clinics earn on top. The clinical service market is several multiples larger and largely uncounted, because it is fragmented across tens of thousands of independent practices.

**Regional split.** North America holds ~40% of the market. Europe and Asia-Pacific are the fastest-growing regions. The Middle East appears in these reports only as "GCC Countries" inside a Middle East bucket — meaning the UAE is genuinely under-served, and also that you will not find a credible published UAE-specific neurofeedback market number. You will have to build your own TAM (Section 5).

**Growth drivers cited consistently across analysts:** rising ADHD/anxiety/depression prevalence, demand for non-pharmacological options, integration of neurofeedback with digital health platforms, and AI-integrated EEG. **Cited restraints:** cost per program, uneven evidence base, and side-effect concerns.

## 2. Global business models — what actually works

Five distinct models exist worldwide. Understanding which one you are running determines your entire software spec.

**Model A — Traditional clinic (in-office, 19-channel).** Client visits 2–3×/week. High equipment cost (a clinical 19-channel EEG system runs USD 10,000–25,000+), high room and staff cost, capped by chairs and hours. Typical US pricing: USD 100–300/session, USD 500–3,000 for qEEG mapping, USD 3,000–7,000 for a 20–35 session program. This is what most UAE providers run today.

**Model B — Remote/at-home with consumer-grade EEG under clinical supervision.** Myndlift is the reference implementation and the most instructive case for you. Client trains at home on a Muse headband + mobile app; the clinician configures protocols, monitors live EEG remotely, deploys qEEG assessments, CPTs and 40+ standardised questionnaires, and generates reports — all from a web dashboard. Clinic onboarding packages start around USD 2,990; consumer kits around USD 229 plus subscription. The platform reports over 1M sessions run.

The critical data point from their own case studies: Brainboost in Germany, within a year of adoption, ran **~100 home sessions per week versus ~70 in-clinic** across 35 headsets and ~50 users. That is the throughput unlock — one clinician supervising many concurrent trainees instead of one-at-a-time.

**Model C — Membership/package with bundled assessment.** Peak Brain Institute (US, four cities + remote) abandoned per-session billing entirely: 2-month program (25–35 sessions, 2 qEEGs) at USD 4,999; 4-month (50–70 sessions, 3 qEEGs) at USD 7,499; 6-month at USD 9,499. Everything bundled — no per-session billing, no surprise re-assessment fees. This solves the two things clients hate most: unpredictable cost and feeling nickel-and-dimed on reassessment.

**Model D — Hybrid (in-clinic assessment, at-home training).** The emerging consensus model. Brain map and protocol design happen in a controlled clinical setting with proper equipment; the 20–40 training sessions happen at home. This is almost certainly your model, with a twist: **your therapist travels to the home** rather than leaving the client unsupervised.

**Model E — B2B2C via employers and payers.** Myndlift runs employer/payer wellbeing programs combining self-guided modules, clinician access and optional home kit distribution. In the UAE this is a serious second revenue line — see Section 7.

**Equipment vendors to evaluate:** BrainMaster (linear, LORETA — steep learning curve, strong for complex in-clinic cases), Thought Technology (combines neuro- and biofeedback, infra-low frequency), BEE Medic / neurocare group, Mind Media, Neurobit Systems, and Myndlift + Muse S Athena for the remote tier. A practical structure is BrainMaster or Thought Technology for your clinical hub and qEEG, plus a Myndlift-style remote tier for maintenance and lower-acuity clients.

## 3. Evidence base — know your ground truth

You will be asked about this by regulators, insurers, referring psychiatrists and sceptical parents. Be precise:

- ADHD is the strongest indication. A meta-analysis in *European Child & Adolescent Psychiatry* found significant improvements in inattention, hyperactivity and impulsivity that were maintained at follow-up.
- Anxiety, insomnia, trauma-related presentations and peak performance have supportive but weaker evidence.
- Analyst reports themselves list "developing evidence base" as a market restraint. Do not oversell.

The **ISNR Standards of Practice** are the international reference. Two points matter commercially: (1) neurofeedback for a *diagnosed* condition should be delivered by practitioners licensed for independent practice in a recognised health profession whose scope includes that condition; (2) ISNR explicitly flags unlicensed individuals treating conditions they are not qualified for as the profession's central credibility problem. The US VA's community-provider standard is a useful concrete benchmark for staff competency: **36 hours of neurofeedback training plus 100 client sessions with 25 supervised contact hours** (or 400 sessions with 10 supervised hours).

Bake this into your software as a **credentialing gate**: no therapist can be assigned to a protocol category they are not certified and licensed for.

## 4. UAE demand drivers

**Population and demographics.** ~9.3 million residents, heavily expatriate, urban-concentrated in Dubai/Abu Dhabi/Sharjah, high disposable income, high private-schooling rate, and strong parental willingness to pay out-of-pocket for children's cognitive and academic outcomes. This is close to an ideal neurofeedback demographic.

**ADHD prevalence.** The UAE evidence is messy and that is itself an opportunity. Eapen et al. found 4.1% (parent-report) and 3.4% (teacher-report) among school children, with the highest rates at ages 5–7 (5% in elementary, falling to 2.7% in secondary). A Sharjah study using teacher ratings found 14.9%. WHO EMRO cites ~4% for UAE school-aged students. A 2023 national cross-sectional study of 406 UAE young adults using the ASRS found **34.7% reporting symptoms suggestive of probable ADHD**, with females reporting at higher rates than males — which the authors read as a screening and stigma failure, not a true prevalence figure.

Two conclusions: (a) a defensible planning range is **4–6% diagnosed-eligible among children**, and (b) there is a **large undiagnosed adult and female cohort** that no UAE provider is currently marketing to. That second group is your differentiated segment.

**Service scarcity.** WHO EMRO notes specialised ADHD services in Dubai are limited despite roughly 2,000 paediatric psychiatry assessments a year, and that the UAE and the wider Eastern Mediterranean Region have a considerable shortage of youth mental health resources. Scarcity plus purchasing power equals pricing power.

**Regulatory tailwind — mental health is now a protected benefit.** Federal Law No. 10 of 2023 on Mental Health, effective May 2024, prohibits blanket psychiatric exclusions in UAE health insurance policies. DHA updated its Standards for Mental Health Services in January 2025 with clearer licensing requirements and a scope-of-practice circular (CIR-2025-00000009), and requires all mental health services to be delivered in DHA-licensed facilities by practitioners verifiable on Sheryan. Through 2026, DHA's framework and the expanded Basmah initiative push mandatory baseline mental health coverage and broader screening at primary-care entry points, with caps on pre-existing-condition waiting periods.

Practical read: **psychiatry is covered better than psychology**, therapy sessions are typically capped (Essential Benefits Plan: ~5 sessions/year with 20% co-pay; enhanced/premium plans: 10–20 sessions/year, often with pre-authorisation). Neurofeedback specifically is generally out-of-pocket — MindTune's own FAQ says reimbursement can apply "in some cases," depending on carrier and a neurologist's or psychiatrist's medical report.

**That last sentence is a product requirement.** Your system should generate the exact medical-report + coded-claim artefact that makes reimbursement possible. If you convert even 30% of clients from full self-pay to partial reimbursement, you materially expand your addressable market. No UAE competitor is doing this systematically.

**Home care and telehealth momentum.** Compulsory national health insurance came into force 1 January 2025. UAE home healthcare: USD 1.18bn (2025) → USD 1.31bn (2026) → USD 2.19bn (2031) at 10.84% CAGR, with rehabilitation therapy the largest service segment at 37.74% share. Telehealth is governed by DHA Telemedicine Regulations and DOH Standards for Telemedicine Services, which cover licensing, clinical quality, data privacy and cybersecurity. Home delivery is not a regulatory grey zone — it is an established, regulated, growing category.

## 5. Building your UAE TAM (bottom-up)

Published UAE neurofeedback numbers do not exist. Build it this way and defend the assumptions:

```
Children aged 5–17 in UAE                          ~1,300,000  (assumption — verify with FCSC)
× ADHD prevalence (planning range 4–6%)            = 52,000–78,000
× Realistically reachable (urban, insured/affluent,
  parent aware of neurofeedback)          × 12%    = 6,200–9,400
× Willing to start a paid program         × 8%     = 500–750 children/yr

Adults 18–45                                       ~4,000,000
× Probable ADHD / anxiety / sleep / performance
  seeking non-pharma option               × 2%     = 80,000
× Reachable × conversion                  × 0.5%   = ~400 adults/yr

Serviceable obtainable ≈ 900–1,150 new programs/yr across the whole UAE
× average program value AED 12,000                 = AED 11–14m/yr category revenue
```

This is deliberately conservative and it tells you something important: **the UAE neurofeedback services category is currently a low-tens-of-millions AED market.** You do not win by taking share from Evolve or BrainHub. You win by *growing the category* — reaching the undiagnosed adult cohort, removing the travel barrier, and adding corporate/school/sports channels. Model your business on category creation, not share capture.

## 6. UAE competitive landscape

| Provider | Location | Positioning | Published pricing | Home service |
|---|---|---|---|---|
| **Evolve Brain Training** | Dubai | Dedicated neurofeedback centre, package-led, most transparent pricing in market | Session AED 625; Brain Mapping AED 710; QikTest AED 710; Full consult AED 710. Silver (10 sessions + 2 maps) AED 7,250–7,550; Gold (20 sessions + 3 maps) AED 11,550–11,950; Platinum (30 sessions + 3 maps) AED 15,550–15,950. All +VAT | No |
| **MindTune** | Dubai | "UAE's specialist neurofeedback clinic," FDA-cleared tech, PhD-designed protocols, medical-grade QEEG | Brain Map AED 1,250 (clinic or home); promo AED 950 in-clinic. Packages quoted post-map. Programs 20–30 sessions | **Yes** (brain map) — closest competitor to your model |
| **BrainHub Polyclinic** | Al Wasl Rd, Umm Suqeim, Dubai | Polyclinic; QEEG-guided protocols, age-specific programs, self-referral, insurance coordination via reception | Not published | No |
| **King's College Hospital Dubai** | Dubai | Hospital neurology dept — institutional credibility | Session AED 700; 5-pack AED 3,200; 10-pack AED 6,200; 15-pack AED 9,000; 20-pack AED 12,000 | No |
| **Positive Living UAE** | Damac Smart Heights 601, Dubai | Holistic centre; neurofeedback inside broader counselling/coaching program; 30–45 min sessions | Not published | **Explicitly no** — states in-person only |
| **German Neuroscience Center (GNC)** | Dubai | Neurology/psychiatry/psychology group, 10+ years, biofeedback + neurofeedback | Not published | No |
| **Harmony Centre** | Dubai Healthcare City | Mental health centre, multidisciplinary (psychiatrists + clinical psychologists), free consultation offer | Not published | No |
| **Dr Zita Chriszto** (Doctor Reuter Medical Center) | Umm Suqeim 1, Dubai | Solo DHA-licensed clinical psychologist with full QEEG capability; neurofeedback integrated with psychological therapy | Not published | No |

### What this table tells you

1. **Price band is established: AED 625–700 per in-clinic session; AED 7,250–15,950 per package.** Home delivery justifies a premium of roughly 30–50%. A home session at AED 850–950 and a 20-session home program at AED 16,000–19,000 is defensible — MindTune already charges AED 1,250 for the at-home brain map versus AED 950 in-clinic, a ~32% home premium, which is your empirical anchor.
2. **Only two competitors publish pricing.** Transparent, packaged, all-inclusive pricing (Peak Brain model) is an immediate differentiator in this market.
3. **Nobody owns home delivery at scale.** MindTune has cracked the door with the at-home map. This is the whitespace.
4. **Almost everyone is Dubai-only.** Abu Dhabi, Sharjah and the Northern Emirates are thinly served — but each is a separate regulator and a separate HIE. Sequence carefully.
5. **Free-consultation offers are common** (Harmony, Evolve). Your funnel must handle a free-first-touch step.
6. **Category messaging is nearly identical everywhere** — ADHD, anxiety, focus, "drug-free," neuroplasticity. Positioning on *convenience, measurement rigour and insurance navigation* is genuinely open ground.

## 7. Segments and channels, ranked

**1. Children with ADHD (core, highest willingness to pay).** Parent is the buyer, child is the user. Home delivery is a decisive advantage: no traffic, no waiting room, child trains in a familiar environment, siblings manageable. Sell against the medication-hesitancy motive that every competitor already names.

**2. Undiagnosed / late-diagnosed adults (fastest-growing, least contested).** The ASRS study's 34.7% probable-ADHD figure in young adults, skewing female, points at an entire underserved cohort. Evening and weekend home sessions serve working professionals that no clinic-hours provider can reach.

**3. Corporate and executive performance.** B2B, invoiced, VAT-standard-rated, higher margin, no insurance friction. Dubai's employer wellbeing budgets are real and growing under the 2026 mental-health mandate pressure on employer plans. Sell as a cognitive-performance program to family offices, law firms, trading houses, government entities.

**4. Schools and learning-support providers.** Referral partnerships with private-school SEN departments. Long sales cycle, high volume when it lands.

**5. Elite sport and esports.** Small but high-margin and excellent for brand; UAE has active academies and federations.

**6. Insurance-reimbursed clinical (medium term).** Requires the medical-report machinery in Section 4. Treat as a 12–24 month build, not a launch dependency.

## 8. Regulatory and compliance map

This section is the one to hand to your lawyer. Treat everything here as a starting point for formal advice.

### 8.1 Licensing

| Jurisdiction | Regulator | HIE platform | Notes |
|---|---|---|---|
| Dubai (mainland) | DHA (Sheryan portal) | **NABIDH** | Facility licence + medical director + licensed staff; NABIDH connectivity is a licence precondition |
| Dubai Healthcare City | DHCA / DHCR | NABIDH | Separate regulator inside the free zone; historically home healthcare permits were restricted to entities operating from a licensed parent hospital in DHCC — check current standard before assuming this route |
| Abu Dhabi | DOH | **Malaffi** | Malaffi onboarding is a prerequisite for new and renewed facility licences; requires SD-WAN and security validations |
| Sharjah / Northern Emirates | MOHAP (and SHA in Sharjah) | **Riayati** | Own data-sharing requirements |

All three HIEs interconnect through the National Unified Medical Record (NUMR) framework. **Multi-emirate operation means complying with each regulator separately** — Mordor explicitly scores "fragmented emirate-level regulations" as a −0.9% drag on UAE home healthcare CAGR. Launch Dubai-only; expand deliberately.

**Professional licensing.** Clinical psychologists need a DHA professional licence: recognised degree, home-country registration, typically 2+ years post-qualification experience, Good Standing Certificate under six months old, DataFlow primary source verification, DHA assessment, English proficiency. "Psychologist" is a protected title. DHA-licensed professionals must work within an approved facility and within their licensed scope.

**Scope question to resolve early with DHA:** is neurofeedback delivered in a client's home by your therapist classified as (a) a home healthcare service, (b) an outpatient service delivered off-site, or (c) telemedicine with an on-site technician? The answer changes your facility activity codes, your staffing ratios and possibly your insurance product. **Get this in writing before you build.** This is the single largest regulatory risk in the plan.

### 8.2 Facility licensing checklist (Dubai mainland)

Trade licence from DED or free zone → premises and floor plan meeting DHA standards → Dubai Municipality fit-out permit (architectural + MEP drawings stamped) → Civil Defence NOC → infection-control plan → licensed medical director → licensed clinical staff → malpractice insurance appropriate to specialty risk → **certified EMR with proven NABIDH connectivity** → DHA inspection → approval via Sheryan. Typical timeline one to six months.

### 8.3 Data — the constraint that shapes your architecture

- **Federal Law No. 2 of 2019 (ICT in Health Fields)**: health data must be **physically stored within UAE borders**; digital records retained **25 years** after last patient visit; unauthorised secondary use (research, third-party sharing) prohibited.
- **Dubai Health Data Law No. 11 of 2018** and **Cabinet Decision No. 32 of 2020** govern NABIDH, supported by DHA policies on Health Data Protection, Information Sharing, Consent and Access Control, and Data Classification.
- **NABIDH technical reality**: your EMR must appear on DHA's register of certified systems — **self-certification is not accepted**. Required data is structured and coded: demographics (Emirates ID mandatory), ICD-10-CM diagnoses, medications with generic name and dose, lab results, procedures, allergies, vital signs, referrals, discharge summaries. **Unstructured free text is rejected.** Standard is HL7 FHIR R4 / CDA. Patients are auto-enrolled but may opt out under DHA's Consent Policy.

**Three architectural consequences, non-negotiable:**

1. **UAE region only.** AWS Middle East (UAE) — me-central-1, Azure UAE North, or G42/Core42 sovereign cloud. Every database, every object store, every backup, every log aggregator, every analytics warehouse. No US-region SaaS holding PHI. This alone disqualifies most off-the-shelf mental-health platforms (SimplePractice, TherapyNotes, Jane, Upheal are all US/Canada-hosted).
2. **Structured-first clinical data model.** Do not let clinicians write free-text notes as the primary record. Every clinically material fact needs a coded field — ICD-10-CM diagnosis, coded procedure, structured vitals — or NABIDH will reject it. Free text can exist *alongside* structure, never instead of it.
3. **25-year retention with legal hold**, immutable audit logging, and a documented deletion policy that respects retention over any erasure request.

### 8.4 Tax and invoicing

**VAT.** Qualifying healthcare supplied *to the patient* — consultations, diagnostics, medically necessary treatment, preventive care — is **zero-rated (0%)**, and zero-rating still permits full input-VAT recovery. **Standard-rated at 5%**: wellness/lifestyle services that are not treatment of a condition, and **B2B supplies where the patient and the recipient of the supply are not the same person** (FTA public clarification, October 2019). Registration threshold is AED 375,000 of taxable supplies (zero-rated counts toward it); returns usually quarterly within 28 days; records kept five years.

**This is a direct product requirement and the #1 audit risk in your sector.** Your billing engine must tag VAT treatment *per line item*, driven by the clinical record:

- Child with documented ADHD diagnosis, therapeutic protocol, billed to parent → **0%**
- Executive "peak performance" program, no diagnosis → **5%** (wellness)
- Corporate contract where the employer is billed for employee sessions → **5%** (recipient ≠ patient)
- Report written for a school or immigration purpose rather than a medical one → **5%**

Note that Evolve prices "exclusive of VAT," which implies they are standard-rating at least part of their offering. Your classification logic must be defensible against an FTA audit that inspects patient files against invoices — so the invoice line must be *derived from* the clinical record, not typed by an admin.

**E-invoicing.** The UAE is implementing Peppol-based e-invoicing (5-corner DCTCE model, **PINT AE** format, UBL/XML) under Federal Decree-Law No. 16 of 2024 and Ministerial Decisions 243/244 of 2025. Voluntary pilot opened **1 July 2026**. Businesses ≥ AED 50m revenue: appoint an Accredited Service Provider by **30 October 2026**, mandatory from **1 January 2027**. All other businesses: appoint an ASP by **31 March 2027**, mandatory from **1 July 2027**. Penalties reported up to AED 5,000/month for non-compliance. Dates have already shifted once — confirm at mof.gov.ae.

**You are in the second wave: 31 March 2027 / 1 July 2027.** Do not bolt this on later. Design invoices as structured PINT AE objects from day one and integrate an accredited ASP.

## 9. Risks and how to mitigate

| Risk | Severity | Mitigation |
|---|---|---|
| DHA classifies home neurofeedback in a way that requires a parent hospital or blocks the model | **Critical** | Pre-submission consultation with DHA before capital commitment. Have a fallback: clinic hub + supervised remote training (Myndlift model) requires no home visit at all |
| NABIDH certification delays licensing | High | Choose a DHA-register-certified EMR core and integrate around it, rather than building a from-scratch EMR you then have to certify |
| Data residency violation | High | UAE-region-only architecture from commit #1; contractual DPAs with every vendor; no US-hosted PHI processors |
| VAT misclassification found on FTA audit | High | Per-line-item VAT derived from coded clinical data; quarterly internal classification review |
| Clinician supply — DHA licensing plus neurofeedback certification is a narrow funnel | High | Two-tier staffing: DHA-licensed clinical psychologist designs and owns protocols; trained technicians run sessions under supervision, credential-gated in software. Budget 6–9 months of DataFlow/licensing lead time per hire |
| Equipment loss, damage or hygiene failure in the field | Medium | Kit asset registry with serial-level chain of custody, per-visit condition photos, insurance, consumables tracking |
| Evidence-base or advertising challenge | Medium | Conservative claims; ISNR standards; never claim insurance coverage you cannot deliver; keep marketing copy reviewed against DHA advertising rules |
| Client home safety / lone-worker risk for therapists | Medium | In-app check-in/check-out, live location during visit, panic button, two-person policy for flagged visits |
| Cash-flow drag from packages sold upfront but delivered over months | Medium | Deferred-revenue accounting from day one (Section 16); do not book package sales as revenue on payment |

---

# PART 2 — THE OPERATING SYSTEM

## 10. Product thesis

> One record per client, from first enquiry to final report — and one map per day for every therapist.

Everything in the system serves two loops:

- **Clinical loop:** intake → assessment → protocol → session → measurement → report → protocol adjustment.
- **Operational loop:** demand → schedule → route → kit → visit → charge → collect → reconcile.

Where existing tools fail you is at the join. SimplePractice and TherapyNotes handle the clinical loop but are US-hosted and have no field-ops layer. Noterro and Skedulo handle mobile field scheduling and route optimisation but have no qEEG, no protocol engine, no NABIDH. Myndlift handles the neurofeedback layer beautifully but is not a business system. **Your moat is the join, executed under UAE compliance.**

## 11. Personas and what each one needs

| Persona | Primary surface | Core need |
|---|---|---|
| **Client / parent** | Mobile app + web portal | Book, reschedule, see progress in plain language, pay, download reports, message the team |
| **Field therapist / technician** | Mobile app (offline-capable) | Today's route, client brief, protocol to run, session capture, consent, check-in/out, kit status |
| **Clinical lead (DHA-licensed psychologist)** | Web console | Review qEEG, design and adjust protocols, supervise, sign off reports, oversee outcomes |
| **Admin / coordinator** | Web console | Scheduling, routing, kit logistics, insurance pre-auth, invoicing, collections |
| **Finance** | Web console | Deferred revenue, VAT classification, e-invoicing, reconciliation, payroll inputs |
| **Owner / you** | Dashboard | Utilisation, retention curve, CAC/LTV, cash, clinical outcomes, compliance status |

## 12. Module map

**A. CRM & intake** — lead capture from web/WhatsApp/referral, free-consultation booking (competitors offer this; match it), screening questionnaires pre-visit, referral-source attribution, automated nurture. Emirates ID capture at intake is mandatory for NABIDH.

**B. Clinical record (EMR core)** — structured, coded, NABIDH-ready. Demographics, ICD-10-CM diagnoses, allergies, vitals, procedures, referrals, consent records, document store. This is the module to buy or build on a certified foundation rather than invent.

**C. Assessment & qEEG** — brain map ingestion from your hardware, normative-database comparison, CPT/attention test results, standardised questionnaire library (Conners, Vanderbilt, ASRS, GAD-7, PHQ-9, ISI, PSQI). Store raw and derived. Version every assessment so pre/post comparison is exact.

**D. Protocol engine** — the clinical IP. Protocol templates by indication; electrode sites, reward/inhibit bands, thresholds, session length; per-client instances with version history and a reason recorded for every change; **credential gating** so only a licensed clinician can author or amend, and only certified technicians can execute. Full audit trail — this is your defence in any clinical review.

**E. Session capture (offline-first)** — the field app must work with no signal. Pre-session checklist, impedance/signal-quality check, session telemetry (per-band amplitude, threshold, artefact/noise percentage, duration), client subjective ratings before and after, therapist observations against structured prompts, photo of setup if needed, sync-on-reconnect with conflict resolution.

**F. Scheduling & routing** — see Section 13.

**G. Kit & inventory logistics** — see Section 14.

**H. Reporting & PDF delivery** — see Section 15.

**I. Billing, payments & collections** — see Section 16.

**J. Accounting & compliance** — deferred revenue, VAT engine, PINT AE e-invoicing via ASP, FTA-ready audit exports, 25-year retention.

**K. Insurance & pre-authorisation** — payer registry, eligibility notes, pre-auth request tracking with SLA timers, coded claim generation, medical-report generator for reimbursement submission, denial tracking with reason codes.

**L. Client portal & mobile app** — progress visualisation in lay language, session history, upcoming visits with therapist ETA, secure messaging, documents, payments, home-practice content between visits.

**M. Analytics & governance** — operational, clinical outcome and financial dashboards; compliance status board (licence expiries, NABIDH health, certification currency).

## 13. Scheduling and routing — the module that decides your margins

Home delivery lives or dies on travel time. A therapist doing 4 home sessions a day instead of 6 is a 33% margin loss. Treat this as a constraint-solver, not a calendar.

**Constraints to encode:**
- Therapist DHA licence scope and neurofeedback certification vs the protocol required
- Therapist working hours, prayer times, breaks, Friday patterns, Ramadan hours
- Client availability windows and standing preferences (e.g. "after school, before 6pm")
- Clinical frequency requirement — 2–3 sessions/week with minimum spacing between them
- Geography clustered by area (Marina/JLT, Downtown/Business Bay, Jumeirah/Umm Suqeim, Arabian Ranches/Motor City, Mirdif/Festival City, Sharjah corridor)
- Kit availability and location — the headset physically has to be with the therapist
- Traffic by time of day (Sheikh Zayed Road at 5pm is a different city than at 11am)
- Continuity of care — same therapist wherever possible, since rapport drives adherence

**Approach.** Vehicle Routing Problem with Time Windows (VRPTW). Solve nightly for the next day with a metaheuristic (OR-Tools works well and is free); re-solve incrementally on same-day disruption. Do not attempt true real-time optimality — near-optimal and stable beats optimal and churning, because therapists hate a schedule that keeps changing.

**Geo-zone territories.** Assign therapists to home zones and only cross-assign when necessary. Reduces travel, builds local knowledge, improves continuity.

**Buffer discipline.** Explicit travel buffer per leg from a live traffic matrix, plus a setup/teardown allowance (realistically 10–15 minutes each side for electrode placement and cleanup) and a variance buffer. Under-buffering is the classic home-health failure mode: one late visit cascades through the whole day.

**Map surfaces:** admin dispatch board (all therapists, live, colour-coded by status); therapist day map with turn-by-turn handoff to Google/Apple Maps; client ETA tracking (the Careem/Talabat expectation — UAE clients will expect this and it materially reduces "where are you?" calls); heat maps of demand by area for capacity planning and for choosing where hub #2 goes.

**Also model the reverse commute:** kit return to hub, charging, and cleaning. That is unpaid time and it must appear in the roster or your utilisation numbers will lie to you.

## 14. Kit and asset logistics

Your EEG hardware is expensive, mobile and clinically critical. Track it like a rental fleet.

- **Serial-level asset registry**: device type, serial, purchase date, warranty, calibration due date, firmware version, current custodian, current physical location.
- **Chain of custody**: every handover — hub to therapist, therapist to client (for take-home tiers), client back to hub — logged with timestamp, actor and condition photos.
- **Consumables**: electrodes, conductive paste, alcohol wipes, disposable caps. Auto-decrement per session; reorder alerts at threshold. Consumables per session are a real COGS line and most operators do not track them.
- **Hygiene and infection control**: cleaning protocol per device between clients, logged and timestamped. This is inspectable by DHA and it is also a genuine parent concern for a device that touches a child's scalp.
- **Calibration and maintenance**: scheduled, blocking — a device past calibration cannot be assigned to a session by the scheduler.
- **Loss and damage**: incident workflow, insurance claim tracking, cost attribution.
- **Take-home tier**: if you rent kits for unsupervised or semi-supervised training (the Myndlift model), you need deposits, rental agreements, return-date tracking, remote lock/wipe, and an escalation path for non-return.

## 15. PDF report generation and delivery

Reports are the tangible product. Parents show them to schools; psychiatrists want them for referrals; insurers need them for reimbursement. Make them excellent.

**Report types:**
1. **Baseline qEEG assessment** — brain maps, normative comparison, cognitive test results, questionnaire scores, clinical interpretation, proposed protocol and expected trajectory.
2. **Progress report** (every ~10 sessions) — trained-band trends, adherence, symptom-scale movement, therapist observations, protocol adjustments and why.
3. **Mid-point / re-map comparison** — before-and-after brain maps side by side. This is the single most persuasive retention artefact you own. Peak Brain and Myndlift both build their value story on it.
4. **Program completion** — full arc, outcomes against baseline, maintenance recommendations.
5. **Medical report for insurance** — diagnosis, medical necessity, procedure codes, clinician credentials and signature, formatted to what UAE insurers actually accept.
6. **School / educational support letter** — accommodations-focused, jargon-free.

**Pipeline.** Structured data → templating engine (HTML/CSS → headless-Chromium PDF gives you the most design control; LaTeX if you want typographic precision; a server-side library like WeasyPrint or Puppeteer is the practical middle) → charts rendered server-side as SVG for crispness → clinician review queue → **e-signature by the licensed clinician** → watermark/version stamp → immutable archive → delivery.

**Non-negotiables:**
- **Nothing leaves without clinician sign-off.** Auto-generated drafts, human approval. Both clinically and under DHA scope rules.
- **Bilingual EN/AR** with proper RTL layout, not a mirrored English template. A meaningful share of UAE clients want Arabic; almost no competitor delivers it well.
- **Versioning** — every report immutable once signed; corrections issue a new version with a visible amendment note.
- **Secure delivery** — portal download with authentication, not email attachments. Email a notification with a link; never attach PHI. Optional password-protected PDF for clients who insist on email.
- **Access audit** — who generated, who signed, who downloaded, when. Required for data-protection compliance.
- **Template versioning** — regenerating a two-year-old report should reproduce the original template, not today's.

**Design matters more than you think.** A beautifully typeset report with clear charts is a marketing asset that circulates to schools, doctors and other parents. Budget real design time for it.

## 16. Payments, billing and accounting

**Payment methods for UAE:** cards via a local gateway (Network International, Telr, PayTabs, Checkout.com, Stripe UAE), Apple Pay and Google Pay, bank transfer for corporate, cash on delivery for a minority of home clients (needs a reconciliation workflow and receipt-at-door), and **BNPL (Tabby, Tamara)** which is highly relevant here — a AED 12,000 package split over 4–12 months is far easier to sell than a lump sum. Also support **stored-card auto-charge per session** for pay-as-you-go clients.

**Deferred revenue is the accounting subtlety that catches package businesses.** When a client pays AED 12,000 for 20 sessions, that is a liability, not revenue. Recognise per session delivered. Your system must track: package sold → unearned revenue → sessions consumed → revenue recognised → expiry policy for unused sessions → refund policy on early termination. Get this wrong and your P&L is fiction and your cash looks like profit.

**VAT engine.** Per-line-item classification derived from the clinical record, as specified in Section 8.4. Every invoice line carries: service code, VAT treatment (0% / 5%), the clinical justification reference, and the recipient type (patient / employer / other business). Quarterly FTA-format returns; five-year record retention; an audit export that pairs each invoice line with the supporting clinical record.

**E-invoicing.** Structured PINT AE (UBL/XML) invoice objects from day one; ASP integration for Peppol transmission; your compliance deadline is appoint-by 31 March 2027, live 1 July 2027.

**Collections.** Automated dunning for missed instalments, payment-plan management, ageing report, and a hard rule the scheduler enforces: a client past a defined arrears threshold cannot be auto-scheduled without an admin override that is logged.

**Cost side.** Therapist time (loaded cost including travel), mileage/fuel, consumables per session, device depreciation, kit loss provision. This gives you true contribution margin per session — which will show you that a 40-minute session with 50 minutes of round-trip travel is a very different business from an in-clinic session, and lets you price and route accordingly.

## 17. Integrations

| Layer | Options |
|---|---|
| HIE (mandatory) | NABIDH (Dubai) via HL7 FHIR R4/CDA; Malaffi (Abu Dhabi); Riayati (Northern Emirates) |
| Neurofeedback hardware | BrainMaster, Thought Technology, BEE Medic/neurocare, Mind Media, Neurobit; Muse S Athena for the remote tier |
| Remote NF platform | Myndlift (buy the remote tier rather than build it — see Section 20) |
| Payments | Network International / Telr / PayTabs / Checkout.com / Stripe UAE; Tabby / Tamara |
| E-invoicing | UAE MoF Accredited Service Provider (Peppol access point) |
| Accounting | Zoho Books or Xero (both have UAE VAT support) — but keep deferred revenue and VAT classification in *your* system and post journals out |
| Maps & routing | Google Maps Platform (Routes, Distance Matrix), OR-Tools for the solver |
| Messaging | WhatsApp Business API — this is the default channel in the UAE, not email |
| E-signature | UAE-compliant provider; consent forms and report signing |
| Identity | Emirates ID capture and validation; UAE Pass for authentication where available |

## 18. Architecture

**Hosting: UAE region only.** AWS me-central-1 (UAE), Azure UAE North, or a G42/Core42 sovereign offering. Verify that *every* managed service you use — database, object store, queue, search, logs, monitoring, backups, analytics — is available and pinned to that region. Some services are not. Design around the gaps rather than quietly shipping a log stream to Ireland.

**Suggested stack:**
- **Backend:** TypeScript (NestJS) or Python (FastAPI). Python if you plan meaningful EEG signal processing in-house; TypeScript for a single-language full stack.
- **Database:** PostgreSQL — relational core, JSONB for flexible clinical payloads, TimescaleDB extension for session time-series.
- **Time-series/telemetry:** session EEG summary metrics in Timescale; raw EEG (large) in object storage with pointers in Postgres.
- **Web console:** React + TypeScript.
- **Mobile (therapist + client):** React Native or Flutter — one codebase, and the therapist app needs offline-first with a local SQLite store and a sync engine with explicit conflict resolution.
- **Async work:** a queue (SQS/Redis) for PDF generation, HIE submission, notifications, nightly route solve.
- **Files:** object storage, encrypted at rest with customer-managed keys, versioned, lifecycle-locked for 25-year retention.

**Cross-cutting:**
- Multi-tenant by design even if you are one clinic — you may license this later, and retrofitting tenancy is painful.
- **Immutable audit log of every PHI access.** Who read what, when, from where. Non-negotiable.
- RBAC with clinical scope enforcement: role plus licence plus certification determines what a user can do, not role alone.
- Consent as a first-class object: purpose-scoped, versioned, withdrawable, with NABIDH opt-out state tracked.
- Encryption in transit and at rest; field-level encryption for the most sensitive identifiers.
- Structured event log for the whole clinical journey — feeds analytics without querying operational tables.

## 19. Build roadmap

**Phase 0 — Regulatory pre-work (start immediately, parallel to everything).** DHA pre-submission consultation on home-delivery classification. Legal counsel on facility structure and jurisdiction. EMR/NABIDH certification path decision. Do not write meaningful code until the classification answer is in hand.

**Phase 1 — MVP, months 1–4.** The goal is to run the business, not to be impressive.
- Client record with structured clinical fields, Emirates ID capture, consent
- Manual scheduling with a map view (skip the solver — 3 therapists do not need VRPTW)
- Therapist mobile app: today's list, client brief, session capture, offline
- Session logging with protocol reference and telemetry
- Baseline and progress PDF reports with clinician sign-off
- Invoicing with VAT classification and deferred revenue
- One payment gateway + one BNPL provider
- Client portal: schedule, progress, documents, pay

**Phase 2 — Scale operations, months 5–9.**
- Automated route optimisation
- Kit and consumables logistics with chain of custody
- Full assessment suite: qEEG ingestion, CPT, questionnaire library with scoring
- Protocol engine with versioning and credential gating
- WhatsApp automation for reminders, ETAs and rescheduling
- NABIDH integration and certification
- Bilingual EN/AR reporting
- Analytics dashboards

**Phase 3 — Differentiate, months 10–15.**
- Insurance pre-auth and claim generation; medical-report generator
- Remote/hybrid training tier (Myndlift integration or equivalent)
- PINT AE e-invoicing via ASP — must be live before 1 July 2027
- Corporate/B2B portal with cohort reporting for employers
- Outcome analytics: which protocols work for which presentations, in your own population
- Predictive dropout flagging based on adherence and early-response patterns

**Phase 4 — Expand, months 16+.** Abu Dhabi (DOH + Malaffi), Northern Emirates (MOHAP + Riayati), franchise or multi-tenant licensing, GCC expansion (Saudi is the obvious next market and has no zero-rating for healthcare, which changes the model).

## 20. Build vs buy — be honest about this

| Component | Recommendation |
|---|---|
| EMR clinical core | **Buy/partner.** Use a DHA-NABIDH-certified system as the record of truth. Self-certification is not accepted and certification is slow. Build your layer around it via API |
| NABIDH connector | **Buy** — via your certified EMR vendor |
| Scheduling & routing engine | **Build.** This is your differentiation. OR-Tools + Google Maps |
| Kit logistics | **Build.** Nothing off the shelf fits clinical-device field logistics |
| Session capture & protocol engine | **Build**, tightly coupled to your hardware |
| qEEG analysis | **Buy** — comes with your hardware vendor's software |
| Remote training tier | **Buy** (Myndlift). Building a remote neurofeedback platform is a company in itself |
| PDF reporting | **Build.** It is your brand, and templates are cheap to build, expensive to license |
| Accounting ledger | **Buy** (Zoho Books / Xero) and post journals from your system |
| VAT classification & deferred revenue | **Build.** Too domain-specific for generic accounting software |
| E-invoicing transmission | **Buy** — accredited ASP, legally required |
| Payments | **Buy** — gateway + BNPL |

Rough first-year build estimate for Phases 1–2 with a small senior team (1 tech lead, 2 full-stack, 1 mobile, 1 designer, fractional clinical informatics): **AED 900,000 – 1,600,000**, plus AED 150,000–350,000/yr running cost including hosting, licences and the certified EMR. Regional agency rates could land lower; a badly-scoped enterprise vendor will quote three times higher. The variance is almost entirely about how much you insist on building versus integrating.

## 21. KPIs to instrument from day one

**Operational:** sessions per therapist per day; travel time as a % of paid hours; on-time arrival rate; same-day cancellation rate; kit utilisation %; consumable cost per session.

**Clinical:** program completion rate (the number that matters most — industry attrition over 20–40 sessions is brutal); sessions completed vs prescribed; symptom-scale delta from baseline; qEEG metric movement on trained bands; adverse-event rate.

**Commercial:** CAC by channel; free-consult → paid-program conversion; average program value; revenue per therapist-hour; contribution margin per session net of travel; repeat/maintenance rate; referral rate (in a category this word-of-mouth-driven, referral rate is your real growth engine).

**Compliance:** NABIDH submission success rate; licence and certification expiry runway; overdue calibration count; % of invoices with clinically-derived VAT classification; report turnaround time from session to signed delivery.

---

## Sources

- Mordor Intelligence — Neurofeedback Systems Market; UAE Home Healthcare Industry
- Precedence Research, Straits Research, Spherical Insights, The Business Research Company — neurofeedback systems market sizing
- Myndlift — clinician platform, remote practice guides, Brainboost case study
- Peak Brain Institute / Andrew Hill PhD — neurofeedback cost guide 2026
- ISNR — Standards of Practice for Neurofeedback and Neurotherapy; Guidelines for Practice
- US VA Whole Health — biofeedback/neurofeedback community provider standards
- Eapen et al. — Epidemiological Study of ADHD Among School Children in the UAE
- Springer / *Journal of Epidemiology and Global Health* (2023) — Prevalence of Undiagnosed ADHD Symptoms in Young Adults in the UAE
- WHO EMRO — EMHJ vol. 29 no. 9, ADHD services in Dubai
- DHA — Sheryan portal, Standards for Mental Health Services (Jan 2025), circular CIR-2025-00000009, NABIDH documentation
- DHCC — Standard for Licensed Home Healthcare Services
- Federal Law No. 2 of 2019 (ICT in Health Fields); Dubai Health Data Law No. 11 of 2018; Cabinet Decision No. 32 of 2020; Federal Law No. 10 of 2023 on Mental Health
- UAE Federal Tax Authority — VAT public clarification on healthcare (Oct 2019); UAE VAT law on healthcare zero-rating
- UAE Ministry of Finance — Electronic Invoicing System; Federal Decree-Law No. 16 of 2024; Ministerial Decisions 243 & 244 of 2025; UAE E-Invoicing Guidelines V1.0
- Provider websites: Evolve Brain Training, MindTune, BrainHub Polyclinic, King's College Hospital Dubai, Positive Living UAE, German Neuroscience Center, Harmony Centre, dubaipsychology.ae
