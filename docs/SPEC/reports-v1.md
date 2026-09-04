# SPEC — Session and progress reports

*Worktree: `reports`. Entities: `report` and a new `report_delivery`, reading `client`, `session`, `assessment`, `document`, `credential` and the practice identity from `00-data-model.md`. Migrations `600–699`. Behaviour first in plain language; the builder's detail is section 10.*

---

## 1. What a report is, in plain language

A report is the practice speaking to a household in writing, with a practitioner's name on it.

There are two kinds in this first version.

**A session report** follows one visit. What was delivered, on what date, by whom, how the client was before and after, what the practitioner observed, and what to expect before the next visit. It is short. Most households will never ask for one, and the practice will send one when the visit was notable or when a parent asks what happened.

**A progress report** covers a stretch of a programme — a package, a quarter, the whole of it. Sessions delivered against sessions bought, the goals the client set and what has moved, the practitioner's summary, and, where the client has had more than one brain map, the comparison between them. This is the document the practice's work is judged by, and it is the one the household keeps.

Both are the same kind of object and follow the same rules, which are these three:

**A report is signed by a person.** Not by the practice, not by the platform — by a named practitioner whose credential says they may sign one (`can_sign_report`, `00-data-model.md` section 2). The signature is what turns a draft into a document.

**Once signed, it never changes.** If something in it is wrong, the practitioner issues a new version that supersedes the old one and says why. Both stay. Nobody edits an issued report, and the platform gives nobody a way to.

**It is a PDF, filed like every other document.** Rendered by the same writer that renders the practice's invoices and receipts, filed against the client with a retention date, and delivered by the same hand-off the practice already uses for an invoice.

## 2. Who uses it

| Role | Can |
|---|---|
| `owner` | Everything, including signing where a credential says so |
| `lead_practitioner` | Draft, sign, issue, supersede, deliver |
| `practitioner` | Draft a report for a client on their own schedule; sign one only if their credential says `can_sign_report`; never supersede another practitioner's |
| `admin` | Read issued reports; deliver one; never draft, never sign |
| `finance` | Nothing. A report is not money |
| `client_contact` | Read the reports issued to their own client, and only issued ones (portal, piece seven) |

## 3. Signing

Drafting is ordinary work: a practitioner opens a draft, the platform fills in everything it already knows — the visits, the ratings, the goals, the brain-map comparison — and the practitioner writes the parts only a person can write.

Signing is a one-way door. The platform checks the credential again at that moment, against its validity dates, and refuses with a plain sentence if the credential has lapsed. Then it writes onto the report **what was true at signing**: the signer's name, their certification, the certifying body and the certificate number. It does not point at the credential row and read it later. A credential expires, gets renewed, gets corrected; a report issued in March must still say who signed it in March and on what authority, five years later. This is the same snapshot the practice's identity block already gets on an invoice.

## 4. Issued means immutable

An issued report cannot be edited, withdrawn or deleted. A correction is a new version: same client, same coverage, a new PDF, `supersedes_id` pointing at the old one, and a required reason. The superseded version stays and is still readable, marked as superseded on every screen that shows it.

This is not caution for its own sake. A household may have been given the first version before the mistake was found. A record that quietly becomes the corrected version, with no trace of what was actually sent, is a record that cannot answer the only question that matters afterwards: what did they receive?

## 5. How a report becomes a PDF

The practice already has a PDF writer, and it is a good one: `domain/billing/document`. It lays out a bilingual page, shapes Arabic properly, embeds the fonts, and is pure — the same document renders to the same bytes years later, because nothing in it reads a clock or a database. Reports use it. Nothing here is rewritten.

There is one honest problem, and it is a filing problem rather than a technical one. The writer lives under `domain/billing`, and `OWNERSHIP.md` rule 3 forbids one module importing another module's `domain/`. So the byte-level part of the writer — the page renderer, the font reader, the Arabic shaper — belongs in `domain/shared/document`, with the invoice's own model, layout and wording staying with billing where they belong. That is a move of three files and their tests, not a rewrite, and it is the trunk's to make.

