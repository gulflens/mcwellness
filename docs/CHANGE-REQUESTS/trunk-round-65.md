## Round 65 — the money documents in the operator's design (2026-09-24)

On 24 September 2026 the operator sent his own redesigned invoice as a PDF
and asked that the platform's documents look the same: he did not like the
page round 61 had left, and the Arabic beside every row of the bank details
was, in his words, distracting. When the design was written back to him he
approved it with one line — "go but respect my colors and simplicity" —
and those two instructions bound every choice this round made. His colours:
the practice's violet, white on it, and tints of that violet for cards, and
nothing else. His simplicity: what his page shows and nothing it does not.
Built the same day in five tasks, each reviewed before the next began; the
operator's PDF stays in his own Documents folder and is not committed — it
carries the practice's real account — and the render was compared with it by
eye, block by block, before each review.

### Where his page beat the written design

The design document (`docs/superpowers/specs/2026-09-24-invoice-redesign-design.md`)
describes his page in words, and the first render followed the words where
they and the page differed. The page wins; seven points were ruled and the
spec amended (`5c1432b5`, `c91dc6d6`) before the invoice was reviewed: the
lockup is about 165 points wide, not 250; the number card carries a four-point
violet bar down its left edge like the tax card; the summary card's title sits
on a tinted band over a white body; the Subtotal and Discount rows carry no
Arabic — only "TOTAL DUE" does; a hairline crosses the page beneath the
supplier row; each supplier row is set small enough (7 pt) to sit on one line,
which a 150-point number card leaves room for; and there is no "Page n of m"
anywhere, because his page has none. A later sheet still says what it belongs
to — a small running header with the practice and the reference — which is
the one thing on a continuation page his one-sheet page could not show.

### What changed, block by block

The page is seven blocks, each measured before it is drawn and each
recording the box it was drawn in, so the geometry tests assert the page as
boxes rather than as loose pieces of type (`domain/billing/document/invoice.ts`):

1. **The masthead** — the mark left, the title right in violet, "INVOICE"
   over "فاتورة" ("TAX INVOICE" / "فاتورة ضريبية" under a registration).
2. **The supplier block and the number card** — name, licence, authority,
   corporate-tax registration and, registered, the VAT registration, one line
   each; the card with its violet bar, "Invoice no." over the reference in
   violet bold, "Issue date" over the date, the date of supply when it
   differs; a hairline beneath the row.
3. **The billed-to card and the payment method** — "BILLED TO", the
   household, "Client record: MW-…"; "PAYMENT METHOD" over "Bank transfer" in
   violet, absent when the practice has recorded no account.
4. **The lines table** — a violet header band with white headings, English
   over Arabic; the Discount column only when the invoice carries a discount,
   its cell a pill with the percentage or, for a discount typed as a sum, the
   amount; the "List … · less …" sub-line gone; the header redrawn on every
   page the table reaches.
