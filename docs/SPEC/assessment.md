# SPEC — Assessments and the brain map

*Worktree: `assessment`. Entities: `assessment` and a new `assessment_document`, reading `client`, `document`, `credential` and `service_type` from `00-data-model.md`. Migrations `500–599`. This spec describes behaviour first in plain language and puts the builder's detail at the end; where it needs a column the data model does not yet have, section 8 says which and why.*

---

## 1. What an assessment is here

An assessment is a measurement, written down once and never rewritten.

Two kinds of thing are measured.

**The brain map (qEEG).** The practitioner records the brain's own electrical activity with sensors on the scalp, the same way a neurofeedback session records it, and the equipment's software produces a set of files and a set of numbers. The platform keeps both: the files exactly as the equipment wrote them, and the numbers in a form it can compare with the numbers from another day. That pairing is the whole idea. The files are the evidence; the numbers are what a comparison is made of.

**Questionnaires and rating scales.** A sleep or attention questionnaire the client or a parent fills in, scored to a number. These are self-report measures. They record what somebody said about themselves on a particular day, and nothing more.

Everything else in this specification follows from one sentence: a measurement is a fact about a day, and a fact about a day does not change. If a number was entered wrongly, the practice records the corrected measurement as a new version of the old one, and both stay. Nothing is edited in place and nothing is deleted to tidy up.

The practice's own words for what this is are already written and already agreed with every client who signs the participation consent (`docs/CONSENT/participation.en.md`, section 2): a brain map shows patterns of activity, **it is not a diagnosis**, and McWellness is a wellness provider and not a medical clinic. This platform must not say anything stronger anywhere — not on a screen, not in an export, not in a report. A measurement plus a comparison is the whole of what it offers.

## 2. Who uses it

| Role | Can |
|---|---|
| `owner`, `admin` | See every assessment for their practice; file a raw export against one; never sign or interpret |
| `lead_practitioner` | All of the above, plus record an assessment and read the comparison view |
| `practitioner` | Record an assessment for a client on their own schedule, if their credential allows it; read that client's comparison view |
| `finance` | Nothing. Finance sees demographics and contacts, never measurements (`client-record.md` section 2) |
| `client_contact` | Nothing at all until a report is issued (section 5) |

## 3. When an assessment is taken

- **Before a programme.** The brain map is the practice's front door: a consultation, a qEEG and a report are what a household buys first (`billing.md` section 2.2). A baseline exists before the first neurofeedback session, or the programme has nothing to be measured against.
- **On the cadence the practice sets.** The packages already carry re-maps — one with Starter, two with Core, three with Full. A re-map is an ordinary assessment of the same instrument; nothing about it is special except that a comparison now has two points.
- **At the end of a programme**, so the completion report has a closing measurement.
- **Whenever the practitioner judges it useful.** Nothing in the platform forces a cadence or nags about one. The anti-engagement rule holds here as everywhere: the platform may show that a re-map is due, once, quietly, on the client's own record. It never chases.

*Decision for the operator:* whether the platform should carry a per-client re-map cadence in days, or simply count the re-maps a package entitles the client to and leave the timing to the practitioner. **Recommendation:** count the entitlement and leave the timing alone. A date-based cadence invents a deadline the practice does not actually work to, and the package already says how many re-maps were paid for.

## 4. What the practitioner sees

Two screens, and they are the point of the whole module.

**The list.** Every assessment for one client, newest first: the date, the instrument, who recorded it, and whether a raw file is attached. A superseded version sits underneath the one that replaced it, greyed, with the reason.

**The comparison.** Two or more assessments of the same instrument, side by side, with the change between them. For a brain map that is band power per site and the ratios the practice uses; for a questionnaire it is the total score. Each row shows the earlier figure, the later figure and the difference, and nothing else.

The comparison view carries one fixed sentence, in English and Arabic, on the screen and on anything printed or exported from it: **this is a comparison of measurements taken on different days; it is not a diagnosis.** The wording matches the consent the household signed, word for word, so the two documents can never drift apart.

The platform does not colour a number red, does not label a band "abnormal", and does not compare a client against a reference database. What a measurement means is the practitioner's judgement, written in a report and signed by a person (`reports-v1.md`). The screen does arithmetic; the practitioner does the interpretation.

## 5. What the household sees

Nothing, until a report is issued.

Not the raw files, not the numbers, not the comparison. A qEEG export is a technical artefact that means nothing without the practitioner's reading of it, and a household left alone with band figures will make of them exactly what the consent promises the practice will not: a diagnosis. The route by which a measurement reaches a family is a signed report, and it is the only route.

This is a rule in the database, not a screen that happens to have no link on it. The `client_contact` policies grant no read on `assessment` or on `assessment_document` at all, and a deny test proves it.

## 6. What an erasure does

When a household asks to be erased, the assessment is treated exactly as migration 105 treats a visit: **the raw files are deleted and the derived measurements are kept, anonymised.**

