# McWellness Pieces Seventeen and Eighteen: the day map and the week planner

Written 7 September 2026 by Claude for the operator. **Not yet approved.**

On 7 September at 22:18 the operator asked for route planning and stop
optimisation on the map, reusing the Google Maps key from the Flutter app,
which is being dismissed. Four decisions were taken at 22:40 that give this
plan its shape:

1. The map and the optimised order live in the coordinator's console. The
   practitioner's Today screen keeps the small picture it has, which works in
   a lift with no signal.
2. "Optimise the day" may re-time the visits nobody has been told about yet,
   and keeps the visits already agreed with households exactly where they are.
3. The Flutter app's Google key becomes the browser's map key. The key the
   live system already uses for drive estimates stays on the server.
4. The scope reaches to a week planner: which day suits a client's area best.

That is two pieces, each useful on its own:

| Piece | What it is | Size |
| --- | --- | --- |
| Seventeen | **The day map and the optimised day.** A full-screen map of one day in the console: numbered stops, the drive between them in minutes, and a button that finds the order with the least driving and applies it | medium, about one session |
| Eighteen | **The week planner.** Pick a client and a service; see, for each of the next fourteen days, where a visit would add the least driving, and book it from there. The same suggestion appears in the booking form | medium-small |

Pieces twelve to sixteen are the books' and keep their numbers. These two can
build before them if the operator says so; nothing in either depends on the
books.

This file is the plan for both pieces. The specification it approves is
`docs/SPEC/route-planning.md`, which has a part for each piece. Piece
eighteen builds only after piece seventeen is on staging.

## What exists today

Three things are already there, which is why this is smaller than it sounds:

- **Drive estimates are live.** Since 7 September the live system asks Google
  how long each drive between Shauna's stops takes, with traffic, and keeps
  the answer for thirty days per pair of places per hour of the day. Today on
  her phone already says "about 25 min, 18 km, estimate from traffic" between
  stops, above a small picture of the day.
- **The day map was always planned.** The scheduling specification names it
  (section 4.2): a full-screen map for one day, pins numbered in time order,
  lines between them with the drive minutes, click a pin to open the visit.
  The design brief calls it "the one full-bleed screen". It was cut from the
  first build and marked later work.
- **What Google receives never changes.** Coordinates and a departure time
  cross to Google for an estimate; never a name, a record number, an address
  or an identity. That stays true here.

What does not exist: any way to put the stops in a better order, any way to
see a whole day on a map in the console, and any map in the browser at all.

## What piece seventeen is

**The day map.** From the Schedule page, one press opens the day as a map
that fills the screen. Each stop is a numbered pin in time order; a line joins
each stop to the next with the drive written beside it, "about 25 min"; the
practitioner's home base, when the practice has recorded one, is the first
pin. Down the side sits the day's list, the same rows the Schedule table
shows: window, who, service, where, and where the visit stands. Click a pin
and its row is picked out; click a row and the map centres on it. The row
offers the same three actions the table offers: confirm, move, call off.

**Optimise the day.** One button. It works out, from the drive estimates, the
order of the day's visits that takes the least driving, and shows the result
before anything changes: the driving now and after, in minutes and
kilometres; when the day would end; the new order with each visit's old
window beside its new one; and which visits stay put because a household
has already been told. The word "estimate" and where the figures came from
("from traffic" or "straight-line") are always on the screen.

The rules it keeps:

- A visit the household has agreed to is never moved. Only visits still
  marked "proposed" move, and only those still ahead of now.
- The day never starts earlier than it does now and never ends later.
- Every new window starts on the quarter hour and keeps the 45-minute
  promise the practice makes.
- The drive home counts, when a home base is recorded, so the day does not
  "save" driving by leaving the furthest household for last.
- Every visit it moves goes through the same move rule the Move drawer uses:
  the old row is kept and marked rescheduled, a new row stands in its place,
  the double-booking checks run, and the reason is on the trail. The drawer
  says plainly that the households have not been told.
- If nothing can be improved, it says so and changes nothing.
- It never books, cancels or reassigns anything.

**The map in the browser, and the key.** The map itself is Google's, drawn
in the coordinator's browser, so the page must be allowed to load Google's
script. That is a deliberate widening of the console's security policy and it
is confined to the day map's own page: every other screen, and the whole of
the practitioner's phone app, keeps the strict policy it has. What Google's
map receives from the browser is what any map page sends: the browser's
address on the internet, which part of the world is being looked at, and the
key. The pins and lines are drawn by the app itself; no coordinate of a
household is sent to Google by the map. The register of approved vendors
gains that sentence.

The Flutter app's key becomes the browser key: it is restricted to the map
product only and to the practice's own address, so it is of no use to anyone
who reads it off the page. The moment that change is made, the old Flutter
app's builds stop showing maps. The server key the live system already holds
loses the one product it never needed. Nothing new is minted and nothing new
is enabled: the map product has been enabled on the practice's Google project
since August.

## What piece eighteen is

**The week planner.** Pick a client, the service, which of their addresses,
and who delivers it. The planner shows the next fourteen days as rows: what is
already booked that day, the arrival window where this visit would add the
least driving, how many minutes it adds, and a "Book" button that opens the
booking form already filled in. A day with nothing booked says so and gives
the drive from the home base. A day that cannot fit the visit says why.

