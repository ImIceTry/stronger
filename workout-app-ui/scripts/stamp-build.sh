#!/usr/bin/env bash
# Writes the current commit into public/js/build-info.js, which the header label
# (v<version>+<commit>) and the service worker's cache name read.
#   scripts/stamp-build.sh           stamp (a deploy checkout, or before `npx cap sync`)
#   scripts/stamp-build.sh --reset   put back the committed "dev" value
# Never commit a stamped build-info.js.
set -euo pipefail
UI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--reset" ]; then
  id=dev
else
  id="$(git -C "$UI" rev-parse --short=7 HEAD)"
  git -C "$UI" diff --quiet HEAD -- . ':(exclude)public/js/build-info.js' || id="$id-dirty"
fi
printf '// Written by scripts/stamp-build.sh; the committed value is "dev".\nself.STRONGER_BUILD = "%s";\n' "$id" \
  > "$UI/public/js/build-info.js"
echo "build-info.js: $id"
