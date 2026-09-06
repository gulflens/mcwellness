# SPEC — Assessments and the brain map (piece ten)

_Worktree: `assessment`, owning `domain/assessment/**`, `app/admin/assessments/**`, `app/api/assessments/**`, `db/policies/assessment/**`, `tests/assessment/**` and migrations `500–599` (`docs/SPEC/OWNERSHIP.md`; the policy path is one of the change requests in section 6). Entities are defined in `00-data-model.md` section 4. Builds on `session-capture.md`, `client-record.md` sections 4.2 and 8, and `docs/SEAMS.md`. This file defines behaviour._

Status: **approved by the operator on 2026-09-06 with `docs/PLAN/piece-ten.md`, and amended in the build, 2026-09-06** (the amendments are recorded in `docs/CHANGE-REQUESTS/assessment-01.md`). **It replaces the draft of 2 September 2026**, which was written before pieces one to eight existed — before the brain map was a service in the catalogue, before a visit had a record, before the storage seam, and before an erasure reached anything. Where the two differ, this file stands. The decisions the draft raised are re-answered in section 10.

---

## 1. Purpose

An assessment is a measurement, written down once and never rewritten.

Two kinds of thing are measured. **The brain map (qEEG)** — the practitioner records the brain's own electrical activity with sensors on the scalp, and the equipment's software produces a set of files and a set of figures, comparing the recording with its own reference database for a person of that age and sex. The platform keeps both: the files as the equipment wrote them, and the figures in a form it can set beside the figures from another day. That pairing is the whole idea. The files are the evidence; the figures are what a comparison is made of. **Questionnaires** — a sleep or attention form the client or a parent fills in, scored to a total. These are self-report measures. They record what somebody said about themselves on a particular day, and nothing more.

Everything else here follows from one sentence: a measurement is a fact about a day, and a fact about a day does not change. A figure entered wrongly is corrected by recording a new version of the old one, with a reason, and both stay.

The practice's own words for this are already written and already agreed with every household that signs the participation wording (`docs/CONSENT/participation.en.md`): a brain map shows patterns of activity, **it is not a diagnosis**, and McWellness is a wellness provider and not a medical clinic. Nothing on a screen, in an export or in a report may say anything stronger. A measurement and a comparison is the whole of what this offers.

## 2. What exists on `main`, and what this adds

| Already built | This piece adds |
| --- | --- |
| The brain map as a **service the practice sells and delivers**: `service_type` code `brain-map`, ninety minutes, at home, requiring a `vendor_qeeg` credential, priced net, with the three programmes entitling two, three and four of them. It is booked, checked in, run and closed as any other visit | The measurement that visit produces, which the platform has nowhere to put today |
| `document`, the storage seam (`domain/shared/storage.ts`), `clientDocumentKey`, `documentRetentionUntil`, `auditDocumentRead` and short-lived signed links; the kind `assessment_raw` already in `CLIENT_UPLOAD_KINDS` | A door wide enough for a vendor's export: the Documents tab caps an upload at 45 KB inside a 64 KB JSON body (section 7.1) |
| `credential` with `can_execute_session`, re-checked at execution time; `app.client_visible_to_practitioner` (ninety days back, thirty forward, confirmed visits only) | The same two gates on recording and on reading a measurement |
| `app.erase_client` (migrations 100, 104, 105): a visit's files go and its measurements stay, anonymised, and the confirmation letter says so | The step that reaches the assessment, and the sentence in the letter that covers it |
| The audit trigger and `app.audit_redact`; the five band hues of `docs/DESIGN-BRIEF.md` section 3.1 | The Assessments tab and the comparison view |

## 3. Screens

