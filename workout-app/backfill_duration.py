"""One-time backfill: restore duration_sec for timed sets dropped by the
original historical import (migrate_strong_history.py never had a duration
column to write into). Mirrors that script's CSV parsing/grouping pattern.

Source file is hardcoded, not re-derived via a "pick latest export" glob --
confirmed by direct inspection (2026-09-09) that
"strong5129206536120152194 (processed).csv" is both the file the original
import actually used (latest max Date among the three original Strong
exports at import time, 2026-09-02) and the one with the real Dead Hang
Seconds data. Re-running a glob-based picker today would be wrong: this same
folder now also contains this app's own CSV mirror exports
("workout-app-export-*"), which also match "*(processed).csv" and could have
a later max-date if re-picked blindly.

Usage:
    .venv/bin/python backfill_duration.py            # dry run (default)
    .venv/bin/python backfill_duration.py --apply     # actually write
"""
import csv
import os
import sys

import db

STRONG_DIR = os.environ.get(
    "STRONG_EXPORTS_DIR",
    "/srv/vault/02 Projects/Health Data Automation/exports/strong",
)
SOURCE_FILE = os.path.join(STRONG_DIR, "strong5129206536120152194 (processed).csv")


def parse_seconds(value):
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def compute_candidates(path):
    """Mirrors migrate_strong_history.py's import_file grouping exactly, so the
    set_order computed here matches what's actually stored in the sets table."""
    with open(path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter=";"))

    workouts = {}
    order = []
    for r in rows:
        wnum = r["Workout #"]
        if wnum not in workouts:
            workouts[wnum] = {"date": r["Date"], "name": r["Workout Name"], "rows": []}
            order.append(wnum)
        workouts[wnum]["rows"].append(r)

    candidates = []
    for wnum in order:
        w = workouts[wnum]
        set_order_counters = {}
        for r in w["rows"]:
            set_order_raw = r["Set Order"]
            exercise_name = r["Exercise Name"].strip()
            if set_order_raw in ("Rest Timer", "Note"):
                continue
            next_order = set_order_counters.get(exercise_name, 0) + 1
            set_order_counters[exercise_name] = next_order

            seconds = parse_seconds(r.get("Seconds"))
            if seconds is not None:
                candidates.append({
                    "date": w["date"],
                    "workout_name": w["name"],
                    "exercise_name": exercise_name,
                    "set_order": next_order,
                    "duration_sec": seconds,
                })
    return candidates


def match_against_db(conn, candidates):
    """Returns (planned_updates, unmatched) -- unmatched is anything that
    couldn't be resolved to a real sets row, which must be investigated, not
    silently skipped."""
    planned = []
    unmatched = []
    for c in candidates:
        workout_rows = conn.execute(
            "SELECT id FROM workouts WHERE started_at = ?", (c["date"],)
        ).fetchall()
        if len(workout_rows) != 1:
            unmatched.append({**c, "reason": f"{len(workout_rows)} workouts matched started_at"})
            continue
        workout_id = workout_rows[0]["id"]

        ex_row = conn.execute(
            "SELECT id FROM exercises WHERE name = ?", (c["exercise_name"],)
        ).fetchone()
        if ex_row is None:
            unmatched.append({**c, "reason": "exercise not found"})
            continue
        exercise_id = ex_row["id"]

        set_row = conn.execute(
            "SELECT id, duration_sec, weight_kg, reps FROM sets "
            "WHERE workout_id = ? AND exercise_id = ? AND set_order = ?",
            (workout_id, exercise_id, c["set_order"]),
        ).fetchone()
        if set_row is None:
            unmatched.append({**c, "reason": "no matching sets row (workout_id/exercise_id/set_order)"})
            continue

        if set_row["duration_sec"] is not None:
            # Already has a value -- never overwrite, just note it and skip.
            continue

        planned.append({
            **c,
            "set_id": set_row["id"],
            "old_weight_kg": set_row["weight_kg"],
            "old_reps": set_row["reps"],
        })
    return planned, unmatched


