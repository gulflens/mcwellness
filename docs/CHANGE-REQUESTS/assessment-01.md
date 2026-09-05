# assessment-01 — the shared-zone changes piece ten's assessment stream needs

**Status.** Authorised by the integrator on 2026-09-06 and, under the cost
rules of `docs/HANDOVER.md` section 6, applied in the piece's own pull request
rather than a separate trunk round — the precedent `client-portal-05.md` set
for piece seven and `session-capture-04.md` for piece eight. The builder edits
the paths below for this piece only, and each edit is listed in the
pull-request body under "Shared-zone changes".

**Spec.** `docs/SPEC/assessment.md`, sections 3, 6, 7 and 8.

---

## 1. `docs/SPEC/OWNERSHIP.md`

The `assessment` row gains `db/policies/assessment/**`, which every other
worktree's row already names and which section 6 of the spec records as an
omission rather than a decision. Beside it, a widening note for this piece,
naming items 2 to 7 below, in the shape the notes for pieces seven and eight
take.

## 2. `app/api/create-api.ts`

`ASSESSMENT_FILE_LIMIT_BYTES` (20 MB) and one exemption from the 64 KB body cap
and from `jsonOnly`, for `PUT /api/assessments/:id/file` and nothing else —
matched by **method and path together**, exactly as `isPhotoUpload` is at the
head of pull request 73, so every other method on that address stays a plain
404 with a 64 KB envelope. The route group is mounted after the authentication
fence, beside `mountKit`.

Why: spec section 7.1. The Documents tab cannot carry a vendor's export —
`MAX_DOCUMENT_BYTES` is 45 KB inside a 64 KB JSON body — and a PDF report with
its pictures in it is megabytes. The route itself accepts one media type,
checks the bytes against it and recomputes the digest the caller declared
(`app/api/assessments/file.ts`).

## 3. `app/admin/clients/ClientDrawer.tsx`

The Assessments tab's mount point, and nothing else in that file: one entry in
`ALL_TABS` between Documents and Timeline, one `TabPanel` rendering
`<AssessmentsTab clientId={client.id} />`, and the import. `FINANCE_TABS` is
untouched, so finance does not see the tab — which is the same answer
`db/policies/assessment/access.sql` gives underneath it.

Why: spec section 3.1. The file is `client-record`'s
(`docs/SPEC/OWNERSHIP.md`).

## 4. `db/seed/**` and `tests/db/seed.test.ts`

The generator of spec section 6: three synthetic clients each get a baseline
brain map, a re-map ninety days later and one questionnaire total, every figure
from `db/seed/random.ts` under the fixed seed, and **no file seeded at all** —
an export is a vendor's own PDF and there is no synthetic one to invent.

Touched: `db/seed/generate.ts` (the `SeedAssessment` type, the generator, a
local `addDays` beside `isoDate`, and `ageOn` imported rather than only
re-exported), `db/seed/apply.ts` (the insert, the synthetic-id check and
`describeSeed`'s order), and `tests/db/seed.test.ts` (the row count, the shape
of what is seeded, that every payload validates against the instrument's own
declared shape, and that no word is attached to any figure).

## 5. `db/migrations/106_erase_assessment.sql` and the confirmation letter

`app.erase_client` extended under a `to_regclass('public.assessment')` guard
exactly as 105 guards the visit tables: the link rows go first (the foreign key
to `document` has no `on delete`, so step 6 would otherwise raise on the first
household that ever had an export filed), then `condition_note` and
`supersede_reason` are cleared, and the summary gains `assessmentsCleared` and
`assessmentFilesUnlinked`. **The files go and the figures stay.**

Why in the client record's range: `app.erase_client` lives there (migrations
100, 104, 105), and spec section 6 says both requests ship in the round that
ships the first assessment, not later.

**The letter.** Spec section 6 names `domain/client/erasureLetter.ts` as where
the sentence must change. It is not: that file renders a template and the
practice's own words live in `docs/CONSENT/erasure-letter/en.md` and `ar.md`,
which is where the sentence was actually amended — the sentence that covers
sessions now also names the files from a brain map or a questionnaire, and the
sentence that says the measurements stay now also names a brain map's figures
and a questionnaire's total. Both files move to `0.3-draft`. Nothing in
`domain/client/erasureLetter.ts` itself needed to change, and it was not
touched. `tests/assessment/db/erasure.test.ts` reads the real templates and
asserts both sentences in both languages.

## 6. `domain/shared/audit-narrative.ts` and its test

