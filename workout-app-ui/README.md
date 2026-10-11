# Stronger (Workout App)

A self-hosted, single-user workout tracker: a stdlib-only Python backend and
a static (no build step) HTML/CSS/JS frontend, installable as a PWA. Strong's
CSV export format is used as the app's own data model, so history can be
migrated in from a real Strong export and mirrored back out to it.

This is a personal project shared as-is — not a polished multi-tenant
product. It assumes one user and one SQLite database.

## Quick start (Docker)

Needs Docker with the compose plugin. From this directory:

```
docker compose --profile full up -d --build
```

Open <http://localhost:8090>. That starts the web UI (nginx) and the backend
(Python, runs as a non-root user) with an empty database kept in the
`workout-data` Docker volume.

Optional first-run steps — both need internet access and are safe to re-run:

```
docker compose exec workout-api python import_exercise_library.py        # ~900 browsable exercises
docker compose exec workout-api python backfill_instructions.py --apply  # step-by-step instructions for them
```

Both use the public-domain [free-exercise-db](https://github.com/yuhonas/free-exercise-db)
dataset. Instructions are matched by exact exercise name only, so nothing is
guessed at: an exercise with no exact match just has no instructions.

Settings live in a `.env` file next to `docker-compose.yml` (copy
`.env.example`; every value is optional): `UI_PORT`, `UI_CONTAINER_NAME`, and
`API_UPSTREAM` (where `/api/` is proxied to — the bundled backend by default).

**Backing up** the database while the app is running:

```
docker compose exec workout-api python -c "import sqlite3; s=sqlite3.connect('/data/workout.db'); d=sqlite3.connect('/data/backup.db'); s.backup(d)"
docker compose cp workout-api:/data/backup.db ./backup.db
```

**Using it on a phone:** browsers only offer "install as app" and offline
support on `http://localhost` or over HTTPS, so a plain `http://<lan-ip>:8090`
works as a website but not as an installed PWA. Put it behind HTTPS (a
reverse proxy with a certificate, Tailscale, ...) to install it.

## Using the app

- **Quick actions:** swipe left-to-right anywhere on an exercise card (a
  right-to-left swipe on a set row deletes the set) and that exercise's
  actions fan out in a circle around your finger. Lift and tap one, or keep
  holding, drag onto an icon, pause on it for a moment and let go.
- **Handle and grip:** cable and pulldown exercises (and pull-ups/chin-ups,
  grip only) get a handle/grip chip on the card. Both come from fixed lists,
  are stored per set, and carry over from your last session of that exercise.

## Architecture

- `workout-app/` — the backend: `server.py` (stdlib `http.server`, no
  framework), `db.py`, `records.py`/`muscle_scores.py` (PR/1RM/volume and
  per-muscle-group scoring math), `validation.py`, `csv_mirror.py`.
- `workout-app-ui/` (this directory) — the frontend: `public/index.html` +
  `public/js/*.js` (plain global-scope `<script>` files, deliberately not ES
  modules or a bundle, so there is nothing to build) + `public/css/*.css`.
  `android/` is an optional Capacitor wrap, see below.

Nothing here requires Node/npm to run the actual app — `package.json` only
exists for the optional Android build.

## Running without Docker

Needs Python 3.10+ (developed and tested on 3.13) and any web server that can
serve `public/` as static files and reverse-proxy `/api/` to the backend.

### Backend

```
cd workout-app
python3 -m venv .venv
.venv/bin/pip install --upgrade pip   # stdlib-only otherwise, no requirements.txt needed
cp .env.example .env                  # edit if you want anything other than the defaults
.venv/bin/python server.py
```

On first run, `init_db()` creates an empty schema at `WORKOUT_DB_PATH`
(defaults to `workout-app/data/workout.db`) — no seed data, no assumption
that any history already exists. Every list endpoint (`/api/workouts`,
`/api/templates`, `/api/exercises/all`, `/api/muscle-scores`, ...) returns a
clean empty result against a fresh database rather than erroring.

The two optional first-run scripts from the Docker section work the same way:
`.venv/bin/python import_exercise_library.py`, then
`.venv/bin/python backfill_instructions.py --apply`.

See `workout-app/.env.example` for every config var and what it defaults to.

To keep the backend running across reboots with systemd, from `workout-app/`:

```
sudo ./install-service.sh <user>        # renders workout-app.service.template for this checkout
./install-service.sh --print <user>     # just show the unit, install nothing
```

### Frontend

`public/` is served as-is. Two things to set up:

1. **Reverse-proxy `/api/` to the backend.** `nginx.conf.template` is a
   working example (the Docker setup renders it for you); with any other
   server, proxy `/api/` to wherever the backend runs.
2. **Site config (optional)** — copy `public/js/config.example.js` to
   `public/js/config.js` and fill in only what you use (both fields are
   optional, see the file's own comments). It is gitignored on purpose; the
   app works without it.

To run just the UI container against a backend that is already running
natively, set `API_UPSTREAM` in `.env` (e.g. `host.docker.internal:8092` for
the same machine) and run `docker compose up -d` without `--profile full`.

## Optional add-ons

None of these are required for the app to work — every one degrades to "off"
cleanly if left unconfigured.

- **Grafana panel snapshots** (Statistics tab) — set
  `grafanaSnapshotBase` in `config.js` to a URL serving pre-rendered PNG
  snapshots. These are static images fetched by the frontend, not live
  iframes, and no code here renders your Grafana dashboards; you would build
  that pipeline separately. Left unset, those panels just stay blank.
- **Yazio bodyweight import** — set `YAZIO_DB_PATH` to a SQLite file with a
  `weight(date, kg)` table. Missing file → that one endpoint 404s, nothing
  else is affected.
- **CSV mirror** — set `STRONG_EXPORTS_DIR` to have every sync/update also
  write a full Strong-schema CSV export there, for some external pipeline to
  pick up. Unset (the default) disables it entirely; sync/update still work
  identically, the response's `csv_path` just comes back `null`.
- **Capacitor Android wrap** (`android/`) — a native wrapper for the same
  `public/` build. Needs Node + the Android SDK/Gradle; entirely optional,
  the PWA works standalone in any mobile browser without it.
  Before building:
  1. Give it your own application id (it ships as `com.imicetry.workoutapp`),
     and optionally a display name:
     `scripts/set-android-app-id.sh com.yourname.stronger "My Lifter"`.
     This only edits the files listed in the script's header; it does not
     run a build.
  2. Set `nativeApiBase` in `config.js` (see "Frontend" above) to wherever
     the backend is reachable from the phone (e.g. a Tailscale URL) — the
     native build's WebView serves from `https://localhost`, so the relative
     `/api/...` paths the browser/PWA build uses resolve to nowhere. Left
     unset, the app installs and opens fine but every API call silently
     fails with no error shown.
  3. `npm install && npx cap sync android`, then build in Android Studio or
     with Gradle.

## Tests

- Backend: `cd workout-app && .venv/bin/python test_api.py` — starts its own
  server on a scratch database and exercises the API end to end.
- Frontend search logic: `node tests/exercise-search.test.js`.

## Sending it to someone else

`scripts/make-share-bundle.sh [out.tar.gz]` packs the backend and UI from the
working tree (committed or not) into one tarball, leaving out everything
gitignored — databases and their backups, `.env`, `js/config.js`,
`node_modules`, Android build output — plus the reference deployment's own
`nginx.conf`. It refuses to write the bundle if a database, key store, CSV or
private LAN address slipped in. The recipient follows "Quick start" above.

## Licensing

The app's own code doesn't currently carry a licence file — treat it as
"shared as reference, all rights reserved" until that's explicitly decided.
Third-party assets bundled in are separately licensed — see
`public/THIRD_PARTY_NOTICES.md`.

## Data that must never enter a shareable copy of this repo

`workout-app/data/workout.db` (or any `.bak*` copy of it), any Strong CSV
export, `.env` files, and `workout-app-ui/public/js/config.js` — all
gitignored, and the share-bundle script checks for them, but double-check
before ever publishing.
