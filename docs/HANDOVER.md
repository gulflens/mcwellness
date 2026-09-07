# Hand-over: how to pick this project up in a fresh session

Written 4 September 2026, updated on 7 September at 18:55: **piece eleven,
the books' ledger, was planned, approved, built, reviewed, fixed, re-checked
and merged in one day** (pull request 109, `main` at `dce3ca1`), and the
fourteenth staging pass and the third live pass carry its six migrations to
staging and production (`docs/STAGING.md`, `docs/PRODUCTION.md`).
Earlier the same day the repository was made public to free GitHub's checks,
pull requests 103 to 108 merged, migrations 205 and 957 reached staging and
production, and the live process at app.mcwellnessuae.com was rebuilt from
`main` at `e6d08ae` (`docs/PRODUCTION.md`, the second live pass). At 18:48,
on the operator's word ("lets go live"), production received 450 to 454 and
958 and the live process was rebuilt from `main` at `727310e`, so
app.mcwellnessuae.com now carries Books (the third live pass). This file exists so that the next Claude session,
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

Then, in the same message, answer any of section 8's decisions you are
ready to answer; nothing waits on a checkpoint now, and nothing is built on
an unanswered decision. The next session's first act is section 10.

## 2. Where things stand

- `main` is at `7d06cf8` plus this file's own pull request: seventy migrations
  and nineteen policy files. Every merged pull request through #89 carries
  its review record as a comment or, for documentation, the integrator's
  read; #84 was closed unmerged (a scan that had not run).
