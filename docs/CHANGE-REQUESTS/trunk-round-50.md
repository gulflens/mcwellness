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
