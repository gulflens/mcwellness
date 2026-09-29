# SPEC — Brain-map (qEEG) reports

_Worktree: `reports`, owning `domain/reports/**`, `app/admin/reports/**`, `app/api/reports/**`, `db/policies/reports/**`, `tests/reports/**` and migrations `600–699` (`docs/SPEC/OWNERSHIP.md`). Builds on `reports-v1.md`, which it amends in two places (section 7 below), and on `assessment.md`, which it leaves as it is. The shared-zone changes it needs are `docs/CHANGE-REQUESTS/reports-02.md`. This file defines behaviour._

Status: **approved by the operator on 2026-09-29**, with five decisions recorded in section 18. **The wording is a draft** until the practice approves it, in both languages, and nothing is signed in a language that is still a draft (section 6). Written 2026-09-29.

---

## 1. Purpose

After a brain-mapping assessment the practice gives a household a written report: what was seen, what it may mean for the person, and what the practice recommends. Until now it has been written in a separate tool on the practitioner's own computer, which kept each report as a file there and knew nothing of the clients, visits or records in this system.

This piece brings that report into the system as a third kind of report, beside the session report and the progress report, and under the same three rules (`reports-v1.md` section 1): it is signed by a person, once signed it never changes, and it is a PDF filed like every other document.

It comes in two editions.

**A first report** describes what is seen at baseline: for each frequency band, whether activity is increased, reduced or within normal limits, and in which regions of the head.

**A follow-up** describes what has changed since an earlier report, and what the practice recommends next. Its choices are of a different kind — improved, unchanged, moved further from normal limits — and it carries one page the first report does not: the earlier brain maps beside the later ones, and the change by frequency band. The practice asked for it on 29 September 2026.

The layout is the practice's own and is kept: the score rings, the band icons, the cards, the order of the pages.

## 2. What exists on `main`, and what this adds

| Already built | This piece adds |
| --- | --- |
| Reports of two kinds, drafted, previewed, signed, numbered, filed, delivered and superseded (`reports-v1.md`) | A third kind, `qeeg`, through the same doors |
| A pure bilingual PDF writer that places text, straight rules and PNG images (`domain/shared/document`) | A layout layer of its own (section 12), and three additions to the writer, by change request |
| Brain-map assessments as figures per site and band, with a comparison of an earlier and a later one (`assessment.md`) | Nothing in `domain/assessment`. A report may quote a comparison; it never writes to one |
| The assessment's file door, which takes the mapping software's own files and refuses images on purpose | A door of the report's own for brain-map images (section 9) |
| The signer, the practice and the recipient snapshotted on the row at signing | The same. Nothing about who signs is typed |
| Approved standing sentences, quoted from the agreement a household signs (`domain/reports/document/strings.ts`) | The same sentences, printed in place of the old report's own closing paragraph |

## 3. Two editions

| | First report | Follow-up |
| --- | --- | --- |
| `edition` | `initial` | `follow-up` |
| `stage` | `initial` | `follow_up` or `final` |
| A band | a level, and regions | a change, and regions |
| Connectivity, asymmetry, phase lag | a level of its own kind, and regions | a change, and regions |
| Compared with | — | an earlier report of the same client, required |
| Dashboard | six scores | six scores, each with the earlier score beside it |
| The page of what has changed | — | yes |
| The closing section | the approach training begins with | the next stage of training |

**No name belongs to both editions.** A level of a first report is never a change of a follow-up, and each edition validates against its own lists, so a choice made in one cannot be read as a choice made in the other.

**Changing the edition of a draft maps nothing.** Every level or change is cleared and listed for the practitioner, regions are kept, and each band shows as unfinished until she chooses again. "Increased" does not become anything.

**What a follow-up is compared with** is chosen by the practitioner from the client's kept reports. The default is the client's first. The report records which it was, and whether it was the first or a later one, because the fixed wording says "initial" of the one and "previous" of the other. A draft, and a version that has been superseded, cannot be chosen.

**A `final` report is a follow-up** in every respect. _To be confirmed by the practice (section 18, point 3)._

## 4. What a report holds

