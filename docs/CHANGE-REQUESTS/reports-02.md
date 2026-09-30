# reports-02 — the shared-zone changes the brain-map report needs

**Status.** Requested on 2026-09-29. **Nothing here is applied by this pull
request**, which carries the specification and this request and no code. Each
item is applied in the pull request that needs it, listed there under
"Shared-zone changes", under cost rule 6 of `docs/HANDOVER.md` section 6 and
the precedent of `reports-01.md`.

**Spec.** `docs/SPEC/reports-qeeg.md`. The plan was approved by the operator on
2026-09-29.

**Order matters for one item.** Request 1 edits
`domain/shared/document/pdf.ts`. Pull request 223 (round 65, the invoice
redesign) is open and edits the same file: it adds a `rect` op to the `Op`
union and changes `num()`. **Request 1 is written on top of 223 and is not
started until 223 has merged.** Its `rect` op already covers the cards, label
bars and table fills this report would otherwise have asked for, which is why
they are not asked for here.

---

## 1. The document writer — `domain/shared/document/pdf.ts`

Three additions. Every one is additive: a document already filed renders to
the bytes it was filed as, and `pdf.test.ts` goes on asserting
`GREY_STREAM_BEFORE_COLOUR` word for word.

| # | What | Blocks |
| --- | --- | --- |
| 1a | A `path` op | score rings, band icons, bullets, direction markers |
| 1b | An optional bold Arabic face | weight in the Arabic report |
| 1c | `interpolate` on an image | how a brain map prints |

### 1a. A path op

**What.**

```ts
export type PathSegment =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z'];
export type Paint = { grey?: number; rgb?: readonly [number, number, number] };
export type Stroke = Paint & {
  width?: number;
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
};
// a new member of Op
| { kind: 'path'; segments: readonly PathSegment[]; fill?: Paint; stroke?: Stroke; evenOdd?: boolean }
```

One line in the content stream, inside its own `q … Q`, as a rule is:
`m`, `l`, `c` and `h` for the segments; `w`, `J` and `j` for the stroke; `f`,
`S` or `B` to paint, `f*` or `B*` when `evenOdd`.

**Why.** The writer strokes straight rules and, after 223, fills rectangles.
The report's figures are circles, arcs, a wave, diamonds and triangles.

**What does not move.** The rule, image, rect and text branches are not
edited. `extract.ts` reads lines that set a font and show text; a path line is
neither.

**A path with nothing to draw is skipped**, as an image nobody supplied is: no
fill and no stroke, no leading `M`, or a number that is not finite.

**Tests.** The exact line for each paint, cap and join; a skipped path; text
after a path keeps its fill colour.

**The types exist already**, declared in
`domain/reports/qeeg/document/shapes.ts` so the layout could be built before
this request was applied. Applying it is a change of import there and nothing
else.

### 1b. A bold Arabic face, optional

**What.** `FontSlot` gains `'arabicBold'`. `FontSet` carries it as optional.
`runsOf` and `measure` choose it for an Arabic glyph when the style is bold
and the set has it, and the regular Arabic face otherwise, as today.

**Why.** Bold Arabic draws in the regular weight today, silently. In the
Arabic report a heading and an inline label are told from body text by weight
and by nothing else. The installed package already ships the weight.

**What does not move.** A set of three faces never selects the fourth. The new
face is `/F4`, after the three that exist, and is embedded only on a document
that draws it.

### 1c. Smooth resampling on an image

**What.** `DocumentImage.interpolate?: boolean`, written as
` /Interpolate true` in the image's dictionary.

**Why.** Without it a printer repeats each pixel of a brain map as a hard
block. With it the same pixels are resampled smoothly. It changes no pixel.

**What does not move.** Absent, the dictionary is the one written today.

### Not asked for

- **A group transform.** The dashboard is scaled to fit by arithmetic on the
  numbers of each op, in the layout, so every op stays flat and a test can
  measure where things finally land.
- **An underline.** One rule to a line, drawn by the layout.
- **A slanted face, letter spacing, a JPEG.**

## 2. The font loader — `app/api/billing/fonts.ts` (billing's)

**What.** `reportFonts()` beside `documentFonts()`, returning the same three
faces and the bold Arabic one, cached on its own.

**Why a second function and not a wider first.** `documentFonts()` feeds every
invoice and report already filed. A face added to it would change what they
render to, and the repair path would refuse them.

## 3. The figure door — `app/api/create-api.ts`

**What.** `PUT /api/reports/:id/figures` is exempted from `jsonOnly` and given
a body limit of 5 MiB and a timeout of 60 seconds, as the assessment's file
door is given its own.

**Why.** It is the one report route that reads bytes a caller uploaded.

## 3a. The import's body limit — `app/api/create-api.ts`

**What.** `POST /api/reports/qeeg/import` takes the same 512 KiB body limit
as `POST /api/reports/draft`, beside it in the body-limit table (records
PR 10). A past record's content is a draft's content.

## 4. The route-mount test — `tests/db/route-mounts.test.ts`

**What.** The kinds a report may be gain `qeeg`; cases for the new mounts, so
a future edit that drops one fails loudly.

## 5. The English-only console — `tests/lint/console-is-english.test.ts`

**What.** `app/admin/reports/qeeg/atoms/ArabicVersionField.tsx` joins `ALLOWED`.

