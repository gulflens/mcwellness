# assessment-01 — the shared-zone changes piece ten's assessment stream needs

**Status.** Authorised by the integrator on 2026-09-06 and, under the cost
rules of `docs/HANDOVER.md` section 6, applied in the piece's own pull request
rather than a separate trunk round — the precedent `client-portal-05.md` set
for piece seven and `session-capture-04.md` for piece eight. The builder edits
the paths below for this piece only, and each edit is listed in the
pull-request body under "Shared-zone changes".

**The spec's own status line** — `docs/SPEC/assessment.md`, "approved by the
operator on 2026-09-06 with `docs/PLAN/piece-ten.md`, and amended in the build"
— **was written at the integrator's instruction**, in the brief this piece was
built from, and the operator's approval it records is real. It points at this
file for the amendments, which are the items above and the six defaults below.

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

**And the clock, added in the fix round** (review gap 1).
`ASSESSMENT_FILE_TIMEOUT_MS` (two minutes) and `requestTimeoutMs`, the one
place either budget is chosen. `timeout` races the whole handler and the body
read is inside it, so the ten seconds every other path keeps asked for better
than 16 Mbit/s sustained and the door the cap exists for could not be used at
all — the upload died at ten seconds whatever the practitioner did. Two minutes
asks for about 1.4 Mbit/s. It is a longer budget rather than an exemption,
because a request with no clock on it is a transaction held open for as long as
somebody cares to dribble bytes at it; the real bound stays the body cap.
Matched by method and path exactly as the cap is, and
`tests/assessment/request-timeout.test.ts` proves every other method on that
address and every other path in the API keeps the ordinary ten seconds.

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

## Defaults taken beyond the spec

Six, all of them the builder's rather than the operator's, recorded here
because the spec's own status line points at this file for the amendments the
build made.

1. **The questionnaire.** No instrument is named anywhere in the practice's
   own material, and several of the seven `00-data-model.md` section 9 lists
   are proprietary, so the mechanism ships exercised by one synthetic
   instrument, `questionnaire.sample` — three questions, nought to four, no
   category and no cut-off. The operator names the real one and it arrives as
   one declared shape and one scoring function.
2. **A questionnaire's certification gate.** A brain map needs a valid
   certification for the `brain-map` service. A questionnaire has no service of
   its own in the catalogue, so the gate asks only that the person holds some
   valid `can_execute_session` credential. That is the floor rather than a
   considered answer, and it is the one to revisit when a questionnaire becomes
   a thing the practice charges for.
3. **Where the recording happened — taken, then reversed in the fix round**
   (review gap 6). The request carried a delivery mode, used for the
   `home_visit` gate and never stored, defaulting to `home`. The word was the
   caller's own: `studio` or `remote` walked past that gate with no fact on the
   server to check it against, and no column on the row says where a
   measurement was taken. The field is gone from the request schema and from
   the drawer, and the `home_visit` agreement is now asked for **every**
   recording, because the brain map is a home service in the catalogue —
   ninety minutes, in the household.
4. **The context function.** Section 7.2 says to read the gates from
   check-in's own door. `app.checkin_context` (301) answers about a visit
   booked *today*, because checking in only makes sense at the door of one, so
   it would refuse every assessment typed up afterwards and the spec's sentence
   is unsatisfiable as written. Migration 500 has `app.assessment_context`
   instead, in the same shape and asking the same questions: the same three
   consent purposes, active and not expired; the same Dubai-zone arithmetic for
   whether the client is a minor; the same re-reading of the credential's dates
   at the moment of writing. **The spec's sentence should be amended to say
   so.**
5. **The composite key** binds the link to the assessment's own client as 407
   does; the document half is a guard trigger, because `document` has no
   `(tenant_id, id, client_id)` key and adding one is the trunk's. The note
   below sets out what the trunk would need for the key to replace it.
   **Answered: the trunk added the key** in round 31 — migration
   `911_document_client_key.sql` — and migration
   `502_assessment_document_key.sql` replaced the trigger with the foreign key.
   501 was not edited and the deny case reads the same SQLSTATE it always did.
6. **The erasure letter's words** live in `docs/CONSENT/erasure-letter/`, not
   in `domain/client/erasureLetter.ts` as section 6 says; item 5 above records
   where they were actually amended and why nothing in that file needed to
   change.

---

## An amendment to spec section 7: what the lead practitioner reaches

Section 7 gives a correction to "the recording practitioner, or the lead
practitioner", and names no condition on the second. The build read the lead's
reach as every other practitioner's — the client on their own schedule, ninety
days back and thirty forward — so a lead who had not visited a household inside
that window could not put right a figure in its record, and could not type up a
measurement they took on the ninety-first day. That is the opposite of what an
oversight role is for.

**The reading, settled by the integrator in the fix round** (review gap 12):
a lead practitioner reaches every client of the practice for recording and for
correcting, as they already do for reading. `db/policies/assessment/access.sql`
says so — `app.actor_has_role('lead_practitioner') or
app.client_visible_to_practitioner(client_id)` — and `refusalsForRecording`
reads the same answer from `app.assessment_context`, whose `visible` has always
admitted the three oversight roles by role rather than by schedule.

