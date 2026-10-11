"""One-time import: the most complete real Strong CSV export -> workout.db.

Run once, by hand, before the app is trusted for real logging:
    .venv/bin/python migrate_strong_history.py

All of ImIceTry's "(processed).csv" files in Health Data Automation's exports/strong/
are full cumulative history dumps taken at different points in time (same start
date, growing end date/workout count) -- not deltas. So this only needs to import
the single file with the latest data, exactly like combined_analysis.py/
anomaly_scan.py's own "pick the newest dump" convention.
"""
import csv
import glob
import os
import sys

import db

STRONG_DIR = os.environ.get(
    "STRONG_EXPORTS_DIR",
    "/srv/vault/02 Projects/Health Data Automation/exports/strong",
)


def pick_latest_export():
    candidates = glob.glob(os.path.join(STRONG_DIR, "*(processed).csv"))
    if not candidates:
        raise SystemExit(f"No '(processed).csv' files found in {STRONG_DIR}")
    best_path, best_max_date = None, ""
    for path in candidates:
        with open(path, encoding="utf-8") as f:
            rows = list(csv.DictReader(f, delimiter=";"))
        if not rows:
            continue
        max_date = max(r["Date"] for r in rows)
        if max_date > best_max_date:
            best_path, best_max_date = path, max_date
    return best_path


def parse_number(value, cast):
    value = (value or "").strip()
    if not value:
        return None
    try:
        return cast(float(value)) if cast is int else cast(value)
    except ValueError:
        return None


def import_file(path, conn):
    with open(path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter=";"))

    # Group rows by "Workout #" preserving first-seen order.
    workouts = {}
    order = []
    for r in rows:
        wnum = r["Workout #"]
        if wnum not in workouts:
            workouts[wnum] = {
                "date": r["Date"],
                "name": r["Workout Name"],
                "duration_sec": parse_number(r["Duration (sec)"], int),
                "notes_parts": [],
                "rows": [],
            }
            order.append(wnum)
        workouts[wnum]["rows"].append(r)

    imported_workouts = 0
    imported_sets = 0
    skipped_rest_timer = 0
    skipped_notes = 0

    for wnum in order:
        w = workouts[wnum]
        cur = conn.execute(
            "INSERT INTO workouts (started_at, finished_at, name, duration_sec, workout_notes) "
            "VALUES (?, ?, ?, ?, '')",
            (w["date"], w["date"], w["name"], w["duration_sec"]),
        )
        workout_id = cur.lastrowid
        imported_workouts += 1

        set_order_counters = {}  # exercise_id -> next sequential set_order
        workout_note_lines = []

        for r in w["rows"]:
            set_order_raw = r["Set Order"]
            exercise_name = r["Exercise Name"].strip()

            if set_order_raw == "Rest Timer":
                skipped_rest_timer += 1
                continue

            if set_order_raw == "Note":
                text = (r["Notes"] or "").strip()
                if text:
                    workout_note_lines.append(f"[{exercise_name}] {text}")
                skipped_notes += 1
                continue

            exercise_id = db.get_or_create_exercise(conn, exercise_name)
            next_order = set_order_counters.get(exercise_id, 0) + 1
            set_order_counters[exercise_id] = next_order

            notes = (r["Notes"] or "").strip()
            if set_order_raw == "D":
                notes = (notes + " (drop set)").strip()
            elif set_order_raw == "F":
                notes = (notes + " (failure set)").strip()
            elif not set_order_raw.isdigit():
                notes = (notes + f" (set order: {set_order_raw})").strip()

            weight_kg = parse_number(r["Weight (kg)"], float)
            reps = parse_number(r["Reps"], int)
            # Real column in the source export, silently dropped by this
            # script's original version (found 2026-09-11 -- backfill_rpe.py
            # recovered the 177 real values already-imported sets had lost).
            rpe = parse_number(r.get("RPE"), float)

            conn.execute(
                "INSERT INTO sets (workout_id, exercise_id, set_order, weight_kg, reps, "
                "rest_after_sec, notes, logged_at, rpe) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)",
                (workout_id, exercise_id, next_order, weight_kg, reps, notes, w["date"], rpe),
            )
            imported_sets += 1

        if workout_note_lines:
            conn.execute(
                "UPDATE workouts SET workout_notes = ? WHERE id = ?",
                ("\n".join(workout_note_lines), workout_id),
            )

    conn.commit()
    return {
        "workouts": imported_workouts,
        "sets": imported_sets,
        "skipped_rest_timer_rows": skipped_rest_timer,
        "skipped_note_rows": skipped_notes,
    }


def main():
    path = pick_latest_export()
    print(f"Importing from: {path}")

    db.init_db()
    conn = db.get_conn()
    try:
        existing = conn.execute("SELECT COUNT(*) AS n FROM workouts").fetchone()["n"]
        if existing:
            print(f"workout.db already has {existing} workout(s). Refusing to double-import.")
            print("Delete data/workout.db first if you want to re-run this from scratch.")
            sys.exit(1)
        stats = import_file(path, conn)
    finally:
        conn.close()

    print(stats)


if __name__ == "__main__":
    main()
