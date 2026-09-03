# billing-03: the money's permissions, the practice's own prices, and two screens that are not billing's

Five requests from the billing stream's second pull request (packages,
entitlements and balances, payments with invoice numbers). Every one of them
sits outside `docs/SPEC/OWNERSHIP.md`'s billing rows, so none is made on the
branch: this file is what the integrator applies on `main`, and what the
other two streams pick up.

Nothing in the pull request is blocked by any of them. Items 1 and 2 are
already working, composed from what exists today; applying them replaces a
composition with the real thing. Items 3, 4 and 5 are what other people's
screens need in order to show a figure this pull request now computes.

| # | Where | What | Blocks |
|---|---|---|---|
| 1 | `domain/shared/actor.ts` | Eight billing actions with their role floors | nothing |
| 2 | `db/seed/**` | The practice's prices, and its three programmes | nothing; the money screens are empty until it lands |
| 3 | `app/admin/clients/OverviewTab.tsx` (client-record) | A balance panel on the client record | nothing |
| 4 | `app/therapist/**` (scheduling) | "Session 3 of 15" and what is owed, on the stop card | nothing |
| 5 | `app/api/appointments/**` (scheduling) | Call the notice-period rule when a visit is called off | the late-cancellation charge never fires until it lands |

---

## 1. Eight billing actions in `domain/shared/actor.ts`

**What.** Add eight action types and their rules, in the shape
`billing.price.read` and `billing.price.write` already have.

**Why.** `app/api/billing/access.ts` names each of the pull request's
permissions as its own small function, and every one of those functions today
calls `canActor` with an action that happens to have the right audience rather
than the right name. That is honest as a stop-gap and wrong as a
destination: "may this person sell a package" and "may this person set a
price" are one audience today and two decisions tomorrow, and the moment the
practice hires a coordinator who may take a payment but not amend the price
list, the difference has to exist somewhere. It belongs in the one file that
already holds every other such rule.

**The floors, and where each comes from.** `docs/SPEC/billing.md`'s "Who uses
it" table gives the office roles; the row security in
`db/policies/billing/ledger.sql` is the floor beneath all of them, and none of
these is wider than it.

| Action | owner | admin | finance | lead practitioner | practitioner | client contact |
|---|---|---|---|---|---|---|
| `billing.package.read` | yes | yes | yes | yes | no | no |
| `billing.package.write` | yes | yes | yes | no | no | no |
| `billing.sale.write` | yes | yes | yes | no | no | no |
| `billing.payment.write` | yes | yes | yes | no | no | no |
| `billing.waiver.write` | yes | yes | yes | no | no | no |
| `billing.invoice.read` | yes | yes | yes | yes | no | no |
| `billing.refund.read` | yes | yes | yes | yes | no | no |
| `billing.balance.read` | yes | yes | yes | yes | own schedule | own client |

Two of those rows deserve their reason written down.

**`billing.balance.read` reaches further than any other billing action**, and
it is the only one that does. A practitioner needs it: the stop card at the
door says "Session 3 of 15" and what is owed, and the person driving there is
the one who needs both. The action does not decide how far they reach —
`app.client_visible_to_practitioner` does (ninety days back, thirty forward,
confirmed visits only), and it is row security, not a screen. The action says
only that the role may ask. A client contact reads their own client's, through
`ctx.clientIds`, exactly as `client.read` already treats it.

**`billing.refund.read` keeps the lead practitioner**, deliberately, rather
than narrowing to the three money roles. A refund quote is arithmetic over a
purchase and its credits — rows `ledger_readers` already lets a lead
practitioner read. A route stricter than the row security beneath it is a
courtesy pretending to be a boundary.

**Diff.**

