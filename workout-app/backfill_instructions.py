"""One-time backfill: real step-by-step instructions for ImIceTry's own logged
exercises, for the exercise-detail About tab (2026-09-16, his ask).

Source is the same free-exercise-db dataset import_exercise_library.py
already pulled in for the ~876 library exercises -- but that import
deliberately never merged/fuzzy-matched those against ImIceTry's own
history-derived exercise names (see its own docstring: 9 of his names were
tested during planning, only 1 matched exactly, several looked matchable but
were actually different equipment/movements). Exact-name matching only,
same rule, for the same reason: an exact match found only 2 of ImIceTry's 41
logged exercises at the time this ran ("Hanging Leg Raise" -- since renamed
to "Vertical Leg Raise (Machine)", see Workout Tracking notes -- and "Leg
Press") -- everything else is left with instructions = NULL rather than
guessed at. Real, sourced text or nothing; never generated.

2026-10-06: widened from "exercises with logged sets" to every exercise that
still has no instructions, so the ~847 library exercises (imported from this
same dataset, so exact names match) get their text too. Still exact-name only.

Usage:
    .venv/bin/python backfill_instructions.py             # dry run (default)
    .venv/bin/python backfill_instructions.py --apply      # actually write
"""
import json
import sys
import urllib.request

import db

SOURCE_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"


def main():
    apply = "--apply" in sys.argv

    with urllib.request.urlopen(SOURCE_URL, timeout=30) as resp:
        library = json.load(resp)
    by_name = {e["name"]: e for e in library}

    db.init_db()
    conn = db.get_conn()
    try:
        rows = conn.execute(
            """SELECT e.id, e.name FROM exercises e
               WHERE e.instructions IS NULL OR e.instructions = ''
               ORDER BY e.name"""
        ).fetchall()

        matched, skipped = [], []
        for r in rows:
            entry = by_name.get(r["name"])
            if entry and entry.get("instructions"):
                matched.append((r["id"], r["name"], entry["instructions"]))
            else:
                skipped.append(r["name"])

        print(f"{len(rows)} exercises without instructions checked.")
        print(f"Exact match with real instructions: {len(matched)}")
        for _id, name, steps in matched:
            print(f"  - {name} ({len(steps)} steps)")
        print(f"No match, left NULL: {len(skipped)}")

        if not apply:
            print("\nDry run only -- pass --apply to write.")
            return

        for exercise_id, _name, steps in matched:
            conn.execute(
                "UPDATE exercises SET instructions = ? WHERE id = ?",
                ("\n".join(steps), exercise_id),
            )
        conn.commit()
        print(f"\nApplied: {len(matched)} exercises updated.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
