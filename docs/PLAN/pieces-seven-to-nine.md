# McWellness Pieces Seven to Nine

Written 4 September 2026 by Claude for the operator. **Approved by the
operator on 4 September 2026** ("It's a brilliant plan. I approve it well").
The decisions under each piece were not answered individually, so the
recommendation beside each is taken as the default and marked as Claude's;
the operator may overrule any of them at any time, before or during the
piece.

The first six pieces are merged on `main` (the client record and enrolment,
consent capture and erasure, the diary with moves and cancellations, the
session runner, packages, invoices and receipts as PDFs, the practice's
identity with VAT charged only while registered). This plan proposes the
next three, says what each deliberately leaves out, and lists the decisions
only the operator can take.

| Piece | What it is | Size |
|---|---|---|
| Seven | The household's own screens: visits, money, family and agreements, with their own sign-in | large, about a week |
| Eight | The practitioner's phone: an installable app that works without signal, sensor photographs, and the day's map | medium, several days |
| Nine | A home for the platform: production hosting, a deploy pipeline, backups, monitoring and the security scan | medium, several days, plus the lawyer's answer |

## Piece seven: the household's own screens

Today a household contact can sign in and sees a page saying the portal is
still to come. This piece gives them five screens, in English and Arabic
from the first day, showing only what the database already lets that
household read.

- **Home.** The next visit with its arrival window, the balance or the
  sessions remaining on the package, and anything the practice has asked
  them to read.
- **Visits.** Upcoming visits with their windows; past visits with the date
  and the service, never the practitioner's notes.
- **Money.** What is owed or in credit, the package's progress ("session 6
  of 15"), and every invoice and receipt as the same PDF the practice holds,
  opened through a short-lived link that is logged.
- **Family.** The people on the record and the details the household may
  correct themselves: telephone, WhatsApp, guardian and emergency contact.
  The address stays the practice's to change, because it is where the
  practitioner drives.
- **Agreements.** The exact wording each person signed, with the date, and
  the way to ask for a withdrawal or an erasure, which reaches the practice
  as a request rather than acting on its own.

**Deliberately left out:** booking from the portal. The practice schedules
by hand in this phase, so the portal says how to ask for a visit rather than
pretending to book one. Session notes, measurements and reports stay out
until piece ten exists to render them.

**Decisions, with the defaults taken:**

