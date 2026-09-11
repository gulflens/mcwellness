# Money — Payments, Billing & Accounting Spec

*Single sessions, packages, and the accounting that keeps them honest.*

---

## Who uses it

| Role | Price list | Records money |
|---|---|---|
| Owner, admin | sees and changes it | yes |
| Finance | sees and changes it | yes |
| Lead practitioner | sees it | no |
| Practitioner, client contact | no | no |

The service catalogue itself (what the practice offers, its durations and the certification each service needs) is the owner's and an admin's alone; the price list is what finance may change. Enforced twice: in `domain/shared/actor.ts` and in row-level security.

## 1. The one idea that makes all of this simple

**Everything is an entitlement ledger.**

A client holds entitlements — credits for a specific service type. A session consumes one. That's it.

- Buy a single session → 1 entitlement, consumed immediately when it is charged at the door; sold ahead of the visit instead (a `single_session` invoice, migration 411, trunk round 43), it lasts as long as the price row it was sold at says — and where that row names no term, which is what the practice sells today, it never lapses (migration 412, section 4.3)
- Buy a 20-session package → 20 entitlements, consumed over months
- Insurance approves 8 sessions → 8 entitlements with a payer attached
- Comp a session for a service failure → 1 entitlement, zero value, reason logged

One mechanism, four business cases. If instead you build "packages" as a special case bolted onto "sessions," every new commercial model becomes a schema change. Build the ledger first and packages fall out of it.

```ts
type Entitlement = {
  id: string
  clientId: string
  serviceTypeId: string          // neurofeedback-session, brain-map, consultation
  sourceType: 'package' | 'single' | 'insurance' | 'complimentary'
  sourceId: string               // the ClientPackage or Invoice that created it
  allocatedValueAed: number      // see §4 — NOT the list price
  vatTreatment: 'standard'         // every service, see §5
  status: 'available' | 'consumed' | 'expired' | 'refunded'
  consumedBySessionId: string | null
  expiresAt: Date | null
}
```

`allocatedValueAed` is the field that does the real work. Section 4 explains why it isn't the list price.

---

## 2. What you sell

### 2.1 The catalogue

```ts
type ServiceType = {
  code: 'nf-session' | 'brain-map' | 'consultation' | 'cpt-test' | ...
  name: string
  durationMinutes: number
  requiresCertification: string  // credential gate
}
```

### 2.2 Recommended commercial structure

Based on the UAE landscape in the market study — Evolve at AED 625/session with packages 7,250–15,950, King's College at AED 700/session, MindTune's brain map at AED 1,250 at home — plus a home-delivery premium:

| Product | Contents | Price (excl. VAT) |
|---|---|---|
| **Brain map** (entry) | Consultation + qEEG + report + 1 trial session | AED 1,450 |
| **Single session** | One home neurofeedback session | AED 900 |
| **Starter — 10 sessions** | 10 sessions + 1 re-map + progress report | AED 8,900 |
| **Core — 20 sessions** | 20 sessions + 2 re-maps + 2 reports | AED 16,500 |
| **Full — 30 sessions** | 30 sessions + 3 re-maps + 3 reports + completion report | AED 23,500 |

Three deliberate choices in there:

**The brain map is the funnel, not the session.** Nobody buys 20 sessions cold. They buy an assessment, see their own brain, and then buy the program. Price it to be an easy yes and make the report exceptional. This is also why MindTune leads with it.

**Single sessions are priced to make packages obviously better** — AED 900 × 20 = 18,000 against a 16,500 package. A ~9% discount is enough to steer without making singles feel punitive, because singles are your trial and your top-up mechanism, not a product you want to kill.

**Credit the brain map toward the package** if bought within 30 days. Removes the "I already paid 1,450" objection at exactly the moment of the big decision. Encode it as a rule, not a discretionary discount.

**Consider an all-inclusive membership** as your Peak Brain equivalent — a 4-month program at a flat price with everything bundled, no per-session billing, no surprise re-assessment fees. It's the cleanest thing to sell and the easiest to explain. Worth testing once you have pricing data.

### 2.3 The price list is append-only (round 7b)

