# billing-14: a package's versions

The operator decided on 20 October 2026 that everything but a package's name
can be edited. Changing the contents of a package somebody has bought writes a
new version of it (PR for `PUT /api/billing/packages/:id`, migration
`415_package_version.sql` in billing's range). The data model is the trunk's,
so the columns are asked for here.

---

## 1. To the trunk: `package.version`, `supersedes_id`, `amendment_reason`

**What.** `docs/SPEC/00-data-model.md`, the `package` bullet (and, with
billing-12, `position`). Add:

> Versioned since migration 415: `version` (1 first), `supersedes_id` (the
> version it replaced, same practice) and `amendment_reason` (why), null for a
> first version — the shape section 7 gives every versioned entity. A package
> is replaced at most once (a partial unique index), so the current version is
> the one with no successor; only current versions are listed, and a replaced
> one cannot be reinstated (billing.md section 2.5). Buyers of a replaced
> version keep it: their purchase names that row.

**Why billing's.** Only billing's routes write these columns, and only the
packages list reads them.

**Nothing else moves.** No policy or grant changes: `package` already grants
`update` and `insert` to `app_role`, its audit trigger records the new row with
the request's reason, and the catalogue policies decide who may write it.
