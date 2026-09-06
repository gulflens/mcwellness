# reports-01 — the shared-zone changes piece ten's reports stream needs

**Status.** Authorised by the integrator on 2026-09-06 and, under cost rule 6 of
`docs/HANDOVER.md` section 6 and the precedent of pieces seven and eight
(`client-portal-05.md`, `session-capture-04.md`), applied in the piece's own
pull request rather than a separate trunk round. The builder edits the paths
below for this piece only, and each edit is listed in the pull-request body
under "Shared-zone changes".

**Spec.** `docs/SPEC/reports-v1.md`, sections 3 to 8 and 11.

---

## What was edited, and why

1. **`docs/SPEC/OWNERSHIP.md`** — the `reports` row gains
   `db/policies/reports/**`, which every other stream's row already names and
   this one did not (the specification's section 6 calls the omission out
   itself). A widening note beside piece seven's records items 2 to 8 for this
   piece.

2. **`app/api/create-api.ts`** — `mountReports` after the authentication fence,
   in the group with `mountSessions` and `mountRouting`. **No raw body**: a
   report is rendered by the server, so nothing in the group ever reads bytes a
   caller uploaded and the piece needs no exemption from the body cap or from
   `jsonOnly`. `tests/db/route-mounts.test.ts` gains two cases so a future edit
   that drops the mount fails loudly rather than falling to the catch-all 404.

