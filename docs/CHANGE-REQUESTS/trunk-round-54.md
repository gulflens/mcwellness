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
| 2 | "…and we keep your contact details so we can follow up with you later. … You can ask us to delete them at any time…" | Contact details kept, what they wrote dropped, unless whoever dismisses chooses to erase everything. |

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
   and again in the door. An old form open in a browser and the website are
   therefore scrubbed on dismissal. **A script is not**: the door is public and
   a script can say 2 as easily as the form does. See "A limit that is not
   closed" below.
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

`pnpm verify`: 255 files, 3,005 tests after the reviews' fixes; type check and
lint clean. **The whole database suite**, `pnpm test:db`, against the pinned
local database, run again after the migration changed: 106 files, 1,500 tests;
and after the schema re-check added one more test, the four suites that touch
the table again, 64 tests. That last test was run against the trigger with its
two lines taken out before it was trusted, and failed.
The screen's own tests were run five times over after one of them was found to
race the counts on a loaded machine. Walked again after the three decisions:
no news list while people only wait; a website row says "was not told their
details would be kept"; two dismissals under the second wording kept name,
number, email, area and who they asked for, and the database shows `message`
null and the address hash null on both; "my son is not sleeping well", which
one of them wrote, is nowhere on the screen or the row; the news list counts
the one who ticked; the audit chain intact.

**One unrelated flake seen and not caused here:** `app/admin/settings/PracticeLogo.test.tsx`
failed once in a full run on a machine also running a database and
containers, and passed alone and in every run since.

**Not checked:** no screen reader was run; the website, which this round does
not touch; and a hosted database, which is the staging pass's to prove.

### The gate on going live: the privacy page says the opposite

**An earlier draft of this note misquoted the practice's privacy page, and the
operator was told the same.** It said the page says enquiry details are used
to "Respond to your enquiries" and that the site uses no advertising cookies,
"and says nothing of keeping details or of news". The page had been searched
for one word. Read whole, as the compliance review of this round read it and as
was then checked against the live page (`https://mcwellnessuae.com/privacy.html`,
last updated 9 September 2026), it says:

> We never sell your personal information. **We never use it for advertising.**
> We never use it for research. We never use it for anything unrelated to your
> sessions and your account with us. If that ever changes we will ask you
> first, separately, and you may say no.

> We will not share your personal information without your consent, except
> where required by law.

> We keep personal information only for as long as necessary for the purposes
> described in this policy, or as required by law.

Showing somebody the practice's offers through a social platform is
advertising. The expo form in this round links that page as where "how we look
after your information is set out", so this is the app's problem and not only
the website's.

**So the new wording must not reach the public until the page matches it.**
The privacy page first, then the app's build. The page's own "we will ask you
first, separately, and you may say no" is what the optional tick is; what it
needs is to say so:

- enquiry details are kept until the person asks, and looked at again after
  two years;
- news and offers go only to people who asked for them;
- for those people, a number or an email may be shared with named social
  platforms so that they see the news there;
- how to stop it, and how to be deleted;
- and "We never use it for advertising" gains its exception: except where you
  have asked us for our news.

The migration and the console are harmless while no row under the second
wording exists, and could ship alone. This round ships as one build, so the
whole build waits for the page. Merging does not.

### Three more decisions, the operator's, 19 September 2026 about 04:00 +04

Put after the compliance review, because the second wording has never been
live and changing it now costs nothing; afterwards it would need a new number,
and everybody who ticked under the old one could not be uploaded.

1. **The tick says plainly that details are shared:** "Keep me posted about
   McWellness news and offers. You may share my number or email with social
   media platforms, such as Instagram or TikTok, so I see them there."
   "Including on social media" reads as "I may see your posts".
2. **A kept person is how to reach them, not what they wrote.** `message` and
   `concern` are dropped at dismissal: free text is where somebody writes "my
   son can't sleep". Name, number, email, area, who they asked for, what they
   were interested in, and how and when they prefer to be reached, stay. The
   constraint requires it, the trigger allows exactly that and nothing else,
   and the form says "we keep your contact details".
3. **Until they ask, with a question after two years.** Nothing deletes on a
   timer, as everywhere on this platform. A kept row whose form arrived two
   years ago or more shows "Kept 2 years: still needed?", in the manner of
   "Waiting 30 days". It asks; it erases nothing. **Recorded here as the
   operator's accepted position on retention for a dismissed enquirer**, who
   is not a client and whom CLAUDE.md rule 8 does not therefore cover.

### A limit that is not closed

**The tick is whatever the form sent, and the form is public.** Anybody can
post it with somebody else's number and the box ticked (the security review).
The budget still holds them to five or thirty lodgings in ten minutes from one
address and three hundred an hour from all. Before this round the worst of a
false enquiry was one call back and a scrub. Now it is a person in a list that
says they asked for news, who did not.

What was done: **the news list holds only dismissed rows**, so every person in
it has been handled by somebody who could have erased them, and nobody still
waiting is in it; the screen says the tick is unconfirmed and what to do when
somebody says they never asked; and the vendor register asks for a message
confirming the wish before any platform is approved for the list. What was not
done, and would close it: a confirming message to the number before the tick
counts. The operator's to ask for.

