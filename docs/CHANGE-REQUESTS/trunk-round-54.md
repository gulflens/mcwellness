## Round 54 — a dismissed enquiry may keep its person (2026-09-19)

The operator, 19 September 2026, 03:11 +04, an hour after round 53 gave
dismissed enquiries a table of their own: "dismissed enquiries need to keep the
data visible, i need to be able to have those details, may be i will revisit
those enquiries contacts or retarget them in my social media campains".

### Why it was not simply switched on

Three things were found before any code was written, and put to the operator.

1. **The expo's form promised the opposite, in writing**, under its tick: "if
   not, once we have replied the enquiry keeps nothing personal". Every
   enquiry lodged to date was lodged under that sentence.
2. **Retargeting is a purpose nobody was told of and a vendor nobody
   approved.** It hands numbers and addresses to a social platform. The tick
   agreed to contact "about your enquiry". The register listed no such
   platform.
3. **The database enforced the scrub**: a check constraint on every actioned
   row, and an update policy that admitted no change to a row already
   actioned.

Two questions were asked, with the draft wording shown. Both answers are the
operator's: **change the wording and add an optional tick for news**; and
**keep by default, erase on choice**.

### The rule everything else hangs from

**A person is kept only if they were told they would be.** A row remembers
which wording its person read. A form that does not say showed the first.

| Wording | What the person read | On dismissal |
| --- | --- | --- |
| 1 | "…once we have replied the enquiry keeps nothing personal." | Scrubbed, always. The screen offers no choice and says why. |
| 2 | "…and we keep them so we can follow up with you later. You can ask us to delete them at any time." | Kept, unless whoever dismisses chooses to erase. |

What follows from it, told to the operator and not open to choice: what was
already dismissed is already scrubbed and cannot be recovered; and a row
lodged under the first wording is scrubbed on dismissal whatever anybody would
now prefer.

### What changed

| Path | What |
| --- | --- |
| `db/migrations/921_enquiry_kept_details.sql` | `notice_version`, `marketing_opt_in`; the scrub constraint replaced by "keeps only what was promised"; a trigger for what a policy cannot see; the door recreated. With its rollback. |
| `db/policies/enquiry/writers.sql` | The update policy admits one more change: erasing a dismissed row that still names somebody. |
| `domain/enquiry/keep.ts` (new), `parse.ts`, the barrel, their tests | `noticeOf`, `dismissalKeeps`, `carriesAPerson`, `isMarketable`; the parser reads `notice` and `marketing`. |
| `app/api/enquiries/{schema,door,routes}.ts` | The wire gains the two fields and `marketable`; dismiss takes `erase` and answers `kept`; `POST …/:id/erase`; `GET …/marketing.csv`; the list logs every row that names somebody. |
| `app/admin/enquiries/EnquiriesPage.tsx`, its styles and test | Keep or erase at dismissal, or why there is no choice; the kept person shown; "Details erased"; "Erase details", asked about once; "Download news list". |
| `app/shell/pages/ExpoEnquiryPage.tsx` and its test | The new paragraph, the optional tick, `notice: 2`. |
| `tests/db/enquiries{,-routes,-door}.test.ts` | The table, the routes and the door against a real database. |
| `docs/SPEC/00-data-model.md`, `docs/COMPLIANCE/approved-vendors.md`, the spec, the plan | Amended. |

**One migration, 921, and one policy file.** No new dependency. No new
permission: erasing is `enquiry.action`, the same three roles that dismiss.

### Decisions a later reader might otherwise undo

1. **The wording has a number, and the form sends it.** Whoever changes the
   paragraph under the expo form's tick gives it a new number. Sending 2
   beside different words tells the database a person was told something they
   were not.
2. **The default is the promise.** Anything but a plain 2 is 1, in the domain
   and again in the door. An old form open in a browser, the website, a script:
   all are scrubbed on dismissal.
3. **The guards are a trigger, not a policy**, because a policy's `with check`
   sees only the new row. They hold for the table's owner too. A dismissed row
   changes in one way only: its person erased, whole.
4. **The address hash never survives an action.** It was there for the door's
   budget and has no follow-up purpose.
5. **A tick under the first wording is nobody's answer.** The first wording
   never asked, so the column is null there whatever arrived, and the table
   refuses otherwise.
6. **The register says no from the day the file exists.** "Download news list"
   makes a file; uploading it is a person's own act. No platform is approved,
   and the screen says a platform must be on the approved list first.
7. **A lead's tick does not travel** to the client record. A known gap.

### Found by walking it, not by its tests

Walked in a browser against a local database, as the seeded owner, with two
people lodged under the first wording and three under the second.

- **"Erase details" did nothing, and every test was green.** The screen sent a
  bare `POST` with no body; the API refuses any `POST` that does not say it is
  JSON with a 415 before a route sees it (`jsonOnly`), so the person stayed on
  the row and the screen would have said "That could not be done". It was seen
  only because the database was read after the press: no `erase` row in the
  log, and the name still there. The route's own test had posted JSON, and the
  screen's mock took anything. The press now follows the pattern every other
  `POST` on the screen uses, and **the mock refuses a `POST` that is not JSON,
  as the API does**, so the screen's tests can no longer pass on a request the
  server would refuse. It failed first.
- The expo form at a phone's width: both ticks unticked, the second not
  required, the new paragraph in place, "Send" held until the first is ticked.
- Under the first wording the dismiss form shows no choice and the sentence
  saying why; under the second, two choices with keep selected.
- Three dismissals, one of each kind, said three different things and moved
  the counts (Active 5 to 2, Dismissed 0 to 3). The news list stayed at 2 while
  a person who ticked was dismissed and kept, and went to 1 when they were
  erased.
- Read back from the database afterwards: the kept person still named, with no
  address hash; both erased rows empty, their reasons kept; three `dismiss`
  rows in the log marked kept yes, no, no; one `erase`; six logged reads of the
  dismissed row while it named somebody; the chain intact.

**Seen and left:** the Dismissed table is ten columns, and at 1440 pixels its
last four — when it was dismissed, by whom, why, and "Erase details" — are
reached by scrolling sideways, as the Active table's last two already were.

### Checked, not claimed

`pnpm verify`: 255 files, 3,001 tests; type check and lint clean. **The whole
database suite**, `pnpm test:db`, against the pinned local database: 106 files,
1,496 tests, so the migration disturbs nothing beyond the enquiries. The walk
above.

**Not checked:** no screen reader was run; the website, which this round does
not touch; and a hosted database, which is the staging pass's to prove.

### Not in this round

**The website.** A separate codebase, not under version control, deployed
separately. Its forms carry the first tick on eleven pages, their Arabic
mirror and `content/site-content.json`, and say nothing of keeping details or
of news; its privacy page says enquiry details are used to "Respond to your
enquiries" and that the site uses no advertising cookies. Until its words
change and its forms send `notice: 2`, a website enquiry is taken for the
first wording and scrubbed on dismissal. **The privacy page should change
before any news list is used**, because it is where a person is told that news
may reach them through a social platform.

### Synthetic data used throughout

Names from `db/seed/names.ts`; numbers in `+971 50 000 00xx`; addresses at
`example.com` and, for the door's callers, the documentation range
`203.0.113.0/24`; ids in the reserved ranges.
