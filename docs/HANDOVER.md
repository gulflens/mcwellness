# Hand-over: how to pick this project up in a fresh session

Written 4 September 2026. This file exists so that the next Claude session,
started after the operator's usage limit resets, can continue without the
old conversation. It records where the work stands, what is approved, how
the work is done, and the cost rules the operator asked for. Update it at
the end of every session that changes the state; it is the one file a new
session reads first.

## 1. The prompt to start with

Paste this into a fresh Claude Code session opened in the repository:

> Read docs/HANDOVER.md and docs/PLAN/pieces-seven-to-nine.md, then start
> piece seven under the cost rules in the hand-over. Do not re-plan; the
> plan is approved.

If the session is short on budget, add "one builder, one combined review,
no re-check on documentation-only changes" and it will keep to the lean
rules in section 6.

## 2. Where things stand

- `main` is at `24243f6` (4 September 2026, 05:28 Dubai) with fifty
  migrations. Every merged pull request through #61 carries its review
  record as a comment.
- Pieces one to six are built, reviewed and merged: the client record and
  enrolment, consent capture and erasure, the diary with moves and
  cancellations, the session runner, packages, invoices and receipts as
  PDFs, the practice's identity with VAT charged only while registered.
- Staging (Supabase project `ajjkvjtqxktkgrvcrzkh`, Mumbai) is level with
  `main`: fifty migrations, thirteen policy files, the synthetic practice,
  two real staff accounts, the practice's identity on the tenant row, and
  the documents bucket with the eight consent wordings. Every pass is
  recorded in `docs/STAGING.md`; the seventh pass follows the next merge
  that adds a migration.
- The old Flutter app (`McWellness UAE`, a separate repository) is not this
  platform. Nothing in it needs revisiting for this work.
- Nothing is in flight. No pull request is open.

## 3. What is approved

`docs/PLAN/pieces-seven-to-nine.md`, approved by the operator on 4
September 2026. The decisions inside it were not answered individually;
the recommendation beside each is the default and is marked as Claude's.
Piece ten (assessments, brain-map reports, signed session reports) needs
its two specifications written and approved first; that writing is
authorised by the same approval.

## 4. How the work is done

- One builder per piece, in its own worktree (`git worktree add
  ../mcwellness-<stream> -b <stream>-1 origin/main`), owning only the paths
  `docs/SPEC/OWNERSHIP.md` gives that stream. The trunk (shared zone:
  `db/migrations` 0xx and 9xx, `domain/shared`, `app/shell`,
  `app/admin/settings`, `db/seed`, `docs/SPEC`) answers the streams'
  change requests in numbered rounds; the asks live in
  `docs/CHANGE-REQUESTS/`.
- Every pull request: builder pushes; reviews (see section 6 for how many);
  one consolidated fix round; a re-check; the review record posted as a
  comment; then the merge. The operator has authorised Claude to merge a
  reviewed, green pull request itself, in order, never red, never
  force-pushed.
- After a merge that adds a migration: `pnpm db:migrate` in the laptop
  checkout and restart `pnpm dev`; rebuild the staging bundle with
  `pnpm exec vite build --mode staging` and restart the staging server; run
  a staging pass (the procedure is every pass in `docs/STAGING.md`; the
  MCP tools apply migrations one at a time with a bookkeeping row each).
