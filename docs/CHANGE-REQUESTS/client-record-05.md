# client-record-05: the concerns and health-answer screens reach the day sheet

The concerns and the six health answers shipped as data and routes in pull
request 177 (`docs/SPEC/client-record.md` section 4.6; migrations 108, 964 and
965). This round builds the screens: the Health tab and the enrolment wizard's
Health step, the concerns beneath the goals, and — the operator's decision of
2026-09-14 — **a "yes" on the practitioner's visit card**, so the person at
the door is not surprised. The card is scheduling's, so this file records what
was touched there and why, and rides in the round's own pull request by the
integrator's decision under the cost rules of `docs/HANDOVER.md` section 6 and
the precedent of every widened round in `docs/SPEC/OWNERSHIP.md`.

---

## 1. The day sheet carries the newest declaration's yeses (scheduling)

**Files.** `app/api/appointments/schema.ts` (one field on `DayStop`),
`app/api/appointments/list.ts` (one lateral join, own scope only),
`tests/scheduling/db/today.test.ts` (the case and the seed),
`tests/scheduling/TodayPage.test.tsx` (the fixture gains the field).

**What.** `DayStop.declared: HealthQuestion[]` — which of the six questions
the household answered "yes" to, by key, from their newest
`health_declaration`. Empty when every answer was no and empty when nobody has
asked. The keys are `HEALTH_QUESTIONS` in `app/api/clients/record-schema.ts`,
so the two schemas share one list and a seventh question is a compiler error
on the day sheet rather than a silent omission.

**Why only the own scope.** The coordinator's ledger has no door to stand at.
The practice scope's rows do not carry the field, and the test proves it the
way it already proves the record number and the coordinates stay off that
scope.

**Why the notes never travel.** A doorstep phone has room for a word each
("Told us about: seizures, medication."); the record holds the question in
full and whatever was written beside it. The test asserts a seeded note is
absent from the wire.

**Why the read is safe under the practitioner's own rules.** The join runs
under `app_role` as the practitioner. `db/policies/client/readers.sql` admits
them to a declaration through `app.client_visible_to_practitioner`, and
`OWN_STATUS_FILTER` is a subset of the statuses that function grants on — the
same argument `list.ts` already makes for its `join client` — so every stop
the query returns has a readable declaration behind it or none at all, never
one hidden by the policy and mistaken for "never asked".

**Audit.** The route already writes a `list` row per stop attributed to its
client; the declaration is read in the same statement, under the same actor,
reason and request, and needs no second row. What was read is not personal
data beyond the client the row already names: six booleans, no note.

## 2. The line on the card (`app/therapist/today/TodayPage.tsx`)

One line under the service name, plain ink: *Told us about: a head injury,
medication.* Not a note colour — hue on this screen belongs to the three
status states — because this is not a warning: it blocks nothing. The six
words are the card's own (`DECLARED_WORDS`, typed `Record<HealthQuestion,
string>` so a new key fails the build), and the record's Health tab uses the
agreement's full sentences instead. `app/therapist/today/TodayPage.test.tsx`
gains the field on its fixture and a case for the line. `app/therapist/**` is
the practitioner face; the table in `OWNERSHIP.md` gives Today to scheduling
and the piece-eight widening gave the whole face to session-capture for that
piece; this round edits the one component and its test and nothing else
there.

## 3. Nothing else outside the client record's paths

No migration, no policy file, no shared-zone code. `docs/SPEC/scheduling-manual.md`
section 5.1 gains one sentence.

## Left standing, deliberately

- **"Never asked" and "every answer no" look the same on the card.** Neither
  is a thing to say at a front door. The record's Health tab tells them apart
  ("Not asked yet").
- **A stop whose client is not yet visible to the practitioner** (a
  `booked` visit before confirmation) is not on the day sheet at all, so the
  question of showing a yes there does not arise.
- **No colour, no icon.** The operator's decision was that a yes shows and
  blocks nothing; a red line would say more than that.