Prices are never edited or deleted, only superseded: a new price row must take effect today or later, and strictly after the row it replaces, and it always carries a reason. Nothing rewrites what a client was already shown or charged. The price-list screen (pull request 25, the billing stream's second piece) shows the net amount, the VAT and the gross total for each row, all from the prices route's answer; it never accepts a typed VAT figure — VAT is always resolved from the standard-rate setting and stamped onto the price at the moment it is written, per CLAUDE.md rule 6.

**A price row carries its own term** (`expiry_amount` and `expiry_unit`, migration 412; section 4.3). Because a price is superseded rather than edited, the new row has to be told the term as well as the figure — so a change of price that says nothing about the term **carries forward the term the superseded row had**, and only an explicit empty term takes one away. Anything else would mean that putting a price up quietly turned a deliberate term into "never expires", with nobody having typed it.

### 2.4 Discounts (the operator's decision of 7 September 2026)

_Amends the founder's decision of 2026-09-03 that a package price is a figure
she sets and no discount percentage is stored anywhere. On 7 September 2026 at
21:49 the operator asked for a discount field on transactions, packages and
individual prices, so that the books show what was given away and why. The
figure is still the founder's to set: a discount is one of the two ways of
setting it, and both are kept._

**One meaning, everywhere.** A discount is money off a **list figure**, shown
on the document that charges for it. It is expressed either as a share of the
list figure (basis points: 1,500 is fifteen per cent) or as a sum of money, and
it is stored as fils either way, with the percentage kept beside it when that
is how it was typed. The arithmetic is `domain/billing/discount.ts` and nothing
else: `applyDiscount` rounds half up to the fils, refuses a negative, a
percentage over one hundred and a sum larger than the list figure.

**On a service price** (`price`): `list_price_fils` is the figure before any
discount, `discount_fils` and `discount_basis_points` are the discount, and
`unit_price_fils` — the column every reader already uses — is what a family
pays net of VAT, held to `list − discount` by a check constraint. A price with
no discount has `list = unit` and a discount of nothing. The list stays
append-only: a new discount is a new price row with a reason.

**On a package price** (`package_price`): the same three columns, with
`list_price_fils` a snapshot of the package's list price at the moment the row
was written, so the arithmetic on the row never depends on a figure that can
be edited later. `amount_fils` stays what the bundle sells for and is held to
`list − discount`. The Add package drawer accepts either the discount or the
price now and computes the other; nothing here derives a package's list price.

**At a sale** (`POST /api/billing/package-purchases`): the sale carries the
price list's own discount, and may carry an **extra discount** for this sale —
a percentage of the same list figure or a sum — with a reason of at least eight
characters. Only the owner, an admin or finance may give one: the three roles
that may forgive a charge (migration 408). The two are combined by
`combineDiscounts`: when both are percentages the combined percentage is applied
once to the list figure, otherwise the two sums are added; the combined discount
may not exceed the list figure, and a sale never charges more than the price
list says. The purchase records the combined percentage, when there is one, and
the extra discount's reason; `net_fils` on the purchase, the credits'
allocation, the deferred balance, revenue recognition and the books all keep
their meaning, because every one of them reads the net **after** discount.

**On the invoice line** (`invoice_line`): `unit_net_fils` is the list figure,
`discount_fils` and `discount_basis_points` are the discount, and the check
becomes `net = quantity × unit − discount`, with the discount held between
nothing and the line's gross. VAT is computed on the net after discount, as UAE
VAT values a supply net of discounts. A line with no discount is unchanged.
The single-visit charge (`app.charge_single_visit`) applies the price row's
own discount and nothing more: no person is present when a session closes.
A call-out fee carries no discount; the waiver is its door.

**On the document.** The rendered invoice prints the unit price as the list
figure and the amount as the net after discount; beneath a discounted line's
description it says the discount, with the percentage when there was one, in
both languages; and the totals gain "Before discount" and "Discount" above the
rows already there, only when a discount was given. The Federal Tax Authority
asks a full tax invoice to state "the amount of any discount offered"; a
simplified one need not, and this does anyway.

**In the books, nothing changes.** Revenue is recorded net of discount, which
is the standard treatment of a discount given at the point of sale. "Discounts
given against list price" as a figure is piece thirteen's
(`docs/SPEC/accounting.md` section 14), reading the invoice lines this section
records; no contra-revenue account is opened for it now.

---

## 3. Payment methods

| Method | Use case | Cash timing | Notes |
|---|---|---|---|
| **Card, stored, auto-charge** | Pay-per-session clients | On session completion | Charge *after* delivery — no deferred revenue, no refund friction |
| **Card, upfront** | Package purchase | Immediately | Full amount, becomes a liability |
| **BNPL — Tabby / Tamara** | Packages | **Immediately, net of fee** | The important one — see below |
| **Bank transfer** | Corporate, large packages | 1–3 days | Needs manual matching |
| **Cash** | Minority of home clients | At the door | Receipt at door, practitioner reconciliation next morning |

### BNPL is the conversion lever

Tabby and Tamara pay you the full amount upfront, minus a merchant fee (typically in the mid-single-digit percent), and take the collection risk. A parent who balks at AED 16,500 will accept AED 2,750 a month for six months without hesitation.

You get all the cash now and carry none of the default risk. For a business whose main sales objection is a four-figure upfront number, this is the single highest-ROI integration in the payments module. Build it in Phase 1, not later.

**Contrast with your own payment plan** (client pays you in instalments directly): you keep the fee but own the collection risk, the dunning workflow, and the awkward conversation. Offer it only for corporate clients on terms.

### The scheduling interlock

One rule the scheduler enforces: **a client past a defined arrears threshold is not auto-scheduled.** An admin can override, and the override is logged with a reason. Without this, a solo operator will absolutely deliver six free sessions before noticing.

---

## 4. Package accounting — where this gets subtle

### 4.1 Cash is not revenue

Sell a AED 16,500 package in January and deliver it over four months. That AED 16,500 is a **contract liability**, not January revenue. Under IFRS 15 the performance obligation is satisfied as sessions are delivered.

For a solo operator this is not academic. Ten packages sold in a launch month is AED 165,000 in the bank and roughly six months of work owed. It feels like a great month. It is a great month *for cash*, and an average one for revenue.

**Put both numbers on the dashboard, adjacent:**

```
Cash collected this month      AED 165,000
Revenue recognised             AED  27,400
Deferred revenue balance       AED 213,600   ← sessions you owe
```

That third number is your obligation. Watch it the way you'd watch a debt.

### 4.2 Allocating package value across components

A package is a bundle of *different* services, and they don't all get delivered at once. You cannot recognise "one twentieth of the package" per session, because the package also contains re-maps and reports.

**Allocate by relative standalone selling price.** Take the Core package:

```
Standalone value:
  20 × nf-session   @ 900    = 18,000
   2 × brain-map    @ 1,200  =  2,400
   2 × report       @ 400    =    800
                      total    21,200

Package price                   16,500
Discount factor  16,500/21,200 = 0.7783

Allocated per unit:
  nf-session   900 × 0.7783 = 700.47
  brain-map  1,200 × 0.7783 = 933.96
  report       400 × 0.7783 = 311.32
```

Each entitlement is created carrying its allocated value. Delivering a session recognises AED 700.47, not AED 825 (16,500/20) and not AED 900. Delivering a re-map recognises AED 933.96.

This is also what makes refunds, expiry and partial delivery computable rather than negotiable.

### 4.3 Refunds, cancellation, expiry

Decide these now and encode them; they cannot be improvised client by client.

**Refund on early termination.** The standard and defensible rule: **refund unused entitlements at the allocated rate, but reprice delivered sessions at the single-session rate.** The client used 6 of 20 and leaves:

```
Paid                                    16,500
Delivered: 6 sessions @ single rate 900  5,400
Refund due                              11,100
```

They lose the volume discount on what they consumed, which is exactly what a volume discount means. State it plainly in the T&Cs at point of sale, show the number in the portal, and let the system compute it.

**Expiry.** _Amended 2026-09-12 on the operator's ruling of 11 September 2026:
a household keeps every session it paid for. This replaces the amendment of
2026-09-10 (decision 9), which is described below as it stood._

**A term is optional, and it belongs to the thing that was sold.** A programme
(`package`) and a price (`price`) each carry the same pair of columns, both
nullable — `expiry_amount`, a whole number, and `expiry_unit`, `'day'` or
`'month'` (migration 412). **Leave them empty and the credits never expire;
put a number with a unit beside it and that is the term, for that exact
programme or that exact price.** Neither column takes a default, so nothing
acquires a term by accident, and a constraint on each table refuses half of
one: a number with no unit beside it cannot be stored at all.

The arithmetic is `expiryOn(purchasedOn, term)` in `domain/billing/expiry.ts`,
which answers a date **or null**. A term in months lands on the same day of
the month that many months later, falling back to the last day where the
target month is shorter — 31 August plus six months is 28 February, never 3
March. A term in days is plain addition. A sale writes what that answers and
nothing else: no date at all where there is no term.
`app.oldest_available_entitlement` (migration 403) has always counted a credit
with no expiry date as usable and sorted it `nulls last`, so what the
catalogue can now say is what the ledger already understood.

**A single session sold ahead of its visit takes the term of the price row it
was sold at**, not a figure in the code. `SINGLE_SESSION_MONTHS` — twelve
months, unchangeable without a build — is gone with this amendment.

**What is said, and to whom.** The Add package and Add price drawers ask for a
number and a unit, and the blank state says what blank means: *"Leave blank and
these credits never expire."* A term is named at the point of sale (the Sell
drawers) and on the invoice's package line in both languages **only where there
is one**; a termless sale names no term rather than carrying a sentence about
not having one. The console's reading screens say **"No expiry"** where a date
would otherwise be, because a dash in a column of dates reads as a figure that
failed to load. A household reads a whole sentence in its own language:
*"These sessions do not expire."* / *"هذه الجلسات لا تنتهي صلاحيتها."*
Warnings at 60 and 30 days are still a later round, once households are on
programmes, and a credit with no date never warns at all. The notice period and
the call-out fee are unchanged.

