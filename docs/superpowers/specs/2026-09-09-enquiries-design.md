# Enquiries: the practice system's first public write path

**Date:** 9 September 2026, 23:40. **Status:** design settled by the operator; building.

## Why

The public website's two enquiry forms post to `lodge_enquiry` on the retiring
Supabase project `gqvpapvdqcfjlifgwhpk`, and the practice system has nowhere to
receive them. Until it does, that project cannot be paused without silently
losing every enquiry. This round gives the practice system its own door and
retires the dependency.

## Decisions already taken

| Decision | Choice | By |
|---|---|---|
| What an enquiry becomes | A **lead** — a client with status `lead` | operator, 22:34 |
| Who sees enquiries | admin and lead practitioner (and the owner) | operator, 22:34 |
| How long they are kept | until actioned — converted or dismissed | operator, 22:34 |
| Where it lands | a **quarantine table**, never straight into `client` | Claude, agreed |
| The audit actor | **Option B**: outside the trail until a person touches it; *Convert to lead* is its first audited event | operator, 23:01 |
| Lawyers | none; the client's own approval is final | operator, 23:34 |

## The one design call this spec makes

**The public endpoint is the practice system's own API** —
`POST https://app.mcwellnessuae.com/api/enquiries` — not a Supabase edge
function. One codebase; the rules are pure TypeScript in `domain/enquiry` with
tests; the service key never leaves the server; reviewers can read it. The old
Deno function is the reference for what the forms send, not the template. It
follows the portal's invitation door exactly: mounted **ahead of the
authentication fence**, with its own rate-limit budget by address, opening its
own transaction and stamping only the request id.

## Shape

**`enquiry`** (migration 916, trunk core range). A row per lodging: `source`
(`website` | `discovery_call`), the person's name and WhatsApp number in E.164,
optional email, area, message, and the discovery-call form's `concern`,
`preferred_time`, `contact_method`; a three-valued `consent`; `ip_hash` for the
throttle; `status` `new` → `converted` | `dismissed`; `actioned_at`,
`actioned_by`, `client_id` (set on conversion), `dismiss_reason`.

**Lodging** is a `security definer` function, `app.lodge_enquiry(jsonb)`, the
only way a row gets in: it resolves the practice's one tenant, refuses more than
five lodgings from one address in ten minutes (answering exactly as it answers
success — a form that says "rate limited" tells a script what to change), and
inserts. `app_role` has no insert policy on the table.

**Actioning** is authenticated and audited. *Convert to lead* creates the client
(status `lead`) and its first contact from the enquiry, links `client_id`, and
scrubs the enquiry's personal fields. *Dismiss* takes a reason and scrubs the
same. Reading the list is a read of personal data by a person and is logged as
one. **What is scrubbed:** name, number, email, area, message, concern,
preferred time, contact method, ip hash. What stays: when, from which form,
what happened, who did it, which client.

**Option B, as columns.** The row carries no `created_by`: nobody made it. The
audit trigger is **not** attached, and `.claude/rules/data-model.md`'s
exemption list says so and why. The client row the conversion creates is
audited from its first byte, under the person who pressed the button.

**The screen.** `/admin/enquiries`: a table, newest unactioned first — received,
name, number, source, the first line of the message, status — with *Convert to
lead* and *Dismiss* on each `new` row, and a link to the client once converted.
English only, like the rest of the console. In the rail for owner, admin and
lead practitioner.

**The website.** Twenty-two pages carry the inline script; its `ENDPOINT`
becomes the practice system's door. The script already sends form-encoded by
`sendBeacon`, which is a simple request with no preflight; the door accepts
form-encoded and JSON, answers CORS for the apex and `www`, and 204s OPTIONS.

## Not in this round

Pausing the old project — reported as safe once the repoint is verified live,
and left to the operator. A retention job for unactioned enquiries: the rule is
"until actioned", by decision. *Amended 2026-09-10 (the operator's decision 3
of `docs/OPERATOR/2026-09-10-decisions.md`, trunk round 42): an enquiry still
new after thirty days is shown as waiting, with the days, beside the same
Dismiss; nothing dismisses it by itself (`domain/enquiry/waiting.ts`).* Erasure: a converted enquiry holds no personal
data, so erasing the client leaves nothing behind it.

## Risks stated

- First public write path. The fence, the budget, the honeypot and the definer
  function are the whole defence; the door validates and clamps every field and
  writes nothing on a bot's submission.
