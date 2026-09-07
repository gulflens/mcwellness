# accounting-01: what the ledger needs from the shared zone

Written 7 September 2026 with `docs/SPEC/accounting.md` (piece eleven, the
books). Nine items. By the precedent of pieces seven to ten and the cost rules
of `docs/HANDOVER.md` section 6, all nine are proposed to ride in the piece's
own pull request under the integrator's widening for one round, each file
named in the round's record; none is applied until the plan is approved.

---

## 1. `docs/SPEC/OWNERSHIP.md` — a new stream and its range

Add to the Stage 2 table:

| Worktree | Owns exclusively | Migrations | Spec |
|---|---|---|---|
| `accounting` | `domain/accounting/**`, `app/admin/accounting/**`, `app/api/accounting/**`, `db/policies/accounting/**`, `jobs/accounting/**`, `tests/accounting/**` | `450–499` | `SPEC/accounting.md` |

Amend billing's row to `400–449`. **Why the carve:** `db/runner/plan.ts`
accepts only `NNN_description.sql`, every hundred from 000 to 999 is owned,
and widening the runner to four digits would touch `MIGRATION_FILENAME`,
`LEADING_NUMBER` (the `Needs` check) and every test that asserts the pattern
for a range nobody else needs. Billing has written 400–408; 450 leaves it
forty-one files of room. `checkNeeds` is unchanged: an accounting file may
name 402, 403 and 408, and the trunk's 958 may name 450 and 451.

Add to the ports table, in Stage 2 order after `audit-ui`: `accounting` —
database 5443, API 3011, web 5184 (5441 to 5442 and 3009 to 3010 turned out to be held by the two trunk worktrees, opened by hand) — and the same row to `WORKTREES` in
`scripts/worktree.mjs`, which repeats the table so `pnpm worktree:add` can
open the worktree.

**Applied by the integrator on the spec branch `accounting-spec-1` on
2026-09-07 (14:40), ahead of the rest:** a worktree cannot be opened without
the row, and the builder's branch is cut from that branch. The remaining items
ride in the piece's pull request as proposed.

## 2. `docs/SPEC/00-data-model.md` section 6 — the books' entities

Replace the last bullet (`invoice`, `invoice_line`, `payment`, `credit_note`,
`journal_entry` — FINANCE-SPEC §4–7) with:

