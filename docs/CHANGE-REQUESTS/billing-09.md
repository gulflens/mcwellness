# billing-09: what the document-design round edits outside billing's paths

The round that puts the practice's own design onto its invoice and its receipt
(`docs/SPEC/billing.md` section 5.6, the operator's design of 8 September 2026)
needed four capabilities the platform did not have, and three of them live in
the shared zone: the PDF writer could not draw an image, nothing could read a
PNG into the shape a PDF embeds, the storage seam could write bytes but not
read them back, and the practice had nowhere to record a telephone number, an
email address or a website.

Every one of them is listed below. Nothing here is a request of another stream:
each item is a change this round has already made, recorded because `CLAUDE.md`
rule 10 says a shared-zone change is written down, and riding in this round's
own pull request by the integrator's widening and the precedent of pieces seven
to ten.

---

## 1. `domain/shared/document/pdf.ts` and `pdf.test.ts` — the writer draws an image

**What.** Three additions to the writer, and nothing removed.

- `DocumentImage` and `ImageSet`: a bitmap as `{ width, height, colours, data }`
  where `data` is a PNG's own zlib-deflated, predictor-prefixed scanlines.
- A third member of `Op`: `{ kind: 'image', image, x, y, width, height }`, drawn
  as `q <w> 0 0 <h> <x> <y> cm /Im1 Do Q` inside its own `q`/`Q`.
- `renderPdf` takes a fourth, optional argument, the images a page may draw.
- The `rule` op gains an optional `dy`, so a rule runs from where it starts to
  where its rise puts it. That is what makes the totals box's two sides
  possible: the writer strokes lines and fills nothing.

**Why it could not wait for a trunk round.** The design's first element is the
practice's logo, and there was no way to put a picture on a page at all. It is
also the change with the least surface: an image object, one content operator
and one resource key.

**Why no image library.** A PNG's `IDAT` stream is exactly what PDF's
`/FlateDecode` with `/Predictor 15` consumes, so the bytes go in untouched.
`package.json` is the shared zone, and a dependency on the one path that
renders a household's financial record is a standing supply-chain surface;
about a hundred lines of well-understood file format is the smaller thing to
own, which is the same argument the writer itself was built on.

**What did not change.** A page that draws no image renders to **exactly** the
bytes it did before: the image objects are numbered after the faces, the
`/XObject` key is absent entirely when nothing is drawn, and a rule with no
rise writes the operator it always wrote. `pdf.test.ts` holds the greyscale
content stream from before the colour operator existed and still asserts it
verbatim, and two new tests assert the two absences directly.

---

## 2. `domain/shared/document/png.ts` and `png.test.ts` — new

**What.** `readPng(bytes): DocumentImage`. It checks the signature, reads
`IHDR`, concatenates every `IDAT` in order, ignores every ancillary chunk, and
throws a `RangeError` naming the reason for anything it cannot embed: a file
that is not a PNG, a bit depth other than eight, a palette, an alpha channel,
an interlaced image, a truncated file.

**Why here rather than in billing.** It is the other half of item 1 and knows
nothing about money: it turns a file format into the writer's own type. The
reports stream renders documents too, and `docs/SPEC/OWNERSHIP.md` rule 3
forbids it importing billing's `domain/`.

**Purity.** It opens nothing and reads no clock. The bytes arrive as an
argument, exactly as the font programs do.

---

## 3. `domain/shared/storage.ts` and `app/api/_middleware/storage/**` — the seam reads back

**What.** `StorageProvider` gains `get(key): Promise<Uint8Array | null>`.

- `local-disk.ts`: the private `read` **becomes** `get`. There are not two
  names for one thing.
- `supabase.ts`: `get` downloads the object; a missing one answers null in both
  the shapes the vendor spells it (a 404 and a 400 carrying `NoSuchKey`, the
  pair `exists` already knows about), and anything else raises
  `StorageUnavailableError` exactly as its other calls do — so a bucket that is
  down still reads as a 503 and never as a bug in the document.
- `types.ts`: `LocalOnly` loses `read`, because reading is no longer local-only.
- `index.ts`: the local storage route calls `get`.
- `seam.test.ts` and `local-disk.test.ts`: the rename, and five tests for the
  new method on both implementations.
- `docs/SEAMS.md`: the seam is normative there, so its list is now five calls
  rather than four, and it says why `get` sits outside the audit rule that
  governs `getSignedUrl` — a server-side read hands nobody anything, so there
  is no read to attribute and no actor to name.

**Why it could not wait.** The practice's logo is a `document` row whose bytes
are in the store. The seam could write them, sign a link to them, ask whether
they were there and remove them — everything but hand them back to the server
that filed them.

**Callers moved by the rename**, all of them mechanical: `db/seed/index.ts`,
`tests/db/wording-upload.test.ts`, `tests/reports/db/reports.test.ts` and
`tests/billing/db/documents.test.ts`.

---

## 4. `db/migrations/912_practice_contact.sql` — new, the trunk's first half

**What.** `tenant` gains `contact_phone`, `contact_email` and `website`, each
nullable, each with a light check and a column comment saying it is printed on
the practice's documents.

**Why the first half of the trunk's range.** `tenant` is a core table, so a
migration that alters it is the trunk's and belongs in 900–949
(`docs/SPEC/OWNERSHIP.md`).

**Why they are new columns at all.** The operator's design ends every page with
the practice's telephone number, email address and website, and the practice
had nowhere to record any of the three. `tenant.whatsapp_number` (910) is a
different fact: it is where a **household** messages, and this is where a
reader of an invoice rings.

**Why the checks are light.** They catch an address typed into the website and
a sentence typed into the telephone, and they decide nothing about what a
reachable site or a deliverable address is. A constraint that refused a real
number because of a country's punctuation would stop the practice printing its
own footer.

---

## 5. `db/migrations/959_invoice_supplier_contact.sql` — new, the trunk's second half

**What.** `invoice` gains `supplier_contact_phone`, `supplier_contact_email`
and `supplier_website`, and `app.stamp_invoice_supplier` is replaced whole so
it copies the three at numbering time, in the shape it already copies the legal
name and the address. A value already supplied is left alone, so a correction
can still pass its own snapshot in. 905's own text is written out in the
`-- rollback:` block, because `create or replace` has no undo.

**Why the second half.** It alters `invoice`, a stream's own table, so it must
sort last.

**Why snapshotted.** Everything a document says about the supplier comes off
the invoice's own columns and never off the live `tenant` row (402, 905,
`docs/CHANGE-REQUESTS/trunk-notes.md` round 20 request 1c). A footer is no
different from a legal name: an invoice issued last year must keep saying the
number the practice answered on last year.