```diff
--- a/domain/shared/actor.ts
+++ b/domain/shared/actor.ts
@@
   | { type: 'billing.price.read' }
-  | { type: 'billing.price.write' };
+  | { type: 'billing.price.write' }
+  | { type: 'billing.package.read' }
+  | { type: 'billing.package.write' }
+  | { type: 'billing.sale.write' }
+  | { type: 'billing.payment.write' }
+  | { type: 'billing.waiver.write' }
+  | { type: 'billing.invoice.read' }
+  | { type: 'billing.refund.read' }
+  | { type: 'billing.balance.read'; clientId: string };
@@
     case 'billing.price.write':
       // The price list; the service catalogue itself stays with the owner and an admin.
       return hasRole(actor, 'owner', 'admin', 'finance');
+    case 'billing.package.read':
+    case 'billing.invoice.read':
+    case 'billing.refund.read':
+      // The bundle catalogue, the invoice book and a refund quote: the same
+      // audience the price list has. A refund quote is arithmetic over rows
+      // a lead practitioner may already read (db/policies/billing/ledger.sql),
+      // so narrowing it here would be a courtesy pretending to be a boundary.
+      return hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'finance');
+    case 'billing.package.write':
+    case 'billing.sale.write':
+    case 'billing.payment.write':
+    case 'billing.waiver.write':
+      // Recording money: the owner, an admin and finance. One audience today,
+      // four names, so a coordinator who may take a payment but not amend the
+      // price list is a change to one line rather than to a route.
+      return hasRole(actor, 'owner', 'admin', 'finance');
+    case 'billing.balance.read':
+      // The one billing action that reaches past the office. A practitioner
+      // asks because the stop card says "Session 3 of 15" and what is owed;
+      // how far they reach is app.client_visible_to_practitioner's to decide,
+      // not this file's. A client contact reads their own client's.
+      if (hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'finance', 'practitioner')) {
+        return true;
+      }
+      return hasRole(actor, 'client_contact') && (ctx.clientIds ?? []).includes(action.clientId);
     default: {
```

**What billing changes when it lands.** `app/api/billing/access.ts` keeps all
eight wrapper functions — the routes should name what they are doing, not the
permission that happens to cover it — and every body becomes a single
`canActor` call with its own action. `mayReadBalance` loses its two `hasRole`
branches, which are the only place in the billing routes where a role is
consulted outside `canActor`. No route's behaviour changes: the floors above
are exactly the audiences composed today.

---

## 2. The practice's own prices and its three programmes, in `db/seed/**`

**What.** The seed writes six services and no prices. Add a price for each
service the practice charges for, and the three programmes the founder sells,
each with its contents, its list price and its launch price.

**Why.** Everything billing shipped is invisible on a seeded database. The
price list is empty, so the Packages drawer offers no service to put in a
bundle, so no package can be built, so nothing can be sold, so no balance and
no invoice exists to look at. Every screen in this pull request is correct and
blank. It also means no reviewer can see the arithmetic behind
`docs/SPEC/billing.md` section 4.2 working on the practice's own figures,
which is the one thing worth looking at.

**The figures are the founder's**, taken as decisions on 2026-09-03 and
carried here as data, not derived: a neurofeedback session is AED 700 net, a
QEEG brain map AED 825 net including the results call that is never sold
alone, a consultation is bundled and never sold alone, and Compassionate
Inquiry has no price yet. A programme's list price is what its contents come
to bought one at a time; its launch price is a figure the founder set, and no
percentage is stored anywhere.

| Programme | Consultation | Brain maps | Sessions | List | Now |
|---|---|---|---|---|---|
| Silver | 1 | 2 | 15 | 12,150.00 | 10,325.00 |
| Gold | 2 | 3 | 25 | 19,975.00 | 16,975.00 |
| Platinum | 3 | 4 | 40 | 31,300.00 | 26,605.00 |

All net of VAT; 5% is added on top at write time from the `vat_setting` row
the tenant trigger creates (`400_billing_catalogue.sql`), never typed.

Two services are priced at zero on purpose rather than left unpriced. A
consultation and a results call are included in something else and are never
billed, and a zero price says that; leaving them off the list would instead
send every delivered one to `billing_exception` as "no credit and no price"
(`404_billing_consumption.sql`). Compassionate Inquiry is genuinely unpriced —
the founder has not set a figure — and is left off, which is exactly the case
the exception queue exists for.

**A note on ids.** `seedId` has one hex character left for three of the four
new tables, so the diff widens it by one line to accept a two-character kind
and uses `d0`–`d3` for the billing catalogue. That keeps `e` and `f` free for
the streams that come after.

**Diff.**

