# Credit Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finance, an admin or the owner can issue one gapless-numbered credit
note against an issued invoice. The client's balance, the session credits
behind the invoice, the books, the VAT figures and a filed bilingual PDF all
follow.

**Architecture:** The pure rules live in `domain/billing/creditNote.ts`. The
database writes everything in one definer function, `app.issue_credit_note`,
which mirrors those rules and is tested against them. A new money event,
`credit_note.issued`, flows through the existing poster. The screen is a
drawer on Billing › Invoices.

**Tech Stack:** TypeScript, Hono, React + Vite, PostgreSQL (row security,
definer functions), Vitest (`pnpm test`, `pnpm test:db`), zod.

**Spec:** `docs/superpowers/specs/2026-10-22-credit-notes-design.md`. Read it
first; this plan does not repeat its reasoning.

## Global Constraints

- Money is integer fils everywhere. Every credit-note amount column carries
  a `>= 0` check, and gross = net + VAT.
- The reference is `'CN-' || lpad(number::text, 6, '0')`. The series is per
  practice and gapless, copied from migration 405.
- Who may issue: owner, admin, finance. The reason must be at least 8
  characters after trimming, and is set into `app.reason`.
- One credit note per invoice: `unique (tenant_id, invoice_id)`.
- Headings: `Tax Credit Note` / `إشعار دائن ضريبي` when the corrected
  invoice's `supplier_vat_registered` is true, otherwise `Credit Note` /
  `إشعار دائن`.
- New tables: the standard columns, `'audited: client'`, `select, insert`
  grants only, and an `audit_row` trigger `enable always`.
- Migrations:
  - billing 416, 417 and 418; accounting 455; trunk 981;
  - each with a `-- Needs:` naming lower numbers only and a `-- rollback:`
    block;
  - `create or replace` keeps the old body in the rollback;
  - a new enum value is never used in the file that adds it.
- UI rules:
  - colours from `app/shell/tokens.css` only;
  - logical CSS properties;
  - a right-side drawer, not a modal;
  - no ALL-CAPS;
  - no personal data in URLs.
- Fixtures come from `db/seed/` generators only.
- Wellness wording only. No lawyer or legal-review dependency appears in
  copy or docs.

## Review Focus

1. **A credit is consumed while the note is being issued.** A visit closing
   at the same moment must not leave a credit both `consumed` and credited.
   The function locks the invoice's credits `for update` before reading
   them. The test is in Task 3.
2. **A retried request with the same idempotency key** returns the first
   note and takes no second number. The test is in Task 4.
3. **An invoice with a discount.** The credited net is the discounted net,
   and the package credits' allocations still sum to the purchase. The test
   is in Task 1 and Task 3.
4. **A credit note issued after the invoice's period was locked** posts on
   its own `issued_on`, or the first open day after it, and never on the
   invoice's date. The test is in Task 5.
5. **An erased client's invoice** is refused with `client_erased`. Erasure
   keeps invoices, but the ledger readers' erasure gate hides the row, and a
   correction for an erased household needs the owner. The test is in
   Task 3.

---

### Task 1: The pure rules — what can be credited, and its VAT

**Files:**
- Create: `domain/billing/creditNote.ts`
- Create: `domain/billing/creditNote.test.ts`
- Modify: `domain/billing/balance.ts` (add `'credited'` to
  `ENTITLEMENT_STATUSES`; `counts()` excludes it)
- Modify: `domain/billing/recognition.ts` (`credited` is treated like
  `refunded`)
- Modify: `domain/billing/index.ts` (exports)

