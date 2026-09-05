# SPEC — Session and progress reports (piece ten)

_Worktree: `reports`, owning `domain/reports/**`, `app/admin/reports/**`, `app/api/reports/**`, `jobs/reports/**`, `db/policies/reports/**`, `tests/reports/**` and migrations `600–699` (`docs/SPEC/OWNERSHIP.md`; the policy path is one of the change requests in section 6). Entities are defined in `00-data-model.md` section 4. Builds on `billing.md`, `assessment.md`, `client-portal.md` and `docs/SEAMS.md`. This file defines behaviour._

Status: **written 2026-09-05 for the operator's approval as piece ten** (`docs/PLAN/piece-ten.md`). **It replaces the draft of 2 September 2026**, which was written before the PDF writer, the document filing, the sending seam, the portal and the practice's own identity existed. Where the two differ, this file stands. The decisions the draft raised are re-answered in section 10.

---

## 1. Purpose

A report is the practice speaking to a household in writing, with a practitioner's name on it.

**A session report** follows one visit: what was delivered, on what date, by whom, how the client was before and after, what the practitioner observed, and what to expect before the next visit. It is short, and the practice sends one when a visit was notable or when a parent asks what happened. **A progress report** covers a stretch of a programme — a package, a quarter, the whole of it: sessions delivered against sessions bought, the goals the client set and what has moved, the practitioner's summary and, where the client has had more than one brain map, the comparison between them. This is the document the practice's work is judged by, and the one a household keeps.

Both are the same object and follow three rules. **A report is signed by a person** — not by the practice and not by the platform, but by a named practitioner whose credential says `can_sign_report`. The signature is what turns a draft into a document. **Once signed it never changes**: a correction is a new version that supersedes the old one and says why, and both stay. **It is a PDF filed like every other document**, rendered by the same writer that renders the practice's invoices, filed against the client with a retention date, and delivered by the hand-off the practice already uses.

Nothing in a report describes a diagnosis, a treatment, a patient or a medical claim. A questionnaire is named as a self-report measure, a brain map as a measurement, and a change between two of them as a difference between two days.

## 2. What exists on `main`, and what this adds

| Already built | This piece adds |
| --- | --- |
| A pure bilingual PDF writer, `domain/billing/document`: the page renderer (`pdf.ts`), the TrueType reader (`truetype.ts`), the Arabic shaper (`arabic.ts`) and the extractor the tests read a finished page back with (`extract.ts`), plus the invoice's own model, layout and wording. `renderDocument(document, fonts)`; nothing in it reads a clock or a database | The report's own model, layout and wording over the same writer — after the trunk moves the four byte-level files to `domain/shared/document` (section 5) |
| `app/api/billing/documents.ts`: rendering, idempotent filing through a database function under unique indexes, the bytes after the commit through `afterCommit`, `auditDocumentRead` before every signed link, and a repair path that re-renders bytes the store never received and refuses when the fingerprint differs | The same shape for a report, and that re-render as a **test**, which is what proves the snapshot rule holds |
| The sending seam (`docs/SEAMS.md`): `draftMessage`, `whatsAppHandoff`, `shareSheetSender`, and a trail that records the contact's id and the channel and never a number | A report's own drafted sentence, and a `report_delivery` row |
| `credential.can_sign_report`; `contact.can_receive_reports` and `whatsapp_opt_in`; the practice's legal name in both languages, trade licence and registered address (migration 905) | The signing door, and the signer and practice snapshots on the row |
| The visit record: ratings before and after, structured observations, telemetry, `signal_quality_score`; the entitlement ledger; the client portal's five screens | The figures a report quotes, and a sixth portal screen (`client-portal`'s, by change request) |

**There is no rendering job.** `jobs/` holds one worker, for erasure file deletions; billing renders inside its own route and this does the same. `jobs/reports/**` stays empty unless a rendering is measured to be slow, which is a measurement and not a plan.

## 3. Signing, and what it freezes

Drafting is ordinary work. The practitioner opens a draft, the platform fills in everything it already knows — the visits, the ratings, the goals, the brain-map comparison — and the practitioner writes the parts only a person can write.

Signing is a one-way door. The platform re-checks the credential at that moment against its validity dates and refuses with a plain sentence if it has lapsed. Then it writes onto the report **what was true at signing**: the signer's name, their certification, the certifying body and the certificate number. It does not point at the credential row and read it later. A credential expires, is renewed, is corrected; a report issued in March must still say who signed it in March and on what authority, five years on. The practice's own identity block is snapshotted in the same breath, exactly as `app.stamp_invoice_supplier` stamps an invoice.

