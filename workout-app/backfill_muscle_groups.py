"""One-time backfill: tag ImIceTry's own 38 real logged exercises (source =
'history') with primary_muscles, matching the same taxonomy already used by
the 874 imported library exercises. These have never had this data --
confirmed via direct query (2026-09-09) that 100% of source='history' rows
have category/primary_muscles = NULL, while all 874 library rows have both.

Mapping was built by hand (not auto-matched against the library by name --
that approach was already ruled out earlier in this project as too risky at
the 38-vs-874 fuzzy-matching scale), reviewed with ImIceTry before being
applied. A few genuine judgment calls, logged: Dead Hang -> lats (standard
categorization for hang exercises; forearms/grip is a reasonable
alternative); Triceps Dip vs Chest Dip kept as separate primary muscles
(triceps vs chest) since ImIceTry named them that way himself, which is a
real signal of which variant he meant.

Usage:
    .venv/bin/python backfill_muscle_groups.py            # dry run (default)
    .venv/bin/python backfill_muscle_groups.py --apply     # actually write
"""
import sys

import db

MUSCLE_MAP = {
    "Chest Fly": "chest",
    "Lateral Raise (Cable)": "shoulders",
    "Seated Row (Machine)": "middle back",
    "Lat Pulldown (Single Arm)": "lats",
    "Bicep Curl (Machine)": "biceps",
    "Reverse Fly (Machine)": "shoulders",
    "Incline Chest Press (Machine)": "chest",
    "Triceps Pushdown (Cable - Straight Bar)": "triceps",
    "Triceps Extension (Cable)": "triceps",
    "Leg Extension (Machine)": "quadriceps",
    "Crunch (Machine)": "abdominals",
    "Bicep Curl (Barbell)": "biceps",
    "Seated Leg Curl (Machine)": "hamstrings",
    "Calf Press on Leg Press": "calves",
    "Leg Press": "quadriceps",
    "Hanging Leg Raise": "abdominals",
    "Dead Hang": "lats",
    "Triceps Dip (Assisted)": "triceps",
    "Chest Press (Machine)": "chest",
    "Skullcrusher (Barbell)": "triceps",
    "Incline Bench Press (Barbell)": "chest",
    "Decline Bench Press (Smith Machine)": "chest",
    "Hammer Curl (Cable)": "biceps",
    "Incline Bench Press (Smith Machine)": "chest",
    "Seated Leg Press (Machine)": "quadriceps",
    "Triceps Extension (Machine)": "triceps",
    "Lying Leg Curl (Machine)": "hamstrings",
    "Seated Row (Cable)": "middle back",
    "Iso-Lateral Row (Machine)": "middle back",
    "Seated Calf Raise (Plate Loaded)": "calves",
    "Bicep Curl (Cable)": "biceps",
    "Lateral Raise (Machine)": "shoulders",
    "Torso Rotation (Machine)": "abdominals",
    "Reverse Curl (Dumbbell)": "forearms",
    "Shoulder Press (Plate Loaded)": "shoulders",
    "Lateral Raise (Dumbbell)": "shoulders",
    "Chest Dip (Assisted)": "chest",
    "Incline Bench Press (Dumbbell)": "chest",
}

# category isn't used by the planned muscle-map feature, but every library
# row has one, so set it too for consistency rather than leaving history
# rows as the only exercises with a populated primary_muscles but a NULL
# category.
CATEGORY = "strength"


def main():
    apply = "--apply" in sys.argv

    db.init_db()
    conn = db.get_conn()

    history_rows = conn.execute(
        "SELECT id, name, category, primary_muscles FROM exercises WHERE source = 'history'"
    ).fetchall()
    print(f"Found {len(history_rows)} source='history' exercises.")

    planned = []
    unmapped = []
    for row in history_rows:
        muscle = MUSCLE_MAP.get(row["name"])
        if muscle is None:
            unmapped.append(row["name"])
            continue
        planned.append({"id": row["id"], "name": row["name"], "muscle": muscle})

    print(f"Planned updates: {len(planned)}")
    if unmapped:
        print(f"UNMAPPED (no entry in MUSCLE_MAP, will be left untouched): {unmapped}")

    for p in planned:
        print(f"  {p['name']!r:45s} -> {p['muscle']}")

    before_exercises = conn.execute("SELECT COUNT(*) AS n FROM exercises").fetchone()["n"]
    before_sets = conn.execute("SELECT COUNT(*) AS n FROM sets").fetchone()["n"]

    if apply:
        print(f"\n--apply given: writing {len(planned)} updates...")
        for p in planned:
            conn.execute(
                "UPDATE exercises SET category = ?, primary_muscles = ? WHERE id = ?",
                (CATEGORY, p["muscle"], p["id"]),
            )
        conn.commit()
        print("Writes committed.")
    else:
        print("\nDRY RUN -- no writes made. Re-run with --apply to write for real.")

    after_exercises = conn.execute("SELECT COUNT(*) AS n FROM exercises").fetchone()["n"]
    after_sets = conn.execute("SELECT COUNT(*) AS n FROM sets").fetchone()["n"]
    print(f"\nRow counts: exercises {before_exercises} -> {after_exercises}, sets {before_sets} -> {after_sets}")
    if before_exercises != after_exercises or before_sets != after_sets:
        print("BLOCKER: row counts changed. This script must only fill columns, never add/remove rows.")
        sys.exit(1)

    conn.close()


if __name__ == "__main__":
    main()
