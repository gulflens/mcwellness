## Round 50 — the expo's form, its poster and its leads (2026-09-16)

### Why the round happened

The practice takes a stand at the AccessAbilities Expo in October 2026. On 15
September the owner asked for a code on the stand that opens a short enquiry
form — name, contact details, who the visitor is asking for, whether they are
interested in a brain map, neurofeedback or both, and a short reason — with
the submissions kept "separately as Expo leads" for following up afterwards.
The same message asked for three more things, sequenced on 16 September in
this order: this round first for October, then logging past sessions, then a
Google review prompt, with push notifications written up as a later round
whose prerequisites are recorded below.

Decisions the owner took on 16 September: English only on the form; one pull
request for this feature alone; the other three each in their own.

### What landed in the shared zone

**Built on the enquiries, not beside them.** `enquiry` (migration 916) was
already a public, unauthenticated write path with a quarantine table, a
definer door with a per-address budget, a honeypot, row policies for the three
office roles, and an office screen that converts or dismisses. "Saved
separately" is a filter and a file on that screen, not a second table, and
the audit-trigger exemption `.claude/rules/data-model.md` records for
`enquiry` covers the expo's rows without a second exemption.

**Migration `919_expo_enquiry.sql`**, trunk first half, `-- Needs: 916`:
`source` admits `expo`; two typed columns `enquiring_for` and `interest`,
each a fixed list by check constraint, required on a new expo row by
`enquiry_expo_says_who_and_what`, kept off every other row by
`enquiry_only_expo_says_who_and_what`, and added to the scrub constraint's
null list; `app.lodge_enquiry` recreated with the same signature, inserting
both, deciding its budget by source — thirty from one address in ten minutes
for the expo, five for the website — and, before either, refusing the three
hundred and first lodging of the hour from every address together. No policy
file changes: none names a column.

**`domain/enquiry/parse.ts`**: `ENQUIRY_SOURCES` gains `expo`; `ENQUIRING_FOR`
and `INTERESTS` are the two lists; a value off a list is "not answered",
never stored as text; an incomplete submission now carries `missing`, the
fields by name in the form's own order. `leadFromEnquiry` is unchanged and
tested to say `expo` as the lead's referral source.

**`domain/shared/csv.ts`** (new): the file writer the books had in
`domain/accounting/csv.ts` — text guarded against formulas, amounts never —
moved with its tests, because a domain module may not import another's and
the expo's leads file needs the same rule. Accounting re-exports the names, so
nothing in the books changed. The E.164 plus is guarded like any text: the
office sees a quotation mark before the number in a spreadsheet, and the
spreadsheet never evaluates it. Kept rather than special-cased.

**`app/api/enquiries/`**: the list and the conversion carry the two answers;
the door forwards them and answers a refusal as `{ error: 'incomplete',
missing }`; `GET /api/enquiries/expo.csv`, under `enquiry.list`, is the
follow-up list — waiting expo rows oldest first, the answers in words, each
row logged as a read and the export logged once as an `enquiry_export`
entity under its request id, the shape `app/api/audit/activity.ts` already
uses for a bulk act and a kind of its own so a record's timeline never looks
for an enquiry with a request's id. It answers through accounting's
`csvResponse`, imported and not edited.

**`app/shell/pages/ExpoEnquiryPage.tsx`** (new, with `expo.css` and its
test), routed at `/expo` in `app/shell/App.tsx` outside `RequireAuth` beside
the sign-in page and the portal's invitation. It posts with a plain `fetch`,
never `apiFetch`, so a member of staff signed in on the stand's tablet is not
signed out by a refusal. The tick is the website forms' own sentence and is
not a consent; a line beneath it says the details are used only to reply and
links the website's privacy policy at `https://mcwellnessuae.com/privacy.html`.