`domain/reports/qeeg/types.ts` is the definition. In outline:

| Part | Holds | Typed or gathered |
| --- | --- | --- |
| The client | Arabic name, age on the day of the recording, sex | **Gathered** from the client's record on every save, and once more at signing. Never taken from the form |
| The recording | its date, eyes open or closed, handedness | Typed |
| Key findings, areas of focus, recommendations, benefits | what was ticked, by name, and what she added herself | Typed |
| Brain maps | each a stored document, by id and digest | Uploaded |
| The five bands; the three measures | a level or a change, and regions | Typed |
| The dashboard | six scores from 0 to 10, each with optional evidence | Typed |
| The summary | formatted text: bold and underline | Typed |
| The programme | the number of sessions; the approach or the next stage | Typed |
| The signer | — | **Not in the content.** Snapshotted on the row at signing, from the signer's credential |

Rules of the shape:

1. **Names, never positions.** A choice from a list is stored as the name of what was chosen.
2. **Anything typed sits under a key of its own, never in an array.** The audit trail shortens a long string inside an object and does not look inside an array (`audit.md`). A list of typed things keeps its order as keyed entries, each with its place.
3. **Unset is unset.** A score nobody set is empty, never 5. No score is signed unexamined.
4. **Strict.** An unknown key is refused by name.
5. **Typed once.** Each typed thing is her English and, if she gave one, her Arabic (section 8).

## 5. The lists

`domain/reports/qeeg/catalogue/ids.ts`. Ten findings, eleven areas of focus, nine regions, five bands, three measures, six dimensions, six recommendations, nine benefits; three levels and three approaches for a first report; five changes and six next stages for a follow-up; ten measures for the change table.

**The bands are the report's own.** Delta 1–4 Hz, theta 4–8, alpha 8–12, beta 12–25, high beta 25–30, as the practice reports them. `domain/shared/bands.ts` is a vocabulary for measurements, ends in gamma, carries no ranges, and is shared by sessions, ribbons and assessments. It is not touched.

**Regions are regions of the head**, as a household reads them. No electrode site is named, here or anywhere in a report.

## 6. The wording

Every fixed sentence, in English and Arabic, is in `domain/reports/qeeg/wording/`, one file per version. A stored report records the version it was written against.

1. **A draft until a person approves it, language by language.** `WORDING_STATUS` is a constant. The issue route refuses to sign in a language that is a draft. The pull request that carries the approved text is what turns it over, and a test that must be changed to do so makes sure it is never done in passing.
2. **An approved version is never edited.** A sentence that needs altering is altered in the next version's file, and a report already signed goes on printing the words it was signed with. Without this the check that a signed report renders again to the same bytes (`reports-v1.md` section 11) would refuse every report the first time a sentence was mended.
3. **The practice's own words, changed only where a word belonged to another kind of practice.** The practice is a wellness practice and the agreement a household signs says so. The handful of words changed, each sentence before and after, and the practice's approval of them, are in the wording sheet handed to the practice on 29 September 2026. They are not repeated here.
4. **The sentences that say what the practice is not** are the agreement's own, quoted by `domain/reports/document/strings.ts`, and are printed in place of the old report's own closing paragraph. A report and an agreement cannot then say two different things.
5. **The Arabic follows the terms of the pages a household has signed** (`docs/CONSENT/*.ar.md`), not the old tool's, where the two differ.
6. **What a test holds every sentence to:** both languages present; the same gaps to fill in both; no word of another kind of practice, in either language; Arabic without vowel marks; no sign the installed typeface cannot draw; no label in capitals; every bold mark opened and closed.

**No machine translation.** The old tool's call to an outside translation service is not carried across. The practice's standing rule is that such a service is never used on text written about a client (`docs/COMPLIANCE/approved-vendors.md`).

## 7. Judgement, and where it lives

`assessment.md` section 3.4 says that what a measurement means is the practitioner's judgement, written in a report and signed by a person. This is that report.

A level, a change and a score out of ten are judgements. They live in the content of a signed report and **nowhere else**. Nothing here is written to an assessment, and the assessment's refusal of any word beside a figure stands exactly as it is.

