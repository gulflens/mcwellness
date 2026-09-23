# The money documents in the operator's design of 24 September 2026

**Date:** 24 September 2026. **Status:** design approved by the operator ("go
but respect my colors and simplicity", 01:58 +04); building as trunk round 65.

## Why

The operator designed the invoice again and asked that the platform's own
documents look exactly like it. It replaces the design of 8 September 2026
(`docs/SPEC/billing.md` section 5.6) as the design the documents match. His
two instructions bind everything below: **his colours** — the practice's
violet, white, and tints of that violet for cards, and nothing else — and
**simplicity**: what his page shows, and nothing it does not.

The 8 September page set every fact in facing English and Arabic rows. The
new page keeps Arabic where he kept it — the title, the supplier block, the
section headings, the table's column headings and the summary's rows — and
drops it where he dropped it: the rows of the payment details card carry
English labels only, because an account number read against six labels is a
number a payer misreads.

## The design source

His PDF stays in his own Documents folder and is not committed: it carries
the practice's real account. This section describes it exactly, and the
render the round produces is compared with it by eye before the review.

## The page, top to bottom

A4, the margins the writer has. Type: the platform's own three faces
(regular, bold, Arabic); his mock's typeface is not adopted. Colours, all
derived in code from the one brand violet `#380473` (`VIOLET` in
`render.ts`) so there is one source: **violet** for fills and accents;
**white** for text on violet; **card** = the violet mixed six per cent over
white (`#f3f0f7`) for card grounds; **edge** = fifteen per cent (`#e1d9ea`)
for card borders; **pill** = twelve per cent (`#e7e1ee`) for the discount
pill's ground. Text stays the ink and the two greys the documents already use.
Corners: 6 pt on cards, the pill fully rounded. No shadows, no gradients, no
second hue.

1. **Masthead.** The practice's mark, left, about 250 pt wide as his page sets
   the lockup (the wordmark in type when the practice has none). Right, in
   violet: "INVOICE" bold and large, and beneath it "فاتورة". A registered
   practice reads "TAX INVOICE" and "فاتورة ضريبية". Capitals are his; they
   are a document's, not the console's.
2. **Supplier block, left half.** Legal name bold with the Arabic name beside
   it; then three rows — licence number, licensing authority, corporate-tax
   registration number — each English label and value on the left and the
   Arabic value and label on the right of the same half, as his page sets
   them. A registered practice adds a fourth row for the VAT registration
   number. **Number card, right.** A card with "Invoice no." / "رقم الفاتورة"
   over the reference in violet bold, and "Issue date" / "تاريخ الإصدار" over
   the date in bold; the date of supply, when it differs, as a third pair.
3. **Billed-to card, left half.** "BILLED TO" / "الفاتورة إلى" as a small
   caption, the household's name bold and large, then "Client record:
   MW-000099" with "رقم السجل" and the number on the right. **Payment method,
   right, no card:** "PAYMENT METHOD" / "طريقة الدفع" as a caption, then
   "Bank transfer" / "تحويل مصرفي" bold in violet. Absent, caption and all,
   when the practice has recorded no bank account.
4. **The lines table.** A card whose header is a solid violet band with white
   headings, each English over Arabic: Description / الوصف, Qty / الكمية,
   Unit price / سعر الوحدة, Discount / الخصم, Total / الإجمالي; a registered
   practice inserts VAT / الضريبة before Total and the Total column holds the
   gross. The Discount column is present only when the invoice carries a
   discount; on a discounted line it holds a pill — the percentage when the
   line has one, the amount otherwise; an undiscounted line's cell is empty.
   Rows: description bold, the service's Arabic name beneath in small grey,
   quantity, unit price (the list figure), the pill, the total; a hairline
   column separator between cells and a hairline under each row. On a page
   taken mid-table the violet header is drawn again at the top. The
   "List … · less …" sub-line of the old page is gone: the column says it.
5. **Two cards, side by side, below the table.** Left, "Payment details" /
   "تفاصيل الدفع" (title bold, Arabic right, a hairline under the title):
   Account name, IBAN (in violet bold, grouped in fours), SWIFT / BIC, Bank
   address — English labels only, values bold except the address — and a
   strip inside the card's foot, "Payment reference" / "مرجع الدفع" with the
   invoice's reference in violet bold on the right. The whole card is absent
   when the practice has recorded no account. Right, "Invoice summary" /
   "ملخص الفاتورة": Subtotal (the list total), "Discount 25%" (the shared
   percentage when the lines agree, "Discount" alone otherwise) with the
   amount as "- AED 1,987.50", then for a registered practice Net and "VAT 5%",
   a hairline, and a solid violet block: "TOTAL DUE" / "الإجمالي المستحق" as
   small white captions over the figure large in white. When the left card is
   absent the summary keeps its place on the right.
6. **Tax information card.** Full width, card ground with a violet bar down
   its left edge: "Tax information" / "المعلومات الضريبية" bold, then the
   sentence the practice's registration calls for, in English and beneath it
   in Arabic (`NOT_REGISTERED_BASIS` or `SIMPLIFIED_BASIS`, unchanged). A
   waived invoice puts its waived sentence first, in ink, as today.
7. **Footer.** A hairline; the legal name and the address on one centred line,
   the address's parts spaced as his page spaces them; the telephone, email
   and website on the next; both small and grey; pinned to the foot of the
   page as today, wrapping upward when long.

## The receipt

The same dress, because a receipt that looked like last week's design beside
this invoice would look like a different practice's: "RECEIPT" / "إيصال";
the number card reads "Receipt no." / "رقم الإيصال" and "Date received" /
"تاريخ الاستلام"; the left card is "RECEIVED FROM" / "مستلم من"; the payment
method names the method the money came by (Cash, Bank transfer, Payment
link); no table; the left lower card is "Payment received" / "الدفعة
المستلمة" with Method, Reference (when there is one) and "Settles invoice"
(when there is one); the right card's violet block reads "TOTAL PAID" /
"الإجمالي المدفوع"; the bottom card is titled "Note" / "ملاحظة" and carries
the receipt's own sentence (`receiptBasis`, unchanged); no bank details
anywhere on it, and no corporate-tax number in the supplier block, as before.

## What the writer needs

The shared PDF writer (`domain/shared/document/pdf.ts`) draws text, rules
and images. It gains one op, `rect`: a filled and/or stroked rectangle with
an optional corner radius (four Bézier arcs, κ = 0.5523), emitted inside its
own `q … Q` so the writer's fill-state machine for text is untouched, and
every document already filed still renders to the bytes it was filed as —
`pdf.test.ts`'s greyscale golden pins that. Text takes a colour through
`Style.rgb`, which already exists; the sheet's `TextOptions` gains the
colour so a caption can be white on violet.

## Rules

- Filed PDFs never change. Every render after this round is the new page; a
  storage-loss recovery of an old invoice refuses, as the logo and the bank
  account already make it refuse.
- The registered and unregistered pages differ only where a registration
  adds a fact: the title word, the VAT number row, the VAT column, the Net
  and VAT rows.
- Long content: a description, an address or a holder that wraps stays
  inside its cell or card; a table that crosses a page repeats its header;
  the two cards move to the next page together, and so does the tax card;
  the footer is pinned; nothing crosses a margin or another block — the
  geometry tests say so for one to forty lines, both registrations, with
  and without a discount, a bank account and a waiver.
- Determinism holds: the same document renders to the same bytes.
- Money is written as it is today, `AED 5,962.50`, and dates as today.

## Not in this round

His mock's typeface. Any colour but the violet and its tints. A page footer
number (his page has none). The console screens that show an invoice: they
open the PDF.