An issued report cannot be edited, withdrawn or deleted. A correction is a new version: same client, same coverage, a new PDF, `supersedes_id` at the old one and a reason. The superseded version stays and is still readable, marked as superseded on every screen that shows it. This is not caution for its own sake. A household may already hold the first version. A record that quietly becomes the corrected one cannot answer the only question that matters afterwards: what did they actually receive?

## 4. Screens

**4.1 The Reports tab** on the client record (`app/admin/reports/`, mounted in `ClientDrawer.tsx`, which is `client-record`'s — a change request, section 6). A table: reference, kind, coverage, status, signer, and whether it has been delivered. Superseded versions sit beneath the ones that replaced them.

**4.2 The draft editor.** One column, the report's own sections in order, the gathered figures shown as they will print and not editable — a figure a practitioner could retype is a figure that can disagree with the record. Beside them the fields only a person writes: the summary, what has moved, what the practice suggests next. A **preview of the exact PDF** before signing, and a confirmation saying in plain words what signing means: this becomes a document, it cannot be edited, a mistake is corrected by issuing a new version.

**4.3 View and deliver.** The filed PDF through a short-lived signed link, the delivery history beneath it, and **Send**, which offers only the contacts that may receive one (section 7.2). **Supersede** asks for a reason and shows the standing version beside the new one.

## 5. How a report becomes a PDF

The writer is good and nothing here is rewritten. There is one honest problem and it is a filing problem: the writer lives under `domain/billing`, and `OWNERSHIP.md` rule 3 forbids one module importing another module's `domain/`. So the byte-level half — `pdf.ts`, `truetype.ts`, `arabic.ts`, `extract.ts` and their tests — moves to `domain/shared/document`, with `model.ts`, `render.ts` and `strings.ts` staying with billing where the invoice's own wording belongs. `domain/billing/sending.ts` moves the same way, to `domain/shared/sending.ts`, its implementations following the routing seam's shape under `app/api/_middleware/`. That is a move of files and their tests, not a rewrite, and it is the trunk's to make **before this worktree opens** (section 10, decision 1).

The rendered PDF is a `document` of kind `report` — a kind `documentKinds.ts` already refuses to let anybody upload by hand, because the platform writes it. Ordinary retention: five years from filing. The bytes go through the seam with `overwrite` false, so a second rendering can never quietly replace the first. Filing is idempotent under a database function, as `app.file_billing_document` is, so a retried issue returns the first document rather than a second one bearing the same reference. Unlike an invoice, the `report` row carries its own `document_id`: the row is written at the moment of issue and the PDF is rendered in the same transaction, which is exactly the problem migration 407 had to invent a link table to work around.

**Both kinds share a frame:** the practice's identity block (legal name in English and Arabic, trade licence and authority, registered address), the client's name and record number, the reference and the date, the ribbon where the report has one, the signature block, and two standing sentences in both languages — that McWellness is a wellness provider and not a medical clinic, and that the report describes training and measurement and is not a diagnosis, in the consent's own words. **And, until the practice's lawyer has approved the wording, a third**: a visible line on every copy saying the wording is a draft, exactly as `docs/CONSENT` carries `status: draft` on every text a person signs today.

_The session report_ prints the visit date, the service, the practitioner, the duration, the goal area worked on, the ratings before and after side by side, the structured observations, the practitioner's short note and what to expect before the next visit. **It does not name the protocol's electrode sites, bands or thresholds.** That is the practice's own intellectual property and it means nothing to a household.

_The progress report_ prints the coverage period, sessions delivered against sessions entitled, each goal with what has moved, the brain-map comparison where two or more assessments exist — the same figures and the same "not a diagnosis" sentence the comparison view shows — the practitioner's summary and what the practice suggests next. Its cover figure is the **ribbon** of `docs/DESIGN-BRIEF.md` section 5: one slice per completed session, height the visit's `signal_quality_score`, colour the dominant trained band, a hairline at each brain map, empty slices for the sessions remaining. It is the one place hue enters a report, and it is drawn from the snapshot like everything else.

**Bilingual, and honestly so.** Headings, labels, the identity block and every fixed sentence render in English and Arabic together, as the invoice already does. The practitioner's own narrative renders in the locale chosen at issue, because a paragraph a person wrote is not something a renderer may translate. A household wanting both gets a second report of the same coverage in the other locale — a separate report, not a version, because neither supersedes the other.

## 6. Data owned

**`report`** (migration `600_report.sql`), as `00-data-model.md` section 4 defines it, plus the section 1 conventions, the tenant-bound key of migration 099, `comment on table ... 'audited: client'`, and these differences. Each is a **change request to `00-data-model.md`, written and not applied** (`docs/CHANGE-REQUESTS/reports-01.md`):

| Change | Why |
| --- | --- |
| `kind` gains `session` | Section 4 names `baseline`, `progress`, `completion` and `school`. The session report is one of this piece's two kinds and has no value to be. |
| `status` (`draft`, `issued`, `superseded`) | The one-way door needs a name. Immutability is enforced against `issued`, not against the row's mere existence. |
| `reference text`, `RPT-000001`, sequential per tenant, never reused | Something a household can quote. Allocated atomically server-side as the invoice number is, and saying on its own face that it is the practice's reference and **not** a tax number. |
| `signed_by_name`, `signed_by_certification`, `signed_by_certifying_body`, `signed_by_certificate_number`, and the practice identity columns beside them | The snapshots of section 3. |
| `content jsonb not null` | The structured body: the sections, the figures quoted, the assessment ids compared, the ribbon's slices, the narrative. What the PDF was rendered from, so it can be rendered again. Shape declared in `domain/reports/shapes/` and validated at the edge. |
| `delivered_to_contact_ids` and `delivered_at` dropped for **`report_delivery`** | A delivery is a fact that happens after issue, and an issued row is immutable, so writing a delivery onto it contradicts the rule the row exists to keep — the fault migration 407 found in `invoice.document_id`, seen early. The table carries `report_id`, `contact_id`, `channel`, `sent_at` and `sent_by`, with a composite key binding the contact to the report's own client. |
| **No foreign key to `session` or `assessment`** | Both live in ranges a 600 migration must not assume are on the database (`OWNERSHIP.md`). Their ids ride in the snapshot, where an absent table costs nothing — and where the snapshot rule wanted them anyway. |

**The erasure step.** A report is **deleted**, not anonymised: with the client's other documents, when a household asks to be erased. An invoice is kept five years because tax law requires it; nothing requires the practice to keep a report, and a report is the most personal document this platform produces. The existing erasure already deletes every client document except the invoice kinds held back by name, so the PDF goes without a change — but the row's own narrative, stored so the document can be re-rendered, must be cleared with it. That is a change request to `client-record` for a `107` migration guarded with `to_regclass`, and **it ships in the round that ships the first report**. Until it exists an erasure leaves a household's most personal document half-erased.

Three smaller requests: the drawer's tab mount point; the portal's Reports screen, which is `client-portal`'s to build (section 7.3); and the `reports` row in `OWNERSHIP.md`, which names no `db/policies/reports/**`.

## 7. Routes, delivery and the household

**7.1 Routes** (`app/api/reports/`, thin, calling `domain/reports`): `list` (a client's reports), `draft` (create or update a draft, gathering the visits, ratings, goals and brain-map comparison the practitioner is about to review), `issue` (the atomic sign-and-render of section 3), `get` (one report and a signed link, after `auditDocumentRead`), `supersede`, `deliver` and `schema`. `owner` and `lead_practitioner` may draft, sign, issue, supersede and deliver; a `practitioner` may draft for a client visible to them and sign only with the capability; `admin` reads and delivers and never drafts or signs; `finance` gets nothing, because a report is not money.

**7.2 Who may receive one.** Two gates that already exist, checked at the moment of sending and never cached: the client's `participation` consent must be active (`00-data-model.md` section 7 — sending a report to a contact checks a consent at that moment), and the contact's own `can_receive_reports` must be true, the flag the portal's Family screen already shows in words. WhatsApp needs `whatsapp_opt_in` on top, exactly as the billing hand-off checks it. Delivery is the seam's hand-off: the platform drafts the sentence in English with the Arabic beneath, composes a `wa.me` link carrying a short-lived signed link, and a person presses send in their own WhatsApp. Nothing reaches a vendor. The message carries the reference and the link and never says what the visit was about. Every delivery writes a `report_delivery` row and a `send` action carrying the contact's id and the channel — never the number, never the address.

**7.3 What the household sees.** Issued reports for their own client, and nothing else: never a draft, never a superseded version they were not sent, never another household's, never the electrode sites, never the raw assessment figures except as the report quotes them. On the portal a sixth screen lists them by reference, kind, coverage and date, each opening through the same short-lived audited link the money screen already uses for an invoice. That screen lives in `app/client/**`, which is `client-portal`'s; this spec says what it shows and that stream builds it.

## 8. Rules (pure functions in `domain/reports`, each tested) and audit

1. `canIssue(actor, credential, now)` — `can_sign_report` on a credential valid at that moment, and nothing else grants it: not a role, not the owner's seniority.
2. `validateContent(kind, content)` — the declared shape per kind, refused with the field named.
3. `gatherProgress(sessions, entitlements, goals, assessments, coverage)` — everything the draft quotes, pure, with the ribbon's slices among it.
4. `canSupersede(report, reason)` and `canDeliver(consent, contact, channel, now)` — the two refusals of sections 3 and 7.2.
5. `referenceFor(sequence)` — the printed form of the number the database allocated.

**Audit.** `audited: client` on both tables. Opening the tab is a `list`, opening a report a `read`, and every signed link goes through `auditDocumentRead` before it is signed. `report.issued` and `report.superseded` are sensitive actions carrying the reason. `content` holds a narrative, so the trail's 200-character rule and migration 904's descent into jsonb are what keep the words out of the log, while `changed_fields` still names what changed. Every refusal is written before the answer.

## 9. Deliberately left out

Templates the practice edits itself — the two are code and change by pull request until the practice asks otherwise. Automatic drafting of the narrative. Reports to insurers or a health authority; this practice has neither. Batch issue across a client list. Anything that reads a live table at render time. A rendering worker (section 2).

## 10. Decisions, with the defaults taken

1. _The writer's move._ Default (Claude's): the trunk moves the four byte-level files and the sending seam **before** this worktree opens. It is an afternoon of the trunk's time now and a duplicated font shaper is forever; two copies will drift.
2. _Deleting a report on erasure._ For the lawyer, through the operator. Default (Claude's): delete, as section 6 states. If the lawyer disagrees the change is small and known — the report joins the invoice kinds held back — but the default should be deletion and the practice should have to be told otherwise.
3. _A school report._ Default (Claude's): it may be written and issued, and delivered only to a contact of the client, who passes it on themselves, until a consent purpose covers sharing a child's measurements with an institution. The eight wordings do not cover it today. One for the lawyer's list beside the erasure letter.
4. _A tax number on a report._ Default (Claude's): none. A report is not a tax document; the identity block carries the legal name, the trade licence and the address. Printing a registration number on a document that needs none is how a corporate-tax number ends up read as a VAT number, which migration 905's own comments exist to prevent.
5. _A separate `report_version` table._ Default (Claude's): no. `report` already carries `version`, `supersedes_id` and `amendment_reason` exactly as `session`, `client_protocol` and `invoice` do; a second table would give two answers to "which version is current".
6. _Who may sign._ Default (Claude's): whoever holds a valid `can_sign_report` credential, which today is the founder alone. Nothing in the code assumes a single signer, and the practice grows into it by issuing a credential.

## 11. Done when

- Every function in `domain/reports` has tests covering each branch, including a credential that lapsed the day before signing and a supersede chain three versions deep.
- The deny cases pass: signing without the capability, and with a lapsed credential; `update` and `delete` on an issued row refused to the API role while a draft may still be updated, proved by the same grant; a supersede with no reason, and of a superseded version; a `client_contact` reading only issued reports for their own client; a practitioner off that client's schedule; another tenant on every route; delivery without a live consent, without `can_receive_reports`, and by WhatsApp without the opt-in; a delivery to another client's contact refused by the composite key; the audit row for a delivery carrying the contact id and no telephone number.
- Re-rendering an issued report from its stored `content` produces byte-identical output to the filed PDF — the proof that the snapshot rule actually holds.
- On staging, a synthetic client's progress report is drafted, signed, rendered in both languages with the ribbon and the brain-map comparison in it, filed, handed off, and read back on the portal by that household's own login.
- An erasure of that client leaves no report bytes and no narrative.
- `pnpm verify` and `pnpm test:db` green; one combined review and one re-check under `docs/HANDOVER.md` section 6, with the record posted.
