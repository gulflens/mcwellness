# Consent wording

The texts a person is shown, and agrees to, before McWellness works with them.
Four purposes, each in English and Arabic, each a versioned document. The app
records **which version** was shown when a consent is recorded
(`consent.text_document_id`, `docs/SPEC/client-record.md` section 7), so these
files are never edited in place once a version has been used: a change is a
new version with a new `version:` line, and the old file stays.

| Purpose | Files | Who gives it |
|---|---|---|
| `participation` | `participation.en.md`, `participation.ar.md` | the client (18 or over) |
| `minor_participation` | `minor-participation.en.md`, `minor-participation.ar.md` | a parent or legal guardian, for a client under 18 |
| `home_visit` | `home-visit.en.md`, `home-visit.ar.md` | the client or guardian, when sessions happen at home |
| `photo_video` | `photo-video.en.md`, `photo-video.ar.md` | the client or guardian; optional; needed before any setup photo |

## Status: DRAFT, pending the lawyer

Written by the trunk session on 2026-09-03 at the operator's request, to be
used until the practice's lawyer approves a final wording. They are not legal
advice. Every file carries `status: draft` in its front matter and a visible
draft line at the top; the app shows that line to the person signing until a
version with `status: approved` replaces it.

**What the lawyer must confirm or fill in** (each marked `[square brackets]`
in the texts):

1. The practice's legal name, trade licence number, tax registration number
   and registered address (they live in owner settings; the texts show them).
2. Where personal data is hosted and the lawful basis for that transfer under
   the UAE Personal Data Protection Law (Federal Decree-Law 45 of 2021). The
   staging database is in India (Mumbai); production's region is not yet
   chosen. The texts say so plainly and the lawyer decides the wording.
3. That the "wellness, not medical" wording is right for a practice with no
   health-authority licence: no diagnosis, no treatment, no prescription,
   keep seeing your doctor.
4. Who may consent for a minor under UAE law, and whether the practice must
   check a document.
5. The cancellation, late-cancellation and unfit-to-attend fees, package
   expiry, and refunds, which the texts reference as "the practice's current
   terms" with amounts left in brackets.
6. Governing law and the dispute route.
7. The retention period (five years after the last activity, invoices as tax
   law requires) and the erasure exception for invoices and the audit trail.

## How the app uses these files

- The seed loads each file as a practice `document` of kind `consent_text`
  with its purpose, locale and version, so the consent step can name the
  exact text shown.
- The Arabic files are the text an Arabic-speaking client signs; they are
  faithful translations of the English, not summaries, and the lawyer's
  review covers both.
- Plain language, British English, no clinical vocabulary beyond what the
  law requires; a person at a kitchen table should be able to read it.