**Why.** The practice's decision is one form, signed in either language
(`reports-qeeg.md` section 8). The practitioner may add an Arabic version of
what she typed, and a box for Arabic must say it is Arabic for a screen reader
to read it as Arabic. One component does that for every such box. Every label
around it stays English.

**Why not `dir="auto"` with no language**, which the guard's patterns would
pass. It would hide the exception from the guard that exists to see it, and
lose the language.

## 6. Permissions — `domain/shared/actor.ts`

**What.** `report.import`, for an owner and a lead practitioner. Figures and
second-language drafts use `report.draft`, which exists.

## 7. The audit's sentences — `domain/shared/audit-narrative.ts`

**What.** Sentences for `report.figure_filed`, `report.figure_removed`,
`report.imported`, `report.import_kept` and `report.import_withdrawn`; and,
for the second-language report (added 30 September, from the review of
records PR 9), `report.twin_started` ("{actor} started this report in the
other language", with its Arabic) and `report.twin_refused`, joined to the
case `report.supersede_refused` and `report.deliver_refused` already share.
`report.import_refused` joins that case too (records PR 10).
Until then the timeline shows these actions' raw codes in both languages.

## 8. One comparison rule — `domain/shared/compare.ts` (new)

**What.** `refusePair`, `difference` and `pairByKey`, with
`domain/assessment/compare.ts` and `domain/reports/gatherProgress.ts`
re-pointed to them.

**Why.** Two comparisons exist and disagree. `compare()` refuses a pair whose
units differ and rounds to six places; `compareBrainMaps()` skips such a pair
without a word and rounds to three. A third, for calculated change figures,
would be one more to drift. This is asked for with stage 9 of the plan and
blocks nothing before it.

## 9. Erasure — migration `972` (trunk's range)

**What.** `app.erase_client`, restated from 971, with a step that removes a
client's `report_figure` rows before the documents they point to, under a
`to_regclass` guard, and clears `source_sha256`.

**Why.** A link to a document must go before the document. It must sort above
971, which is the highest restatement on `main`.

## 10. The household's screen — client-portal's

| File | Change |
| --- | --- |
| `app/api/portal/schema.ts` | the kinds a report may be gain `qeeg` |
| `app/api/portal/reports.ts` | the same |
| `app/client/ReportsScreen.tsx` | a third name for a report, where there are two |
| `app/client/i18n/dictionary.ts` | that name, in both languages |

**Why, and why in the same pull request as migration 602.** The portal reads a
report's kind from a closed list of two. The first brain-map report signed
would make the household's list of reports fail to load. Nothing in the
reports code would say so.

## 11. Document kinds — `domain/client/documentKinds.ts` (client-record's)

**What.** `report_figure`, as a kind the system writes and nobody uploads by
hand. Whether the Documents tab lists it is client-record's to say.

## 11a. A household does not read a brain map's document row — `db/policies/client/readers.sql` (client-record's)

**What.** In `client_record_readers` on `public.document`, the client-contact
arm of the client branch becomes
`(app.actor_has_role('client_contact') and app.actor_is_contact_of(client_id) and kind <> 'report_figure')`.

**Why.** Migration 604 grants a household no read of `report_figure`, but the
document row each link points at is the client's and so falls under this
policy's contact arm: a household can read its metadata (kind, size,
digest), never the bytes. Corrected 30 September by the review of records
PR 10: the premise that no route serves a household documents was wrong.
`/api/clients/:id/documents` and its `/link` admit a client contact, so a
household could list and open a brain map. **Applied in the records branch
itself** (the policy arm above, and the same exclusion in the two routes),
not left for later. Nothing was exposed in production: `report_figure`
rows exist only once 604 is released.

**Test.** A client contact reads no `document` row of kind `report_figure`
and still reads the client's other documents as before.

## 12. The records of the change — trunk's

| File | Change |
| --- | --- |
| `docs/SPEC/00-data-model.md` | the kind, the status, the columns of 602 and the table of 604, written and not applied |
| `docs/SPEC/OWNERSHIP.md` | a widening note for this piece |
| `docs/COMPLIANCE/data-inventory.md` | two classes of data: brain-map images, and the practitioner's written reading |

---

## Noted, not requested

Found in the writer while measuring the installed faces. Each is worked round
in the layout. None is asked to be changed here.

1. A character the installed face cannot draw is dropped without a word. The
   loader reads the `latin` subset only, so a name with a letter outside it
   loses that letter, on an invoice as on a report. The layout reports such a
   character to the editor before a report is signed.
2. `%`, `+`, `@` and the en dash are ordered as right-to-left characters
   inside a right-to-left op. The layout draws a figure, a range, a telephone
   number and an address as ops of their own.
3. The sign for "about" has no glyph in any installed subset. The wording says
   it as a word.
4. An isolated alef wasla maps to a form the face does not have.
5. Figures typed on an Arabic keyboard (U+0660 to U+0669, and U+06F0 to
   U+06F9) are reversed inside a right-to-left op, so "15" is drawn as "51".
   The face carries the glyphs, so nothing is dropped and nothing says so.
   Found by the first review of the layout, with the input and what was
   drawn. The layout now draws them as ops of their own. An invoice or a
   report that prints a figure typed that way inside an Arabic line is
   exposed to it today.
6. In the Arabic edition of the session and progress reports, some values in
   Arabic are drawn without the right-to-left flag
   (`domain/reports/document/render.ts`, the `labelled` values, the rating
   labels and a goal's description). Read from the code. Not seen on a page.
