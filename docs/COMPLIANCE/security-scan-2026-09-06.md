# The deep security scan, completed on 6 September 2026

This replaces the earlier note in this file, which recorded a rehearsal that
could not run because a tool was missing. That tool was fixed, and this is the
record of the scan actually running, start to finish, later the same day.

| | |
|---|---|
| Revision scanned | `5e008fb091a3c73daa0ce558fdc691831e19dbe6` (`origin/main`) |
| Branch this record lives on | `scan-2026-09-06` |
| Date | 6 September 2026, 03:03–03:35 UTC (about 32 minutes) |
| Size of the target | 1,232 tracked files |
| Tool | The `claude-security` plugin's whole-repository scan |
| Settings | Whole repository, medium effort, every agent on Claude Haiku 4.5 |

## What this scan is, and how it works

The scan does not run the code and does not fire any real request at it; it
reads. A first pass divides the repository into named areas ("components")
and, separately, lists anything deliberately left out and why. For each area,
one pass reads the code and sketches how data moves through it — where
outside input comes in, what dangerous things the code does with it, what it
assumes someone else has already checked. A further set of readers then hunts
that same area for specific kinds of weakness — injection, broken
authentication, weak cryptography, and so on — each looking through one lens
at a time. A last, free-roaming pass looks for anything that fell between the
areas. Every credible claim that comes out of that is then handed to three
independent reviewers who try to disprove it against the actual file; a claim
only becomes a reported finding if at least two of the three agree it is
real and exploitable, not merely possible in theory. Nothing is fixed or
changed by this process — it only reads and reports.

## Components covered

Twelve areas were scanned:

`api-http-handlers`, `auth-access-control`, `client-portal`,
`admin-dashboard`, `practitioner-app`, `billing-financial-system`,
`client-record-management`, `scheduling-appointments`, `session-capture`,
`database-schema-rls`, `domain-business-logic`, `build-test-infrastructure`.

## Components deliberately skipped, and why

Four things were left out on purpose, each with a stated reason rather than
silently vanishing:

| Skipped | Reason |
|---|---|
| `node_modules` | Third-party packages; covered by dependency audits, not this scan |
| `pnpm-lock.yaml` | A lock file, not code; changes are tracked through `package.json` |
| `dist` | Generated build output of code already scanned at its source |
| `jobs`, `infra` | Empty placeholder directories (no implementation yet) |

## Coverage gaps: what was not actually examined

Two of the automated readers failed outright and never produced anything
usable, even after being prompted a second time to try again in the same
conversation. Both failures happened at the first step for their area — the
pass that maps out how data moves through the code — for:

- **`client-portal`** (the household-facing web app: booking, agreements,
  balances, the invite-redemption flow)
- **`client-record-management`** (client records, consent capture, identity
  verification, GDPR erasure)

Because that first step failed for both, this run's official list of
candidate problems — checked against the record of what it actually
collected — contains **no entry from either area**. Ten of the twelve
components got their full run of readers; these two did not. **Treat both
`client-portal` and `client-record-management` as not examined by this scan.**
A "no findings" result elsewhere in this document says nothing about either
of these two areas, and nothing here should be read as "checked and clean"
for them.

## One category ruled out on the way in, not overlooked

Before the readers were sent out, the scan decided that "memory and unsafe
operations" (buffer overflows, use-after-free, unchecked memory access, and
the like) did not apply to seven of the areas, because they are written in
TypeScript and SQL — managed languages where that whole class of bug cannot
occur in application code the way it can in, say, C. This was ruled out
deliberately, before anyone looked, not missed:

`api-http-handlers`, `auth-access-control`, `billing-financial-system`,
`scheduling-appointments`, `session-capture`, `domain-business-logic`,
`database-schema-rls`.

The remaining areas were still checked under that lens as a matter of course,
and nothing came of it there either. **This repository has no memory-safety
category to speak of**, and excluding it here is a correct reflection of the
language, not a gap.

## The 14 candidate problems the readers raised, and why none of them stood

Thirty-four readers were sent out and all thirty-four returned an answer.
Between them they raised 14 candidate problems. Each candidate then went to
three independent reviewers, whose only job was to try to prove it wrong by
reading the actual file. **Not one candidate convinced two of its three
reviewers.** The rule for a real, reported finding is at least two votes out
of three; the closest any candidate got was one vote out of three. The
result is zero verified findings — not because nothing was raised, but
because everything raised was checked and did not hold up.