**Interfaces:**
- Produces:
  ```ts
  export type CreditableInvoice = {
    id: string; kind: 'session' | 'package' | 'call_out_fee' | 'statement' | 'single_session';
    waived: boolean; alreadyCredited: boolean; clientErased: boolean;
    lines: readonly { id: string; netFils: Fils; vatFils: Fils }[];
  };
  export type CreditableCredit = { id: string; status: EntitlementStatus; allocatedNetFils: Fils };
  export type CreditRefusal =
    'statement' | 'waived' | 'already_credited' | 'nothing_left' | 'client_erased';
  export type CreditPlan = {
    lines: { invoiceLineId: string; netFils: Fils; vatFils: Fils; grossFils: Fils }[];
    netFils: Fils; vatFils: Fils; grossFils: Fils;
    releasedNetFils: Fils;            // part debited to sessions owed
    creditedEntitlementIds: string[]; // available credits that become `credited`
  };
  export function creditableFor(invoice: CreditableInvoice, credits: readonly CreditableCredit[]):
    { ok: true; plan: CreditPlan } | { ok: false; refusal: CreditRefusal };
  export function proportionalVat(lineVatFils: Fils, lineNetFils: Fils, creditedNetFils: Fils): Fils;
  ```

- [ ] **Step 1: Write the failing tests** in `creditNote.test.ts`, names as
  requirements:
  - `credits the whole call-out fee and releases nothing`: net 15000, VAT
    750 → plan net 15000, VAT 750, gross 15750, `releasedNetFils` 0, no
    credits.
  - `credits a delivered session invoice to income`: kind `session` with
    its credit `consumed` → whole invoice, `releasedNetFils` 0.
  - `credits a sold-ahead session whose credit is unused from sessions owed`:
    `single_session` with credit `available` → `releasedNetFils` equals net,
    and that credit id is listed.
  - `credits a sold-ahead session already used to income`: `single_session`
    with credit `consumed` → whole invoice, released 0.
  - `credits only the seven unused credits of a ten-session package`: line
    net 100000, VAT 5000; credits are 3 consumed and 7 available at 10000
    each → net 70000, VAT 3500, released 70000, seven ids.
  - `uses the discounted net a package was sold at`: allocations summing to
    90000 with 9 available → net 81000.
  - `refuses a statement`, `refuses a waived invoice`,
    `refuses an invoice already credited`,
    `refuses a package whose credits are all used`,
    `refuses an erased client's invoice` → each `ok: false` with that
    refusal.
  - `proportionalVat rounds half away from zero and never exceeds the line`:
    `proportionalVat(5000, 100000, 70000) === 3500`;
    `proportionalVat(1, 3, 2) === 1`; `proportionalVat(5, 10, 10) === 5`.
  - `a credited credit no longer counts in the session balance` (in the
    existing `balance.test.ts` style): `balanceFor` with one `credited` and
    one `available` credit → purchased 1, remaining 1.

- [ ] **Step 2: Run them to see them fail.** Run
  `npx vitest run domain/billing/creditNote.test.ts domain/billing/balance.test.ts`.
  Expected: FAIL, because `creditNote` doesn't exist and `'credited'` isn't
  a status.

- [ ] **Step 3: Implement.** Write `creditableFor` and `proportionalVat` in
  `domain/billing/creditNote.ts`, and add `'credited'` to the status list
  and the two exclusions.
  - Check refusals in this order: `client_erased`, `statement`, `waived`,
    `already_credited`, `nothing_left`.
  - A whole-invoice credit copies each line's `vatFils` exactly.
  - Only `package` (and an available `single_session`) uses
    `proportionalVat`.
  - `proportionalVat` uses integer arithmetic:
    `Math.min(lineVat, Math.floor((2 * lineVat * credited + lineNet) / (2 * lineNet)))`
    for non-negative inputs.

- [ ] **Step 4: Run them to see them pass.** Run the same command, then
  `npx vitest run domain/billing`. Expected: PASS, with no other billing
  test broken.

- [ ] **Step 5: Commit.** Message: `feat(billing): what a credit note may credit, as pure rules`.

---

### Task 2: Migration 416 — the series, the tables, the new status

**Files:**
- Create: `db/migrations/416_credit_note.sql` (Needs 405, 409, 413, 959)
- Modify: `db/policies/billing/ledger.sql` (add `credit_note` and
  `credit_note_line` to the reader and writer arrays)
- Test: `tests/billing/db/credit_note_number.test.ts`,
  `tests/billing/db/audit_coverage.test.ts` and
  `tests/billing/db/ledger_rls.test.ts` (extend the last two)

