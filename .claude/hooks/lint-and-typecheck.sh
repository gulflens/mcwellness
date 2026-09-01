#!/usr/bin/env bash
# PostToolUse on Write|Edit: format and typecheck. Non-blocking; reports back.
input=$(cat)
path=$(printf "%s" "$input" | sed -n 's/.*"file_path":"\([^"]*\)".*/\1/p')
case "$path" in
  *.ts|*.tsx) [ -f package.json ] && { npx -y prettier --write "$path" >/dev/null 2>&1; npx tsc --noEmit -p . 2>&1 | head -30; } ;;
  *.sql) echo "SQL file written: remember the rollback block and your OWNERSHIP migration range." ;;
esac
exit 0
