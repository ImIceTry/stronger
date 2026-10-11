#!/usr/bin/env bash
# Packs the Workout App (backend + UI) into one tarball you can send to someone.
#   ./scripts/make-share-bundle.sh [output.tar.gz]
# Takes the working tree as it is now (committed and uncommitted files), minus
# everything .gitignore hides: databases and their backups, .env, js/config.js,
# node_modules, Android build output. Refuses to write the bundle if anything
# that looks private slipped in.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
OUT="$(realpath -m "${1:-stronger-workout-app-$(date +%Y%m%d).tar.gz}")"
cd "$REPO"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
DEST="$STAGE/stronger-workout-app"
mkdir "$DEST"

# tracked + untracked-but-not-ignored, minus files deleted in the working tree
# and nginx.conf (the reference deployment's own file, with its LAN address)
comm -z -23 \
  <(git ls-files -z -co --exclude-standard -- workout-app workout-app-ui | sort -z) \
  <(git ls-files -z --deleted -- workout-app workout-app-ui | sort -z) |
  grep -zvxF 'workout-app-ui/nginx.conf' |
  tar --null -T - -cf - | tar -xf - -C "$DEST"

cat > "$DEST/START-HERE.txt" <<'TXT'
Stronger (workout app): backend in workout-app/, web/PWA frontend in workout-app-ui/.
Setup instructions: workout-app-ui/README.md (the Docker quick start is at the top).
TXT

BAD="$(cd "$STAGE" && find stronger-workout-app \( -name '*.db' -o -name '*.db-*' -o -name '*.bak*' -o -name '*.csv' \
  -o -name '*.jks' -o -name '*.keystore' -o -name 'local.properties' -o -name 'google-services.json' \
  -o -name '.env' -o -name 'config.js' -o -name node_modules \) -print)"
LAN="$(cd "$STAGE" && grep -rIlE '(^|[^0-9.])(192\.168|10\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.[0-9]{1,3}' stronger-workout-app || true)"
BAD="$(printf '%s\n%s\n' "$BAD" "$(printf '%s' "$LAN" | sed 's/$/ (contains a private LAN address)/')" | sed '/^ *$/d;/^ (contains/d')"
if [ -n "$BAD" ]; then
  echo "Refusing to bundle, these look private:" >&2
  echo "$BAD" >&2
  exit 1
fi

tar -czf "$OUT" -C "$STAGE" stronger-workout-app
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1), $(tar -tzf "$OUT" | grep -vc '/$') files)"