> - **`invoice`, `invoice_line`, `payment`** — `billing.md` sections 4 to 6.
>   Issued invoices are immutable; a call-out fee is waived in place with a
>   reason (408). `credit_note` was never built; a correction is a reversing
>   journal entry.
> - **The books** (`accounting.md`, migrations 450–454): `accounting_setting`
>   (one per practice: start day, year end, the lock date, the corporate-tax
>   estimate and Small Business Relief settings, the entry counter); `account` (the chart: four-digit `code`, `type`, an optional
>   unique `role` the poster finds accounts by); `fiscal_year` (a range and an
>   `open`/`closed` status); `journal_entry` and `journal_line` (balanced,
>   append-only, `unique (tenant_id, source_table, source_id, source_event)`
>   as the poster's idempotency). None carries a `client_id`, by design:
>   statements name nobody and an erasure reaches nothing here.

Add to section 7's append-only list: `journal_entry` and `journal_line` are
never updated or deleted for any role; a reversal is a new entry.

## 3. `db/migrations/958_bootstrap_knows_the_books.sql` — the trunk's second half

Migrations 450 and 451 give every practice a settings row and a chart by
after-insert trigger on `tenant` **and** a data step for practices that
already exist, exactly as 202, 400, 402, 405 and 600 do. `app.bootstrap_practice`
(956) checks a hand-written list of such defaults, and
`tests/db/bootstrap-practice.test.ts` requires that list to equal the set of
`insert ... from tenant` data steps across every migration. So the list must
gain two rows, and a merged migration is never edited: 958 recreates the
function with

```
('accounting_setting', '450_accounting_setting.sql'),
('account',            '451_account.sql'),
```

added to the `values` block and nothing else changed. **Why 958 and not 957:**
trunk round 34 (pull request 105, branch `trunk-round-34`) already carries
`957_vat_taxable_supplies_excludes_waived.sql`; the number is taken whether
or not that request has merged when this piece opens. `-- Needs: 450, 451,
956`. It sorts last, as every 95x file must (`OWNERSHIP.md`, "the halves
mean different things"). The test's two checks then pass unchanged: the
bootstrapped and seeded practices carry the same rows table by table, and the
scanned data steps equal the list.

## 4. `domain/shared/actor.ts`, `app/shell/adminAccess.ts`, the rail and the route

Four actions:

```ts
  | { type: 'accounting.read' }
  | { type: 'accounting.write' }
  | { type: 'accounting.year.close' }
  | { type: 'accounting.settings.write' }
```

```ts
    case 'accounting.read':
    case 'accounting.write':
      // The books: the owner and finance. An admin records money for a
      // household (billing.payment.write) but does not keep the practice's
      // books; piece twelve admits an admin to expenses and nothing else.
      return hasRole(actor, 'owner', 'finance');
    case 'accounting.year.close':
    case 'accounting.settings.write':
      // Closing a year and the books' own settings are the owner's alone.
      return hasRole(actor, 'owner');
```

`adminAccess.ts` gains `canOpenBooks(actor, now)` matching
`accounting.read`, in the shape of `canOpenBilling`. `ADMIN_SECTIONS` in
`app/shell/components/Rail.tsx` gains
`{ key: 'books', label: 'Books', to: '/admin/books', icon: <BooksIcon /> }`
after `billing`, with `BooksIcon` added to `app/shell/components/Icons.tsx`
in the shape of `BillingIcon`; `AdminLayout.tsx`'s `visibleSections` switch
gains `if (section.key === 'books') return canOpenBooks(actor, now);`; `App.tsx` gains the route `books` under
`/admin`, guarded the way `billing` is, rendering `BooksPage` from
`app/admin/accounting/BooksPage.tsx`. `docs/SPEC/00-data-model.md` section 11
gains the round's line as every shared-zone round has.

## 5. `app/api/create-api.ts` — the mount

```ts
import { mountAccounting } from './accounting/routes';
…
  mountAccounting(api, deps.now);
```

beside `mountBilling(api, deps.now)`. Nothing under `/api/accounting` is
reachable without a session; nothing is mounted ahead of the authentication
fence.

## 6. `domain/shared/audit-narrative.ts` — the feed's sentences

Sentences for the five tables, each naming no household because the rows
carry none: `journal_entry` insert — "posted a journal entry" (kind
`reversal`: "reversed a journal entry"; kind `opening`: "posted the opening
balances"); `fiscal_year` insert — "opened a financial year", update with
`closed_at` newly set — "closed a financial year", with `reopened_at` newly
set — "reopened a financial year"; `account` insert — "added an account",
update — "renamed an account" or, with `archived_at` newly set, "archived an
account"; `accounting_setting` update — "changed the books settings", or
"locked the books through a date" when `locked_through` moved forward and
"moved the books' lock back" when it moved backward. Tests in
`audit-narrative.test.ts` beside the existing ones.

## 7. `package.json` — the job

```
"job:post-books": "node --env-file-if-exists=.env --import tsx jobs/accounting/post-books.ts"
```

beside `job:erasure-files`, and the command in `CLAUDE.md`'s Commands line.
The job runs on the owner's connection across every practice, in the shape of
`jobs/client/retry-erasure-deletions.ts`; it prints counts and never a
figure, an id or a connection string.

## 8. `tests/db/seed.test.ts` — the table inventory, if it enumerates

If the test that asserts "exactly the section 2 and 3 tables plus audit_log
and the bookkeeping tables" enumerates tables by name, it gains
`accounting_setting`, `account`, `fiscal_year`, `journal_entry`,
`journal_line`. The seed generator itself gains nothing: both defaults arrive
by trigger, and the poster is deliberately not run at seed time so that
`tests/accounting/db/` can prove the section 7 identities from a known state.

## 10. `tests/db/bootstrap-practice.test.ts` — the hard-coded list of defaults

The test "gives the practice the same defaults a seeded practice has, table by
table" ends by asserting the exact set of default-carrying tables:

```ts
    expect(Object.keys(actual.counts).sort()).toEqual([
      'goal_category',
      'invoice_number_series',
      'payment_receipt_series',
      'report_number_series',
      'scheduling_setting',
      'vat_setting',
    ]);
```

With 450 and 451 applied, both the seeded and the bootstrapped practice carry
`account` and `accounting_setting` rows, so the list gains the two names (in
sort order: `account`, `accounting_setting` first) and its comment names 450
and 451 beside 100, 202, 400, 402, 405 and 600. The second test in that file
("checks for exactly the defaults the migrations write from tenant") needs no
edit: it reads both sets from the migrations and the database, and 958 (item
3) is what makes them agree.

## 9. `.claude/rules/data-model.md` — nothing

Recorded so the question is not asked twice: every table here carries the
standard columns, so the exemption list does not change. `journal_entry` and
`journal_line` carry `updated_at` and the `set_updated_at` trigger like every
table, even though `app.guard_journal_immutable` means the column never
moves; an exemption would be a second rule to keep in step for no gain.

---

## Left standing, deliberately

- **No change to any billing file.** The poster reads `invoice`, `payment`
  and `entitlement` through `app.unposted_money_events()` (454, security
  definer, in 952's pattern) and writes only to accounting's own tables.
- **No vendor.** `docs/COMPLIANCE/approved-vendors.md` is unchanged; the
  Zoho Books row stays "not yet" and may be removed by a later round, since
  the general ledger now lives here.
- **No erasure step and no letter sentence.** Nothing in the books names a
  household (`accounting.md` section 11).
