# The money documents, in the practice's own design: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Tests before implementation for everything in `domain/`.

**Goal:** The rendered invoice and receipt match the design the operator supplied on 8 September 2026 — the practice's logo at the top, the brand violet on the titles and the column headings, the supplier and the household as facing blocks, the lines table in the design's shape, the totals in a bordered box, and the practice's contact details in a footer band. Specified in `docs/SPEC/billing.md` **section 5.6**; read it first, whole.

**What is deliberately NOT in scope** (the operator's answers of 8 September): the design's example is a monthly statement listing several visits with payments received — that content stays piece thirteen's, and this round restyles the documents the platform already issues. Numbering stays `INV-000001` and `RCP-000001`. And **nothing about what a document claims may change**: while the practice is unregistered the heading is "Invoice", there is no VAT column, no VAT line and no VAT number, and the fifteen-digit corporate-tax number is labelled as itself and never as a TRN.

**Architecture.** Four capabilities are missing and this round adds them, three of them in the trunk's shared zone: the PDF writer cannot draw an image; nothing can read a PNG into the shape a PDF wants; the storage seam can write bytes but not read them back; and the practice has nowhere to record a telephone, an email or a website. On top of those, billing's own renderer is rewritten to the new layout, a route files the practice's logo, and the seed carries the contact details.

**Tech stack:** TypeScript, PostgreSQL 17, Hono, vitest. No new dependency: a PNG's own IDAT stream is already zlib-deflated with PNG predictors, which is exactly what PDF's `FlateDecode` with `/Predictor 15` consumes, so the image is embedded without decoding it and without an image library.

## Global constraints

- **Worktree** `/Volumes/Storage/McWellness/mcwellness-billing`, branch `billing-document-design` (already cut from `origin/main` at `0a24f85`). Its database is on port 5436. Never use `git stash`.
- **Shared-zone edits ride in this round's own pull request**, by the integrator's widening and the precedent of pieces seven to ten. Every file touched outside `domain/billing/**`, `app/admin/billing/**`, `app/api/billing/**`, `tests/billing/**` and `db/migrations/4xx` must be listed in `docs/CHANGE-REQUESTS/billing-09.md` (Task 9).
- **Rendering stays pure and deterministic.** `domain/shared/document` and `domain/billing/document` read no clock, no database and no file: bytes arrive as arguments, exactly as the fonts already do. The same row must render to the same bytes next year.
- **Existing documents must not change by accident.** A page that draws no image must produce byte-identical output to today's writer; `tests/billing/geometry.test.ts` and `domain/shared/document/pdf.test.ts` are the guard.
- Money through `formatFils`; integer fils; British English; no emoji; no Arabic under `app/admin`; synthetic data only in tests; small conventional commits ending `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Every long command with the Bash tool's own timeout parameter** (this Mac has no `timeout`; the shell is zsh, so read a piped gate's code as `${pipestatus[1]}` under `set -o pipefail`). Iterate on single test files; run `pnpm verify`, `pnpm test:db` and `pnpm build` before declaring done.
- Push the branch when done; do not open the pull request.

---

## Task 1: The PDF writer learns to draw an image

**Files:** `domain/shared/document/pdf.ts`, `domain/shared/document/index.ts`, `domain/shared/document/pdf.test.ts`

**Interfaces:**

```ts
/** A bitmap ready to embed: a PNG's own compressed scanlines, unchanged. */
export type DocumentImage = {
  width: number;
  height: number;
  /** 'rgb' (PNG colour type 2) or 'grey' (type 0). */
  colours: 'rgb' | 'grey';
  /** The concatenated IDAT bytes: zlib-deflated, PNG-predicted scanlines. */
  data: Uint8Array;
};

/** Images a page may draw, by the name its ops use. */
export type ImageSet = Readonly<Record<string, DocumentImage>>;

// Op gains one member:
| { kind: 'image'; image: string; x: number; y: number; width: number; height: number }

export function renderPdf(
  pages: readonly Page[],
  fonts: FontSet,
  title: string,
  images?: ImageSet,          // new, optional
): Uint8Array;
```

- [ ] **Step 1 (test first)** in `pdf.test.ts`: a page whose ops include one image produces a PDF containing an `/XObject` resource, a `/Subtype /Image` object with `/Width`, `/Height`, `/ColorSpace /DeviceRGB`, `/BitsPerComponent 8`, `/Filter /FlateDecode` and `/DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns W >>`, and a content stream containing `cm` and `Do`. A second test: a page with **no** image op renders bytes identical to the same page rendered by `renderPdf(pages, fonts, title)` with no `images` argument at all — the resource dictionary gains no `/XObject` key.
- [ ] **Step 2:** implement. `x`, `y` is the image's bottom-left corner in points; the content operator is `q <width> 0 0 <height> <x> <y> cm /<name> Do Q`, and the name is `/Im<n>` allocated per document in the order the images are first used. `/Colors` is 3 for `rgb` and 1 for `grey`; `/ColorSpace` `/DeviceRGB` or `/DeviceGray`. Only images actually referenced by an op are written. Keep `q`/`Q` balanced and leave the text state untouched, so an image between two text runs cannot leak a transform.
- [ ] **Step 3:** export `DocumentImage` and `ImageSet` from `domain/shared/document/index.ts`, and re-export them from `domain/billing/document/index.ts` beside the font types.
- [ ] Run `pnpm test domain/shared/document/pdf.test.ts` and `pnpm test tests/billing/geometry.test.ts`. Commit: `feat(document): the writer can draw an image`.

## Task 2: Reading a PNG, purely

**Files:** `domain/shared/document/png.ts` (new), `domain/shared/document/png.test.ts` (new), the index export

```ts
/** The PNG's own bytes in; what the writer embeds out. Throws on anything it cannot embed. */
export function readPng(bytes: Uint8Array): DocumentImage;
```

Accepts: the 8-byte signature, `IHDR` with bit depth 8, colour type **2** (truecolour) or **0** (greyscale), compression 0, filter 0, **interlace 0**; concatenates every `IDAT` in order; ignores every ancillary chunk (`iCCP`, `pHYs`, `iTXt`, …). Throws a `RangeError` naming the reason for: a bad signature, a bit depth other than 8, colour type 1, 3, 4 or 6 (palette and alpha are not embeddable this way), or an interlaced image.

- [ ] **Tests first**, built from bytes the test itself constructs (a tiny 2×2 PNG written by hand as a hex literal in the test, plus the practice's own logo read from disk in Task 4's test rather than here — this file stays pure and reads nothing).
- [ ] Implement, export, commit: `feat(document): reading a PNG into what a PDF embeds`.

## Task 3: The storage seam can read bytes back

**Files:** `domain/shared/storage.ts`, `app/api/_middleware/storage/local-disk.ts`, the Supabase implementation beside it, `app/api/_middleware/storage/seam.test.ts`

`StorageProvider` gains one method:

```ts
/** The bytes at a key, or null when nothing is there. */
get(key: string): Promise<Uint8Array | null>;
```

The local implementation already has a private `read`; expose it through the new name (keep the old one if the local storage route uses it, or point that route at the new one — do not leave two). The Supabase implementation downloads the object; a vendor failure raises `StorageUnavailableError` exactly as its other calls do, so a bucket that is down still reads as a 503 and never as a bug in the document.

- [ ] Test in `seam.test.ts`: bytes put are the bytes got; a missing key answers null; a vendor outage raises `StorageUnavailableError`.
- [ ] Commit: `feat(storage): the seam can read an object back`.

## Task 4: The practice's logo, filed and read

**Files:** `app/api/billing/practice-logo.ts` (new), `app/api/billing/routes.ts`, `app/api/billing/document-source.ts`, `tests/billing/db/practice_logo_document.test.ts` (new)

**The route.** `POST /api/billing/practice-logo`, owner or admin only (`canActor` with the practice-settings audience the settings routes use; if no such action exists, `hasRole(actor, 'owner', 'admin')` with a comment saying why). It takes the raw body (the raw-body door in `app/api/create-api.ts` — read how the assessment stream's upload uses it), refuses anything but `image/png` and `image/jpeg`, refuses over 2 MB, and in one transaction: calls `app.remove_practice_logo()`, inserts the `document` row with `kind = 'practice_logo'`, `client_id` null, and files the bytes through the storage seam after the commit, exactly as `documents.ts` does. Answers `{ document: { id, mimeType, bytes } }`.

**The read.** In `document-source.ts`, `export async function practiceLogo(db, storage): Promise<DocumentImage | null>` — reads the one `practice_logo` row for the practice, fetches its bytes, and returns `readPng(bytes)`; returns **null** rather than throwing when there is no logo, when the bytes are gone, or when the file is a JPEG or a PNG shape `readPng` refuses. A document must still render when its logo cannot be drawn.

- [ ] Database test: filing a logo twice leaves one row; a practitioner is refused; the bytes come back byte-identical through the seam; `practiceLogo` answers null when none is filed.
- [ ] Commit: `feat(billing): the practice's logo, filed and read back`.

## Task 5: The practice's contact details, and their snapshot

**Files:** `db/migrations/912_practice_contact.sql` (new), `db/migrations/959_invoice_supplier_contact.sql` (new), `tests/billing/db/supplier_contact.test.ts` (new)

**912** adds to `tenant`: `contact_phone text`, `contact_email text`, `website text`, each nullable, each with a light check (`contact_email` contains `@` and no whitespace; `website` starts `https://` or `http://`; `contact_phone` is digits, spaces and `+()-`), each with a column comment saying it is printed on the practice's documents. The trunk's 900–949 half, because `tenant` is a core table.

**959** adds `supplier_contact_phone`, `supplier_contact_email`, `supplier_website` to `invoice` and replaces `app.stamp_invoice_supplier` whole so it copies the three at numbering time, in the shape it already copies the legal name and the address — a value already supplied is left alone. 406's and 905's own text for that function is the reference; write the previous version out in this file's `-- rollback:` block, because `create or replace` has no undo. The trunk's 950–999 half, because it alters billing's `invoice`.

- [ ] Test: a practice with the three set stamps them onto a new invoice; a practice with none stamps nulls and the document still renders; the columns are on `document-source`'s read and reach `SupplierSnapshot`.
- [ ] `pnpm db:migrate`, then commit: `feat(billing): the practice's contact details, snapshotted onto every invoice`.

## Task 6: The document model and its words

**Files:** `domain/billing/document/model.ts`, `domain/billing/document/strings.ts`, `tests/billing/document.test.ts`

- `SupplierSnapshot` gains `contactPhone: string | null`, `contactEmail: string | null`, `website: string | null`.
- `MoneyDocument` rendering gains an optional logo: change `renderDocument(document_, fonts)` to `renderDocument(document_, fonts, logo?: DocumentImage | null)`.
- `strings.ts` gains: `WORDS.billedTo { en: 'Billed to', ar: 'إلى' }`, and `export function discountLine(listFils: number, discountFils: number): Phrase` giving the design's own phrasing — en `List AED 12,150.00 · less AED 2,325.00`, ar `السعر قبل الخصم 12,150.00 درهم · ناقص 2,325.00 درهم`. Keep `discountNote` if anything still uses it; if nothing does, remove it and its test.
- **Money on a document is written with its currency in the cell** — add `export function money(fils: number): string` returning `AED 1,650.00` (`formatFils` with the prefix), and use it for every figure in the table and the totals box. The column headings therefore lose their `(AED)`: `WORDS.unitPrice` becomes `{ en: 'Unit price', ar: 'سعر الوحدة' }`, and the same for `amount`, `net`, `total`, `vatAmount`, `amountReceived`. Section 5.6 records why this differs from the console's rule.
- Commit: `feat(billing): the words and the shapes the new design needs`.

## Task 7: The layout

**File:** `domain/billing/document/render.ts` (a rewrite of the page functions; the `Sheet` class, the wrapping and the paging machinery stay), `tests/billing/geometry.test.ts`

**The brand colour** is `const VIOLET = [0x38 / 255, 0x04 / 255, 0x73 / 255] as const` — the practice's own mark sampled from its logo. It is used for exactly three things: the two title words, the table's column headings, and the document's reference. Nothing else gains hue.

**The page, in order.** A4, margin 48 as today.

1. **The logo**, centred, 150 points wide, its height from the image's own aspect ratio, when one was supplied. When none was, the wordmark as today (`WORDMARK` at `SIZE.wordmark`, bold, left) — a practice with no logo must still get a deliberate page. Then down 22.
2. **The title row**: the English title at 20pt bold in violet against the left margin, the Arabic title at 20pt bold in violet against the right (rtl). "Tax Invoice"/"فاتورة ضريبية" only under a registration, "Invoice"/"فاتورة" otherwise, exactly as `chargesVat` already decides. Down 26.
3. **The supplier block**, as facing blocks rather than the labelled rows it is today: on the left the legal name in bold, then the address wrapped, then the licence number, the licensing authority and the corporate-tax registration each on its own grey line, each still carrying its label so the number is never mistaken for a VAT one; on the right the Arabic legal name in bold and the same lines mirrored where an Arabic form exists. Under a registration, the VAT registration number is the last line, in bold, on both sides. Down 4, hairline, down 16.
4. **The document's facts**: on the left the reference at 13pt bold in violet, and beneath it "Issued 8 September 2026" and, when it differs, "Date of supply …", small and grey. On the right, right-aligned: "Billed to" small and grey, the household's name in bold, and "Record number MW-000001" small and grey. A receipt shows "Received from" in place of "Billed to", and beneath the reference its own "Date received", the method, the payment reference and the invoice it settles. Down 4, hairline, down 16.
5. **The lines table.** Headings in violet bold with their Arabic beneath in violet at `SIZE.small`, then a hairline. Columns as today — description, quantity, unit price, and under a registration the VAT rate and the VAT amount, then the amount — right-aligned but for the description. Each row: the description, its Arabic beneath in grey, and when `discountFils > 0` a third grey line, `discountLine(...)`. Figures through `money()`. The row-height arithmetic and the page break between rows stay exactly as they are.
6. **The totals**, in a box against the right margin: 200 points wide, a hairline rectangle drawn as four `rule` ops, 10 points of padding. Inside, right-aligned rows in the order: "Before discount" and "Discount" when a discount was given, then "Net" and "VAT" under a registration, then "Total" in bold at `SIZE.body + 1`. Each label carries its Arabic beside it in small grey, as `totalRow` already does. A receipt's box holds one row, "Received", in bold.
7. **The waiver notice** when the document carries one, unchanged, in ink.
8. **The footer band**, pinned to the bottom of the last page: a hairline at `FOLIO + 30`, then two centred grey lines at `SIZE.small` — the legal name and the address on the first, and on the second the contact details as `P: … E: … W: …`, each part omitted when the practice has not recorded it, the whole line omitted when it has recorded none. Above the band, in the flow, the tax-basis sentence exactly as today (`SIMPLIFIED_BASIS` or `NOT_REGISTERED_BASIS`, and `receiptBasis` on a receipt).

**How to know it is right.** Rendering is not finished when the tests pass; it is finished when the page looks like the design. After each layout change:

```bash
pnpm test tests/billing/document.test.ts       # the words are on the page
# then render a sample and look at it:
pdftoppm -png -r 110 <the pdf> /tmp/look && open -a Preview /tmp/look-1.png   # or Read the PNG
```

The plan's own sample generator is `docs/superpowers/plans/2026-09-08-document-design.samples.md` (Task 8). **Read the rendered PNG with the Read tool and compare it against the operator's design** at `/private/tmp/claude-501/-Volumes-Storage-McWellness/25a98803-ac1e-426c-a865-7919fa0cbca3/scratchpad/design/` (the integrator saves the two reference pages there before you start). Iterate until the two read as the same document. Say in your report what still differs and why.

- [ ] Update `tests/billing/geometry.test.ts` for the new structure — it asserts geometry by measuring the ops, so it must still prove: nothing is drawn past the right margin, a long service name wraps inside its column rather than through the figures, a long address wraps, the totals box's four rules meet, and the footer band sits above the paper's edge.
- [ ] Commit: `feat(billing): the practice's own design on its money documents`.

## Task 8: The samples, and the data step

**Files:** `tests/billing/db/zz-samples.test.ts` (a throwaway the builder deletes before the final commit), `scripts/practice-brand.mjs` (new, kept)

- [ ] A throwaway generator, in the shape the integrator used on 7 September: start the harness, sell the seeded Silver with an extra discount, take a payment, file both documents through `POST /api/billing/documents`, re-render them and write the two PDFs to `/private/tmp/.../scratchpad/samples-design/`. Use it for the Task 7 loop. **Delete it before the last commit**; `git status` must be clean.
- [ ] `scripts/practice-brand.mjs`: a small script the integrator runs against an environment to set `contact_phone`, `contact_email` and `website` on the practice and to upload the logo through `POST /api/billing/practice-logo`. It takes the base URL, a bearer token and the file path as arguments, prints what it did, and prints no secret. Document it in `docs/RUNBOOK/go-live.md` under a new short heading.
- [ ] Commit: `feat(billing): a script to put the practice's brand in place`.

## Task 9: The records

- [ ] `docs/CHANGE-REQUESTS/billing-09.md`: every file this round touched outside billing's paths — `domain/shared/document/{pdf,png,index}.ts`, `domain/shared/storage.ts`, `app/api/_middleware/storage/**`, `db/migrations/912` and `959`, `docs/RUNBOOK/go-live.md` — each with what changed and why it could not wait for a trunk round. Note for the trunk: **the practice settings screen still cannot edit the three contact fields or the logo**; that is a later trunk round, and until then the script of Task 8 is how they are set.
- [ ] `docs/SPEC/00-data-model.md` section 6: one sentence that `tenant` carries the practice's contact details and `invoice` snapshots them.
- [ ] Gates: `pnpm verify`, `pnpm test:db`, `pnpm build`, each exit 0 under `pipefail`. Push. Write the report the brief names.

## Done when

1. The invoice and the receipt carry the logo, the violet titles and headings, the facing blocks, the design's discount phrasing, the totals box and the footer band, and a rendered page read side by side with the operator's design reads as the same document.
2. A practice with no logo and no contact details still renders a clean, deliberate page.
3. While the practice is unregistered nothing on either page says "Tax Invoice", names a VAT number, or shows a VAT column or line; the corporate-tax number is labelled as itself. Under a registration all of those appear, and `tests/billing/document.test.ts` proves both directions.
4. `pnpm verify`, `pnpm test:db` and `pnpm build` are green, and `git status` is clean with the throwaway generator deleted.