- Every file behind an assessment goes from the store and its `document` row goes with it, under the existing step that deletes a client's documents (`client-record.md` section 8, step 2). A qEEG recording is the person's own brain activity and there is no version of it that is not personal.
- The numbers stay. Band powers, ratios and questionnaire totals identify nobody once the record around them is anonymous, and the practice uses them in aggregate to know whether its work helps. This is the same judgement the session measurements were given, for the same reason.
- Anything free-text on the assessment — the note about recording conditions — is nulled with the rest.

The erasure confirmation letter already tells the household exactly this about their sessions. It must tell them the same about their assessments, in the same sentence, or the letter is wrong.

## 7. The rules

**7.1 Versioned, never edited.** An `assessment` is append-only, like `session`, `report`, `client_protocol` and `invoice` before it (`00-data-model.md` section 7). A correction inserts a new row carrying `version`, `supersedes_id` and a required reason. The current version is the one nothing supersedes. The API role holds no `update` and no `delete` on the table, so this is a grant and not a convention.

**7.2 Raw files go through the storage seam.** Bytes are written with `put` from `domain/shared/storage.ts` under the client they belong to, never with `overwrite`, and a second write to the same key is a 409 and not a silent replacement. Each file gets a `document` row of kind `assessment_raw` — a kind that already exists in `domain/client/documentKinds.ts` — and therefore the ordinary five-year retention clock from upload. Nothing in SQL talks to a store; the row is written in the transaction and the bytes follow after the commit, as billing already does.

**7.3 Derived results are typed at the edge.** `derived` is JSON, and the database checks only that it is an object. Its shape is declared per instrument in `domain/assessment/shapes/`, validated in the route before the row is written, and refused with a plain sentence naming the field that is wrong. The shape is versioned with `instrument_version`, so a payload written under version 1 stays readable when version 2 exists. A qEEG payload names its unit for every figure; a questionnaire payload carries the answers, the total and the maximum. **No payload carries an interpretation band.** Storing "moderate" beside a score is the practice putting a label on a person in a field nobody signed, and the report is where a judgement belongs.

**7.4 Who may record one.** Credential-gated exactly as a session is: a valid `credential` for the assessment's own service type with `can_execute_session` true, re-checked against `valid_from` and `valid_to` at the moment of writing, never cached on a device. An admin may file a raw export against an assessment a practitioner recorded, and may not create one.

*Decision for the operator:* whether recording a brain map should need its own capability column on `credential` rather than reusing `can_execute_session`. **Recommendation:** reuse it, and add nothing. The capability that actually matters is `can_sign_report`, which already exists and already gates the only thing a household ever sees.

**7.5 Consent gates recording.** An active `participation` consent, plus `minor_participation` where the client is under 18, plus `home_visit` when the recording happens at home — the same check the session runner makes at the door, from the same function, at execution time on the server.

**7.6 Audit and access follow the existing patterns.** The table is declared `audited: client`, so the row triggers attribute every change to the client without a join. Reading the assessments tab is a read worth logging (`audit.md` section 5). Access is the client-visibility rule the platform already has: same tenant first, then role, then a practitioner's own schedule. No new machinery.

**7.7 Offline is not required.** A session is captured in a stranger's living room with one bar of signal; an assessment is recorded when the practice decides to record one, and the export file arrives from a laptop. The module is online-only, deliberately, and no part of the day sheet depends on it.

---

## 8. Builder notes

**8.1 The tables.** `00-data-model.md` section 4 defines `assessment` as `client_id`, `performed_at`, `performed_by_practitioner_id`, `instrument`, `instrument_version`, `raw_document_id`, `derived jsonb`, `version`, `supersedes_id`. Built as written, plus the conventions of section 1 (`id`, `tenant_id`, `created_at`, `updated_at`, `created_by`) and these changes:

| Change | Why |
|---|---|
| `supersede_reason text`, required when `version > 1` | The append-only rule elsewhere requires a reason; section 4 omits it here by oversight. `client_protocol` is the precedent. |
| `condition_note text` null | Recording conditions — eyes open or closed, the room, an artefact worth mentioning. Free text beside typed fields, never instead of them. |
| `raw_document_id` dropped in favour of `assessment_document` | One qEEG produces several files: an eyes-open recording, an eyes-closed recording, and the vendor's own PDF. A single column would force the practice to choose one and lose the rest. The link table carries `assessment_id`, `document_id`, `role` (`raw`, `vendor_report`), with a composite foreign key binding the document to the assessment's own client so a file can never be attached across records — the pattern `billing_document` (migration 407) already sets. |
| No `session_id` link in this phase | The natural link is to `session`, which lives in the 300 range. `OWNERSHIP.md` is explicit that apply order across ranges is not fixed and a migration may depend only on what its own `Needs` names, so a 500 migration must not assume the session tables exist. `performed_at` and the client are enough for now; the link is a later migration guarded with `to_regclass`, as 105 does. |

