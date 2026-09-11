# billing-11: a programme's term becomes optional, and the extension feature goes

Six things this round could not settle inside billing's own paths: the seed
every database is built from is the trunk's; the three programmes already on
the live price list are real rows nothing in this branch may touch; the
adults-only gate that listed the extension table lives in the client-portal
stream's policy folder; the household's own money route and screen are that
stream's too; one accounting fixture wrote the term in months; and three of the
trunk's pages described the extension feature as live. All six are recorded
here rather than reached for, as `CLAUDE.md` rule 10 requires for a shared-zone
change.

**What the round is.** The operator ruled on 11 September 2026 that a
household keeps every session it paid for, and on 12 September set the shape:
an empty term means the credits never expire, and a number with a unit beside
it means that term, for that exact programme or that exact price. Migration 412
puts `expiry_amount` and `expiry_unit` (`'day'` or `'month'`) on `package` and
on `price`, both nullable and whole or absent; backfills and drops
`package.expiry_months`; makes `package_purchase.expires_on` nullable; and
removes the extension feature entirely — `package_extension`,
`package_purchase.extended_to` and `extension_reason` — refusing rather than
dropping if any environment holds a single extension row. This reverses
`docs/CHANGE-REQUESTS/billing-10.md`, which shipped two days earlier; what
became of each of its items is written at the foot of that file.

---

## 1. `db/seed/**` — the seeded programmes carry no term

**What.** `db/seed/generate.ts`'s `PACKAGE_EXPIRY_MONTHS = 6` is deleted, not
translated: in its place two constants, `PACKAGE_EXPIRY_AMOUNT` and
`PACKAGE_EXPIRY_UNIT`, both `null`, with a comment saying why. The
`SeedPackage` shape trades `expiryMonths` for `expiryAmount` and `expiryUnit`.
`db/seed/apply.ts` writes the pair instead of the dropped column.
`db/seed/generate.test.ts` asserts the new fact — Silver, Gold and Platinum all
seed with no term — and the case named *"sells six-month programmes from this
round"*, a name this round reverses, is renamed *"sells programmes that never
expire, which is what the practice does"*.

**Why.** Migration 412 drops `package.expiry_months`, so a seed still writing
it fails outright, and every billing database test seeds. And the value
matters as much as the column: a seeded default of six months would quietly
teach every freshly built environment that programmes expire, which is the
opposite of the ruling. A term is something the practice sets deliberately, per
programme or per price, never a default it inherits.

**Which spec.** `docs/SPEC/billing.md` section 4.3 (amended 2026-09-12) and
migration `db/migrations/412_optional_package_term.sql`.

**The file.** `db/seed/generate.ts`, its test `db/seed/generate.test.ts`, and
`db/seed/apply.ts`, all the trunk's (`docs/SPEC/OWNERSHIP.md`: `db/seed/**`,
"Synthetic generators"): *applied by the controller on the branch*, pulled
forward from the round's last task because it blocked every task behind it.

---

## 2. To production: the three live programmes, blanked by a data step at the live pass

**What.** Once migration 412 has run on production:

```sql
update package
   set expiry_amount = null,
       expiry_unit   = null
 where tenant_id = <the practice's id, read back first>
   and code in ('silver', 'gold', 'platinum');
```

run under the runner's audit context (`app.actor_id`, `app.actor_roles`,
`app.request_id`, `app.reason` and `app.tenant_id` set, as every write to a
billing row requires), on the operator's word — not part of this pull request,
and not run by it. **Both columns in one statement**: the wholeness constraint
(`package_expiry_term_is_whole`) refuses a row with one and not the other, so a
statement that cleared only the amount would fail, which is the constraint
doing its job.

**Why.** Migration 412's backfill carries every existing row's meaning across
unchanged — a programme created with twelve months reads `12` and `'month'`
afterwards — because it fixes structure and what a practice charges for is the
practice's own to set. So after 412 the three programmes the practice sells
still read twelve months, which is what they were created with on 2026-09-07
and what the operator has now ruled they should not carry. A family sold Silver
the day after the deploy, before this step, would be sold a twelve-month term
nobody wants.

**This replaces billing-10's item 2**, which would have moved the same three
programmes from twelve months to six. That step was never run.

**Which spec.** `docs/SPEC/billing.md` section 4.3.

**The file.** Production's `package` table — not a file this round edits, and
not a write this branch's pull request makes. *Owed at the live pass, on the
operator's word, recorded in `docs/PRODUCTION.md` when it is run.* As billing-10
required of the step it replaces: production's own three codes are read back
and confirmed to be exactly `silver`, `gold` and `platinum` before the update
runs, and the practice's own `tenant_id` is read back and written into the
statement, so it names the practice it is meant for rather than every row that
happens to share a code.

