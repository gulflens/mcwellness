# The practice's own software takes the readings: the app's go dormant

**Date:** 13 September 2026, 18:39 on the operator's clock, +04 (14:39 UTC). **Status:** design approved by the operator; spec for review.

## Why

The practice uses professional-grade software for brain mapping and for
neurofeedback, running on a Windows laptop the practitioner carries as part of
the equipment. The operator's instruction of 13 September: the session recording
is the practice's software's job, not this app's. The app's own reading
capability goes **dormant — contained, not removed**, because it may be
developed later. What reaches the app instead is the professional software's
**result, as an uploadable file**.

## What the app actually does today, which is less than it sounds

**There is no reading engine to contain.** The app has never measured anything.
`docs/SPEC/session-capture.md` section 3.3 says so in as many words —
"entered manually **or from the amplifier's export** (Phase 1: manual entry **of
the vendor software's numbers**; Phase 2: file ingest)" — and section 9 lists
"amplifier file ingest, live signal streaming, real-time supervision" as out of
scope. `steps.ts` types a `Reading` as "a reading typed off the amplifier's own
software".

So what exists is a practitioner **transcribing three things** off the vendor's
screen into the visit: signal quality per site, artefact percent, and time in
reward percent. That is the whole of it, and that is what stops.

**Half the receiving end already exists.** `PUT /api/assessments/:id/file` is
described in its own source as "the door the equipment's own export goes
through". `domain/assessment/fileType.ts` already names three accepted kinds —
`vendor_pdf`, `edf_recording`, `native_recording` (`.eeg`) — and
`app/admin/assessments/ExportFiles.tsx` already has a working file input that
uses it. **Brain maps can be uploaded today and need no work.**

The gap is the neurofeedback visit: a `session` has no export.

This round is therefore not a reversal of the design. It is section 9's Phase 2,
for the half that lacks it.

## Decisions already taken

| Decision | Choice | By |
|---|---|---|
| At the visit | **Drop the three numbers; attach the software's export instead** | operator, 13 Sep |
| Which device | **The Windows laptop only** — it runs the professional software and this app; the phone leaves the practitioner flow | operator, 13 Sep |
| Who attaches, when | **The practitioner, at the visit** — the file is already on the machine they are standing at | follows from the device |
| What dormant means | **A switch in Settings › Practice, shipped off**; code, tests and columns all stay | operator, 13 Sep |
| The desk layout | **Not this round** — see "Not in this round" | Claude, agreed |

## The design calls this spec makes

> **Corrected during execution, 14 September.** This section originally said the
> switch lives on a `practice` table. There is no such table: the practice IS
> the `tenant` row, and `905_practice_identity.sql` — whose name misleads — puts
> the practice's identity, its licence and its `vat_registered` flag on `tenant`.
> The column is `tenant.record_readings`. Everything else below stands.

**The switch is one practice-wide boolean, not a per-service one.** `record_readings`
on the practice, default `false`. Per-service was offered and declined: today the
answer is the same for every service, and a decision made five times is five
chances to be inconsistent. When a future service genuinely differs, a
per-service override can be added over the top of a practice default without
migrating anything.

**Off is the shipped default, and that is a data decision as much as a UI one.**
The column defaults to `false` so a newly bootstrapped environment behaves the
way this practice works, rather than inheriting a behaviour nobody wants and
having to be corrected. `docs/CHANGE-REQUESTS/what-production-never-got.md`
records what a fresh environment silently lacks; this must not join that list.

**Dormant means unreachable, not deleted, and the tests prove it stays.**
`SignalStep`, the reading panel in `RunStep`, `scoreSignalQuality`,
`deriveObservationFlag` and the `reading` and `telemetry_chunk` event shapes all
remain, with their tests running. A guard test asserts the components still
exist and are still covered, so "dormant" cannot quietly decay into "rotted".
What changes is that the visit's step sequence does not include them while the
switch is off.

**A session's export mirrors the setup photo exactly.** `session` already carries
`setup_photo_document_id uuid references public.document (id)` (migration 302),
so a file on a visit is a solved problem in this schema. The export takes the
same shape: a second nullable reference to `document`, the same storage key
helpers in `domain/shared/storage.ts`, the same audit path. Inventing a second
way to attach a file to a session would be the defect here, not the feature.

**The export is optional and never blocks check-out.** A practitioner standing in
someone's home must always be able to close the visit. A missing export is a
visible state on the record — the client's session list marks which visits still
lack one — not a gate. This follows the existing rule that
`domain/session/canCheckIn.ts` gates entry and nothing gates exit.

