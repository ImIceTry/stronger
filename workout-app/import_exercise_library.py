"""One-time import of the free-exercise-db public-domain dataset
(https://github.com/yuhonas/free-exercise-db, Unlicense) as browsable
library exercises. Deliberately does NOT try to merge/fuzzy-match these
against ImIceTry's own history-derived exercise names -- tested 9 of his real
names against this dataset during planning and only 1 matched exactly;
several looked matchable but were actually different equipment/movements.
Library exercises just coexist as separate rows (source='library').

Idempotent: safe to re-run, skips import if library rows already exist.
"""
import json
import urllib.request

import db

SOURCE_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"


def fetch_library():
    with urllib.request.urlopen(SOURCE_URL, timeout=30) as resp:
        return json.load(resp)


def import_library(conn, exercises):
    inserted = 0
    for ex in exercises:
        name = ex.get("name", "").strip()
        if not name:
            continue
        existing = conn.execute("SELECT id FROM exercises WHERE name = ?", (name,)).fetchone()
        if existing:
            continue  # a same-named row already exists (either ImIceTry's own, or a re-run) -- don't touch it
        muscles = ", ".join(ex.get("primaryMuscles") or [])
        conn.execute(
            "INSERT INTO exercises (name, source, category, primary_muscles, equipment) VALUES (?, 'library', ?, ?, ?)",
            (name, ex.get("category"), muscles, ex.get("equipment")),
        )
        inserted += 1
    conn.commit()
    return inserted


def main():
    db.init_db()
    conn = db.get_conn()
    try:
        existing_library = conn.execute(
            "SELECT COUNT(*) AS n FROM exercises WHERE source = 'library'"
        ).fetchone()["n"]
        if existing_library:
            print(f"Library already imported ({existing_library} rows). Skipping.")
            return
        print(f"Fetching {SOURCE_URL} ...")
        exercises = fetch_library()
        print(f"Fetched {len(exercises)} exercises.")
        inserted = import_library(conn, exercises)
        print(f"Inserted {inserted} new library exercises "
              f"({len(exercises) - inserted} skipped as already-existing names).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
