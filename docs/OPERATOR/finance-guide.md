# The books, for the person keeping them

For whoever holds the **Finance** role: a bookkeeper, an accountant, or the
owner on a Sunday evening. It says where things are, what to do each month,
and what the system does not do yet so it is done elsewhere.

## What Finance can and cannot do

| You can | You cannot |
|---|---|
| Read every statement and export it as CSV | Close or reopen a financial year (owner) |
| Post a journal entry, and reverse one | Set the lock date (owner) |
| Add, rename or archive an account | Change the year end or books settings (owner) |
| Record a payment; sell a package; waive a call-out fee | Read the audit log (owner, admin, lead practitioner) |
| See a client's name, contacts, balance and session credits | See a client's goals, session notes, reports or measurements |

Every change asks for a reason of at least eight characters. Write it for the
auditor who reads it in three years.

## Where things are

- **Billing › Invoices / Receipts**: every invoice (INV-) and payment
  receipt (RCP-), searchable and paged, each with its PDF.
- **Billing › Balances**: one client's balance at a time.
- **Books › Overview**: cash position, money owed to the practice, the
  year's result, and the corporate-tax estimate.
- **Books › Journal**: every entry (JE-), newest first. Open one to see its
  lines.
- **Books › Accounts**: the chart. Open an account for its ledger over a
  period.
- **Books › Statements**: trial balance, profit and loss, balance sheet and
  cash flow. They open on the financial year to date. The Zoho Books files
  are here too.

## How the books fill themselves

You do not post sales or payments. The system does, from billing:

- **Session or package invoice issued:** money owed by the client, against
  *sessions owed* (account 2400) and VAT. A package is income only as it is
  used.
- **Call-out fee invoiced:** money owed, against call-out fee income (4300)
  and VAT. A waived fee reverses it.
- **Payment recorded:** Bank, Cash box or Payment link clearing, against
  money owed.
- **Session used:** sessions owed released to income.

Posting runs every night at 03:00 Dubai time, whenever someone opens Books,
and from **Bring the books up to date** on the Overview, so every figure in
Books is current when you read it.

## Correcting a mistake

Nothing posted is ever edited or deleted.

- **A wrong manual entry:** open it in the Journal and **Reverse** it, then
  post the right one. The reversal is dated today.
- **A wrong payment or invoice:** there are no credit notes yet. Tell the
  owner. Do not try to cancel it with a manual entry against Receivable; the
  client's balance in billing would not follow.
- **A period that is locked:** a late payment or invoice lands on the first
  open day, and its memo says the real date. Ask the owner if a locked
  period must be reopened.

## Month end

1. Open **Books** so everything outstanding is posted.
2. **Bank:** compare the closing balance of account 1010 (Accounts › Bank,
   operating) with the bank statement. Post bank fees to 6200 and any
   unrecorded receipt as a payment in Billing, not as a journal.
3. **Payment link:** compare account 1030 with the provider's payouts. Post
   each payout as Bank against 1030, and its fee as 6200 against 1030.
4. **Cash box:** count it; compare with account 1020. Post a deposit as
   Bank against Cash box.
5. **Spending:** post each bill or expense as a manual entry to the right
   expense account, against Bank or Cash box. Keep the receipt outside the
   system and put its reference in the memo.
6. Read the **trial balance** as at the month's last day, then the
   **profit and loss** for the month. Download both.
7. Ask the owner to **lock through** the month's last day.

## Done outside the system for now

Bank reconciliation and statement import, suppliers and bills, VAT on
purchases and the VAT return, credit notes, refunds paid out, aged
receivables and client statements, payroll and WPS, fixed assets and
depreciation. These are planned for later. The Zoho Books exports are there for when the practice moves its books.
