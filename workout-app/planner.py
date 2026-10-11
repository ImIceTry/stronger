"""Next-session suggestion for the Home screen.

Picks the template in the current rotation (used within ROTATION_DAYS) that
has gone longest without being trained, which gives Push/Pull alternation
without hard-coding names. Templates outside the rotation (e.g. Legs after a
long break) are only suggested when nothing is in rotation, but are called
out in `reason` so a skipped body part stays visible.
"""
from datetime import datetime

import muscle_scores

ROTATION_DAYS = 28
WEEKLY_SET_TARGET = 10
FMT = "%Y-%m-%d %H:%M:%S"


def _last_used(conn, tpl):
    candidates = []
    if tpl["last_logged_at"]:
        candidates.append(tpl["last_logged_at"])
    row = conn.execute("SELECT MAX(started_at) AS s FROM workouts WHERE LOWER(name) = LOWER(?)", (tpl["name"],)).fetchone()
    if row["s"]:
        candidates.append(row["s"])
    if tpl["source_workout_id"]:
        src = conn.execute("SELECT started_at FROM workouts WHERE id = ?", (tpl["source_workout_id"],)).fetchone()
        if src:
            candidates.append(src["started_at"])
    return max(candidates) if candidates else None


def _template_muscles(conn, tpl):
    if tpl["source_workout_id"]:
        rows = conn.execute(
            "SELECT DISTINCT e.primary_muscles FROM sets s JOIN exercises e ON e.id = s.exercise_id "
            "WHERE s.workout_id = ? AND e.primary_muscles IS NOT NULL", (tpl["source_workout_id"],)).fetchall()
    else:
        rows = conn.execute(
            "SELECT DISTINCT e.primary_muscles FROM template_exercises te JOIN exercises e ON e.id = te.exercise_id "
            "WHERE te.template_id = ? AND e.primary_muscles IS NOT NULL", (tpl["id"],)).fetchall()
    muscles = set()
    for r in rows:
        muscles.update(m for m, w in muscle_scores._parse_muscles(r["primary_muscles"]) if w >= 1.0)
    return muscles


def suggest(conn, now=None):
    now = now or datetime.now()
    templates = conn.execute("SELECT * FROM templates WHERE deleted = 0 AND archived = 0").fetchall()
    if not templates:
        return None
    ranked = []
    for t in templates:
        last = _last_used(conn, t)
        age = (now - datetime.strptime(last, FMT)).days if last else None
        ranked.append((t, last, age))
    rotation = [r for r in ranked if r[2] is not None and r[2] <= ROTATION_DAYS]
    pool = rotation or ranked
    tpl, last, age = min(pool, key=lambda r: r[1] or "")
    parts = []
    if age is None:
        parts.append("Never trained yet")
    elif age == 0:
        parts.append("Last trained today")
    else:
        parts.append(f"Last trained {age} day{'s' if age != 1 else ''} ago")
    sets = muscle_scores.weekly_hard_sets(conn, now)
    gaps = sorted(((sets.get(m, 0.0), m) for m in _template_muscles(conn, tpl)))[:2]
    gaps = [(n, m) for n, m in gaps if n < WEEKLY_SET_TARGET]
    if gaps:
        parts.append("; ".join(f"{m} at {n:g}/{WEEKLY_SET_TARGET} sets this week" for n, m in gaps))
    stale = [r for r in ranked if r[0]["id"] != tpl["id"] and (r[2] is None or r[2] > ROTATION_DAYS)]
    if rotation and stale:
        parts.append("not trained recently: " + ", ".join(r[0]["name"] for r in stale))
    parts = [p[0].upper() + p[1:] for p in parts]
    return {
        "template_id": tpl["id"], "name": tpl["name"], "source_workout_id": tpl["source_workout_id"],
        "reason": ". ".join(parts),
    }
