#!/usr/bin/env bash
# Installs and starts the systemd unit for this checkout.
#   sudo ./install-service.sh [user]     user defaults to whoever ran sudo
#   ./install-service.sh --print [user]  show the unit that would be installed
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRINT=0
if [ "${1:-}" = "--print" ]; then PRINT=1; shift; fi
RUN_USER="${1:-${SUDO_USER:-}}"

[ -n "$RUN_USER" ] && [ "$RUN_USER" != root ] || { echo "Say which user should run it: sudo ./install-service.sh <user>" >&2; exit 1; }
id "$RUN_USER" >/dev/null

PYTHON="$APP_DIR/.venv/bin/python"
[ -x "$PYTHON" ] || PYTHON="$(command -v python3)"

render() {
  sed -e "s|@USER@|$RUN_USER|g" -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@PYTHON@|$PYTHON|g" "$APP_DIR/workout-app.service.template"
}

if [ "$PRINT" -eq 1 ]; then render; exit 0; fi
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
render > /etc/systemd/system/workout-app.service
systemctl daemon-reload
systemctl enable --now workout-app.service
systemctl --no-pager status workout-app.service | head -5
