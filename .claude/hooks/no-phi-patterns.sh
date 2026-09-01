#!/usr/bin/env bash
# PreToolUse on Write|Edit: block content that looks like real UAE identifiers.
input=$(cat)
content="$input"  # raw JSON; patterns below survive JSON escaping
if echo "$content" | grep -Eq '784-?(19[0-9]{2}|20[0-9]{2})-?[0-9]{7}-?[0-9]' && ! echo "$content" | grep -Eq '784-?1900-'; then
  echo "BLOCKED: content resembles a real Emirates ID. Use db/seed generators (784-1900-* range)." >&2; exit 2; fi
if echo "$content" | grep -Eq '\+?971[ -]?5[0-9][ -]?[0-9]{3}[ -]?[0-9]{4}' && ! echo "$content" | grep -Eq '971[ -]?50[ -]?000'; then
  echo "BLOCKED: content resembles a real UAE mobile number. Use synthetic +971 50 000 xxxx." >&2; exit 2; fi
exit 0