**The five-year ceiling is at the wire, not in the database.** A term is at
most sixty months, or 1,825 days, which is the same five years
`package.expiry_months`'s own check allowed from migration 401. The database
refuses only a non-positive amount and an unknown unit, deliberately: an empty
term now expresses "forever" properly, so an absurd term is a typing mistake
for a screen to catch rather than a corruption the database must refuse.

**Extensions are gone, one day after they shipped.** _The amendment of
2026-09-10, in force for one day:_ a programme ran six months from purchase
(`package.expiry_months`, six by default), with up to two extensions of three
months each at no charge, each with a reason, one row each in
`package_extension` (migration 410), so a programme ran twelve months at most
and only by asking. The operator approved that on 10 September and it was
merged the same day. On 11 September, having seen it, the operator ruled that
credits do not expire at all unless the practice deliberately says they do,
and on 12 September — asked directly whether an extension should survive now
that a programme can once again carry a term — ruled that it should not: an
extension hard-wired to three months, twice, cannot fit a term measured in
days, and a programme with no term has nothing to extend. Migration 412 drops
`package_extension`, `package_purchase.extended_to` and `extension_reason`,
and the route, the drawer and the rule behind them are deleted. **Migration 410
is not edited**: a merged migration never is
(`.claude/rules/data-model.md`), and it had already been applied to staging and
to production, so the only honest way to undo it is forward. If an extension is
wanted again it is a round of its own, with a brief written against the term as
it now is.