3. **`app/admin/clients/ClientDrawer.tsx`** (client-record's) — the Reports
   tab's mount point: one entry in `ALL_TABS`, one `TabPanel`, one import.
   Nothing else in that file moves.

4. **`app/client/**` and `app/api/portal/**`** (client-portal's) — the
   household's sixth screen, exactly as the specification's section 7.3
   describes it. `app/api/portal/reports.ts` (new) answers the list and a
   short-lived audited link, `app/api/portal/schema.ts` gains `PortalReport`
   and `PortalReportsResponse`, `app/api/portal/mount.ts` mounts it,
   `app/client/ReportsScreen.tsx` (new) is the screen,
   `app/client/PortalRoot.tsx` gains the sixth tab,
   `app/client/i18n/dictionary.ts` gains its words in both languages, and
   `app/shell/App.tsx` gains the route.
   The plan page gives this screen to the portal stream; the integrator gives
   it to this build because nobody else is in that worktree.

   The screen deliberately shows **every client on the record**, not only the
   ones money is shown for. A young person's own login sees no money screen
   because a balance is the household's business; their own report is not the
   same kind of thing, and section 7.3 says "issued reports for their own
   client" without that narrowing. The consent and `can_receive_reports` govern
   what the practice *sends*; this is the household reading its own record.

5. **`db/migrations/107_erase_report.sql`** (client-record's range) —
   `app.erase_client` extended under a `to_regclass('public.report')` guard
   exactly as 105 guards the visit tables. The deliveries go first (they name
   the report by a foreign key), then the narrative inside `content` and the
   amendment reason are cleared, then `document_id` is unlinked so step 6's
   delete of the client's documents does not abort on the foreign key — the
   same fault 105 found on `session.setup_photo_document_id`. The `report` kind
   is deliberately **not** added to the invoice kinds held back, so the PDF goes
   with the household's other documents. The summary gains `reportsCleared` and
   `reportDeliveriesDeleted`.

   **`domain/client/erasureLetter.ts`** gains `REPORTS_ERASED_SENTENCE` in both
   languages and fills a `{{reports_erased}}` placeholder with it, and — in the
   fix round, under the integrator's decision — **both templates in
   `docs/CONSENT/erasure-letter/` now carry that placeholder**, in the
   paragraph that already covers the sessions and the brain maps. Both go to
   `0.4-draft` and keep `status: draft`, as every consent text does until the
   lawyer approves it. Request R2 below is therefore answered rather than
   outstanding: a sentence filled correctly into a template nobody sends says
   nothing, and the review was right that the pull-request body claimed a
   letter the household would not have received.

6. **`db/seed/**` — not edited, and here is why.** The brief asked for one
   issued progress report for one synthetic client, *rendered through the real
   writer at seed time only if the seed already renders invoices that way*. It
   does not: `db/seed/apply.ts` writes rows, and the only bytes the seed puts in
   a store are the consent wording files (`db/seed/wording-upload.ts`), which
   are markdown read off disk rather than anything the document writer produced.
   Seeding a report row without its PDF would put a signed document in the
   synthetic practice that cannot be opened, and seeding one with a PDF would
   mean the seed importing the renderer and the font loader — a new dependency
   in the shared zone for a fixture. So **no report is seeded**, and the staging
   pass writes the first one through the app, which is also the only way the
   issuing path gets exercised end to end.

7. **`domain/shared/audit-narrative.ts`** and its test — sentences for
   `report.issued`, `report.superseded`, the delivery (`send`) and the reads, in
   both languages, plus the three refusals. `report_delivery` takes the generic
   fallback on purpose: a row saying which contact was sent which report is read
   through the report's own sentences, and the `send` action says it properly.
   The delivery's sentence names the channel and never the contact, the number
   or the address.

8. **`domain/shared/actor.ts`** and its test — five actions the routes name:
   `report.list` and `report.read` (the four practice roles that are not
   finance, and a contact for their own client), `report.draft` (owner, lead
   practitioner, practitioner), `report.supersede` (owner and lead
   practitioner alone) and `report.deliver` (owner, admin, lead practitioner).
   **`report.sign` is not touched and not used**: signing is decided by
   `canIssue` in `domain/reports`, which reads a credential rather than a
   role, because nothing else grants it (section 10, decision 6).

   `report.supersede` is narrower than `report.draft` on purpose, and was
   added in the fix round after the review found a practitioner could replace
   a signed report. Superseding is not writing: it hides a version the
   household may already be holding, which section 7.1 gives to the owner and
   the lead practitioner. The guard trigger's branch (b) in migration 600 asks
   the same question at the row, which is the boundary; the route asking is
   the courtesy.

9. **`db/migrations/601_report_delivery.sql`, the `contact` unique key** —
   `alter table public.contact add constraint contact_tenant_id_client_key
   unique (tenant_id, id, client_id)`. `contact` is a core table, so this is
   recorded here as an edit rather than as a footnote, **and the integrator's
   decision is that it stays in 601**.

   Why it exists: the specification's section 6 asks for a composite key
   "binding the contact to the report's own client", and section 11 requires a
   deny test proving a delivery to another client's contact is refused by that
   key. A foreign key needs its target combination declared unique, and
   migration 099 gave every core table `(tenant_id, id)` for exactly this
   purpose; the client-scoped form was not needed until now. `invoice` declares
   the same key for the same reason (`invoice_tenant_id_client_key`, migration
   402). The constraint is additive and cannot fail: `id` is already the
   primary key, so `(tenant_id, id, client_id)` is a superset of a key that
   already holds.

   Why it does **not** move to a `9xx` trunk migration, which was the obvious
   tidier home for it. `checkNeeds` refuses a `Needs` naming a number at or
   above the file's own, and the runner applies pending files in numeric order.
   On a fresh database a `9xx` key would therefore be created *after* 601 had
   already run, and 601's foreign key — which references that combination —
   would fail. The only number 601 could name is one below it, a client-record
   `108`, which is still a stream file altering a core table and buys nothing.
   The alternative that touches no core table is a before-insert trigger
   comparing `contact.client_id`, which the specification's own words argue
   against: it says the delivery is "refused by the composite key".

---

## Requests, not edits

These are written here and **not applied**. Nothing in this piece depends on
any of them; each is noted where the code would otherwise be wrong to be
silent.

**R1. `docs/SPEC/00-data-model.md` section 4, the `report` entity.** The
specification's section 6 lists the column differences and says they are a
change request written and not applied. They are, in the order that section
lists them:

| Change | Why |
|---|---|
| `kind` gains `session` | Section 4 names `baseline`, `progress`, `completion` and `school`. The session report is one of this piece's two kinds and had no value to be. The migration ships `report_kind` as `('session', 'progress')` — the other three are not written by anything, and naming them would reserve places for documents nobody has specified. |
| `status` (`draft`, `issued`, `superseded`) | The one-way door needs a name. Immutability is enforced against `issued`, not against the row's mere existence. |
| `reference text`, `RPT-000001`, sequential per practice, never reused | Something a household can quote, allocated atomically as the invoice number is, and generated from `number` so the two can never drift. |
| `signed_by_name`, `signed_by_certification`, `signed_by_certifying_body`, `signed_by_certificate_number`, and five practice identity columns beside them | The snapshots of section 3. |
| `recipient_name` and `recipient_record_number` | The block that says who the report was written for, snapshotted at issue like every other block on the row. Added in the fix round: the first build read the client row live at render, and the review was right that section 9 rules it out. Read live, the byte-identical re-render held only until somebody corrected the spelling of a child's name — after which the repair path refused that document for ever, because bytes rendered from this year's name can never match the ones that were filed. |
| `content jsonb not null` | What the PDF was rendered from, so it can be rendered again. |
| `delivered_to_contact_ids` and `delivered_at` dropped for `report_delivery` | A delivery happens after issue and an issued row is immutable. |
| No foreign key to `session` or `assessment` | Both live in ranges a 600 migration must not assume are present. |

**R2. `docs/CONSENT/erasure-letter/en.md` and `ar.md`** — **answered, not
outstanding.** Both templates now carry `{{reports_erased}}` where the letter
lists what has gone, so the sentence in `domain/client/erasureLetter.ts` reaches
a household. The letter's existing sentence ("every document and file on your
record are gone") was true of a report already, so nothing a household read was
wrong; the new sentence says the second half — that the words inside the report
went with the file — which the letter could not say. The files are the
practice's own wording and stay `status: draft` pending the lawyer's approval;
the sentence is on the lawyer's list beside the erasure decision itself.

**R3. `domain/shared/document/pdf.ts`** — a colour operator, so the printed
ribbon can carry the band's hue.

The design brief's section 5 gives the ribbon one hue per band and calls it "the
one place hue enters a report", and section 3.1 gives the five hexes. The shared
writer sets type and strokes rules in **greyscale only** — `Style.grey` and the
rule's own `grey`, both a single number — and it has no operator for an RGB
fill. `domain/shared/document` is the shared zone this worktree may not edit, so
the printed strip carries the whole of the figure's *shape* — a slice per
session at the height of its recording's quality, a hairline at each brain map,
empty slices for the sessions ahead — in ink, and **names no band at all**. The
first build printed "Bands trained: Theta, Alpha" underneath the strip; the fix
round dropped it, because the design brief admits a band only as the slice's own
hue and the specification keeps band names off a report, so the line put a fact
on the page the specification keeps off it and read as a legend for a colour
nothing had drawn. The console's own ribbon carries the hue from the tokens, so
nothing is lost on screen.

What the trunk would need to add: an optional `rgb` on `Style` and on the rule
op, written as `r g b RG` / `r g b rg` in the content stream beside the existing
`g` / `G`, defaulting to the grey path when absent so every document already
filed renders to the same bytes. Small, and not this stream's to make.

**R4. A note wherever the platform's read audiences are summarised.** Finance
reads every other client-scoped table in this platform and reads **no** report
(the specification's section 7.1: "finance gets nothing, because a report is not
money"). That is implemented in `db/policies/reports/reports.sql` and is worth
a line beside the other audiences, so the absence reads as a decision rather
than as a policy somebody forgot to widen.
