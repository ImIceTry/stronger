#!/usr/bin/env bash
# Gives the Android wrap your own application id (and optionally a display name)
# before you build it. Without this the app installs as com.imicetry.workoutapp.
#   ./scripts/set-android-app-id.sh com.yourname.stronger ["Display Name"]
# Edits capacitor.config.json, android/app/build.gradle, strings.xml and the
# two source files, and moves their package folder. Safe to re-run.
set -euo pipefail

NEW_ID="${1:-}"
NEW_NAME="${2:-}"
[[ "$NEW_ID" =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$ ]] || {
  echo "Usage: $0 <com.example.app> [\"Display Name\"]  (lowercase letters, digits, underscores, at least two dot-separated parts)" >&2
  exit 1
}

UI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$UI/capacitor.config.json"
OLD_ID="$(sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p' "$CFG")"
[ -n "$OLD_ID" ] || { echo "Couldn't read appId from $CFG" >&2; exit 1; }
OLD_NAME="$(sed -n 's/.*"appName": *"\([^"]*\)".*/\1/p' "$CFG")"

esc() { printf '%s' "$1" | sed 's/[.[\*^$/&|]/\\&/g'; }
JAVA_DIR="$UI/android/app/src/main/java"
OLD_PATH="${OLD_ID//.//}"
NEW_PATH="${NEW_ID//.//}"

if [ "$OLD_ID" != "$NEW_ID" ]; then
  FILES=("$CFG" "$UI/android/app/build.gradle" "$UI/android/app/src/main/res/values/strings.xml")
  while IFS= read -r f; do FILES+=("$f"); done < <(grep -rlF "$OLD_ID" "$JAVA_DIR/$OLD_PATH" 2>/dev/null || true)
  for f in "${FILES[@]}"; do
    sed -i "s|$(esc "$OLD_ID")|$NEW_ID|g" "$f"
  done
  if [ -d "$JAVA_DIR/$OLD_PATH" ]; then
    mkdir -p "$JAVA_DIR/$NEW_PATH"
    mv "$JAVA_DIR/$OLD_PATH"/* "$JAVA_DIR/$NEW_PATH"/
    # drop the now-empty old package folders, innermost first
    d="$JAVA_DIR/$OLD_PATH"
    while [ "$d" != "$JAVA_DIR" ] && rmdir "$d" 2>/dev/null; do d="$(dirname "$d")"; done
  fi
fi

if [ -n "$NEW_NAME" ] && [ "$NEW_NAME" != "$OLD_NAME" ]; then
  name_esc="$(printf '%s' "$NEW_NAME" | sed 's/[&|\\]/\\&/g')"
  sed -i "s|\"appName\": *\"[^\"]*\"|\"appName\": \"$name_esc\"|" "$CFG"
  sed -i -E "s|(<string name=\"(app_name\|title_activity_main)\">)[^<]*|\1$name_esc|" "$UI/android/app/src/main/res/values/strings.xml"
fi

echo "appId: $OLD_ID -> $NEW_ID${NEW_NAME:+, name: \"$NEW_NAME\"}"
echo "Next: set nativeApiBase in public/js/config.js, then: npm install && npx cap sync android"
