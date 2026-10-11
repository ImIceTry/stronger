"""SQLite access layer for the Workout App. Stdlib-only (sqlite3), no ORM."""
import json
import os
import sqlite3
import time

DB_PATH = os.environ.get("WORKOUT_DB_PATH", os.path.join(os.path.dirname(__file__), "data", "workout.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    source TEXT NOT NULL DEFAULT 'history',
    category TEXT,
    primary_muscles TEXT,
    equipment TEXT
);
CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    name TEXT NOT NULL,
    duration_sec INTEGER,
    workout_notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sets (
    id INTEGER PRIMARY KEY,
    workout_id INTEGER NOT NULL REFERENCES workouts(id),
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    set_order INTEGER NOT NULL,
    weight_kg REAL,
    reps INTEGER,
    rest_after_sec REAL,
    notes TEXT NOT NULL DEFAULT '',
    logged_at TEXT NOT NULL,
    rpe REAL,
    set_type TEXT NOT NULL DEFAULT 'normal'
);
CREATE INDEX IF NOT EXISTS idx_sets_workout ON sets(workout_id);
CREATE INDEX IF NOT EXISTS idx_sets_exercise ON sets(exercise_id);
CREATE TABLE IF NOT EXISTS exercise_sticky_notes (
    exercise_id INTEGER PRIMARY KEY REFERENCES exercises(id),
    note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    source_workout_id INTEGER REFERENCES workouts(id),
    origin TEXT NOT NULL DEFAULT 'primary',
    archived INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    folder_id INTEGER REFERENCES template_folders(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_source ON templates(source_workout_id);
CREATE TABLE IF NOT EXISTS template_folders (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);
-- A "scratch" template (built from nothing, not derived from a real logged
-- workout -- see create_scratch_template) has no source_workout_id to read
-- its exercise list from, so it gets its own directly here instead.
CREATE TABLE IF NOT EXISTS template_exercises (
    id INTEGER PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES templates(id),
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    set_order INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_template_exercises_template ON template_exercises(template_id);
-- Bodyweight history (2026-09-17, Function Expansion Plan item 1.6) -- one
-- row per calendar day, same grain as the Yazio weight export this can
-- import from (see import_yazio_bodyweight). source distinguishes a manual
-- entry from an imported one so a re-run of the Yazio import never
-- silently overwrites an explicit manual correction for the same day.
CREATE TABLE IF NOT EXISTS bodyweight_log (
    id INTEGER PRIMARY KEY,
    logged_at TEXT NOT NULL UNIQUE,
    weight_kg REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_bodyweight_log_date ON bodyweight_log(logged_at);
-- Per-(exercise, variant) effective-weight ratio (2026-09-17) -- some
-- machines display a stack/pin number that isn't the real resistance at
-- the point of contact (a 4:1 pulley lateral-raise machine reading "40"
-- when the true load is 10kg). Keyed by variant, not just exercise_name,
-- because the same exercise can be done on both a normal 1:1 machine and a
-- reduced-ratio one -- only the latter needs an entry here. Looked up once
-- when "Set machine/variant" is saved with a ratio, then snapshotted onto
-- every set logged under that variant (sets.weight_ratio below) rather
-- than joined live at read time, so a later correction to this table can't
-- retroactively change what an already-logged set's own PR/1RM math used.
CREATE TABLE IF NOT EXISTS exercise_variant_ratios (
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    variant TEXT NOT NULL,
    ratio REAL NOT NULL,
    PRIMARY KEY (exercise_id, variant)
);
-- Saved machine adjustments (seat height, back pad, ...) per (exercise,
-- variant), 2026-10-10 (ImIceTry's ask). variant '' = no machine/variant tag.
-- Free-form: `settings` is a JSON list of [name, value] pairs, kept in the
-- order ImIceTry entered them. Only the latest values are kept.
CREATE TABLE IF NOT EXISTS exercise_machine_settings (
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    variant TEXT NOT NULL DEFAULT '',
    settings TEXT NOT NULL,
    PRIMARY KEY (exercise_id, variant)
);
"""


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# Columns added after the original launch -- CREATE TABLE IF NOT EXISTS above
# only covers a fresh install, so an already-existing production DB needs
# these added explicitly. (table, column, ddl-fragment) tuples; idempotent.
_MIGRATIONS = [
    ("exercises", "source", "TEXT NOT NULL DEFAULT 'history'"),
    ("exercises", "category", "TEXT"),
    ("exercises", "primary_muscles", "TEXT"),
    ("exercises", "equipment", "TEXT"),
    ("sets", "rpe", "REAL"),
    ("sets", "set_type", "TEXT NOT NULL DEFAULT 'normal'"),
    ("sets", "duration_sec", "REAL"),
    ("exercises", "unit_type", "TEXT NOT NULL DEFAULT 'weight_reps'"),
    ("templates", "folder_id", "INTEGER REFERENCES template_folders(id)"),
    # Orthogonal to set_type (drop/failure/warmup describe how hard a set was
    # pushed; unilateral describes which limb(s) did the work) -- a one-arm
    # set logs a real weight_kg that isn't comparable to the same exercise's
    # two-handed/two-legged numbers, which is exactly what made a one-handed
    # Curl session (2026-09-15) misread as a strength crash before this
    # existed. Kept as its own flag rather than a set_type value so a set can
    # in principle be both (e.g. a one-handed drop set), and it isn't
    # arm-specific -- a single-leg press is unilateral too.
    ("sets", "unilateral", "INTEGER NOT NULL DEFAULT 0"),
    # Step-by-step form cues for the exercise-detail About tab (2026-09-16,
    # ImIceTry's ask). Stored as newline-separated steps rather than a JSON
    # array -- this column is populated from real sourced text (see
    # backfill_instructions.py), never generated, so there's no need for
    # richer structure than "one step per line."
    ("exercises", "instructions", "TEXT"),
    # Free-text machine/variant tag (2026-09-17, Function Expansion Plan item
    # 3.2). Same exercise name, different physical equipment has already
    # caused two real multi-session data corrections this project (Leg
    # Press/Seated Leg Press, Bicep Curl->Preacher Curl->Reverse Curl) --
    # this lets that distinction be recorded at log time instead of
    # discovered and untangled months later. Free text, not an enum: the
    # actual variants ("old machine", "4-pulley", "plate-loaded") are
    # exercise-specific and not worth a fixed vocabulary. NULL means "not
    # specified," not "the default machine" -- most exercises only ever have
    # one, so most sets will never set this.
    ("sets", "variant", "TEXT"),
    # Which limb did the work on a unilateral set (2026-09-17, Function
    # Expansion Plan item 3.1). 'left'/'right'/NULL -- NULL is the default
    # and means "unspecified" (both sides logged with the same numbers, or
    # simply not tracked at this granularity), not "neither side." Only
    # meaningful when unilateral=1; a bilateral set's side is always NULL.
    # Kept separate from `unilateral` itself (rather than replacing the
    # boolean with a 3-value side field) so every existing unilateral query
    # in records.py keeps working unchanged -- this is a further refinement
    # of an already-unilateral set, not a different concept.
    ("sets", "side", "TEXT"),
    # Exercise-level default (2026-09-17, Function Expansion Plan item 1.3)
    # replacing the repeated manual DB surgery this project kept doing to
    # retroactively mark an exercise's *entire* history unilateral (Reverse
    # Fly, Lateral Raise, Triceps Extension) -- lets that be set once via the
    # exercise options menu so every *future* set defaults to Unilateral
    # already checked, instead of a per-set tap every single time. Deliberately
    # only a default for new sets, not a retroactive rewrite of old ones --
    # this project's own guardrail is that retroactive data changes need
    # ImIceTry's explicit sign-off, and this column never touches `sets` at all.
    ("exercises", "default_unilateral", "INTEGER NOT NULL DEFAULT 0"),
    # Persistent per-exercise rest default (2026-09-17, Function Expansion
    # Plan item 1.3, remaining sub-scope). NULL means "use the app's global
    # 90s default" -- deliberately not another hardcoded number, since most
    # exercises should just inherit whatever REST_SECONDS_DEFAULT already
    # is rather than needing an explicit row value that could quietly go
    # stale if that constant ever changes. Distinct from restOverrides
    # (workout-local, resets every workout) -- this is the thing that
    # persists across workouts, which "set default rest" always meant but
    # never had a place to live before this column existed.
    ("exercises", "default_rest_sec", "INTEGER"),
    # Snapshotted at log time from exercise_variant_ratios (2026-09-17) --
    # see that table's own comment for why this isn't a live join. Defaults
    # to 1.0 (no adjustment) for every set that never touches a
    # reduced/increased-ratio variant, which is the overwhelming majority --
    # records.py's PR/1RM/volume math multiplies weight_kg by this
    # unconditionally, so existing data is unaffected (1.0 is a no-op).
    ("sets", "weight_ratio", "REAL NOT NULL DEFAULT 1.0"),
    # Replaces set_type "failure" (2026-09-18, ImIceTry's ask) -- Failure never
    # showed anywhere in History and duplicated what RPE 10 already means, so
    # it was dead weight as its own toggle. "assisted" is a genuinely
    # different concept (a spotter/machine helped on some reps at the end),
    # worth tracking as its own set_type value with this count alongside it.
    # NULL for every set that isn't assisted (the overwhelming majority) --
    # only meaningful when set_type = 'assisted'.
    ("sets", "assisted_reps", "INTEGER"),
    # Cable handle/attachment and grip used for a set (2026-10-06, ImIceTry's
    # ask). Fixed vocabularies, validated in validation.py (HANDLES/GRIPS).
    # NULL = not specified. Separate from `variant`, which is a free-text
    # machine tag with a weight ratio; these never affect weight math.
    ("sets", "handle", "TEXT"),
    ("sets", "grip", "TEXT"),
    # Decoupled from source_workout_id/updated_at (2026-09-22, ImIceTry's ask,
    # reversing part of 2026-09-16's "templates stay fixed" decision): the
    # displayed date on a template's Home card should track the last time it
    # was actually logged from at all, even on a "keep as is" (no
    # content-updating) log -- but the exercise-list PREVIEW must stay
    # exactly as fixed as 2026-09-16 intended, so this can't just be folded
    # into source_workout_id the way the exact-match "update template" path
    # already does. NULL until first touched; list_templates/get_template's
    # plain dict(row) already surfaces it with no extra code needed there.
    ("templates", "last_logged_at", "TEXT"),
    # Per-exercise override for the weight-hint's double-progression rep
    # ceiling (2026-09-24, ImIceTry's ask, replacing the old "matches your
    # historical best reps" check -- that compared against your own past
    # RPE-10 attempts, so once you'd ever hit a rep count at max effort,
    # merely tying it again at RPE 10 falsely read as "you've got room,"
    # forever, with no real progression happening). NULL means "use the
    # app-wide default (12)" -- see REP_CEILING_DEFAULT in app.js.
    ("exercises", "rep_ceiling", "INTEGER"),
    # Google Calendar event id for this workout (gcal_sync.py). NULL = not
    # synced yet.
    ("workouts", "calendar_event_id", "TEXT"),
]


def _run_migrations(conn):
    for table, column, ddl in _MIGRATIONS:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
    conn.commit()
    _migrate_templates_nullable_source(conn)


# SQLite can't ALTER COLUMN to drop a NOT NULL constraint -- the production
# `templates` table was created (2026-09-10, earlier the same day) with
# source_workout_id NOT NULL, before scratch templates (create_scratch_template,
# no source workout at all) existed. Rebuild the table the standard SQLite
# way: rename, recreate with the real target schema, copy rows, drop the old
# one. Runs once -- a second call finds source_workout_id already nullable
# and does nothing.
#
# By default SQLite helpfully rewrites every OTHER table's stored
# "REFERENCES templates(id)" (template_exercises included) to point at the
# renamed templates_pre20260910 table, which then breaks as soon as that
# table is dropped below. Both foreign_keys=OFF *and* legacy_alter_table=ON
# are needed together to suppress that rewrite -- verified directly (neither
# alone is enough on SQLite 3.46: foreign_keys=ON overrides legacy_alter_table
# even when the latter is set). get_conn() always starts a connection with
# foreign_keys=ON, so this always has to turn it off first.
def _migrate_templates_nullable_source(conn):
    cols = conn.execute("PRAGMA table_info(templates)").fetchall()
    source_col = next((c for c in cols if c["name"] == "source_workout_id"), None)
    if source_col is None or source_col["notnull"] == 0:
        return
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("PRAGMA legacy_alter_table = ON")
    conn.execute("ALTER TABLE templates RENAME TO templates_pre20260910")
    conn.execute(
        """CREATE TABLE templates (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            source_workout_id INTEGER REFERENCES workouts(id),
            origin TEXT NOT NULL DEFAULT 'primary',
            archived INTEGER NOT NULL DEFAULT 0,
            deleted INTEGER NOT NULL DEFAULT 0,
            folder_id INTEGER REFERENCES template_folders(id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"""
    )
    conn.execute(
        """INSERT INTO templates (id, name, source_workout_id, origin, archived, deleted, folder_id, created_at, updated_at)
           SELECT id, name, source_workout_id, origin, archived, deleted, folder_id, created_at, updated_at
           FROM templates_pre20260910"""
    )
    conn.execute("DROP TABLE templates_pre20260910")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_templates_source ON templates(source_workout_id)")
    conn.commit()
    conn.execute("PRAGMA legacy_alter_table = OFF")
    conn.execute("PRAGMA foreign_keys = ON")


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_conn()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
        _run_migrations(conn)
    finally:
        conn.close()


def _now_iso():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def get_or_create_exercise(conn, name):
    name = name.strip()
    row = conn.execute("SELECT id FROM exercises WHERE name = ?", (name,)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute("INSERT INTO exercises (name) VALUES (?)", (name,))
    return cur.lastrowid


def sync_workout(conn, name, started_at, finished_at, duration_sec, workout_notes, sets):
    """Atomically create one finished workout + all its sets. The frontend builds
    a whole workout client-side (so logging never depends on a network round trip
    for an ID) and calls this exactly once, on finish -- so there's no partial-state
    ID-dependency problem to solve for the offline queue.

    Idempotent on started_at (2026-09-30): a sync whose response got lost
    (signal drops after the server committed) is replayed from the offline
    queue, and two overlapping queue flushes can send the same payload
    twice. started_at is stamped client-side to the second when the workout
    starts, so a second workout with the same value can only be a replay --
    return the existing id instead of inserting a duplicate. BEGIN IMMEDIATE
    takes the write lock before the check, so two concurrent replays
    serialize instead of both passing it.

    Returns (workout_id, created)."""
    conn.execute("BEGIN IMMEDIATE")
    existing = conn.execute("SELECT id FROM workouts WHERE started_at = ?", (started_at,)).fetchone()
    if existing:
        conn.rollback()
        return existing["id"], False
    cur = conn.execute(
        "INSERT INTO workouts (started_at, finished_at, name, duration_sec, workout_notes) "
        "VALUES (?, ?, ?, ?, ?)",
        (started_at, finished_at, name, duration_sec, workout_notes or ""),
    )
    workout_id = cur.lastrowid
    _insert_sets(conn, workout_id, started_at, sets)
    conn.commit()
    return workout_id, True


def _insert_sets(conn, workout_id, started_at, sets):
    for s in sets:
        exercise_id = get_or_create_exercise(conn, s["exercise_name"])
        side = s.get("side")
        side = side if side in ("left", "right") else None
        conn.execute(
            """INSERT INTO sets (workout_id, exercise_id, set_order, weight_kg, reps,
               rest_after_sec, notes, logged_at, rpe, set_type, duration_sec, unilateral, variant, side, weight_ratio, assisted_reps, handle, grip)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                workout_id, exercise_id, s["set_order"], s.get("weight_kg"), s.get("reps"),
                s.get("rest_after_sec"), s.get("notes", ""), s.get("logged_at") or started_at,
                s.get("rpe"), s.get("set_type", "normal"), s.get("duration_sec"),
                1 if s.get("unilateral") else 0, (s.get("variant") or "").strip() or None, side,
                s.get("weight_ratio") or 1.0, s.get("assisted_reps"),
                s.get("handle") or None, s.get("grip") or None,
            ),
        )


def update_workout(conn, workout_id, name, sets, workout_notes=None):
    """Replace an already-synced workout's sets wholesale -- simplest correct
    way to support editing without diffing old vs new sets. workout_notes
    defaults to None (leave whatever's already stored alone) rather than ""
    (blank it) -- callers that don't know about the field yet (there were
    none doing so until 2026-09-17, item 2.4) shouldn't silently wipe a real
    note just by editing a workout's sets."""
    workout = conn.execute("SELECT started_at FROM workouts WHERE id = ?", (workout_id,)).fetchone()
    if workout is None:
        return False
    if workout_notes is not None:
        conn.execute("UPDATE workouts SET name = ?, workout_notes = ? WHERE id = ?", (name, workout_notes, workout_id))
    else:
        conn.execute("UPDATE workouts SET name = ? WHERE id = ?", (name, workout_id))
    conn.execute("DELETE FROM sets WHERE workout_id = ?", (workout_id,))
    _insert_sets(conn, workout_id, workout["started_at"], sets)
    conn.commit()
    return True


def get_exercise_default_unilateral(conn, exercise_name):
    """False for an exercise that doesn't exist yet (get_or_create_exercise
    only runs on the write side, set_exercise_default_unilateral) -- a brand
    new exercise typed into a workout but never synced has no row to read
    from yet, and "not marked as always-unilateral" is the correct default
    for that case anyway."""
    row = conn.execute(
        "SELECT default_unilateral FROM exercises WHERE name = ?", (exercise_name.strip(),)
    ).fetchone()
    return bool(row["default_unilateral"]) if row else False


def set_exercise_default_unilateral(conn, exercise_name, value):
    exercise_id = get_or_create_exercise(conn, exercise_name)
    conn.execute("UPDATE exercises SET default_unilateral = ? WHERE id = ?", (1 if value else 0, exercise_id))
    conn.commit()


def get_exercise_default_rest(conn, exercise_name):
    """None for an exercise with no row yet, or one that's never had a
    default set -- both correctly mean "fall back to the app's own global
    default," same reasoning as get_exercise_default_unilateral's False."""
    row = conn.execute(
        "SELECT default_rest_sec FROM exercises WHERE name = ?", (exercise_name.strip(),)
    ).fetchone()
    return row["default_rest_sec"] if row else None


def set_exercise_default_rest(conn, exercise_name, value):
    """value=None clears back to "use the app default" rather than storing
    some other sentinel -- symmetric with what a fresh row already means."""
    exercise_id = get_or_create_exercise(conn, exercise_name)
    conn.execute("UPDATE exercises SET default_rest_sec = ? WHERE id = ?", (value, exercise_id))
    conn.commit()


def get_exercise_rep_ceiling(conn, exercise_name):
    """None for an exercise with no row yet, or one that's never had an
    override set -- both correctly mean "fall back to the app's own global
    default," same reasoning as get_exercise_default_rest's None."""
    row = conn.execute(
        "SELECT rep_ceiling FROM exercises WHERE name = ?", (exercise_name.strip(),)
    ).fetchone()
    return row["rep_ceiling"] if row else None


def set_exercise_rep_ceiling(conn, exercise_name, value):
    """value=None clears back to "use the app default" rather than storing
    some other sentinel -- symmetric with what a fresh row already means."""
    exercise_id = get_or_create_exercise(conn, exercise_name)
    conn.execute("UPDATE exercises SET rep_ceiling = ? WHERE id = ?", (value, exercise_id))
    conn.commit()


def get_all_variant_ratios(conn, exercise_name):
    """{variant: ratio} for every variant of this exercise that has a
    non-default ratio saved -- an exercise with no row yet, or no ratios
    saved for any of its variants, correctly returns {} (every set defaults
    to weight_ratio=1.0 already, nothing further to look up)."""
    row = conn.execute("SELECT id FROM exercises WHERE name = ?", (exercise_name.strip(),)).fetchone()
    if row is None:
        return {}
    rows = conn.execute(
        "SELECT variant, ratio FROM exercise_variant_ratios WHERE exercise_id = ?", (row["id"],)
    ).fetchall()
    return {r["variant"]: r["ratio"] for r in rows}


def set_variant_ratio(conn, exercise_name, variant, ratio):
    """ratio=None or 1.0 deletes the row rather than storing a no-op entry
    -- keeps the table to only the variants that actually need an
    adjustment, and means a set logged under a variant with no row here
    correctly falls back to weight_ratio=1.0 with no lookup miss to handle
    specially."""
    exercise_id = get_or_create_exercise(conn, exercise_name)
    if ratio is None or ratio == 1.0:
        conn.execute(
            "DELETE FROM exercise_variant_ratios WHERE exercise_id = ? AND variant = ?",
            (exercise_id, variant),
        )
    else:
        conn.execute(
            """INSERT INTO exercise_variant_ratios (exercise_id, variant, ratio) VALUES (?, ?, ?)
               ON CONFLICT (exercise_id, variant) DO UPDATE SET ratio = excluded.ratio""",
            (exercise_id, variant, ratio),
        )
    conn.commit()


def get_machine_settings(conn, exercise_name):
    """{variant: [[name, value], ...]} for every variant ('' = untagged)
    of this exercise that has saved machine settings."""
    row = conn.execute("SELECT id FROM exercises WHERE name = ?", (exercise_name.strip(),)).fetchone()
    if row is None:
        return {}
    rows = conn.execute(
        "SELECT variant, settings FROM exercise_machine_settings WHERE exercise_id = ?", (row["id"],)
    ).fetchall()
    return {r["variant"]: json.loads(r["settings"]) for r in rows}


def set_machine_settings(conn, exercise_name, variant, settings):
    """settings = list of (name, value) pairs; an empty list deletes the row."""
    exercise_id = get_or_create_exercise(conn, exercise_name)
    if not settings:
        conn.execute(
            "DELETE FROM exercise_machine_settings WHERE exercise_id = ? AND variant = ?",
            (exercise_id, variant),
        )
    else:
        conn.execute(
            """INSERT INTO exercise_machine_settings (exercise_id, variant, settings) VALUES (?, ?, ?)
               ON CONFLICT (exercise_id, variant) DO UPDATE SET settings = excluded.settings""",
            (exercise_id, variant, json.dumps(settings)),
        )
    conn.commit()


def log_bodyweight(conn, date, weight_kg, source="manual"):
    """Upsert on date -- one real weight per day, same grain Yazio's own
    export already uses, so re-logging the same day (manual correction, or
    a re-run of the Yazio import) always means "update", never a duplicate
    row."""
    conn.execute(
        """INSERT INTO bodyweight_log (logged_at, weight_kg, source) VALUES (?, ?, ?)
           ON CONFLICT(logged_at) DO UPDATE SET weight_kg = excluded.weight_kg, source = excluded.source""",
        (date, weight_kg, source),
    )
    conn.commit()


def list_bodyweight(conn, limit=None):
    query = "SELECT logged_at, weight_kg, source FROM bodyweight_log ORDER BY logged_at DESC"
    params = []
    if limit:
        query += " LIMIT ?"
        params.append(limit)
    rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def import_yazio_bodyweight(conn, yazio_db_path):
    """Pulls the Yazio nutrition pipeline's own daily weight series (already
    parsed into db-snapshot/yazio.db by ~/services/grafana's hourly
    refresh) rather than asking ImIceTry to re-enter data that's already
    being tracked elsewhere. Only ever writes rows still tagged 'yazio' --
    a day he's since manually corrected here (source='manual') is left
    alone on every future re-run, not silently overwritten by a resync."""
    if not os.path.exists(yazio_db_path):
        raise FileNotFoundError(f"Yazio snapshot not found at {yazio_db_path}")
    yazio_conn = sqlite3.connect(yazio_db_path)
    try:
        rows = yazio_conn.execute("SELECT date, kg FROM weight WHERE kg IS NOT NULL").fetchall()
    finally:
        yazio_conn.close()
    imported = 0
    for date, kg in rows:
        cur = conn.execute(
            """INSERT INTO bodyweight_log (logged_at, weight_kg, source) VALUES (?, ?, 'yazio')
               ON CONFLICT(logged_at) DO UPDATE SET weight_kg = excluded.weight_kg
               WHERE bodyweight_log.source = 'yazio'""",
            (date, kg),
        )
        imported += cur.rowcount
    conn.commit()
    return imported


def exercise_autocomplete(conn, query, limit=20):
    query = (query or "").strip()
    if not query:
        rows = conn.execute("SELECT name FROM exercises ORDER BY name LIMIT ?", (limit,)).fetchall()
    else:
        rows = conn.execute(
            "SELECT name FROM exercises WHERE name LIKE ? ORDER BY name LIMIT ?",
            (f"%{query}%", limit),
        ).fetchall()
    return [r["name"] for r in rows]


def get_sticky_note(conn, exercise_name):
    """Persists across future workouts for this exercise -- Strong's own
    distinction from a regular (this-workout-only) note. Returns None if the
    exercise doesn't exist or has no sticky note, "" is never stored (an
    emptied note deletes the row instead, see set_sticky_note)."""
    row = conn.execute(
        """SELECT sn.note FROM exercise_sticky_notes sn
           JOIN exercises e ON e.id = sn.exercise_id WHERE e.name = ?""",
        (exercise_name.strip(),),
    ).fetchone()
    return row["note"] if row else None


def set_sticky_note(conn, exercise_name, note):
    """Upsert if note is non-empty; delete the row if emptied -- an empty
    sticky note and "no sticky note" are the same state, no reason to keep
    a row of empty string around."""
    exercise_id = get_or_create_exercise(conn, exercise_name)
    note = (note or "").strip()
    if note:
        conn.execute(
            """INSERT INTO exercise_sticky_notes (exercise_id, note) VALUES (?, ?)
               ON CONFLICT(exercise_id) DO UPDATE SET note = excluded.note""",
            (exercise_id, note),
        )
    else:
        conn.execute("DELETE FROM exercise_sticky_notes WHERE exercise_id = ?", (exercise_id,))
    conn.commit()


def list_exercises(conn):
    """Full alphabetical list for the Exercises tab -- name + category subtitle
    when available (library-sourced only; history-only exercises just show the
    name, per the "keep it uniform, no About tab" decision -- this is just a
    subtitle in a list row, not a full metadata page). unit_type lets the
    frontend branch weight_reps/time/reps_only UI off one source of truth
    instead of re-deriving it from raw sets.

    times_performed/last_performed (2026-09-15, ImIceTry's ask for a frequency
    counter + a sort-by-frequency/last-performed option) count distinct
    *workout sessions* the exercise appeared in, not raw sets -- "how often
    did I do this" naturally means "how many times I've gone and done it,"
    not "how many sets," and three sets in one session shouldn't look like
    doing it three times. Both are 0/None for the ~870 library exercises
    ImIceTry has never actually logged."""
    rows = conn.execute(
        """SELECT e.name, e.source, e.category, e.unit_type,
                  COUNT(DISTINCT s.workout_id) AS times_performed,
                  MAX(w.started_at) AS last_performed
           FROM exercises e
           LEFT JOIN sets s ON s.exercise_id = e.id
           LEFT JOIN workouts w ON w.id = s.workout_id
           GROUP BY e.id
           ORDER BY e.name"""
    ).fetchall()
    return [dict(r) for r in rows]


def exercise_about(conn, exercise_name):
    """Category/equipment/muscles/instructions for the exercise-detail About
    tab (2026-09-16, ImIceTry's ask) -- static reference info, not derived from
    logged sets like every other exercise-detail tab. muscles is split into
    primary/secondary lists (reusing the same "name:0.5 = secondary" encoding
    records.py's _parse_muscles established) so the UI can label them
    distinctly instead of showing one flat list. instructions is None (not
    an empty list) when nothing's been sourced for this exercise yet --
    most of ImIceTry's own history-logged exercises don't match the imported
    library by name (see import_exercise_library.py's own note on this),
    so this is the common case, not an edge case."""
    row = conn.execute(
        "SELECT category, equipment, primary_muscles, instructions, unit_type FROM exercises WHERE name = ?",
        (exercise_name.strip(),),
    ).fetchone()
    if row is None:
        return None

    primary, secondary = [], []
    for token in (row["primary_muscles"] or "").split(","):
        token = token.strip()
        if not token:
            continue
        if ":" in token:
            name, _weight = token.split(":", 1)
            secondary.append(name.strip())
        else:
            primary.append(token)

    instructions = row["instructions"].split("\n") if row["instructions"] else None

    return {
        "category": row["category"],
        "equipment": row["equipment"],
        "primary_muscles": primary,
        "secondary_muscles": secondary,
        "instructions": instructions,
        "unit_type": row["unit_type"],
        # Raw, unparsed forms alongside the display-ready lists above --
        # 2026-09-17, Function Expansion Plan item 1.3's editor needs the
        # exact stored encoding ("name" primary, "name:0.5" secondary; one
        # instruction step per newline) to edit and write back without
        # re-deriving it from the already-split lists, which would lose the
        # real secondary-weight values were any ever anything other than 0.5.
        "raw_primary_muscles": row["primary_muscles"] or "",
        "raw_instructions": row["instructions"] or "",
    }


def set_exercise_details(conn, exercise_name, category, equipment, raw_primary_muscles, unit_type, raw_instructions):
    """Writes exactly the fields exercise_about's editor surfaces, in the
    same raw encoding it reads them in -- category/equipment/unit_type
    verbatim, primary_muscles and instructions as their real stored strings
    (comma-separated with ":weight" secondary markers; newline-separated
    steps), never re-parsed through the display-list round-trip."""
    exercise_id = get_or_create_exercise(conn, exercise_name)
    conn.execute(
        """UPDATE exercises SET category = ?, equipment = ?, primary_muscles = ?, unit_type = ?, instructions = ?
           WHERE id = ?""",
        (category or None, equipment or None, raw_primary_muscles or None, unit_type, raw_instructions or None, exercise_id),
    )
    conn.commit()


def last_performance(conn, exercise_name):
    row = conn.execute(
        "SELECT id, unit_type FROM exercises WHERE name = ?", (exercise_name.strip(),)
    ).fetchone()
    if row is None:
        return None
    exercise_id, unit_type = row["id"], row["unit_type"]
    # Most recent by workout date, not by set id (2026-09-30 fix):
    # update_workout re-inserts every set of an edited workout, so editing an
    # older session gave its sets the newest ids and made it read as "last
    # time" -- the PREVIOUS column/prefill/weight hint then showed a stale
    # session (5 real exercises pointed at #258 instead of #260).
    last_workout = conn.execute(
        """SELECT s.workout_id, w.started_at FROM sets s JOIN workouts w ON w.id = s.workout_id
           WHERE s.exercise_id = ? ORDER BY w.started_at DESC, s.workout_id DESC LIMIT 1""",
        (exercise_id,),
    ).fetchone()
    if last_workout is None:
        return None
    sets = conn.execute(
        """SELECT set_order, weight_kg, reps, rpe, set_type, duration_sec, unilateral, variant, side, weight_ratio, assisted_reps, handle, grip FROM sets
           WHERE workout_id = ? AND exercise_id = ? ORDER BY set_order""",
        (last_workout["workout_id"], exercise_id),
    ).fetchall()
    return {
        "workout_id": last_workout["workout_id"],
        "date": last_workout["started_at"],
        "unit_type": unit_type,
        "sets": [{**dict(s), "unilateral": bool(s["unilateral"])} for s in sets],
    }


def exercise_context(conn, exercise_name):
    """Everything the active-workout screen needs for one exercise card, in
    one response (2026-09-30) -- replaces the seven GETs the frontend used
    to fire per exercise (/last, /sticky-note, /default-unilateral,
    /default-rest, /rep-ceiling, /variant-ratios, plus the 139 KB
    /exercises/all just for unit_type), each re-rendering the card on
    arrival. Same values those endpoints return; they stay for installed
    builds that predate this one. unit_type is None for a name with no
    exercises row yet (the frontend defaults it to weight_reps)."""
    row = conn.execute("SELECT unit_type FROM exercises WHERE name = ?", (exercise_name.strip(),)).fetchone()
    return {
        "last": last_performance(conn, exercise_name),
        "unit_type": row["unit_type"] if row else None,
        "sticky_note": get_sticky_note(conn, exercise_name),
        "default_unilateral": get_exercise_default_unilateral(conn, exercise_name),
        "default_rest_sec": get_exercise_default_rest(conn, exercise_name),
        "rep_ceiling": get_exercise_rep_ceiling(conn, exercise_name),
        "variant_ratios": get_all_variant_ratios(conn, exercise_name),
        "machine_settings": get_machine_settings(conn, exercise_name),
    }


def exercise_history(conn, exercise_name):
    """Past sessions performing this exercise -- History tab on the exercise
    detail page. PR flag is computed by the caller (records.flag_session_prs /
    flag_duration_prs) since it needs to know about every other exercise's
    sets too, not just this table."""
    row = conn.execute("SELECT id FROM exercises WHERE name = ?", (exercise_name.strip(),)).fetchone()
    if row is None:
        return None
    exercise_id = row["id"]
    rows = conn.execute(
        """SELECT s.id AS set_id, s.workout_id, s.set_order, s.weight_kg, s.reps, s.rpe, s.set_type,
                  s.duration_sec, s.unilateral, s.variant, s.side, s.weight_ratio, s.assisted_reps, s.handle, s.grip, w.name AS workout_name, w.started_at
           FROM sets s JOIN workouts w ON w.id = s.workout_id
           WHERE s.exercise_id = ? ORDER BY w.started_at DESC, s.id""",
        (exercise_id,),
    ).fetchall()

    sessions = {}
    order = []
    for r in rows:
        wid = r["workout_id"]
        if wid not in sessions:
            sessions[wid] = {"workout_id": wid, "workout_name": r["workout_name"], "started_at": r["started_at"], "sets": []}
            order.append(wid)
        sessions[wid]["sets"].append(dict(r))
    return [sessions[wid] for wid in order]


def list_workouts(conn, date_from=None, date_to=None, limit=None):
    """Volume/set_count are cheap to compute via one aggregate join, unlike
    PR count (needs a historical baseline per exercise) -- that one is left
    to the caller to attach only for the rows actually being rendered."""
    query = """
        SELECT w.id, w.started_at, w.finished_at, w.name, w.duration_sec,
               COALESCE(SUM(s.weight_kg * s.weight_ratio * s.reps), 0) AS volume_kg,
               COUNT(s.id) AS set_count
        FROM workouts w
        LEFT JOIN sets s ON s.workout_id = w.id AND s.weight_kg IS NOT NULL AND s.reps IS NOT NULL
        WHERE 1=1
    """
    params = []
    if date_from:
        query += " AND w.started_at >= ?"
        params.append(date_from)
    if date_to:
        query += " AND w.started_at <= ?"
        params.append(date_to)
    query += " GROUP BY w.id ORDER BY w.started_at DESC"
    if limit:
        query += " LIMIT ?"
        params.append(limit)
    rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def get_workout_detail(conn, workout_id):
    workout = conn.execute("SELECT * FROM workouts WHERE id = ?", (workout_id,)).fetchone()
    if workout is None:
        return None
    rows = conn.execute(
        """SELECT s.set_order, s.weight_kg, s.reps, s.rest_after_sec, s.notes, s.rpe, s.set_type,
                  s.duration_sec, s.unilateral, s.variant, s.side, s.weight_ratio, s.assisted_reps, s.handle, s.grip, e.name AS exercise_name
           FROM sets s JOIN exercises e ON e.id = s.exercise_id
           WHERE s.workout_id = ? ORDER BY s.id""",
        (workout_id,),
    ).fetchall()
    return {
        "id": workout["id"],
        "started_at": workout["started_at"],
        "finished_at": workout["finished_at"],
        "name": workout["name"],
        "duration_sec": workout["duration_sec"],
        "workout_notes": workout["workout_notes"],
        "sets": [{**dict(r), "unilateral": bool(r["unilateral"])} for r in rows],
    }


def delete_workout(conn, workout_id):
    """Permanently deletes a workout and its sets (2026-09-16, ImIceTry's ask
    for a real Delete option in the workout-detail menu -- History previously
    only offered Edit). Refuses if any template still points at this workout
    as its source_workout_id (templates.source_workout_id REFERENCES
    workouts(id), enforced -- foreign_keys=ON in get_conn() -- with no ON
    DELETE action, so this would otherwise fail with a raw
    FOREIGN KEY constraint error instead of a real explanation) -- happens
    when it's the most recent session of that name, which real templates
    stay pointed at. Deliberately doesn't try to auto-reassign the template
    to a different source workout; that's a real product decision (which one?
    orphan the template instead?), not something to silently guess at."""
    workout = conn.execute("SELECT id FROM workouts WHERE id = ?", (workout_id,)).fetchone()
    if workout is None:
        return False
    blocking = conn.execute(
        "SELECT name FROM templates WHERE source_workout_id = ? AND deleted = 0",
        (workout_id,),
    ).fetchone()
    if blocking:
        raise ValueError(
            f"Can't delete -- template \"{blocking['name']}\" still uses this workout as its source. "
            "Delete or repoint that template first."
        )
    conn.execute("DELETE FROM sets WHERE workout_id = ?", (workout_id,))
    conn.execute("DELETE FROM workouts WHERE id = ?", (workout_id,))
    conn.commit()
    return True


def materialize_template(conn, name, source_workout_id):
    """A template card on the Home screen starts out 'virtual' -- just the
    most recent workout of a given name, no row here at all. The first time
    it's acted on (rename/archive/duplicate/delete), the frontend calls this
    to get a real id to act against. Idempotent: replays against the same
    source workout return the same primary row rather than piling up
    duplicates if a card is materialized twice (e.g. a stale cache)."""
    existing = conn.execute(
        "SELECT * FROM templates WHERE source_workout_id = ? AND origin = 'primary' AND deleted = 0",
        (source_workout_id,),
    ).fetchone()
    if existing:
        return dict(existing)
    now = _now_iso()
    cur = conn.execute(
        "INSERT INTO templates (name, source_workout_id, origin, created_at, updated_at) "
        "VALUES (?, ?, 'primary', ?, ?)",
        (name, source_workout_id, now, now),
    )
    conn.commit()
    return get_template(conn, cur.lastrowid)


def get_template(conn, template_id):
    row = conn.execute("SELECT * FROM templates WHERE id = ?", (template_id,)).fetchone()
    return dict(row) if row else None


def list_templates(conn, include_archived=False):
    query = "SELECT * FROM templates WHERE deleted = 0"
    if not include_archived:
        query += " AND archived = 0"
    query += " ORDER BY updated_at DESC"
    return [dict(r) for r in conn.execute(query).fetchall()]


def rename_template(conn, template_id, new_name):
    cur = conn.execute(
        "UPDATE templates SET name = ?, updated_at = ? WHERE id = ? AND deleted = 0",
        (new_name, _now_iso(), template_id),
    )
    conn.commit()
    return cur.rowcount > 0


def set_template_archived(conn, template_id, archived):
    cur = conn.execute(
        "UPDATE templates SET archived = ?, updated_at = ? WHERE id = ? AND deleted = 0",
        (1 if archived else 0, _now_iso(), template_id),
    )
    conn.commit()
    return cur.rowcount > 0


def soft_delete_template(conn, template_id):
    """Never touches workouts/sets -- deleting a template only removes it
    from the template list. The logged session it points at (real training
    history, feeding PRs/Grafana/the Health Data Automation CSV mirror)
    stays exactly as it was."""
    cur = conn.execute(
        "UPDATE templates SET deleted = 1, updated_at = ? WHERE id = ?",
        (_now_iso(), template_id),
    )
    conn.commit()
    return cur.rowcount > 0


def duplicate_template(conn, template_id):
    source = get_template(conn, template_id)
    if source is None or source["deleted"]:
        return None
    existing_names = {
        r["name"] for r in conn.execute("SELECT name FROM templates WHERE deleted = 0").fetchall()
    }
    base = f"{source['name']} copy"
    new_name = base
    n = 2
    while new_name in existing_names:
        new_name = f"{base} {n}"
        n += 1
    now = _now_iso()
    cur = conn.execute(
        "INSERT INTO templates (name, source_workout_id, origin, folder_id, created_at, updated_at) "
        "VALUES (?, ?, 'duplicate', ?, ?, ?)",
        (new_name, source["source_workout_id"], source["folder_id"], now, now),
    )
    new_id = cur.lastrowid
    # A scratch template's exercise list lives in template_exercises, not a
    # source workout -- copy those rows too, or the duplicate would have no
    # exercises at all.
    if source["source_workout_id"] is None:
        rows = conn.execute(
            "SELECT exercise_id, set_order FROM template_exercises WHERE template_id = ? ORDER BY set_order",
            (template_id,),
        ).fetchall()
        for r in rows:
            conn.execute(
                "INSERT INTO template_exercises (template_id, exercise_id, set_order) VALUES (?, ?, ?)",
                (new_id, r["exercise_id"], r["set_order"]),
            )
    conn.commit()
    return get_template(conn, new_id)


def create_scratch_template(conn, name, exercise_names):
    """A template built directly (Home screen '+' -> exercise picker, same
    flow as starting a blank workout), not derived from a real logged
    workout -- source_workout_id stays NULL, its exercise list lives in
    template_exercises instead. Never touches workouts/sets, so it can't
    pollute real training history/stats."""
    now = _now_iso()
    cur = conn.execute(
        "INSERT INTO templates (name, source_workout_id, origin, created_at, updated_at) "
        "VALUES (?, NULL, 'primary', ?, ?)",
        (name, now, now),
    )
    template_id = cur.lastrowid
    for i, exercise_name in enumerate(exercise_names):
        exercise_id = get_or_create_exercise(conn, exercise_name)
        conn.execute(
            "INSERT INTO template_exercises (template_id, exercise_id, set_order) VALUES (?, ?, ?)",
            (template_id, exercise_id, i + 1),
        )
    conn.commit()
    return get_template(conn, template_id)


def sync_template_from_workout(conn, template_id, workout_id):
    """"Save and update the template" (2026-09-14, ImIceTry's own ask, Finish-
    button dialog): make a template match a just-finished workout exactly.
    A scratch template has no set/rep data to match beyond its exercise
    list, so "exactly" tops out at replacing that list (in the order they
    were actually performed); a real (source_workout_id) template already
    derives its whole preview by reading straight from whatever workout it
    points at, so retargeting it there *is* an exact match, for free."""
    template = get_template(conn, template_id)
    if template is None or template["deleted"]:
        return None
    now = _now_iso()
    if template["source_workout_id"] is None:
        order = []
        seen = set()
        rows = conn.execute(
            """SELECT e.name AS exercise_name FROM sets s
               JOIN exercises e ON e.id = s.exercise_id
               WHERE s.workout_id = ? ORDER BY s.id""",
            (workout_id,),
        ).fetchall()
        for r in rows:
            name = r["exercise_name"]
            if name not in seen:
                seen.add(name)
                order.append(name)
        conn.execute("DELETE FROM template_exercises WHERE template_id = ?", (template_id,))
        for i, exercise_name in enumerate(order):
            exercise_id = get_or_create_exercise(conn, exercise_name)
            conn.execute(
                "INSERT INTO template_exercises (template_id, exercise_id, set_order) VALUES (?, ?, ?)",
                (template_id, exercise_id, i + 1),
            )
    else:
        conn.execute(
            "UPDATE templates SET source_workout_id = ? WHERE id = ?", (workout_id, template_id)
        )
    conn.execute("UPDATE templates SET updated_at = ?, last_logged_at = ? WHERE id = ?", (now, now, template_id))
    conn.commit()
    return get_template(conn, template_id)


def touch_template_logged(conn, template_id):
    """Bumps last_logged_at only -- the "keep as is" side of the Finish
    dialog (2026-09-22, ImIceTry's ask): a workout logged from a template
    without choosing to update it still counts as using the template today,
    so the Home card's date should move even though sync_template_from_workout
    above (the "update" choice) never runs and the exercise-list preview
    must stay exactly as fixed as it was before. Deliberately doesn't touch
    updated_at -- that still means "the template's own content last
    changed," a different fact than "last logged from."
    """
    template = get_template(conn, template_id)
    if template is None or template["deleted"]:
        return None
    conn.execute("UPDATE templates SET last_logged_at = ? WHERE id = ?", (_now_iso(), template_id))
    conn.commit()
    return get_template(conn, template_id)


def get_template_exercises(conn, template_id):
    """Exercise names for a scratch template (source_workout_id IS NULL),
    in the order they were added."""
    rows = conn.execute(
        """SELECT e.name FROM template_exercises te
           JOIN exercises e ON e.id = te.exercise_id
           WHERE te.template_id = ? ORDER BY te.set_order""",
        (template_id,),
    ).fetchall()
    return [r["name"] for r in rows]


def create_folder(conn, name):
    now = _now_iso()
    cur = conn.execute("INSERT INTO template_folders (name, created_at) VALUES (?, ?)", (name, now))
    conn.commit()
    return {"id": cur.lastrowid, "name": name, "created_at": now}


def list_folders(conn):
    rows = conn.execute("SELECT * FROM template_folders ORDER BY name").fetchall()
    return [dict(r) for r in rows]


def delete_folder(conn, folder_id):
    """Deletes the folder itself; templates inside it move back to no folder
    rather than being deleted -- a folder is just a grouping, not a container."""
    cur = conn.execute("SELECT id FROM template_folders WHERE id = ?", (folder_id,))
    if cur.fetchone() is None:
        return False
    conn.execute("UPDATE templates SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
    conn.execute("DELETE FROM template_folders WHERE id = ?", (folder_id,))
    conn.commit()
    return True


def set_template_folder(conn, template_id, folder_id):
    """folder_id may be None -- moves the template back to no folder."""
    cur = conn.execute(
        "UPDATE templates SET folder_id = ?, updated_at = ? WHERE id = ? AND deleted = 0",
        (folder_id, _now_iso(), template_id),
    )
    conn.commit()
    return cur.rowcount > 0


def all_workouts_with_sets(conn):
    """Full history join, ordered for CSV export (oldest workout first, set insertion order within)."""
    rows = conn.execute(
        """SELECT w.id AS workout_id, w.started_at, w.name AS workout_name, w.duration_sec,
                  w.workout_notes, e.name AS exercise_name, s.set_order, s.weight_kg, s.reps,
                  s.rest_after_sec, s.notes AS set_notes, s.rpe, s.set_type,
                  s.duration_sec AS set_duration_sec, s.unilateral, s.variant, s.side, s.weight_ratio, s.assisted_reps, s.handle, s.grip
           FROM workouts w
           JOIN sets s ON s.workout_id = w.id
           JOIN exercises e ON e.id = s.exercise_id
           ORDER BY w.id, s.id"""
    ).fetchall()
    return [dict(r) for r in rows]