```diff
--- a/db/seed/generate.ts
+++ b/db/seed/generate.ts
@@
-/** 0000000K-0000-4000-8000-000000000NNN: readable, fixed, and shaped like a v4 uuid. */
+/** 0000000K-0000-4000-8000-000000000NNN: readable, fixed, and shaped like a v4 uuid.
+ *  `kind` is one or two hex characters; the single characters are nearly spent. */
 export function seedId(kind: string, n: number): string {
-  return `0000000${kind}-0000-4000-8000-${String(n).padStart(12, '0')}`;
+  return `${'0000000'.slice(kind.length - 1)}${kind}-0000-4000-8000-${String(n).padStart(12, '0')}`;
 }
@@
 export type SeedServiceType = {
   id: string;
   code: string;
   name: string;
   nameAr: string;
   durationMinutes: number;
   requiresCertification: string | null;
   deliveryModes: DeliveryMode[];
 };
+/** One service's price, net of VAT. Append-only in the database; one row each here. */
+export type SeedPrice = {
+  id: string;
+  serviceTypeId: string;
+  unitPriceFils: number;
+  vatRateBasisPoints: number;
+  vatSettingVersion: number;
+  validFrom: string;
+  amendmentReason: string;
+};
+export type SeedPackageComponent = {
+  id: string;
+  packageId: string;
+  serviceTypeId: string;
+  quantity: number;
+  lineNo: number;
+};
+export type SeedPackage = {
+  id: string;
+  code: string;
+  name: string;
+  nameAr: string;
+  /** What the contents come to bought one at a time. Set by the practice, never derived. */
+  listPriceFils: number;
+  expiryMonths: number;
+  components: SeedPackageComponent[];
+  /** What it is selling for today, with the reason behind the figure. */
+  price: {
+    id: string;
+    amountFils: number;
+    vatRateBasisPoints: number;
+    vatSettingVersion: number;
+    validFrom: string;
+    amendmentReason: string;
+  };
+};
@@
 export type SeedData = {
   today: string;
   tenant: SeedTenant;
   users: SeedUser[];
   roles: SeedRole[];
   serviceTypes: SeedServiceType[];
+  prices: SeedPrice[];
+  packages: SeedPackage[];
   practitioners: SeedPractitioner[];
```

```diff
@@ after the SERVICES const
 ];
 
+/**
+ * What the practice charges, net of VAT (the founder's decisions of
+ * 2026-09-03). A consultation, a discovery call and a results call are
+ * included in something else and never billed, so they carry a zero price
+ * rather than no price: an unpriced service that is delivered goes to
+ * billing_exception, and a free call is not an exception. Compassionate
+ * Inquiry is deliberately absent — no figure has been set.
+ */
+const PRICES: readonly { code: string; fils: number; why: string }[] = [
+  { code: 'discovery-call', fils: 0, why: 'Free of charge; never billed.' },
+  { code: 'consultation', fils: 0, why: 'Included in a programme; never sold alone.' },
+  { code: 'brain-map', fils: 82_500, why: 'Opening price list.' },
+  { code: 'results-call', fils: 0, why: "Included in the brain map's price; never billed." },
+  { code: 'nf-session', fils: 70_000, why: 'Opening price list.' },
+];
+
+/**
+ * The three programmes. The list price is what the contents come to one at a
+ * time; the price now is the founder's own launch figure, and no discount
+ * percentage is stored anywhere (docs/SPEC/billing.md section 2.3, and the
+ * founder's decision of 2026-09-03).
+ */
+const LAUNCH_REASON = "Launch pricing, ends on the founder's word.";
+const PACKAGES: readonly {
+  code: string;
+  name: string;
+  nameAr: string;
+  listFils: number;
+  nowFils: number;
+  contents: { code: string; quantity: number }[];
+}[] = [
+  {
+    code: 'silver',
+    name: 'Silver',
+    nameAr: 'الفضية',
+    listFils: 1_215_000,
+    nowFils: 1_032_500,
+    contents: [
+      { code: 'consultation', quantity: 1 },
+      { code: 'brain-map', quantity: 2 },
+      { code: 'nf-session', quantity: 15 },
+    ],
+  },
+  {
+    code: 'gold',
+    name: 'Gold',
+    nameAr: 'الذهبية',
+    listFils: 1_997_500,
+    nowFils: 1_697_500,
+    contents: [
+      { code: 'consultation', quantity: 2 },
+      { code: 'brain-map', quantity: 3 },
+      { code: 'nf-session', quantity: 25 },
+    ],
+  },
+  {
+    code: 'platinum',
+    name: 'Platinum',
+    nameAr: 'البلاتينية',
+    listFils: 3_130_000,
+    nowFils: 2_660_500,
+    contents: [
+      { code: 'consultation', quantity: 3 },
+      { code: 'brain-map', quantity: 4 },
+      { code: 'nf-session', quantity: 40 },
+    ],
+  },
+];
```

