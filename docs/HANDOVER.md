# Hand-over: how to pick this project up in a fresh session

Written 4 September 2026, updated early on 6 September with piece eight merged and on staging, and pieces nine and ten approved and building. This file exists so that the next Claude session,
started after the operator's usage limit resets, can continue without the
old conversation. It records where the work stands, what is approved, how
the work is done, and the cost rules the operator asked for. Update it at
the end of every session that changes the state; it is the one file a new
session reads first.

## 1. The prompt to start with

Paste this into a fresh Claude Code session opened in the repository:

> Read docs/HANDOVER.md, then section 10 in particular, and continue from
> the first step there that is not done. Check `gh pr list --state open`
> before doing anything: a pull request that is still open is where the
> last session stopped. Parallel work is allowed (section 6, rule 1). Do
> not re-plan; the plan is approved. Where a checkpoint waits on my
> approval, I will say so in this message; otherwise treat it as not yet
> approved and build nothing on it.

Then, in the same message, say which of the two checkpoints you approve, if
either: piece nine's hosting spec (`docs/SPEC/hosting.md`) and piece ten's
plan and two specs (`docs/PLAN/piece-ten.md`, `docs/SPEC/assessment.md`,
`docs/SPEC/reports-v1.md`). Approving a checkpoint is what lets its build
start; a checkpoint you have not read yet stays open and costs nothing.

## 2. Where things stand

- `main` is at `0c99ff2` plus pull request 77 (the eighth staging pass) and
  this file's own pull request: fifty-seven migrations and seventeen policy
  files. Every merged pull request through #76 carries its review record as
  a comment or, for documentation, the integrator's read.
