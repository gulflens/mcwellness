# billing-15: the packages page is a row of tiles

On 20 October 2026 the operator decided that the Packages section is one row of
tiles, not a table. On a wide screen every tile sits side by side; on a
narrower one the row slides sideways like a carousel. The nine-column table scrolled sideways on a tablet and a
phone, and its first column held a name and five buttons.

---

## 1. To the trunk: one scoped exception to "tables, not cards"

**What.** The rule appears in `CLAUDE.md` ("Tables for homogeneous data. Cards
only for heterogeneous content."), `.claude/rules/ui.md` ("tables not cards"),
`DESIGN.md` and `docs/DESIGN-BRIEF.md`. Add one sentence beside it in each:

> Exception: the Packages section in billing (operator, 2026-10-20). It is a
> short catalogue that the founder browses and acts on, not a ledger, so each
> package is a tile in one row that slides sideways when it runs out of room. Every other ledger stays a table.

**Why here.** Those files are shared. Billing has only changed its own paths:
`app/admin/billing/PackageGrid.tsx` (new), `PackagesSection.tsx`, `billing.css`
and `tests/billing/PackagesSection.test.tsx`. The shared
`app/shell/components/Table.tsx` is untouched.

**What the tile keeps from the ledger.**
- Tokens only.
- Hairline rules.
- Tabular figures.
- No shadow or gradient.
- The same button styles.
- The same folded "Withdrawn" group.
