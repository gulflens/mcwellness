# billing-12: a package's place in the practice's list

The operator asked on 20 October 2026 to order the packages by hand (Silver,
Gold, Platinum, then Complimentary). Billing added one column for it in its own
range, migration `414_package_position.sql` (PR 277). The data model is the
trunk's, so the column is asked for here rather than written into it.

---

## 1. To the trunk: `package.position` in the data model

**What.** `docs/SPEC/00-data-model.md`, the `package` bullet, names `code`,
`name`, `price_fils`, `components`, `status` and the term. Add:

> `position` — where the bundle sits in the practice's list, 1 first, set by
> hand (operator, 2026-10-20; migration 414, billing.md section 2.5). A new
> bundle goes last, by a trigger before insert, and a reinstated one goes last.
> Not unique: a move renumbers the whole list from one, and a tie breaks by
> name until then.

**Why it is billing's column.** Only the packages list reads it, and only
billing's routes write it (`POST /api/billing/packages/:id/move`, and the
reinstate `PATCH`).

**Nothing else moves.** No other table, policy or grant changes: the column is
on an audited table that already grants `update` to `app_role`, and the
catalogue's existing policies decide who may write it.
