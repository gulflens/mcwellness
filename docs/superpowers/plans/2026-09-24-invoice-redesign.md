# The money documents in the operator's design (round 65) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The invoice and the receipt render in the operator's design of 24 September 2026: violet bands and cards, the discount as a pill, bank details in a card with English row labels, the total in a violet block.

**Architecture:** One new op in the shared PDF writer (`rect`, filled and/or stroked, optional corner radius, inside its own `q … Q`). The billing renderer's `Sheet` gains card and band helpers on top of it and a colour option for text. The invoice and receipt pages are rewritten; the geometry tests are rewritten around the new blocks; the byte goldens are re-pinned deliberately; the spec's section 5.6 is replaced.

**Tech Stack:** The pure TypeScript PDF writer (`domain/shared/document`), the billing document renderer (`domain/billing/document`), Vitest with `extractAll()` for text and the layout's exported boxes for geometry.

**Spec:** `docs/superpowers/specs/2026-09-24-invoice-redesign-design.md` — the authority; the operator's PDF is described there in words.

## Global Constraints

- **Colours: the brand violet `#380473` and tints of it over white only** (card 6%, edge 15%, pill 12%), white text on violet, the existing ink and greys for text. Every value derived in code from `VIOLET`; no other hex anywhere.
- **Simplicity: what the operator's page shows and nothing more.** No shadows, gradients, icons, page numbers, or extra rows.
- Arabic exactly where the spec places it; the payment details rows carry English labels only.
- Capitals on "INVOICE", "TAX INVOICE", "RECEIPT", "BILLED TO", "RECEIVED FROM", "PAYMENT METHOD", "TOTAL DUE", "TOTAL PAID" — a document's, not the console's.
- `pdf.test.ts`'s existing golden content stream must not change (a page with no `rect` op emits the same bytes as before).
- `tests/billing/document.test.ts`'s three goldens are re-pinned ONCE, after the page has been rendered to the operator's Documents folder and compared with the operator's PDF by eye, and the commit says so.
- No real bank detail or name in any file or test: `AE36 0000 0000 0000 0000 001`, `TESTAEXX`, `Example Practice L.L.C-FZ`, seed names only.
- `pnpm -s format` before `pnpm verify`; the DB tests (`pnpm test:db tests/billing/db/documents.test.ts`) still pass: they file and recover documents through the route.

## Review Focus

1. A 200-character bank address or a 120-character holder wraps inside the payment card and the card grows; nothing overlaps the summary card. Task 3's geometry case.
2. Forty lines, registered, with a discount: the table crosses two pages with its violet header redrawn, the two cards land together on the last page, the tax card after them, the footer pinned. Task 3.
3. A discount typed as a sum: the pill shows the amount, the summary row reads "Discount" without a percentage. Task 3.
4. No bank account: no payment card, no payment method, the summary right-aligned, the page otherwise the same. Task 3.
5. A waived invoice: the waived sentence first in the tax card, in ink. Task 3.

---

### Task 1: The `rect` op in the shared writer

**Files:**
- Modify: `domain/shared/document/pdf.ts` (`Op` union ~100-146; the emitter loop ~325-360)
- Test: `domain/shared/document/pdf.test.ts`

**Interfaces:**
- Produces:
```ts
| {
    kind: 'rect';
    x: number; y: number; width: number; height: number;   // bottom-left origin, as image
    fill?: { rgb: readonly [number, number, number] } | { grey: number };
    stroke?: { rgb?: readonly [number, number, number]; grey?: number; thickness?: number };
    radius?: number;                                        // corner radius in points; absent = square
  }
```
Emitted as `q <fill colour rg / g> <stroke RG / G> <w> <path> <B|f|S> Q` — the path is `x y w h re` when no radius, else four lines and four Bézier arcs (κ = 0.5523) starting at `(x+r, y)`. Everything inside `q … Q`, so the text fill-state machine (`fill`, `setFill`) is never consulted or changed.