*Decision for the operator:* whether to make that move before the reports worktree opens, or let it start by copying. **Recommendation:** move it first. It is an afternoon of the trunk's time now and a duplicated renderer forever otherwise, and two copies of a font shaper will drift.

## 6. Filing and retention

The rendered PDF is a `document` of kind `report` — a kind that already exists and that `domain/client/documentKinds.ts` already refuses to let anyone upload by hand, because the platform writes it. It gets the ordinary retention: five years from the day it was filed. The bytes go through the storage seam with `overwrite` false, so a second rendering of the same report can never quietly replace the first.

Unlike an invoice, the report row itself can carry its `document_id`, because the row is written at the moment it is issued and the PDF is rendered in the same transaction. Migration 407 had to invent a link table for invoices precisely because the invoice row already existed and could not be updated; that problem does not arise here.

## 7. Delivering it

Through the sending seam (`docs/SEAMS.md`), which today means the practice's own hand-off: the platform drafts the sentence in English with the Arabic beneath it, composes a `wa.me` link carrying a short-lived signed link to the file, and a person presses send in their own WhatsApp. Nothing reaches a vendor, no family's contact details leave this server, and the message never says what the visit was about.

When the client portal arrives (piece seven), an issued report appears on the household's own screen and the hand-off becomes the second route rather than the only one.

Every delivery is recorded: which report, which contact, which channel, when, by whom. The audit trail carries the contact's id and the channel and nothing else — never the number, never the address — exactly as the invoice hand-off already does.

## 8. What an erasure does

**A report is deleted.** Not anonymised, not held back: deleted, with the client's other documents, when a household asks to be erased.

An invoice is kept for five years because tax law requires the practice to keep it. Nothing requires the practice to keep a report. A report is clinical-style content about a named person — what they said, how they seemed, what the practitioner made of their brain map — and it is the single most personal document this platform produces. Keeping it after an erasure would make the erasure a fiction.

The existing erasure already deletes every client document except the invoices held back by name, so the PDF goes without a change. What does not go is the report row's own content: the narrative the practitioner wrote is stored on the row so it can be re-rendered, and it must be cleared with the rest.

*Decision for the lawyer, through the operator:* confirm that reports carry no retention obligation of their own before the first erasure. **Recommendation:** delete, as stated. If the lawyer disagrees, the change is small and known — the report joins the invoice kinds held back in the erasure function — but the default should be deletion and the practice should have to be told otherwise.

## 9. The rules

**9.1 Draft, issued, superseded**, and no other states. A draft is editable in place and belongs to whoever is writing it. Issuing is atomic: check the credential, snapshot the signer, render the PDF, file the document, write the row. Superseding requires a reason and may only target the current version.

**9.2 Credential gates signing**, re-checked at the moment of signing, never trusted from a page load. `can_sign_report` on a valid credential, and nothing else grants it — not a role, not the owner's seniority.

**9.3 Consent gates delivery.** Sending a report to a contact checks a live consent at that moment (`00-data-model.md` section 7). Sending it anywhere outside the household is a different question, in 10.5.

**9.4 Snapshots, never joins.** The signer's details, the practice's identity block, the figures the report quotes, the assessment comparison it prints: all copied onto the report at issue. A report must render identically in five years with every setting behind it changed. Nothing in a report reads a live table to display itself.

**9.5 Append-only in the database.** No `update`, no `delete` for the API role on an issued row. A draft is the exception and is marked as one by its status; the grant that allows editing a draft is written to exclude any row that has been signed.

**9.6 One sentence never leaves.** Every report carries, in English and Arabic, the practice's own standing wording: McWellness is a wellness provider, not a medical clinic; this report describes training and measurement and is not a diagnosis. Same words as the consent, taken from the same place, so the two can never drift.