**Nothing had been sold when the rule changed**, on any environment, so no
credit anywhere carries a date it should not. A credit already sold would keep
the date it was sold with in any case: `expires_on` is written once, at the
sale, and nothing here rewrites it.

**Late cancellation and no-show.** _Amended 2026-09-06 on the founder's
decision of 4 September._ Under 24 hours carries a **call-out fee** — AED 150,
the practice's own `scheduling_setting.unfit_fee_fils` — and **never takes a
session from a package**. A visit that cannot go ahead once the practitioner
has arrived carries the same fee, and so does a no-show. One journey made and
no session delivered is one fee, whichever of the three it was; the family
keeps everything it paid for. The fee is posted automatically as a charge on
the household's account (migration 408, `domain/billing`'s `callOutFeeFor`),
because a solo operator will not enforce it manually, and the coordinator has a
one-click waiver with a reason field on the charge itself
(`POST /api/billing/invoices/:id/waiver`).

Two things follow from the shape rather than from the rule. A waived fee stays
on the record and stops counting in `app.billing_ledger`, so what happened is
never rewritten; and nothing was backfilled, so credits taken under the old
rule are still consumed and are given back one at a time through the credit
waiver, which is a decision for a person.

**Once the practice is registered for VAT, a fee is reversed by a credit note
and not by this flag.** A credit note is the Federal Tax Authority's own
mechanism for undoing a taxable supply, with its own number and its own entry
in the VAT return; `waived_at` is a switch on the charge, which is honest
bookkeeping for an unregistered practice and is not a tax document. The flag is
for the unregistered period only, and registering is the moment to build the
credit note rather than widen it.

