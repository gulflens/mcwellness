# Approved consent wording, version 1.0

**Date:** 9 September 2026
**Status:** design approved by the operator; awaiting spec review

## Why this exists

The practice's legal advisor reviewed the pack sent on 7 September and
returned four recommendations, relayed by John on 9 September:

1. **Remove all references to photographs.** The practice does not intend to
   photograph clients or their sessions, so the photo consent comes out of
   both documents.
2. **Distinguish general from sensitive data.** Ordinary personal information
   (names, contact details, appointments, payments) must read separately from
   sensitive health information (neurofeedback data, QEEG results).
3. **Obtain specific consent for neurofeedback and QEEG data**, in its own
   section covering what is collected, why, how it will be used, who can
   access it, where it is stored, and the client's rights over it.
4. **State how the data will not be used**: never sold, never for advertising,
   never for unrelated purposes.

The letter also records that the practice is not required to be DHA approved
and so is not bound by DHA medical-record storage rules today, and that
records may migrate to NABIDH later, when the practitioner is fully qualified.
NABIDH is a future round, not a build item here.

## Decisions taken

Taken by the operator on 9 September, in this order:

| Decision | Choice |
|---|---|
| How far the photograph removal goes | Retire the capability, not only the wording |
| Shape of the NF/QEEG consent | Its own consent purpose |
| The `research` and `marketing` purposes | Retire both |
| The draft line | Go to v1.0 approved now |
| Arabic | Translate and ship with the English, no separate review gate |
| The new health-data page | Ship at v1.0, plus a covering note so the advisor sees it |
| Website subdomains | Main site only this round; report what the subdomains hold |

## Current state, measured

- **Production** (`ipiluvnlnzdbolbqwtpl`): 0 consents recorded, 0 `consent_text`
  documents loaded, 1 client. The wording has never been seeded there.
- **Staging / demo** (`ajjkvjtqxktkgrvcrzkh`): 42 consents against 12 wording
  documents. Its storage keys are filled, so a re-seed must clear them first.
- `CONSENT_PURPOSES` carries six values; `research` and `marketing` have no
  wording and no product flow.
- The setup photograph is a working feature, not a paragraph: capture routes,
  session-runner steps, a database guard and withdrawal semantics.

## Scope

### In

The four recommendations, across the wording, the app, the reports and the
main website's two legal pages.

### Out

