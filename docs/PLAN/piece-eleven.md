# McWellness Piece Eleven: the books

Written 7 September 2026 by Claude for the operator. **The shape was approved
in conversation on 7 September at 03:30; this written plan awaits your read.**

On 7 September the operator asked for the platform to handle the practice's
accounting: purchases, income and expenses, salaries, profit and profit
shares. Four questions were answered the same night: profit shares are the
owners' shares of the company's profit; the platform is to be the practice's
actual set of books, because there is no accountant and no accounting
software yet; one person is on payroll; the practice uses neither an
accountant nor accounting software today.

That is a full set of books, which is too much for one build. It is four
pieces, each useful on its own, in this order:

| Piece | What it is | Size |
| --- | --- | --- |
| Eleven | **The ledger.** The accounts, the journal every money event is written into, financial years with a lock, opening balances, and the three statements | medium, about two sessions |
| Twelve | **Spending.** Suppliers, purchases and expenses with a receipt photo, VAT on purchases, equipment that depreciates, Salik and parking claimed back, a corporate-tax estimate | medium |
| Thirteen | **Pay and profit.** One salary and its payslip; the shareholders and their percentages; profit available; a distribution split by percentage with a statement each | medium |
| Fourteen | **Bank reconciliation.** Import the bank's statement and match it to the books | small |

This file is piece eleven's plan. The specification it approves is
`docs/SPEC/accounting.md`. Pieces twelve to fourteen each get their own short
plan when their turn comes.

## What piece eleven is

Today the platform knows what the practice sells and what it is paid. It
issues invoices, takes payments, and already tells the difference between
money received and money earned: a package paid up front sits as "sessions
owed" until each session is delivered. What it has nowhere to put is the
practice's own books.

This piece adds them, in the form any accountant would recognise.

**A list of accounts.** Bank, cash box, money still owed by households,
sessions owed to them, VAT owed to the authority, income of each kind,
expenses. The practice gets a sensible starting list on day one and can add
to it or rename entries. Nothing on it can be deleted.

**A journal.** Every movement of money is written into it once, as an entry
that balances: what came from where and went to where. Everything the
platform already does with money writes itself in: every invoice, every
payment, every session delivered, every fee waived. Nobody types those. A
"catch-up" runs when the Books page opens and once a night, and running it
twice adds nothing. An entry is never edited or deleted, by anyone; a mistake
is corrected by a reversing entry that says why, and both stay.

**Financial years.** The year ends on 31 December unless you say otherwise.
You close a year when it is complete; a closed year takes no new entry, and
anything that arrives late for it is written on the first open day with a
note of the day it really happened.

**Three statements**, worked out fresh every time from the journal and never
stored: the trial balance, the profit and loss, and the balance sheet. Each
downloads as a spreadsheet file. Alongside them, an overview: the month's
cash and earnings, the sessions still owed, the year's result so far, what is
in the bank, and an estimate of the corporate tax to set aside.

**The books name nobody.** No household, no invoice number, no payment
reference appears anywhere in them. So when a household is forgotten at its
request, the books do not change, and you and finance see the same figure to
the fils.

## What it deliberately leaves out

- **Spending.** No expenses, purchases, suppliers or receipts yet. The
  starting list of accounts has a place for them, and the next piece fills
  it.
- **Salaries and profit shares.** Piece thirteen. Nothing about them is
  built or half-built here.
- **The bank statement.** No import and no matching until piece fourteen.
- **Filing anything.** The corporate-tax figure is an estimate, labelled as
  one on every screen. The VAT return's boxes wait for piece twelve, because
  they need VAT on purchases. An accountant files; the platform never does.
- **A payments provider or accounting software.** No vendor is involved and
  nothing leaves the platform.

## Decisions only the operator can take

Claude's defaults stand until you overrule them. Each is a setting or a
one-line rule, so changing one later is cheap.

1. **Profit is counted on sessions delivered, not on cash received.** This
   is how accountants and the tax authority count it, and it is how the
   platform already counts earnings. A month that sells a big package and
   delivers nothing is a good cash month and a poor trading month; the
   overview shows both so neither hides the other.
2. **The year ends on 31 December.** It can be changed until the first entry
   is written, and not after.
3. **Three places money sits**: the bank account, a cash box, and a holding
   place for payment links until the money reaches the bank. More can be
   added.
4. **You type the opening balances** on the day the books start: what was in
   the bank, the share capital, the equipment's cost. The screen offers to
   put any difference into an "opening balance" line so the books start
   level.
5. **You and finance see everything; an admin sees none of it** in this
   piece. Piece twelve lets an admin record expenses and nothing else.
6. **The corporate-tax estimate** uses 9 percent above AED 375,000, both
   changeable in Settings. The accountant decides any relief.

## What it costs

Under the cost rules of `docs/HANDOVER.md` section 6: one builder on Opus,
about one million tokens across two sessions; one combined review and one
re-check on Fable 5.1, about 0.4 million together; a fix round, about 0.3
million; a staging pass on Sonnet, about 0.3 million. Roughly two million
tokens in all, comparable to piece eight. Nothing to buy and no vendor to
approve.

## What you have to do

Nothing before the build. When it is on staging, three things, each a few
minutes:

1. Say the day the books start (the day the company began trading, or the
   first of a month you choose).
2. Give the opening balances for that day: the bank balance, the share
   capital, and what the equipment cost.
3. Read the starting list of accounts and rename anything you would call by
   another name.

## Builder notes

**One stream, its own worktree, its own database.** The `accounting`
worktree owns `domain/accounting/**`, `app/admin/accounting/**`,
`app/api/accounting/**`, `db/policies/accounting/**`, `jobs/accounting/**`,
`tests/accounting/**` and migrations `450–499`. The migration runner's
three-digit filenames leave no free hundred, so the range is carved from the
upper half of billing's, which has used nine files of its own.

**What it owes the trunk**, each an item in
`docs/CHANGE-REQUESTS/accounting-01.md` and, by the precedent of pieces seven
to ten, riding in the piece's own pull request: the ownership row; the
data-model section; migration 958, which tells the first-practice bootstrap
about the two new per-practice defaults; four `accounting.*` actions and the
Books rail entry; the route mount; the activity-feed sentences; the
`job:post-books` script; the ports row.

**Nothing in billing changes.** The poster reads billing's tables through a
definer function that names nobody (the pattern of migrations 952 and 953),
so the books are complete whoever runs it, and no billing route or screen is
touched. The one test that matters most: after one posting run on the seed,
the journal's "sessions owed" balance equals the figure the billing summary
already shows, to the fils.

Everything else is checked as pieces one to ten were: one combined review and
one re-check, the record posted, the merge, a staging pass.

## What approving this means

Approving this file approves `docs/SPEC/accounting.md` as written and the six
defaults above as Claude's standing until you overrule them. It approves
nothing of pieces twelve to fourteen beyond their order; each comes back to
you with a plan of its own.