```diff
@@ in generate(), immediately after the `service` helper
   const service = (code: string): SeedServiceType => {
     const found = serviceTypes.find((s) => s.code === code);
     if (!found) throw new Error(`No service ${code}.`);
     return found;
   };
 
+  // The price list opens on the day the practice went live, so every price is
+  // already in force on the seed's own "today".
+  const PRICED_FROM = '2026-01-01';
+  const prices: SeedPrice[] = PRICES.map((row, i) => ({
+    id: seedId('d0', i + 1),
+    serviceTypeId: service(row.code).id,
+    unitPriceFils: row.fils,
+    vatRateBasisPoints: 500,
+    vatSettingVersion: 1,
+    validFrom: PRICED_FROM,
+    amendmentReason: row.why,
+  }));
+  let componentCount = 0;
+  const packages: SeedPackage[] = PACKAGES.map((bundle, i) => {
+    const id = seedId('d1', i + 1);
+    return {
+      id,
+      code: bundle.code,
+      name: bundle.name,
+      nameAr: bundle.nameAr,
+      listPriceFils: bundle.listFils,
+      expiryMonths: 12,
+      components: bundle.contents.map((line, lineNo) => ({
+        id: seedId('d2', ++componentCount),
+        packageId: id,
+        serviceTypeId: service(line.code).id,
+        quantity: line.quantity,
+        lineNo: lineNo + 1,
+      })),
+      price: {
+        id: seedId('d3', i + 1),
+        amountFils: bundle.nowFils,
+        vatRateBasisPoints: 500,
+        vatSettingVersion: 1,
+        validFrom: PRICED_FROM,
+        amendmentReason: LAUNCH_REASON,
+      },
+    };
+  });
```

```diff
@@ the return at the end of generate()
     users,
     roles,
     serviceTypes,
+    prices,
+    packages,
     practitioners,
```

```diff
--- a/db/seed/apply.ts
+++ b/db/seed/apply.ts
@@ after the service_type loop
         delivery_modes: s.deliveryModes,
         created_by: owner,
       });
     }
 
+    // The price list, then the programmes. Both after service_type, which they
+    // reference, and both carrying the VAT rate and setting version stamped at
+    // write time from vat_setting version 1 — the row 400_billing_catalogue.sql's
+    // tenant trigger created when the tenant above was inserted (CLAUDE.md rule 6:
+    // nobody types a rate).
+    for (const p of data.prices) {
+      await insert('price', {
+        id: p.id,
+        tenant_id: t.id,
+        service_type_id: p.serviceTypeId,
+        unit_price_fils: p.unitPriceFils,
+        vat_rate_basis_points: p.vatRateBasisPoints,
+        vat_setting_version: p.vatSettingVersion,
+        valid_from: p.validFrom,
+        amendment_reason: p.amendmentReason,
+        created_by: owner,
+      });
+    }
+
+    for (const p of data.packages) {
+      await insert('package', {
+        id: p.id,
+        tenant_id: t.id,
+        code: p.code,
+        name: p.name,
+        name_ar: p.nameAr,
+        list_price_fils: p.listPriceFils,
+        expiry_months: p.expiryMonths,
+        created_by: owner,
+      });
+      for (const c of p.components) {
+        await insert('package_component', {
+          id: c.id,
+          tenant_id: t.id,
+          package_id: c.packageId,
+          service_type_id: c.serviceTypeId,
+          quantity: c.quantity,
+          line_no: c.lineNo,
+          created_by: owner,
+        });
+      }
+      await insert('package_price', {
+        id: p.price.id,
+        tenant_id: t.id,
+        package_id: p.id,
+        amount_fils: p.price.amountFils,
+        vat_rate_basis_points: p.price.vatRateBasisPoints,
+        vat_setting_version: p.price.vatSettingVersion,
+        valid_from: p.price.validFrom,
+        amendment_reason: p.price.amendmentReason,
+        created_by: owner,
+      });
+    }
+
     for (const l of data.locations) {
@@ describeSeed's order
     'service_type',
+    'price',
+    'package',
+    'package_component',
+    'package_price',
     'practitioner',
```

**What else moves.** `db/seed/render.ts` needs nothing: it replays `applySeed`
against a recorder, so the new statements render themselves. Three trunk-owned
tests count rows and will need their expectations raised —
`db/seed/generate.test.ts`, `db/seed/apply.test.ts` and `tests/db/seed.test.ts`
— by 5 prices, 3 packages, 9 components and 3 package prices. `assertSynthetic`
is untouched: none of this is personal data.

**How to check it landed.** `pnpm db:reset && pnpm seed`, then open Billing:
Prices lists five services with VAT and a total beside each, and Packages
shows Silver, Gold and Platinum with both figures and no drift warning —
each list price equals its contents' total exactly, which is what the founder
set and what the arithmetic in `domain/billing/allocation.ts` divides.