**Interfaces:**
- Produces:
  - `credit_note`: the columns in the spec's "Data", plus `client_id`;
  - `credit_note_line`;
  - `credit_note_series`;
  - `app.next_credit_note_number(p_tenant_id uuid) returns integer`,
    granted to nobody;
  - enum value `entitlement_status.credited`;
  - `entitlement.credited_by uuid references credit_note(id)`;
  - no checks that name `credited` yet (that's Task 3).

- [ ] **Step 1: Write the failing tests:**
  - `numbers credit notes CN-000001 upward with no gap under concurrency`:
    copy `invoice_number.test.ts`, calling `app.next_credit_note_number` as
    the owner connection from 10 parallel transactions, 2 of which roll
    back. The committed references form a contiguous run and the
    rolled-back numbers are reused.
  - `the app role can neither update nor delete a credit note`: an `update`
    or `delete` as `app_role` fails with SQLSTATE `42501`.
  - Audit coverage lists both new tables as `'audited: client'`.
  - Ledger row security: a practitioner of another household and a client
    contact of another household read 0 rows.

- [ ] **Step 2: Run them to see them fail.** Run
  `pnpm test:db -- tests/billing/db/credit_note_number.test.ts`. Expected:
  FAIL, because the relation doesn't exist.

- [ ] **Step 3: Write `416_credit_note.sql`.** Follow the 405 template for
  the series, the tenant trigger and the backfill. The `reference`,
  supplier snapshot and `locale` columns copy their invoice types (402,
  905, 959, 413). Add the deferred constraint trigger
  `credit_note_lines_sum`: line totals equal the header, and each line's
  net and VAT are at most its `invoice_line`'s. The rollback drops
  everything. An enum value can't be removed, so the rollback notes that
  `credited` stays.

- [ ] **Step 4: Run them to see them pass.** Run `pnpm db:migrate`, then the
  test, then `pnpm test:db -- tests/billing/db`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(billing): the credit-note series and tables (migration 416)`.

---

### Task 3: Migration 417 — issuing, the ledger, the waiver guard

**Files:**
- Create: `db/migrations/417_issue_credit_note.sql` (Needs 408, 416)
- Test: `tests/billing/db/credit_note_issue.test.ts`,
  `tests/billing/db/call_out_fee.test.ts` (extend)

**Interfaces:**
- Consumes: Task 2's tables and status.
- Produces:
  - `app.issue_credit_note(p_invoice_id uuid, p_reason text, p_idempotency_key uuid) returns uuid`
    (the credit note's id). It is a definer function that re-checks
    `app.actor_has_role` for owner, admin or finance, and raises:
    - `'credit_note_refused:<refusal>'`, with the refusals named as in
      Task 1;
    - `42501` for a wrong role.
  - `app.billing_ledger` with an `entry_kind 'credit'` branch.
  - `app.waive_call_out_fee` raising `'waiver_refused:vat_registered'`.

- [ ] **Step 1: Write the failing tests** (harness:
  `tests/billing/db/support.ts` `startHarness`, `silverInput`,
  `setPracticeVatRegistration`):
  - `issues a credit note for a call-out fee and the balance drops by its gross`.
  - `credits the unused credits of a package and marks them credited`: a
    Silver package with 2 visits delivered. Assert:
    - the remaining credits are `status = 'credited'` with `credited_by`
      set;
    - the allocation check still holds at commit;
    - `package_purchase.status = 'completed'`.
  - `cancels a package purchase none of whose credits were used`.
  - `the ledger shows the note as a credit of minus its gross`.
  - `the SQL agrees with creditableFor on every seeded kind`: for each
    invoice kind in the seed, compare the function's written figures with
    `creditableFor` fed the same rows.
  - `a visit closing while the note is issued leaves no credit both used and credited`:
    two connections. One issues; the other runs `app.charge_single_visit`
    or consumes a credit at the same moment. Afterwards no entitlement is
    both `consumed` and has `credited_by`.
  - `two issues on one invoice produce one note`: two parallel calls give
    one success and one `already_credited`.
  - Refusals: `statement`, `waived`, `already_credited`, `nothing_left`,
    `client_erased` (using the erasure fixture), and the `42501` role
    error for a practitioner.
  - In `call_out_fee.test.ts`, `the waiver refuses a fee issued while VAT-registered`.

- [ ] **Step 2: Run them to see them fail.** Run
  `pnpm test:db -- tests/billing/db/credit_note_issue.test.ts`. Expected:
  FAIL, because the function doesn't exist.

- [ ] **Step 3: Write `417_issue_credit_note.sql`.**
  - The function locks the invoice row and its entitlements `for update`,
    computes the plan exactly as `creditableFor` does, takes
    `app.next_credit_note_number(tenant)`, and inserts the note and its
    lines.
  - It copies the supplier snapshot and `locale` from the invoice and sets
    `issued_on` to the practice's today (`tenant.timezone`).
  - It updates the credits and sets `package_purchase.status` (to
    `cancelled` when nothing on it was ever consumed, otherwise
    `completed`).
  - The ledger view is the 408 body plus the credit branch.
  - The waiver body is the 408 body plus the registered refusal.
  - Check constraints that name `credited` go here, after 416 has
    committed the value.

- [ ] **Step 4: Run them to see them pass.** Run `pnpm db:migrate`, then
  `pnpm test:db -- tests/billing/db`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(billing): issue a credit note in one transaction (migration 417)`.

---

### Task 4: The routes

**Files:**
- Create: `app/api/billing/credit-notes.ts`
- Modify: `app/api/billing/access.ts` (`mayIssueCreditNote`),
  `app/api/billing/routes.ts` (mount it), `app/api/billing/ledger-schema.ts`
  (schemas, plus `creditNoteReference` on `InvoiceRow`),
  `app/api/billing/invoices.ts` (select it), `app/api/billing/balance.ts`
  and `app/api/billing/stop-balance.ts` (handle `entry_kind 'credit'`)
- Test: `tests/billing/db/credit_note_routes.test.ts`,
  `tests/billing/access.test.ts`

**Interfaces:**
- Consumes: Task 1 `creditableFor`; Task 3 `app.issue_credit_note`.
- Produces:
  - `GET /api/billing/invoices/:id/credit-quote` →
    `CreditQuoteResponse = { ok: true, plan: { netFils, vatFils, grossFils, releasedNetFils, usedCredits: number, unusedCredits: number } } | { ok: false, refusal: CreditRefusal }`
  - `POST /api/billing/invoices/:id/credit-note` with
    `{ reason: string (min 8), idempotencyKey: uuid }` →
    `201 { creditNote: { id, reference, grossFils, issuedOn } }`, `409
    { error: 'credit_note_refused', refusal }`, or `403`.
  - `mayIssueCreditNote(actor, now)`: the `named('billing.credit_note.write')`
    probe with an owner, admin or finance fallback.
  - `InvoiceRow.creditNoteReference: string | null`.

- [ ] **Step 1: Write the failing tests:**
  - The quote matches what the POST then writes.
  - The POST for finance returns 201 and a `CN-` reference.
  - The same idempotency key returns the same note and the series moves by
    one.
  - A reason of 7 characters returns 400.
  - A practitioner gets 403.
  - A statement invoice returns 409 `statement`.
  - The invoice search returns `creditNoteReference`.
  - The balance route lists the credit entry.
  - In `access.test.ts`: `mayIssueCreditNote` is true for owner, admin and
    finance, and false for lead practitioner, practitioner and client
    contact.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**, shaped like `app/api/billing/waivers.ts`: the
  reason goes through `scrubReason` into `app.reason`, and a
  `credit_note_refused:<x>` error is mapped to 409.
- [ ] **Step 4: Run them to see them pass**, then `pnpm typecheck`.
- [ ] **Step 5: Commit.** Message: `feat(billing): credit-note quote and issue routes`.

---

### Task 5: The books — `credit_note.issued`

**Files:**
- Create: `db/migrations/455_post_credit_notes.sql` (Needs 453, 454, 417)
- Modify: `domain/accounting/posting.ts`, `domain/accounting/posting.test.ts`,
  `app/api/accounting/poster.ts`
- Test: `tests/accounting/db/unposted_events.test.ts`,
  `tests/accounting/db/statements.test.ts` (extend)

**Interfaces:**
- Consumes: the `credit_note` table.
- Produces: a new `MoneyEvent` member:
  `{ event: 'credit_note.issued'; sourceId; occurredOn; invoiceKind; netFils; vatFils; grossFils; releasedNetFils; serviceCode: string | null }`.
  `SOURCE_TABLE` gains `'credit_note.issued': 'credit_note'`, and its type
  widens to include `'credit_note'`.

- [ ] **Step 1: Write the failing tests:**
  - `posting.test.ts`, `a credit note on a fee reverses income_fees and VAT`:
    Dr 4300 net, Dr VAT payable VAT, Cr receivable gross.
  - `a credit note on a package releases sessions owed`: Dr 2400 released,
    Dr VAT, Cr receivable.
  - `a credit note on a delivered session reverses that service's income`.
  - `a zero-VAT credit note has no VAT line`.
  - In the DB tests:
    - the event appears once and is gone after posting;
    - running the poster twice adds nothing;
    - after issuing a note in a locked period, the entry's date is the
      first open day and its memo carries the real date;
    - in `statements.test.ts`, receivable = invoices − payments − waived −
      credit notes, all gross, and VAT payable = invoice VAT − waived VAT −
      credit-note VAT.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - `455` replaces the `journal_entry.source_table` check to admit
    `credit_note`, and replaces `app.unposted_money_events()`: the 454 body
    plus a `credit_note.issued` branch that anti-joins `journal_entry`.
  - `posting.ts` gets the union member, `worthNothing`, and a `postingsFor`
    case with the memo `'Credit note issued'`. The rest of the net (net −
    released) goes to `income_fees` for `call_out_fee`, otherwise
    `incomeAccountFor(chart, serviceCode)`.
  - The poster's `toEvent` maps the row.
- [ ] **Step 4: Run them to see them pass:**
  `npx vitest run domain/accounting && pnpm test:db -- tests/accounting/db`.
- [ ] **Step 5: Commit.** Message: `feat(books): post credit notes (migration 455)`.

---

### Task 6: The VAT-threshold figure (trunk 981)

**Files:**
- Create: `db/migrations/981_vat_supplies_less_credit_notes.sql` (Needs
  957, 416)
- Test: `tests/billing/db/vat_registration.test.ts` (extend)

- [ ] **Step 1: Write the failing test:**
  `a credit note issued in the window reduces taxable supplies by its net`.
- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Write it.** Use the 957 body of
  `app.vat_taxable_supplies_fils`, minus `sum(credit_note.net_fils)` over
  the same window by `issued_on`. The rollback restores 957.
- [ ] **Step 4: Run it to see it pass.**
- [ ] **Step 5: Commit.** Message: `feat(vat): taxable supplies net of credit notes (migration 981)`.

---

### Task 7: The document — model, render, filing

**Files:**
- Create: `db/migrations/418_credit_note_document.sql` (Needs 407, 416)
- Modify:
  - `domain/billing/document/model.ts` (`CreditNoteDocument`, added to
    `MoneyDocument`);
  - `domain/billing/document/strings.ts`;
  - `domain/billing/document/render.ts` (dispatch and `titleOf`);
  - `domain/billing/document/invoice.ts` (a variant: the credit-note
    heading, the `credits` block, `totalCredited`);
  - `app/api/billing/document-source.ts` (`creditNoteDocument`);
  - `app/api/billing/document-schema.ts` and `app/api/billing/documents.ts`
    (kind `credit_note`).
- Test: `tests/billing/document.test.ts`,
  `tests/billing/db/documents.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  export type CreditNoteDocument = Omit<InvoiceDocument, 'kind' | 'waivedOn' | 'suppliedOn'> & {
    kind: 'credit_note'; credits: { reference: string; issuedOn: IsoDate }; reason: string;
  };
  ```
  - `POST /api/billing/documents` accepts `{ kind: 'credit_note', sourceId }`.
  - `billing_document_kind` gains `credit_note`, and `billing_document`
    gains `credit_note_id`.

- [ ] **Step 1: Write the failing tests:**
  - `a registered credit note is headed Tax Credit Note and names the invoice it credits`:
    the rendered text contains `Tax Credit Note`, `INV-000123` and
    `Total credited`.
  - `an unregistered one is headed Credit Note`.
  - `an Arabic credit note uses إشعار دائن ضريبي`.
  - In the DB tests: `files a credit note's PDF once`, and the second call
    returns the same document; erasure keeps it.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Use these strings exactly:

  | English | Arabic |
  |---|---|
  | `Tax Credit Note` | `إشعار دائن ضريبي` |
  | `Credit Note` | `إشعار دائن` |
  | `Credits invoice` | `إشعار دائن للفاتورة` |
  | `Reason` | `السبب` |
  | `Total credited` | `إجمالي المبلغ الدائن` |

  Mark the Arabic strings with a comment for the owner's wording review.
  Migration 418 copies the 407 pattern for the enum, the column, the
  reworked check, the unique index and the new `app.file_billing_document`
  branch.
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit.** Message: `feat(billing): the credit note's PDF (migration 418)`.

---

### Task 8: The screen and the copy

**Files:**
- Create: `app/admin/billing/CreditNoteDrawer.tsx`
- Modify:
  - `app/admin/billing/InvoicesSection.tsx` (the action in `FullTable`,
    `SlimTable` and `InvoiceList`; `KindWords` shows
    `Credited CN-000004`; the PDF button for the note);
  - `app/admin/billing/PaymentDrawer.tsx`;
  - the comments in `app/api/billing/payments.ts` and
    `app/api/billing/sales.ts`.
- Test: `tests/billing/InvoicesSection.test.tsx`,
  `tests/billing/CreditNoteDrawer.test.tsx`

- [ ] **Step 1: Write the failing tests:**
  - finance sees `Issue credit note` on a fee row, and a practitioner
    doesn't;
  - the drawer shows the quote's gross and `7 unused of 10`;
  - the confirm button stays disabled until the reason has 8 characters;
  - the drawer shows the sentence
    `This corrects a mistake. It is not how a package is ended early.`;
  - a 409 shows the refusal's words;
  - after success the row reads `Credited CN-000001`;
  - the PaymentDrawer text no longer contains `credit note`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement** on the `WithdrawPackageDrawer.tsx` pattern
  (`useDrawer`, a reason field, refusal notes). The PaymentDrawer copy
  becomes: `A payment can't be changed once recorded. If one was recorded in error, tell the owner.`
- [ ] **Step 4: Run them to see them pass**, then `pnpm verify`.
- [ ] **Step 5: Commit.** Message: `feat(billing): issue a credit note from Invoices`.

---

### Task 9: Specs, change requests, reviews

**Files:**
- Modify:
  - `docs/SPEC/billing.md` §4.3, §10 (credit notes built; no legal-review
    item);
  - `docs/SPEC/accounting.md` §7 (the `credit_note.issued` row and the
    identities);
  - `docs/SPEC/OWNERSHIP.md` (the piece's widening note);
  - `docs/OPERATOR/finance-guide.md` ("Correcting a mistake"), only if PR
    292 has merged; otherwise in that branch.
- Create: `docs/CHANGE-REQUESTS/billing-credit-notes.md` (the
  `domain/shared/actor.ts` action `billing.credit_note.write`, the
  `00-data-model.md` corrections, and client-portal showing the document)

- [ ] **Step 1:** Write the docs and the change request.
- [ ] **Step 2:** Run `pnpm verify` and `pnpm test:db`. Expected: all pass.
  Then `pnpm db:reset && pnpm seed`.
- [ ] **Step 3:** Run the security, compliance and schema reviewers
  (`.claude/agents/*.md`) on `git diff origin/main...HEAD`, and fix what
  they find.
- [ ] **Step 4:** Commit, push, and open a draft PR whose body links the spec
  and this plan.
