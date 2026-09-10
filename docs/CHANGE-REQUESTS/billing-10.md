# billing-10: the seed's term moves with the round, and the live catalogue owes its own data step

Two facts this round could not settle inside `mcwellness-billing`: the seed
that every database is built from is a trunk file, not this worktree's to own
outright, and the three programmes already on the live price list are real
rows nothing in this branch may touch. Both are recorded here rather than
reached for, as `CLAUDE.md` rule 10 requires for a shared-zone change.

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

**What.** `update package set expiry_months = 6 where code in ('silver',
'gold', 'platinum')`, run against production under the runner's audit context
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
operator's word, recorded in `docs/PRODUCTION.md`.* Production's own three
codes are read back and confirmed to be exactly `silver`, `gold` and
`platinum` before the update runs: a code typed once in a change-request note
is not proof of what the live catalogue actually calls its own rows.

---

**Neither blocked the round.** Item 1 is applied; item 2 is owed and recorded,
awaiting the operator's word at the live pass.
