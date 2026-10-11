"""Writes the full workout history to a Strong-schema CSV, so the existing
health-ingest.sh pipeline (health-ingest.sh -> combined_analysis.py / anomaly_scan.py)
keeps working completely unmodified.

Critical: combined_analysis.py and anomaly_scan.py both pick the single
*(processed).csv file with the latest mtime -- not a merge of all files.
Every manual Strong export is a full cumulative history dump, not a delta.
So every write here must also be a full dump of everything in the database,
never just the newest workout.
"""
import csv
import os
import time

# Optional add-on: mirrors the full history into a Strong-schema CSV for an
# external ingest pipeline (Health Data Automation). Unset by default -- a
# fresh install has nowhere sensible to default this to, so mirroring is
# simply off until STRONG_EXPORTS_DIR is explicitly configured.
STRONG_EXPORTS_DIR = os.environ.get("STRONG_EXPORTS_DIR")

HEADER = [
    "Workout #", "Date", "Workout Name", "Duration (sec)", "Exercise Name",
    "Set Order", "Weight (kg)", "Reps", "RPE", "Distance (meters)",
    "Seconds", "Notes", "Workout Notes",
]


def _fmt(value):
    return "" if value is None else str(value)


_SET_ORDER_CODE = {"drop": "D", "failure": "F", "assisted": "A"}  # "failure" kept for the 2 real historical sets still tagged with it


def _rows_for_workout(w_id, started_at, workout_name, duration_sec, workout_notes, sets):
    rows = []
    for s in sets:
        set_order_value = _SET_ORDER_CODE.get(s.get("set_type"), str(s["set_order"]))
        # unilateral has no equivalent column in Strong's real schema (unlike
        # drop/failure, which map onto Set Order) -- surfaced as a Notes
        # suffix instead, same place migrate_strong_history.py already looks
        # for "(drop set)"-style annotations on the way back in.
        notes = s["set_notes"] or ""
        if s.get("unilateral"):
            notes = (notes + " (unilateral)").strip()
        # variant has no equivalent Strong column either -- same Notes-suffix
        # treatment as unilateral above.
        if s.get("variant"):
            notes = (notes + f" (variant: {s['variant']})").strip()
        if s.get("side"):
            notes = (notes + f" ({s['side']})").strip()
        # assisted_reps has no Strong column either -- same Notes-suffix
        # treatment (2026-09-18, replaces the old "failure" set type).
        if s.get("assisted_reps"):
            notes = (notes + f" ({s['assisted_reps']} assisted)").strip()
        rows.append([
            w_id, started_at, workout_name, _fmt(duration_sec), s["exercise_name"],
            set_order_value, _fmt(s["weight_kg"]), _fmt(s["reps"]), _fmt(s.get("rpe")), "",
            _fmt(s.get("set_duration_sec")), notes, "",
        ])
        if s["rest_after_sec"] is not None:
            rows.append([
                w_id, started_at, workout_name, _fmt(duration_sec), s["exercise_name"],
                "Rest Timer", "", "", "", "", _fmt(s["rest_after_sec"]), "", "",
            ])
    if rows:
        rows[-1][-1] = workout_notes or ""  # Workout Notes only needs to land once per session; harmless if repeated
    return rows


def write_full_export(all_rows):
    """all_rows: output of db.all_workouts_with_sets(), grouped by workout_id in order.
    No-op (returns None) when STRONG_EXPORTS_DIR isn't configured -- the CSV
    mirror is an optional add-on, not required for the app to work.
    """
    if not STRONG_EXPORTS_DIR:
        return None
    os.makedirs(STRONG_EXPORTS_DIR, exist_ok=True)
    filename = f"workout-app-export-{time.strftime('%Y%m%d-%H%M%S')}.csv"
    path = os.path.join(STRONG_EXPORTS_DIR, filename)

    workouts = {}
    order = []
    for r in all_rows:
        wid = r["workout_id"]
        if wid not in workouts:
            workouts[wid] = {
                "started_at": r["started_at"],
                "workout_name": r["workout_name"],
                "duration_sec": r["duration_sec"],
                "workout_notes": r["workout_notes"],
                "sets": [],
            }
            order.append(wid)
        workouts[wid]["sets"].append(r)

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, delimiter=";", quoting=csv.QUOTE_ALL, lineterminator="\n")
        writer.writerow(HEADER)
        for wid in order:
            w = workouts[wid]
            for row in _rows_for_workout(wid, w["started_at"], w["workout_name"], w["duration_sec"], w["workout_notes"], w["sets"]):
                writer.writerow(row)

    return path
