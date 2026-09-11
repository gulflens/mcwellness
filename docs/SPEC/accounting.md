# SPEC — The books: the ledger (piece eleven)

_Worktree: `accounting`, owning `domain/accounting/**`, `app/admin/accounting/**`, `app/api/accounting/**`, `db/policies/accounting/**`, `jobs/accounting/**`, `tests/accounting/**` and migrations `450–499` (carved from the upper half of billing's range; the ownership row is item 1 of `docs/CHANGE-REQUESTS/accounting-01.md`). Entities are summarised in `00-data-model.md` section 6 once item 2 of the same request is applied; this file is authoritative for them. Builds on `billing.md` sections 1, 4 and 7, on migrations 402, 403 and 408, and on `docs/SEAMS.md` ("After the commit"). This file defines behaviour._

Status: **the shape and its defaults were approved by the operator on 2026-09-07 (03:30 +04) in conversation, and amended the same day at 13:20 after a comparison with Zoho Books' UAE edition, when the operator adopted all fifteen additions that comparison proposed.** The four that belong to this piece are the lock date (4.4), the cash flow statement (4.5), the Small Business Relief switch with its revenue watch (4.5, 5.1) and the Zoho-shaped exports (4.6); the roadmap became six pieces (section 14). **Approved by the operator on 2026-09-07 (14:18 +04) with `docs/PLAN/piece-eleven.md`.**

---

## 1. Purpose

The practice's books, kept inside the platform, in the form every accountant expects: a chart of accounts and a general journal in which every movement of money is written once as a balanced entry, from which a trial balance, a profit and loss statement, a balance sheet and a cash flow statement are computed and never stored.

`billing.md` section 7 planned to keep the entitlement ledger here and push journal entries to Zoho Books nightly, batched and idempotent, with a reconciliation report proving the subledger ties to their general ledger. The operator decided on 2026-09-07 that the general ledger lives in the platform too, because the practice has no accountant and no accounting software yet and its statements are to be the books. So this piece is that nightly poster pointed inward: the same events, the same idempotency, the same reconciliation, into tables of the platform's own. The comparison with Zoho Books that followed (13:20) confirmed the choice where the business is unusual — prepaid programmes released per session, travel eating a home visit's margin — and told the later pieces to copy the tax authority's own forms exactly where the rules are generic.

Three ideas hold the whole thing.

**Everything the platform already does with money posts itself.** An invoice issued, a payment received, a credit used up, a fee waived: each is already a row in billing's tables, and each becomes one journal entry by a fixed rule (section 7). No billing screen and no billing route changes. A poster reads what has not yet been posted and posts it, and running it twice adds nothing.

**The journal is written once.** An entry is never edited and never deleted, by anybody, on any connection: a mistake is corrected by a reversing entry that names the one it reverses and says why, and both stay. This is CLAUDE.md rule 7 applied to the books.

**The books name nobody.** A journal line carries an amount, a day, an account and the id of the billing row it came from — never a client, a contact, an invoice number or a reference. The practice's takings, its liabilities and its profit are facts about the practice, and (migration 952's argument) a figure that quietly moved with who was looking would be worse than one that was refused. An erasure therefore reaches nothing here, and the owner and finance see the same statement to the fils.

## 2. What exists on `main`, and what this adds

| Already built | This piece adds |
| --- | --- |
| `invoice`, `invoice_line`, `payment`, `entitlement`, `package_purchase` (402, 403); the call-out fee and its waiver (408); the VAT switch (406) | The journal those rows post into, and the poster that reads them |
| `monthlyMoney` (`domain/billing/recognition.ts`): cash collected, revenue recognised, deferred balance; `app.practice_money_ledger` (952), a definer function that names nobody | The same three figures on the Books overview, and a reconciliation test proving the journal's contract-liability balance equals `monthlyMoney`'s deferred figure on the seed |
| `app.vat_taxable_supplies_fils` (953) and the VAT threshold watch on the settings page | The same watch for Small Business Relief: the financial year's revenue against AED 3,000,000 |
| Per-practice defaults by after-insert trigger on `tenant`, checked by `app.bootstrap_practice` (202, 400, 402, 405, 600, 956) | Two more: the chart of accounts and the books settings (450, 451), and the trunk's 958 that tells the bootstrap about them |
| `canActor` and `app.actor_has_role`; the office roles owner, admin, lead practitioner, finance | Four `accounting.*` actions; the books are the owner's and finance's alone in this piece |
| The admin console's page shape (`BillingPage.tsx`: sections, tables, right-side drawer, `formatFils`) | The Books page in the same shape |
| `c.get('afterCommit')`, the request transaction, `set_config` context; `jobs/client/retry-erasure-deletions.ts` as the shape of a job | `pnpm job:post-books`, the nightly catch-up |

## 3. Who uses it

| Role | Reads the books | Posts an entry | Closes a year, locks a date, changes settings |
| --- | --- | --- | --- |
| Owner | yes | yes | yes |
| Finance | yes | yes | no |
| Admin | no | no | no |
| Lead practitioner, practitioner, client contact | no | no | no |