- Bots that pass the honeypot land as `new` rows for a person to dismiss. That
  is the quarantine doing its job.

## Amended 2026-09-16: the expo (trunk round 50)

**Why.** The practice takes a stand at the AccessAbilities Expo in October
2026. A code on the stand opens a short form on a visitor's own phone; what
they send is followed up after the expo. The owner asked for it on 15
September and decided the shape on 16 September: English only, one pull
request, and built on this design rather than beside it
(`docs/CHANGE-REQUESTS/trunk-round-50.md`).

**A third source, not a third table.** `enquiry.source` gains `expo`
(migration 919). Everything this design already settled holds unchanged: the
quarantine, the definer door, the honeypot, the clamps, the row policies, the
office screen, Option B, the scrub. Two typed columns join the row for the two
things only the expo form asks — `enquiring_for` (`self`, `child`,
`family_member`, `someone_else`) and `interest` (`brain_map`,
`neurofeedback`, `both`) — required on a new expo row by a constraint of the
table's own, never sent by the website's forms, and scrubbed with the rest
once actioned. The lead a conversion creates says `expo` as its referral
source, by the function that already copies the source across.

**A stand's budget.** The website's five lodgings per address in ten minutes
would refuse the sixth visitor on the venue's Wi-Fi. `app.lodge_enquiry`
gives the expo thirty; the website keeps five; the route's own ten-a-minute
per address stands, since a form takes longer than six seconds to fill in.
The source is a word the caller sends, so a script that says `expo` gets the
stand's budget from anywhere; what bounds it is a ceiling of the practice's
own, three hundred lodgings in an hour from every address together, refused
as silently as an exhausted address. Below that, the quarantine does its job.

**The page.** `/expo` on the app itself (`app/shell/pages/ExpoEnquiryPage.tsx`),
outside the sign-in fence like the invitation page, posting to the same door
as JSON with a plain `fetch` so a member of staff signed in on the stand's
tablet is never signed out by a refusal. Name, WhatsApp number, who it is for,
what they are interested in; optional email, area and message; the website
forms' own tick, which is not a consent; a line saying the details are used
only to reply and that an actioned enquiry keeps nothing personal, linking the
website's privacy policy. The door's refusal now names each missing field, so
the page marks it. The line under the tick says what happens to the details:
they are used to get back to the person; if they go on to work with the
practice they become part of their record; if not, the enquiry keeps nothing
personal once replied to.

**The office.** The enquiries screen filters by source with a count of each,
shows the two answers in the Details column, and offers "Download expo leads"
while any expo enquiry waits: `GET /api/enquiries/expo.csv`, oldest first, the
answers in words, every row logged as a read and the export logged once as
an `enquiry_export` under its request id, the number guarded as text so a
spreadsheet never evaluates it. The file is a copy the scrub and an erasure
never reach, so the screen says beside the button to keep it on the
practice's own device and delete it once the follow-up is done. The poster at `/admin/enquiries/poster` draws the code for this origin's
own `/expo` as one SVG path with the address in words beneath, prints without
a rail, and encodes nothing about anybody. The encoder is `qrcode-generator`,
a dependency with no dependencies of its own.

**Not in this round.** A "contacted" mark on a waiting row: the row policy
admits only the move to converted or dismissed, so it would be a policy
change, a route, an audit action and a page state, and the file is the
follow-up list until then. Arabic on the form, by the owner's decision.

## Amended 2026-09-19: three tables, one status at a time

The operator asked, with the expo a month away, for what is still waiting to
stay in the table and what was dismissed to move to a table of its own,
because at a stand's volume one table of everything is one nobody can work
from.

**Still one table in the database.** A dismissed row is the same row with its
status changed and its person scrubbed from it. Moving it to a table of its
own would cost the record its one history and buy the screen nothing a query
does not already give it.

**The list is asked for by status.** `GET /api/enquiries?status=new|converted|dismissed`,
with `source=` to narrow it and `before=` for the next page; nothing at all is
`status=new` from the top, which is what a screen built before this asks for.
A status, source or cursor the list does not have is a 400. The rules for
reading the address are `domain/enquiry/list.ts`, pure and tested.

- **A hundred to the page, newest first**, by `(received_at desc, id desc)`,
  which is the index migration 916 already cut on
  `(tenant_id, status, received_at desc)`. No migration.