def set_unit_types(conn):
    """Recomputed from current data every run (not incrementally patched) --
    safe to call repeatedly. Must run after duration_sec is backfilled, since
    it reads that column to decide 'time' exercises.

    Bug found and fixed during Phase 4.1 (2026-09-09), by cross-checking a
    real workout's output against the actual Strong reference screenshot:
    the original rule was "any set with duration_sec -> time", but the
    plan's own Phase 0 scoping already knew Bicep Curl (Barbell)/Bicep Curl
    (Machine)/Chest Fly each have a small number of incidentally-timed sets
    (a rest-pause technique, timed once or twice) mixed into an otherwise
    entirely weight-based history -- confirmed live: 2/335, 4/106, and
    1/362 sets respectively, versus Dead Hang's 57/57. "Any" reclassified
    all four as 'time'; a genuinely time-based exercise should have a real
    majority of its sets timed, not just one incidental set. Fixed to a
    majority threshold, which cleanly separates the two groups given how
    lopsided the real ratios are.

    Idempotency fix (same tick): the three UPDATEs below only ever SET rows
    that currently qualify for a given unit_type -- they never revert a row
    that no longer qualifies but is still stored as a stale value from an
    earlier run. Concretely: the first flawed run already wrote
    unit_type='time' for Bicep Curl (Barbell/Machine) and Chest Fly; re-running
    the corrected majority-threshold UPDATE alone would leave those three
    stuck on 'time' forever, because the reps_only pass's `WHERE unit_type !=
    'time'` guard and the weight_reps pass's `WHERE unit_type NOT IN ('time',
    'reps_only')` guard both skip rows already marked 'time'. Reset every
    exercise to the 'weight_reps' default first so the three passes below
    always recompute from a blank slate, regardless of what a previous run
    left behind."""
    conn.execute("UPDATE exercises SET unit_type = 'weight_reps'")
    conn.execute("""
        UPDATE exercises SET unit_type = 'time'
        WHERE id IN (
          SELECT exercise_id FROM sets GROUP BY exercise_id
          HAVING SUM(CASE WHEN duration_sec IS NOT NULL THEN 1 ELSE 0 END) * 2 > COUNT(*)
        )
    """)
    conn.execute("""
        UPDATE exercises SET unit_type = 'reps_only'
        WHERE unit_type != 'time'
        AND id IN (
          SELECT exercise_id FROM sets GROUP BY exercise_id
          HAVING SUM(CASE WHEN weight_kg IS NOT NULL AND weight_kg != 0 THEN 1 ELSE 0 END) = 0
          AND SUM(CASE WHEN reps IS NOT NULL THEN 1 ELSE 0 END) > 0
        )
    """)
    conn.commit()


def main():
    apply = "--apply" in sys.argv

    # Edge case from the plan: verify set_order is actually unique within
    # (workout_id, exercise_id) before trusting the join -- if any workout
    # logs the same exercise twice in separate blocks, this join needs a
    # tiebreaker instead of silently mismatching.
    db.init_db()
    conn = db.get_conn()
    dup_check = conn.execute(
        "SELECT workout_id, exercise_id, set_order, COUNT(*) AS n "
        "FROM sets GROUP BY workout_id, exercise_id, set_order HAVING n > 1"
    ).fetchall()
    if dup_check:
        print(f"BLOCKER: {len(dup_check)} (workout_id, exercise_id, set_order) combos are not unique.")
        print("The join this script relies on is unsafe until this is resolved. Aborting, no writes made.")
        for row in dup_check[:10]:
            print(dict(row))
        conn.close()
        sys.exit(1)
    print("Uniqueness check passed: (workout_id, exercise_id, set_order) has no duplicates.")

    candidates = compute_candidates(SOURCE_FILE)
    print(f"Parsed {len(candidates)} real timed rows (non-empty Seconds) from {SOURCE_FILE}")

    planned, unmatched = match_against_db(conn, candidates)
    print(f"Planned updates: {len(planned)}")
    print(f"Unmatched (needs investigation): {len(unmatched)}")
    for u in unmatched:
        print("  UNMATCHED:", u)

    by_exercise = {}
    for p in planned:
        by_exercise.setdefault(p["exercise_name"], 0)
        by_exercise[p["exercise_name"]] += 1
    print("Planned updates by exercise:", by_exercise)

    print("\nSpot check -- 2026-06-29 Dead Hang session:")
    for p in planned:
        if p["exercise_name"] == "Dead Hang" and p["date"].startswith("2026-06-29"):
            print(" ", p["date"], "set_order=", p["set_order"], "duration_sec=", p["duration_sec"],
                  "(old weight/reps:", p["old_weight_kg"], p["old_reps"], ")")

    before_workouts = conn.execute("SELECT COUNT(*) AS n FROM workouts").fetchone()["n"]
    before_sets = conn.execute("SELECT COUNT(*) AS n FROM sets").fetchone()["n"]

    if apply:
        print(f"\n--apply given: writing {len(planned)} updates...")
        for p in planned:
            conn.execute("UPDATE sets SET duration_sec = ? WHERE id = ?", (p["duration_sec"], p["set_id"]))
        conn.commit()
        print("Writes committed.")

        set_unit_types(conn)
        print("unit_type recomputed:")
        for row in conn.execute("SELECT unit_type, COUNT(*) AS n FROM exercises GROUP BY unit_type"):
            print(" ", dict(row))
    else:
        print("\nDRY RUN -- no writes made. Re-run with --apply to write for real.")

    after_workouts = conn.execute("SELECT COUNT(*) AS n FROM workouts").fetchone()["n"]
    after_sets = conn.execute("SELECT COUNT(*) AS n FROM sets").fetchone()["n"]
    print(f"\nRow counts: workouts {before_workouts} -> {after_workouts}, sets {before_sets} -> {after_sets}")
    if before_workouts != after_workouts or before_sets != after_sets:
        print("BLOCKER: row counts changed. This script must only fill a column, never add/remove rows.")
        sys.exit(1)

    conn.close()


if __name__ == "__main__":
    main()
