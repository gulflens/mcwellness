## docfix-03 — documents in the client's language, English or Arabic, never both (2026-10-15)

The operator decided this on 15 October 2026: no document the app produces
may carry both English and Arabic. A report, an invoice and a receipt are each
in the client's language, and never in both on the same page. This round
builds that. It is stacked on `fix/document-defects` (docfix-01 and docfix-02).

### What changed, by stream

**Shared zone. This file is the change request for these edits.**

- `domain/shared/document/mirror.ts` is new, with its test, and is exported
  from the barrel. `mirrorPages` takes a page laid out left to right and
  turns it into the same page right to left. An Arabic document is drawn this
  way: it is laid out once, in Arabic words, with the English page's
  geometry, and then mirrored.
- `domain/shared/sending.ts`: the message sent with an invoice or receipt is
  in one language. `Sendable` gains `locale`.
- `docs/SPEC/reports-v1.md` section 5 records the decision, and so does
  `docs/SPEC/billing.md` section 5.6.

**Reports stream.**

- `domain/reports/document/single.ts` is new. It lays out session and
  progress reports in one language.
  - Everything fixed is in the report's language: labels, headings, dates,
    the standing sentences, the comparison's sentence and the folio.
  - The practice is named by its legal name in that language. If it has no
    Arabic name, the English one is used.
  - An Arabic report is the English page mirrored.
  - Two new word sets were added: `GOAL_STATUS_WORDS` and `SEX_WORDS`. The
    sex words are the brain-map report's approved pair. The goal-status
    Arabic is new: نشط, تحقّق and متوقّف. **The operator should check it.**
- Reports issued before the decision stay in both languages.
  - When a report is issued, the issue route writes `layout: 'single'` into
    the draft's content before signing it.
  - `documentFrom` treats an issued report without that mark as `bilingual`.
  - `render.ts` still draws such a report exactly as before, so if its file
    is lost, the rebuilt file matches the stored hash.
- New drafts default to the client's `preferred_locale`.
  - This applies to session, progress and brain-map drafts.
  - Both gather routes return `preferredLocale`.
  - The editor's picker starts on it, and staff can still change it before
    issue.
  - A saved draft that does not state a language keeps the one it has.
- The message a report is sent with is in the report's language.
- Brain-map reports were already in one language: each language is its own
  report, a twin. They are not changed.

**Billing stream.**

- **Migration `413_document_locale.sql`**, in the billing range.
  - It adds `invoice.locale` and `payment.locale`. Both are nullable and have
    no default.
  - A before-insert trigger fills the column from the writer's value, else
    from `client.preferred_locale`, else English. This covers every writer,
    including the triggers.
  - A before-update trigger refuses any change to the column.
  - Existing rows stay null. A null row is drawn in both languages, exactly
    as it was filed.
- `domain/billing/document`: every block of the round-65 design gains a
  one-language path. The design keeps its violet header, cards and TOTAL
  DUE/PAID block.
  - Each line is shown by its name in the document's language.
  - Amounts stay "AED 700.00". Dates use the Arabic month names the code
    already holds.
  - A document without a locale takes the old code path unchanged. The four
    golden hashes still hold.
- New Arabic labels for the payment card, the receipt rows and the footer,
  which until now printed English only:
  - اسم الحساب (Account name)
  - رمز SWIFT / BIC
  - الطريقة (Method)
  - المرجع (Reference)
  - هاتف / البريد / الموقع (the footer's P / E / W)

  These are labels, not legal wording. **The operator should check them.** No
  sentence was written. Every sentence on these documents already existed in
  both languages.

### Owed when PR 253 merges

PR 253 (`points/stage-2`, not merged) adds a "draft the session report from
the visit" route. That route gathers the visit and inserts the draft with
`locale: 'en'` written in. Whoever merges both pull requests should change
it to `await clientPreferredLocale(db, clientId)` (`app/api/reports/gather.ts`),
in both the gather call and the insert. Then a draft started from a visit
also opens in the client's language.

### Swept, and found already in one language

- Erasure letters: there is one template per language, chosen from the
  client's preferred language.
- Consent and wording sheets: there is one file per language.
- The brain-map report: twins, as above.
- The portal invitation: the screen copies one of two editions.
- Push notifications and the erasure WhatsApp draft: written per person's
  language.

### Judged out of scope

- **The expo poster**: English only, for a public stand, with no client.
- **The accounting and enquiry CSV exports**: staff-facing. Their headings
  are English, as the console is. A name in a cell is data.
- **Console screens**: English only, unchanged (`tests/lint/console-is-english.test.ts`).
- **The PDF's title metadata** (the browser tab): stays English. PDF
  literal strings in this writer are ASCII-escaped, and the title appears on
  no page.

### What a filed document does now

- A document issued before 15 October 2026 renders in both languages, exactly
  as before. A lost file is still rebuilt to its hash.
- A document issued after the change renders in its one language, and so does
  its rebuild.
- The only documents that cannot be rebuilt are those docfix-01 already
  named.