5. **Two cards side by side** — "Payment details" with English-only row
   labels (the operator's point), the IBAN in violet grouped in fours, and a
   "Payment reference" strip at its foot; "Invoice summary" with Subtotal,
   Discount, Net and VAT rows in English only, and the violet "TOTAL DUE"
   block. The two are measured together and move to the next page together.
6. **The tax information card** — the registration's sentence in both
   languages, unchanged in wording; a waived call-out fee's sentence first.
7. **The footer** — pinned, wrapping upward when long, as before.

**The receipt** wears the same dress (`domain/billing/document/receipt.ts`):
"RECEIPT" over the Arabic; the number card with "Receipt no." and "Date
received"; the supplier block without its corporate-tax row; "RECEIVED FROM"
over the household and its record; "PAYMENT METHOD" over the method the
money came by — Cash, Bank transfer or Payment link — in violet; no table;
"Payment received" on the left with Method, Reference when there is one and
"Settles invoice" when there is one, English labels only; "Receipt summary"
on the right with the violet "TOTAL PAID" block alone — a receipt has one
figure, printed once; and a
"Note" card in the tax card's shape carrying the receipt's own sentence, that
it is a receipt for money received and not a tax invoice. No bank details
anywhere on it and no corporate-tax number in its supplier block, as before.
The blocks both pages share — the masthead, the supplier block, the number
card, the party card, the payment method, the card and summary shapes, the
bar card and the footer — live once, in a base class `DocumentPage`
(`page.ts`), and each document's own page builds on it; the invoice's
blocks moved there without an edit, and its goldens staying put is the proof.

**Colour has one source.** `VIOLET` in `domain/billing/document/sheet.ts`,
and `tint(k)` mixing it over white for the three tints — `CARD` at six per
cent, `EDGE` at fifteen, `PILL` at twelve — with `WHITE` beside them. No
other hex or triple appears anywhere in the two pages, and
`tests/billing/palette.test.ts` walks every op of every page in a matrix of
both documents and refuses any colour outside those five and the three
greys, and any white text that does not lie inside a violet rect.

### The new op in the shared writer

The writer (`domain/shared/document/pdf.ts`, the trunk's own) drew text,
rules and images. It gains one op, `rect`: a filled and/or stroked rectangle
with an optional corner radius, the corners as four Bézier arcs (κ = 0.5523),
emitted inside its own `q … Q` so the writer's fill-state machine for text
is never consulted or changed. The existing greyscale golden in `pdf.test.ts`
is unchanged, which is the proof that a page with no `rect` op still renders
to the bytes it always did — every document already filed still renders to
the bytes it was filed as. The billing `Sheet` builds `card`, `bandFill`,
`outline` and `hairline` on it, all from the top edge, which is how the page
is laid out.

### The goldens, re-pinned, and why

`tests/billing/document.test.ts` pins the sha256 of four rendered documents
so a change to the bytes is deliberate, never accidental. The two invoice
goldens moved twice in this round — once when the new page landed
(`86181e19`) and once after the seven points above (`c2cb8d1a`), each time
as the last commit of its task and each time after the render had been read
against the operator's PDF. The receipt's moved when its page landed
(`2295ba46`) and once more when the two Arabic spellings of "Bank transfer"
on one receipt were made one (`93243c6f`), and a third time in the final
reviews' fix wave, when its summary's Total row went and its fixture's record
number became MW-000099 (`6d99a1f8`), each time the same way. Between those commits every refactor of the shared blocks was proven by
the goldens staying put: lifting the blocks both pages share out of the
invoice page (`7ec4e3d0`) changed no invoice byte. A third invoice golden, with the account and a discount, was pinned at the end of the round so the payment card's bytes are held in the repository and not only by the demo file outside it.

**Filed PDFs never change.** A document filed before this round keeps its
bytes, read back from storage by hash; a storage-loss recovery of one refuses
(`409 document_bytes_differ`) rather than put the new page under the old
hash — the rule the mark and the bank account already live by since round
61, reaching further now because every render after this round is the new
page. Nothing about what a document claims changed: the title word, the VAT
row, the VAT column and the Net and VAT rows still appear only under a
registration, and the tax card still says which of the two the document is.

A discounted line prints its percentage in the pill and the amount once, in
the summary; a registered invoice carries the VAT amount per line and the
rate in the summary when every line shares it. That is enough for the
simplified tax invoice the practice issues to households, and it is the
thing to revisit if the practice ever issues full tax invoices to registered
buyers.

### The Arabic

Every Arabic phrase this round adds was written by the round and has not been
reviewed by an Arabic speaker, the same standing as every phrase before it
(`docs/SPEC/billing.md` has said so since round 20). The new pairs in
`domain/billing/document/strings.ts`: "رقم الفاتورة" (Invoice no.), "تاريخ
الإصدار" (Issue date), "الفاتورة إلى" (BILLED TO), "مستلم من" (RECEIVED
FROM), "رقم السجل" (Client record), "طريقة الدفع" (PAYMENT METHOD), "تحويل
مصرفي" (Bank transfer), "الكمية" (Qty), "تفاصيل الدفع" (Payment details),
"ملخص الفاتورة" (Invoice summary), "ملخص الإيصال" (Receipt summary), "المجموع
الفرعي" (Subtotal), "الإجمالي المستحق" (TOTAL DUE), "الإجمالي المدفوع" (TOTAL
PAID), "المعلومات الضريبية" (Tax information), "ملاحظة" (Note), "رقم الإيصال"
(Receipt no.), "الدفعة المستلمة" (Payment received). The rows of the payment
card and the summary carry no Arabic at all, by the operator's instruction:
"Account name", "SWIFT / BIC", "Method" and "Reference" have an empty Arabic
half on purpose. The percentage on an Arabic line still reads `%25` for the
reason round 61 gave.