---

## 3. `db/policies/portal/money.sql` — the adults-only gate names six tables again

**What.** `'package_extension'` leaves the array `portal_money_adults` loops
over, and the comment above it says six tables rather than seven, and why the
seventh went. Nothing else about the policy moves: the same restrictive
`select`, the same `app.actor_is_adult_contact_of`, the same staff-role terms.

**Why.** Migration 412 drops `package_extension`. The policy runner applies all
twenty-six policy files in one transaction, and `drop policy if exists … on` a
table that no longer exists raises `42P01` — the `if exists` covers the policy,
not the table. Left alone, this file would have failed every `db:migrate` and
every database test after 412, leaving a database with row security on and no
policies at all. It was edited in the same commit as the migration for that
reason.

**One thing this makes true again.** billing-10's item 4 recorded that
migration 702's `-- rollback:` block names six tables and was therefore "one
line short" once 410 added a seventh. With the seventh gone, that block lists
exactly what the policy narrows, and nothing is short.

**Which spec.** `docs/SPEC/client-portal.md` sections 5 (rule 5) and 6.5.

**The file.** `db/policies/portal/money.sql`, the client-portal stream's
(`docs/SPEC/OWNERSHIP.md`: `db/policies/portal/**`): *applied by the builder on
the branch*, with the test that proved the seventh table —
`tests/portal/db/money_visibility.test.ts`'s case *"hides an extension … from
the young person's own login"*, its fixture and its helper — **deleted rather
than repaired**, because there is no longer anything to hide. The adults-only
gate it guarded is still proved by the four cases around it. No migration: a
policy change never needs one.

---

## 4. The household's money route and screen — a programme with no end says so

**What.** `app/api/portal/money.ts` stops reaching through `package_purchase`
for `coalesce(pp.extended_to, pp.expires_on)` — `extended_to` is gone — and
reads the purchase's own `expires_on`, which may now be null.
`app/api/portal/schema.ts` makes `PortalPackage.expiresOn` nullable on the
wire, or the route would refuse its own answer. `app/client/MoneyScreen.tsx`
replaces the whole *"Expires 1 August 2027"* line, label and date together,
with one sentence when there is no date, from a new dictionary entry in
`app/client/i18n/dictionary.ts`:

> These sessions do not expire.
> هذه الجلسات لا تنتهي صلاحيتها.

A programme that does run out still reads its date.

**Why.** The ruling reaches the household, not only the office. The portal's
own rule (the top of the dictionary) is that a household is told facts in plain
words with no nudges, so the sentence states a fact once and makes nothing of
it — no "yours to keep", no reassurance — and "Expires" with nothing after it,
or a fabricated date, would both be untrue.

**Which spec.** `docs/SPEC/client-portal.md` sections 3 and 4.

**The file.** `app/api/portal/money.ts`, `app/api/portal/schema.ts`,
`app/client/MoneyScreen.tsx` and `app/client/i18n/dictionary.ts`, with their
tests `tests/portal/db/routes.test.ts` (a programme with no term answers
`expiresOn: null` and nothing else about it moves) and
`tests/portal/screens.test.tsx` (the sentence in both languages, and the date
where there is one), all the client-portal stream's: *applied by the builder on
the branch*. The Arabic passes the dictionary's guard and has not yet been read
by an Arabic reader.

---

## 5. The accounting stream — one fixture and one paragraph

**What.** `tests/accounting/db/support.ts`'s `silverInput` fixture trades
`expiryMonths: 12` for `term: { amount: 12, unit: 'month' }`, deliberately
keeping a dated programme so the accounting suites still read one end to end.
`docs/SPEC/accounting.md` section 7 gains a paragraph: a credit sold with no
term is never released to income by expiry, because `app.unposted_money_events()`
(migration 454) already requires `expires_on is not null` before it offers a
credit as expired — so nothing in the poster had to change, and the money stays
a promise the practice owes until the session is delivered or the money given
back.

**Why.** Without the fixture every accounting database test would fail at the
package route with a `400`. Without the paragraph, a bookkeeper at a year end
would look for how unexpired credits reach income and find nothing to explain
why they never do.

**Which spec.** `docs/SPEC/accounting.md` section 7.

**The file.** `tests/accounting/db/support.ts` and `docs/SPEC/accounting.md`,
the accounting stream's: *applied on the branch* — one fixture line by the
builder, one paragraph by the round's closing task.

---

## 6. The trunk's pages — the extension feature, described as gone

