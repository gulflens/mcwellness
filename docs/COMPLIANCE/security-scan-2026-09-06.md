# The deep security scan, rehearsed on 6 September 2026

This is the record of a rehearsal. `docs/SPEC/hosting.md` section 9 asks for the
deep security scan to be run against the exact revision the first release tag
names, as the last gate before the first deploy. That tag does not exist yet, so
this run was a practice run against today's `main` — to learn how long the scan
takes, what it costs and what it produces, before the real one has to work.

**The short version: the scan did not run, because the tool it needs was not
available in the session. Nothing was found, because nothing was looked at. No
patch was written and none was rejected. This rehearsal produced no security
assurance at all, and the real scan before the release tag is still entirely
outstanding.** What the rehearsal did produce is the reason it failed, which is a
fixable setting, and that is worth more before the release than during it.

## What was scanned, and with what

| | |
|---|---|
| Revision | `5e008fb091a3c73daa0ce558fdc691831e19dbe6` |
| Branch | `scan-2026-09-06`, cut from `origin/main` |
| Working tree | Clean at the start of the run and unchanged by it |
| Intended tool | The `claude-security` plugin's whole-repository scan |
| Intended settings | The whole repository, medium effort, attention on production code rather than tests and vendored copies |
| Size of the target | 1,232 tracked files |
| Actually scanned | Nothing |

Medium effort was chosen because the brief named no other and medium is the
tool's own default. The whole repository was the target, unscoped, because the
brief asked for the whole repository. Both of those choices stand for the real
run.

## Why it did not run

The plugin's scan is not a script that can be run by hand. It is a fixed
pipeline: it takes an inventory of the repository, builds a threat model,
sends one researcher over each area, sweeps for secrets, and then puts every
candidate finding to a panel of three independent verifiers that vote on
whether it is real. The report is stamped as verified from that vote record.
The pipeline runs as a single unit that the session calls through a facility
called the Workflow tool.

That tool was not available. It was checked twice, independently: once in the
session running this scan, and once inside the plugin's own scan orchestrator,
which is granted the tool in its definition and still did not have it at run
time. The message the plugin gives for this case is:

> The scan pipeline is unavailable in this session (it needs the Workflow tool),
> so no scan was run; if /config shows a 'Dynamic workflows' row, enabling that
> setting and restarting Claude Code lets the next session run the scan, and if
> it shows no such row, workflows are unavailable, or are disabled by your
> organization's policy.

**The pipeline was deliberately not rebuilt by hand.** It would have been
possible to send out researcher agents one by one, collect what they said and
write up the results. That was not done, and it should not be done, for one
reason: the verification panel's votes are what make a finding a finding. A
report assembled by hand claims a verification that never happened, and a scan
whose findings were never verified is worth less than no scan, because it
produces confidence without evidence. That is `docs/SPEC/hosting.md` section 9's
own argument, and it applies to the scanner as much as to the findings. An
honest empty result is the correct outcome here.

Nothing was created in the repository by the attempt: no report directory, no
working files, no stamp.

## Findings

**None, and the reason is that nothing was examined, not that the code came back
clean.** These two things look the same in a report and are opposites in
practice, so the distinction is laboured here on purpose.

Because there are no findings, there are no severities, no evidence to quote, no
patch files, and no rejections to explain. The directory the brief set aside for
patch files is empty. Nothing was applied to the repository, which was also true
of every step before this one.

## What the repository's own gates say at this revision

These were run because a rehearsal that delivers nothing at all is not much of a
rehearsal. **They are not a security scan and they cannot stand in for one.**
They are the automated checks the project already runs on every pull request,
recorded here so the release has a dated line about the state of the tree. They
look for known-bad dependencies, committed secrets and edited migrations. They
do not look for a flaw in the platform's own logic, which is the entire point of
the scan that did not run.

| Check | What it looks for | Result |
|---|---|---|
| `pnpm audit:deps` | Published advisories against production dependencies | No high or critical advisory applies |
| `pnpm audit:secrets` | Anything resembling a credential across all 1,232 tracked files | Nothing that looks like a secret |
| `pnpm audit:migrations` | Migrations edited, deleted or renamed after merge | All 64 clean |
| `pnpm typecheck` | Type errors across the workspace | Clean |
| `pnpm lint` | House rules, including the design rules | Clean |

## What the re-scan on the release tag must revisit

The honest answer is **all of it**: no part of this repository has been examined
by the deep scan, so the run against the release tag starts from nothing and
must cover the whole tree. There is no partial coverage here to build on and no
area that can be skipped because this rehearsal already looked at it.

Before that run:

1. **Fix the tool availability first, and prove it before booking the session.**
   This is the finding of the rehearsal. Check the `Dynamic workflows` setting,
   restart, and confirm the scan actually starts against any revision. The real
   scan is the last gate before the first deploy, and discovering this at that
   moment would stall the release.
2. **Run it against the release tag, never against `main`.** `main` moves; the
   tag is what ships. This rehearsal deliberately recorded its revision so the
   two runs can be told apart.
3. **Give it a session of its own,** as `docs/SPEC/hosting.md` section 9 and
   `docs/HANDOVER.md` section 6 both ask.
4. **Triage the findings, do not apply them.** Each accepted one becomes its own
   small pull request with the combined review and the re-check the house
   already uses; each rejected one is recorded with the reason. That process was
   never reached here.

Areas the real scan will need to account for, from the shape of the tree: the
API layer, which is the largest single body of code and the part that answers
untrusted requests; the database policies and the migrations that create them,
which are where the boundary between one household and another is actually
enforced; the administrative and practitioner screens; the domain logic for
billing, scheduling, sessions, assessments and reports; the background jobs; and
the deployment and infrastructure files. The check that every top-level
directory was either scanned or explicitly and defensibly skipped is part of the
scan's own output, and reading that part of its report is how the next run gets
to say "covered and clean" rather than "not examined".

Two items already known and outside this scan's reach, recorded so the release
does not lose them: the staging service-role key that `docs/HANDOVER.md` section
8 asks to be rotated, and the registration number that remains in the
repository's history after pull request 67 removed it from the working tree.
Both are the operator's to close and neither is affected by anything here.

## What this cost

About 0.28 million tokens: roughly 0.05 million in the scan orchestrator, which
spent its run reading its instructions and then correctly stopping, and the rest
in the session that drove it, wrote this document and ran the gates above.

That figure is worth keeping for planning, because it is almost entirely the
cost of *not* scanning. The real run reads and reasons over 1,232 files with a
researcher per area and a three-vote panel on every candidate. It should be
budgeted as a large job in a session of its own, and the rehearsal gives no
useful estimate of it, since the part that costs money never started.