**This amends `reports-v1.md` in two places**, for the `qeeg` kind only:

- **Section 1.** The session and progress reports name a brain map as a measurement and a change between two as a difference between two days. A brain-map report also carries the practitioner's reading of it.
- **Section 5.** The session and progress reports name no bands. A brain-map report names the five frequency bands with their ranges, and regions of the head.

What does not change, for any kind: a report names **no electrode site, no protocol and no training threshold**, and describes no diagnosis.

## 8. Languages

**Fill once, sign in either.** There is one form. Fixed wording comes from the approved wording in the language of the report. What the practitioner types prints as she typed it, unless she added an Arabic version of it, which the Arabic report then prints.

**Each language is its own signed report**, with its own reference, because `reports-v1.md` gives a report one language and freezes it at signing. The second is made from the first:

1. She signs the report in one language.
2. "Sign the other language" makes a draft with the other locale, the same content, and the first report's brain maps.
3. In that draft only the other-language halves of typed text can differ. The server rebuilds everything else from the first report on every save, so two signed reports of one recording cannot disagree on a finding or a score.
4. It is previewed and signed through the ordinary door.
5. If the first is later superseded, the second is marked as out of step.

**The staff screens stay English.** The boxes in which she types an Arabic version are one named component, and the only file in the console allowed to set the direction of its text (`tests/lint/console-is-english.test.ts`, by change request).

## 9. Brain maps

A brain map is a picture the mapping software exported. It is uploaded against a draft, kept as a document of the client, and printed at the size it was given.

1. **A door of the report's own.** `PUT /api/reports/:id/figures`, drafts only. The assessment's file door refuses images on purpose and is not widened: a past record has no assessment to attach to, and a picture in a report must be frozen with the report.
2. **Normalised once, never again.** The browser decodes the file, trims a plain white border, flattens any transparency over white and encodes an 8-bit RGB PNG, which is the one kind the writer embeds. The server checks that what arrived is exactly that. From then on the bytes are never re-encoded.
3. **Never shrunk.** An image over a limit is refused with a sentence. Shrinking is how detail is lost without anyone deciding to lose it. Limits: 4,096 pixels on the longer side, 12 million pixels, 5 MiB, eight to a report.
4. **The practitioner is told how it will print.** A map is drawn as wide as its place allows and never more than two and a half times its own size. Below 220 dots to the inch the form says it will print a little soft; below 140, that it will look pixelated and is worth exporting again. The figure is worked out for the place the map is drawn in, which is not the same on a full page as in a pair.
5. **Frozen with the report.** While the report is a draft a map can be removed. When the report leaves draft its maps become immutable and the links to them admit no change.
6. **By id and digest.** The content records each map's document id and the SHA-256 of its bytes. The issue route checks every map is in the store and matches before it signs. The repair path refuses, by name, when a map has gone.
7. **Borrowed, not copied.** A follow-up's earlier maps, and a second-language report's maps, are links to the first report's stored documents.
8. **Erasure** removes the links and then the documents, under the same act as everything else of the client's.

## 10. The page of what has changed

A follow-up's own page, modelled on a one-page example the practice supplied as a guide.

| Part | What it holds |
| --- | --- |
| Headlines | up to two figures of her own, each with her caption, and the number of sessions completed |
| Before and after | the earlier maps beside the later ones, eyes closed and eyes open |
| Change by frequency band | the rows she chooses, from ten measures; a figure for eyes open and for eyes closed |
| Summary | her own |
| A note | where the figures came from |

1. **Every figure is optional.** A row or a headline left empty is not printed. The page works with pictures and words alone.
2. **A figure says where it came from.** `typed` is the practitioner's own estimate. `calculated` is arithmetic on two recorded assessments, and records which two.
3. **No figure is ever read off a picture.** There is no path in the code from the bytes of an image to a number, and there is not to be one.
4. **The note follows from the source.** A page of typed figures says they are the practitioner's approximate visual estimates and not a measure of change in function. A page of calculated figures says what they were calculated from. The practitioner does not choose the note.
5. **The server does the arithmetic.** A `calculated` figure in a request is discarded and worked out again. Only a `typed` figure is kept from the caller.
6. **Four measures can be calculated**: delta, theta, alpha and beta, which the assessment records. High beta and the narrower bands are typed until an instrument records them.
7. **Direction is a shape.** A figure that went down is marked by a triangle pointing down, in ink. Whether that is welcome is said in her summary and never by a colour the system chose.
8. **The comparison's own sentence** is printed beneath the figures, as on every comparison (`assessment.md` section 3.3).

