# A programme's term is optional

**Date:** 12 September 2026. **Operator's ruling:** a household keeps every session it paid for.
Credits do not expire unless the practice deliberately says they do, per package and per price.

## Why

The catalogue has always forced a term. `package.expiry_months` is `not null default 12`, and a
single session sold ahead takes twelve months from `SINGLE_SESSION_MONTHS`, a constant in the
code that cannot be changed without a build. On 11 September the operator ruled that sessions a
household bought never stop being usable, and on 12 September set the shape: **an empty term means
the credits never expire; a number with a unit beside it means that term, for that exact package
or price.**

Nothing has been sold on production, so no credit carries a wrong expiry today. The three live
programmes each read twelve months and must end up blank.

## What already works, and must not be disturbed

`app.oldest_available_entitlement` (403, lines 351-355) reads
`coalesce(pp.extended_to, e.expires_on) is null or coalesce(...) >= p_on`, ordering
`nulls last`. **A null expiry already means "always valid"** at the layer that decides whether a
credit can be spent, and `entitlement.expires_on` is already nullable. This round makes the
catalogue able to express what the consumption rule already understands.

## The shape

### The term, twice

Both `package` and `price` carry the same pair, both nullable:

```
expiry_amount  integer  check (expiry_amount > 0)
expiry_unit    text     check (expiry_unit in ('day', 'month'))
```

Whole or absent, never half: `(expiry_amount is null) = (expiry_unit is null)`. That constraint is
the point of the two-column design — a number with no unit is the way it goes wrong.

`price` has never had a term at all; this is what retires `SINGLE_SESSION_MONTHS`.

### The rule

`domain/billing/expiry.ts` — `expiryOn(purchasedOn, term)` where `term` is
`{ amount: number; unit: 'day' | 'month' } | null`, returning `IsoDate | null`.

- `null` term → `null`, and every caller writes null rather than a date.
- `month` → the existing arithmetic, **including the end-of-month clamp**: 30 November plus three
  months is 28 February, not 2 March. That behaviour is already tested; the tests stay.
- `day` → plain addition, no clamp.

Both branches need their own tests. This is the real cost of letting the operator choose a unit,
and it is small.

### Extensions go

`package_extension` (410), `app/api/billing/extensions.ts`, `ExtensionDrawer.tsx`,
`domain/billing/extension.ts` and `package_purchase.extended_to` / `extension_reason` are all
removed. The operator's decision of 11 September, reaffirmed on 12 September knowing that a
package can once again have a term: the shipped version is hard-wired to "three months, twice",
which cannot fit a term measured in days, and every live programme will be blank. If an extension
is wanted later it is a new round with a clearer brief than the one being deleted.

**Migration 410 is merged and applied to staging and production. It is not edited.** A new
migration drops what it created.

### The screens

- `PackageDrawer` and `PriceDrawer`: a number box and a unit beside it, and the empty state says
  what empty means — *"Leave blank and these credits never expire."*
- `BalancesSection`, `MoneyScreen` (the household's own): a credit with no expiry says **No
  expiry**, not a blank cell.
- The sale drawers stop naming a term; the invoice line stops printing one for a termless sale.
- The Extend button and its drawer go.

### The data step

The three live programmes — Silver, Gold, Platinum, each `expiry_months = 12` — end up blank at
the live pass, on the operator's word, recorded in `docs/PRODUCTION.md`. Not in the migration: a
migration fixes structure, and what a practice charges for is the practice's own to set.

## Tasks

1. **Migration 412** — the two columns on `package` and on `price`, the wholeness constraints, the
   backfill of the existing `expiry_months` into the pair, dropping `expiry_months`, dropping
   `package_extension` with its policies, dropping `extended_to` and `extension_reason`. Full
   review: it is a migration.
2. **The rule** — `expiryOn` on a term, both units, the clamp kept and tested; delete
   `extension.ts` and `SINGLE_SESSION_MONTHS`.
3. **The routes** — `sales.ts` and `session-sales.ts` read the term and write a date or null;
   delete `extensions.ts` and unmount it; `balance.ts`, `stop-balance.ts` and `portal/money.ts`
   answer a null expiry. Full review: it takes money.
4. **The catalogue screens** — the term fields on both drawers, with the empty state's wording.
5. **The reading screens** — "No expiry" wherever a date is shown; the Extend button and drawer
   removed; the sale drawers' term wording.
6. **Seed, specs and the round note** — the seeded catalogue carries no term, so a fresh
   environment starts the way the practice runs; `docs/SPEC/billing.md`, `accounting.md`,
   the change request and `trunk-notes.md`.

## Risks

- **A half-set term.** The wholeness constraint refuses it at the database, and the drawer refuses
  it before that.
- **Someone types 6 meaning months into a field set to days.** The unit sits beside the number and
  the field is labelled; there is no default unit, so a term cannot be saved without choosing one.
- **A credit already sold.** None exists on any environment. If one ever did, its `expires_on` was
  written at the sale and nothing here rewrites it — a household keeps the term it was sold.