- **Pieces one to ten are built, reviewed and merged.** On 6 September,
  between 01:12 and 05:43, one session ran four builders in parallel and
  merged, in order: the trunk's writer move (pull request 78: the PDF
  writer's byte-level half and the sending seam in `domain/shared`, and the
  copied-Arabic defect fixed); piece nine (pull request 80: a release
  workflow on a `v*` tag behind an approval gate, the production guard in
  `db:migrate` with a third word `scratch` for throwaway databases, weekly
  backups and a rehearsed restore in `docs/RUNBOOK/restore.md`, the deep
  health route, error lines with nobody's data in them, two vendor rows
  proposed); a trunk fix (pull request 82: the audit trail was refusing one
  random identifier in eighty as a telephone number, which rolled back a
  photograph's filing at random; found by the assessment builder); piece
  ten's assessment stream (pull request 81: measurements, the brain map's
  shape and comparison, the export's own door, migration 106 for erasure);
  and piece ten's reports stream (pull request 83: signed session and
  progress reports over the shared writer, delivery by hand-off, the
  household's portal screen, migration 107 for erasure). Each record names
  its review, fix round and re-check and what they cost.
- The ninth staging pass merged as pull request 86 (06:28): migrations 106,
  107, 500, 501, 600 and 601, the seed's assessment rows, the fingerprint
  matching a fresh build exactly. Staging has run the practice's real Google
  routing since 06:27, the key placed in its settings by a command whose
  output went straight to the file.
- **Trunk round 31 merged as pull request 87 (08:22)**: what the streams owed
  the trunk (the visit link on a measurement, the shared file-type check, the
  document key and its foreign key, the portal test's race, three notes) and
  the plan's small things (the takings figure that is the same whoever asks,
  the VAT threshold watch, the activity feed and access report, the dead
  invoice column), plus two of the operator's decisions of 06:15: guardians
  only for a young person's reports (migration 955) and the production
  project's reference in the hook. Its record names the review's one security
  failure (the feed showed an erased household without a reason) and its fix.
- **The operator decided at 06:15** (section 3): the API runs on Hostinger
  Web Apps Hosting in Mumbai; the production Supabase project was created at
  06:22 (`ipiluvnlnzdbolbqwtpl`, Mumbai, the Pro organisation, empty until
  the first release); the old app's project is to be paused, which the API
  refused for a paid-tier project, so it is the operator's dashboard act;
  guardians only. The GitHub Environment `production` could not be created
  from a session (the permission layer refuses it) and stays the operator's.
- **The security scan ran** (pull request 88, the record): every reader on
  Haiku at medium effort, fourteen candidates, none confirmed by the panel,
  two cells not examined (the client portal and the client record). It is
  evidence, not the gate: the scan the hosting spec's section 9 requires
  still runs on the release tag.
- **A browser walk of pieces eight and ten** (pull request 89, the record and
  `docs/CHANGE-REQUESTS/qa-01.md`) found five product defects, the largest
  that nothing moved a booking from proposed to confirmed; its fix round
  (branch `qa-fixes-1`, Opus) and the tenth staging pass (Sonnet) are running
  as this is written. Two laptop faults it found are fixed in place: the
  keep-alive script now checks both loopback addresses, and the tenth pass
  rebuilds the laptop's stale seed.
- **The first hand deploy to `app.mcwellnessuae.com` (09:25 to 10:20, on the
  operator's instruction)**: the subdomain exists on the Premium plan with
  its DNS records added by Hostinger; the site is classed as a Node.js
  application with stored build settings (Node 24, npm, root `mcwellness`,
  build `build:production`, output `dist`, entry `app/api/start.mjs`, the
  start file merged as pull request 93 with `docs/RUNBOOK/go-live.md`); the
  eleven public settings are in its environment; the source archive of `main`
  at `9d85d13` built on the server (631 packages, the screens and the service
  worker). Two facts learned: Hostinger's build cannot fetch pnpm through
  corepack, so the hosted build uses npm with a lockfile generated from the
  same manifest; and `NODE_ENV=production` in the environment makes npm skip
  the build tools, so it is not set. **The process is not running**: every
  path answers Hostinger's own 404, the runtime log is empty, and the
  expected cause is the seven secrets the API refuses to start without, which
  only the operator pastes (the guide's steps 1 to 8). The first thing to
  read after pasting is the runtime log: either the health routes answer, or
  it names the next fault, or nothing appears and the plan cannot run an
  always-on process, in which case decision 1's product is the answer.
- The browser walk's five defects are fixed and merged (pull request 91) and
  staging carries them; the lawyer's pack is in the operator's Documents
  folder under "For review" (twelve documents, Word and PDF).
- **The production database's first pass** (pull request 94, `docs/PRODUCTION.md`,
  10:50): seventy migrations and twenty policy files applied through the
  Supabase tools with their bookkeeping rows, no seed and no row written, the
  fingerprint identical to a fresh build in all nine parts, the advisors'
  findings recorded. What it exposed: nothing in the code creates the first
  practice and its owner except the seed, and the per-practice defaults the
  migrations write need a practice to exist when they run. **Trunk round 32,
  the first practice**, merged as pull request 95 at 12:24: migration 956,
  `app.bootstrap_practice`, creates the practice and its owner from one
  statement, lets the six per-practice defaults arrive by their own triggers
  and checks each, refuses a second practice or an unknown sign-in id, and is
  never reachable through the API. It is on production and staging (pull
  request 96, the second production pass and the eleventh staging pass; both
  fingerprints match a fresh build). Three time-of-day fixtures that made CI
  red between 08:00 and 12:00 UTC were fixed in the same round.
- **The afternoon of 6 September, on the founder's reply of 4 September**
  (relayed again with her equipment's sample files): the four long
  agreements ask about a head injury at any time, versions 0.2-draft (pull
  request 98); the assessment door takes the practice's real recordings
  (EDF and the native file) and NeuroGuide reports up to 64 MB, with roles
  and conditions, migration 503 (pull request 99); and **one fee, never a
  session** (pull request 100, migration 408): no outcome takes a credit, a
  late, unfit or no-show visit writes one AED 150 call-out invoice by the
  ledger's own trigger, waived with a reason through a door the database
  guards itself. The no-show is Claude's default for the founder to
  overrule. The third production pass and the twelfth staging pass (pull
  request 101) carry both migrations; the fee rule was proved live on
  staging. Her equipment is named (BEE Medic NeuroAmp II 5S with Cygnet;
  NeuroLab EEG-21 with x23, ERPrec, WinEEG, NeuroGuide), so piece ten's
  decision 1 is answered; the parser waits on NeuroGuide's numeric export,
  asked for in a Gmail draft. Requests left for later rounds sit in
  `billing-06.md` (the portal's "Waived" word, the VAT threshold sum
  excluding waived fees, "plus VAT where applicable" on the signed page) and
  `assessment-02.md`.
- **The evening of 6 September (20:40 to 22:00), a fresh session from this
  file.** Its check of the build against the plan: `main` at `b8c0c22`,
  nothing in flight, `pnpm verify` (169 files, 1,890 tests) and
  `pnpm test:db` (76 files, 1,108 tests) green on the laptop. **Trunk round
  33** (pull request 103, branch `trunk-round-33`, head `261575a`) answers
  every request owed after the fee round and the assessment door:
  `billing-06.md` 1 to 5 and `assessment-02.md` 2 and 3 — a waived call-out
  fee says "Waived" with the day on the household's money screen and is left
  out of the taxable-supplies figure (migration 957), the fee column's and
  the settings route's notes stop teaching the old rule (migration 205, a
  comment only), the EDF signature sits in `domain/shared/fileSignature.ts`
  and the assessment stream's copy is gone, one fixture says `raw_recording`,
  and the bookings page states the AED 150 fee net of VAT. Combined review on
  Fable (four areas PASS, five gaps, none failing), fix round on Opus, re-check
  clean; the record is on the pull request. **It is not merged**: see the
  next bullet.
- **GitHub refuses every check.** Since 13:03 UTC on 6 September (the push of
  pull request 102's merge) every job of the `verify` workflow fails within
  seconds with no step run; the check-run annotation reads "The job was not
  started because recent account payments have failed or your spending limit
  needs to be increased. Please check the 'Billing & plans' section in your
  settings". A rerun at 16:50 UTC and pull request 103's own runs failed the
  same way. The code is not at fault (the same gates pass on the laptop), the
  `backup` and `release` workflows are refused too, and the merge rule
  (section 4) forbids merging on a red check, so nothing merges until the
  operator lifts it (section 8, first item).
- **Trunk round 34** (pull request 105, branch `trunk-round-34`, worktree
  `mcwellness-trunk-2`, stacked on `trunk-round-33` because both edit the
  record files; its pull request's base is `trunk-round-33` until 103 merges)
  takes section 10's step 3: the five bands named in both languages from one file in
  `domain/shared` (the Arabic names proposed for the operator's approval),
  a colour operator in the shared PDF writer so a printed ribbon carries the
  band's hue, one press from a record's timeline to its access report, and a
  "Who may read what" table in `docs/SECURITY.md`. Built by 22:24 (six
  commits, head `eae602d`, 1,931 and 1,113 tests green, fifteen defaults in
  `trunk-notes.md` round 34, the five Arabic band names among them for the
  operator's approval). Combined review on Fable (Security FAIL on one point,
  the `report` address parameter reaching state unvalidated, contained by the
  API's own check; eight smaller gaps, three of them cells of the new table),
  fix round on Opus (nine commits to `442f25c`), re-check clean at 23:00; the
  record is on the pull request. **Not merged**, for the same billing block.
- **The site is live (00:20, 7 September).** On the operator's instruction
  ("do the hostinger integration as i can not do it") the session placed the
  seven secrets by a script that printed none of them, and then found and
  fixed three things in the way: the site had to be its own website rather
  than a folder subdomain; the output directory had to be the app root; and
  the TypeScript loader's helper program arrived without its execute bit
  (pull request 106, `hosted-start-2`, which production runs one commit
  ahead of `main`). `/api/health` and `/api/health/deep` answer and `/`
  serves the app. The full account is `docs/PRODUCTION.md`, "the first live
  pass", and `docs/RUNBOOK/go-live.md` section 7. The secrets are in
  `~/Documents/mcwellness-production-secrets.env` for the password manager.
- **The founder can sign in (00:30)** and her password is the one the operator
  chose (00:41). **The sign-in page gained a show-or-hide button and a "Keep
  me signed in on this browser" box** (pull request 107, `signin-2`, stacked on
  106; built, reviewed, fixed and re-checked; deployed at 02:00, so production
  runs `dd90787`, `main` plus 106 plus 107). Merge order when the checks run
  again: 106, 107, then 103, 104, 105 (105 re-based on `main` first).
- The operator's morning page is `docs/OPERATOR/2026-09-06-decisions.md`
  (pull request 85): every decision and action that is theirs, with the
  Hostinger question and the lawyer's note drafted.
- The old Flutter app (`McWellness UAE`, a separate repository) is not this
  platform. Nothing in it needs revisiting for this work.

## 3. What is approved

`docs/PLAN/pieces-seven-to-nine.md`, approved by the operator on 4
September 2026: pieces seven and eight are built, piece nine's domain and
host were answered on 5 September, and the same approval authorised the
writing of piece ten's two specifications. Piece eight's spec was approved
for building by the integrator under that plan on 5 September, with its
seven decisions marked as Claude's. **Decided on 6 September 2026 at about 06:15** (operator, the same session,
before sleeping): the API runs on Hostinger Web Apps Hosting in Mumbai
(hosting.md decision 1 settled); the production Supabase project is created
now in Mumbai on the Pro organisation without waiting for the lawyer; the old
app's project is paused; a child's own portal login does not read reports
about themselves; the practice's existing Google key is reused; the Pro
organisation is this platform's. **Approved on 6 September 2026 at about 01:05** (operator, in the session
"Handover section 10 continuation"): piece nine's hosting spec
(`docs/SPEC/hosting.md`, pull request 75) and piece ten's plan and two specs
(`docs/PLAN/piece-ten.md`, `docs/SPEC/assessment.md`,
`docs/SPEC/reports-v1.md`, pull request 76), with every default marked as
Claude's standing until overruled. Both are built and merged (pull requests
78, 80, 81, 82 and 83, 6 September); the defaults their builders took beyond
the specs are listed on each pull request and recorded in the change
requests `assessment-01.md` and `reports-01.md` and trunk-notes rounds 28 to
30.

**Approved on 7 September 2026 at 14:18** (operator, this session): piece
eleven, the books' ledger — `docs/PLAN/piece-eleven.md` and
`docs/SPEC/accounting.md`, with the seven defaults as Claude's standing until
overruled — and, in order only, the six-piece accounting roadmap the plan's
table lists (twelve spending and VAT; thirteen performance and statements;
fourteen pay and profit; fifteen bank reconciliation; sixteen corporate
clients and e-invoicing). Each later piece comes back with its own
plain-language plan before anything is built. The shape had been approved in
conversation at 03:30 and amended at 13:20 after a comparison with Zoho
Books' UAE edition, when the operator adopted all fifteen additions it
proposed and answered two more questions: corporate clients are likely
within the year, and the free zone requires the founder's salary to go
through WPS. Piece eleven is built and merged (pull request 109, 17:12); the
implementation plan the builder followed is
`docs/superpowers/plans/2026-09-07-accounting-ledger.md`.

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
  reviewed, green pull request itself, in order, never red, never over a
  rewritten `main`. A stream branch rebased on `main` after its review is
  pushed once with `--force-with-lease` and the record names the reviewed
  commit and its rebased twin, so the re-check can diff the round alone; that
  is not the force-push this rule forbids.
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
  Since 08:20 on 6 September it checks both loopback addresses: the web
  server binds the IPv6 one on this Mac, and a check on the IPv4 one alone
  restarted the whole stack every minute for hours.
- The old app's production project `gqvpapvdqcfjlifgwhpk` must never be
  touched; a hook blocks it.

- This Mac has neither `timeout` nor `gtimeout`. A brief that says "run the
  gates with an explicit timeout" is met by the Bash tool's own timeout
  parameter (600000 ms or more); a shell `timeout` prefix exits 127 and the
  gate silently never runs.
- The evening session's briefs and reports (`round33-*`, `round34-*`) are in
  `/private/tmp/claude-501/-Volumes-Storage-McWellness/669757d8-b5cc-44cc-8fcb-fe3365b6579b/scratchpad/`.

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

**What the rest of the night cost (6 September, 08:40).** Trunk round 31:
builder on Opus 0.49 million, review on Fable 0.34, fix round 0.33, re-check
0.19; 1.35 million. The ninth staging pass on Sonnet 0.45. The operator's
page on Opus 0.18. The browser walk on Sonnet 0.58. The security scan: a
first attempt that could not start 0.09, a high-effort run stopped after
fourteen minutes (unrecorded), the Haiku run at medium effort 6.2 million (a
stop and resume in the middle repeated twenty-nine researchers), its record
on Sonnet 0.34. The fix round for the walk's defects and the tenth staging
pass: see their records. Two lessons kept: the scan is a stage of its own on
the release tag and is never started beside a build again; and a workflow
resumed after a stop replays every agent that finished, so a stop only ever
costs the agents that were mid-flight.

**What pieces nine and ten cost (6 September, 05:45).** All from one
session, in parallel where the chains allowed. The writer move: builder on
Opus 0.25 million, review on Fable 0.23, fix round 0.16, the re-check the
integrator's own read; 0.64 million. Piece nine: builder 0.32, review 0.22,
fix round 0.21, re-check 0.15; 0.9 million. The audit fix: builder 0.19,
reviewed by the integrator's own read. The assessment stream: builder 0.56,
review 0.43, fix round 0.37, re-check 0.17; 1.53 million. The reports
stream: builder 0.69, review 0.52, fix round 0.48, re-check 0.24; 1.93
million. The ninth staging pass on Sonnet: see its record. About 5.2 million
in agents for the night, plus the integrator's conversation. One lesson kept
in the briefs: a rebase after review must be named in the record with the
reviewed commit's rebased twin, or the re-check cannot separate the round
from main's own movement.

**What trunk round 33 cost (6 September, 22:00).** Builder on Opus about 0.28
million; combined review on Fable 0.22; fix round on Opus 0.13; re-check on
Fable 0.10. About 0.73 million in agents, plus the integrator's conversation.

**What trunk round 34 cost (6 September, 23:00).** Builder on Opus about 0.29
million (a background inventory of the policy files inside it); combined
review on Fable 0.22; fix round on Opus 0.15; re-check on Fable 0.14. About
0.8 million in agents. The evening's two rounds together: about 1.5 million
in agents, plus the integrator's conversation.

**What piece eleven cost (7 September, 17:15).** Builder on Opus about 0.59
million in one run of 74 minutes, from a written implementation plan of
sixteen tasks; combined review on Fable 0.35; fix round on Opus 0.34 (twelve
findings, one blocking); re-check on Fable 0.15; the fourteenth staging pass
on Sonnet 0.30; the production pass on Sonnet 0.23. About 1.96 million in
agents, plus the
integrator's conversation, which wrote the spec, the operator's plan, the
Zoho comparison and the implementation plan. Two lessons kept: a plan that
gives the builder exact file names, signatures and test code lets one Opus
run carry sixteen tasks without a stall; and a worktree's ports must be
checked against every running container, not only the ownership table — the
two trunk worktrees had taken 5441 and 5442 by hand.

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

- **The books are live.** On your word ("lets go live", 18:28 on 7
  September) migrations 450 to 454 and 958 were applied to production and the
  live process was rebuilt from `main` at `727310e` (18:48; `docs/PRODUCTION.md`,
  the third live pass). Books appears in the owner's rail. The first time it is
  opened, the page posts every invoice, payment and credit billing already
  holds into the journal; the books start on 7 September, the practice's first
  day, so nothing predates them. The nightly poster is not scheduled on
  Hostinger yet; the page's own posting covers it until a cron job is added.
- **Two decisions the books need, neither urgent.** The day the books start
  defaults to the day the practice was created and can be changed in Books,
  Settings until the first entry is written; if the founder wants her books
  to start on an earlier day, say which. And the corporate-tax figure assumes
  Small Business Relief is elected (revenue under AED 3 million, relief
  extended to the end of 2029); the adviser confirms, and the switch is one
  setting.
- *(Resolved 7 September 02:55: GitHub's billing block, by making the
  repository public after a scan of its whole history; checks run again.)*
- **Three wordings to see** from round 33 and 34 (named in their pull-request
  bodies): the bookings page now says the AED 150 fee is "plus VAT once the
  practice is registered for it", in both mentions; the household's money
  screen shows a waived fee as "Waived" with the day, and its Arabic
  "أُعفي بتاريخ …" is composed from the approved PDF sentence rather than
  held verbatim; and round 34 proposes Arabic names for the five brainwave
  bands. Say yes, or give the words you want.
- **Production is signed in to** (00:30, 7 September): the founder's account
  and the practice exist (`docs/PRODUCTION.md`, the first live pass). Move
  `~/Documents/mcwellness-production-secrets.env` into the password manager
  and delete it; it holds her email and password too. Merge pull request 106
  when the checks run again; until then production is one commit ahead of
  `main`.
- **Piece nine's live half**, in the order they unblock each other
  (`docs/SPEC/hosting.md` section 11, pull request 80's body, and the
  operator's page): buy Hostinger Web Apps Hosting in Mumbai (decided 06:15);
  create the GitHub Environment named `production` with yourself as its
  required reviewer (refused to a session by the permission layer;
  `docs/RUNBOOK/restore.md` section 3 gives the one command); the DNS record
  for `app.mcwellnessuae.com` once the site exists; the API's settings in the
  host's own secret store, including the production project's URL, keys and
  pooler string (project `ipiluvnlnzdbolbqwtpl`, created 06:22); pause or
  delete the old app's project `gqvpapvdqcfjlifgwhpk` from the Supabase
  dashboard (the API refuses a paid-tier pause); the hosted restore rehearsal
  in a scratch project (it costs money; the local rehearsal is recorded); the
  uptime service and the address its alert wakes; `TRUSTED_PROXY_HOPS`
  measured on the first deploy; a spending cap on the Google key if wanted
  (the key itself is done and on staging); and the deep security scan in its
  own session against the first `v*` tag, at high effort with a stronger
  panel, covering the two cells tonight's run missed.
- **Piece ten's decisions** (`docs/PLAN/piece-ten.md`), still open and
  still not blocking: which equipment and software the practice uses and
  what its export is; which questionnaire to build first (the mechanism
  ships with one synthetic sample and no licensed instrument); whether a
  report is deleted on erasure (built as deleted, for the lawyer); the
  school report (for the lawyer); the draft mark (built as on).
- **One default a parent might ask about** (the other, a child reading their
  own report, was reversed at 06:15): the brain-map comparison inside a
  progress report prints nothing today, because a brain map's stored figures
  are band powers per electrode site and no report may print one, so which
  figure a household may be shown is the practice's call.
- **The offline install check** from piece eight needs the built app (\`pnpm
  build\` then \`pnpm start\`), not the dev server; the browser walk could not
  do it against the dev server and it stays a check with a real browser.
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

## 9. Where the briefs and reports live

The session that built piece eight kept its files in
`/private/tmp/claude-501/-Volumes-Storage-Coding-McWellness-UAE-McWellness-Mobile-App/5522e7c5-b72c-486a-817a-9e01a3c3164d/scratchpad/`
(`phone-*`, `nine-spec-*`, `ten-spec-*`). The session that built pieces nine
and ten kept its in
`/private/tmp/claude-501/-Volumes-Storage-Coding-McWellness-UAE-McWellness-Mobile-App/68f100b6-98c3-4fcc-b597-967a48b529b5/scratchpad/`:
for each of `nine`, `writer-move`, `assessment`, `reports` and `audit-uuid`
a `*-builder-brief.md` (or `*-brief.md`) and report, a `*-review-brief.md`
and report, a `*-fix-brief.md` and report, and for nine, assessment and
reports a `*-recheck-brief.md` and report; plus `ninth-staging-brief.md` and
its report. The session that planned and built piece eleven (7 September)
kept its in
`/private/tmp/claude-501/-Volumes-Storage-McWellness/fac94f8e-e3d7-43ee-954f-a7acaf7d0224/scratchpad/`:
`eleven-builder-brief.md` and report, `eleven-review-brief.md` and report,
`eleven-fix-brief.md` and report, `eleven-recheck-brief.md` and report,
`eleven-staging-brief.md` and report, `eleven-production-brief.md` and
report, and `eleven-pr-record.md` (posted on
pull request 109). All three directories are temporary; anything a later
session needs from them is in the pull-request records or in this file.

## 10. The next steps, in order

Each step names who runs it and what it produces. A step is done when its
pull request is merged or its report exists. Steps 1 to 11 of the earlier
list are done (piece eight, the two checkpoints, and the builds of pieces
nine and ten; see the records on pull requests 73 to 83).

1. The ninth staging pass (pull request 86) and trunk round 31 (pull request
   87, the streams' debts and every small thing but none left) are done.
2. The browser walk's fixes (pull request 91) and the tenth staging pass
   (pull request 92) are done; staging carries both. The start file for a
   Node.js host (pull request 93) and the production database's first pass
   (pull request 94) are done.
2a. Trunk round 32, the first practice (pull request 95), its application to
   production and staging (pull request 96), and the afternoon's three rounds
   (pull requests 98, 99, 100) with their passes (pull request 101) are done.
   **Nothing is in flight.** The operator's next act is `docs/PRODUCTION.md`,
   "The first practice": the Auth user, then the one statement, after the
   secrets of `docs/RUNBOOK/go-live.md` are in the host's environment. The
   code on Hostinger is main at `6c99fac`, built on the Business plan the
   operator bought at 13:59 (the Premium plan cannot run a Node.js process,
   which is why the earlier builds never started); the process still waits
   on the secrets.
2b. **Owed to the next rounds**, each a change request already written:
   `billing-06.md` (the portal shows "Waived"; migration 953's threshold sum
   excludes waived fees; "plus VAT where applicable" on the signed booking
   page; scheduling's column comment and settings comment) and
   `assessment-02.md` (the EDF signature in the shared check; the trunk's
   audit fixture). And the founder's answer on the no-show fee.
2b. **The hand deploy on Hostinger is done** (7 September, 00:20): the
   process runs and both health routes answer; the first live pass is in
   `docs/PRODUCTION.md`, and the founder's account and the practice exist and
   she can sign in. Left from it: measure `TRUSTED_PROXY_HOPS` (still `1`;
   the method is in the pass) and merge pull request 106.
2c. **Done, 7 September (02:50 to 13:12):** the repository made public, pull
   requests 103, 104, 106, 107, 105 and 108 merged in that order, migrations
   205 and 957 applied to staging (the thirteenth pass) and production (the
   second live pass), `TRUSTED_PROXY_HOPS` measured, the live process rebuilt
   from `main` at `e6d08ae`. Records in `docs/PRODUCTION.md` and
   `docs/STAGING.md`.
3. Owed to later rounds, recorded in `qa-01.md`, `reports-01.md` and
   trunk-notes: the household's own step in confirming a booking, if the
   scheduling spec names one; the "one press" to the access report from the
   client drawer (`audit-ui`); the colour operator in the shared PDF writer
   (R3) and the read-audiences page (R4); a scoped security scan of the
   portal and the client record if the operator wants the gap closed before
   the release-tag scan.
4. **Nothing else builds until the operator does section 8's first block.**
   The first deploy is a `v1.0.0` tag pushed after the host is bought, the
   environment, the DNS record and the secrets exist; it is released by the
   operator's approval on the environment; the security scan runs against
   that tag in its own session, at high effort, before the tag is pushed.

5. **Piece eleven, the books' ledger, is done** (7 September): approved at
   14:18, built by one Opus run from
   `docs/superpowers/plans/2026-09-07-accounting-ledger.md`, rebased onto
   `main`, reviewed, fixed (twelve findings) and re-checked, merged as pull
   request 109 at 17:12 with its record on the pull request. The fourteenth
   staging pass applied its six migrations (450 to 454, 958) and re-applied
   the policies; its record is in `docs/STAGING.md`. The `accounting`
   worktree is removed; the stream keeps its row in `OWNERSHIP.md` (range
   450–499, ports 5443/3011/5184) for pieces twelve to sixteen. On the
   operator's word the six migrations reached production and the live process
   was rebuilt from `main` at `727310e` at 18:48 (the third live pass,
   `docs/PRODUCTION.md`): Books is live.
6. **Next, in order.** (a) Done at 18:48 on 7 September: the books' production
   pass and the rebuild of the live process from `main` at `727310e` (the
   third live pass in `docs/PRODUCTION.md`). (b) **Piece twelve, spending and VAT**: the next planning act is a
   plain-language plan for the operator in `docs/PLAN/piece-twelve.md` and a
   spec, in the shape of piece eleven's, covering what
   `docs/SPEC/accounting.md` section 14 lists for it — suppliers, expenses
   and purchases with a receipt photograph, recurring costs, foreign-currency
   purchases, fixed assets and depreciation, Salik and parking claims, the
   refund's money out, tax credit notes on the billing side, input VAT and
   Form 201 with reverse charge, the FTA Audit File, the lock date moved by a
   filed return, an admin admitted to expenses. Nothing of it is built until
   the operator approves that plan. (c) Small things owed from piece eleven's
   review, for piece twelve's round: `Asia/Dubai` hard-coded in the
   accounting routes as in billing's; the Statements and Accounts period
   pickers default to the calendar year rather than the financial year; a
   partial unique index to close the race between two simultaneous opening
   entries; the deferred balance check answering 500 rather than a coded 400
   if a route ever bypassed `assertBalanced`. (d) Step 3's leftovers and
   `assessment-02.md` as before.

## 11. Where Claude's own memory lives

Claude keeps short notes outside the repository, in the operator's Claude
Code project memory directory, about the production and staging projects,
the seeded passwords, the approved plans and the operator's instructions.
Those notes are loaded automatically in a fresh session on this machine.
This file is the copy that lives with the code, for any session on any
machine.

From 6 September 2026 the sessions open in `/Volumes/Storage/McWellness`, so
new notes land in that project's memory directory
(`-Volumes-Storage-McWellness/memory/`); the thirty-seven earlier notes are
still under `-Volumes-Storage-Coding-McWellness-UAE-McWellness-Mobile-App/memory/`
and are not loaded automatically any more. A note in the new directory says
where the old ones are.