**`app/admin/enquiries/`**: a source filter with counts, the two answers in
the Details column, "Download expo leads" while any expo enquiry waits
(through accounting's `downloadCsv`, imported and not edited) with a line
beside it saying the file holds names and numbers, to keep it on the
practice's own device and delete it once the follow-up is done — a copy the
scrub and an erasure never reach, which whoever handles an erasure request
should ask about — and
`ExpoPosterPage.tsx` (new, with `poster.css` and its test) at
`/admin/enquiries/poster` — routed outside the `/admin` layout so no rail
prints, behind `canOpenEnquiries`. The code is drawn by the page as one SVG
path from the encoder's modules with a four-module quiet zone, never the
encoder's own markup and never a data URL; it encodes this origin's own
`/expo`, so staging prints a staging code.

**`package.json`**: `qrcode-generator` 2.0.4, MIT, no dependencies of its
own, loaded only with the poster screen, receiving no personal data —
`docs/COMPLIANCE/approved-vendors.md` is therefore unchanged. `pnpm
audit:deps` is clean.

**Documents**: `docs/superpowers/specs/2026-09-09-enquiries-design.md`
(amended), `docs/SPEC/00-data-model.md` (the Enquiry section),
`docs/SPEC/OWNERSHIP.md` (the enquiry row), and this note.

### Every file this round touched outside the trunk's own paths, by stream

**`accounting`** (`domain/accounting/**`) — `domain/accounting/csv.ts` and
`csv.test.ts`: the writer moved out and is re-exported; the Zoho rows stay.
`app/api/accounting/csv-response.ts` and `app/admin/accounting/download.ts`
are imported by the enquiry files and not edited.

Nothing else. `db/seed/**` is untouched: no enquiry generator exists and no
test asserts sources.

### The migration, and which half of the trunk's range 919 sits in

`enquiry` is the trunk's own table (916, first half), so a migration that
alters it belongs in `900–949`, where 919 was the next free number. It names
916 alone in its `-- Needs:`; `checkNeeds` accepts it and `pnpm
audit:migrations` finds no merged file edited.

### The three reviews, and what they changed

`compliance-reviewer`, `security-reviewer` and `schema-reviewer` each passed
the round and each raised medium findings, all taken before the pull request
was opened:

- **The expo's budget is claimable by a word.** Both the schema and the
  security review: `source` comes from the body, so a script saying `expo`
  from many addresses gets thirty from each, and the office's list of two
  hundred could be wholly junk from seven addresses. Taken: the practice-wide
  hourly ceiling in the definer, three hundred from every address together,
  with a test that lodges three hundred and is refused the next. Not taken:
  a stand key in the code's address that unlocks the larger budget — a
  sound second lock, deferred because the ceiling alone makes the flood
  bounded and the key would be a tenant setting, a page parameter and a
  door rule for a form that runs for three days.
- **"The website's rows never carry them" was said, not enforced.** Taken:
  the ninth constraint, and `parseEnquiry` drops the two answers unless the
  source is the expo.
- **The line under the tick understated what happens to the details.**
  Taken: it now says they become part of the record if the person goes on
  to work with the practice, and that the enquiry keeps nothing personal
  once replied to if not.
- **The leads file is a copy erasure cannot reach.** Taken: the line beside
  the button, and this note.
- **The export's audit row named an `enquiry` with a request's id.** Taken:
  its own entity kind, `enquiry_export`.
- **The rollback's precondition.** Taken: the block says to download and
  delete the expo rows first, and where 916's function body is.

Not taken, and why: a request id from the page for idempotency at the door
(the security review's low finding). Send is disabled while sending; a
visitor whose reply timed out after the commit may send twice, and the
office dismisses the second with a reason. A column and a lookup in the
definer for a three-day form is more than that costs.

### Deliberately not done

- **A "contacted" mark on a waiting row.** `db/policies/enquiry/writers.sql`
  admits only the move from `new` to `converted` or `dismissed`, so the mark
  would be a policy change, a route with its reversal, an audit action and a
  page state. The file is the follow-up list, and convert or dismiss is the
  done signal.
- **Arabic on the form.** The owner's decision of 16 September. The portal's
  dictionary is the portal stream's; lifting it into the shell for one public
  page is a shared-zone change for a later round if wanted.
- **A privacy page of the app's own.** The website already publishes one in
  both languages; the form links it.

### Recorded for the three rounds that follow

**Logging a past session.** Blocked three times over today: the fifteen-minute
device-clock window in `app/api/sessions/checkin.ts`, `app.checkin_context`'s
"booked today" (SQL, migration 961), and the route's today-clamped appointment
lookup; nothing in `docs/` records the earlier conversation. The owner's
decision of 16 September: a past session takes a package credit if one is
available, otherwise the form refuses and offers "settled before the app",
which charges nothing — never an invoice at today's price, which migration
404's own header argues against. Shape: an admin route in session-capture's
paths, `session.recorded_from` and `session.settled_outside_app` in a
`950–999` migration that also replaces the billing trigger for records-origin
rows, a pure rule in `domain/session/pastSession.ts`, and a drawer on the day
schedule for a past date.

**A Google review prompt.** `docs/SPEC/client-portal.md` section 4 says "no
nudges"; the owner's decision of 16 September admits one quiet, dismissable
line on the portal home after a brain-map report is issued or a package's last
session is used, recorded in that spec as a dated decision when built. The
link is a hand-off like `wa.me` and Google Maps: no personal data leaves the
app. Shape: `tenant.review_url` (migration 920, the shape of 912), a pure rule
in `domain/portal`, a dismissal row in the portal's range, a new notice kind
on the home screen with both languages.

**Push notifications.** Not built, and not buildable yet, for three reasons
each needing a decision before code: the lawyer-approved household notices
say "we never use it for advertising … if that ever changes we will ask you
first, separately", so offers by push need a new versioned `marketing`
consent wording (the purpose exists in the enum and is deliberately absent
from `OFFERED_CONSENT_PURPOSES`); a browser push subscription is an Apple or
Google push service receiving the device endpoint and the message, a new row
in `docs/COMPLIANCE/approved-vendors.md` before any code; and the service
worker has no push listener, there is no job runner, and on an iPhone web
push works only once the portal is added to the home screen. An interim that
needs none of this: an announcements section on the portal home, written from
Settings.

### Synthetic data used throughout

Names from `db/seed/names.ts` (Rowan Meadow, Basil Valley, Iris Creek, Hazel
Harbour); numbers in `+971 50 000 00xx`; addresses at `example.com`; ids in
the reserved ranges; hashes of repeated letters.

### Checked, not claimed

`pnpm verify` under Node 24: format, lint, typecheck, the secrets scan, the
migration audit, and 2,920 unit and component tests. `pnpm test:db` against
a local PostgreSQL 16 with PostGIS, because the container has no Docker
daemon for the pinned 17.6 image: 103 of 104 files pass, including the three
enquiry files, `tests/db/schema.test.ts` and every stream's `db/` suite. The
one failure, `tests/db/bootstrap-practice.test.ts`, inserts into `auth.users`,
which only the Supabase image provides; it is untouched by this round and CI
runs the pinned image on the pull request.

## Amendment — the poster in the practice's own dress (2026-09-19)

The operator asked, on 19 September 2026, for the stand's poster to carry the
logo and the practice's look. The first poster was the plain column the
sign-in page uses, on the console's grey paper, and in that 24rem column the
address broke across two lines as `…/exp` and `o`.

**What changed**: `app/admin/enquiries/ExpoPosterPage.tsx`, `poster.css` and
the page's test, and nothing else. The poster is now one white A4 sheet
headed by the whole lockup (`public/brand/lockup.png`, the same file sign-in
shows; `docs/brand-assets.md`), with a violet bar above and below, the code
in a violet frame, and the address in the violet on one line that never
breaks. The words are the round's own and did not change. The Print button
moved off the sheet and above it, so it is in reach without scrolling past a
page of paper.

**The code itself did not change**: the same encoder, the same path, the same
four-module quiet zone, still drawn in `--ink` rather than the violet, because
a camera wants contrast and not brand.

**Three decisions a later reader might otherwise undo:**

1. The violet is only ever a border or the colour of type, never a fill. A
   browser leaves background fills off the paper unless "Background graphics"
   is ticked and always prints borders and text.
2. The sheet is a size container and every length on it is a 210th of its
   width (`--mm`), so the screen shows the printed page at whatever size
   fits and the stylesheet opens no breakpoint of its own
   (`tests/lint/one-set-of-breakpoints.test.ts`).
3. The page margins are changed by a *named* page (`@page poster`), not a bare
   `@page`, which would have changed the margins of everything else the
   console prints once this stylesheet had loaded. With no margin the browser
   has nowhere to print its own date and address lines. Where named pages are
   not understood the sheet is capped at 180mm wide, so that its height fits
   inside the browser's own margins on A4 and on US Letter.
   *(Corrected below, 19 September 2026: the 180mm fallback and the
   `@supports` test it hung on are withdrawn. The named page itself stands.)*

### Checked, not claimed

Printed to PDF from a local build by headless Chrome: the named page is one
page of A4 (595 by 842 points) with no browser lines on it; the fallback,
imitated by overriding the three declarations it differs by, is one page of
US Letter with the browser's margins and lines. At full width the fallback
ran onto a second page, which is where the 180mm came from. Looked at on
screen at 1100 and 600 pixels wide. The production address was set at its
real length (`app.mcwellnessuae.com/expo`) for those prints and fits the line
with room to spare.

**No migration, no policy file, no API route, no dependency, no new asset.**
As before, the code encodes the origin it is shown on: print it from
`app.mcwellnessuae.com` and from nowhere else.

## Correction — the poster's second page in Safari (2026-09-19, an hour later)

The amendment above is wrong in one place, and the poster it describes was
live for about an hour with the fault.

**What was wrong.** Decision 3 sized the sheet to the paper wherever
`@supports (page: auto)` held, and called everything else the fallback. It
took that test for "this browser will give the named page its margins". It is
not. Safari has understood the `page` property since its first release, has
honoured `@page` at all only since 18.2, and refuses `size: A4 portrait` for
the orientation keyword. So in Safari the full sheet, 210 by 296 millimetres,
sat inside the browser's own margins. The check above was an imitation in
Chrome and could not have shown it: Chrome shrinks an over-wide sheet to fit,
and on its margins the shrunken sheet is one page.

**How it was found.** The operator asked, after the pass, to make sure it
prints on one sheet. A small Swift program drove the system's own WebKit
through `WKWebView.printOperation` to a PDF with no print panel — Safari's
real print pagination, which had been written down as untestable from this
machine. The poster that was live came out as **two pages at every margin
tried: the poster whole on the first, and a blank second sheet.**

**What changed**, in `poster.css` and the page's test, and nothing else:

1. The sheet that fits is now the rule, not the fallback: as tall as its
   contents, no wider than 170mm, 236mm tall, asking the page for nothing.
2. The whole sheet is only for paper *measured* to be A4 from edge to edge.
   `.poster` is a size container while it prints, and the whole sheet sits in
   `@container poster-paper (min-width: 209.5mm) and (max-width: 210.5mm)`.
   The page is that wide only where its margins really are none. US Letter
   with no margins is 216mm and is kept out, being shorter than the sheet.
3. `size: A4`, without the orientation keyword.
4. The body's floor of one screen is lifted while the poster prints: on paper
   a screen is a page, and a body exactly one page tall has no room to round.

Those millimetres are the width of a sheet of paper, not a tier of the
console's; `tests/lint/one-set-of-breakpoints.test.ts` reads `px` and `rem`
and is right not to see them.

### Checked, not claimed

Through WebKit, the engine Safari prints with, Safari 27.2 on macOS 27.2: one
page on A4 with the system's default margins (90 points above and below, 72
at the sides), at 36 points, at 18 points and at none; one page on US Letter
at 18 points. **One case fails and is left failing:** US Letter with the
system's default margins is two pages, because the paper is 18mm shorter and
the margins take 63mm of it. No browser prints with margins that deep, the
paper is not the country's, and the fix would shrink every A4 poster to
serve it.

**The bounds, by arithmetic from the sheet's 1.39 and not by printing.** On A4
it is one page at any margin set equally on all four sides. With narrow sides
the sheet stays 170mm wide and 236mm tall, so it runs over once the margins
above and below pass about 30mm each: 35mm above and below with 10mm at the
sides would be two pages. On US Letter the same limit is about 21mm. Chrome's
own margins are about 10mm and Firefox's 12.7mm, so neither is reached by a
browser left alone; somebody who sets deep margins by hand can reach them. An
earlier draft of this note said "at any margin at all", which the review of
this round corrected.

Through Chrome: one full page of A4 with the named page honoured, as before;
one page with it ignored, on A4 and on US Letter.

A test in `ExpoPosterPage.test.tsx` reads the stylesheet's rules with its
comments set aside and fails if `@supports (page` returns, if the container
rule goes, or if the orientation keyword comes back. It was run against the
old rule put back by hand, and failed, before it was trusted.

The program is kept outside the repository, with the practice's other tools,
as `wkprint.swift`.

## The poster as a file — Safari's own lines (2026-09-19, later the same night)

The operator printed the mended poster from Safari and asked for four lines
to go: the page's title, the date and time, the page's address, and "Page 1 of
1". They are Safari's, not the page's.

**What a page can and cannot do about them.** Chrome and Firefox write such
lines in the page's margin, and the poster's named page leaves none, so they
write nothing: printed with Chrome's "Headers and footers" left on, the sheet
came out alone. Safari's are drawn by the print system over whatever the page
asked for. An unnamed `@page { margin: 0 }`, added through the CSSOM because
the policy forbids an inline style element, was printed through WebKit: the
top margin went, the footer was drawn over the corner regardless, and the
sheet was left against the top edge. It was not adopted. In Safari the lines
go when "Print headers and footers" is unticked in its print window, and by no
rule a page can write.

**What was built instead.** Safari writes none of those lines on a PDF. So the
page gains "Download PDF" beside "Print": `posterPdf.ts` draws the same sheet
onto a canvas at 300 dots to the inch, 2480 by 3508 pixels, and hands it over
as one page of A4 that prints clean from Safari, Chrome or Preview.

- **All of it in the browser.** No route, no dependency, nothing sent
  anywhere, and nothing about anybody in it: the code holds this origin's
  `/expo`, by the page's own encoder, exactly as the page's does.
- **Not the shared writer**, `domain/shared/document/pdf.ts`, and on purpose.
  That writer sets type from TrueType programs that live on the server and
  embeds a PNG's own scanlines. This sheet is a picture the browser has
  already drawn, and PDF's `/DCTDecode` *is* JPEG, so the canvas's bytes go
  into the file untouched and the whole writer is six objects and a
  cross-reference table.
- **No colour is written in it.** The canvas reads `--brand`, `--ink`,
  `--ink-2`, `--surface`, `--font` and the two weights from the page's own
  tokens when it draws.
- **One sheet, described twice** — `poster.css` for the page, `POSTER_MM` for
  the file. `posterPdf.test.ts` reads seventeen lengths out of the stylesheet
  and fails if the two stop being the same sheet. The words are one constant,
  used by both.
- The buttons and the sentence under them stand in `.poster__tools`, which
  does not print.

### Checked, not claimed

The real generator was run in Chrome and in WebKit, the engine Safari uses,
and the file each made was saved and opened: one page, 210 by 297
millimetres, and the code read back off both files with the Vision framework
says `https://app.mcwellnessuae.com/expo`. WebKit's file is 653 kB and
Chrome's 502 kB. Beside the page's own print they are the same sheet to the
eye.

Printing the page itself was run again with the new markup above the sheet:
one page in Chrome with its headers left on, one page in WebKit at the
system's margins and at 18 points, and the text layer of each holds the
poster's five lines and nothing else — no button and no sentence reached the
paper.

**Not checked:** Safari the application, which cannot be driven unattended.
What was run is its engine, which makes the file; the saving of a file from a
`blob:` address through a link with `download` is the application's, and was
not pressed by a person here.

**Known and left:** the lockup is 960 pixels across and the sheet sets it 120
millimetres wide, which is 203 dots to the inch, on the page and in the file
alike. The operator's source is 1,728 across at that crop. A sharper cut for
paper is a separate, small piece.

`pnpm verify`: 253 files, 2,975 tests. No migration, no policy file, no API
route, no dependency, no asset.