**8.2 Migrations.** `500–599`, confirmed against `OWNERSHIP.md`'s Stage 2 table, which already carries the `assessment` row; nothing in that file needs changing for this worktree to open. Expect `500_assessment.sql`, `501_assessment_document.sql`, `502_assessment_policies.sql`. Each names its `Needs` and none names a number above its own.

**8.3 Routes** under `app/api/assessments/`, thin, calling `domain/assessment`:

- `list.ts` — assessments for one client, current versions with their superseded history beneath.
- `record.ts` — create one. Validates the derived payload against the instrument's declared shape, checks the credential and the consents, writes the row.
- `attach.ts` — file a raw export against an existing assessment: the `document` row and the `assessment_document` link in one transaction, the bytes through the storage seam after the commit.
- `supersede.ts` — a new version with a reason, refusing a supersede of anything that is not the current version.
- `compare.ts` — two or more assessment ids of the same instrument for one client, returning the paired figures and their differences. It computes nothing the client could not compute itself; it exists so the arithmetic is in one tested place.
- `schema.ts` — the request and response shapes, as every other route folder has.

**8.4 Screens.** An **Assessments tab** on the client record, and a **comparison view** opened from it. The tab's own components live in `app/admin/assessments/**`, which this worktree owns. The mount point does not: `app/admin/clients/ClientDrawer.tsx` belongs to `client-record`, so adding the tab to it is a change request (`docs/CHANGE-REQUESTS/assessment-01.md`), not an edit. The comparison view is a table, not a chart, in the first version: the practice reads figures, and a chart invites a shape to be over-read.

**8.5 Importing a qEEG export.** `docs/CATALOGUE.md` does not exist in this repository and no document here names the practice's amplifier or its software, so the export format is not something this specification can settle.

*Decision for the operator:* which equipment and software the practice uses, and what its export actually produces. **Recommendation:** ask before building the importer, and build the manual path first regardless. The two formats worth planning for are **EDF** (European Data Format, the standard container for raw electrophysiological recordings, which most amplifiers export) and **CSV** (the per-band summary tables the analysis software produces). Phase 1: the practitioner files the vendor's export as a document and types the derived figures, which is exactly what `session-capture.md` section 3.3 already decided for the signal check. Phase 2: `domain/assessment/import/` parses a named format into the declared shape, pure and tested against fixture files, with the practitioner confirming the parsed figures before they are written. No import ever writes an assessment without a person seeing the numbers first.

**8.6 Tests, and the deny cases they prove.** Under `tests/assessment/`, with database tests under `tests/assessment/db/` and nowhere else.

1. A `client_contact` reading `assessment` or `assessment_document` gets nothing, by policy, for their own client. The one that matters most.
2. A practitioner whose credential lacks `can_execute_session`, or whose credential has expired, is refused with a sentence naming the reason.
3. A practitioner not on that client's schedule cannot read or record, and the attempt is audited.
4. Another tenant's user sees nothing, for every route.
5. `update` and `delete` on `assessment` are refused to the API role.
6. A supersede of an already-superseded version is refused; a supersede without a reason is refused.
7. A derived payload of the wrong shape, an unknown instrument, and a figure without its unit are each refused at the edge with the field named.
8. An `assessment_document` naming a document belonging to another client is refused by the composite foreign key.
9. Recording without an active `participation` consent, and for a minor without `minor_participation`, are refused.
10. After `app.erase_client`, the raw documents are gone from the store and the row, the `derived` numbers remain, and `condition_note` is null.

**8.7 Seed.** The synthetic practice gets, for three of its clients, a baseline qEEG and a re-map ninety days later with plausible band figures generated from `db/seed/random.ts` under a fixed seed, and one questionnaire with a total score. **No file is seeded** — the derived numbers alone. A seeded recording would be a file shaped like a real person's brain activity sitting in a repository, and there is no need for one. `db/seed/**` is the trunk's, so the generator arrives as a change request (`assessment-02`).

**8.8 What this worktree owes the trunk.** Three change requests, all small: the drawer tab mount point (8.4); the seed generator (8.7); and an amendment to `00-data-model.md` section 4 recording the column changes in 8.1. A fourth, if the reviewer agrees: the `assessment` row in `OWNERSHIP.md` names no `db/policies/assessment/**`, though every Stage 1 row names its policy path. The worktree writes the request rather than editing the map.

## 9. Out of scope

Reference databases and normative comparison of any kind. Automatic interpretation. Charts. Anything that reaches the household directly — that is `reports-v1.md`. Protocol suggestion from a measurement: the practitioner authors a protocol, and a machine reading a brain map and proposing electrode sites is not a thing this practice does or claims to do.

## 10. Done when

- Every function in `domain/assessment` has tests covering each branch, including a payload with a missing unit and a supersede of a superseded row.
- On staging, a synthetic client can be given a baseline and a re-map, and the comparison view shows the difference with the "not a diagnosis" sentence in both languages.
- All ten deny cases in 8.6 pass.
- An erasure of that client removes the files and leaves the figures.
- `pnpm verify` green; the combined review passes.