### Found beside it, and not fixed here

- Measuring and drawing repeat their numbers in `invoice.ts`: a row's height
  is computed from the literals 17, 12, 13 and 10 in `row()` and again in
  `drawRow()`; `facingDepth` and `drawFacing` repeat the same stepping
  formula; the payment method's `captionAt - 44` appears twice. Shared
  constants would stop the two sides drifting apart; only the long
  description case would catch it today.
- Two geometry assertions are partly circular: "payment method exactly when
  there is a bank account" infers the account from whether a `paymentCard`
  block exists, not from the shape. The text test for the no-bank variant
  covers it.
- The masthead, supplier and billed-to blocks do not call `room()`; harmless
  because they always open page one, but a departure from the convention.
- No test drives `rect` with a negative radius or a zero width.
- `tests/reports/document.test.ts`, the reports stream's, still carries the
  record number `MW-000004` in a fixture — the number production's real
  client held before 19 September, beside a synthetic name. This round
  changed billing's own fixture to `MW-000099`; the reports stream's is its
  own to change.
- Two commits in the middle of the receipt's task (`a5f32f92`, `77ebd312`)
  are red on the receipt's golden by design — it is re-pinned last, after
  the render was read — and the first of them is red on eslint for the old
  page it left unused until the next commit removed it. Every commit
  typechecks; whoever bisects this range should know.

### The tests

- `domain/shared/document/pdf.test.ts` — 39: the `rect` op square and
  rounded (eight Bézier segments closed before the paint operator), filled,
  stroked and both, a text op after a rect still setting its own fill, a
  number that is not finite written as nought, and the greyscale golden of 8 September unchanged byte for byte.
- `domain/billing/document/colours.test.ts` — 9: the three tints as
  arithmetic on `VIOLET`, and `card`, `bandFill`, `outline` and `hairline`
  as the ops they push, with a font that has nothing in it.
- `tests/billing/document.test.ts` — 64: every caption and word of the
  invoice's seven blocks present and the old page's sub-line absent; "25%"
  once on the line and "Discount 25%" in the summary; "- AED 1,987.50";
  "TOTAL DUE"; the payment card's rows with the IBAN grouped in fours and the
  reference in the strip; the registered variant's "TAX INVOICE", VAT row,
  VAT column, Net and VAT rows; the no-bank, sum-discount and waived
  variants; the receipt's eighteen — "RECEIPT", its number card, "RECEIVED
  FROM", each method's name, the Payment received rows present and absent
  with their facts, "TOTAL PAID" and no Total row above it, the Note's sentence, and no bank, tax or
  invoice word anywhere on it, registered or not; determinism as byte
  equality; the four goldens — two invoices without an account, a third with the account and a discount, and the receipt.
- `tests/billing/geometry.test.ts` — 49: for one to forty lines, both
  registrations, with and without a discount, a bank account and a waiver
  (960 layouts), no block crosses a margin or another block, the violet
  header sits at the top of every page the table touches, the two cards
  share a top edge and the tax card follows, the footer is pinned, and type
  sits inside its block; a 200-character address and a 120-character holder
  wrapping inside the payment card; the 34-character IBAN wrapping at a
  group boundary; and the receipt across three methods, with and without a
  settled invoice and a reference, both registrations and the long names —
  one page, the same assertions; the six inputs the final review tried (a
  400-character description, an Arabic-only one, a quantity of 100, a
  120-character name with no spaces, a sum discount in the millions, a line
  of nothing), each also rendered twice to the same bytes; and a long legal
  name cut to fit a later sheet's running header.
