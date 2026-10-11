"""One-time backfill: migrate_strong_history.py's original import (2026-09-09)
read weight/reps/notes from the real Strong CSV export but never extracted the
RPE column at all, despite the column existing right there in the source file
-- found 2026-09-11 when ImIceTry pointed out he'd definitely logged RPE in
Strong. This re-derives the exact same per-exercise sequential set_order the
original import used and UPDATEs rpe in place for whichever already-imported
sets a real CSV RPE value matches, rather than re-importing from scratch.

Run once, by hand:
    .venv/bin/python backfill_rpe.py

Verified against a scratch copy of workout.db first: 177/177 CSV rows with a
real RPE value matched an existing set with rpe still NULL, 0 missing, 0
collisions -- see 02 Projects/Workout App/[C] Workout App.md item 24 for the
full trail.
"""
import csv
import os

import db

STRONG_DIR = os.environ.get(
    "STRONG_EXPORTS_DIR",
    "/srv/vault/02 Projects/Health Data Automation/exports/strong",
)
# The exact file migrate_strong_history.py originally imported -- confirmed
# by matching row counts (3765 real set rows, 246 workouts) against the live
# DB, not just picked by name.
SOURCE_FILE = "strong5129206536120152194 (processed).csv"


def main():
    path = os.path.join(STRONG_DIR, SOURCE_FILE)
    with open(path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter=";"))

    workouts = {}
    order = []
    for r in rows:
        wnum = r["Workout #"]
        if wnum not in workouts:
            workouts[wnum] = {"date": r["Date"], "rows": []}
            order.append(wnum)
        workouts[wnum]["rows"].append(r)

    conn = db.get_conn()
    updated = 0
    missing_workout = 0
    missing_set = 0
    already_had_rpe = 0

    for wnum in order:
        w = workouts[wnum]
        wr = conn.execute("SELECT id FROM workouts WHERE started_at = ?", (w["date"],)).fetchone()
        if wr is None:
            missing_workout += 1
            continue
        workout_id = wr["id"]
        set_order_counters = {}
        for r in w["rows"]:
            set_order_raw = r["Set Order"]
            if set_order_raw in ("Rest Timer", "Note"):
                continue
            exercise_name = r["Exercise Name"].strip()
            rpe_raw = (r.get("RPE") or "").strip()
            exercise_id = db.get_or_create_exercise(conn, exercise_name)
            next_order = set_order_counters.get(exercise_id, 0) + 1
            set_order_counters[exercise_id] = next_order
            if not rpe_raw:
                continue
            rpe = float(rpe_raw)
            existing = conn.execute(
                "SELECT rpe FROM sets WHERE workout_id = ? AND exercise_id = ? AND set_order = ?",
                (workout_id, exercise_id, next_order),
            ).fetchone()
            if existing is None:
                missing_set += 1
                continue
            if existing["rpe"] is not None:
                already_had_rpe += 1
                continue
            cur = conn.execute(
                "UPDATE sets SET rpe = ? WHERE workout_id = ? AND exercise_id = ? AND set_order = ?",
                (rpe, workout_id, exercise_id, next_order),
            )
            updated += cur.rowcount

    conn.commit()
    print(f"updated: {updated}, missing_workout: {missing_workout}, "
          f"missing_set: {missing_set}, already_had_rpe: {already_had_rpe}")


if __name__ == "__main__":
    main()