---

## 10. Builder notes

**10.1 The tables.** `00-data-model.md` section 4 defines `report` as `client_id`, `kind`, `covers_from`, `covers_to`, `authored_by`, `reviewed_by`, `signed_by`, `signed_at`, `document_id`, `locale`, `version`, `supersedes_id`, `amendment_reason`, `delivered_to_contact_ids`, `delivered_at`. Built as written, plus the section 1 conventions, with these changes:

| Change | Why |
|---|---|
| `kind` gains `session` | Section 4 names `baseline`, `progress`, `completion`, `school`. The session report is the second of this piece's two kinds and has no value to be. A change request amends section 4 in the same round. |
| `status` (`draft`, `issued`, `superseded`) | The one-way door needs a name. Immutability is enforced against `issued`, not against the row's mere existence. |
| `reference text`, `RPT-000001` per tenant | Something for a household to quote in a message. Allocated the way `mrn.next` allocates: sequential per tenant, never reused. **Not** a legal sequence — an invoice number is a regulatory obligation and this is a convenience. |
| `signed_by_name`, `signed_by_certification`, `signed_by_certifying_body`, `signed_by_certificate_number` | The signing snapshot of section 3. |
| `content jsonb not null` | The structured body: the sections, the figures quoted, the assessment ids compared, the practitioner's narrative. What the PDF was rendered from, so it can be rendered again. Shape declared in `domain/reports/shapes/` and validated at the edge. |
| `delivered_to_contact_ids` and `delivered_at` dropped; `report_delivery` added | A delivery is a fact that happens after issue, and an issued row is immutable, so writing a delivery onto it contradicts the rule the row exists to keep. This is the fault migration 407 found in `invoice.document_id`, seen early. `report_delivery` carries `report_id`, `contact_id`, `channel`, `sent_at`, `sent_by`, with a composite key binding the contact to the report's own client. |

*Decision for the operator:* whether to add a separate `report_version` table. **Recommendation:** no. `report` already carries `version`, `supersedes_id` and `amendment_reason`, exactly as `session`, `client_protocol` and `invoice` do; a second table would give two answers to "which version is current" and the platform has been consistent about this everywhere else.

**10.2 Migrations.** `600–699`, confirmed against `OWNERSHIP.md`'s Stage 2 table, which already carries the `reports` row; that file needs no change for this worktree to open. Expect `600_report.sql`, `601_report_delivery.sql`, `602_report_policies.sql`. Note that `report.client_id` and the assessment ids in `content` are the only links out; there is deliberately no foreign key to `session` or `assessment` on the row itself, for the reason `assessment.md` gives — a 600 migration must not assume the 300 or 500 ranges are on the database. The ids are carried in the snapshot, where an absent table costs nothing.

**10.3 Routes** under `app/api/reports/`, thin, calling `domain/reports`:

`list.ts` (reports for a client), `draft.ts` (create or update a draft, gathering the visits, ratings, goals and assessment comparison the practitioner is about to review), `issue.ts` (the atomic sign-and-render of 9.1), `get.ts` (one report with a signed link to its PDF, after `auditDocumentRead`), `supersede.ts`, `deliver.ts` (the sending seam and a `report_delivery` row), and `schema.ts`.

**10.4 Screens.** A **Reports tab** on the client record listing every report with its kind, coverage, status and signer, superseded versions beneath the ones that replaced them. From it: **issue** (the draft editor, with a preview of the exact PDF before signing and a confirmation that names what signing means), **view** (the PDF and its delivery history), and **supersede** (reason required, the old version shown beside the new). Components live in `app/admin/reports/**`; the mount point in `ClientDrawer.tsx` is `client-record`'s and arrives as a change request. Rendering runs in a `jobs/reports/` worker when a report is large, with the route rendering directly when it is not — the same split billing uses.

