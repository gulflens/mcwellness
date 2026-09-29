## Round 67 — the writer learns what the brain-map report draws (2026-09-30)

The brain-map report (the qEEG report the practice is bringing into the app,
`docs/SPEC/reports-qeeg.md` on pull request 227) draws score rings, band
icons, markers and diamonds; sets its Arabic headings apart by weight; and
prints brain maps far larger than they were captured. The shared document
writer could do none of the three. The report stream asked for them in
`docs/CHANGE-REQUESTS/reports-02.md`, request 1 (the writer) and request 2
(the font loader), and ordered them after round 65 because both edit the
writer. Round 65 has merged, and the writer is the trunk's, so the trunk
applies them here. Nothing in the report stream's own folder is touched.

### What the writer gains

- **A path** (`Op` kind `path`, with `PathSegment`, `Paint` and `Stroke`,
  exported from `domain/shared/document`). Moves, lines, cubic curves and a
  close; a fill, a stroke or both; a width, a cap and a join; the even-odd
  rule. One line in the content stream, inside its own `q … Q` as a rule and a
  rectangle are, so the colour it paints with dies at the `Q` and the text
  after it is drawn in the fill the writer last set. A path with no paint, one
  that does not begin with a move, or one with a number that is not finite is
  not drawn at all, as an image nobody supplied is not. The types are exactly
  the shape `domain/reports/qeeg/document/shapes.ts` already declares, so the
  report stream's change is an import and nothing else.
- **An optional bold Arabic face.** `FontSet` carries `arabicBold` when the
  caller has one; the writer draws bold Arabic in it, as `/F4`, and measures
  it with the same face. A set of three never selects it: bold Arabic is then
  drawn in the regular Arabic face, as it always has been.
- **Smooth resampling on an image.** `DocumentImage.interpolate`, written as
  `/Interpolate true` in the image's dictionary. It changes no pixel.

### What the font loader gains

`reportFonts()` beside `documentFonts()` in `app/api/billing/fonts.ts`: the
same three faces and IBM Plex Sans Arabic at 600, the weight the Latin bold is
already set in. A second function and not a wider first, because
`documentFonts()` sets every invoice, receipt and report already filed, and a
filed document is recovered by rendering it again and comparing its hash.

### What does not move

Every document already filed renders to the bytes it was filed as. The proof
is the tests that pin bytes, all unchanged and all green: the greyscale
content stream in `pdf.test.ts`, word for word, and the four invoice and
receipt goldens in `tests/billing/document.test.ts`. The fourth face is last
in the writer's list of slots, so a document that never draws it numbers its
faces and objects exactly as before; a document drawing only regular Arabic
renders to the same bytes from a set of four as from a set of three, which a
test asserts. An image with no `interpolate` writes the dictionary it always
wrote, which a test also asserts.

### Found on the way

The billing palette guard (`tests/billing/palette.test.ts`) lists every kind
of op and failed to compile the moment the writer gained a fifth — the check
doing its job. It now holds a path's paint to the same palette; the money
documents draw no path. `domain/reports/qeeg/document/scale.ts`, which also
lists every kind, compiled unchanged: its own local path type has the same
shape as the writer's.

### The tests

- `domain/shared/document/pdf.test.ts` — 55 (40 before): a path's exact line
  for a fill, a curve, a stroke with width, cap and join, each cap and join by
  number, fill and stroke together and under the even-odd rule; a path with no
  paint, no move or a number that is not finite, drawn not at all; the text
  after a path keeping its colour; a path not read back as text. Bold Arabic
  drawn as `/F4` from a set of four and as `/F3` from a set of three; regular
  Arabic never drawn in the fourth face; a document with no bold Arabic
  identical from either set; Latin in a bold Arabic line kept in the Latin
  bold face; bold Arabic measured by its own face. `/Interpolate true` written
  when asked and not otherwise.
- `tests/reports/report-fonts.test.ts` — 4, new, with the real fonts: the
  report faces are the document faces and a bold Arabic one; the document
  faces stay three; the set is read once; a bold Arabic word is drawn in the
  fourth face and copies off the page exactly as the regular one does.

`pnpm -s format` and `pnpm verify` green at the branch head (281 files, 3,581
tests, one skipped: the check of a built app, which this worktree has not
built). No database test was run here: nothing that reaches a database
changed, and CI's `verify-db` runs them.

### Every file this round touched outside the trunk's own paths

Two of billing's, riding in this round's pull request by the integrator's
widening for one round, as rounds 41, 51, 52, 58 to 61, 65 and 66 were
widened: `app/api/billing/fonts.ts` (`reportFonts`, beside and not touching
`documentFonts`) and `tests/billing/palette.test.ts` (the path case). The
trunk's own half is `domain/shared/document/pdf.ts`, `index.ts` and
`pdf.test.ts`, `tests/reports/report-fonts.test.ts` and the documents.

### Going live

**Merged is not live**, and nothing here needs a pass of its own: no screen,
route or document draws a path or asks for the fourth face until the report
stream's pieces do. It goes live with whatever pass carries them.