| # | Where | Category | Severity claimed | What was claimed | Panel | Why the panel said no |
|---|---|---|---|---|---|---|
| 1 | `db/migrations/306_kit_and_setup_photo.sql:494` (session capture) | Authentication & authorisation | High | A database function could let a practitioner see a setup photo from outside their assigned visits | 1 of 3 | Two of three reviewers found that the database's own row-level security, checked separately on every document read, already blocks exactly this |
| 2 | `app/api/sessions/photo.ts:132` (session capture) | Cryptography & secrets | High | A photo-upload check compares two values in a way that could theoretically be timed | 1 of 3 | Two of three reviewers found the value being compared is not a secret, so timing it reveals nothing usable |
| 3 | `app/api/billing/stop-balance.ts:83` (practitioner app) | Authentication & authorisation | High | A practitioner-facing balance endpoint lacks its own check that the client belongs to them | 0 of 3 | All three reviewers found the database's own access policy filters the same data by practitioner regardless of the missing application check |
| 4 | `app/api/_middleware/request-context.ts:92` (API layer) | Injection & input handling | Medium | A regular expression used to scrub a request header could be made to run very slowly | 0 of 3 | All three reviewers found the input to that pattern is capped at 500 characters before it ever reaches it, which rules out the slow case in practice |
| 5 | `domain/billing/refund.ts:90` (billing) | Injection & input handling | Medium | A refund calculation could overflow with a large enough input | 0 of 3 | All three reviewers found an existing safety check elsewhere stops an unsafe number before it is used, and the inputs needed are not reachable by an outside party anyway |
| 6 | `domain/shared/dates.ts:14` (domain logic) | Authentication & authorisation | Medium | A date-of-birth calculation does not itself validate the date, which could in theory affect an age-based decision | 0 of 3 | All three reviewers found the same malformed date is already rejected earlier, by the validation the API applies before this code ever runs |
| 7 | `db/seed/apply.ts:126` (build & test) | Cryptography & secrets | Medium | Test-data seeding uses a repeatable rather than random cryptographic value | 0 of 3 | All three reviewers found this code only ever touches local test data behind a guard that refuses to run against a real database |
| 8 | `app/api/assessments/file.ts:119` (admin dashboard) | Cryptography & secrets | Medium | A file-integrity check compares two values in a way that could theoretically be timed | 1 of 3 | Two of three reviewers found the value compared is not secret, so nothing is disclosed by timing it |
| 9 | `app/api/_middleware/request-context.ts:92` (practitioner app) | Injection & input handling | Medium | The same slow-regular-expression pattern as row 4, raised independently by a different reader | 1 of 3 | Two of three reviewers again found the same 500-character cap rules it out; one reviewer disagreed |
| 10 | `db/seed/apply.ts:486` (database schema) | Cryptography & secrets | Medium | The same repeatable-value pattern as row 7, in a different function | 0 of 3 | All three reviewers found the same test-only guard applies |
| 11 | `db/runner/plan.ts:352` (build & test) | Authentication & authorisation | Medium | A database migration tool trusts an environment variable it does not independently check | 1 of 3 | Two of three reviewers found no outside party can set that variable, and a separate deployment approval step sits in front of it |
| 12 | `db/migrations/100_client_record.sql:84` (database schema) | Authentication & authorisation | Medium | A database function does not itself check which organisation a record belongs to | 0 of 3 | All three reviewers found the function is only ever reached through other database policies that have already checked that |
| 13 | `app/api/_middleware/storage/local-disk.ts:168` (API layer) | Cryptography & secrets | Low | A file-storage check compares two values in a way that could theoretically be timed | 0 of 3 | All three reviewers found the only thing a timing difference could reveal — a token's length — is already public |
| 14 | `app/api/billing/documents.ts:259` (billing) | Cryptography & secrets | Low | A document-integrity check compares two values in a way that could theoretically be timed | 1 of 3 | Two of three reviewers found the value compared is visible elsewhere in the same response anyway, so timing it discloses nothing new |

No patch was written, because there was nothing left standing to patch.

## Honest limits: what "zero findings" does and does not mean here

**This is evidence of a clean pass, not proof of a clean codebase, and the
settings used are the reason for that distinction.**

- **Effort was medium, not high.** The tool offers a deeper setting for
  harder problems; this run did not use it.
- **Every agent in the pipeline — the researchers who went looking and the
  three reviewers who judged what they found — ran on Claude Haiku 4.5**, the
  fastest and least expensive model in the current line-up. A faster, cheaper
  reader is more likely to miss a subtle issue, and more likely to accept a
  defence at face value that a slower, more careful reader would keep
  pushing on.
- **The panel is not an independent check on the model doing the finding.**
  All three reviewers are the same model as the researchers who raised the
  candidates. If that model has a systematic blind spot, three votes from it
  do not compensate for that the way three votes from genuinely different
  reviewers would.
- **Two areas were not examined at all** (see above), for reasons that trace
  straight back to the same cheap, fast setting: the modelling step for both
  of them failed to produce a usable answer, twice.

None of this means the fourteen rejected candidates were wrongly rejected —
each rejection is recorded above with the reviewers' own reasoning, and it
reads as sound. It means a clean bill of health from this specific run,
at these specific settings, should carry less weight than a clean bill of
health from a slower, more expensive, more independently checked one.

## What this cost

About 6.2 million tokens, across roughly 89 agent runs (twelve
area-mapping passes, thirty-four category researchers, one gap-fill sweep,
and the panel that voted on all fourteen candidates), in a run lasting about
32 minutes. Every one of those tokens was billed at Claude Haiku 4.5's rate,
the cheapest in the current model line-up — which is both why this run was
affordable to run as a rehearsal and part of why its result should be read
as a floor, not a ceiling, on what the real scan will need to spend.

## What the release-tag scan must do differently

`docs/SPEC/hosting.md` section 9 requires the deep scan to run again, to
completion, before the first deploy — and this run, however complete, is
**not** that scan. Three things must change:

1. **Run it against the exact revision the release tag names, never against
   `main`.** `main` moves; a tag is fixed. This run scanned a `main` commit
   because no tag exists yet — that is correct for a rehearsal and wrong for
   the gate itself.
2. **Use high effort, not medium.** Medium was the right choice for learning
   how the tool behaves and what it costs; it is not the right choice for the
   last check before real client data goes live.
3. **Put a stronger model on the panel, at minimum.** The reviewers who
   decide whether a candidate is real should not be drawn from the same
   cheapest tier as the researchers who raised it — that pairing is the
   central limit recorded above. A stronger model researching, a stronger
   model reviewing, or both, is what closes it.

The two components this run never examined — `client-portal` and
`client-record-management` — need the same full treatment as everything
else; nothing here should be treated as a head start for either of them.
As before, findings from the real run are triaged rather than applied
automatically: each accepted one becomes its own small pull request through
the house's usual review, each rejected one is recorded with the reason, and
the report and the revision it ran against go into that pull request's
record.
