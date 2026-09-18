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
migration 916. `docs/SPEC/OWNERSHIP.md` is unchanged: every path is in the
enquiry row.

### Decisions a later reader might otherwise undo

1. **One table in the database, three on the screen.** See the top of
   `domain/enquiry/list.ts`.
2. **A third tab nobody asked for.** Converted enquiries are neither active
   nor dismissed; among the active ones they are the same clutter the ask was
   about.
3. **The cursor is the database's own text to the microsecond**, made by
   `to_char(... 'US')` in the query and never from a `Date`. The paging test
   was run against a millisecond cursor before it was trusted: 132 of 230.
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

`pnpm verify`: 254 files, 2,987 tests; type check and lint clean.
`tests/db/enquiries-routes.test.ts` and `enquiries-door.test.ts` against the
pinned local database: 24 tests. The walk above: dismissing moved a row and
both counts (Active 6 to 5, Dismissed 135 to 136), converting made lead
`MW-000021` and moved Active to 4 and Converted to 1, the Converted table's
link opens the lead, and the newest dismissal heads the Dismissed table with
its reason.

**Not checked:** a phone's width. The two new tables are five narrow columns
and the Active one is unchanged, so no new width was introduced.

### Synthetic data used throughout

Names from `db/seed/names.ts`; numbers in `+971 50 000 00xx`; addresses at
`example.com`; ids in the reserved ranges.