**A no-show carrying the fee is Claude's default of 2026-09-06, not the
founder's decision**, and it is recorded as one in
`docs/CHANGE-REQUESTS/billing-05.md`. The founder ruled on cancellations and on
a visit unfit at the door; a no-show is the same event from the practice's
side, so it was read the same way. Making a no-show cost a session instead is
one line in `CALL_OUT_FEE_OUTCOMES`.

The rule before the amendment, for anyone reading an old ledger: under 24
hours consumed the entitlement, and the waiver was addressed to the credit
(`POST /api/billing/entitlements/:id/waiver`, which still is, for those rows).

### 4.4 Journal entries

```
Package sold (AED 16,500 cash):
  Dr  Bank                        16,500
      Cr  Contract liability              16,500

Session delivered:
  Dr  Contract liability             700.47
      Cr  Service revenue                    700.47

Single session (charged on completion):
  Dr  Bank                           900
      Cr  Service revenue                     900

BNPL settlement (fee 5.5%):
  Dr  Bank                        15,592.50
  Dr  Payment processing fees        907.50
      Cr  Contract liability              16,500
```

---

## 5. VAT

### 5.1 Every service is standard-rated

McWellness is a wellness business, not a licensed healthcare provider (founder's determination, 2026-09-02), so the healthcare zero-rating does not apply. Every service and package is standard-rated at 5%, whoever pays. The tax advisor confirms this in writing before the first invoice.

The rule that survives the change: **nobody types the rate.** It is computed per line from the standard-rate setting, stored on the line with the version of the setting that produced it, and immutable on an issued invoice. If the rate ever changes, the setting changes and history keeps its snapshots.

```ts
function resolveVat(line: InvoiceLine, settings: VatSettings): VatTreatment {
  return { treatment: 'standard', rateBasisPoints: settings.standardRateBasisPoints, settingVersion: settings.version }
}
```

Register once taxable supplies exceed AED 375,000. File quarterly within 28 days. Keep records five years, which is also the retention period for client records.

### 5.2 Packages

A package's components carry the same treatment, so the allocation from §4.2 needs no VAT split today. The per-line structure stays: if a future component is ever treated differently, the split is a data change, not a schema change.

### 5.3 The question for your tax advisor

**Tax point on prepaid packages.** For a package paid in January and delivered through May, when is VAT due — at payment, or as each session is delivered? UAE VAT generally sets the tax point at the earlier of payment or invoice, which would mean VAT falls due on the full package at sale even though revenue is recognised over months. Take this to a UAE tax advisor with the specific fact pattern, get the answer in writing, and encode it. Do not guess.

### 5.4 What kind of invoice the practice issues

The practice bills households. A household is a private individual and not a
registered person, so what a registered supplier issues to one is a
**simplified tax invoice**, which need not carry the recipient's name and
address. That is the decision, and two things follow from it:

- **The recipient is deliberately not snapshotted.** `invoice` carries the
  supplier's identity and names the client by foreign key. A renamed or erased
  household therefore changes what an already-issued invoice renders as, and
  that is accepted rather than overlooked: a simplified tax invoice does not
  have to state the recipient at all, and the client's own record and the
  ledger both keep the link.
- **The document says so on its face.** The rendered invoice carries the basis
  in its footer, in both languages, so a reader checking it does not have to
  infer why the recipient block is as short as it is.

_Amended in the build, 2026-09-06 (trunk round 29):_ the writer that renders
that document is in two halves. The invoice's own model, layout and wording are
`domain/billing/document` and are billing's; the byte-level half underneath —
the PDF file format, TrueType, Arabic shaping and the extractor the tests read a
finished page back with — is `domain/shared/document`, and the seam that sends a
finished document is `domain/shared/sending.ts`, because the reports stream
renders and sends documents too and `docs/SPEC/OWNERSHIP.md` rule 3 forbids it
importing billing's `domain/`.

Take this to the tax advisor section 5.3 already names, at the same time as the
tax point on prepaid packages, and record the answer here.

### 5.5 E-invoicing

Structure invoices as PINT AE (UBL/XML) objects from day one. Your wave: appoint an Accredited Service Provider by **31 March 2027**, live by **1 July 2027**. Building the invoice as a structured object now costs nothing; retrofitting it in 2027 costs a sprint.

### 5.6 What a money document looks like (the operator's design, 8 September 2026)

_The operator supplied a designed tax invoice and receipt on 8 September 2026 and
asked the platform's own documents to match them. Three questions were answered
in the same message: the fifteen-digit number on the design is the **corporate-tax**
registration and not a VAT one, so documents stay honest until the practice
registers; the **look** is what is being matched, not the period-statement content
the design's example happens to show, which remains piece thirteen's; and the
numbering stays as it is, `INV-000001` and `RCP-000001`._

**The page, top to bottom.** The practice's logo, centred, about 150 points wide.
The document's title, English against the left margin and Arabic against the
right, both large and in the brand violet. The supplier as a block rather than
as labelled rows: legal name in bold, then the licence, the licensing authority
and the corporate-tax registration, each on its own line, with the Arabic
mirror right-aligned opposite. **The address is not in this block** (the
operator's instruction of 8 September 2026): the footer band states it once,
and a page that prints the practice's address twice spends its best space
repeating itself. The band's own line therefore wraps rather than being cut,
because a UAE invoice must state the supplier's address and that line is now
its only home; the band grows upward into the page so its last line stays
where it was and the page number is never crowded. A hairline. The
document's own facts: its reference large and bold on the left with the date
beneath it, and on the right "Billed to" with the household's name and record
number. A hairline. The lines table. The totals in a bordered box against the
right margin. The footer band: a hairline, then the practice's legal name and
address on one centred line and its telephone, email and website on the next,
both small and grey.

**The brand violet is `#380473`**, sampled from the practice's own mark, and it
is used for exactly three things: the two title words, the table's column
headings, and the reference. Everything else stays the ink and two greys the
documents already use. This is the first place the inherited McWellness violet
becomes an accent; `PRODUCT.md`'s open question is answered for **documents
only**, and the console's own rule that hue is reserved for band data and three
status states is untouched.

**The lines table** keeps the columns the platform's invoices actually have —
description, quantity, unit price, and, while the practice is registered, the
VAT rate and the VAT amount — rather than the design example's date column,
which repeats an invoice's single date on every row. Beneath a line's
description sit its Arabic name and, when a discount was given, the design's own
phrasing for it: `List AED 12,150.00 · less AED 2,325.00`. Money is written with
its currency in the cell, `AED 1,650.00`, following the design; the console's
"name the currency once per table" rule is a rule for screens and does not reach
a client-facing document.

**The receipt is the same page with two deliberate departures.** It carries
**no Date / Method / Amount table**: a receipt records one payment, and the four
facts it has — the date received, the method, the payment reference and the
invoice settled — stack as small grey lines under its own reference, where the
invoice puts its dates. A table of three headings above a single row would be
furniture around one fact. And it leaves the **corporate-tax registration** off
the supplier block, as the operator's design does: an invoice is a tax document
and names the registrations the practice holds, while a receipt acknowledges
that money arrived and makes no tax claim in either direction, so the number has
no work to do on it. Everything else — the mark, the title in both languages,
the supplier block, the totals box, the basis sentence and the footer band — is
the invoice's.

**The logo is the practice's own row, not a file in this repository** (migration
909, and the decision of 3 September 2026). The renderer draws it when the
practice has one and falls back to the wordmark set in type when it does not, so
a practice with no logo still gets a document that looks deliberate. The bytes
are read from the practice's `practice_logo` document and embedded; nothing
about the document's own snapshot changes, because a logo is the practice's
mark today and re-rendering last year's invoice with this year's mark is the
one drift a reader will neither notice nor be harmed by.

**The footer needs three facts the practice did not record**: a telephone number
for the document, an email address and a website. They join `tenant` and are
snapshotted onto the invoice like every other supplier fact, so a document keeps
saying what it said.

**Nothing about what the document claims changes.** The heading is still
"Invoice" and not "Tax Invoice" while the practice is unregistered, the
corporate-tax number is still labelled as itself and never as a VAT number, the
VAT column and the VAT line still appear only under a registration, and the
footer still says which of the two the document is. The design is a design.

---

## 6. Reconciliation

The tedious part that breaks quietly if you skip it.

**Gateway settlements arrive net and batched.** A Tuesday settlement of AED 42,317.50 covers eleven transactions minus fees. You need `SettlementBatch → Payment → Invoice` matching, with an exception queue for anything that doesn't tie out.

**Cash at the door** needs a two-step: practitioner records collection in the app, then reconciles physical cash at the hub next morning. Any variance is flagged. This is a genuine fraud and loss vector in home-service businesses.

**Bank transfers** need reference matching with a manual fallback — clients will pay without the reference every time.

**Daily close:** cash collected = payments recorded = settlements expected. Any gap surfaces within 24 hours, not at month-end.

---

## 7. Accounting stack

**Keep in your system:** the entitlement ledger, revenue recognition, VAT classification, invoice generation, payment plan state, deferred revenue balance. These are domain-specific and no accounting package models them correctly.

**Push to Zoho Books** (UAE VAT support, FTA-oriented, widely used locally, good API): journal entries, the general ledger, the trial balance, bank reconciliation, VAT return preparation, financial statements.

Post journals nightly, batched, idempotent, with a reconciliation report proving your subledger ties to their GL. Never let the two drift.

**Chart of accounts, minimum:**

```
1010  Bank — operating
1200  Accounts receivable
1300  Gateway clearing
2400  Contract liability (deferred revenue)   ← the important one
2500  VAT payable
4000  Service revenue — sessions (standard-rated)
4100  Service revenue — assessments and reports (standard-rated)
4200  Service revenue — corporate
5000  Payment processing fees
5100  Refunds and credits
```

---

## 8. The dashboard

Six numbers, on one screen:

```
Cash collected (MTD)            what came in
Revenue recognised (MTD)        what you actually earned
Deferred revenue balance        what you owe in sessions
Sessions delivered / capacity   utilisation
Contribution margin / session   net of travel, Salik, consumables
Collection rate                 invoiced vs collected
```

**Contribution margin per session is the number solo operators get wrong.** A AED 900 session with 50 minutes of round-trip driving, two Salik crossings at AED 6.30, parking, and consumables is not a AED 900 session. Compute it honestly and it will change how you price, how you zone, and which clients you take.

---

## 9. Build order

**Phase 1** — service catalogue, entitlement ledger, single sessions with stored-card auto-charge on completion, packages with upfront payment, BNPL, invoices with derived VAT, deferred revenue ledger, refund calculator, client portal payments, Zoho journal posting.

**Phase 2** — payment plans and dunning, corporate invoicing on terms, settlement reconciliation with exception queue, cash-at-door reconciliation, contribution margin reporting.

**Phase 3** — insurance claim generation and reimbursement tracking, PINT AE e-invoicing via ASP, package profitability analytics.

---

## 10. Decide before building

1. **Final price list.** The table in §2.2 is a defensible starting point from competitor data, not a recommendation — test it.
2. **Refund policy wording**, reviewed by a lawyer, shown at point of sale.
3. ~~**Expiry period** and whether extensions are discretionary or ruled.~~ **Answered 2026-09-11 and 2026-09-12** (§4.3): there is no expiry period unless the practice sets one, per programme and per price, in days or months; there are no extensions, because a programme with no term has nothing to extend.
4. **Tax point on prepaid packages** — in writing, from a UAE tax advisor.
5. **BNPL provider** — Tabby and Tamara both work; compare merchant fees at your ticket size.