**10.5 What the templates contain.** Both kinds share a frame: the practice identity block (legal name in English and Arabic, trade licence, address, and the tax registration number only while the practice is registered — the switch migration 950 already owns), the client's name and MRN, the report's reference and date, the signature block, and the standing sentence of rule 9.6.

*The session report:* the visit date, the service, the practitioner, the duration, the goal area worked on, the pre-session and post-session ratings side by side, the structured observations, the practitioner's short note, and what to expect before the next visit. **It does not name the protocol's electrode sites, bands or thresholds.** That is the practice's own intellectual property and it means nothing to a household.

*The progress report:* the coverage period, sessions delivered against sessions entitled, each goal with what has moved, the brain-map comparison where two or more assessments exist (the same figures and the same "not a diagnosis" sentence the comparison view shows), the practitioner's summary, and what the practice recommends next.

**Bilingual, and honestly so.** Headings, labels, the identity block and every fixed sentence render in English and Arabic together, as the invoice already does. The practitioner's own narrative renders in the locale chosen at issue, because a paragraph a person wrote is not something a renderer may translate. If a household wants both, the practice issues a second report with the same coverage in the other locale — a separate report, not a version, because neither supersedes the other.

*Decision for the operator:* whether a `school` report — one written for a child's school rather than for the family — needs its own consent purpose before it may be delivered anywhere. **Recommendation:** yes, and until that purpose exists a school report may be written and issued but delivered only to a contact of the client, who passes it on themselves. Sharing a child's measurements with an institution is a different act from giving a parent a document, and the eight consent wordings do not currently cover it. This is one for the lawyer's list alongside the erasure letter.

**10.6 Tests, and the deny cases they prove.** Under `tests/reports/`, database tests under `tests/reports/db/`.

1. A practitioner without `can_sign_report`, and one whose credential expired yesterday, are both refused at signing with the reason named.
2. `update` and `delete` on an issued report are refused to the API role; a draft may be updated and an issued row may not, proved by the same grant.
3. A supersede without a reason, and a supersede of an already-superseded version, are refused.
4. A `client_contact` reads only issued reports for their own client, never a draft, never another household's — the deny case that matters most.
5. A practitioner not on that client's schedule cannot read or draft.
6. Another tenant's user sees nothing, on every route.
7. Delivery without a live consent is refused; a delivery to a contact of a different client is refused by the composite key.
8. The audit row for a delivery carries the contact id and the channel and no telephone number.
9. Re-rendering an issued report from its stored `content` produces byte-identical output to the filed PDF — the proof that section 9.4's snapshot rule actually holds.
10. After an erasure, the report's PDF is gone from the store and the row's narrative is cleared.

**10.7 What this worktree owes the trunk.** Four change requests: the drawer tab mount point; the amendment to `00-data-model.md` section 4 for 10.1's columns; the move of the PDF writer's byte-level files to `domain/shared/document` and the sending seam beside them (section 5); and the erasure step that clears an issued report's narrative, guarded with `to_regclass` as migration 105 guards the visit tables. **The last of these ships in the same round as the first report, not later.** Until it exists, an erasure leaves a household's most personal document half-erased, and shipping the report first would be shipping that gap on purpose.

## 11. Out of scope

Report templates the practice edits itself — the two templates are code and change by pull request until the practice asks otherwise. Automatic drafting of the narrative. Reports to insurers or to a health authority; this practice has neither. Batch issue across a client list. Anything that reads a live table at render time.

## 12. Done when

- Every function in `domain/reports` has tests covering each branch, including a lapsed credential at the moment of signing and a supersede chain three versions deep.
- On staging, a synthetic client's progress report is drafted, signed, rendered bilingually with the brain-map comparison in it, filed, and handed off — and the second rendering of it is byte-identical to the first.
- All ten deny cases in 10.6 pass.
- An erasure of that client leaves no report bytes and no narrative.
- `pnpm verify` green; the combined review passes.