Sessions completed are counted from the client's visits, and may be typed when some were elsewhere. The figure says which.

## 11. Past records

Reports written in the old tool are brought in so that a follow-up can be compared with one.

1. **Read in the browser.** The file is parsed there and never crosses the wire whole.
2. **She chooses the client.** The name, age and sex the file held are shown beside the client she picks, with a warning where they disagree with the record. They are never stored.
3. **Positions become names, once.** The old file counted its ticks by position. Fixed tables turn each position into a name, and a test pins every table in full.
4. **Kept, not signed.** A past record has the status `imported`. It is frozen. It has no reference, no signer's snapshot and no PDF, because it was printed once, by the old tool, in the old tool's words. It is invisible to the household and refused by deliver and by supersede. **It cannot be issued**: its fixed wording would be today's and not what the household received.
5. **Honest about what it could not carry.** Each thing the reader changed or dropped is recorded as a note naming the field, never what was typed: a score the old tool defaulted, a value with no name here, colour in the summary, the picture of a signature.
6. **The same file twice** for one client is refused.
7. **Kept against the wrong client**, it is withdrawn by an owner or a lead practitioner, with a reason: content cleared, maps removed, the stamp kept.
8. **What the old tool called a follow-up** is kept as a first-report edition that says it was a follow-up. The old tool offered only the first report's lists.

## 12. How it becomes a PDF

The writer is `domain/shared/document`. The layout is this piece's own, under `domain/reports/qeeg/document`, and is pure: given the same content, wording, fonts and images it gives the same pages.

1. **Blocks, measured, then placed.** The content becomes a list of blocks. Each is measured. The list is broken into pages, spare room is shared out before each section, and a fitted block is scaled to its room.
2. **What keeps a page whole:** a heading stays with what follows it; a paragraph splits between lines and leaves two on each side; a pair of maps, and a row of headlines, never split; the signature is lowered to the foot and never left alone on a page.
3. **The dashboard is scaled to fit**, and never below three quarters of its size. Below that it takes two pages, and the editor is told.
4. **Text is set even at its starting side.** There is no hyphenation and a narrow column stretched to both edges opens rivers. Setting it to both edges is built and off. _The practice chooses by eye from two sample pages (section 18, point 12)._
5. **Arabic is a right-to-left page, not a mirrored English one.** Pieces are written once in terms of start and end. A figure, a range, a telephone number and an address inside an Arabic line are drawn left to right, in order.
6. **One typeface**, the system's own, with a bold Arabic face added to the writer by change request. No slanted face: Arabic has none.
7. **Colour.** Ink and two greys; the brand violet as the one accent; the band hues on the band icons; the three status hues on the score rings. No colour in text a person typed.
8. **No label in capitals, no middle dot as a separator.**
9. **The signature block is text**: a rule, the signer's name, certification, certifying body and certificate number, from the snapshot.
10. **What it tells the editor**, beside the pages: how many pages, the scale the dashboard was drawn at, anything that ran over, any character the typeface could not draw, and how sharply each map will print.

**Two rules of `docs/DESIGN-BRIEF.md` give way for this document**, because the operator's decision keeps the practice's layout (section 18, decision 2):

| The brief | This report |
| --- | --- |
| A line of under 75 characters (sections 4.5 and 6.4) | About 95 to 100, at the geometry kept |
| Tables, not cards | Cards, as in the report a household knows |

**Rendered on the server**, as every document is. The preview opens in a new tab, in either language. The security policy refuses to show a document inside a frame, and that is not loosened for this.

**The rules of the page, as the first review corrected them (2026-09-29).** Each is held by a test that failed before it was mended.

