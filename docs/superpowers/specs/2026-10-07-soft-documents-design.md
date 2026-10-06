# The money documents in the practice's soft dress of October 2026

**Date:** 7 October 2026. **Status:** built on branch
`points/stage-3-documents`; the rendered pages were compared by eye with the
practice's mockups (described below) before review.

## Why

The practice sent mockups of the invoice and the receipt in a softer dress.
The structure is round 65's (`2026-09-24-invoice-redesign-design.md`): the
same blocks in the same order. What changes is the dress: solid violet bands
give way to a pale wash, white cards and lavender bands, with the violet kept
as the ink and the accent. Round 65's two rules still bind: the practice's
colours and nothing else, and simplicity.

## The design source

The mockups are not committed. This section describes them as built.

## Colours

Six named colours in `domain/billing/document/sheet.ts`, and no others
(`tests/billing/palette.test.ts` is a strict allow-list):

| Token | Hex | Used for |
| --- | --- | --- |
| `VIOLET` | `#380473` | titles, references, headings, accents; the bars down the left edge of the number, bank, tax and note cards |
| `WHITE` | `#ffffff` | card grounds (the mockups lay white at high opacity over the wash; the writer has no transparency, so it is solid) |
| `LAVENDER` | `#dccfef` | the table's header band, the summary's title band and its TOTAL DUE / TOTAL PAID block, the discount pill, the payment-reference strip |
| `LAVENDER_EDGE` | `#e2d8ee` | card borders and the hairlines inside cards |
| `WASH_FROM` | `#e4daf2` | the wash, at the top-right corner |
| `WASH_TO` | `#fbf3f6` | the wash, a warm near-white blush toward the bottom-left |

Type is set only in ink, the two greys and the violet. Nothing is set in white
any more. `MUTED` darkens from 0.42 to 0.35 (`#595959`): it is the lightest grey
that reads at WCAG AA (4.5:1) on `LAVENDER`, the darkest ground. The palette
test checks every type colour against every ground.

## The wash

Every page of both documents, later sheets included, is painted first with
`wash()`: a PDF axial shading across the whole page. It runs from `WASH_FROM`
at the top-right corner to `WASH_TO` four fifths of the way down the diagonal,
and the blush carries on into the bottom-left corner. The lavender is a glow in
the corner and most of the page is near-white. `DocumentPage.laidOut`
puts it first on each page. The `Sheet` primitives do not know about it.

The writer's new `shade` op (`domain/shared/document/pdf.ts`) is
`q x y w h re W n /ShN sh Q`. It clips to its box and paints inside its own
q/Q, so the text fill state is untouched. The shading is declared in the page's
resources as a direct dictionary:
`/ShadingType 2 /ColorSpace /DeviceRGB /Coords [x0 y0 x1 y1]
/Function << /FunctionType 2 /Domain [0 1] /C0 [..] /C1 [..] /N 1 >>
/Extend [true true]`. Identical washes share one name. Because no object is
added, a document that draws no wash has no `/Shading` key and its bytes do
not change. A wash with an axis of no length, an empty box or a number that is
not finite draws nothing.

## The page, top to bottom

1. **Masthead.** The lockup sits left on a white card of its own, inset 5 pt.
   The mark's file is opaque and the writer has no transparency, so this card
   gives it a card's edge instead of a pasted rectangle on the wash. Top right:
   "INVOICE" / "فاتورة" (or "RECEIPT" / "إيصال استلام") in bold violet.
2. **Supplier block and number card**, as round 65. The number card is white
   with a violet bar. A hairline runs beneath the row.
3. **Billed to / Received from** card (white) with the payment method beside
   it, as round 65.
4. **Table.** A white card under a lavender header band. The headings are bold
   violet, English over Arabic. Rows are white with lavender-edge hairlines.
   The discount is a lavender pill with violet type.
5. **Lower cards.** On the left, "Bank details" (English only, title included,
   as the mockup sets it; no Arabic was written for it and none is invented
   here). It is white with a violet bar: Account holder, IBAN (violet, grouped
   in fours), BIC, Bank address. The round-65 payment-reference strip stays at
   its foot, now lavender. On the right, "Invoice summary" / "ملخص الفاتورة"
   on a lavender title band: Subtotal, Discount (violet). The TOTAL DUE /
   الإجمالي المستحق block is lavender, with the amount large, bold and violet.
6. **Tax information** card, full width, white with a violet bar. It keeps the
   existing truthful sentences (`NOT_REGISTERED_BASIS` /
   `SIMPLIFIED_BASIS`). The mockup's English "registered for VAT but not
   reached the threshold" is not adopted: it contradicts its own Arabic and the
   facts, because the practice is not VAT-registered.
7. **Footer**, as round 65.

## The receipt

The same dress, with these changes to round 65's receipt:

- The number card reads "Receipt no." (RCP-…) and "Date received". RECEIVED FROM
  is on the left and PAYMENT METHOD on the right, with the existing words
  ("Bank transfer" / "تحويل مصرفي").
- **A table of one line** replaces the "Payment received" card. Its columns are
  Description / الوصف and Amount / المبلغ. The line reads "Payment received on
  account" / "دفعة مستلمة على الحساب", with "Against invoice INV-…" /
  "مقابل الفاتورة INV-…" beneath it when the payment settles one. The
  wording in both languages is the mockup's (`WORDS.amount`,
  `WORDS.paymentOnAccount`, `againstInvoice`).
- **"Receipt summary"** / "ملخص الإيصال" has a Method row, a Reference row when
  a payment reference was recorded, and the lavender TOTAL PAID / الإجمالي
  المدفوع block.
- **The Note card** (violet bar) now sits beside the summary on the left,
  instead of full width below it. It carries `receiptBasis` unchanged, in
  English and Arabic.

The receipt still carries no bank account and no tax registration.

## Rules

- Filed PDFs never change. Only documents rendered from now on wear this dress.
  The filing and recovery logic is untouched. The four goldens in
  `tests/billing/document.test.ts` moved, and that test's comment says why.
- Determinism holds, and the wash is part of the bytes.
- The geometry tests still hold for 1 to 40 lines, both registrations, with and
  without a discount, a bank account and a waiver, and for every receipt shape.
  They now also check the violet bars, the white table under its lavender band,
  the logo's card, the receipt's table and the note beside the summary.