Sentences for the new rows and actions, both languages: `assessment` and
`assessment_document` as entity labels; a first recording told apart from a
correction by the row's own `version`; an erasure's clearing of the words
beside a measurement; a read, a listing and a refusal; the file filed
(`assessment.file_filed`, which arrives doubled as the setup photo's does); and
a file attached or removed. The test is edited with it, because every other
sentence in that file is asserted in its own test and a new one is no
different.

## 7. `domain/shared/actor.ts` and its test

Three actions the routes need, in the pattern every other route group follows:
`assessment.read` (the owner, an admin, the lead practitioner and a
practitioner — never finance, never a client contact), `assessment.record` (a
practitioner, never an administrator: section 7.2 lets an admin file an export
and lets nobody who did not take a measurement say that they did), and
`assessment.file` (the reading audience, admin included).

---

## Written and **not** applied: the column differences to `docs/SPEC/00-data-model.md`

Spec section 6 says these are recorded here and not applied to the model, so
`docs/SPEC/00-data-model.md` is untouched by this piece. Migrations 500 and 501
implement them.

| Change to `assessment` | Why |
| --- | --- |
| `supersede_reason text`, required when `version > 1` | Every other append-only entity requires a reason; section 4 omits it here by oversight, and `client_protocol` is the precedent. Without it the record says a figure changed and never says why. |
| `condition_note text` null | Recording conditions, beside the typed fields and never instead of them (CLAUDE.md rule 3). |
| `reference_age_years int` and `reference_sex sex_at_birth`, both null | The age and sex the equipment's software made its comparison against, snapshotted. A birthday and a corrected record both move the live answer; the comparison that was actually made does not. |
| `raw_document_id` dropped in favour of **`assessment_document`** | One brain map produces several files — an eyes-open recording, an eyes-closed recording, the software's own report. One column forces a choice and loses the rest. |
| **No `session_id`** | The honest link is to `session`, in the 300 range, and apply order across ranges is not fixed. A `95x` trunk migration is where that link belongs, once both ranges are on `main`. |

**A note on the composite key, for whoever answers the model.** Section 6 asks
for "a composite key binding the document to the assessment's own client, the
pattern `billing_document` (407) already sets". Half of it is exactly that:
`assessment_document (tenant_id, assessment_id, client_id)` references the
assessment's own three columns, so a link can never claim a client the
assessment does not have. The other half — binding that client to the
**document's** — cannot be a foreign key, because `document` carries no
`(tenant_id, id, client_id)` unique key to point one at and adding one is an
alter of a core table, which is the trunk's. Migration 501 uses a guard trigger
for that half instead, refusing a link that names a document filed against
anybody else. If the trunk would rather have the key, `document` needs
`unique (tenant_id, id, client_id)` in a `9xx` migration and the trigger can go.

---

## Requests, not edits: things this piece found and did not do

1. **`bytesMatchMimeType` belongs in `domain/shared`.** It lives in
   `domain/client/fileSignature.ts`, and `docs/SPEC/OWNERSHIP.md` rule 3
   forbids one module importing another module's `domain/` — the two streams
   before this one made the same note rather than the same import
   (`app/api/sessions/photo.ts`, `app/api/appointments/create.ts`). So this
   piece has its own five-byte PDF check in `domain/assessment/fileType.ts`,
   with a comment saying why, and the request is that the shared question move
   to a shared place. Spec section 10, decision 3 already assumes it: "a new
   file signature is a change request to `domain/client/fileSignature.ts` in
   the trunk", which no stream but `client-record` can act on today.
2. **The link from a measurement to the visit that produced it**, as a `95x`
   trunk migration once the 300 and 500 ranges are both on `main` (spec
   section 6). Nothing in this piece assumes it.
3. **A flaky test in `tests/session/db/photo_and_routing.test.ts`**, found by
   this piece's CI run and **not caused by it**. "is idempotent on the same
   digest and refuses a different one" intermittently sees the second `PUT
   /api/sessions/:id/photo` answer 201 where it expects 200 — the second call
   files a photograph rather than finding the first one. It reproduces about
   one run in three to five on a laptop, and it reproduces the same way with
   `origin/main`'s own `app/api/create-api.ts` restored in place of this
   branch's, which is how it was ruled out as this piece's doing; five clean
   runs on the untouched file, then a failure, then six clean runs. When it
   passes, the first `PUT` answers 201 with a document id every time, so the
   suspicion is that the second request occasionally does not see the link
   `app.file_setup_photo` wrote — the route writes the row, then the bytes,
   then the link, and the link is the last of the three. It is
   `session-capture`'s file and `session-capture`'s route, so this is a request
   rather than a fix (`docs/SPEC/OWNERSHIP.md` rule 1).

