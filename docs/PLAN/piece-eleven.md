# McWellness Piece Eleven: the books

Written 7 September 2026 by Claude for the operator. **The shape was approved
in conversation on 7 September at 03:30 and amended at 13:20 after a
comparison with Zoho Books; this written plan awaits your read.**

On 7 September the operator asked for the platform to handle the practice's
accounting: purchases, income and expenses, salaries, profit and profit
shares. Four questions were answered the same night: profit shares are the
owners' shares of the company's profit; the platform is to be the practice's
actual set of books, because there is no accountant and no accounting
software yet; one person is on payroll; the practice uses neither an
accountant nor accounting software today.

At 13:20 the plan was compared with Zoho Books' UAE edition. Fifteen
additions came out of it, six of them about staying compliant with the tax
authority and nine about running the business better, and the operator
adopted all fifteen. Two more answers were given: the practice will likely
sell to companies within the year, and the free zone requires the founder's
salary to go through the Wage Protection System.

That is a full set of books, which is too much for one build. It is six
pieces, each useful on its own, in this order:

| Piece | What it is | Size |
| --- | --- | --- |
| Eleven | **The ledger.** The accounts, the journal every money event is written into, financial years with a lock and a lock date, opening balances, four statements, and exports an accountant can open | medium, about two sessions |
| Twelve | **Spending and VAT.** Suppliers, purchases and expenses with a receipt photo, recurring costs, purchases in euros or dollars, equipment that depreciates, Salik and parking claimed back, tax credit notes, the VAT return as the authority's own form with the audit file it can demand | large |
| Thirteen | **Performance and statements.** Margin per session and per area net of travel, cash runway, discounts given, a statement of account per household, who owes what and for how long with a reminder, a quote after the discovery call | medium |
| Fourteen | **Pay and profit.** One salary with its payslip and the bank's salary file, end-of-service saved up monthly, the shareholders and their percentages, profit available, a distribution split by percentage with a statement each, the adviser's yearly tax pack | medium |
| Fifteen | **Bank reconciliation.** Import the bank's statement and match it to the books | small |
| Sixteen | **Corporate clients and e-invoicing.** Companies as customers on payment terms, and electronic invoicing through an accredited provider before the July 2027 deadline | medium, early 2027 |

This file is piece eleven's plan. The specification it approves is
`docs/SPEC/accounting.md`. Pieces twelve to sixteen each get their own short
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

**Financial years, and a lock date.** The year ends on 31 December unless you
say otherwise. You close a year when it is complete; a closed year takes no
new entry, and anything that arrives late for it is written on the first
open day with a note of the day it really happened. Between year ends you
can lock the books through a date, which you will do after each quarterly
VAT return is filed so the figures behind it cannot move.

**Four statements**, worked out fresh every time from the journal and never
stored: the trial balance, the profit and loss, the balance sheet, and the
cash flow. Each downloads as a spreadsheet file. Alongside them, an overview:
the month's cash and earnings, the sessions still owed, the year's result so
far, what is in the bank, and the corporate-tax position.

**The corporate-tax position, the way it will really be.** Small Business
Relief now runs to the end of 2029: a company with revenue up to AED 3
million can elect it each year and pay no corporate tax, and a free-zone
company selling to individuals in the UAE can normally elect it. So the
overview shows the year's revenue against that 3 million, warns when it
nears, and shows a tax figure of zero while the relief holds. If revenue
passes the line, or you switch the relief off, the figure becomes the usual
9 percent above AED 375,000. It is always labelled an estimate; the adviser
confirms the election and files.

**Exports in Zoho's shape.** Two files in exactly the layout Zoho Books
imports, so if you ever hire an accountant who works in Zoho, or decide to
move, it is a file and not a project. Nothing is sent anywhere.

**The books name nobody.** No household, no invoice number, no payment
reference appears anywhere in them. So when a household is forgotten at its
request, the books do not change, and you and finance see the same figure to
the fils.

## What it deliberately leaves out

- **Spending, credit notes and the VAT form.** No expenses, purchases,
  suppliers or receipts yet; no tax credit note; the VAT return and its
  audit file wait for piece twelve. The starting list of accounts has a
  place for all of it.
- **Statements to households, ageing and margins.** Piece thirteen.
- **Salaries and profit shares.** Piece fourteen. Nothing about them is
  built or half-built here.
- **The bank statement.** No import and no matching until piece fifteen.
- **Companies as customers and e-invoicing.** Piece sixteen, in early 2027.
  Sales to families are exempt from e-invoicing until further notice; sales
  to companies must go through an accredited provider from 1 July 2027.
- **Filing anything.** The corporate-tax figure is an estimate, labelled as
  one on every screen. An accountant files; the platform never does.
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
   piece. Piece twelve lets an admin record expenses and nothing else. An
   accountant, when you hire one, is simply given the finance role.
6. **Small Business Relief is assumed elected**, with the 3 million watch,
   until your adviser says otherwise. Switching it off is one setting.
7. **No lock date until you set one.** Piece twelve will move it for you
   each time a VAT return is marked filed.

## What it costs

Under the cost rules of `docs/HANDOVER.md` section 6: one builder on Opus,
about 1.1 million tokens across two sessions; one combined review and one
re-check on Fable 5.1, about 0.4 million together; a fix round, about 0.3
million; a staging pass on Sonnet, about 0.3 million. Roughly 2.2 million
tokens in all, a little over piece eight. Nothing to buy and no vendor to
approve.

## What you have to do

Nothing before the build. When it is on staging, four things, each a few
minutes:

1. Say the day the books start (the day the company began trading, or the
   first of a month you choose).
2. Give the opening balances for that day: the bank balance, the share
   capital, and what the equipment cost.
3. Read the starting list of accounts and rename anything you would call by
   another name.
4. Ask your adviser, when you have one, to confirm the Small Business Relief
   election. Until then the switch stays on.

For piece fourteen, later: the bank and agent details the free zone's salary
file needs. Not now.

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
about the two new per-practice defaults (957 is round 34's); four
`accounting.*` actions and the Books rail entry; the route mount; the
activity-feed sentences; the `job:post-books` script; the ports row.

**Nothing in billing changes.** The poster reads billing's tables through a
definer function that names nobody (the pattern of migrations 952 and 953),
so the books are complete whoever runs it, and no billing route or screen is
touched. The one test that matters most: after one posting run on the seed,
the journal's "sessions owed" balance equals the figure the billing summary
already shows, to the fils.

**Where the comparison landed.** Building beats buying where the business is
unusual — programmes released per session, travel eating a home visit's
margin — and the later pieces copy the authority's own forms exactly where
the rules are generic: Form 201, the FTA Audit File, the WPS salary file.
The exports here copy Zoho's import templates for the same reason.

Everything else is checked as pieces one to ten were: one combined review and
one re-check, the record posted, the merge, a staging pass.

## What approving this means

Approving this file approves `docs/SPEC/accounting.md` as written and the
seven defaults above as Claude's standing until you overrule them. It
approves nothing of pieces twelve to sixteen beyond their order and their
one-line descriptions; each comes back to you with a plan of its own.
