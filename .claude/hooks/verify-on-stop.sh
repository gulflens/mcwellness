#!/usr/bin/env bash
# Stop: run the full verify; if it fails, tell the session to keep working.
if [ -f package.json ] && grep -q '"verify"' package.json; then
  if ! pnpm -s verify >/tmp/verify.log 2>&1; then
    echo "pnpm verify FAILED. Fix before declaring done:"; tail -40 /tmp/verify.log; exit 2
  fi
fi
exit 0