- House rules that fail review: British English; no emoji anywhere except
  the pull-request body's closing line; no real or realistic personal data
  (Emirates IDs only `784-1900-*`, phones only `+971 50 000 xxxx`, names
  from `db/seed/names.ts`); no secrets in the repository; never edit a
  merged migration; money is integer fils through one formatter; plans and
  pull-request bodies in plain language for a non-developer.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1
  <noreply@anthropic.com>`; pull-request bodies end with the generated-with
  line the tooling adds.

## 5. Laptop and demo facts

- Laptop checkout `/Volumes/Storage/McWellness/mcwellness`: `pnpm dev`
  serves the web app on 5173 and the API on 3000 against the local
  database. The trunk worktrees `mcwellness-trunk` (database port 5441)
  and `mcwellness-trunk-2` (port 5442) are for trunk rounds and staging
  passes; stream worktrees sit beside them.
- The staging demo is served from the laptop on port 3100:
  `HOST=0.0.0.0 PORT=3100 SERVE_APP=true node --env-file=.env.staging
  --import tsx app/api/server.ts` after the staging build. `.env.staging`
  is git-ignored and holds the staging keys; never print it.
- A keep-alive script restarts both demo servers if they die; it lives in
  the session's scratch directory, so a fresh session starts it again if
  the demos are wanted (`ps -ef | grep keepalive` shows whether it runs).
- The old app's production project `gqvpapvdqcfjlifgwhpk` must never be
  touched; a hook blocks it.

## 6. Cost rules (operator's instruction of 4 September 2026)

The operator's weekly allowance was spent in the first day of the week. The
night of 3 to 4 September used about 3.5 million tokens in sub-agents alone
(two builders at roughly 0.5 million each, four reviews at 0.2 million
each, three staging and survey agents at 0.2 to 0.3 million each, and five
quick looks at 0.15 million each), plus the main conversation, which
re-reads its whole history on every step and had grown very long. These
rules apply from now on unless the operator says otherwise:

1. **Short sessions.** One piece per session at most; start a fresh session
   from this file rather than continuing a long one. A long conversation
   costs more on every step than the work it does.
2. **Fewer reviewers.** Code pull requests get one combined review
   (security, schema, compliance and design in a single brief) and one
   re-check, not four reviews. Documentation-only pull requests get the
   integrator's own read and no agent review.
3. **Cheaper models where quality holds.** Builders and the combined review
   on Opus; re-checks, staging passes, CI polling and surveys on Sonnet.
   The operator previously asked for Opus everywhere; this replaces that
   for the mechanical passes and keeps it for the two that catch defects.
4. **No idle wake-ups.** Poll CI with one background command per pull
   request, not a loop of turns; do not respond to the desktop app's CI
   events when the cause is already known and being fixed.
5. **Briefs in files, results in files.** Give agents a brief file to read
   and ask for a short report; do not paste long change requests into
   prompts twice.
6. **Merge in batches.** Let a stream's pull request accumulate a round of
   work rather than opening one per small fix; small fixes ride the next
   trunk round.
7. **Say the cost.** Each pull-request record names the agents used and
   their approximate token use, so the operator can see where the
   allowance goes.

## 7. The failed-run emails

GitHub emails the repository owner for every failed or cancelled workflow
run. Between 3 September 11:30 and 4 September 00:02 Dubai time there were
eighteen such runs, all resolved:

- Eleven were **cancelled**, not failed: the verify workflow cancels an
  older run when a newer push arrives on the same branch, and the merges
  into `main` came quickly enough to cancel each other. No defect.
- Two were **npm's advisory service timing out** for over half an hour
  (branches `scheduling-3` and `shared-zone-round-23`, twice each). Fixed
  by pull request #58: the dependency audit now reads pnpm's own report and
  excuses a registry outage, while a weekly scheduled run fails loudly if
  the service was unreachable for it too.
- Two were **`main` itself going red** for about fifteen minutes after
  pull requests #51 and #54 met: two database tests that had skipped
  themselves until the other stream's table existed woke up and failed.
  Fixed by pull request #57.
- Three were earlier rounds' first pushes failing lint or a database test
  before their fix rounds (rounds 17, 18 and 22, and `scheduling-3`'s first
  push). Each was fixed on the branch before merge.

To stop the emails without losing the signal: on GitHub, Settings,
Notifications, under "Actions", untick email for failed workflows and keep
the web notification; or watch the repository's Actions tab instead. The
desktop app's own CI monitor will still tell a running session.

## 8. Open items that are the operator's

- A VAT certificate into the practice's Documents folder if one exists;
  staging records the practice as VAT-registered on the operator's word,
  and since migration 950 that switch decides whether invoices carry VAT.
- The lawyer's review of the eight consent wordings and the erasure letter
  (`docs/CONSENT/README.md` lists the seven points), and the hosting-region
  question (`docs/ADR/0003`).
- The tax adviser on the tax point of prepaid packages
  (`docs/SPEC/billing.md` section 5.3).
- The refund policy wording and the package expiry period.
- Optional: the flight-mode drill described in pull request #41's body.

## 9. Where Claude's own memory lives

Claude keeps short notes outside the repository, in the operator's Claude
Code project memory directory, about the production and staging projects,
the seeded passwords, the approved plans and the operator's instructions.
Those notes are loaded automatically in a fresh session on this machine.
This file is the copy that lives with the code, for any session on any
machine.
