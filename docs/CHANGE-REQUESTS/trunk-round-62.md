## Round 62 — a package is withdrawn, never deleted (2026-09-23)

The owner asked, on 23 September 2026, to "delete a particular package after
we're finished with it" and, in the same request, to "limit the number of
different packages we offer" — the catalogue keeps growing and nothing in it
ever leaves.

### The decision

**Withdraw, never delete.** A `client_package` names a `package_id`, an
`invoice_line` prices what a package sold, and every `package_price` row a
bundle has ever carried is append-only (`docs/SPEC/billing.md` section 2.3);
financial records keep five years regardless of anything a client asks for
(CLAUDE.md rule 8). Deleting a package row would either orphan those or have
to be refused the moment the first household bought it — and the practice has
no way to know which bundles that is true of without trying. "Delete" is done
instead by the column that already exists for it: `package.status`, the same
`active` / `inactive` pair `readPackages` already folds into `sellable`. A
withdrawn package keeps its code, its name, its components and its whole
price history; nothing about a household who already bought it moves.
Reinstating is the same act the other way.

### What it does now

**The route**, `PATCH /api/billing/packages/:id` (Task 1, commit `7edceb6b`).
Body `{ "status": "active" | "inactive" }`, an `X-Reason` header required
non-empty after trim exactly as kit's own PATCH requires one, gated by
`mayWriteCatalogue` — owner, admin or finance, the three roles the rest of
the catalogue's writes already answer to. A lead practitioner, who reads the
catalogue but never amends it (`db/policies/billing/ledger.sql`'s
`catalogue_amenders`), is refused by name rather than merely "whoever is not
the owner" — the test asserts it against that specific role. The row is
looked up and updated scoped to `app.current_tenant_id()`, so another
practice's package answers `404` rather than `403`, and the update reads the
row back through `readPackages` so the answer's `sellable` is derived exactly
as `GET /api/billing/packages` derives it, not recomputed by hand. The reason
needs no separate write: the request-context middleware has already copied
`X-Reason` into `app.reason`, so the update's own audit row carries it.
Withdrawing a package that has already been sold changes nothing reachable
through this route — no `client_package`, `entitlement`, invoice or balance —
and a withdrawn package cannot be sold: `POST /api/billing/package-purchases`
answers `422 not_sellable` for it, the same refusal an unpriced bundle
already gets, because `sellable` folds `status = 'active'` in with the
pricing checks it made before this round.

**The drawer**, `WithdrawPackageDrawer` (Task 2, commit `74a52633`). Opened
from a new "Withdraw" button beside "Sell to a client" in the packages
table's name column (owner/admin/finance only), it says in one line that
"Households who bought it keep their sessions; nobody can buy it after
this.", asks why, and on submit sends the same PATCH with `status: 'inactive'`
and the typed reason as `X-Reason`. Two refusals have their own sentence
rather than the screen's generic one: `403` reads "You don't have permission
to withdraw a package.", `404` reads "This package is no longer there. Reload
the list to see what changed."; anything else falls back to "The package
could not be withdrawn. Try again."

**The fold.** The packages table now lists active bundles only
(`state.packages.filter((row) => row.status === 'active')`); a withdrawn one
moves to a collapsed `<details>` below it, `"Withdrawn (n)"`, listing name and
contents with a **Reinstate** button in place of Withdraw — closed by default,
a native disclosure rather than a screen-managed open/shut state.

**Reinstate.** No drawer: the reason is fixed — `'Reinstated from the
packages list'` — because there is nothing to ask; bringing a bundle back
needs the audit trail's own words, not silence, but does not need a person to
type them. It sends the same PATCH with `status: 'active'`, and on success
the list refetches, which is what moves the row out of the fold.

Both actions refetch `GET /api/billing/packages` on success rather than
patching local state, so the fold and the table always agree with the row the
server just wrote.

### The tests

- `tests/billing/db/packages.test.ts` — a new `describe('withdrawing a
  package')`, 8 cases, against a real database (35 in the file total):
  withdraws with a reason and the list marks it `inactive`; refuses without a
  reason (`400 reason_required`); refuses a lead practitioner (`403`);
  answers `404` for another practice's package, written against a second,
  synthetic tenant created in the suite's own `beforeAll`; refuses a sale of
  a withdrawn package (`422 not_sellable`); leaves a buyer's credits and
  balance untouched across a sell-then-withdraw, read from
  `GET /api/billing/clients/:id/balance` before and after; reinstates and the
  reinstated bundle can be sold again; and that the reason lands on
  `audit_log` for the update.
- `tests/billing/PackagesSection.test.tsx` — 3 new cases (19 in the file
  total): Withdraw shows for the owner and not for a lead practitioner; a
  withdrawn package lists under a folded "Withdrawn (1)" disclosure, closed by
  default, absent from every table outside the fold; Reinstate sends the
  fixed reason and JSON content-type, and the fold empties once the list
  refetches.
- `app/admin/billing/WithdrawPackageDrawer.test.tsx` — new file, 3 cases:
  refuses to submit with no reason; sends `x-reason` and JSON content-type
  with `{ status: 'inactive' }`; shows the server's own error sentence on a
  non-200.

`pnpm verify` and `pnpm test:db` both green on the branch's head; the tail of
each is in this round's pull request.

### Found beside it, and not fixed here

- **`pnpm test:db -- <file>` runs the whole suite, not the one file.** The
  brief for Task 1 gave `pnpm test:db -- tests/billing/db/packages.test.ts -t
  withdrawing` for the red run. `test:db` is `vitest run --config
  vitest.db.config.ts`; pnpm passes the literal `--` through to that command
  rather than consuming it (`vitest run --config vitest.db.config.ts --
  tests/billing/db/packages.test.ts -t withdrawing`), and vitest's CLI reads
  `--` as "stop parsing filters", so every file under `tests/db/**` and
  `tests/**/db/**` runs — 111 files, 1,584 tests, confirmed by listing what
  the command actually matches (`npx vitest list` against the same
  invocation). It still gives a valid red or green signal, only over far more
  tests than intended and far slower. Dropping the `--` filters correctly
  (`npx vitest list --config vitest.db.config.ts tests/billing/db/packages.test.ts`
  matches the one file's 35 tests). Pre-existing, not introduced by this
  round; worth a line in whichever document next tells an implementer how to
  run one file.
- **`tests/billing/db/support.ts`'s `Harness.call`/`callAs` widened from
  `'GET' | 'POST'` to `'GET' | 'POST' | 'PATCH'`** (Task 1), needed to
  exercise the new route through the shared harness at all — no test in
  `tests/billing/db` had sent a PATCH before this round.
  `tests/accounting/db/support.ts` already carried the equivalent, so this
  follows that stream's own precedent rather than inventing one. Additive:
  every existing call site still compiles and passes.

### Going live

**Merged is not live.** No migration, no policy file, and both databases are
otherwise unchanged: `package.status` has existed since the table itself
(migration `401_billing_package.sql`) and this round adds no column, no
constraint and no new grant. Every file is the billing stream's own
(`docs/SPEC/OWNERSHIP.md`: `app/admin/billing/**`, `app/api/billing/**`,
`tests/billing/**`). A build and a restart is the whole of it.

Proof once served: "Withdraw", "Withdrawn" and "Reinstate" read out of the
served `BillingPage`/`PackagesSection` chunk, and the chunk that was served
before this build 404s.
