#!/usr/bin/env bash
# PreToolUse on Write|Edit: block content that looks like real UAE identifiers.
# Every match is judged on its own, so one synthetic identifier never excuses
# a real-looking one beside it.
input=$(cat)
content="$input"  # raw JSON; patterns below survive JSON escaping
ids=$(echo "$content" | grep -Eo '784-?(19[0-9]{2}|20[0-9]{2})-?[0-9]{7}-?[0-9]' || true)
if [ -n "$ids" ] && echo "$ids" | grep -Evq '^784-?1900-'; then
  echo "BLOCKED: content resembles a real Emirates ID. Use db/seed generators (784-1900-* range)." >&2; exit 2; fi
phones=$(echo "$content" | grep -Eo '\+?971[ -]?5[0-9][ -]?[0-9]{3}[ -]?[0-9]{4}' || true)
if [ -n "$phones" ] && echo "$phones" | grep -Evq '971[ -]?50[ -]?000'; then
  echo "BLOCKED: content resembles a real UAE mobile number. Use synthetic +971 50 000 xxxx." >&2; exit 2; fi
exit 0