**What does not move with it.** The own-row half of the same policy: the row
still names the lead's own practitioner row, so a correction says who is
answerable for the new figures and nobody records a measurement in another
person's name. The certification, which `app.assessment_context` asks for the
assessment's own service at the moment of writing, because a new version is a
recording. And the household's consents, asked the same way. An admin is still
refused outright: they may file an export against a measurement somebody
recorded, and may not say that they took one.

Proved off the schedule, with the certification and without it, in
`tests/assessment/db/routes.test.ts` and at the table in
`tests/assessment/db/rls.test.ts`.

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

**A note on the composite key, for whoever answers the model.** *(Answered in
the trunk's round 31: `document` now carries `document_tenant_id_client_key`
and migration 502 uses it. The note stands as the reasoning.)* Section 6 asks
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

1. **`bytesMatchMimeType` belongs in `domain/shared`.** **Answered: the trunk
   moved it** in round 31 of `docs/CHANGE-REQUESTS/trunk-notes.md`, which
   closes this item. `domain/shared/fileSignature.ts` is where it lives now,
   `domain/client` re-exports it so no caller moved, and this piece's own
   five-byte copy is gone — `bytesAreAPdf` asks the shared question and
   `domain/assessment/fileType.ts` keeps only the practice's own decision about
   which media type an export may be. What follows is the request as it was
   raised.

   It lives in `domain/client/fileSignature.ts`, and `docs/SPEC/OWNERSHIP.md`
   rule 3 forbids one module importing another module's `domain/` — the two
   streams before this one made the same note rather than the same import
   (`app/api/sessions/photo.ts`, `app/api/appointments/create.ts`). So this
   piece has its own five-byte PDF check in `domain/assessment/fileType.ts`,
   with a comment saying why, and the request is that the shared question move
   to a shared place. Spec section 10, decision 3 already assumes it: "a new
   file signature is a change request to `domain/client/fileSignature.ts` in
   the trunk", which no stream but `client-record` can act on today.
2. **The link from a measurement to the visit that produced it**, as a `95x`
   trunk migration once the 300 and 500 ranges are both on `main` (spec
   section 6). Nothing in this piece assumes it. **Answered: the trunk built
   it** in round 31 — migration `951_assessment_session.sql` — which closes
   this item. The column is `assessment.session_id`, nullable, bound to the
   assessment's own client by a composite foreign key onto a new client-scoped
   key on `session`, so a measurement can never name another household's
   visit. The recording route and the drawer name the visit; a correction
   carries it forward.
3. **`app/api/_middleware/audit.ts` refuses about one document id in eighty,
   and the filing fails with it.** **Answered: the trunk fixed it** in round 30
   of `docs/CHANGE-REQUESTS/trunk-notes.md`, which closes this item and item 4.
   What follows is the report as it was raised. This is the trunk's file, so it
   was a request and not a fix — but it is a live fault rather than a tidiness
   point, and it is the reason `tests/session/db/photo_and_routing.test.ts` had
   been failing about one run in three to five on this branch's CI and on a
   laptop with `origin/main`'s own `app/api/create-api.ts` restored.

   `refuseContactDetails` reads any run of nine to twelve digits beginning with
   a nought — with spaces, hyphens and brackets allowed inside it — as a
   telephone number, and throws. The hyphens are the trouble: **1.21 per cent
   of `randomUUID()` values contain such a run** (measured over 100,000 ids;
   `eea04325-2317-4f6b-ada3-dd3a345ade00` is one, on the run `04325-2317-4`).
   The file's own comment reasons about `00000000-0000-4000-8000-0000000000e6`,
   a seeded id of thirty-four digits, and is right about that one; a random id
   with letters in it breaks into shorter runs, and some of those read as a
   number.

   So any route that passes a fresh document id through `logAction`'s details
   throws about one call in eighty. The throw rolls the whole request back:
   `PUT /api/sessions/:id/photo` (`app/api/sessions/photo.ts`, which passes
   `{ documentId }`) answers 500, files nothing, and a device that retries with
   the same digest files afresh rather than being handed the first one — which
   is exactly the shape of that test's intermittent failure, "expected 201 to
   be 200". In production it is a practitioner's setup photograph failing to
   file, at random, with no reason anyone can act on.

   **The fix belongs in the helper**: a value that is a uuid is not a way to
   ring anybody, and the digit-run check should say so — either by excluding a
   uuid-shaped value before scanning it, or by refusing to treat a run that
   contains a hyphen-separated group of four hexadecimal-looking characters as
   a number. This piece's own file door works around it by not passing the id
   at all (`app/api/assessments/file.ts`; the `assessment_document` row it
   writes is itself audited and its `new_values` name the document), so nothing
   here waits on the answer. `app/api/sessions/photo.ts` does wait on it.

4. **`tests/session/db/photo_and_routing.test.ts` is intermittently red**, and
   item 3 is why: "is idempotent on the same digest and refuses a different
   one" sees the second `PUT` answer 201 where it expects 200, because the
   first threw at `logAction` after the link was written and rolled it back.
   It reproduces about one run in three to five on a laptop, including with
   `origin/main`'s own `app/api/create-api.ts` restored in place of this
   branch's, which is how it was ruled out as this piece's doing. It goes when
   item 3 does. It is `session-capture`'s file and `session-capture`'s route,
   so this is a request rather than a fix (`docs/SPEC/OWNERSHIP.md` rule 1).