- Pieces one to **eight** are built, reviewed, merged and on staging. Piece
  eight (the practitioner's phone) merged as pull request 73 early on 6
  September: the app installs and opens with no signal, the sensor
  photograph has its door and is filed under the household's consent, the
  day's drive estimates and picture sit behind a routing seam, and the kit
  register blocks a session on an overdue amplifier. Its record on the pull
  request names the review, the fix round, the re-check, and the short
  second round the re-check made necessary (the day picture and the previous
  placement were object URLs the content-security policy refused; `blob:` is
  now admitted for images and pinned by a test). The eighth staging pass
  (pull request 77) applied migrations 204 and 306, the seed's kit rows and
  `ROUTING_PROVIDER=straight-line`, with the schema fingerprint identical to
  a fresh local build in all nine parts and the routing fallback proved live
  under the owner's account.
- **Pieces nine and ten are approved and building.** The operator approved
  both checkpoints at about 01:05 on 6 September in the session named
  "Handover section 10 continuation"; pull requests 75 (hosting) and 76
  (piece ten's plan and specs) merged at 01:08. That session dispatched the
  builds at 01:12 (piece nine in `mcwellness-trunk-2`; the PDF-writer move
  piece ten needs first in `mcwellness-trunk`; assessments in
  `mcwellness-assessment`; reports queued until the writer move merges) and
  is the one that reviews and merges them; its briefs, review briefs and
  reports live in its own scratch directory, and it updates sections 2, 3
  and 10 of this file in its own pull request after this one merges.
- Staging (Supabase project `ajjkvjtqxktkgrvcrzkh`, Mumbai) is level with
  `main` after the eighth pass; the record is in `docs/STAGING.md`. Staging
  runs the straight-line routing fallback until the operator supplies the
  Google server key (section 8).
- The old Flutter app (`McWellness UAE`, a separate repository) is not this
  platform. Nothing in it needs revisiting for this work.

## 3. What is approved

`docs/PLAN/pieces-seven-to-nine.md`, approved by the operator on 4
September 2026: pieces seven and eight are built, piece nine's domain and
host were answered on 5 September, and the same approval authorised the
writing of piece ten's two specifications. Piece eight's spec was approved
for building by the integrator under that plan on 5 September, with its
seven decisions marked as Claude's. **Approved on 6 September 2026 at about 01:05** (operator, in the session
"Handover section 10 continuation"): piece nine's hosting spec
(`docs/SPEC/hosting.md`, pull request 75) and piece ten's plan and two specs
(`docs/PLAN/piece-ten.md`, `docs/SPEC/assessment.md`,
`docs/SPEC/reports-v1.md`, pull request 76), with every default marked as
Claude's standing until overruled. Their builds are running from that
session.

## 4. How the work is done

- One builder per piece, in its own worktree (`git worktree add
  ../mcwellness-<stream> -b <stream>-1 origin/main`), owning only the paths
  `docs/SPEC/OWNERSHIP.md` gives that stream. The trunk (shared zone:
  `db/migrations` 0xx and 9xx, `domain/shared`, `app/shell`,
  `app/admin/settings`, `db/seed`, `docs/SPEC`) answers the streams'
  change requests in numbered rounds; the asks live in
  `docs/CHANGE-REQUESTS/`.
- From 5 September 23:37 (operator's instruction), independent pieces of
  work run at the same time as separate background agents, each in its own
  worktree with its own brief file: a review, a design checkpoint and a spec
  rewrite ran side by side that night, and two builds may too once their
  checkpoints are approved. What must stay in order is a single piece's own
  chain (review, fix, re-check, merge, staging).
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

1. **Parallel work, short main conversations** (operator's instruction of
   5 September 2026, 23:37 Dubai, replacing the 4 September rule of one
   piece per session). Independent work runs at the same time in separate
   background agents; the main conversation stays short by keeping briefs
   and results in files rather than in the conversation, and a new session
   is started from this file rather than a long one continued. The operator
   accepts that several agents at once spend the allowance faster; the
   speed is theirs to weigh against it, and section 7 of every record says
   what was spent.
2. **Fewer reviewers.** Code pull requests get one combined review
   (security, schema, compliance and design in a single brief) and one
   re-check, not four reviews. Documentation-only pull requests get the
   integrator's own read and no agent review.
3. **Which model does what** (operator's instruction of 5 September 2026,
   21:19 Dubai, replacing the 4 September version of this rule). Builders,
   including fix rounds, on Opus. The combined review and the re-check on
   Fable 5.1, as sub-agents reading the diff in their own context rather
   than in the main conversation; and the approval to merge is Fable 5.1's
   in the main session, as it already was. Staging passes, CI polling and
   surveys stay on Sonnet: they are mechanical and the operator's
   instruction named builds and review, not those. Piece seven was
   reviewed under the earlier rule (review on Opus); piece eight is the
   first under this one.
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

**What piece seven cost under these rules (5 September).** Builder on Opus
about 0.94 million in two runs (the first stalled after four commits on a
long silent command and reported no figure; 0.25 million is the estimate for
it, 0.69 million the second run's own figure), the combined review 0.25
million, the fix round 0.33 million, the re-check on Sonnet 0.16 million, the
staging pass on Sonnet 0.33 million; the integrator's own conversation on
top. Two lessons kept in the briefs: a builder must run `pnpm test:db`,
`pnpm verify` and `pnpm build` with an explicit timeout and run single test
files while iterating, because a silent ten-minute command is what stalled
the first run; and a stalled agent cannot be resumed from this desktop
session, so the continuation note in the brief is what saved its work.

**What piece eight cost (6 September, 01:40).** The spec by the integrator
in the main conversation; the builder on Opus about 0.73 million in one run
of 95 minutes with no stall (the timeout and single-file rules from piece
seven held); the combined review on Fable 5.1 about 0.26 million; the fix
round on Opus about 0.33 million; the re-check on Fable 5.1 about 0.11
million, which found one defect the suite could not see; a short second
round on Opus about 0.055 million, read by the integrator instead of a
third agent pass; the staging pass on Sonnet about 0.35 million. About 1.84
million in agents, plus the integrator's own conversation. Beside it, piece
nine's checkpoint cost about 0.19 million and piece ten's specs about 0.27
million, both on Opus.

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

- **Rotate the staging project's service-role key** (Supabase dashboard,
  API settings, the `documents` bucket's key in `.env.staging` as
  `SUPABASE_STORAGE_KEY`) when convenient. During the eighth staging pass a
  shell redirection mis-appended onto that line and the diagnostic that
  found the fault printed the line, key included, into the agent's own
  transcript. Fixed the same minute, never committed or logged elsewhere,
  staging and synthetic data only; rotating it closes the matter.
- **The Google server key for piece eight.** In the practice's Google Cloud
  project, enable the Routes API and the Maps Static API, mint a server key
  restricted to those two (never the key inside the old app's binaries), set
  a spending cap, and give it to a session to place in `.env.staging` as
  `GOOGLE_MAPS_API_KEY` with `ROUTING_PROVIDER=google`. Until then staging
  and the laptop run `ROUTING_PROVIDER=straight-line` and Today says the map
  needs the practice's key. Claude can do the console work with `gcloud` if
  asked.
- **Two manual checks from piece eight's definition of done** that no agent
  could perform: install the built app from Chrome and Safari on the laptop
  and reload it with the network switched off in the developer tools (the
  builder's browser refused to register a service worker, so the worker's
  rules are proved by unit tests instead); and the photograph on a real
  phone, which needs a secure address and so rides on piece nine's first
  HTTPS deploy.
- Two variables in `.env.staging` before an invitation can be issued on the
  staging demo: `SUPABASE_AUTH_ADMIN_KEY` (the staging project's service
  role key, pasted deliberately for this purpose, never the anon key; Claude
  does not handle it) and `PUBLIC_APP_URL` (the address the demo is reached
  at, which is what the invitation link is built from). Until both are set
  the door answers "unavailable" and nothing is written. Then restart the
  staging server.
- The guardian and emergency-contact fields the plan's Family screen named
  do not exist on the platform's record (a contact has a relationship and a
  legal-guardian flag); adding one is a personal-data decision with a stated
  need, so it waits for the operator to ask (spec section 12).
- The registration number that pull request 67 removed from the founder's
  review page is still in the repository's history. Rewriting history is the
  operator's call; nothing is done about it unasked.

- The VAT switch. The practice is not registered for VAT (operator, 5
  September 2026): the AED 375,000 threshold has not been crossed. Staging
  now records it as not registered, matching the seed, and the switch in
  the practice settings stays off until the Federal Tax Authority registers
  the practice and issues a number. The operator wants the platform to watch
  the threshold and say when it is near; the switch itself stays a hand's
  act, because an invoice may not carry VAT without the number. The watch
  is listed under the plan's small things.
- The lawyer's review of the eight consent wordings and the erasure letter
  (`docs/CONSENT/README.md` lists the seven points), and the hosting-region
  question (`docs/ADR/0003`).
- The tax adviser on the tax point of prepaid packages
  (`docs/SPEC/billing.md` section 5.3).
- The refund policy wording and the package expiry period.
- Optional: the flight-mode drill described in pull request #41's body.

## 9. Where the briefs and reports of 5 September live

The session that built piece eight kept its briefs and the agents' reports in
its scratch directory,
`/private/tmp/claude-501/-Volumes-Storage-Coding-McWellness-UAE-McWellness-Mobile-App/5522e7c5-b72c-486a-817a-9e01a3c3164d/scratchpad/`:
`phone-builder-brief.md` and `phone-builder-report.md`, `phone-review-brief.md`
and `phone-review-report.md`, `phone-recheck-brief.md` and
`phone-recheck-report.md`, `phone-staging-brief.md` and
`phone-staging-report.md`, `nine-spec-brief.md` and `nine-spec-report.md`,
`ten-spec-brief.md` and `ten-spec-report.md`. A report that is missing is a
step not yet run. The directory is temporary; anything a later session needs
from it is copied into the pull-request record or into this file.

## 10. The next steps, in order

Each step names who runs it and what it produces. A step is done when its
pull request is merged or its report exists.

**Finishing piece eight** — **done, 6 September 01:40.** Review at 8624c02,
fix round to 458545e, re-check, second round to 014e3e4, record posted,
merged as pull request 73 at 01:04, laptop migrated, staging pass as pull
request 77, this file updated. Kept below for the record:

1. The combined review of pull request 73 on Fable 5.1 (brief and report in
   section 9). Done when `phone-review-report.md` exists.
2. One fix round on Opus, in the worktree `mcwellness-session-capture` on
   branch `session-capture-4`, from a brief that pastes the review's numbered
   gaps and asks for one commit per gap or a one-sentence dispute; push to
   the same pull request.
3. The re-check on Fable 5.1 (`phone-recheck-brief.md`), naming the reviewed
   and head commits.
4. The record posted on pull request 73 as a comment: the review's verdict,
   each gap's outcome from the re-check, the agents used and their token use.
5. Merge, when both GitHub checks are green: `gh pr merge 73 --merge
   --delete-branch`. Then in the laptop checkout `git pull`, `pnpm db:migrate`,
   restart `pnpm dev`.
6. The eighth staging pass on Sonnet (`phone-staging-brief.md`): migrations
   204 and 306, the seed's kit rows, `ROUTING_PROVIDER=straight-line`, the
   staging bundle rebuilt and the demo server on port 3100 restarted, the
   pass recorded in `docs/STAGING.md` as its own pull request, merged.
7. This file updated: section 2's state, section 6's cost line for piece
   eight completed, and the piece eight entry in Claude's memory replaced by
   a completed note.

**The two checkpoints** — **done and approved**: pull requests 75 and 76,
merged 01:08 on 6 September. Kept for the record:

8. Piece nine's hosting spec (`hosting-spec`): read by the integrator, then
   held open until the operator approves it. If the Hostinger confirmation
   says the Premium plan cannot run a persistent Node.js process, the spec
   lays out the alternatives and the operator chooses; nothing is deployed
   before that answer.
9. Piece ten's plan and specs (`piece-ten-specs`): the same; the plan page
   lists the decisions the operator must answer.

**After approval** — **dispatched at 01:12 on 6 September** from the session
"Handover section 10 continuation", which owns their review, merge and
staging and records them here in its own pull request:

10. Piece nine's build from `docs/SPEC/hosting.md`: the deploy pipeline on a
    `v*` tag, the production guard in `db:migrate`, backups with a rehearsed
    restore, monitoring on `/api/health`, the deep security scan on a tagged
    revision. The operator's parts: the DNS record for `app.mcwellnessuae.com`,
    the deployment secrets, the Google key above.
11. Piece ten's build from the two approved specs, in the `assessment` and
    `reports` worktrees, sequenced as its plan page says.
12. The small things in `docs/PLAN/pieces-seven-to-nine.md` (the takings
    figure, the VAT threshold watch, the activity feed and access report, the
    Arabic-copy defect in the PDF writer, the dead `invoice.document_id`
    column) ride a shared-zone round when a stream touches their tables.

## 11. Where Claude's own memory lives

Claude keeps short notes outside the repository, in the operator's Claude
Code project memory directory, about the production and staging projects,
the seeded passwords, the approved plans and the operator's instructions.
Those notes are loaded automatically in a fresh session on this machine.
This file is the copy that lives with the code, for any session on any
machine.
