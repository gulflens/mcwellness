## docfix-01 — documents: names keep every letter, Arabic joined, figures the right way round (2026-10-15)

A quality round on the documents the practice issues. Six defects were
suspected on 29 September by reading the code
(`docs/CHANGE-REQUESTS/reports-02.md`, "Noted, not requested", items 1, 5
and 6, and three found beside them). Each was proved with a failing test
first, and every one reproduced. All six are fixed on branch
`fix/document-defects`, in one pull request.

**Two of the fixes are in the shared zone** (`domain/shared/document`,
`docs/SPEC/OWNERSHIP.md`). This file is the change request those edits
need. They ride in the round's own pull request, as rounds 41, 51, 52, 58,
59, 60, 61, 65 and 67 were widened, so the integrator can review them there.
The other files belong to the billing stream (`app/api/billing/fonts.ts`) and
the reports stream (`domain/reports/**`, `app/admin/reports/**`,
`tests/reports/**`).

### 1. A name lost every letter beyond Latin-1 (shared zone)

**What.** `app/api/billing/fonts.ts` loaded only the `latin` subset of IBM
Plex Sans, which stops at Latin-1. `domain/shared/document/pdf.ts` leaves out
any character its face cannot draw. So a name with ş, ğ, ł or š printed
without those letters on invoices, receipts and reports, and nothing said so.
A test that rendered an invoice and a receipt got back the name with those
letters missing.

**Change.**

- `FontSet` gains two optional faces, `regularExt` and `boldExt`. The writer
  draws a Latin character from one of them only when the regular or bold
  face has no glyph for it. Before this round, such a character was always
  dropped. The two faces are `/F5` and `/F6`, after the bold Arabic `/F4`. A
  page that never needs one embeds neither, so it renders to the same bytes
  as before. The four golden hashes in `tests/billing/document.test.ts` still
  hold.
- A space still joins the run before it, but only when that run's face can
  draw a space. The extended subset has no space glyph, so a space handed to
  it would be dropped and the gap would close.
- `undrawable(pages, fonts)` is new. It lists every character the pages hold
  that the writer would leave out, checked the same way the writer checks.
  `domain/reports/qeeg/document/unprintable.ts` now uses it instead of
  keeping its own copy of the face choice.
- `documentFonts()` loads `ibm-plex-sans-latin-ext-400-normal.woff` and
  `-600-normal.woff`. They come from the same package, which is already
  installed. No dependency is added and no font is fetched from a CDN.
- A test proves that every letter of Latin-1 and Latin Extended-A
  (U+00A0–U+017F) can be drawn at both weights.

### 6. Figures typed on an Arabic keyboard were drawn backwards (shared zone)

**What.** In `domain/shared/document/arabic.ts`, `isLeftToRight` did not list
U+0660–0669 or U+06F0–06F9. Inside a right-to-left line, "١٥" was drawn as
"٥١" (reports-02.md, noted 5).

**Change.** Both ranges now count as left to right. The Arabic decimal and
thousands separators (U+066B, U+066C) are neutral, like the comma and the
full stop, so "١٬٢٣٤٫٥" stays one figure.

### The other four (stream paths)

2. **Unjoined Arabic in session and progress reports**
   (`domain/reports/document/render.ts`; reports-02.md, noted 6). Some values
   were drawn left to right whatever language they were in: the labelled
   values, rating questions, observation words, a goal's description and
   status, and a comparison's measurement. A value now reads right to left
   when its first letter is Arabic. This is Unicode's first-strong rule.
3. **The progress report's brain-map comparison now matches the comparison
   view** (`domain/reports/gatherProgress.ts`). If units disagree, the report
   now refuses the whole comparison, as `compare` does
   (docs/SPEC/assessment.md section 5, rule 3). Before, it dropped only the
   one line. Differences are now rounded to six places, not three. This
   follows the reports spec, section 5: "the same figures … the comparison
   view shows". `tests/reports/comparison-agrees.test.ts` imports both
   functions and checks they give the same answer.
4. **The report editor's "today"** (`app/admin/reports/ReportEditor.tsx`) is
   now the practice's day in Dubai (`isoDateIn`), not UTC.
5. **The preview no longer always says "blocked".** With `noopener`,
   `window.open` returns null even when the tab opens. The editor now opens
   without it, cuts the opener by hand, and treats null as a real block. When
   that happens it offers the page as a link.

### What a filed document does now

A filed document is recovered by rendering it again and comparing the hash
(`app/api/billing/documents.ts`, `app/api/reports/get.ts`). If the file is
lost, a document that drew none of the characters above re-renders to the
same bytes as before. A document that did draw one can no longer be re-made
from its row, and the recovery route refuses it with `409
document_bytes_differ`. It does not overwrite the file. That document was
wrong: it was missing a letter, had a figure reversed, or had unjoined
Arabic. Three kinds of document can be affected:

- an invoice, receipt or report with a letter beyond Latin-1 in it;
- an Arabic report with a figure typed in Arabic digits in a right-to-left
  line;
- an Arabic session or progress report with an Arabic value in a column.

The stored file is unaffected. Only the recovery from a lost file is.

### Seen, not changed here

- The same defect as item 5 in eight more screens, four of them the
  household's, is answered in `docfix-02.md`.
- A progress report prints each figure to at most three places
  (`formatFigure`). The comparison screen prints the stored value. The two
  agree for any figure typed to three places or fewer. The review of this
  round found that a difference kept to six places could print "+0", so
  `formatDifference` now takes its sign from the printed figure.
- Items 2, 3 and 4 of reports-02.md's "noted" list (`%`, `+`, `@` and the en
  dash ordered right to left; the "about" sign; the isolated alef wasla) are
  not touched.
