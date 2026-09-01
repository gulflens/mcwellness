# Money — Payments, Billing & Accounting Spec

*Single sessions, packages, and the accounting that keeps them honest.*

---

## 1. The one idea that makes all of this simple

**Everything is an entitlement ledger.**

A client holds entitlements — credits for a specific service type. A session consumes one. That's it.

- Buy a single session → 1 entitlement, consumed immediately
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
  vatTreatment: 'zero' | 'standard'
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
  isClinical: boolean            // drives VAT — see §5
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

---

## 3. Payment methods

| Method | Use case | Cash timing | Notes |
|---|---|---|---|
| **Card, stored, auto-charge** | Pay-per-session clients | On session completion | Charge *after* delivery — no deferred revenue, no refund friction |
| **Card, upfront** | Package purchase | Immediately | Full amount, becomes a liability |
| **BNPL — Tabby / Tamara** | Packages | **Immediately, net of fee** | The important one — see below |
| **Bank transfer** | Corporate, large packages | 1–3 days | Needs manual matching |
| **Cash** | Minority of home clients | At the door | Receipt at door, therapist reconciliation next morning |

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

**Expiry.** 12 months from purchase is reasonable and standard. Be conservative here — aggressive expiry on prepaid healthcare invites both consumer-protection scrutiny and bad reviews. Warn at 60 and 30 days, and allow a documented extension for medical reasons.

**Late cancellation and no-show.** Under 24 hours consumes the entitlement. This is standard practice and it must be automatic, because a solo operator will not enforce it manually. Give the coordinator a one-click waiver with a reason field.

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

### 5.1 Classification is per line, derived from the clinical record

From the market study: qualifying healthcare supplied **to the patient** is zero-rated with full input VAT recovery; wellness services and B2B supplies where the recipient isn't the patient are standard-rated at 5%.

```ts
function resolveVat(line: InvoiceLine, ctx: ClinicalContext): VatTreatment {
  if (ctx.recipientType !== 'patient') return 'standard'  // corporate billing
  if (!line.serviceType.isClinical)   return 'standard'   // performance/wellness
  if (!ctx.hasCodedDiagnosis)         return 'standard'   // no documented condition
  if (ctx.reportPurpose === 'school' || ctx.reportPurpose === 'immigration')
                                       return 'standard'
  return 'zero'
}
```

**Never let an admin pick the VAT rate.** It is computed, stored with a reference to the clinical evidence that justified it, and immutable on the issued invoice. The FTA audits by comparing patient files against invoices — your defence is that the invoice was *derived from* the file.

Register once taxable supplies exceed AED 375,000 (zero-rated supplies count toward the threshold). File quarterly within 28 days. Keep records five years — separate from and shorter than the 25-year clinical retention.

### 5.2 The mixed package problem

If a package contains both zero-rated clinical sessions and a standard-rated component (a performance-coaching add-on, say), the invoice must split VAT per component using the same allocation from §4.2. Design for it now even if v1 sells only clinical packages.

### 5.3 The question for your tax advisor

**Tax point on prepaid packages.** For a package paid in January and delivered through May, when is VAT due — at payment, or as each session is delivered? UAE VAT generally sets the tax point at the earlier of payment or invoice, which would mean VAT falls due on the full package at sale even though revenue is recognised over months. For a wholly zero-rated package this is immaterial. For any package with standard-rated components it is a real cash-timing question.

Take this to a UAE tax advisor with the specific fact pattern, get the answer in writing, and encode it. Do not guess, and do not let me guess for you.

### 5.4 E-invoicing

Structure invoices as PINT AE (UBL/XML) objects from day one. Your wave: appoint an Accredited Service Provider by **31 March 2027**, live by **1 July 2027**. Building the invoice as a structured object now costs nothing; retrofitting it in 2027 costs a sprint.

---

## 6. Reconciliation

The tedious part that breaks quietly if you skip it.

**Gateway settlements arrive net and batched.** A Tuesday settlement of AED 42,317.50 covers eleven transactions minus fees. You need `SettlementBatch → Payment → Invoice` matching, with an exception queue for anything that doesn't tie out.

**Cash at the door** needs a two-step: therapist records collection in the app, then reconciles physical cash at the hub next morning. Any variance is flagged. This is a genuine fraud and loss vector in home-service businesses.

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
4000  Service revenue — clinical (zero-rated)
4100  Service revenue — wellness (standard)
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
3. **Expiry period** and whether extensions are discretionary or ruled.
4. **Tax point on prepaid packages** — in writing, from a UAE tax advisor.
5. **BNPL provider** — Tabby and Tamara both work; compare merchant fees at your ticket size.
