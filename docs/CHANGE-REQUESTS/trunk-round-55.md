## Round 55 — the clients list: an emirate filter, and a rule between every column (2026-09-20)

The operator, 20 September 2026, 06:54 +04, looking at the live clients list:
"i also need to be able to filter by Emirate like the status filter, and i need
the table borders for all the columns not only for the Record".

### The emirate filter

`docs/SPEC/client-record.md` section 4.1 has said "Filter by status, emirate,
practitioner" since the list was specified. Status was built; this is the
second of the three. The practitioner filter is not part of this round.

**Which emirate.** A client may have several addresses. The list's Emirate
column shows the primary one (`client.primary_location_id`), so the filter reads
the same one: the filter and the column can never disagree about a row. A
client with a second home in Sharjah and a primary one in Dubai is a Dubai
client here. A client with no address yet is in no emirate, and appears only
under "Any emirate".

**The route.** `GET /api/clients` takes `emirate`, one of the seven codes in
`domain/client/types.ts` (`EMIRATES`), validated by the same schema that
validates `status`. Anything else is refused with 400 rather than ignored: a
misspelt emirate must never quietly list the whole practice as if no filter had
been asked for. It narrows together with `status` and `q`, not instead of them.
The page size, the truncation flag, the erased-records rule and the one audit
row per listed client are untouched. An emirate code in a query string is a
filter value and names nobody.

**Not applied to an identity-card lookup**, for the reason the status filter
is not: an identity number names at most one client, and filtering it away
would answer "no such client" to someone holding that person's card.

**The screen.** A second select beside Status, "Any emirate" and the seven in
the order the practice lists them. Changing it reloads the table the way
Status does.

### A rule between every column

The pinned first column has always had a hairline on its end edge, drawn as an
inset shadow because the table's borders are collapsed and a collapsed border
does not travel with a cell that sticks. That line is now every column's but
the last, by the same technique, so every line is the same weight
(`docs/DESIGN-BRIEF.md`: "use hairline rules at `--rule`"). The last column has
no neighbour and takes none; the table has no outer frame and keeps none.
`box-shadow` has no logical form, so right-to-left is mirrored with `:dir(rtl)`.

It is the shared `.ledger` rule, not the clients list's own: every table in the
console gains the lines, including the two written by hand
(`app/admin/clients/DocumentsTab.tsx`, `app/admin/reports/ReportsTab.tsx`). One
table ruled differently from the rest would be the odd one.

### Checked

- `tests/client/db/list_emirate.test.ts`, written first and seen to fail: by
  primary address only, the addressless client in no emirate, together with
  status and search, 400 for anything that is not one of the seven.
- `app/admin/clients/ClientsPage.test.tsx`: the select's options, the request
  it makes alone and with a status, and the lookup left unnarrowed.
- `tests/lint/layout-tokens.test.ts` pins the rule and its mirror, since jsdom
  computes no layout.
- Walked signed in on a laptop against the seeded practice: 20 clients, 3 in
  Abu Dhabi, 1 of them active, 2 in Fujairah, 20 again; the count in the
  heading follows; the three fitted columns of round 54's follow-up still hold
  no spare pixel with the rules drawn.
