# Consent wording

The texts a person is shown, and agrees to, before McWellness works with them.
Four purposes, each in English and Arabic, each a versioned document. The app
records **which version** was shown when a consent is recorded
(`consent.text_document_id`, `docs/SPEC/client-record.md` section 7), so these
files are never edited in place once a version has been used: a change is a
new version with a new `version:` line, and the old file stays.

| Purpose | Files | Who gives it |
|---|---|---|
| `participation` | `agreement.en.md`, `agreement.ar.md` | the client (18 or over) |
| `minor_participation` | `agreement.en.md`, `agreement.ar.md` | a parent or legal guardian, for a client under 18 |
| `home_visit` | `agreement.en.md`, `agreement.ar.md` | the client or guardian, when sessions happen at home |
| `health_data` | `health-data.en.md`, `health-data.ar.md` | the client or guardian; required before any session |

The agreement is **one page shown for three purposes**. A household meets a
single document rather than three that repeat each other, and each purpose
still files its own row, because a recorded consent names exactly one. The
loader reads that from a `purpose:` line naming several (`db/seed/consent-text.ts`).

`docs/CONSENT/notices/` holds what the practice publishes but nobody signs:
`your-information.en.md` and its Arabic twin. They are not consent wording and
are deliberately outside the loader's reach — `document.purpose` is typed as
the `consent_purpose` enum, and a privacy notice is not a consent.

## Status: APPROVED, 9 September 2026

The practice's legal advisor approved this wording, subject to four changes,
which this round carries:

1. **No photographs.** The practice does not photograph clients or their
   sessions, so the photo consent is gone — and with it the capability, since
   a consent is what authorised the camera at runtime.
2. **Ordinary details and health information read apart**, in
   `notices/your-information.en.md`.
3. **A specific consent for neurofeedback and QEEG data**, `health-data.en.md`,
   whose six sections are the advisor's six requirements: what is collected,
   why, how it is used, who can see it, where it is kept, and what a person may
   do about it.
4. **A statement of how the data will not be used**: never sold, never for
   advertising, never for research, never for anything unrelated.

Two things the advisor's letter did not settle are stated on the practice's own
authority rather than theirs: the hosting is named plainly as Mumbai, India, and
the amounts and periods are the founder's own decision of 4 September 2026.
`docs/superpowers/specs/2026-09-09-approved-wording-design.md` section 7 records
that, and records that `health-data.en.md` is text the advisor asked for but has
not yet read.

**The practice's identity is never written here.** No legal name, trade licence,
tax registration number or registered address appears in any of these files:
this repository is public, and identity is rendered from owner settings, as it
already is on an invoice, a report and the erasure letter.

## The Arabic is at 1.1, and the English at 1.0

Both were filed at 1.0 on 9 September 2026. The compliance review of the same
day found the Arabic saying المعالج — from علاج, to treat — where the rest of
the practice's software says الممارس, two lines after the same page says the
practice treats nobody. The words were corrected the same evening, before any
household had been shown either file.

That correction is a new version and not an edit, because the database says so
and is right to: `app.guard_document_write` refuses to change a filed wording
("a correction is a new document, never an edit of the one already filed"), and
`document_consent_text_version_idx` makes `(practice, purpose, language,
version)` unique whether or not a row is retired — so a version, once filed, is
spent. `agreement.ar.md` and `health-data.ar.md` are therefore version 1.1 and
their English twins are still 1.0. That asymmetry is the truth: one text was
corrected and the other was not, and a version belongs to a document rather
than to a pair.

## One signature can cover several of these

Since 10 September 2026 a household may sign every purpose it needs — participation and brain-map/neurofeedback information always, home visits because every client of this practice trains at home, a guardian's own consent when the client is a child — in one sitting rather than one scroll and one signature per purpose (`POST /api/clients/:id/consents/bundle`, `docs/SPEC/client-record.md` section 7). Nothing here changes for that: the household still reads each purpose's own full text before signing, each consent still names the exact wording document it was read against, and no version of any file above moved. What changes is only the evidence — one signature image, filed once and shared by every row it covers, its own foot naming the purposes — never the words a person reads and agrees to.

## The five years are a floor, not a timer

`notices/your-information.en.md` and `health-data.en.md` say the practice keeps
records for **at least** five years after a household's last session or contact,
may keep them for longer, and deletes nothing on a timer — a household asks, and
then it is deleted.

That is the operator's rule of 2026-09-09 and it matches what the practice
already had written down: the practice's absolute rule 8 and the `uae-compliance`
skill both say a minimum of five years after last activity, kept after that,
**nothing deleted on a timer, and erasure or anonymisation when the client
asks**, with financial records kept five years regardless. The wording
first promoted earlier that day said "then it is deleted", which read as a timer
and was the only document out of step; it was corrected the same evening, before
any household saw it.

`retention_until` on a document is therefore the date the floor lifts — the
earliest an erasure can take everything — and not a deletion date. Nothing
sweeps it, deliberately.

## Superseded

`superseded/` holds the eight long drafts of 3 September, replaced by the
wording above. They are kept, never deleted: consents recorded on staging name
them, and a household is shown the text it actually signed for as long as that
consent stands — `app/admin/clients/ConsentText.test.tsx` renders one to prove
the renderer still can.

## Amendments

**6 September 2026 — a head injury at any time.** The founder's review of
4 September approved the wordings with one change to the health question: ask
whether a person has ever had a head injury, not only in the last year. The
short set in `simple/` was written that way on the day; the four long files it
also belongs in — `participation` and `minor_participation`, English and Arabic
— carry it from version 0.2-draft. They were amended in place rather than
copied to new files, because no consent had been recorded against 0.1-draft
anywhere but a laptop and staging, and the loader expects one file per purpose
per language. Once a household has signed a version, the rule above stands: the
old file stays.

A store that already holds the old bytes needs them cleared first. A wording's
storage key is its document id, which is fixed by purpose and language and not
by version, and neither `pnpm seed` nor `pnpm seed:wording` will write over a
key that is already filled — by design, since the bytes behind a filed consent
are the evidence of what a person was shown.

## How the app uses these files

- The seed loads each file as a practice `document` of kind `consent_text`
  with its purpose, locale and version, so the consent step can name the
  exact text shown.
- The Arabic files are the text an Arabic-speaking client signs; they are
  faithful translations of the English, not summaries, and the lawyer's
  review covers both.
- Plain language, British English, no clinical vocabulary beyond what the
  law requires; a person at a kitchen table should be able to read it.