- `tests/billing/palette.test.ts` — 2: every colour on every op of both
  documents across a matrix — a waived invoice and one with a date of supply
  among them — is one of the five and the three greys, and
  every white line of type lies inside a violet rectangle on its page.
- `tests/billing/db/documents.test.ts` — 22 and
  `tests/billing/db/supplier_contact.test.ts` — 6, run with `pnpm test:db`:
  a filed invoice's stored PDF carries "Payment details"; recovery still
  refuses a document whose bytes would differ; an invoice re-rendered after
  the account changes prints the new details, the intended drift.

`pnpm -s format`, `pnpm verify` (prettier, eslint, `tsc --noEmit`, the
secrets scan over 1,638 tracked files, the migration audit over 116 files
against `origin/main`, and `vitest run`: 266 files, 3,218 tests) and
`pnpm test:db` for the two billing database files (2 files, 28 tests) green
on the branch's head, no skips.

### Every file this round touched outside the trunk's own paths

All the billing stream's, riding in this round's own pull request by the
integrator's widening for one round, as rounds 41, 51, 52, 58, 59, 60 and 61
were widened (`docs/SPEC/OWNERSHIP.md`): under `domain/billing/document/`,
`sheet.ts`, `page.ts`, `invoice.ts` and `receipt.ts` (the last three new),
`render.ts` (shrunk to the dispatch, `layout`, `layoutWithBlocks`, `titleOf`
and `GEOMETRY`), `strings.ts`, `index.ts` and `colours.test.ts`;
`tests/billing/document.test.ts`, `geometry.test.ts` and `palette.test.ts`
(new); two strings in `tests/billing/db/documents.test.ts` and
`supplier_contact.test.ts`; and `docs/SPEC/billing.md` §5.6, replaced. Five
comment-only edits ride with it, each renaming the old 'Pay by bank transfer'
block to the 'Payment details' card in a docstring:
`app/admin/settings/PracticeDrawer.tsx` and `PracticePage.tsx`,
`app/api/practice/schema.ts`, `domain/shared/iban.ts` and
`tests/db/practice.test.ts` — all trunk paths under round 61's note. The
trunk's own half is `domain/shared/document/pdf.ts` with its test, the spec
and plan under `docs/superpowers/`, and the documents. No migration, no
policy file. Nothing in those paths is the trunk's beyond this round.

### Going live

**Merged is not live.** No migration and no policy file: the round is
front-end and server code only, so the pass is the hold protocol and then a
build by the recipe (`docs/PRODUCTION.md`), with both database ledgers left
exactly where the thirty-seventh pass left them (**115** rows each; check
the number rather than trust it).

**Proof is not the client bundle.** What an invoice prints lives in
`domain/billing/document`, which renders on the server
(`app/api/billing/document-source.ts`); the served client bundle never
carries "TOTAL DUE" or "Payment details" to check for, and the API bundle is
not served to a browser at all. The proof is two other things: the runtime
log after the restart showing the new build's start, and an invoice rendered
from the live site after the pass actually carrying the violet header band,
the "Payment details" card and "TOTAL DUE" — read off the file, the way the
goldens are read in the tests, not off a claim about the code. Production
holds two invoices. `INV-000001` is filed and keeps the page it was filed
with, the 8 September design; nothing re-renders a filed document.
`INV-000002` has not been filed: the first time it is opened it files with
whatever page the server renders that day — opened before the pass it keeps
round 61's page for good, opened after it carries this one. Every document
rendered after the pass is the new page.

**For the operator.** A continuation sheet — an invoice with more lines than
one page holds — carries a small running header, the practice's name and the
reference, so a loose second sheet says what it belongs to; his page is one
sheet and could not show this, and it is the one thing on the page his
design does not draw. It is a line to remove if he would rather not have it.
And a long invoice takes one sheet more than before — forty lines take five
sheets where the old page took four — because his rows are taller; the spec
sets no page budget and none was taken.
