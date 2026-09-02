#!/usr/bin/env bash
# PreToolUse on Bash: block commands that touch production.
# Patterns: the production project name, the previous McWellness app's Supabase
# project (never touched from this repo), and the production URL variable.
# When the production Supabase project exists, add its project ref here.
input=$(cat)
cmd="$input"
if echo "$cmd" | grep -Eqi 'mcwellness-prod|gqvpapvdqcfjlifgwhpk|mcwellness-app|PROD_DATABASE_URL'; then
  echo "BLOCKED: production resources are never touched from a Claude Code session. Production changes ship via reviewed migrations in CI." >&2; exit 2; fi
exit 0
