# billing-10: the seed's term moves with the round, and the live catalogue owes its own data step

Three facts this round could not settle inside `mcwellness-billing`: the seed
that every database is built from is a trunk file, not this worktree's to own
outright; the three programmes already on the live price list are real rows
nothing in this branch may touch; and the page that says who may read what is
the trunk's, while this round is the one that adds a table to it. All three
are recorded here rather than reached for, as `CLAUDE.md` rule 10 requires for
a shared-zone change.

---

## 1. `db/seed/generate.ts` — `PACKAGE_EXPIRY_MONTHS`, twelve months to six

**What.** The constant moves from `12` to `6`, and its comment with it. It
read:

> Twelve months, the founder's decision of 2026-09-03; package.expiry_months's own default.

and now reads:

> Six months, the operator's decision 9 of 2026-09-10 (docs/PLAN/package-terms.md); twelve from 2026-09-03 until then. package.expiry_months carries it per programme.

**Why.** Migration 410 (this branch) moves `package.expiry_months`'s own
column default from twelve to six, on the operator's decision 9
(`docs/PLAN/package-terms.md`). A seed still writing twelve would leave every
freshly seeded database disagreeing with a freshly bootstrapped one on the one
fact this round changed, and `tests/db/seed.test.ts` and
`tests/db/bootstrap-practice.test.ts` compare the two directly.

**Which spec.** `docs/SPEC/billing.md` section 4.3 (amended 2026-09-10) and
migration `db/migrations/410_package_terms.sql`.

**The file.** `db/seed/generate.ts` and its test `db/seed/generate.test.ts`,
both the trunk's (`docs/SPEC/OWNERSHIP.md`: `db/seed/**`, "Synthetic
generators"): *applied by the builder on the branch*, under this round's own
task for it — a one-line constant and its comment, with the test that proves
it (`it('sells six-month programmes from this round', …)`), and the one
pre-existing assertion of the old figure corrected alongside it.

---

## 2. To production: the three live programmes, by a data step at the live pass

**What.** `update package set expiry_months = 6 where tenant_id = <the
practice's id, read back first> and code in ('silver', 'gold', 'platinum')`,
run against production under the runner's audit context
(`app.actor_id`, `app.actor_roles`, `app.request_id`, `app.reason` and
`app.tenant_id` set as every write to a billing row requires), on the
operator's word — not part of this pull request, and not run by it.

