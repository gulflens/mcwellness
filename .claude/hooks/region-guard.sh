#!/usr/bin/env bash
# PreToolUse on Write|Edit: any AWS region other than me-central-1 is a defect.
input=$(cat)
content="$input"  # raw JSON; patterns below survive JSON escaping
if echo "$content" | grep -Eq '\b(us|eu|ap|sa|ca|af)-(east|west|central|north|south|southeast|northeast)-[0-9]\b'; then
  echo "BLOCKED: non-UAE AWS region detected. Only me-central-1 is permitted for anything that can hold PHI." >&2; exit 2; fi
exit 0
