## Round 51 — the sessions that happened before the app (2026-09-16)

### Why the round happened

The owner asked, more than once, to "go back to previous dates on the
calendar and manually log sessions for my current client, so their full
session history and progress is accurately recorded in the app from before
we officially start using it". Nothing in the repository recorded the
earlier conversation, and nothing could do it: the only path that creates a
`session` is the practitioner's phone check-in, which refuses a past date
three times over — a fifteen-minute device-clock window
(`app/api/sessions/checkin.ts`), `app.checkin_context`'s "booked today" in
SQL (migration 961), and the route's own today-clamped appointment lookup.

Decisions the owner took on 16 September, before this round was built: the
calendar's three roles log one from the day schedule; it takes a package
credit if one is available, otherwise the form refuses unless the visit is
marked settled before the app, which charges nothing; never an invoice at
today's price for a day that has passed; its own pull request, after the
expo's. The design is `docs/superpowers/specs/2026-09-16-past-sessions-design.md`.

### What landed in the shared zone

**One appointment and one session, as a live visit is.** The day schedule
lists appointments; the household's portal lists past appointments; the
report and assessment pickers list completed sessions. A row in only one
table would be invisible somewhere, so the route writes both in one
transaction and everything that reads either sees it.

**Migration `966_session_from_records.sql`**, trunk second half: it alters
`session` (session-capture's table) and replaces
`app.billing_on_session_completed` (billing's function), so it sorts after
both. `session.recorded_from` (`device` | `records`) and
`session.settled_outside_app`, the second only ever true on a `records` row
by constraint. The billing function gains one branch ahead of 404's body,
which is carried word for word the way 957 carries 953's: a `records` row
settled outside charges nothing and writes nothing; one not so marked takes
the oldest credit valid on the visit's own day, and if there is none the
insert is refused with `restrict_violation`, so nothing is written and no
invoice is invented. A `device` row runs 404's body unchanged;
`tests/billing/db/consumption.test.ts` still passes untouched.

**`domain/shared/actor.ts`**: `session.record_past`, the shape of
`appointment.create` — the calendar's three roles, and the named
practitioner's own credential valid on the visit's day, resolved by the
route. **`domain/shared/audit-narrative.ts`**: the sentence for
`session_recorded_from_records`, in both languages.

**Documents**: `docs/SPEC/session-capture.md` sections 4, 8 and 9 (amended
in place), `docs/SPEC/00-data-model.md` (the `session` entry),
`docs/SPEC/OWNERSHIP.md` (the widening above), the design record, and this
note.

### Every file this round touched outside the trunk's own paths, by stream

**`session-capture`** — `domain/session/pastSession.ts` (new) with its test
and the barrel: the floor of 2024 and the ceiling of today, the visit's two
instants from a day, a clock time and a length in the practice's zone, and
the gate, the check-in gate's shape without the instrument checks and with
the office's actor rule. `app/api/sessions/from-records.ts` (new): the
route. `app/api/sessions/schema.ts`: its request, its refusal codes, its
answer. `app/api/sessions/checkin.ts`: the mount, one line.
`tests/session/db/from_records.test.ts` (new): the route through the API on
the synthetic practice — the happy path with its credit and its audit row;
the visit showing on the day schedule and in the assessment picker; the
refusal with no credit, nothing written, and the settled path beside it;
tomorrow, a year before the practice, and no reason; a practitioner's
device and a practitioner not certified on that day; a withdrawn consent;
an overlap.

**`scheduling`** — `app/admin/schedule/LogPastSessionDrawer.tsx` (new): the
booking drawer's own steps from the same options door, asked for the
visit's day, plus a length, how it was paid for, and why. `SchedulePage.tsx`:
"Log a past session" in the toolbar for a day before today, the drawer's
slot, and the reload. `tests/scheduling/LogPastSessionDrawer.test.tsx` (new)
and `SchedulePage.test.tsx`.

**`billing`** — `tests/billing/db/from_records.test.ts` (new): the trigger's
branch at the table itself — a credit valid on the visit's day, nothing for
a settled visit, the refusal, the constraint that keeps a device row from
saying settled, a credit since run out still covering a visit it was valid
for and one not yet valid refusing, the row policy refusing a practitioner's
own `records` row, and a device row charged exactly as before.

**`session-capture`, one policy file** — `db/policies/session/practitioner_scope.sql`:
`records_are_the_office`, a restrictive insert policy so `recorded_from =
'records'`, which is what admits the no-charge path, is the calendar's three
roles' at the table as well as at the route (the security review's finding).
Re-applied by the runner; no migration.

No new dependency, no seed change.

### The migration, and which half of the trunk's range 966 sits in

`session` is session-capture's (300–399) and the function is billing's
(400–449); a migration that builds on a stream's own table belongs in
`950–999`, where 966 was the next free number. It names 300, 302, 403 and
404 in its `-- Needs:`. `pnpm audit:migrations` finds no merged file edited;
the rollback restores 404's function body and drops the two columns.

### The three reviews, and what they changed

`compliance-reviewer`, `security-reviewer` and `schema-reviewer` each passed
the round; every medium finding was taken before the pull request opened:

- **Every refusal is logged.** Both the compliance and the security review:
  the spec's sentence promised it and the route logged only the gate's, the
  ledger's and the calendar's. Now the visit's id is minted first and every
  refusal after it — the wrong role as `wrong_role`, a bad body, no reason,
  the day, every not-found and mismatch — is logged against it, naming the
  client only once the client is verified to exist. Tested.
- **The database knows a `records` row is the office's.** The policy above.
- **A day the calendar does not have.** The date's regex let `2026-02-31`
  through to a silent rollover and `2025-13-01` to a 500.
  `pastSessionDateProblem` now answers `not_a_day` before comparing anything,
  and `pastSessionTimes` refuses to make instants of one. Tested.
- **The ledger's refusal names its constraint.** `session_no_credit_available`,
  matched by the route by name and never by the sentence.
- **The rollback runs as pasted.** 404's function body is carried word for
  word, the way 957 carries 953's, with a line on what the drop loses.
- **Two test gaps.** A count compared with itself; and the branch's own claim
  — a credit since run out still covers the visit it was valid for — which
  is now proved both ways.

Decisions the reviews asked to be written down:

- **Consent is judged now, not on the visit's date.** A current client's
  active consent for each purpose covers holding and processing their own
  record, history included, and no consent row exists to judge on a day
  before the app. For the practice's legal advisor to confirm, with the
  other items the compliance skill lists.
- **A current client is active or paused.** A lead has no history with the
  practice yet; a closed or erased record takes nothing more. The booking
  route admits only `active`; a paused household's history is still theirs.
- **The practitioner must be on the books today.** A visit delivered by
  someone who has since left is logged under whoever the office decides,
  and the reason should say so; the options door offers only active
  practitioners, and the route holds the same line. Accepted, not widened.
- **The sensitive audit row does not name the billing choice.** The session
  row itself carries `settled_outside_app` and the trigger's audit row
  carries the insert; the reason the office gave rides on the sensitive
  row. Accepted.
- **`recorded_from` is text with a check, not an enum**: the shape 070, 453
  and 916 use for a small closed set, said in the migration's header.
- **The reason gate reads the raw header and the trail stores the cleaned
  one** (a header of only characters the middleware strips passes the gate
  and lands as null): the pattern six other routes share, for one fix at the
  middleware in a later round, not here.

### Deliberately not done

- **A note or ratings on a past visit.** The record is the day, the service,
  the practitioner and the length; observations were the vendor software's,
  and the report's own words are the report's.
- **Correcting a past visit.** A wrong one is a new version by the amendment
  path section 4 already names, still unbuilt; until then the office logs
  the right one and asks for the wrong one to be handled as an amendment.
- **`visit_actuals` for a past visit.** Nothing was counted at the door.
- **For whoever builds amendments** (the schema review's note): a version-2
  row inserted as `completed` carries a new id, so the trigger's "already
  accounted for" check will not see the original's credit and will run
  again — for a `records` row not settled outside, a second credit or a
  refusal. That is 404's existing behaviour for device rows too; the
  amendment path will need the trigger to look through `supersedes_id`.
- **Reusing `app.complete_appointment_for_session`.** It authenticates the
  caller as the session's own practitioner; the route writes the appointment
  as completed itself, in the same transaction, which is the same fact.

### Synthetic data used throughout

The seed's own households and practitioners (`db/seed/generate.ts`); the
first two seeded clients are leads with no consents, so the tests use the
active adult households; hand-written ids in the reserved ranges.

### Checked, not claimed

Recorded at the pull request: `pnpm verify` under Node 24, and `pnpm
test:db` against a local PostgreSQL 16 with PostGIS, whose one standing
failure (`tests/db/bootstrap-practice.test.ts`, which needs the Supabase
image's `auth.users`) is untouched by this round; CI runs the pinned image.