- The refund contradiction between the approved page and `domain/billing/refund.ts`
  (a billing round; the wording is unaffected because it refers to the
  practice's current terms).
- Repointing the website's `lodge_enquiry` script off the retiring Supabase
  project `gqvpapvdqcfjlifgwhpk`.
- `intake.mcwellnessuae.com` and `qeeg.mcwellnessuae.com`. Their contents are
  reported at the end of the round so the operator can decide on a follow-up.
- NABIDH migration.

## 1. The wording set

The **simple set** in `docs/CONSENT/simple/` becomes version 1.0. It was
approved by the founder on 4 September and was always the intended final
wording; the long drafts in `docs/CONSENT/` are superseded, not deleted,
because a recorded consent names the text it was given against.

`agreement.md` is one page that several purposes point at, with the child
section and the home section as the differences.

| Purpose | Wording | Status after this round |
|---|---|---|
| `participation` | `simple/agreement.md` | v1.0, approved |
| `minor_participation` | `simple/agreement.md`, child section | v1.0, approved |
| `home_visit` | `simple/agreement.md`, home section | v1.0, approved |
| `health_data` (new) | `simple/health-data.md` (new) | v1.0, approved |
| `photo_video` | none | retired, never offered |
| `research`, `marketing` | none | retired, never offered |

### Changes to existing pages

- **`agreement.md`** — the "Photographs (optional)" section and its tick box
  are removed entirely.
- **`your-information.md`** — gains two things: the general/sensitive split
  required by recommendation 2, and the negative-use statement required by
  recommendation 4 (never sold, never for advertising, never for an unrelated
  purpose).
- **`bookings-and-packages.md`** — unchanged in substance. It already carries
  the founder's 4 September rule: free more than 24 hours ahead, AED 150
  within 24 hours or when a visit cannot go ahead once the practitioner has
  arrived, and a package never loses a session to a cancellation.

### The new page

`simple/health-data.md` answers the advisor's six requirements in the
practice's own plain voice, in this order: what is collected, why, how it is
used, who can see it, where it is stored, and what the client may do about it.
It states plainly that the data is never sold, never used for advertising and
never used for anything unrelated.

It carries no legal identity. The practice's legal name, licence number and
registered address live in owner settings in the database and are rendered
around the text, exactly as invoices, reports and the erasure letter already
do. **This repository is public and the legal identity must never enter it.**

### Arabic

All four pages are translated in this round and ship with the English at v1.0.
The founder's original instruction was that Arabic follows once the English is
final, so that the words are translated once; this round is that moment.

## 2. Database

Postgres cannot cleanly drop an enum value, and staging holds 42 consent rows
that use `photo_video`. Therefore:

- **Every existing enum value stays.** Nothing is destroyed; history stays
  readable.
- One migration adds `health_data` to `public.consent_purpose`.
- `requiredConsents` gains `health_data` as an always-required purpose,
  alongside `participation`: every client receives neurofeedback, so there is
  no case where it is optional.
- The retired purposes are removed from what the console offers, not from the
  type that describes what the database may hold.

Production takes the new set clean. Staging and demo need their wording
storage keys cleared before a re-seed, per the rule in `docs/CONSENT/README.md`.

## 3. Retiring the setup photograph

The document and the capability move together. Deleting the wording while
leaving the routes would leave a live way to store photographs of clients with
nothing signed to permit it.

Removed:

- `app/api/sessions/photo.ts`, `photo-link.ts`, `photo-availability.ts`
- The photo steps in `app/therapist/session/PreflightStep.tsx`, `PostStep.tsx`,
  `SessionRunner.tsx`, and the consent probe in `CheckInPage.tsx`
- The `consent_missing_photo_video` refusal reason in `app/api/sessions/schema.ts`
- The photo-deletion path in `app/api/clients/withdrawal.ts`
- The setup-photo database function from migration 306, by a new migration
- The `photo_video` labels in `ConsentTab.tsx`, `RecordConsentForm.tsx` and
  `app/client/i18n/dictionary.ts`

Any stored photograph bytes on staging and demo are cleared as part of the
round.

## 4. The draft line

`WORDING_IS_DRAFT` in `domain/reports/document/strings.ts` becomes `false`,
and the same commit drops the draft line from the agreements shown by
`RecordConsentForm` and the `consent-wording` route.

**One coupling must not be missed.** `strings.ts` quotes two standing
sentences verbatim from the consent text, so that a report and the document a
household signed can never drift apart. Those quotes currently come from
`participation.en.md`, which this round retires. They must be re-pointed at
the approved wording in the same commit, or the guarantee breaks silently.

## 5. The website

The two legal pages on `mcwellnessuae.com` are static files on Hostinger under
`/home/u936187015/domains/mcwellnessuae.com/public_html`. They are pulled,
edited and redeployed.

They take the corrections already tabulated in the lawyer pack's document 8,
with **one reversal**: document 8 proposed *adding* a photographs section to
the privacy policy. That proposal is dead. The page must instead be silent on
photographs, because none are taken.

On top of document 8, the privacy policy gains the general/sensitive split,
the neurofeedback and QEEG section, and the negative-use statement.

## 6. Testing

Existing tests reference `photo_video` widely and must be updated rather than
deleted where they cover consent behaviour that still exists:
`tests/db/schema.test.ts`, `tests/db/consent-text.test.ts`,
`tests/client/db/consent_documents.test.ts`, `tests/session/db/run.test.ts`,
`tests/session/outbox.test.ts`, `tests/portal/fixtures.ts`.

New coverage:

- `health_data` is required before a client can be activated.
- A client with every other consent but not `health_data` cannot be activated.
- The retired purposes are not offered by the console.
- The photo routes no longer exist.
- The wording loader loads five texts per language and names the right one for
  each purpose.
- The report's quoted sentences match the approved wording exactly.

The English-only console guard, `tests/lint/console-is-english.test.ts`,
continues to apply.

## 7. Risks stated and accepted

- **The Arabic ships without a reader's review.** Nobody who reads Arabic will
  have checked a legally binding document before a household signs it. The
  operator chose this to avoid blocking the launch. Recorded here so the
  choice is visible rather than implied.
- **The health-data page is new text the advisor has not seen.** It is written
  from their six stated requirements and ships at v1.0; a covering note goes
  back so they can confirm it. Until they reply, the practice is relying on
  its own reading of their instruction.
- **Two brackets were never answered**: the hosting-region phrasing and the
  confirmation of amounts and periods. The wording states hosting plainly as
  Mumbai, India, and takes the amounts from the founder's own 4 September
  decision. Neither is a lawyer-confirmed form of words.

## 8. Deliverables

1. The four English pages and their Arabic translations, at v1.0, approved.
2. A migration adding `health_data`, and one retiring the setup-photo function.
3. The photograph capability removed from the app.
4. The draft line off, on agreements and on reports.
5. The two website pages updated and redeployed.
6. A covering note, in the practice's own voice, putting the new health-data
   page in front of the advisor.
7. A report on what `intake.` and `qeeg.` contain, for the operator to act on.

Nothing reaches production until the operator says so, as with every previous
round.