**What.** Three pages still described `package_extension` as live.
`docs/SECURITY.md`'s "Who may read what" Money row no longer names the table or
its two policies, and says in their place that the table stood for two days and
is gone, with no cell's letters moving in either direction.
`docs/SPEC/00-data-model.md` gives `package` and `price` the optional pair,
`client_package.expires_at` its nullability, and the checks list the wholeness
constraint. `docs/HANDOVER.md` marks the package-terms entry reversed and adds
this round beside it, with what is still owed.

**Why.** `docs/SECURITY.md`'s own closing rule: *"This section is rewritten in
the same pull request as any policy that changes it."* The data model and the
hand-over are what the next engineer reads first; a page describing a dropped
table as live costs someone an afternoon.

**Which spec.** `docs/SECURITY.md` "Who may read what" and
`docs/SPEC/00-data-model.md` section 5.

**The file.** Three trunk pages, none of them in billing's paths. There is no
`docs/**` row in `docs/SPEC/OWNERSHIP.md` to cite for them; what OWNERSHIP
actually says of each is this:

- **`docs/SPEC/00-data-model.md`** — the shared zone's own row, *"`docs/SPEC/00-data-model.md`,
  `docs/SPEC/OWNERSHIP.md` | The contract"*, under *"Edited only in the trunk
  session or by the integrator (the owner) on `main`. No worktree touches
  these."* This edit rides in this pull request **by the integrator's explicit
  acceptance** in PR 159, because it is the contract: the pull request merges
  to `main`, and `main` is where OWNERSHIP says the contract is changed. It is
  not a precedent for a stream changing the contract on its own word.
- **`docs/SECURITY.md`** — named in no row of either table. The one place
  OWNERSHIP names it is the trunk's round 34 widening note, which lists it in
  *"The trunk's own half"*; no stream's "Owns exclusively" cell includes it, so
  it is the trunk's. It is edited here under the page's own closing rule,
  quoted under **Why** above, as `billing-10.md` item 3 edited it before.
- **`docs/HANDOVER.md`** — named in no row either. OWNERSHIP cites it only as
  the source of *"the cost rules of `docs/HANDOVER.md` section 6"*, under which
  the integrator has let a piece's shared-zone edits ride in its own pull
  request; no stream's owned paths include it, so it is the trunk's.

**The integrator's acceptance** covers all three pages, not only the contract:
`docs/SECURITY.md` and `docs/HANDOVER.md` ride in this pull request on the same
footing, and all three were read in round 44's whole-branch review. That is the
integrator's word in PR 159, not something OWNERSHIP grants.

*Applied on the branch* by the round's closing task, and recorded here so the
integrator reviews each of the three as the trunk's page it is.

---

**None of the six blocked the round.** Items 1, 3, 4, 5 and 6 are applied; item
2 is owed and recorded, awaiting the operator's word at the live pass.

---

## Left for later

Named so nothing is lost. None of them is a defect on this branch.

- **`app/api/billing/payments.ts` still tests a bare `23505`.** Carried forward
  from billing-10, the one of its seven notes this round did not make moot: a
  unique violation from anywhere else would still be reported as a payment
  already recorded rather than raised as the fault it is.
- **The price drawer prefills from the price in force today; the server
  supersedes the latest by `valid_from`.** A future-dated price carrying a
  different term would make the drawer's sentence briefly describe the wrong
  one. It cannot cause a wrong write — a term nobody touched sends no `term` key
  at all, so the server carries forward what the latest row actually holds — but
  reading the latest row rather than the current one is surface this round did
  not add.
- **The portal says "sessions" where a programme can also hold brain maps and a
  consultation.** The console calls a mixed holding *credits*; the portal did
  not before this round either. If the operator wants the two consistent, the
  fix is `PHRASES.sessionOf` and item 4's sentence together, in the
  client-portal stream.
- **A backdated single session words today's term and writes the term in force
  on the day it was sold.** The Sell session drawer names the term of the price
  in force today (`app/admin/billing/SellSessionDrawer.tsx`, the `term` it reads
  from `/api/billing/prices`), but the sale writes the term of the price in
  force on `purchasedOn` (`app/api/billing/session-sales.ts`'s `PRICE_SQL`,
  `valid_from <= $4`). Where a price's term changed between the two days, the
  drawer's sentence names one term and the credit carries another. The price
  figure has the same gap already; closing both means changing how a backdated
  sale reads the catalogue, which this round does not do.
- **At the staging pass**, confirm that `package_purchase_extension_reason_check`
  — a name Postgres generated for 403's inline check, which 412 drops by name —
  is spelt the same on staging and production: `select conname from
  pg_constraint where conrelid = 'public.package_purchase'::regclass and conname
  like '%extension%'`. A mismatch fails loudly rather than silently, which is
  why this is a check and not a risk.
