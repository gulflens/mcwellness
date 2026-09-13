## Round 49 — the readings go dormant, and a visit takes an export (2026-09-13)

### Why the round happened

The practice runs its brain mapping and its neurofeedback on professional
software, on a Windows laptop the practitioner carries as part of the
equipment (the operator, 13 September 2026). The session recording is that
software's job, not this app's — so the app's own reading capability goes
**dormant, contained rather than removed**, because it may be developed
later, and what reaches the app instead is the software's own exported
result, as a file attached to the visit.

There was no reading engine to contain. The app has never measured
anything: `docs/SPEC/session-capture.md` section 3.3 always described its
figures as "manual entry of the vendor software's numbers", and what stopped
is a practitioner transcribing three numbers off that software's screen.
Half the receiving end already existed — `PUT /api/assessments/:id/file` is
"the door the equipment's own export goes through" for a measurement, and
`domain/assessment/fileType.ts` already named the three kinds a file from
this equipment can be. The gap this round closed was the neurofeedback
visit: a `session` had no export of its own.

### What landed in the shared zone

**The switch.** `db/migrations/918_practice_records_readings.sql` adds
`tenant.record_readings boolean not null default false` — one practice-wide
switch, off by default so a newly bootstrapped environment behaves the way
this practice works rather than inheriting a behaviour nobody wants
(`docs/CHANGE-REQUESTS/what-production-never-got.md` is the list this must
not join). Who may write it needed no policy of its own:
`app.guard_tenant_identity` (migration 905) is a before-update trigger on
the whole `tenant` row with no column list, so an owner or an admin already
governs it. `app/api/practice/schema.ts` and `routes.ts` carry the field
through `GET`/`PATCH /api/practice`, optional on the write so a caller that
omits it leaves the switch as it stands; Settings › Practice
(`app/admin/settings/PracticeDrawer.tsx`, `settings.css`) puts the control on
the screen with wording that says why it is off. `app/api/create-api.ts`
gained the export door's raw-body exemption, body-size cap and timeout
budget, sharing both numbers with the assessment file door rather than a
second pair that could drift apart — the same equipment, the same three
kinds of file, the same sizes. `tests/db/practice-identity.test.ts` proves
the default is `false` on a fresh bootstrap, and
`tests/lint/dormant-readings-stay-alive.test.ts` is the guard: it reads the
repository statically, on every commit, and fails if `SignalStep.tsx`, the
reading panel, `scoreSignalQuality`, `deriveObservationFlag`, or the
`reading`/`telemetry_chunk` event shapes stop being wired into a file that
runs or covered by a test that runs — whether or not the switch is on for
anyone today. `docs/superpowers/plans/2026-09-13-readings-dormant.md` and
`docs/superpowers/specs/2026-09-13-readings-dormant-design.md` are this
round's own design record.

### Every file this round touched outside the trunk's own paths, by stream

**`session-capture`** (`domain/session/**`, `app/therapist/session/**`,
`app/api/sessions/**`, `db/policies/session/**`, `tests/session/**`,
migrations `300–399`) —

- `app/therapist/session/steps.ts`: `stepsFor(recordReadings)` makes the step
  sequence a function of the switch; `signal` is present or absent, nothing
  else moves.
- `app/therapist/session/CheckInPage.tsx`, `PreflightStep.tsx`,
  `RunStep.tsx`, `SessionRunner.tsx`, `schema.ts`, `outbox/store.ts`: the
  value a visit opened with rides with it end to end — the live services
  answer for a fresh check-in or a server-confirmed resume, the device's own
  outbox note for an offline one — frozen once at the moment a visit starts
  running rather than re-read later, so a slower answer arriving after a
  resume decision can never flip a switch beneath a visit already in
  progress, and a declined resume offer stays declined.
- `app/therapist/session/SummaryStep.tsx`, `ExportStep.tsx` (new),
  `ExportStep.test.tsx` (new): the attach control on the Summary step, and
  the missing-export marker moved into the check-out dock itself — the dock
  is sticky and the page is not, so the fact and the last chance to act on it
  sit together. The button arms before it confirms (RunStep's own control,
  for the same reason: the tap cannot be undone), and it is never a gate —
  the second tap is always there, checking out with no export and no signal
  included.
- `app/api/sessions/export.ts` (new): `PUT /api/sessions/:id/export`, the
  same door as the assessment file route under a second name — the same
  three kinds decided from bytes, the same digest check, the same
  after-commit put, the same audit row — refusing a closed visit, another
  practitioner's visit, and a second export once one is already filed, and
  idempotent on the digest so a retry after a dropped connection is repaired
  rather than duplicated.
- `app/api/sessions/checkin.ts`, `close.ts`, `schema.ts`, `session-row.ts`,
  `service-types.ts`, `service-types.test.ts`: the export route mounted
  beside the others; `recordReadings` published on
  `GET /api/sessions/service-types` from `tenant.record_readings`;
  `exportDocumentId` added to `CloseResponse` and to `SessionRow`, read but
  never gated on.