**3.1 The Assessments tab** on the client record (`app/admin/assessments/`, mounted in `ClientDrawer.tsx`, which is `client-record`'s — a change request, section 6). A table in the console's manner: date, instrument, who recorded it, whether a file is attached, and a word for its state. A superseded version sits beneath the one that replaced it, quiet, with its reason. Two actions: **Record**, and **Compare**, which is offered once two assessments of one instrument exist.

**3.2 Recording one.** A right-side drawer, not a wizard. The date and the instrument; then the figures, laid out from the instrument's own declared shape, so a brain map asks for band powers per site with their units and a questionnaire asks its questions and shows the total it computes. Beside the typed fields, one free-text line for recording conditions — eyes open or closed, the room, an artefact worth mentioning — never instead of them (CLAUDE.md rule 3). Then **Attach the export**, which files the software's own file against the assessment. The drawer refuses, with the field named, a figure without its unit, an unknown instrument, or a payload the shape does not recognise.

**3.3 The comparison.** Two or more assessments of one instrument for one client, side by side: the earlier figure, the later figure, the difference, and nothing else. A band figure carries its band's hue from the design brief and no other colour; nothing is red, nothing is labelled high, low or abnormal. The screen shows the age and sex each reference comparison was made against, because a comparison made against a nine-year-old is not the comparison made against a ten-year-old.

A table, not a chart, in the first version. The practice reads figures, and a chart invites a shape to be over-read. One fixed sentence, in English and Arabic, sits on the screen and on anything printed from it: **this is a comparison of measurements taken on different days; it is not a diagnosis.** The words are the consent's own, so the two can never drift apart.

**3.4 The reference figures.** Where the equipment's software has compared a recording against its own database, the platform keeps what the software reported, with the age and sex it used, and computes no comparison of its own. It attaches no word to a figure. What a measurement means is the practitioner's judgement, written in a report and signed by a person (`reports-v1.md`). The screen does arithmetic; the practitioner does the reading.

## 4. What the household sees

Nothing, until a report is issued. Not the files, not the figures, not the comparison.

A qEEG export means nothing without the practitioner's reading of it, and a household left alone with band figures will make of them exactly what the consent promises the practice will not. The route by which a measurement reaches a family is a signed report, and it is the only route. The portal's own commitment already says so (`client-portal.md` section 1): no measurements until piece ten renders them, and what piece ten renders is a report.

This is a rule in the database, not a screen with no link on it. No `client_contact` policy grants a read on `assessment` or `assessment_document` at all, and a deny test proves it for a contact's own client. `finance` sees nothing either: `client-record.md` section 2 gives that role demographics and contacts.

## 5. Rules (pure functions in `domain/assessment`, each tested)

1. `validateDerived(instrument, instrumentVersion, payload)` — the shape declared in `domain/assessment/shapes/`, refused with the field named. Every brain-map figure carries its unit; a questionnaire payload carries the answers, the total and the maximum. **No payload carries an interpretation band.** Storing "moderate" beside a score puts a label on a person in a field nobody signed.
2. `scoreQuestionnaire(instrument, answers)` — the total the person's own answers produce, and only the total. Never a category, never a cut-off, never a word.
3. `compare(earlier, later)` — paired figures and their differences, refusing two assessments of different instruments or different clients, and refusing a pair whose units disagree.
4. `currentVersions(assessments)` — the current version of each measurement with its chain beneath it; the current one is the one nothing supersedes.
5. `canSupersede(assessment, reason)` — refuses a supersede of an already-superseded version, and a supersede with no reason.

## 6. Data owned

**`assessment`** (migration `500_assessment.sql`), as `00-data-model.md` section 4 defines it — `client_id`, `performed_at`, `performed_by_practitioner_id`, `instrument`, `instrument_version`, `derived jsonb`, `version`, `supersedes_id` — plus the section 1 conventions, the tenant-bound key of migration 099, `comment on table ... 'audited: client'`, and these differences. Each is a **change request to `00-data-model.md`, written and not applied** (`docs/CHANGE-REQUESTS/assessment-01.md`):

| Change | Why |
| --- | --- |
| `supersede_reason text`, required when `version > 1` | Every other append-only entity requires a reason; section 4 omits it here by oversight. `client_protocol` is the precedent. |
| `condition_note text` null | Recording conditions, beside the typed fields. |
| `reference_age_years int` and `reference_sex`, both null | The age and sex the software's comparison was made against, snapshotted. A birthday and a corrected record both move the live answer; the comparison that was actually made does not. |
| `raw_document_id` dropped in favour of **`assessment_document`** | One brain map produces several files — an eyes-open recording, an eyes-closed recording, the software's own report. One column forces a choice and loses the rest. The link table carries `assessment_id`, `document_id` and `role` (`raw`, `vendor_report`), with a composite key binding the document to the assessment's own client, the pattern `billing_document` (migration 407) already sets. |
| **No `session_id` in this piece** | The honest link is to `session`, in the 300 range, and apply order across ranges is not fixed (`OWNERSHIP.md`), so a 500 migration must not assume it is there. The trunk's `950–999` half exists for exactly this: a trunk migration that builds on a stream's own table sorts last. The link is a change request for a `95x` migration once both ranges are on `main`, not a guard invented here. `performed_at` and the client are enough meanwhile. |

**The erasure step.** `app.erase_client` lives in `client-record`'s range (migration 100, replaced by 104 and 105), so this is a change request to that stream for a `106` migration, guarded with `to_regclass('public.assessment')` exactly as 105 guards the visit tables. **The files go and the figures stay.** Every file behind an assessment is deleted with the client's other documents — a qEEG recording is the person's own brain activity and there is no version of it that is not personal. The band powers, the reference figures and the questionnaire totals remain, as a visit's measurements already do, because they identify nobody once the record around them is anonymous and the practice uses them in aggregate. `condition_note` and `supersede_reason` are nulled with the rest of the free text. The confirmation letter (`domain/client/erasureLetter.ts`) must say this about assessments in the same sentence it says it about sessions, or the letter is wrong. **Both requests ship in the round that ships the first assessment, not later.**

Three smaller requests: the drawer's tab mount point; a seed generator giving three synthetic clients a baseline brain map, a re-map ninety days later and one questionnaire total, every figure from `db/seed/random.ts` under the fixed seed and **no file seeded at all**; and the `assessment` row in `OWNERSHIP.md`, which names no `db/policies/assessment/**` though every other row names its policy path.

## 7. Routes (`app/api/assessments/`, thin, calling `domain/assessment`)

| Route | Who | Notes |
| --- | --- | --- |
| `GET /api/clients/:id/assessments` | owner, admin, lead practitioner; a practitioner for a client visible to them | Current versions with their history beneath; one audit `list` row per row shown |
| `POST /api/assessments` | a practitioner holding a valid credential for that service | Validates the payload, checks the credential and the consents, writes the row |
| `PUT /api/assessments/:id/file` | the same | The export's bytes (7.1) |
| `GET /api/assessments/file/:documentId/link` | the readers above | `auditDocumentRead`, then a short-lived signed link |
| `POST /api/assessments/:id/supersede` | the recording practitioner, or the lead practitioner | A new version with a reason; refuses anything that is not current |
| `GET /api/assessments/compare?ids=` | the readers above | Paired figures and differences; computes nothing a reader could not |

**7.1 The export's bytes.** The Documents tab cannot carry them: `MAX_DOCUMENT_BYTES` is 45 KB inside a 64 KB JSON body, and `KNOWN_MIME_TYPES` knows four file signatures. So the assessment gets its own door with a raw body, its own cap, and a declared `X-Sha256` the route recomputes over the bytes — the exemption the photograph's door already set the precedent for (`create-api.ts`, `PHOTO_LIMIT_BYTES`). The bytes go through `storage.put` with `overwrite` false, so a second file under one key is a conflict and never a silent replacement; the `document` row and the `assessment_document` link are written in the transaction and the bytes follow it. A filed evidence document is never replaced (`docs/SEAMS.md`).

**Amended 2026-09-06 on the founder's equipment answer.** The door takes three kinds of file, each recognised from its own bytes and never from the caller's word for it: the analysis software's **PDF report**; the **EDF recording**, by the eight bytes the published format fixes at the front of every file — an ASCII `0` followed by seven spaces; and the **amplifier software's own recording**, which has no signature this repository can rely on and is accepted by the `.eeg` extension the file was chosen under together with a declared `application/octet-stream`, fenced against the four types the platform already recognises and against anything beginning as markup. The cap on this one door is **64 MB** and its timeout seven minutes, because the practice's raw recordings are 22 to 33 MB apiece and a longer recording is bigger; every other path keeps its own envelope and its ordinary ten seconds (`docs/CHANGE-REQUESTS/assessment-02.md`). A file's **role** — `raw_recording`, `vendor_report` or `session_export` — and, where it is a recording, the **condition** it was taken under are the document's own fields, said by the person filing and stored on the link row (migration 503). Neither is ever parsed from a file name: the practice's exports are named after the people in them. An EDF header's next field after the version is the person's own identity, eighty bytes of it; the platform files the recording exactly as the practice sent it and reads that field into no column, no log line and no response, which `tests/assessment/db/routes.test.ts` proves over every route and every audit row.

**7.2 The gates, at execution time on the server.** A valid `credential` for the assessment's own service with `can_execute_session`, re-checked against its dates at the moment of writing and never cached on a device; an active `participation` consent, `minor_participation` where the client is a minor, and `home_visit` where the recording happens at home — the same purposes `canCheckIn` reads, from the same context function. An admin may file an export against an assessment a practitioner recorded, and may not create one.

## 8. Audit

The table is `audited: client`, so the row triggers attribute every change without a join. Opening the tab is a `list`; opening one assessment or the comparison is a `read` per assessment shown, through `logReads` — the distinction PR 5 drew and this stream keeps. Every signed link goes through `auditDocumentRead` before it is signed. Every refusal is written before the answer, as the check-in route writes its own. `derived` holds figures, so nothing in it needs redacting; `condition_note` is free text and takes the trail's 200-character rule like any other.

## 9. Deliberately left out

A normative comparison of the platform's own. Any automatic interpretation of a figure. Charts. A parser for the equipment's export (section 10, decision 2). Anything that reaches a household directly — that is `reports-v1.md`. Protocol suggestion from a measurement: a machine reading a brain map and proposing electrode sites is not something this practice does or claims to do. Offline working: a visit is captured in a stranger's living room, an assessment is recorded from a laptop afterwards, so this module is online-only and no part of the day sheet depends on it.

## 10. Decisions, with the defaults taken

1. _The re-map cadence._ Default (Claude's): none. The programmes already entitle two, three and four brain maps and the entitlement ledger already counts what is left. A date-based cadence would invent a deadline the practice does not work to, and the anti-engagement rule forbids chasing one.
2. _The equipment and its export._ Nothing in this repository names the practice's amplifier or its software, so the export format cannot be settled here. Default (Claude's): **the export is a file a person uploads, never an integration.** Phase 1 accepts the software's own file and the practitioner types the figures, which is what `session-capture.md` section 3.3 already decided for the signal check. A parser is a later piece, pure and tested against fixture files, and no import ever writes an assessment without a person seeing the figures first. The operator's answer about the equipment is what unblocks it. **Amended 2026-09-06 on the founder's equipment answer:** the equipment is now named and the decision stands unchanged — the export is still a file a person uploads and the practitioner still types the figures. What the answer settles is *which* file a later parser reads: **the analysis software's numeric export**, not the PDF report and not the raw recording. A PDF is a picture of the figures and parsing one is guesswork; a raw recording is the signal, and computing figures from it would be the platform making a comparison of its own, which section 3.4 forbids. The numeric export is the figures as the software itself computed them, which is exactly what section 1 says the platform keeps. It is unbuilt until the founder sends one to write fixtures from.
3. _The file cap and the types accepted._ Default (Claude's): 20 MB, and `application/pdf` alone until the equipment is named; a new file signature is a change request to `domain/client/fileSignature.ts` in the trunk. **Amended 2026-09-06 on the founder's equipment answer**, which named it: neurofeedback on one vendor's amplifier and software, and the brain map on another's, recorded to EDF and to that software's own format, analysed and reported elsewhere. The cap is **64 MB** — the raw recordings are 22 to 33 MB apiece — and the kinds accepted are **three**: the PDF report, the EDF recording by its published eight-byte signature, and the amplifier software's own recording by its extension plus `application/octet-stream`, the last of these a default taken rather than a fact established, because one sample file cannot prove that anything at the front of an unpublished format is fixed. The signature request to `domain/shared/fileSignature.ts` is item 2 of `docs/CHANGE-REQUESTS/assessment-02.md`, written and not applied, with a local check in `domain/assessment/fileType.ts` meanwhile.
4. _A capability of its own for recording a brain map._ Default (Claude's): no. Reuse `can_execute_session` on a credential for the `brain-map` service, which the catalogue already requires a `vendor_qeeg` certification for. The capability that decides what a household ever sees is `can_sign_report`, and it already exists.
5. _Which questionnaires._ `00-data-model.md` section 9 named seven, before any was licensed and before this practice used one. Default (Claude's): build the brain-map shape and **one** questionnaire — whichever the operator names — and add the rest one declared shape and one scoring function at a time, as the practice licenses them. Several are proprietary, and the licence is the operator's to hold.
6. _A measurement's provenance._ Default (Claude's): every derived payload names the software and the version that produced it, beside `instrument_version`, so a figure can always be traced to what computed it.

## 11. Done when

- Every function in `domain/assessment` has tests covering each branch, including a payload with a missing unit, a comparison of mismatched units, and a supersede of a superseded row.
- The deny cases pass: a `client_contact` reads neither table for their own client; `finance` reads neither; a practitioner off that client's schedule can neither read nor record, and the attempt is audited; another tenant sees nothing on every route; `update` and `delete` on `assessment` are refused to the API role; an `assessment_document` naming another client's document is refused by the composite key; recording without `participation`, and for a minor without `minor_participation`, is refused; a lapsed credential is refused with the reason named.
- On staging, a synthetic client is given a baseline and a re-map, a file is attached to each, and the comparison shows the difference with the "not a diagnosis" sentence in both languages.
- An erasure of that client leaves no assessment bytes, keeps the figures, and the confirmation letter says so.
- Migrations 500 and 501 apply on a fresh database and on one carrying every stream's range; the audit trigger and the classification comment are on both tables.
- `pnpm verify` and `pnpm test:db` green; one combined review and one re-check under `docs/HANDOVER.md` section 6, with the record posted.
