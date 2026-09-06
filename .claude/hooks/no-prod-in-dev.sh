#!/usr/bin/env bash
# PreToolUse on Bash: block commands that touch production.
# Patterns: the production project name, the previous McWellness app's Supabase
# project (never touched from this repo), the production URL variable, and the
# word that unlocks the migration guard for a production database.
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
  echo "BLOCKED: production resources are never touched from a Claude Code session. Production changes ship via reviewed migrations in CI." >&2; exit 2; fi
exit 0
