# AGENTS.md — rules for everyone working on Stronger

Stronger is built by two people, each with their own AI agent (Claude), each
running their own server with their own database. Only the code is shared.
These rules keep that conflict-free. Both people have agreed to them, and every
agent working in this repo follows them. Each person's own CLAUDE.md, memory
and preferences stay private; this file is the shared part.

## Layout

- `workout-app/`: backend. Python standard library only (`server.py` HTTP API,
  `db.py` SQLite schema and queries, `records.py` PRs/1RM, `muscle_scores.py`).
  Optional add-ons stay off unless set in `.env`: Google Calendar
  (`gcal_sync.py`), ICS feed (`ics_feed.py`), Strong CSV mirror (`csv_mirror.py`).
  `backfill_*.py` and `migrate_strong_history.py` are one-off scripts that were
  already applied to one database: don't run or extend them.
- `workout-app-ui/`: plain HTML/CSS/JS PWA, no bundler. Every JS file is one
  `<script>` tag in `public/index.html` and one entry in `public/sw.js`'s
  `SHELL_ASSETS` (offline fallback). `android/` is the optional Capacitor APK.
- `scripts/`: `release.sh`, `leak-scan.sh`. `workout-app-ui/scripts/stamp-build.sh`.

## Once per clone

- `git config core.hooksPath .githooks`: runs the leak scan before every commit.
- Put your personal strings (name, email, home paths, project ids) one regex per
  line into `.git/leak-patterns`. It lives inside `.git`, so it is never shared.

## How a change gets in

1. **Claim first.** Anything bigger than a fix gets an issue or a draft pull
   request before the work starts. Check open pull requests for the same files.
2. **Short-lived branch from `main`, pull request into `main`.** Merge early,
   behind a switch that is off, rather than keeping a long branch.
3. **The author's agent never approves its own pull request.** The other
   person's agent reviews it in a fresh session with the diff, this file and its
   person's preferences. It signs comments `(Claude for <name>)` and marks each
   one blocking, taste or question.
4. **Who has to say yes:**
   - The other side's agent review plus passing checks is enough for: new
     features behind a switch that starts off, new options of an existing
     feature (the old behaviour stays the default), bug fixes, tests, docs,
     refactors with no visible change, and reverts (either person may revert
     anything that broke them).
   - **The other person** (not just their agent) must approve fundamental changes: database
     layout or data, how the backend computes or stores things (PRs, stats,
     sync), the core flows that cannot be switched off (logging, editing,
     finishing and saving a workout), removing a switch or a feature,
     dependencies, CI, deploy, security.
   - Both agents act through their person's GitHub account, so GitHub cannot
     tell an agent's approval from a person's. The rule above is a promise; keep it.
5. **Disagreements:** a disagreement about behaviour is settled by a failing
   test, not by argument. At most two rounds between the agents, then each side
   puts its best case to the people. If they still disagree, it becomes a
   switch, or whoever built the feature decides.

## Every feature is a switch

- New user-facing behaviour gets an entry in `FEATURE_REGISTRY`
  (`public/js/app-features.js`) with `defaultOff: true`, and its code checks
  `featureEnabled("<id>")`. Each person turns on what they want in
  Settings → Workout screen features. The existing entries without
  `defaultOff` are on by default.
- Put a new feature in its own file (plus its `<script>` tag and `SHELL_ASSETS`
  entry) instead of growing `app.js` or another big shared file.
- Tiny polish needs no switch; if the other person would notice or mind, the
  reviewing agent asks for one.

## Lines nobody edits by hand

- `APP_VERSION` (`public/js/app.js`), `versionName` and `versionCode`
  (`android/app/build.gradle`): only `scripts/release.sh` changes them.
- `public/js/build-info.js`: the committed value is `"dev"`. Deploys and APK
  builds stamp the commit into it; never commit a stamped one.
- The service worker cache name follows the build; don't bump it by hand.

## Database

- Migrations only add: new tables, new columns with a default (the
  `_MIGRATIONS` list in `db.py`), new indexes. Never drop, rename or rewrite
  existing columns or data in shared code.
- The two databases have different histories, so a migration must work on any
  existing database: test it on an empty one and on an older copy.
- Fixing your own data is done on your own server, never in shared code.

## Never commit

Databases and their backups, CSV exports, `.env`, `public/js/config.js`, keys,
keystores, tokens, home-network addresses, and personal names, emails or paths.
The hook catches most of these; it is a safety net, not a reason to be careless.

## Code style

- Comments say why, not who asked or when; that goes in the commit message and
  the pull request. Older comments like "ImIceTry's ask" are history: leave them
  unless you are rewriting that code anyway.
- No drive-by reformatting or tidying of code you are not changing.

## Tests

- Backend: `cd workout-app && python3 test_api.py` (throwaway database, own port).
- Exercise search: `node workout-app-ui/tests/exercise-search.test.js`.
- Leak scan over the whole repo: `scripts/leak-scan.sh`.

## Releases and deploys

- Release: on an up-to-date `main` with a clean tree, `scripts/release.sh X.Y.Z`
  (a batch with features: minor bump; only fixes: patch bump), then
  `git push --follow-tags`. Describe user-visible changes in each pull request.
- Each person deploys tagged releases to their own server when they choose. Deploy
  means: check out the tag, run `workout-app-ui/scripts/stamp-build.sh`, and
  restart the backend if `workout-app/` changed. The header then shows
  `v<version>+<commit>`.
- APK: `stamp-build.sh`, `npx cap sync android`, the Gradle build, then
  `stamp-build.sh --reset` so the checkout stays clean.
- The only way one person's code reaches the other's server is a reviewed,
  tagged release that the server's owner deploys.
