#!/usr/bin/env bash
# PreToolUse on Bash: block commands that touch production.
input=$(cat)
cmd="$input"
if echo "$cmd" | grep -Eqi 'mcwellness-prod|gqvpapvdqcfjlifgwhpk|mcwellness-app|PROD_DATABASE_URL|me-central-1\.rds\.amazonaws'; then
  echo "BLOCKED: production resources are never touched from a Claude Code session. Production changes ship via reviewed migrations in CI." >&2; exit 2; fi
exit 0