---

## 3. A balance panel on the client record's Overview (client-record)

**What.** On `app/admin/clients/OverviewTab.tsx`, add rows to the existing
`record-facts` list showing what the client holds and what they owe.

**Why.** The money is the first question anyone opening a record asks, and the
Billing screen answers it one client at a time, in a different place, through
a search box. It belongs on the record.

**Where the figures come from.** One request, no arithmetic in the component:

```
GET /api/billing/clients/:clientId/balance
```

answering (`app/api/billing/ledger-schema.ts`, `BalanceResponse`) with the
delivered and remaining counts per service, the remaining value, the next
expiry with its warning, the charged, paid and outstanding totals, and the
client's purchases. `domain/billing/balanceFor` computes it; the route reads
the ledger view. Every figure is already formatted-ready in integer fils.

**What to show, and what not to.** Three rows are enough on Overview: sessions
as "3 of 15", the outstanding balance, and — only when the answer is not
"none" — how long the credits have left. The word "AED" belongs to the row
label, not to every figure (`app/admin/billing/money.ts` writes the figure
bare). Formatting money is `money.ts`'s job and nowhere else's; import
`formatFils` rather than writing a second formatter, and if that import
crossing from `app/admin/billing` into `app/admin/clients` is unwelcome, say
so and billing will move it to `domain/shared` by its own change request.

The permission is `billing.balance.read` (item 1). A finance-only reader
already sees Overview, and this is exactly the tab they are there for.

---

## 4. "Session 3 of 15" and what is owed, on the practitioner's stop card (scheduling)

**What.** When the day sheet's stop card exists, put two facts on it: which
session of the programme this is, and whether anything is owed at the door.

**Why.** `docs/SPEC/billing.md` section 1 names "Session 3 of 15" as the thing
the ledger exists to be able to say, and the person who needs it is the one
driving to the house. Cash at the door is section 6's reconciliation risk: a
practitioner who does not know a balance is outstanding cannot collect it.

**How.** The same route as item 3,
`GET /api/billing/clients/:clientId/balance`. A practitioner may call it: the
action allows the role and `app.client_visible_to_practitioner` scopes it to a
client on their own schedule — ninety days back, thirty forward, confirmed
visits only. A client outside that window answers 404 rather than an empty
balance, which is the correct answer to "may I see this" and not a bug.

Nothing about this is billing's to build: the stop card is
`app/therapist/**`, and this is a request, not a plan. If the shape the card
wants differs from what the route returns, say so and billing will change the
route.

---

## 5. Calling the notice-period rule when a visit is called off (scheduling)

**What.** In whichever route cancels an appointment, ask
`isLateCancellation` from `domain/billing` and write `cancelled_late` rather
than `cancelled` when it answers true.

```ts
import { isLateCancellation } from '../../../domain/billing';

const status = isLateCancellation(appointment.windowStart, now()) ? 'cancelled_late' : 'cancelled';
```

**Why.** `appointment_status` has carried `cancelled_late` since
`200_appointment.sql`, and `404_billing_consumption.sql` hangs the charge off
it: a visit called off inside the notice period consumes a credit, with the
coordinator's one-click waiver behind
`POST /api/billing/entitlements/:id/waiver`
(`docs/SPEC/billing.md` section 4.3, and the founder's decision of
2026-09-03 — twenty-four hours). The trigger is built, tested and idle: until
something writes `cancelled_late`, the rule the founder decided never fires
and a late cancellation costs the practice a visit for nothing.

**Why the rule is in `domain/billing` and not in scheduling.** The scheduler
decides that a visit is cancelled; this decides whether the client pays for
it. The notice period is a money rule with a money consequence, and it is
already pure, tested and exported —
`isLateCancellation(windowStart, cancelledAt, noticeHours = 24)`. Importing it
across streams is what `docs/SPEC/OWNERSHIP.md` rule 3 forbids, so one of two
things should happen and scheduling should say which it prefers: either
`isLateCancellation` and `LATE_CANCELLATION_NOTICE_HOURS` move to
`domain/shared` (billing will raise that change request), or scheduling calls
a billing route to ask. Billing's own preference is the move: it is nine lines
of pure arithmetic with no billing dependency at all, and a network call to
decide a status inside a cancellation transaction is a worse shape than an
import.

**A no-show** needs no rule: `no_show` is already a status, and the same
trigger charges it.