| Rule | What it says |
| --- | --- |
| A figure is a figure | Figures typed on an Arabic keyboard are figures and not letters. They are drawn left to right, as ops of their own, and never handed to the writer inside a right-to-left op, which would turn "15" into "51" |
| A range keeps its order | Every unbroken run of figures and the signs between them is one left-to-right run, however it was spaced when typed |
| An underline is its own words' | One rule for each unbroken run of underlined words on a line, in the paint of that run. Words between two underlined phrases are not underlined |
| A carried block is placed afresh | A block moved to the next page is placed there by the same rules as any other, and a fitted block is fitted to the room it really has |
| A fitted block never grows | Sharing out spare room may make a fitted block smaller and never larger |
| A fitted block takes a fresh page before it overflows | When it cannot shrink into the room left, and the page holds other things, it moves on and is fitted there |
| A split makes progress | A block is split only when its first part has height and its second is shorter than the block it came from |
| A number is a number | A height, a width or a limit that is not finite is refused by name. What a person supplied is answered with a value and never thrown |

**Known limits, accepted.**

1. **A change of weight inside one Arabic word** breaks the joining of its letters at the change, because the writer shapes each run on its own. A formatted summary that makes half a word bold is rare. It prints, and reads oddly.
2. **Vowel marks** are placed roughly. The fixed wording carries none. What a practitioner types may.
3. **The same bytes, from the same place.** A signed report renders again to the bytes it was filed as when it is rendered where it was rendered, on the server. The last digit of a sine is not promised to agree between two engines, and the writer keeps two decimals, so a coordinate on a rounding boundary could differ elsewhere. The filed PDF is the record. The repair path refuses a render that differs from it; it never serves one.

## 13. Data owned

| Migration | Contents |
| --- | --- |
| `602` | adds `qeeg` to `report_kind` and `imported` to `report_status`; adds `twin_of_id`, `compared_with_id`, `imported_from`, `source_sha256` and the withdraw stamps, all empty by default. **Names neither new value** |
| `603` | the rules that name them: an imported row is unsigned and has a source; the guard admits the one withdraw; `app.keep_imported_report` |
| `604` | `report_figure`, its guard, and the functions that borrow and remove |
| `972` (trunk) | `app.erase_client` reaches `report_figure` |

A value added to an enum cannot be used in the transaction that added it, and the runner gives each file one transaction. Hence 602 adds and 603 uses.

`report_figure` is `audited: client`. Policies are declarative in `db/policies/reports/`. No `client_contact` policy grants a read of it.

## 14. Routes

All under `/api/reports`, behind the same fence and the same permissions as the two kinds that exist.

| Route | Does |
| --- | --- |
| `POST /draft` | saves a `qeeg` draft: gathers the client, recomputes calculated figures, validates, refuses a save made over a newer one |
| `GET /:id/preview?locale=` | renders the draft in either language; prints the draft-wording line while the wording is a draft |
| `POST /:id/issue` | refuses what is incomplete, a language still in draft, a map that is missing; gathers the client once more; signs |
| `POST /:id/supersede` | carries what it is compared with, its twin and its maps to the new draft |
| `PUT /:id/figures`, `DELETE /:id/figures/:figureId` | a draft's maps |
| `POST /:id/twin` | the draft in the other language |
| `GET /qeeg/prefill` | an empty follow-up, with the earlier scores and maps brought forward and every judgement left for her |
| `POST /qeeg/import`, `POST /:id/keep-import`, `POST /:id/withdraw-import` | past records |

## 15. Screens

`app/admin/reports/qeeg/`, from the shell's own components.

Twelve sections, in the order of the report, one open at a time unless she opens them all. Each says how much of it is left to fill. A follow-up adds what it is compared with, at the top, and the page of what has changed.

**Saved at rest points**: on moving to another section, thirty seconds after the last change, before a preview, a signing, an upload or leaving, and with a button. Each save writes a row to the audit trail, which is why it is not saved on every keystroke.

## 16. Rules (pure functions in `domain/reports/qeeg`, each tested)