- **The cursor is the row's moment to the microsecond, and its id.** The
  database keeps microseconds and a `Date` keeps milliseconds; a cursor cut at
  the millisecond steps over every row lodged later in that same millisecond.
  A test lodges 230 rows inside one and pages them; with a millisecond cursor
  it saw 132 on the run tried, and can never see more.
  The moment in a cursor must also be one the calendar has: `Date.parse` takes
  30 February for 2 March, the database refuses it, and that is a 400 here
  rather than a 500 there.
- **Every answer counts every status by every source**, in one grouped query,
  so the tabs and the source filter show the server's numbers and not the
  number of rows on the page. "Download expo leads" now appears whenever an
  expo enquiry waits anywhere, where it used to appear only if one was among
  the two hundred on the screen.
- **Before this, one query took two hundred rows of every status together.**
  New rows sorted first, so nothing waiting was lost until two hundred were;
  what was lost, silently, was every older actioned row beyond the cap.

**What is logged.** As before, a read is logged for each row still carrying a
person, which is each waiting row. A page of dismissed or converted rows
carries nobody and logs nothing, and because those tables are not fetched
until they are opened, opening the screen now reads fewer rows than it did.

**The screen.** Active, Converted and Dismissed, in the switcher Books and
Billing use, each with its count. The operator named two; the third is
because a converted enquiry is neither waiting nor dismissed, and left among
the active ones it is the same clutter. Active keeps its columns and its two
actions. The other two have no column for a name, a number or a message,
because no such row has one: they show when it came, from where, what
happened and when, who did it, and either the reason or the lead. Their dates
carry the year. Under a table longer than a page: how many of how many, and
"Show older", which sets the next page beneath the first. That line is a
status, so a screen reader is told when it changes, and it stays once the list
is whole; the button is never `disabled`, which would drop the focus it holds,
and when it leaves the screen the focus goes to the line.

## Amended 2026-09-19 (later): a dismissed enquiry may keep its person

**This reverses the scrub for one case**, by the operator's decision of 19
September 2026, and leaves it standing for every other. The plan, with what
was found before any code was written and the two questions put to the
operator, is `docs/superpowers/plans/2026-09-19-enquiries-keep-details.md`.

**The rule.** A person is kept only if they were told they would be. The
expo's form said until this date that an enquiry "keeps nothing personal" once
replied, and every row lodged under that sentence is still scrubbed on
dismissal. A row remembers which wording its person read (`notice_version`,
migration 921), a form that does not say is the first, and only the second —
"we keep them so we can follow up with you later. You can ask us to delete
them at any time." — lets a dismissal keep them. The table refuses anything
else, so this is the route and the screen agreeing with the database and not
standing in for it.

**Dismissing.** `POST /api/enquiries/:id/dismiss` takes `{ reason, erase? }`
and answers `{ ok, kept }`. Under the second wording the screen offers to keep,
which is the default, or to erase: spam, a wrong number, somebody who asked.
Under the first it offers nothing and says why. What a kept row loses either
way is its address hash, which was there for the door's budget.

**Erasing later.** `POST /api/enquiries/:id/erase`, the same three roles,
logged as `erase`. Once: a row with nobody on it, and any row not dismissed,
answers not found. This is how a request to be forgotten is met for somebody
who never became a client.

**News.** A second tick on the form, optional and never pre-ticked, asks
separately about news and offers, including through social platforms. Agreeing
to be rung back is not agreeing to be marketed to. `GET
/api/enquiries/marketing.csv` is the people who ticked, are still on a row, and
have not become a client; each row in it is a logged read and the file a
logged export. The app uploads nothing anywhere. A platform the file is given
to receives personal data, and `docs/COMPLIANCE/approved-vendors.md` lists
them, as **not approved**, from the day the file exists.

**What is logged.** A read of any row that names somebody. The round-53
sentence "a page of dismissed rows logs nothing" is now true only of rows with
nobody left on them.

**A lead's tick does not travel.** A converted row is scrubbed as before, and
the tick for news is not carried onto the client record: a client's consents
are the versioned documents, and a form's tick is not one. A known gap, the
operator's to ask for.

**The website is not changed by this.** Its forms carry the first tick and say
nothing of keeping details or of news, and its privacy page says enquiry
details are used to "Respond to your enquiries". So a website enquiry says
nothing of its wording, is taken for the first, and is scrubbed on dismissal,
which is the safe thing until the site's own words change.