Admin is deliberately outside the books in this piece: nothing here is an expense an admin records, and salaries and profit shares (piece fourteen) are the owner's and finance's. Piece twelve admits an admin to expenses and to nothing else. Enforced twice, as billing is: in `domain/shared/actor.ts` and in row-level security (section 10). An accountant, when the practice engages one, is given the finance role and nothing is built for them.

## 4. The books, in six parts

### 4.1 The chart of accounts

A per-practice list of accounts, created by trigger the moment a practice exists (and by a data step for every practice that already does), so no code path ever answers "which account" with a constant. Each account has a four-digit code, a name in English and optionally Arabic, one of five types — asset, liability, equity, income, expense — and, for the accounts the poster and the statements must find, a **role**. A role is unique per practice and belongs to exactly one account; an account the owner adds has none.

The default chart, codes in the ranges an accountant expects (`billing.md` section 7's minimum, extended):

| Code | Name | Type | Role |
| --- | --- | --- | --- |
| 1010 | Bank, operating | asset | `bank` |
| 1020 | Cash box | asset | `cash` |
| 1030 | Payment link clearing | asset | `link_clearing` |
| 1200 | Accounts receivable | asset | `receivable` |
| 1500 | Equipment, at cost | asset | — |
| 2100 | Refunds payable | liability | `refunds_payable` |
| 2400 | Contract liability, sessions owed | liability | `contract_liability` |
| 2500 | VAT payable | liability | `vat_payable` |
| 3000 | Share capital | equity | — |
| 3100 | Opening balance equity | equity | `opening_balance` |
| 4000 | Session income | income | `income_sessions` |
| 4100 | Brain map income | income | `income_assessments` |
| 4300 | Call-out fee income | income | `income_fees` |
| 4400 | Income from expired credits | income | `income_expired` |
| 6000 | General expenses | expense | — |
| 6200 | Bank and payment fees | expense | — |

Retained earnings and the current year's result are **computed, not accounts** (section 4.5): there are no closing entries, so there is nothing to post them to.

The owner or finance may add an account (a free code whose first digit matches its type: 1 asset, 2 liability, 3 equity, 4 income, 5 or 6 expense), rename one, or archive one that has no role and a zero balance. Nothing deletes an account.

### 4.2 The journal

One general journal per practice. An **entry** has a number (`JE-000001`, per practice, from a counter on the books settings row), the day it belongs to, a kind — `opening`, `automatic`, `manual`, `reversal` — a memo of at most 200 characters, and at least two **lines**, each naming an account and carrying a debit or a credit in integer fils, exactly one of the two and greater than zero. An entry's debits equal its credits, enforced at commit by a deferred constraint trigger, and again in `domain/accounting/journal.ts` before the request ever reaches the database.

An automatic entry also carries what it came from: the billing table, the row's id and the event (section 7). Those three, with the practice, are unique — that is the idempotency, and it is a constraint, not a check-then-insert.

No row in `journal_entry` or `journal_line` is ever updated or deleted. The table grants no update and no delete to the API role, and a trigger refuses both for every role including the database owner's, so a fix to the schema cannot quietly become a fix to the books. A reversal is a new entry of kind `reversal` whose lines are the original's with debit and credit exchanged, naming the entry it reverses and carrying a reason.

### 4.3 The poster

`domain/accounting/posting.ts` is a pure function: a money event in, a journal draft out, or nothing when the event posts nothing. It knows the chart only by roles. `app/api/accounting/poster.ts` reads the events not yet in the books, hands each to that function and inserts what comes back, all inside one transaction, in the order the events happened. It is run:

- by `POST /api/accounting/post`, which the Books page calls when it opens and which the "Bring the books up to date" button calls on demand;
- by `pnpm job:post-books` (`jobs/accounting/post-books.ts`), the nightly catch-up on the owner's connection, across every practice;
- **never** from a billing route or an after-commit hook. Reads stay reads (the `GET` routes of section 9 write nothing), and no other stream's path changes.

**It reads through a definer function, and that is what makes the books complete.** Read as the caller, `invoice`, `payment` and `entitlement` pass through `app.client_erasure_gate` (`db/policies/billing/ledger.sql`): finance would never see an erased household's rows, so finance's poster would skip them and the owner's would post them later, and the books would depend on who ran the job. `app.unposted_money_events()` (migration 454) is security definer in the pattern of 952 and 953: it checks the caller's role itself, anti-joins billing's rows against the journal's idempotency key, and returns amounts, days in the practice's own time zone, kinds, methods, a service code and the source ids — and nothing that names anybody.

**A late event lands on the first open day.** An event whose day falls inside a closed year, or on or before the lock date (section 4.4), is posted with the day set to the first day that is both after the lock and inside an open year, and its memo names the day it actually happened. Books that are closed stay closed; the event is not lost and not hidden.

### 4.4 Years, the lock, and the lock date

A financial year runs to the year end on the books settings row (31 December by default; changeable only while the journal is empty). A `fiscal_year` row is created on demand the first time an entry needs it, by `app.fiscal_year_for(date)`, so there is never a year with no row and never a row for a year with nothing in it.

The owner **closes** a year with a reason. Closing is refused while any money event dated inside the year is not yet posted (the route runs the poster first, then checks), and while the year's last day is still in the future. A closed year accepts no entry: a trigger refuses the insert, and the poster's late-event rule is the one path around it. The owner may **reopen** a year with a reason. Both are audited and appear in the activity feed.

**The lock date is for the quarters.** VAT returns are filed quarterly, within 28 days of the quarter's end, and once one is filed the figures behind it must not move. So besides closing a year the owner may **lock the books through a date**, with a reason: no entry may be dated on or before `accounting_setting.locked_through`, in an open year or a closed one. The date may not be in the future. Moving it forward is the normal act after each return; moving it back is allowed to the owner, with a reason, and is audited as such, because a practice that files a corrected return needs the door and an audit row is the right price for it. The poster treats the lock exactly as it treats a closed year (4.3). Piece twelve's VAT return moves the lock automatically when a return is marked filed; this piece gives it the lever.

### 4.5 The statements

All computed, none stored, every one a pure function in `domain/accounting/statements.ts` over the posted lines with every date an argument (`.claude/rules/testing.md`):

- **Trial balance** as of a day: every account with a non-zero movement, debits, credits, balance in the account's natural direction, and totals that agree.
- **Profit and loss** for a period: income accounts, expense accounts, the result.
- **Balance sheet** as of a day: assets, liabilities, equity accounts, then two computed lines — *result for the year to date* (the profit and loss of the current financial year up to that day) and *retained earnings* (the sum of every earlier year's result) — and the identity assets = liabilities + equity holds or the function throws.
- **Cash flow**, direct method, for a period: every line on an account with a cash role, classified by the type or role of the account on the other side of its entry — *from households* (`receivable`), *for expenses and suppliers* (expense accounts, and the payables role piece twelve adds), *to owners and shareholders* (equity, and the distributions role piece fourteen adds), *tax* (`vat_payable`, and the corporate-tax role piece fourteen adds), *other*; transfers between cash accounts net to nothing and are listed separately; then opening cash, net change, closing cash. Closing cash must equal the cash position on the period's last day or the function throws.
- **An account's ledger** for a period: opening balance, each line with its entry number, day and memo, running balance, closing balance.
- **Cash position** as of a day: the balances of the accounts with roles `bank`, `cash` and `link_clearing`, and their sum.
- **Corporate-tax set-aside**, an estimate and labelled so on every screen. While `small_business_relief_elected` is on and the financial year's revenue to date is at or below `small_business_relief_threshold_fils` (default AED 3,000,000), the estimate is **zero** — the practice, a free-zone company selling consultancy to individuals in the UAE, expects to elect the relief each year until its revenue passes the threshold; the adviser confirms the election. Once the year's revenue exceeds the threshold, or when the switch is off, the estimate is the year-to-date result above `corporate_tax_threshold_fils` (default AED 375,000) at `corporate_tax_rate_basis_points` (default 900). Beside it, **the relief watch**: revenue this financial year against the relief threshold, calm below 80 percent, a warning from 80 percent, and the words "relief lost for this year" past it — the same shape as the VAT watch of 953. The platform files nothing; the adviser decides the election and the return.

Each statement has a CSV export that is the same rows the screen shows, produced by the same function.

### 4.6 Exports

Besides each statement's own CSV, two files in the column layout of **Zoho Books' import templates**: the journal (date, reference, notes, account name, debit, credit) for a period, and the chart of accounts (code, name, type). The builder verifies the headings against the current templates and records them in the test, so that the day the practice hands its books to an accountant who works in Zoho, or moves to it, is a file and not a project. Nothing is sent anywhere by the platform: the person downloads the file. No vendor is involved and `docs/COMPLIANCE/approved-vendors.md` does not change.

## 5. Screens

**The Books page**, `app/admin/accounting/BooksPage.tsx`, in `BillingPage.tsx`'s exact shape: a page header, loading and error notes, sections chosen one at a time and named in the address bar, tables, a right-side drawer for anything written. Every figure is formatted by the page's own `money.ts` (re-exporting `formatFils`) and computed on the server; no screen does arithmetic on money. Rail entry **Books**, beside Billing, offered only to those `canOpenBooks` admits (`docs/CHANGE-REQUESTS/accounting-01.md` item 4).

**5.1 Overview.** Three rows of figures. From billing's summary route, the three that already exist: cash collected this month, revenue recognised this month, sessions owed. From the books: result for the year to date, cash position, accounts receivable, the corporate-tax set-aside with the word *estimate* beside it, and the relief watch (4.5). And **events not yet in the books**, a count that reads zero after the page's own posting call and otherwise names how many with a "Bring the books up to date" button. Beneath, the month's automatic entries as a table.

**5.2 Journal.** The entries, newest first, filtered by period and account: number, day, kind, memo, debit total, and for an automatic entry the event it came from in words ("payment received", "credit used up"). Opening one shows its lines. Two actions: **Post an entry** (a drawer: day, memo, lines with account and side and amount, a running difference that must read zero before Save is offered, and a reason), and **Reverse**, offered on any entry that has not already been reversed (a drawer asking why). The opening entry is posted from the same drawer with kind `opening` and the books' start day fixed; the drawer offers **Balance with opening equity**, which adds the difference as one line on the `opening_balance` account (section 6, rule 9). A day on or before the lock date is refused in the drawer with the lock named.

**5.3 Accounts.** The chart as a table: code, name, type, role in words, balance as of today. Add and rename through a drawer; archive with a reason. Opening an account shows its ledger for a chosen period, running balance and all.

**5.4 Statements.** A period or a day picker, then the trial balance, the profit and loss, the balance sheet and the cash flow, each as a table with a **Download CSV** button. The balance sheet's two computed lines are marked as computed. Beneath, **Exports**: the two Zoho-shaped files (4.6).

**5.5 Settings.** Owner only. The books' start day, the year end, the corporate-tax rate and threshold, the relief switch and its threshold, each with a reason on save; the lock date with **Lock through** and its reason, and a plain sentence saying what a lock does; the list of financial years with **Close** and **Reopen**. Year end is disabled once the journal has an entry, with a sentence saying why.

Nothing on any of these screens shows a household's name, an invoice number, a payment reference or a client id, and no route under `/api/accounting` returns one.

## 6. Rules

Each is a pure function under `domain/accounting/` with a test file named after it, covering every branch (`.claude/rules/testing.md`), and enforced again in the database where the rule concerns what may be written at all.

1. **Balanced or refused.** `assertBalanced(lines)`: the sum of debits equals the sum of credits, there are at least two lines, every line has exactly one positive side. Database: a deferred constraint trigger on `journal_line` checks the entry's sums at commit.
2. **Written once.** No update, no delete, on `journal_entry` or `journal_line`, for any role. Database: `app.guard_journal_immutable`, before update or delete, raises for everyone.
3. **A closed year or a locked date takes nothing.** `mayPostOn(day, years, lockedThrough)`: false when the day falls in a closed year or is on or before the lock date. Database: `app.guard_locked_books` before insert on `journal_entry`, reading `fiscal_year` and `accounting_setting.locked_through`.
4. **A late event lands on the first open day.** `landingDayFor(occurredOn, years, lockedThrough)`: the day itself when it is after the lock and its year is open or does not exist yet; otherwise the first day after the lock that is inside an open year. The poster writes the true day into the memo.
5. **Posting is idempotent.** `postingsFor(event, chart)` is deterministic, and the journal's unique key on (practice, source table, source id, event) makes a second insert a no-op (`on conflict do nothing` on the header, lines written only when the header was).
6. **Roles are found, never assumed.** `accountByRole(chart, role)` throws when a role is missing; the poster refuses to run against a chart without every role section 7 needs, and says which.
7. **A code matches its type.** `codeMatchesType(code, type)`: first digit 1 asset, 2 liability, 3 equity, 4 income, 5 or 6 expense; four digits; unique per practice. Database: a check constraint and a unique index.
8. **An account with a role or a balance is not archived.** `mayArchive(account, balanceFils)`.
9. **The opening entry is dated the books' start day**, is of kind `opening`, and `balanceWithOpeningEquity(lines, chart)` returns the lines plus one on the `opening_balance` account for whatever difference remains, or the lines unchanged when there is none.
10. **Year end changes only while the journal is empty.** `mayChangeYearEnd(entryCount)`.
11. **A year closes only when whole.** `mayCloseYear(year, today, unpostedInYear)`: the last day is not after today and nothing dated inside it is unposted.
12. **The balance sheet balances or throws.** `balanceSheet` computes retained earnings and the year-to-date result and asserts the identity; a chart that has drifted is a thrown error, never a statement that looks right.
13. **Statements are the same whoever asks.** No statement route or function takes the actor as an input; the poster reads through `app.unposted_money_events()`, and the reads of section 9 read the journal, which names nobody.
14. **The lock date is never in the future**, `mayLockThrough(date, today)`, and moving it backward is a distinct outcome of `lockMove(current, next)` — `forward`, `backward` or `unchanged` — so the route can demand the reason and the audit sentence can say which.
15. **The tax estimate follows the election.** `corporateTaxEstimate(resultYtd, revenueYtd, setting)`: zero while elected and revenue is at or below the relief threshold; otherwise the result above the taxable threshold at the rate, never below zero.
16. **The relief watch has three states.** `reliefWatch(revenueYtd, threshold)`: `clear` below 80 percent, `approaching` from 80 percent to the threshold, `exceeded` past it.
17. **Cash flow ties to cash.** `cashFlow(lines, from, to)` classifies every cash-role line by its counter-account and throws when closing cash differs from the cash position on the last day.

## 7. Posting rules

`postingsFor` in `domain/accounting/posting.ts`. Amounts are the source row's own integers; nothing is recomputed. Dates are the practice's own day of the timestamp named. An event not listed posts nothing and is counted as "unknown" on the overview.

| Event (`source_event`) | Source row and condition | Lines |
| --- | --- | --- |
| `invoice.issued` | `invoice` of kind `session`, `package` or `single_session` (migration 411, trunk round 43 — a session sold ahead of its visit), on `issued_on` | Dr `receivable` gross · Cr `contract_liability` net · Cr `vat_payable` vat, that line omitted when vat is zero |
| `invoice.issued` | `invoice` of kind `call_out_fee`, on `issued_on` | Dr `receivable` gross · Cr `income_fees` net · Cr `vat_payable` vat (omitted at zero) |
| `invoice.issued` | `invoice` of kind `statement` | **Nothing.** Nothing writes one today, and 953 records that a statement may be a re-presentation of charges already invoiced; counted as unknown until billing says what it is (piece thirteen makes it the household's statement of account, which posts nothing by design) |
| `payment.received` | `payment`, on the day of `received_at` | Dr `bank` (method `transfer`), `cash` (`cash`) or `link_clearing` (`link`) amount · Cr `receivable` amount |
| `credit.consumed` | `entitlement` with status `consumed`, on the day of `consumed_at`, any consumption kind | Dr `contract_liability` allocated net · Cr `income_assessments` when the service code is `brain-map`, otherwise `income_sessions` |
| `credit.waived` | `entitlement` with status `waived` **and** a credit whose `replaces_entitlement_id` names it, on the day of `waived_at` | Dr the income account the consumption credited · Cr `contract_liability` allocated net — the consumption is unwound because the household holds the replacement credit again |
| `credit.waived` | as above, with **no** replacement credit | **Nothing.** The consumption stands |
| `credit.expired` | `entitlement` with status `expired`, on `expires_on` | Dr `contract_liability` allocated net · Cr `income_expired`. Nothing writes this status today; the rule waits for billing, and from 2026-09-12 it can only ever reach a credit that was sold with a term (see below) |
| `credit.refunded` | `entitlement` with status `refunded`, on the day of `updated_at` | Dr `contract_liability` allocated net · Cr `refunds_payable`. The money leaving the bank is piece twelve's act; nothing writes this status today |
| `fee.waived` | `invoice` of kind `call_out_fee` with `waived_at` set, on the day of `waived_at` | Dr `income_fees` net · Dr `vat_payable` vat (omitted at zero) · Cr `receivable` gross |

**A credit sold with no term is never released to income by expiry.** From 12 September 2026 a programme and a price may each carry a term or none, and where there is none the credit is written with no `expires_on` at all (`billing.md` section 4.3, migration 412). `credit.expired` is posted on that date, and `app.unposted_money_events()` (migration 454) already required `expires_on is not null` before it would offer a credit as expired at all — so nothing here had to change. A credit sold with no term can never reach the status, and `income_expired` (4400) can never be credited for it: the only two things that move its share of `contract_liability` are consumption and a refund. That is the accounting consequence of the operator's ruling that a household keeps every session it paid for — the money stays a promise the practice still owes until the session is delivered or the money is given back, however long that takes. Nothing changes about how the sale itself posts. The rule is stated now because it is the kind of thing a bookkeeper looks for at a year end and does not find.

**A session sold ahead of its visit posts as a package does.** `single_session` is not a case of its own in `postingsFor` — it shares `invoice.issued`'s first row with `session` and `package` on purpose, since a credit sold before the visit and a credit sold inside a bundle are the same fact for the books: money in, in exchange for a promise still owed. The sale is credited to `contract_liability`, never to income, and only moves to `income_sessions` (or `income_assessments`, for the brain map) later, when `credit.consumed` fires for the entitlement it created — a package of one, exactly.

**The identity these rules keep**, proved on the seed (section 12): the `contract_liability` balance equals `monthlyMoney`'s deferred figure; `receivable` equals invoices issued gross less payments received less fees waived gross; `vat_payable` equals invoice VAT less waived VAT; income by month equals `revenueRecognisedFils` by month plus fee income; the three cash accounts equal payments by method. `allocateEntitlements` hands out its rounding remainder so a package's credits sum exactly to its net (`domain/billing/allocation.ts`), which is what lets the first identity hold to the fils.

**The VAT tax point is the invoice's, not this file's.** `vat_payable` is credited on the day the invoice is issued because that is what the invoice already says (406 and `billing.md` section 5); on a prepaid package that means the whole programme's VAT at the sale. `billing.md` section 5.3 and the `uae-compliance` skill record that written advice on the tax point of prepaid packages is pending and must not be assumed. If the adviser rules that VAT falls due as sessions are delivered, the change is to two rows of this table — `invoice.issued` credits a VAT-deferred account and `credit.consumed` moves the credit's share to `vat_payable` — and to nothing else. Until then the books say what the invoices say.

**A tax credit note will post here too.** UAE VAT law requires a tax credit note when an issued tax invoice is reduced or cancelled; billing has none today and piece twelve adds it. Its event, `credit_note.issued`, reverses the invoice's lines for the amounts on the note and is listed in this table by that piece; nothing in this piece anticipates its columns.

## 8. Data

Migrations `450–454` in the accounting range; every table carries the standard columns of `.claude/rules/data-model.md`, `tenant_isolation` and `audit_row` triggers, `set_updated_at` where updates are allowed, and a `comment on table` beginning `'audited: no client'`. No table here has a `client_id`, by design (section 1).

**450 `accounting_setting`** — one row per practice, by after-insert trigger on `tenant` (`app.default_accounting_setting`) and a data step for practices that exist. `books_start_on date not null default current_date`, `year_end_month smallint not null default 12`, `year_end_day smallint not null default 31` (checked as a real month-day), `locked_through date`, `corporate_tax_rate_basis_points integer not null default 900`, `corporate_tax_threshold_fils bigint not null default 37500000`, `small_business_relief_elected boolean not null default true`, `small_business_relief_threshold_fils bigint not null default 300000000`, `next_entry_number integer not null default 1`. Select and update to `app_role`; never insert, never delete.

**451 `account`** — `account_type` enum (`asset`, `liability`, `equity`, `income`, `expense`); `account_role` enum (the twelve roles of section 4.1; later pieces add values with `alter type … add value` in their own migrations); `code text not null check (code ~ '^[1-6][0-9]{3}$')`, `name text not null`, `name_ar text`, `type account_type not null`, `role account_role`, `archived_at timestamptz`, `archive_reason text`; check that the first digit matches the type; `unique (tenant_id, code)`, `unique (tenant_id, role)`, `unique (tenant_id, id)`. The default chart of section 4.1 by trigger (`app.default_chart_of_accounts`) and data step. Select, insert, update to `app_role`; never delete.

**452 `fiscal_year`** — `starts_on date not null`, `ends_on date not null check (ends_on > starts_on)`, `status fiscal_year_status not null default 'open'` (`open`, `closed`), `closed_at`, `closed_by`, `close_reason`, `reopened_at`, `reopen_reason`; no two years of a practice overlap (an exclusion constraint on the date range). `app.fiscal_year_for(p_on date) returns uuid`: the row containing the day, inserted from the settings row's year end when absent. Select and update to `app_role`; insert only through the function.

**453 `journal_entry`, `journal_line`** — `journal_kind` enum (`opening`, `automatic`, `manual`, `reversal`). Entry: `number integer not null`, `reference text generated always as ('JE-' || lpad(number::text, 6, '0')) stored`, `entered_on date not null`, `fiscal_year_id uuid not null`, `kind journal_kind not null`, `memo text not null check (length(btrim(memo)) between 1 and 200)`, `source_table text`, `source_id uuid`, `source_event text`, `occurred_on date` (set only when it differs from `entered_on`, rule 4), `reverses_entry_id uuid`, `reversal_reason text`; checks that the three source columns are all null or all set, that `kind = 'automatic'` exactly when they are set, that a reversal names an entry and a reason and nothing else does, that an opening entry's day is the settings row's start day; `unique (tenant_id, number)`, `unique (tenant_id, source_table, source_id, source_event)`, `unique (tenant_id, reverses_entry_id)`. `app.next_journal_entry_number()` takes the counter under `for update`, in a `before insert` trigger when `number` is null. Line: `entry_id`, `line_no integer not null check (line_no >= 1)`, `account_id uuid not null`, `debit_fils bigint not null default 0 check (debit_fils >= 0)`, `credit_fils bigint not null default 0 check (credit_fils >= 0)`, `check ((debit_fils > 0) <> (credit_fils > 0))`, `unique (tenant_id, entry_id, line_no)`, composite foreign keys on `(tenant_id, entry_id)` and `(tenant_id, account_id)`. Triggers: `app.guard_journal_immutable` (before update or delete, both tables, raises for every role), `app.guard_locked_books` (before insert on the entry: a closed year or a day on or before `locked_through`), `app.guard_journal_balanced` (a constraint trigger on the line, deferrable initially deferred, checks the entry's sums and line count). Select and insert to `app_role`; never update, never delete.

**454 `app.unposted_money_events()`** — security definer, `set search_path = pg_catalog, pg_temp`, role check for owner or finance, tenant from context; returns `(source_table text, source_id uuid, source_event text, occurred_on date, invoice_kind text, net_fils bigint, vat_fils bigint, gross_fils bigint, amount_fils bigint, method text, service_code text, has_replacement boolean)` for every billing row of section 7 with no matching `journal_entry`, ordered by `occurred_on` then source. Days are in `tenant.timezone`, the practice's own zone (as 952 renders them). Grant execute to `app_role` only. `-- Needs: 402, 403, 408, 453`.

Policies in `db/policies/accounting/`: `tenant_isolation.sql` over the five tables in `db/policies/billing/ledger.sql`'s shape, and `access.sql`: select for owner and finance on all five; insert on the journal tables and insert/update on `account` for owner and finance; update on `accounting_setting` and `fiscal_year` for the owner. The trunk's 958 (request item 3) adds `account` and `accounting_setting` to `app.bootstrap_practice`'s list.

## 9. API

Mounted by `mountAccounting(api, deps.now)` from `app/api/accounting/routes.ts` (request item 5). Every route refuses with 403 before touching the database unless `canActor` allows the action named; every write requires `X-Reason`; responses are parsed through zod schemas in `schema.ts` before they leave, and none carries a client id, a name, an invoice number or a payment reference.

| Route | Action | What it does |
| --- | --- | --- |
| `POST /api/accounting/post` | `accounting.write` | Runs the poster; answers how many entries it wrote and how many events remain unknown |
| `GET /api/accounting/overview?month=` | `accounting.read` | Section 5.1's figures from the books, the relief watch and the unposted count; the three billing figures come from `/api/billing/summary`, which finance already reads |
| `GET /api/accounting/entries?from&to&account&limit` | `accounting.read` | Entries, newest first, at most 500 (default 200), with `truncated: true` when more exist; the codebase bounds lists with a limit and no cursor (billing's invoice book) |
| `GET /api/accounting/entries/:id` | `accounting.read` | One entry with its lines |
| `POST /api/accounting/entries` | `accounting.write` | A manual or opening entry (rules 1, 3, 9) |
| `POST /api/accounting/entries/:id/reversal` | `accounting.write` | The reversing entry (section 4.2) |
| `GET /api/accounting/accounts` · `POST` · `PATCH /:id` | `accounting.read` / `accounting.write` | The chart; add; rename or archive (rules 7, 8) |
| `GET /api/accounting/accounts/:id/ledger?from&to` | `accounting.read` | One account's ledger with running balance |
| `GET /api/accounting/statements/trial-balance?asOf` · `profit-and-loss?from&to` · `balance-sheet?asOf` · `cash-flow?from&to` | `accounting.read` | Section 4.5; add `.csv` to any of the four for the export, `text/csv`, the same rows |
| `GET /api/accounting/exports/zoho-journal.csv?from&to` · `zoho-accounts.csv` | `accounting.read` | Section 4.6 |
| `GET /api/accounting/years` · `POST /:id/close` · `POST /:id/reopen` | `accounting.read` / `accounting.year.close` | The years; rule 11 |
| `POST /api/accounting/lock` | `accounting.settings.write` | Sets `locked_through` (rule 14); the reason is required and the audit sentence says forward or backward |
| `GET /api/accounting/settings` · `PATCH` | `accounting.read` / `accounting.settings.write` | Section 5.5; rule 10 |

The poster and every statement take `now` from `deps.now`, never from the clock.

## 10. Permissions and row security

Four actions join `domain/shared/actor.ts` (request item 4): `accounting.read` and `accounting.write` for the owner and finance; `accounting.year.close` and `accounting.settings.write` for the owner. `canOpenBooks` in `app/shell/adminAccess.ts` matches `accounting.read`. Row-level security in `db/policies/accounting/access.sql` says the same floors, and the definer function (454) checks the role again inside, because a definer function that trusts its caller is a hole with a comment on it (952).

## 11. Audit, erasure, retention

Every table here is audited under `'audited: no client'`; the activity feed gains sentences for an entry posted, an entry reversed, a year closed or reopened, the books locked to a date (forward or backward), an account added, renamed or archived, and the books settings changed (request item 6). **Erasure reaches nothing here**: no row names a household, so `app.erase_client` gains no step and the confirmation letter no sentence, and a test in `tests/accounting/db/` erases a seeded household and asserts the books are byte-for-byte unchanged and the statements identical for the owner and for finance. Journal rows are financial records and keep for five years regardless (CLAUDE.md rule 8); nothing here deletes them and no retention job needs to know they exist.

## 12. Seed, tests, done when

The seed gains nothing by hand: the seeded practice receives its chart and settings row from the two triggers, and the poster is **not** run at seed time, so a database test can prove the identity from a known state. If `tests/db/seed.test.ts` enumerates tables, it gains the five (request item 8).

Database tests under `tests/accounting/db/` on the worktree's own Postgres (`docs/SPEC/OWNERSHIP.md` rule 4); unit tests beside each rule in `domain/accounting/`; screen tests for the five sections. **Done when:**

1. On the seeded database, after one posting run, every identity of section 7 holds to the fils, and the trial balance's totals agree.
2. A second run writes nothing and answers zero.
3. After a seeded household is erased, the books are unchanged and the owner's and finance's statements are identical.
4. An unbalanced manual entry, an entry in a closed year, an entry on or before the lock date, an update and a delete of a journal row are each refused by the database — the last two on the owner's connection as well as the API's.
5. A payment dated inside a closed year, and one dated on the lock date, are each posted on the first open day after the lock with the true day in the memo.
6. The balance sheet balances on the seed at every month end of the seeded period, with the computed lines present; the cash flow's closing cash equals the cash position at each of those month ends.
7. Each CSV export equals the screen's rows for the same arguments, and the two Zoho-shaped files carry exactly the headings the test records from the templates.
8. Admin, lead practitioner, practitioner and client contact receive 403 on every route; finance reads and writes; only the owner closes a year, locks a date or changes settings.
9. `app.bootstrap_practice` creates a practice with the chart and the settings row and `tests/db/bootstrap-practice.test.ts` stays green.
10. Year end cannot change once an entry exists; an account with a role or a balance cannot be archived; the opening entry can only be dated the books' start day; the lock date cannot be in the future.
11. On the seed the tax estimate reads zero while relief is elected, the relief watch reads `clear`, and switching the election off yields the rate above the taxable threshold on the year-to-date result.
12. `pnpm verify`, `pnpm test:db` and `pnpm build` are green, and the Books rail entry is invisible to every role but the owner and finance.

## 13. Decisions taken by default

The operator approved these on 2026-09-07 (03:30, amended 13:20) and may overrule any of them; each is a setting or a one-line rule.

1. **Profit is counted on sessions delivered, not cash received** (accrual, the way `monthlyMoney` already counts revenue). Cash is shown beside it.
2. **Year end 31 December.** A setting.
3. **Three cash accounts**: bank, cash box, payment-link clearing. More can be added; the poster uses the three roles.
4. **Opening balances are typed by the owner** on the books' start day, with the difference to opening balance equity if asked.
5. **Owner and finance see everything; admin nothing in this piece.**
6. **The books name nobody**, and so an erasure touches nothing.
7. **Corporate tax is an estimate that starts from the relief.** Small Business Relief is elected by default, the threshold is AED 3,000,000 of revenue in the financial year, and the estimate is zero until revenue passes it or the switch is turned off; then 9 percent above AED 375,000. All four are settings. The adviser confirms the election each year; the platform never files. *(Amended 13:20: the earlier default started from 9 percent.)*
8. **No closing entries.** Retained earnings and the year's result are computed; a closed year is a lock, not a posting.
9. **The migration range** is `450–499`, carved from billing's upper half; the runner's three-digit filenames stay as they are.
10. **Reads are reads.** The Books page posts on opening; no `GET` writes.
11. **No lock date until the owner sets one.** `locked_through` is null on a new practice; piece twelve's VAT return will move it on filing.
12. **The exports copy Zoho Books' templates**, not a format of the platform's own, so that a switch is a file. Nothing is sent to Zoho.

## 14. What the later pieces add, so nothing here pre-builds them

The operator adopted all fifteen additions of the 13:20 comparison; the roadmap is six pieces, each with its own plan when its turn comes.

- **Twelve, spending and VAT**: suppliers; purchases and expenses with a receipt photograph, paid or owed (a `payables` role); recurring costs with a monthly reminder; purchases in a foreign currency recorded with the dirhams actually paid; fixed assets with depreciation (`1590 Accumulated depreciation`, a depreciation expense); the founder's Salik and parking from `visit_actuals` as a reimbursement claim; the money out on a refund (`refunds_payable` to bank); **tax credit notes** on the billing side, numbered, posting as section 7 says; input VAT (a `vat_receivable` role); **the VAT return as Form 201**, including reverse-charge VAT on purchases from abroad, with marking a return filed moving the lock date; **the FTA Audit File** export; an admin admitted to expenses. New roles are added to the enum in a migration of that piece; this piece's chart leaves room for them.
- **Thirteen, performance and statements**: margin per session, per package and per area net of Salik, parking, drive time and consumables; cash runway in months of costs; discounts given against list price; the household's **statement of account** (the `statement` invoice kind, bilingual, sent by the existing hand-off, posting nothing); an ageing list of unpaid invoices with the WhatsApp reminder hand-off; a priced quote after the discovery call, convertible to a sale.
- **Fourteen, pay and profit**: one employee, monthly pay runs with a payslip through the shared writer, **the WPS salary file for the bank** (the free zone requires it, operator 13:20), end-of-service gratuity accrued monthly (a provision role); shareholders and their percentages entered in Settings and never in the repository; profit available for distribution after the tax set-aside; a distribution run split by percentage with a statement per shareholder; the adviser's yearly corporate-tax pack; `salaries`, `salaries_payable`, `gratuity_provision`, `distributions`, `corporate_tax_payable` roles.
- **Fifteen, bank reconciliation**: a CSV import of the bank's statement, matching to lines on the `bank` account, reconciled marks and an exception list. `journal_line` gains a nullable `reconciled_at` then, not now.
- **Sixteen, corporate clients and e-invoicing** (planned for early 2027, operator 13:20: corporate sales are likely): a company as a customer with its own TRN and payment terms; invoices on terms; and PINT AE e-invoicing through an **accredited service provider**, mandatory for business-to-business supplies from 1 July 2027 for practices under AED 50,000,000, with sales to individuals exempt until further notice. The platform cannot be the provider itself (an accredited provider must have run its solution for two years), so the provider is a vendor row and a seam. Invoices stay structured objects now, as `billing.md` section 5.5 has always asked.

## 15. Change requests to the shared zone

Listed in `docs/CHANGE-REQUESTS/accounting-01.md` with proposed diffs: the ownership row and range; the data-model section 6 amendment; the trunk's migration 958; the four actions and `canOpenBooks` with the rail entry and route; the mount in `create-api.ts`; the audit-narrative sentences; the `job:post-books` script; the seed test's table list if it enumerates; and the local ports row. By the precedent of pieces seven to ten and the cost rules of `docs/HANDOVER.md` section 6, they are proposed to ride in the piece's own pull request under the integrator's widening for one round. No vendor is involved and `docs/COMPLIANCE/approved-vendors.md` does not change.