1. `validateQeegContent` — the shape of section 4, refused with the field named.
2. `missingForIssue` — what a report needs before it can be signed. A blank report of either edition needs twenty-six things.
3. `bandSentence`, `measureSentence`, `regionPhrase`, `sessionLabel` — every generated sentence, built from the wording and from nothing else.
4. `switchEdition` — what is kept, what is cleared, and that nothing is mapped.
5. `changeNoteKey` — the note that follows from where the figures came from.
6. `readLegacyReport`, `fromQuillDelta` — a past record, and what could not be carried.
7. `prefillFollowUp` — what is brought forward, and every refusal: another client's report, the same report, a later one, a draft, a record that has been erased.
8. `classifyScoreChange` — whether a score is higher, lower or steady. **The rule is the practice's to set** (section 18, the last point).
9. `paginate`, `breathe`, `fitBlock` — pages, from blocks.
10. `runsOf` — what is drawn in which direction.
11. `layoutParagraph`, `splitParagraph` — lines, from typed text.
12. `placeImage`, `printQualityOf` — how large a map is drawn, and how sharply it prints there.
13. `trimWhiteBorder`, `flattenOverWhite`, `encodePng` — a picture, made ready without losing a pixel.

## 17. Deliberately left out

- **Machine translation.**
- **A picture of a signature.** A signed report is tied to the person who signed it by their credential.
- **Colour and slant in the summary.**
- **A preview beside the form.**
- **A chart of any figure.** `assessment.md` section 3.3 holds.
- **Any reading of a figure from a picture.**
- **Retiring the old tool.** It goes on working. That is the practice's decision and another day's.

## 18. Decisions

**Taken by the operator on 2026-09-29:**

| | Decision |
| --- | --- |
| 1 | The report keeps its findings, levels and scores, and speaks in the practice's own words. The practice approves the wording before anything is signed |
| 2 | The layout is kept; the typeface is the system's |
| 3 | One form; each language signed as its own report |
| 4 | Past reports are brought in |
| 5 | Change figures are typed by the practitioner now, and calculated when the mapping software's figures can be brought in |

**Standing, and not reopened:** no translation service on text about a client (operator, 2026-09-09); nothing personal in this repository.

**With the practice, on the wording sheet of 2026-09-29. Each stands as written here until answered:**

| | Point | Default |
| --- | --- | --- |
| 1 | The words of section 6, point 3, may change as shown | yes |
| 2 | The agreement's sentences stand in place of the old closing paragraph | yes |
| 3 | A `final` report works as a follow-up | yes |
| 4 | A follow-up uses the first report's lists of findings, areas of focus, recommendations and benefits | yes |
| 5 | A follow-up prints the earlier score beside the new one | yes |
| 6 | Scores start empty | yes |
| 7 | Sessions completed are counted from visits, and may be typed | yes |
| 8 | No picture of a signature | yes |
| 9 | Direction is a shape and not a colour | yes |
| 10 | The follow-up summary's opening is printed every time | yes |
| 11 | The label for sex stays as the practice has it | yes |
| 12 | Text is set even at its starting side | yes |
| — | When a change in score counts as a change | any difference |

## 19. Done when

1. A first report is drafted, previewed in both languages, signed, and renders again to the same bytes, with its maps.
2. A second-language report is made from it, and the two cannot be made to disagree on a finding or a score.
3. A follow-up is compared with a first report, brings its scores and maps forward, and prints the page of what has changed with typed figures, with some, and with none.
4. A past record is brought in, reviewed, kept, and chosen as what a follow-up is compared with. It cannot be signed, sent or seen by the household.
5. A report is refused signing while its wording is a draft in that language.
6. No rendered page, in either language, holds a word of another kind of practice beyond the agreement's own standing sentences; a test reads every page and says so.
7. On every page, in both languages, nothing leaves the margins and nothing overlaps.
8. A map is embedded at the size it was given, without loss, and the form says how it will print.
9. An invoice and a report already filed render to the bytes they were filed as, after the writer's additions.
10. An erasure removes a client's reports' maps.
11. The household's screen lists a brain-map report as it lists the others.