**The same answer inside the booking form.** Once the coordinator has chosen
the client, the service, the address, the practitioner and the day, the form
offers one line: "Least driving on Tue 9 Sep: 14:00 to 14:45, adds about 12
min", with a button to take it. It never chooses for her.

## What it deliberately leaves out

- A live map on the practitioner's phone. Today keeps its picture, which
  works with no signal. The coordinator's map can come to the phone later if
  wanted; nothing here prevents it.
- Moving visits a household has agreed to. That remains a hand move, one at
  a time, with the household told.
- Salik, parking and the cost of the practitioner's time as terms in the
  sums. The navigation specification (section 4) describes that model; this
  piece optimises drive minutes only. The rest is a later piece once the
  practice has real days to measure against.
- Working hours. The practice has not recorded any, so the day is bounded by
  itself: it never starts earlier or ends later than it does now.
- Re-optimising by itself when a visit is cancelled. The coordinator presses
  the button.
- A settings field for a practitioner's home base. The practice has none
  recorded on the live system; Claude writes it by an audited data step, as
  the price list was loaded on 7 September. A field on the Practice page is a
  small later addition.
- More than ten stops in one day. The practice does at most six; beyond ten
  the button says the day is too long to optimise.
- Several vehicles, several practitioners sharing a day, recurring bookings,
  Ramadan traffic tables.

## Decisions only the operator can take

Four were taken at 22:40 on 7 September and are recorded at the top. Four
remain, each with a default that stands until overruled:

1. **Shauna's home base.** The coordinates of where her day starts (her
   home, or the studio). Needed for the first drive and the drive home in the
   sums and on the map. Until given, the day is optimised between its stops
   only, and the map has no first pin. Default: none recorded; Claude asks
   for it at the staging pass and writes it by a data step.
2. **A cap on what Google may charge.** Recommended: a daily ceiling of 500
   map loads and 3,000 drive-matrix elements on the project, which is many
   times what the practice can use and stops a fault from costing money.
   Claude can set it, or the operator can in the console. Default: set it.
3. **The old app's maps stop.** Re-restricting the Flutter key ends the
   Flutter app's ability to show maps, on every device that still has it.
   Default: do it at piece seventeen's staging pass; the app is dismissed.
4. **Which practitioner the week planner assumes.** The one credentialed for
   the chosen service; with one practitioner there is no choice. Default: as
   stated.

## What it costs

Under the cost rules of `docs/HANDOVER.md` section 6. Piece seventeen: one
builder on Opus, about 0.9 million tokens; one combined review and one
re-check on Fable 5.1, about 0.45 million together; a fix round, about 0.35
million; a staging pass on Sonnet, about 0.3 million. Roughly 2 million.
Piece eighteen: about 1.3 million on the same shape. Together a little more
than pieces eleven and eight.

Google: the map product allows 10,000 map loads a month free and the drive
matrix 10,000 elements a month free before anything is charged; a day of six
stops optimised for the first time asks for a few hundred elements, and the
cache answers the repeats for thirty days. The practice sits well inside the
free allowance; the cap in decision 2 bounds it regardless. No new product to
enable, no new vendor: one row of the register is amended.

## What you have to do

Before the build: approve this file, and give Shauna's home base when
convenient (decision 1). When piece seventeen is on staging: open the day
map on the seeded day, press Optimise, read the order and the minutes saved,
and say whether it reads right. When piece eighteen is on staging: pick a
seeded client in the planner and say whether the fourteen rows make sense.

## Builder notes

**One stream, its own worktree.** The `scheduling` worktree
(`/Volumes/Storage/McWellness/mcwellness-scheduling`, ports 5434/3002/5175)
builds both pieces, on branches `scheduling-5` and `scheduling-6`, from
briefs written off the specification. For these pieces it owns, beyond its
row in `docs/SPEC/OWNERSHIP.md`, `app/api/routing/**` (returned from piece
eight's widening) and the seam's two implementations under
`app/api/_middleware/routing/**`.

**What it owes the trunk**, each an item in
`docs/CHANGE-REQUESTS/scheduling-05.md` and, by the precedent of pieces
seven to eleven, riding in the piece's own pull request: the seam's new grid
call in `domain/shared/routing.ts`; the map page's own security policy in
`app/api/_middleware/security.ts` and the shell's nonce in
`app/api/serve-app.ts`; the route in `app/shell/App.tsx`; one browser setting
in `.env.example` and the runbook; the vendor row; the ownership widening.
No migration. No policy file. No new table: the estimates go into the cache
that already exists, and the plan is applied through appointment rows that
already exist.

**The one test that matters most.** With the Google switch off and no
browser key, the day map page still lists the day, Optimise still works and
says "straight-line estimate", and every other page of the console and the
phone app carries exactly the security policy it carries today.

Everything else is checked as pieces one to eleven were: one combined review
and one re-check, the record posted, the merge, a staging pass.

## What approving this means

Approving this file approves `docs/SPEC/route-planning.md` as written, both
parts, and the defaults above as Claude's standing until you overrule them.
It approves the change to the two Google keys described in it. It approves
nothing about the phone's map or about Salik and parking beyond their
one-line mention; each comes back to you with a plan of its own.
