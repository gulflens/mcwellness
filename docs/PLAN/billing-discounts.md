# McWellness billing round: discounts

Written 7 September 2026 by Claude for the operator, on the operator's request
of 21:49 the same evening: "for my books, i need to be able to apply discount
in any transaction i am doing, so add a discount field to the transactions,
packages and individual prices". Built the same night under the defaults below,
which are Claude's and stand until the operator overrules any of them. Nothing
reaches the live site until the operator says so.

## What changes, in plain language

A discount means the same thing everywhere: money off the list figure, shown
on the invoice. It can be typed as a percentage or as an amount in dirhams, and
whoever gives one beyond the price list says why.

**Individual prices.** A service price now has a list price and a discount.
"Neurofeedback session: list AED 700, launch discount 15%, price AED 595."
Every price already on the list becomes "list equals price, no discount" by
itself; nothing a family was shown changes. The Add price drawer gains a
discount box.

**Packages.** A package price has the same. "Gold: list AED 19,975, discount
15%, price now AED 16,977.50." The three launch prices loaded on 7 September
become "list minus discount" by themselves, which is what their reasons already
say in words. The Add package drawer lets you type either the discount or the
price now and works out the other.

**Transactions.** The Sell drawer shows the list price, the price list's own
discount, and an **extra discount** for this one sale, as a percentage or an
amount, with a reason. Only the owner, an admin or finance may give one: the
same three roles that may forgive a call-out fee. A sale can never charge more
than the price list says, and never less than nothing. The invoice carries one
combined discount.

**Visits charged by themselves.** A session that closes with no credit left is
charged at the price list's own discounted price; nobody is there to give an
extra discount. A call-out fee has no discount; forgiving it is the existing
waiver.

**The invoice and the PDF** print the unit price, a discount line beneath the
service, and "Before discount" and "Discount" in the totals whenever a discount
was given, in both languages, which is what the tax authority's own invoice
rules ask for.

**The books do not change.** Income is recorded net of the discount, which is
the ordinary treatment. A figure for "discounts given against list price" is
already in piece thirteen's list and will read what this round records.

## The defaults, each Claude's until overruled

1. A discount is money off the **list** figure, never a mark-up: the list price
   is the ceiling and nothing is sold above it.
2. The price list's discount and a sale's extra discount **add up** into one
   discount on the invoice; the extra one is the only one that needs a reason
   at the sale, because the list's own reason was given when the price was set.
3. An extra discount at a sale is the **owner's, an admin's or finance's**.
4. **No contra-revenue account.** Income is net of discounts; the report of
   discounts given stays in piece thirteen.
5. Percentages round **half up to the fils**, the same rule VAT uses.

## What it costs

One migration (409, billing's own range), one new rule file in
`domain/billing`, the three catalogue and sale routes, the invoice renderer,
four drawers and two tables, and the seed's catalogue. About one builder run,
one combined review, one fix round and one re-check, then the staging pass.