- [ ] **Step 1: Failing tests** in `pdf.test.ts`: (a) a square filled rect emits `q 0.22 0.02 0.45 rg 20 30 100 40 re f Q` (use the exact `num()` formatting the file's other assertions use); (b) a rounded rect emits eight path segments (`c` operators) and closes with `h` before the paint operator; (c) fill + stroke paints with `B`; stroke only with `S`; (d) a text op after a rect still sets its own fill (the golden greyscale stream test stays byte-identical — assert the existing golden unchanged); (e) determinism: two renders of the same ops are equal.
- [ ] **Step 2: Run red** — `pnpm vitest run domain/shared/document/pdf.test.ts`.
- [ ] **Step 3: Implement; run green.**
- [ ] **Step 4: Commit** — `feat(document): the writer draws a filled or stroked rectangle, square or rounded`.

### Task 2: Sheet helpers and the strings

**Files:**
- Modify: `domain/billing/document/render.ts` (`Sheet`: add `rect(...)`, `card(x, yTop, width, height, { radius })`, `bandFill(...)` thin wrappers over the op; `TextOptions` already carries `rgb` (passed as `Style.rgb`) — use it for white-on-violet and violet text; the colour constants `CARD`, `EDGE`, `PILL` computed from `VIOLET` as `1 - (1 - v) * k` per channel with k = 0.06 / 0.15 / 0.12; export them beside `VIOLET`)
- Modify: `domain/billing/document/strings.ts` (`WORDS` gains: `invoiceNo` "Invoice no." / "رقم الفاتورة"; `issueDate` "Issue date" / "تاريخ الإصدار"; `dateOfSupply` stays; `billedToCaption` "BILLED TO" / "الفاتورة إلى"; `receivedFromCaption` "RECEIVED FROM" / "مستلم من"; `clientRecord` "Client record" / "رقم السجل"; `paymentMethodCaption` "PAYMENT METHOD" / "طريقة الدفع"; `bankTransferMethod` "Bank transfer" / "تحويل مصرفي"; `qty` "Qty" / "الكمية"; `discountColumn` "Discount" / "الخصم"; `totalColumn` "Total" / "الإجمالي"; `vatColumnShort` "VAT" / "الضريبة"; `paymentDetails` "Payment details" / "تفاصيل الدفع"; `accountName` "Account name"; `swiftBic` "SWIFT / BIC"; `paymentReferenceStrip` "Payment reference" / "مرجع الدفع"; `invoiceSummary` "Invoice summary" / "ملخص الفاتورة"; `receiptSummary` "Receipt summary" / "ملخص الإيصال"; `subtotal` "Subtotal" / "المجموع الفرعي"; `totalDue` "TOTAL DUE" / "الإجمالي المستحق"; `totalPaid` "TOTAL PAID" / "الإجمالي المدفوع"; `taxInformation` "Tax information" / "المعلومات الضريبية"; `note` "Note" / "ملاحظة"; `receiptNo` "Receipt no." / "رقم الإيصال"; `paymentReceived` "Payment received" / "الدفعة المستلمة"; `method` "Method"; `reference` "Reference"; `settlesInvoiceRow` "Settles invoice"; `taxInvoiceAr` "فاتورة ضريبية" beside the existing `taxInvoice`; keep `total`, `net`, `vatAmount`, `discount`, `beforeDiscount` only where still used — delete `discountLine` and its tests, the new page has no sub-line; `discountTotalLabel(bp)` stays for "Discount 25%")
- Test: `domain/billing/document/strings.test.ts` if it exists, else the WORDS assertions in `tests/billing/document.test.ts` get updated in Task 3.

- [ ] **Step 1:** add the helpers and constants with a small unit test of the tint arithmetic (`CARD` ≈ `[0.953, 0.941, 0.967]`).
- [ ] **Step 2:** add the words; `pnpm typecheck` still green (the page still compiles with the old layout).
- [ ] **Step 3: Commit** — `feat(billing): card, band and colour helpers for the writer; the words the new page uses`.

### Task 3: The invoice page

**Files:**
- Modify: `domain/billing/document/render.ts` (`invoicePages` and its helpers `masthead`, `supplierBlock`, `facts`, `heading`, `totalsBox`, `bankBlock`, `footer`, `band` — rewrite to the spec's seven blocks; keep `Sheet`, `clampForDocument`, `GEOMETRY`, `layout`, `titleOf`; export the block boxes per page for the geometry tests as `GEOMETRY`/`layout` do for the totals box today)
- Test: `tests/billing/document.test.ts` (text: every caption and word of the spec present; "List AED … · less …" absent; the pill text "25%" once; "Discount 25%" in the summary; "- AED 1,987.50"; TOTAL DUE; the payment card's rows with the grouped IBAN; the strip's reference; the tax sentence; the registered variant's TAX INVOICE, VAT number, VAT column, Net and VAT rows; the no-bank variant; the sum-discount variant; the waived variant; determinism; the three goldens re-pinned once, last, with the commit message saying the page was compared with the operator's PDF)
- Test: `tests/billing/geometry.test.ts` (rewritten: for 1–40 lines × registered/unregistered × discount/none × bank/none × waived/none, no box crosses a margin, no two boxes overlap, the header band sits at the top of every page the table touches, the two cards share a page, the tax card follows them, the footer is pinned; the long-address and long-holder cases; the IBAN of 34 characters wraps inside the card)

- [ ] **Step 1: Write the text tests red** (the new words), then build the page block by block, rendering to the operator's Documents folder with the demo script's data (a demo render script kept outside the repository, because it carries the practice's real account) and reading it back with the Read tool against the spec until it matches.
- [ ] **Step 2: Geometry tests red, then green.**
- [ ] **Step 3: Re-pin the goldens** as the last change, in their own commit.
- [ ] **Step 4: Commit(s)** — `feat(billing): the invoice in the operator's design of 24 September` and `test(billing): the goldens of the new page`.

### Task 4: The receipt

**Files:**
- Modify: `domain/billing/document/render.ts` (`receiptPages` in the same dress, per the spec's receipt section)
- Test: `tests/billing/document.test.ts` (receipt cases: RECEIPT, Receipt no., Date received, RECEIVED FROM, the method, Payment received rows, TOTAL PAID, the Note card, no bank details, no corporate-tax number), `tests/billing/geometry.test.ts` (receipt boxes)

- [ ] Red, build, green, commit — `feat(billing): the receipt in the same dress`.

### Task 5: Record and gate

**Files:**
- Modify: `docs/SPEC/billing.md` section 5.6 — replaced by the 24 September design in the file's voice (keep the 8 September paragraph as history in one sentence), dated 2026-09-24, with the operator's two instructions quoted.
- Modify: `docs/SPEC/OWNERSHIP.md` — a widening note for round 65 (billing's `domain/billing/document/**`, `tests/billing/{document,geometry}.test.ts`, `docs/SPEC/billing.md`; the shared writer is the trunk's own).
- Create: `docs/CHANGE-REQUESTS/trunk-round-65.md` — the ask, the two instructions, what changed block by block, the new op, the goldens re-pinned and why, the filed-PDF rule, the Arabic left unreviewed by a speaker, tests, "Going live": no migration, no policy file, a build; proof = "TOTAL DUE" and "Payment details" in the served API bundle is server-side, so the proof is a rendered document after the pass plus the runtime log.
- [ ] `pnpm -s format && pnpm verify && pnpm test:db tests/billing/db/documents.test.ts tests/billing/db/supplier_contact.test.ts` — green.
- [ ] Commit — `docs: round 65 — the money documents in the operator's design`.
