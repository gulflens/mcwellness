# billing-08: what the discount round edits outside billing's paths

The discount round (migration 409, `docs/SPEC/billing.md` section 2.4, the
operator's decision of 7 September 2026 at 21:49) is almost entirely billing's
own. Four things it touches are not, and they are listed here rather than left
for a reviewer to find in the diff: two files in the seed, one section of the
data model, and one paragraph of the money spec that the integrator wrote
before the round began.

Nothing here is a request of another stream. Every item is a change this round
has already made, recorded because `CLAUDE.md` rule 10 says a shared-zone
change is written down.

---

## 1. `db/seed/generate.ts` and `db/seed/apply.ts`

**What.** `SeedPrice` gains `listPriceFils`, `discountFils` and
`discountBasisPoints`; the `price` shape inside `SeedPackage` gains the same
three. Every seeded service price is its own list figure with nothing off it
(`listPriceFils = unitPriceFils`, `discountFils = 0`, `discountBasisPoints =
null`); every seeded package price carries the gap between the founder's list
and her price now as a **sum** (`discountFils = listFils − nowFils`,
`discountBasisPoints = null`). `applySeed` names the three new columns on both
inserts.

The comment above `PACKAGES` that read "no discount percentage is stored
anywhere (docs/SPEC/billing.md section 2.3, and the founder's decision of
2026-09-03)" now says that decision was amended on 2026-09-07 and that these
launch discounts are sums rather than percentages.

**Why the seed had to change at all.** Migration 409 makes `list_price_fils`
not null on `price` and `package_price`, and the seed inserts both directly
rather than through the routes. Without the columns the seed would not apply,
and every database test that starts from a fresh seed would fail on the insert
rather than on anything it was testing.

**What did not change.** Not one figure. Silver is still a list of AED 12,150
and a price now of AED 10,325; the session is still AED 700. The discounts are
sums precisely so that no figure moves: a percentage would have had to be
chosen, and 15% of 12,150 is 10,327.50, not the founder's 10,325.

---

## 2. `docs/SPEC/00-data-model.md` section 6

**What.** Three sentences. The `price` line names `list_price_fils`,
`discount_fils` and `discount_basis_points` beside `unit_price_fils` and says
which of them the check constraint holds. The `package` line says its
`package_price` rows carry the same three, with the list figure snapshotted at
write time. The `client_package` line names `discount_basis_points` and
`discount_reason`. The `invoice`/`invoice_line` line says `unit_net_fils` is
now the list figure and the check is `net = quantity × unit − discount`.

**Why.** That section is the map a reader consults before opening a migration,
and a map that does not show four new columns on three tables sends them to
the wrong file.

---

## 3. `docs/SPEC/billing.md` section 2.4

**What.** The section itself — "Discounts (the operator's decision of
7 September 2026)" — and the amending note at its head, which records that the
founder's decision of 2026-09-03 (a package price is a figure she sets, and no
discount percentage is stored anywhere) is amended rather than overturned: the
figure is still hers, and a discount is now one of the two ways of setting it.

**Written by the integrator, before this round.** It is named here because it
is a shared-zone file this round depends on, not because this round wrote it.
Migration 401's own header still carries the superseded sentence and is left
alone: it is merged, and 409's header is where the amendment is recorded.

---

## 4. Two request bodies that stayed valid, and why

Not a shared-zone edit, but the reason one was avoided.

`POST /api/billing/prices` still accepts `unitPriceFils` — read as a list
figure with nothing off it, which is exactly what it meant — and
`POST /api/billing/packages` still accepts `price.amountFils`, read as the
price now. The plan for this round replaced both outright. They were kept
because `tests/accounting/db/support.ts` and `tests/accounting/db/fixture.ts`
write the practice's catalogue through these two routes, those files belong to
the accounting stream (`docs/SPEC/OWNERSHIP.md`), and the accounting database
tests have to stay green without this round editing them.

The older name is refused beside a discount, so the two can never claim
different figures, and `tests/billing/db/discounts.test.ts` pins both the
acceptance and the refusal. Whoever next owns `tests/accounting/**` can move
those fixtures to `listPriceFils` and `discount` and delete the two aliases in
one commit; nothing else depends on them.

---

**Nothing here blocks the round.** Items 1 to 3 are made; item 4 is a note for
whoever tidies the accounting fixtures.