1. *How a household signs in.* Default (Claude's): an invitation the
   practice sends by WhatsApp, which the contact opens once to set a
   password, with the same lock afterwards as staff. The old app's
   code-plus-phone door is the alternative and is not recommended.
2. *Who in a household sees money.* Default (Claude's): every adult contact
   on the record, since the household is the billing unit; a minor's own
   contact sees visits and agreements only.

## Piece eight: the practitioner's phone

The session runner already works and keeps its record on the phone until
signal returns. What is missing is everything around it.

- **Installable, and usable in a lift.** The app installs to the home screen
  and its screens are cached, so opening it in a basement car park shows
  today's stops rather than a blank page. Checked on an iPhone as well as
  Android, because iPhone is where this usually breaks.
- **The sensor photograph.** Where the household has signed the photograph
  agreement, the practitioner takes one picture of the sensor placement at
  set-up. It is compressed on the phone, filed through the same document
  store as everything else, shown at the next visit, and removed by an
  erasure.
- **The day's map and drive estimates.** Today's stops on a map with the
  estimated drive between them, using coordinates only, never a name. This
  is the first use of the Google key from the old app, and it costs money
  per lookup, so the estimates are cached per day.
- **The kit.** The specification blocks a session on an uncalibrated
  device, and the device table was never created, so that rule cannot fire.
  This adds it, with the calibration date the practice records.

**Deliberately left out:** live location, an ETA sent to the household, and
the safety features written in the navigation specification. Each is its
own decision about what the practice sends and when.

**Decisions, with the defaults taken:**

1. *Photographs before the lawyer has approved the wording.* Default
   (Claude's): build the feature now and switch it on per household only
   against a signed agreement, so the lawyer's edits change the text and not
   the code.
2. *The map's cost.* A day of six stops is a handful of lookups; at the
   practice's size this is a few dirhams a month. Default (Claude's): yes,
   with the cap set in Google's console at a figure the operator chooses.

## Piece nine: a home for the platform

Nothing runs in production. Staging is a real Supabase project in Mumbai
that is patched by hand, and the demo servers run from the operator's
laptop. This piece makes the platform deployable, and it separates what can
be built now from the one question that belongs to the lawyer.

- **Built regardless of region:** the app built and deployed by the pipeline
  on a tag rather than by hand; a guard so the migration tool refuses a
  production database unless told twice; nightly backups with a restore
  actually rehearsed; uptime and error monitoring on the health check; the
  weekly dependency audit already in place; and the deep automated security
  scan, which was started once and never finished.
- **Decided by the region answer:** where the database and the files live.
  Supabase has no data centre in the UAE; the nearest are Mumbai and
  Frankfurt. Amazon and Microsoft both have UAE regions, at the cost of
  running the database and the sign-in service ourselves.

**Decisions, with the defaults taken:**

1. *The region.* The lawyer's question, already open in the records.
   Claude's reading: McWellness is a wellness practice rather than a
   licensed clinic, the consent wording tells the household where the data
   is held, and hosting in Mumbai on Supabase is defensible and far cheaper
   to run. Default until the lawyer answers: build everything that does not
   depend on the region; if the lawyer says the data must stay in the UAE,
   the answer is Amazon's UAE region and the piece grows by about a week.
2. *The domain.* The platform wants its own address, for example
   `app.mcwellnessuae.com`, which needs one record added where the website's
   domain is managed. Default: that name, added by the operator when piece
   nine asks for it.

## Decisions already waiting, outside these pieces

None blocks the three above; each is written into the platform as a setting
or a marked recommendation so that the answer is a change of text, not of
code.

| Decision | Who | Standing recommendation |
|---|---|---|
| The tax point on a prepaid package: when VAT is due on sessions paid in January and delivered through May | Tax adviser | Nothing is written until the adviser answers; the column exists |
| Refund policy wording and the package expiry period | Operator | Twelve months' expiry, refunds pro rata less sessions used, as the old catalogue said |
| The unfit-to-attend fee: charged on top, instead of the session, or recorded only | Operator | Recorded only, added by hand on the account when the practice decides to charge it |
| Which consents cancel a booking when withdrawn | Operator | Participation and a minor's participation cancel future visits; withdrawing the home-visit agreement tells the coordinator instead |
| Eight consent wordings and the erasure letter | Lawyer | In use as drafts, marked as such on every copy |
| Whether a proposed visit counts as checked in | Operator | No: a visit must be confirmed before the practitioner can start it |
| Card and buy-now-pay-later payments | Operator, later | Not before piece nine; recorded payments cover the practice today |
| A VAT certificate | Operator | Staging records the practice as VAT-registered on the operator's word; if a certificate exists it belongs in the practice's Documents folder, and if not the switch is the thing to correct |

## Small things folded into the shared rounds

- A takings figure that is the same whoever asks. Today the month's total is
  smaller for the finance role than for the owner in any month with an
  erased household, because the erasure gate hides the household's rows.
  The fix is one database function that adds up the ledger whole and names
  nobody (billing's table, so billing's round).
- The audit trail's activity feed and the per-client access report, which
  the data already supports.
- Arabic copied out of a rendered PDF comes back as unreadable glyphs. A
  known defect in the writer, noted and scheduled, not urgent.
- Dropping the dead `invoice.document_id` column once billing changes the
  one test that still reads it (trunk-notes round 24).

## An honest limit

Assessments, brain-map reports and signed session reports are the biggest
thing still unbuilt, and the most valuable to the practice. They are not in
this plan because their specifications are not yet written, and building
them on guesses would waste the reviewers' time. This approval lets Claude
write those two specifications, `docs/SPEC/assessment.md` and
`docs/SPEC/reports-v1.md`, for a separate approval as piece ten.

## How each piece is checked

The same way as the first six: builders in their own worktree; independent
reviews; one consolidated fix round and a re-check; the review record posted
on the pull request; and the merge, which the operator has authorised Claude
to make when the record and the checks are both green. Each piece adds its
own tests, the whole suite stays green, and staging is patched after each
merge with the record in `docs/STAGING.md`. The cost rules in
`docs/HANDOVER.md` govern how many reviewers and which models.

## Builder notes

**Seven.** New worktree `portal` owning `app/portal/**` and
`app/api/portal/**` (add the row to `docs/SPEC/OWNERSHIP.md`), spec
`docs/SPEC/client-portal.md` written first. Every read goes through the
existing `client_contact` policies in `db/policies/client/readers.sql` and
`db/policies/billing/ledger.sql`; no new grant without a deny test.
Contact-detail edits reuse the guard-trigger pattern. Document links only
through `getSignedUrl` after `auditDocumentRead`. Invitation flow: a
`portal_invite` table (owner-issued, single use, expiring), the sign-in door
creating the auth user server-side with the service key as staff creation
does. RTL from the first screen; the shell's locale switch reused.

**Eight.** `vite-plugin-pwa` with a precache of the shell and a
network-first API; iOS Safari checked by hand for storage eviction. Photo:
`<input type="file" accept="image/*" capture="environment">`, canvas resize
to 1600 px longest edge, JPEG, filed as `setup_photo` through the storage
seam under the session's client, gated on a current `photo_video` consent,
unlinked by migration 105's step. Map: a map library loaded from cdnjs, a
`drive_estimate` table keyed by day and ordered stop pair, Distance Matrix
behind a `RoutingProvider` seam whose fallback is straight-line distance
times a road factor, coordinates only in the request. Kit: table,
calibration date, the blocking rule in `checkConflicts`.

**Nine.** CI job that builds `dist/` and deploys on a `v*` tag;
`db:migrate` refuses a URL matching the production project unless
`MIGRATE_TARGET=production` is set and the tag matches; backups by the
host's daily snapshot plus a weekly `pg_dump` to a second bucket, with a
restore into a scratch project rehearsed and recorded; monitoring by an
external uptime check on `/api/health` and error capture without a
third-party tracker in the app itself; the `claude-security` deep scan run
to completion on a tagged revision, findings verified and patched under the
usual reviews.

Earlier plans, for the record: pieces one to three
(https://claude.ai/code/artifact/17364a82-393f-48c0-8dff-2ddc0906dd1f) and
pieces four to six
(https://claude.ai/code/artifact/93bde7c5-ffbd-464a-bd6c-a450ed39ec48); this
plan's own page is
https://claude.ai/code/artifact/ccc676ec-2e88-43b7-9124-f14515d916c2.