**Who may download it:** `enquiry.list` is the owner, an admin and the lead
practitioner, as for the expo file. One person holds every role today. When a
second lead practitioner exists, an owner-and-admin-only permission for the
two files is worth the operator's thought.

**Stopping the news is erasing.** The trigger forbids un-ticking, so the way
to record "stop" is "Erase details". And erasing here does not reach a file
already downloaded or an audience already uploaded: the screen says so when a
person who asked for news is erased, and whoever handles a request to be
forgotten has to chase those copies.

**The file is cut at five thousand rows**, oldest first, while the button
counts them all. Years away, and said in the route.

### Taken from the round's three reviews, before the merge

**Schema and security found the same hole independently**: the rule that a
person's details are never edited sat under "once dismissed", so the statement
that *does* the dismissing could slip a tick in, or swap a name, and pass every
constraint. No route does; the table is meant to hold the rule, not the route.
The rule now holds at every status. Also from the schema review: **a converted
row had no guard at all** against the table's owner, where until this
migration a constraint had made a person on any actioned row impossible for
everybody, so the guard covers every actioned row; the trigger is `enable
always`, or a session replaying changes would skip it; where a row came from
and when are pinned; a `Needs:` header, the revoke the repository's guards
carry, two column comments that had become untrue, and a rollback that puts
the door back first and says the scrub cannot be undone.

**Compliance**: the privacy page, above; that `isMarketable` was called by
nothing, so the rule deciding who leaves the system lived only in a line of
SQL, and the file is now built from the rows the domain's own rule lets
through, with a test holding the button's count to the file's length; that
"this person was told the enquiry keeps nothing personal" is untrue of a
website enquiry, which was told nothing either way, so the screen now says
"was not told their details would be kept"; that a cancel button reading
"Keep" under "Keep their contact details" was a trap; that a kept row which
never asked for news should say so; and that the recorded reason the table is
outside the audit trigger described a quarantine it no longer only is. The
exemption stands, for a stronger reason than before: the trigger would copy a
kept person into an append-only log that "Erase details" cannot reach.

### What a hand-applied pass must leave on a hosted database

From the schema re-check of this round, for `docs/STAGING.md` and
`docs/PRODUCTION.md` to be held to. **Databases before code**: the new routes
select `notice_version`, and the old code is safe on the new schema, because
old forms lodge as the first wording and the old scrub still satisfies the new
constraint.

- **Ledger**: one new row, `921_enquiry_kept_details.sql`, 106 to 107, with the
  file's sha256 **taken from `main` after the merge** and not from any earlier
  commit of this branch: the file was edited in place three times before it
  merged. A local database that ran an earlier text refuses on the checksum:
  `pnpm db:reset` there. No hosted database has it.
- **Columns** on `enquiry`, 23 to 25: `notice_version smallint not null default 1`;
  `marketing_opt_in boolean`.
- **Check constraints**, 13 to 15: added `enquiry_notice_version_known`,
  `enquiry_marketing_asked_only_under_second_notice` and
  `enquiry_actioned_keeps_only_what_was_promised`; dropped
  `enquiry_actioned_is_scrubbed`.
- **Functions**: created `app.enquiry_guard_actioned()` (returns trigger, not a
  definer, `search_path = pg_catalog, pg_temp`, execute revoked from public);
  replaced `app.lodge_enquiry(jsonb)` (still a definer, same search path,
  execute revoked from public and granted to `app_role`).
- **Trigger**: `enquiry_guard_actioned`, before update, for each row, enabled
  **always** — `tgenabled = 'A'`, which a plain `create trigger` does not give
  and a fingerprint of trigger *names* does not see. Read `tgenabled`.
- **Comments**, five: the table's; `enquiring_for` and `interest` re-issued;
  `notice_version` and `marketing_opt_in` new.
- **Policy**, re-applied by hand after 921, because policies are not
  migrations: `db/policies/enquiry/writers.sql`. `enquiry_actioners` gets a new
  `using`; the count of policies does not change, so a count will not show
  whether it was done. **Until it is, "Erase details" answers not found on that
  database.** Read the policy's `using` text.
- **Unchanged**: no index, no table grant, no change to row security itself.

### Not in this round

**The website.** A separate codebase, not under version control, deployed
separately. Its forms carry the first tick on eleven pages, their Arabic
mirror and `content/site-content.json`. Until its forms say `notice: 2`, a
website enquiry is taken for the first wording and scrubbed on dismissal.
**Its privacy page gates this round's going live**, as above. Carrying a
lead's news tick onto the client record. A message confirming a tick. A
WhatsApp broadcast of news from the practice's own phone, which the vendor
register's WhatsApp row does not cover: it is scoped to invoices and receipts.

### Synthetic data used throughout

Names from `db/seed/names.ts`; numbers in `+971 50 000 00xx`; addresses at
`example.com` and, for the door's callers, the documentation range
`203.0.113.0/24`; ids in the reserved ranges.
