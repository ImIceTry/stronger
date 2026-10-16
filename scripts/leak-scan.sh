#!/usr/bin/env bash
# Refuses private material: databases, keys, tokens, home-network addresses, and
# any personal patterns you list one regex per line in .git/leak-patterns (that
# file lives inside .git, so it is never committed).
#   scripts/leak-scan.sh           scan every tracked file
#   scripts/leak-scan.sh --staged  scan what is staged (run by .githooks/pre-commit)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
STAGED=0; [ "${1:-}" = "--staged" ] && STAGED=1
LOCAL="$(git rev-parse --git-common-dir)/leak-patterns"

BAD_NAME='(\.db|\.db-[a-z]+|\.bak[^/]*|\.csv|\.jks|\.keystore|\.pem|(^|/)\.env|(^|/)local\.properties|google-services\.json|(^|/)config\.js|(^|/)node_modules/.*)$'
PATTERNS='BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20}|github_pat_|gserviceaccount\.com|"private_key_id"|@gmail\.com|(^|[^0-9.])(192\.168|10\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.[0-9]{1,3}'

content() { if [ $STAGED = 1 ]; then git show ":$1"; else cat -- "$1"; fi; }
list() { if [ $STAGED = 1 ]; then git diff --cached --name-only -z --diff-filter=ACMR; else git ls-files -z; fi; }

found=""
while IFS= read -r -d '' f; do
  if [[ "$f" =~ $BAD_NAME ]]; then found+="file that looks private: $f"$'\n'; continue; fi
  hits=""
  # this file holds the generic patterns itself
  [ "$f" = scripts/leak-scan.sh ] || hits="$(content "$f" | grep -nIiE "$PATTERNS" | cut -c1-160 || true)"
  if [ -s "$LOCAL" ]; then
    hits+="$(content "$f" | grep -nIiE -f "$LOCAL" | cut -c1-160 || true)"
  fi
  [ -z "$hits" ] || found+="$(printf '%s\n' "$hits" | sed "s|^|$f:|")"$'\n'
done < <(list)

if [ -n "$found" ]; then
  printf 'Leak scan: these look private, nothing was committed:\n%s' "$found" >&2
  exit 1
fi
echo "leak scan: clean"
