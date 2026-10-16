#!/usr/bin/env bash
# Cuts a release: sets APP_VERSION (app.js), versionName and versionCode + 1
# (build.gradle), commits "Release X.Y.Z" and tags vX.Y.Z. Never pushes.
# The only thing that may change those three lines.
#   scripts/release.sh 0.4.2
set -euo pipefail
NEW="${1:-}"
[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: scripts/release.sh X.Y.Z" >&2; exit 1; }
cd "$(git rev-parse --show-toplevel)"
APPJS=workout-app-ui/public/js/app.js
GRADLE=workout-app-ui/android/app/build.gradle

[ -z "$(git status --porcelain)" ] || { echo "working tree is not clean" >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null; then echo "tag v$NEW exists" >&2; exit 1; fi
OLD="$(sed -n 's/^const APP_VERSION = "\(.*\)";$/\1/p' "$APPJS")"
CODE="$(sed -n 's/^ *versionCode \([0-9][0-9]*\)$/\1/p' "$GRADLE")"
[ -n "$OLD" ] && [ -n "$CODE" ] || { echo "could not read the current version lines" >&2; exit 1; }
newer="$(awk -v a="$OLD" -v b="$NEW" 'BEGIN { split(a, x, "."); split(b, y, ".");
  for (i = 1; i <= 3; i++) { if (y[i] + 0 > x[i] + 0) { print 1; exit } if (y[i] + 0 < x[i] + 0) { print 0; exit } } print 0 }')"
[ "$newer" = 1 ] || { echo "$NEW is not newer than $OLD" >&2; exit 1; }

# temp file + mv instead of sed -i, which differs between GNU and BSD/macOS
edit() { sed "$2" "$1" > "$1.tmp" && mv "$1.tmp" "$1"; }
edit "$APPJS" "s/^const APP_VERSION = \".*\";\$/const APP_VERSION = \"$NEW\";/"
edit "$GRADLE" "s/^\( *versionCode \)[0-9][0-9]*\$/\1$((CODE + 1))/; s/^\( *versionName \)\".*\"\$/\1\"$NEW\"/"
[ "$(git diff --numstat | wc -l | tr -d ' ')" = 2 ] || { echo "unexpected edit, check git diff" >&2; exit 1; }

git add "$APPJS" "$GRADLE"
git commit -q -m "Release $NEW"
git tag -a "v$NEW" -m "Stronger $NEW"
echo "Released $OLD -> $NEW (versionCode $((CODE + 1))), tag v$NEW. Not pushed: git push --follow-tags"