- `db/migrations/307_session_export_document.sql`, in this stream's own
  range: `session.export_document_id`, mirroring
  `setup_photo_document_id` exactly, and `app.file_session_export`, the
  security-definer door that files it against the caller's own open visit.
- `tests/session/CheckInPage.test.tsx`, `SessionRunner.test.tsx`,
  `db/export.test.ts` (new): the switch's effect on the sequence and on a
  resume, the three accepted kinds and a fourth refused, a missing export
  never blocking check-out, and the freeze proved before an erasure's
  `on delete set null` runs against a closed visit.

**`client-record`** (`app/admin/clients/**`) —

- `app/admin/clients/DocumentsTab.tsx`: one label,
  `session_export: 'Session export'`, so a filed export displays in the
  household's Documents tab like every other document on the record. Nobody
  uploads one from this tab — `domain/client/documentKinds.ts` does not list
  it, and that module already refuses a kind it does not know — this is
  display only.

Nothing in those paths is the trunk's beyond this round.

### The two migrations, and which half of the trunk's range 918 sits in

**Migration 918** (`db/migrations/918_practice_records_readings.sql`) is the
trunk's, in the **900–949** half of its own range. It alters `tenant`, a
core table, so per `docs/SPEC/OWNERSHIP.md` line 109 it must sort *after*
every stream's range and may be built on by none of them — the shape for a
migration a stream may depend on, never the reverse. This corrects the
round's own plan and spec, both of which cited migration **964** (the
950–999 half, for a trunk migration that builds on a stream's own table,
such as `invoice`, `appointment` or `session`) before execution caught the
error: `964` would have sorted after `session-capture`'s range on a fresh
database, but nothing in this switch depends on `session` or any other
stream's table — it depends only on `tenant` (migration 010) and
`app.guard_tenant_identity` (migration 905), both of which are the trunk's
own. It was renamed to `918` mid-round, and the rename is recorded in its
own commits (`58e045b`, `833544d`, `88f896d`) rather than by silently editing
history.

**Migration 307** (`db/migrations/307_session_export_document.sql`) is
`session-capture`'s own, in that stream's `300–399` range — an ordinary
stream migration, needing nothing from the trunk's 900s beyond what the
stream already had (`app.current_actor_id`, from migration 100).

### One correction the plan made and execution caught

The plan and the design spec both described the switch as living on a
`practice` table. There is no such table: the practice **is** the `tenant`
row, and `905_practice_identity.sql` — whose own name is what misled the
plan — is where the practice's identity, its licence and its VAT
registration already live, on `tenant`. The column is `tenant.record_readings`,
and every reference to a `practice` table in the round's own documents is
now corrected in place, dated, rather than rewritten as though the mistake
never happened (`docs/superpowers/specs/2026-09-13-readings-dormant-design.md`
carries the correction inline).

A second correction, caught the same way: the plan named a per-client
session list in `app/admin` as the place a missing export would be marked.
No such screen exists in this codebase. The marker went where a screen does
exist — the practitioner's own Summary step, in the check-out dock itself —
and `exportDocumentId` now rides on `CloseResponse` and on `SessionRow`, so a
real per-client list is one field away whenever `client-record` builds one,
rather than a screen invented here to hold a marker that belongs to a
stream this round does not own.

A third: migration 960 (9 September) retired the setup photograph and, on
security grounds, took away the one exception that had let a closed visit
admit a late change — "a closed visit now admits no change at all". The
plan did not name this, and it means an export can never be attached after
check-out. The missing-export prompt is therefore not a gate anywhere in
this round; it is the check-out dock's own last chance, with the
arm-then-confirm second tap described above, and `PUT /api/sessions/:id/export`
answers a closed visit with 409 `session_closed` rather than pretending the
door is still open.

### No policy file, no new dependency

`db/policies/**` is untouched: `app.guard_tenant_identity` already restricts
the switch to an owner or an admin, and the export door is a security-definer
function reached through `app/api/sessions/export.ts` rather than row
security of its own, in the shape `app.file_assessment_document` already set.
`package.json` and the lockfile are untouched.

### Synthetic data used throughout

Every fixture this round touched draws its names from `db/seed/names.ts` and
its ids from the reserved ranges (`.claude/rules/testing.md`); no Emirates ID
or phone number outside `784-1900-*` / `+971 50 000 xxxx` appears in any file
this round wrote.

### Checked, not claimed

This task wrote documents only and changed no code. The six test files its
own claims lean on most directly were re-run to confirm rather than assumed:
`tests/lint/dormant-readings-stay-alive.test.ts`,
`app/api/sessions/service-types.test.ts`, `app/therapist/session/ExportStep.test.tsx`,
`tests/session/CheckInPage.test.tsx`, `tests/session/SessionRunner.test.tsx` and
`app/admin/settings/PracticePage.test.tsx` — 110 tests pass across all six.
The database tests under `tests/session/db/export.test.ts` and
`tests/db/practice-identity.test.ts` were not re-run here, for want of this
worktree's own Postgres instance; both were exercised by the fix round's own
gates before this task began.
