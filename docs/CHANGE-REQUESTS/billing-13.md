# billing-13: two arrows in the shell's icon set

The operator asked on 20 October 2026 for Move up and Move down on
Billing › Packages to be arrows with no text (PR 279). The icon set is the
shell's (`app/shell/components/Icons.tsx`), so the two icons are recorded here,
as `BooksIcon` was by accounting-01.

---

## 1. To the trunk: `ArrowUpIcon` and `ArrowDownIcon` (applied on the branch)

**What.** Two exports added to `app/shell/components/Icons.tsx`, beside
`ChevronIcon`, drawn like the rest of the set: the 20px grid, the 1.5 stroke,
round caps and joins, `currentColor`, `aria-hidden` and not focusable.

- `ArrowUpIcon`: a shaft from 15 to 5 with a head opening downward.
- `ArrowDownIcon`: the same, mirrored.

**Additive only.** No existing icon, export or caller changed. The only user
is `app/admin/billing/PackagesSection.tsx`, where each sits alone in an
icon button whose accessible name says what it does ("Move Silver up") and
whose `title` gives the hover label.

**Why it is not the brief's appended arrow.** `docs/DESIGN-BRIEF.md` forbids
an arrow appended to button text. Here there is no text: the arrow is the
whole control, and it means a direction.

**Styles stay billing's.** The fills (`button--tonal`, `button--neutral`) and
sizes (`button--compact`, `button--icon`) are in `app/admin/billing/billing.css`.
If another module needs them, they move to `app/shell/shell.css` through a
request of their own.