**No check constraints on the three.** `tenant` checks them where a person
types them; an invoice copies what was there. A constraint here would refuse to
number an invoice for a practice whose footer has a typo in it — a charge the
family still owes and a visit that has already happened.

---

## 6. `app/api/practice/schema.ts` and `routes.ts` — the three fields on the practice route

**What.** `Practice` answers `contactPhone`, `contactEmail` and `website`, and
`UpdatePracticeInput` accepts them. They are the **only optional fields on that
form**, and the update coalesces each against what is already there.

**Why optional, when the rest of the form is not.** That form is saved whole on
purpose — the VAT switch and its number have to arrive together or the pair can
be left half-recorded. But the settings screen cannot show these three yet, so
a save it sends must leave them exactly as they are rather than clearing three
columns nobody saw. `tests/db/practice.test.ts` proves both directions.

**Why the route at all.** `scripts/practice-brand.mjs` (item 7) sets them, and
it goes through the API rather than the database so every rule that guards
these facts — an owner or an admin only, the `X-Reason` header, the audit trail
— is the one the practice's own screens obey.

> **For the trunk.** The practice settings screen still cannot edit the three
> contact fields. It **can** already replace the logo
> (`app/admin/settings/PracticeLogo.tsx`, `app/api/practice/logo.ts`, migration
> 909), which is why this round built no route of its own for it. Putting three
> text fields on that page is a later trunk round; until it happens, the script
> of item 7 is how the footer is set. The API is ready for it: the fields are
> on `Practice` and on `UpdatePracticeInput` already, and the round that puts
> them on the screen should make them required there like every other field on
> the form.

---

## 7. `scripts/practice-brand.mjs` — new, and `docs/RUNBOOK/go-live.md`

**What.** A small script the integrator runs against an environment: it takes a
base URL, a bearer token and optionally a logo file and any of `--phone`,
`--email` and `--website`. It files the logo through `POST /api/practice/logo`
and reads the practice back before sending the whole form to
`PATCH /api/practice` with the three fields changed, exactly as the settings
screen does. It prints what it did and prints no secret.

`docs/RUNBOOK/go-live.md` gains section 4a, which is where that command lives
and where the two consequences of the design are written down for the operator:
documents already filed keep the mark they were filed with, and the contact
details are snapshotted like every other supplier fact.

---

## 8. Five files in other streams' tests, moved by a type

**`tests/reports/document.test.ts`.** One filter learns that the writer's `Op`
now has a third member; a report draws no image, and an image carries no colour
of its own. No assertion changed.

**`tests/reports/db/reports.test.ts`** and **`tests/db/wording-upload.test.ts`.**
The `read` → `get` rename of item 3, and one `Buffer.from` where the seam now
declares `Uint8Array`.

**`app/admin/settings/PracticePage.test.tsx`** and **`app/shell/App.test.tsx`.**
Three nulls each, on the synthetic practice those two mount the settings screen
with: `Practice` now answers `contactPhone`, `contactEmail` and `website`, and
the screen parses what it is given. Neither screen changed, and neither can
edit the three.

---

## 9. `docs/SPEC/00-data-model.md` section 6

One sentence: `tenant` carries the practice's contact details and `invoice`
snapshots them.

---

## What this round deliberately did **not** do

- **It built no `POST /api/billing/practice-logo`.** The plan named one; the
  route already existed as `POST /api/practice/logo` (migration 909's own
  door, owner and admin only, one row per practice, the bytes through the
  seam). A second door onto a one-row table would have been a rule with two
  homes. Billing's half is the **read**: `practiceLogo` in
  `app/api/billing/document-source.ts`, which is inside billing's paths.
- **It changed nothing about what a document claims.** While the practice is
  unregistered the heading is "Invoice", there is no VAT column, no VAT line
  and no VAT registration number, and the fifteen-digit corporate-tax number
  keeps its own label on both sides of the supplier block. `chargesVat` still
  decides every one of those from the document's own snapshot, and
  `tests/billing/document.test.ts` proves both directions.
- **It touched no policy file.** Nothing this round decided is row security's
  to enforce: the logo's audience is migration 909's function and
  `db/policies/client/writers.sql`, both unchanged, and the three contact
  columns are governed by `app.guard_tenant_identity` (905), which is a
  before-update trigger on the whole `tenant` row.
- **It built no Date / Method / Amount table on the receipt.** The design has
  one; a receipt records a single payment, so its four facts stack as grey
  lines under its reference instead, and the receipt leaves the corporate-tax
  registration off its supplier block as the design does. Both are written
  down in `docs/SPEC/billing.md` section 5.6.
- **It touched no seed generator.** The three contact columns are nullable and
  the seeded practice records none of them, which is a case the footer band
  already renders correctly and which `tests/billing/document.test.ts` asserts.