**The same three file kinds, and no new ones.** `vendor_pdf`, `edf_recording`,
`native_recording`. The signature check in `domain/assessment/fileType.ts`
already exists and is already tested; the session route reuses it rather than
re-deriving what an EDF looks like. If the practice's software exports something
else, that is a data question to answer with a real file in hand, not a guess.

**Turning readings off costs nothing downstream, and this was checked rather
than assumed.** The artefact, reward and signal figures are read only inside
`domain/session/` — `scoreSignalQuality.ts`, `types.ts`, `events.ts`,
`replayEvents.ts`. No report, chart or comparison reads them.
`app/api/reports/gather.ts` takes its brain-map figures from the `assessment`
table and says so ("Brain maps and nothing else"), and
`app/admin/assessments/Comparison.tsx` imports from `@domain/assessment`. Both
keep working, because brain maps keep being uploaded. The only loss is the
session's own internal signal score, which nothing outside the session module
consumes.

## Shape

Four pull requests on one branch.

### Pull request 1: the switch

The migration adding `record_readings boolean not null default false` to the
practice, in the trunk's own range; the field through
`app/api/practice/schema.ts` and its route; the control in Settings › Practice
with wording that says why it is off. Tests: the default is false on a fresh
bootstrap, the round-trip through the route holds, and an existing practice is
unaffected by the migration.

### Pull request 2: the visit without readings

`steps.ts`'s sequence becomes a function of the switch. With readings off, the
signal-check step is absent and `RunStep` renders the timer and the End button
without the reading panel. `SignalStep`, the panel, and every domain function
behind them stay in the tree with their tests. A guard test asserts they are
still imported by something and still covered, so dormancy cannot rot into rot.
Tests: the sequence with the switch on is exactly today's; with it off the two
steps are gone and nothing else moved; a session that already holds readings
still renders them.

### Pull request 3: the export on a session

The migration adding a second nullable `document` reference to `session`, in the
session stream's range, mirroring `setup_photo_document_id`. The upload route,
mirroring `PUT /api/assessments/:id/file` including its signature check and its
audit row. The attach control on the Summary step. The missing-export marker on
the client record's session list. Tests: the three accepted kinds are accepted
and a fourth is refused; a missing export never blocks check-out; the document
row and the storage key match the setup photo's conventions; erasure sweeps the
export as it sweeps every other client document.

### Pull request 4: the record and the change request

`docs/SPEC/session-capture.md` sections 3.3, 3.4 and 9 amended to say the
readings are dormant and why, with the switch named. The change request in
`docs/CHANGE-REQUESTS/` for the shared-zone and cross-stream edits.

## Not in this round

**The practitioner app's desk layout.** The operator has moved the practitioner
from a phone to a Windows laptop. `docs/DESIGN-BRIEF.md` section 6.1 specifies
that app as phone-first — "dark ground, single column, one decision per screen",
a "56px primary action in thumb zone", the runner "full-bleed" — and
`.claude/rules/ui.md` repeats it. None of that is right for a laptop on a table.
It is a real piece of design work, it contradicts a written brief, and folding
it into this round would hide it. It gets its own round and its own decisions.

**Reading the numbers out of the uploaded file.** Offered and declined for now:
it means parsing the vendor's format, which needs real exported files in hand.
If the practice later wants the figures searchable and chartable without typing,
this is the path, and the switch built here is what it would turn back on.

**The brain-map side.** Already works. It will be walked end to end to confirm
that, and changed only if the walk finds something.

## Risks stated

| Risk | What holds it |
|---|---|
| Dormant code rots — it stops compiling or its tests are quietly dropped | A guard test asserts the components and domain functions still exist and are still covered; `pnpm verify` runs them every time |
| A fresh environment ships with readings ON and nobody notices | The column defaults to `false`; a test asserts it on a bootstrapped practice |
| A practitioner cannot close a visit because the export will not upload | The export never gates check-out; a missing one is a marker on the record |
| The practice's software exports a format none of the three kinds admit | Answered with a real file in hand, not guessed; the signature check refuses cleanly rather than storing something unreadable |
| The visit loses numeric outcomes and something downstream breaks | Checked, not assumed: those figures are read only inside `domain/session/`; reports and comparisons take theirs from `assessment` |
| The laptop move silently makes the practitioner UI wrong | Named as out of scope in this spec rather than absorbed, so it is a decision rather than an oversight |