**Why.** `package.expiry_months` is written once, at a row's own creation
(401's original default, moved to six by migration 410 for anything created
from now on), and no migration rewrites a row that already exists. The three
programmes the practice already sells — Silver, Gold and Platinum, coded
`silver`, `gold` and `platinum` (`db/seed/generate.ts`'s own `PACKAGES`
fixture, the shape production's opening catalogue was written from by an
audited data step on 2026-09-07, `docs/PRODUCTION.md` "What was done on
2026-09-07: the catalogue loaded") — keep the twelve months they were created
with until somebody changes them on purpose. The operator's decision 9 is
that they become six-month programmes at the live pass, not silently at the
next migration or the next deploy.

**Which spec.** `docs/PLAN/package-terms.md` ("The three live programmes move
to six months by a data step") and `docs/SPEC/billing.md` section 4.3.

**The file.** Production's `package` table — not a file this round edits, and
not a write this branch's pull request makes. *Owed at the live pass, on the
operator's word, recorded in `docs/PRODUCTION.md` when it is run.*
Production's own three codes are read back and confirmed to be exactly
`silver`, `gold` and `platinum` before the update runs: a code typed once in a
change-request note is not proof of what the live catalogue actually calls its
own rows. The practice's own `tenant_id` is read back the same way and written
into the statement before it runs, so the update names the practice it is
meant for rather than every row in the table that happens to share a code.

---

## 3. `docs/SECURITY.md` — the Money row names `package_extension`

**What.** The "Who may read what" table's Money row gains the new table in
both of its written cells. The "What" cell read:

> **Money**: purchases, entitlements, invoices and their lines, payments, refunds, rendered invoice files

and now ends "…rendered invoice files, and the extensions of a programme
(`package_extension`)". The policy cell gains `package_extension_readers` and
`package_extension_writers` beside `ledger_readers`, with a sentence saying
that the reader policy is `ledger_readers`' audience written out under its own
name — so the six role cells are unchanged — and one exception noted below.
No cell's letters move.

**Why.** That section closes with its own rule: *"This section is rewritten in
the same pull request as any policy that changes it."* This round adds a table
and three policies (`db/policies/billing/ledger.sql`, migration 410), so the
page would otherwise be wrong for a round, and the only way to discover it
would be to read every policy file again — which is the work that section
exists to save.

**One thing the review's premise did not cover, found while writing it.**
`portal_money_adults` (`db/policies/portal/money.sql`) narrows six tables by
name — `package_purchase`, `entitlement`, `invoice`, `invoice_line`,
`payment`, `billing_document` — and `package_extension` is not among them. So
the Money row's C cell, "own record, and not a minor's own login", is those
six tables'; a young person's own login is admitted to their own record's
extension rows by `package_extension_readers` where the same login is refused
the purchase they extend. Nothing reads that table for a household — the
portal has no route that names it — so this is a policy wider than its reader,
not an exposure. It is written into the page as the exception it is, and named
again under "Left for the billing stream" below as the tidying it wants:
either the table joins that array or the row says for ever why it does not.

**Which spec.** `docs/SECURITY.md` "Who may read what" (written 2026-09-06,
trunk round 34) and `db/policies/billing/ledger.sql`.

**The file.** `docs/SECURITY.md`, the trunk's (`docs/SPEC/OWNERSHIP.md`:
`docs/**`): *applied by the builder on the branch*, in this round's house fix
round, under the precedent item 1 sets — a two-cell edit to a page whose own
rule requires it here rather than a round later.

---

**None of the three blocked the round.** Items 1 and 3 are applied; item 2 is
owed and recorded, awaiting the operator's word at the live pass.

---

## Left for the billing stream

Named here so nothing is lost, and left because each was weighed by the
whole-branch review of this round and ruled harmless as it stands. None of
them is a defect on this branch.

- **`package_extension.client_id` is not tied to the purchase's own client.**
  The foreign key points at `client (tenant_id, id)` alone, so the column
  could in principle name a different household from the purchase it extends.
  It matches `entitlement`, the nearer precedent, and the route never types
  it: `app/api/billing/extensions.ts` takes it from the purchase row it has
  just read. A composite key through `package_purchase (tenant_id, id,
  client_id)` would make it structural, and that is a migration of its own.
- **The new table's policies are the ledger pair copied out by hand.**
  `db/policies/billing/ledger.sql` applies `ledger_readers` and
  `ledger_writers` to five tables in one loop; `package_extension_readers` and
  `package_extension_writers` repeat both clauses verbatim under their own
  names, below that loop. The audience is identical, so the table belongs in
  the array — a tidying, not a change of who may read or write.
- **`set_updated_at` fires on a table nobody may update.** An extension is
  written once: 410 grants `select, insert` and no update, and there is no
  `ledger_amenders` for it. The trigger is therefore dead. It stays because
  the standard-column rule wants `updated_at` on every table and the trigger
  is what keeps that column honest if an update case ever appears.
- **`EXTEND_SQL` names no tenant.** `app/api/billing/extensions.ts` updates
  `package_purchase` on `p.id = $1` alone, where every other statement the
  round writes repeats `app.current_tenant_id()`. Row security holds the line
  and the purchase was read tenant-scoped a moment before, so this is depth
  rather than a hole; it is the one place the module's own stated habit is not
  kept, and it was carried over unchanged from the statement it replaces
  (house review 1, S2). Left as it stands by the controller for this round.
- **`app/api/billing/payments.ts` still tests a bare `23505`.** The narrowing
  to a named constraint that this round made in `sales.ts` and
  `extensions.ts` has not reached the third idempotent route of the same
  module, where the broad test stands for the same reason and with the same
  consequence: a unique violation from anywhere else would be reported as a
  payment already recorded rather than raised as the fault it is. Named so it
  is not lost; not this branch's file (house review 1, S3).
- **`extended_by_someone_else` has no console case of its own.** Its sentence
  is in `ExtensionDrawer`'s `MESSAGES` and its route case is proved by the
  race tests in `tests/billing/db/extension.test.ts`, where its two siblings
  — `extension_limit_reached` and `ended_too_long_ago` — each have a console
  case as well. The behaviour exists and is tested at the route; only the
  screen's rendering of it is unproved (house review 1, D4).
- **`portal_money_adults` does not name `package_extension`.** Found while
  writing item 3 above, and the one place the new table is not exactly the
  purchase's equal: that policy narrows six tables by name, so a young
  person's own portal login reads their own record's extension rows where the
  same login is refused the purchase those rows extend. No route reads the
  table for a household, so nothing is exposed today. The tidying is the same
  one the bullet above wants — the table joins the array, or the page says for
  ever why it does not.
