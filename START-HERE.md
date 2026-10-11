# START HERE (for you and your Claude)

This is "Stronger": a self-hosted single-user workout tracker (Python stdlib
backend + static HTML/JS PWA frontend, optional Android APK via Capacitor).
Shared as-is by ImIceTry. Your copy is fully separate from his: own database,
own data, nothing connected.

Run it:
  cd stronger/workout-app-ui
  cp .env.example .env        # optional, every value has a default
  docker compose --profile full up -d --build
  open http://localhost:8090

Optional first run (needs internet, safe to re-run):
  docker compose exec workout-api python import_exercise_library.py
  docker compose exec workout-api python backfill_instructions.py --apply

Read workout-app-ui/README.md for the full guide (phone/PWA needs HTTPS or
Tailscale; backups; architecture) and workout-app/.env.example for the
optional backend add-ons (Google Calendar sync, ICS feed, Yazio import,
Strong CSV mirror). All of them are off unless you set them.

Things that are ImIceTry-specific and safe to ignore or remove:
- The Statistics tab uses Grafana snapshots (config.js: grafanaSnapshotBase).
  Leave it unset, or ask Claude to hide that tab.
- backfill_instructions_mapped.py / migrate_strong_history.py are one-off
  scripts for his own history.
- Many code comments say "ImIceTry's ask"; that is just history.

Android APK (optional): copy public/js/config.example.js to config.js, set
nativeApiBase to YOUR server's HTTPS address, then npx cap sync android and
build with Gradle. The PWA in a browser needs none of this.

Suggested first prompt for your Claude: "Read START-HERE.md and
workout-app-ui/README.md, get this running with Docker, then do a clean
fresh-install check and fix anything that breaks."
