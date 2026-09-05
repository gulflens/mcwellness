#!/usr/bin/env bash
# PreToolUse on Bash: block commands that touch production.
# Patterns: the production project name, the previous McWellness app's Supabase
# project (never touched from this repo), and the production URL variable.
input=$(cat)
cmd="$input"

# The previous McWellness app's own production Supabase project. It is a
# different product on the same organisation, and nothing in this repository
# ever reaches it.
OLD_APP_PROJECT_REF='gqvpapvdqcfjlifgwhpk'

# This platform's own production Supabase project, and it is empty because no
# such project exists yet. docs/SPEC/hosting.md section 10 holds its creation
# until the founder's lawyer has answered the region question, because a
# Supabase project's region cannot be changed after the project is created.
# Fill this in with the project reference — the twenty characters in the
# project's URL — on the day the project is created; nothing else in this file
# changes. Until then the migration guard in db/runner/plan.ts stands in its
# place: it refuses any database that is not on this machine unless
# MIGRATE_TARGET names it, so it needs no reference to be complete.
PLATFORM_PRODUCTION_PROJECT_REF=''

pattern='mcwellness-prod|mcwellness-app|PROD_DATABASE_URL'
pattern="${pattern}|${OLD_APP_PROJECT_REF}"
if [ -n "$PLATFORM_PRODUCTION_PROJECT_REF" ]; then
  pattern="${pattern}|${PLATFORM_PRODUCTION_PROJECT_REF}"
fi

if echo "$cmd" | grep -Eqi "$pattern"; then
  echo "BLOCKED: production resources are never touched from a Claude Code session. Production changes ship via reviewed migrations in CI." >&2; exit 2; fi
exit 0
