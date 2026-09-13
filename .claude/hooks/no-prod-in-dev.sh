#!/usr/bin/env bash
# PreToolUse on Bash: block SHELL COMMANDS that reach for production.
# Patterns: the production project name, the previous McWellness app's Supabase
# project (never touched from this repo), the production URL variable, and the
# word that unlocks the migration guard for a production database.
#
# **What this hook does NOT cover, stated here because its message used to
# overstate it.** It is wired on the Bash matcher alone
# (.claude/settings.json), so it does not see the hosted Supabase console —
# and the console is how every live pass in docs/PRODUCTION.md has actually
# applied its migrations, because no owner database password exists on this
# machine and `pnpm db:migrate` therefore cannot reach a hosted database at
# all. So this hook and the guard in db/runner/plan.ts are two locks on the
# same door, and it is not the door a live pass walks through.
#
# That is deliberate rather than a gap to close. A hook cannot tell a
# deliberate operator-approved pass from an accident, so extending it to the
# console would either refuse every live pass or be waved through on a flag
# and mean nothing. **The real gate on a production write is not mechanical:**
# it is the operator's explicit word for that pass, the staging-first order,
# the hold protocol between concurrent sessions, and the fingerprint that must
# match afterwards — all set out in docs/PRODUCTION.md and docs/STAGING.md.
#
# Found on 2026-09-14 by tripping this hook while writing a pass note, during
# the twenty-fourth live pass. The wording below was corrected then; the
# patterns and the coverage were left exactly as they were.
input=$(cat)
cmd="$input"

# The previous McWellness app's own production Supabase project. It is a
# different product on the same organisation, and nothing in this repository
# ever reaches it.
OLD_APP_PROJECT_REF='gqvpapvdqcfjlifgwhpk'

# This platform's own production Supabase project. It was created by the
# operator at 06:22 on 6 September 2026, and this is the reference — the twenty
# characters in the project's URL, which is not a credential: the project's own
# keys and every runtime setting live in the host's secret store and never
# enter this repository (docs/SPEC/hosting.md section 4.4).
#
# Nothing else in this file changed when it was filled in, and the migration
# guard in db/runner/plan.ts is unchanged too: it refuses any database that is
# not on this machine unless MIGRATE_TARGET names it, so it needed no reference
# to be complete and does not need this one now. This line is the second lock.
PLATFORM_PRODUCTION_PROJECT_REF='ipiluvnlnzdbolbqwtpl'

# MIGRATE_TARGET=production is the one word that lets `pnpm db:migrate` past
# the guard in db/runner/plan.ts and onto a production database, and the guard's
# own comment says it stops a mistake rather than a determined person. A Claude
# session is exactly the mistake-maker it describes, so the word is stopped a
# layer earlier here. The optional character admits a quote, so
# MIGRATE_TARGET="production" and MIGRATE_TARGET='production' are caught too.
pattern='mcwellness-prod|mcwellness-app|PROD_DATABASE_URL|MIGRATE_TARGET=.?production'
pattern="${pattern}|${OLD_APP_PROJECT_REF}"
if [ -n "$PLATFORM_PRODUCTION_PROJECT_REF" ]; then
  pattern="${pattern}|${PLATFORM_PRODUCTION_PROJECT_REF}"
fi

if echo "$cmd" | grep -Eqi "$pattern"; then
  echo "BLOCKED: this shell command names a production resource. Nothing reaches production from a development shell — not pnpm db:migrate, which cannot anyway, and not a hand-rolled psql or curl. A live pass is a separate, deliberate act: staging first, the operator's word for that pass, and the fingerprint afterwards (docs/PRODUCTION.md). If you are only writing the reference into a note, name the environment instead of the reference." >&2; exit 2; fi
exit 0
