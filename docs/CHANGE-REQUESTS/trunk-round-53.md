## Round 53 — enquiries in three tables, one status at a time (2026-09-19)

The operator's ask of 19 September 2026: keep the enquiries that are active in
the table, move the dismissed ones to a table that holds only them, because
"with large volume of enquiry, this table will be messy". The expo is in
October.

### What was there

One list: every status together, `order by (status = 'new') desc,
received_at desc limit 200`, filtered by source in the browser, with the
source buttons counting whatever two hundred rows had arrived. A dismissed row
has been scrubbed of its person, so in that table it was a row of dashes with
a reason in a tooltip.

### What changed

| Path | What |
| --- | --- |
| `domain/enquiry/list.ts` (new), its test, the barrel | The list's rules, pure: the three statuses, a page of a hundred, how an address is read (`readEnquiryListQuery`), the cursor, and the tally that fills in noughts. |
| `app/api/enquiries/schema.ts` | The list's answer gains `counts` and `older`. `ENQUIRY_STATUSES` now comes from the domain and is re-exported, so nothing that imported it moved. |
| `app/api/enquiries/routes.ts` | `GET /api/enquiries` reads `status`, `source` and `before`; one status, a page and one row past it; one grouped count; a 400 for an address it does not understand. |
| `app/admin/enquiries/EnquiriesPage.tsx`, `enquiries.css`, its test | Three tabs with counts, the source filter asked of the server, a table per status with its own columns, "Showing n of m" and "Show older". |
| `tests/db/enquiries-routes.test.ts` | Four tests against a real database: lists of their own and true counts; no read logged for dismissed rows; the three 400s; 230 rows in one millisecond paged once and once only. |
| `docs/superpowers/specs/2026-09-09-enquiries-design.md` | Amended. |

**No migration, no policy file, no new route, no dependency.** The index the
query wants, `enquiry_tenant_status_received_idx`, has been there since
migration 916. `docs/SPEC/OWNERSHIP.md` is unchanged: every path is the
trunk's — the enquiry row, the trunk's own `tests/db/`, and its documents.

### Decisions a later reader might otherwise undo

1. **One table in the database, three on the screen.** The operator's words
   were "move them to a new table", and no table was made in the database.
   Nothing was moved and nothing was deleted: a dismissed enquiry is the same
   row it always was, shown under its own tab. Moving a dismissed row to a
   table of its own would cost the record its one history and buy the screen
   nothing a query does not already give it.
2. **A third tab nobody asked for.** Converted enquiries are neither active
   nor dismissed; among the active ones they are the same clutter the ask was
   about.
3. **The cursor is the database's own text to the microsecond**, made by
   `to_char(... 'US')` in the query and never from a `Date`. The paging test
   was run against a millisecond cursor before it was trusted, and saw 132 of
   230 on the run tried. It can never see more than 132 that way and may see
   fewer: a hundred on the first page, and then only those of the 32 rows at
   the millisecond's own start whose random ids happen to sort below the
   first page's last.
4. **An address with nothing in it is `status=new`.** A console open in a
   browser across the deploy asks the old way and gets the waiting rows, which
   is the list it was for; its parser ignores the two fields it does not know.

### Found by walking it, not by its tests

The screen was walked in a browser against a local database holding six
waiting rows and 135 dismissed, as the seeded owner.

- **Pressing the tab already open emptied the table for good.** Opening a
  table cleared the rows and relied on the status changing to fetch new ones;
  pressed on itself, nothing changed and nothing came back. Now a press on
  what is already open does nothing. A test holds it.
- **A late page could land under the wrong table.** "Show older" under
  Dismissed, then back to Active before the reply: thirty dismissed rows among
  the waiting ones. Reproduced in a test first (32 rows where 2 belong), then
  guarded by comparing the table the reply was asked from with the table on
  the screen. The guard's ref is written in an effect, never during render,
  which the repository's lint requires.
- The expo-file note sat flush against the tabs. The switcher now stands
  directly under the page's header and the notes beneath it, as Books has it.
- One alarm that was not a defect, recorded so nobody chases it again: "Show
  older" once appeared to *replace* the first page. It was a development hot
  reload remounting the screen mid-script; on a clean load the page is added
  beneath, 135 rows, all distinct, the first row kept.

### Checked, not claimed

`pnpm verify`: 254 files, 2,988 tests after the reviews' fixes; type check and
lint clean. The three enquiries suites against the pinned local database —
`enquiries-routes`, `enquiries-door` and `enquiries`, the last of which holds
that another practice counts and lists nothing — 39 tests. The walk above: dismissing moved a row and
both counts (Active 6 to 5, Dismissed 135 to 136), converting made lead
`MW-000021` and moved Active to 4 and Converted to 1, the Converted table's
link opens the lead, and the newest dismissal heads the Dismissed table with
its reason.

**Not checked:** a phone's width; the two new tables are five narrow columns
and the Active one is unchanged, so no new width was introduced. And no
screen reader was run. The keyboard's path through "Show older" is held by a
test that reads where the focus is; what a screen reader actually says of the
status line was not heard. Arabic is not in question: the console is English
only, and the new rule is written in logical properties regardless.

### Taken from the round's two reviews, before the merge

**Security** passed with one finding, low. **A cursor for a day that does not
exist was a server error.** `Date.parse` reads 30 February as 2 March and says
nothing; Postgres refuses it, and from the route that was a 500 for what is
only a bad address, in the error log the operator reads to diagnose an
outage. Both halves were checked against the local database and against Node
before the fix was written: three such dates, refused by one and accepted by
the other. `isOnTheCalendar` now sends the moment round a `Date` and back and
takes it only if it returns as itself. A database test holds the 400.

**Compliance** passed with ten notes, all taken.

- **"Show older" lost a keyboard's place.** It set `disabled` on the button
  holding the focus, and when the last page came the whole block left the
  screen: the focus fell to the top of the page and nothing told a screen
  reader that rows had been added. It is now `aria-disabled` with an early
  return; the line beneath a long table is a `role="status"` that stays to say
  "Showing all 135." once the list is whole; and the focus the button held is
  handed to that line. A test reads `document.activeElement`.
- An error about one table stayed on the screen over another. Opening a table
  now lets it go.
- Three statements in this note and one in the code were not true as written,
  and are corrected above and there: the enquiry row is **not** under the audit
  trigger (its reads and actions are logged by the route, by the decision
  recorded in `.claude/rules/data-model.md`); not every path is in the enquiry
  row of the ownership table; and "132 of 230" was one run's figure, not a
  constant.
- The test that a page of dismissed rows logs no read now first proves that a
  page of waiting rows logs one, by the same name, so it cannot pass by reading
  the wrong log.
- A test id was outside the reserved form, and two test names and a comment
  still said "new first" or promised a link the test now asserts is absent.

### Synthetic data used throughout

Names from `db/seed/names.ts`; numbers in `+971 50 000 00xx`; addresses at
`example.com`; ids in the reserved ranges.
