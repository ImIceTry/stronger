"""Personal-record and estimated-1RM logic. No stored PR table -- derived on
read from the sets already in the database, since this is small personal-scale
data (a few thousand rows) and recomputing is cheap and never goes stale."""

from datetime import datetime, timedelta


def estimated_1rm(weight_kg, reps):
    """Epley formula. Only meaningful for real working sets with both fields set."""
    if weight_kg is None or reps is None or reps <= 0:
        return None
    return round(weight_kg * (1 + reps / 30), 1)


def _compute_records(sets):
    """Shared by exercise_records' bilateral/unilateral lanes -- same math,
    just fed a pre-filtered set list. Every weight used here is the
    *effective* weight (weight_kg * weight_ratio, see sets.weight_ratio's
    own comment in db.py) -- a variant with a saved ratio (e.g. a 4:1-pulley
    machine reading "40" for a true 10kg) reports its records in real,
    comparable resistance terms, not the raw number off the machine. The
    raw number itself is never lost -- it's still exactly what History and
    the numpad's own PREVIOUS prefill show, this function just isn't where
    that's read from."""
    if not sets:
        return None
    best_1rm = {"value": None, "date": None}
    best_weight = {"value": None, "date": None}
    best_volume = {"value": None, "date": None}
    by_rep = {}  # reps -> {weight, date, est_1rm}

    for s in sets:
        weight, reps, date = s["weight_kg"] * s["weight_ratio"], s["reps"], s["started_at"]
        volume = weight * reps
        e1rm = estimated_1rm(weight, reps)

        if best_1rm["value"] is None or (e1rm or 0) > best_1rm["value"]:
            best_1rm = {"value": e1rm, "date": date}
        if best_weight["value"] is None or weight > best_weight["value"]:
            best_weight = {"value": weight, "date": date}
        if best_volume["value"] is None or volume > best_volume["value"]:
            best_volume = {"value": round(volume, 1), "date": date}

        if reps <= 10:
            current = by_rep.get(reps)
            if current is None or weight > current["weight_kg"]:
                by_rep[reps] = {"weight_kg": weight, "date": date, "estimated_1rm": e1rm}

    return {
        "estimated_1rm": best_1rm,
        "max_weight": best_weight,
        "max_volume": best_volume,
        "by_rep_count": [{"reps": r, **by_rep[r]} for r in sorted(by_rep.keys())],
    }


def exercise_records(conn, exercise_name):
    """All-time best weight, best est-1RM, best volume, plus the 1-10 rep-count
    best-performance table Strong shows on its Records tab. Bilateral and
    unilateral sets are never mixed into the same numbers (a one-arm rep
    isn't the same lift as a two-handed one) -- prefers the real bilateral
    history when any exists, but falls back to the unilateral one instead of
    returning empty for an exercise that's always done one-sided (2026-09-16,
    Reverse Fly (Machine) -- ImIceTry does it one-handed essentially every
    time, so excluding unilateral outright would mean this exercise never
    has records at all). The response's own "unilateral" key says which lane
    the caller got, so the UI can tag it rather than presenting a one-arm
    number as a two-handed one.

    'assisted' joins the existing failure/warmup exclusion everywhere in this
    file (2026-09-18, replacing 'failure' as a creatable set_type) -- an
    assisted rep isn't a clean unassisted max effort either, same reasoning
    that already excluded a to-failure set from PR/1RM math. 'failure'
    itself stays in every exclusion list too, not just validation's accepted
    values -- the 2 real historical sets still carrying it need to keep
    being excluded exactly as they always were."""
    row = conn.execute("SELECT id FROM exercises WHERE name = ?", (exercise_name.strip(),)).fetchone()
    if row is None:
        return None
    exercise_id = row["id"]

    all_sets = conn.execute(
        """SELECT s.weight_kg, s.reps, s.logged_at, w.started_at, s.unilateral, s.weight_ratio
           FROM sets s JOIN workouts w ON w.id = s.workout_id
           WHERE s.exercise_id = ? AND s.set_type NOT IN ('failure', 'warmup', 'assisted')
                 AND s.weight_kg IS NOT NULL AND s.reps IS NOT NULL""",
        (exercise_id,),
    ).fetchall()

    bilateral = [s for s in all_sets if not s["unilateral"]]
    unilateral = [s for s in all_sets if s["unilateral"]]

    result = _compute_records(bilateral)
    is_unilateral = False
    if result is None:
        result = _compute_records(unilateral)
        is_unilateral = True
    if result is None:
        result = {"estimated_1rm": None, "max_weight": None, "max_volume": None, "by_rep_count": []}
    result["unilateral"] = is_unilateral
    return result


def flag_session_prs(sessions):
    """sessions: db.exercise_history()'s output, newest-first. Mutates each set
    dict in place with estimated_1rm (for the History tab's own "1RM" column,
    matching Strong's layout) plus three separate PR flags -- is_pr_1rm,
    is_pr_weight, is_pr_volume -- instead of one combined is_pr (2026-09-12,
    matching Strong's own three distinct trophy pills: "1RM" / "Weight" /
    "Vol." can appear together or separately on the same set, which a single
    boolean can't represent. is_pr is kept too (OR of the three) for any
    caller still relying on the old combined flag. failure/warmup sets and
    blank weight/reps never count as a PR. Unilateral and bilateral sets
    each keep their own running best (2026-09-16) rather than unilateral
    being excluded outright -- a one-arm rep still isn't compared against
    two-handed numbers, but an exercise done consistently one-sided (Reverse
    Fly (Machine)) needs its own real progression track, not a permanent
    "never a PR" verdict."""
    best = {False: {"weight": 0, "1rm": 0, "volume": 0}, True: {"weight": 0, "1rm": 0, "volume": 0}}
    for session in reversed(sessions):  # walk oldest-first to build a running best
        for s in session["sets"]:
            raw_weight, reps = s.get("weight_kg"), s.get("reps")
            # Effective weight (raw * weight_ratio, see _compute_records'
            # own comment) -- a variant with a saved ratio competes on true
            # comparable resistance, not the raw number off the machine.
            weight = raw_weight * (s.get("weight_ratio") or 1.0) if raw_weight is not None else None
            if weight is None or reps is None or s.get("set_type") in ("failure", "warmup", "assisted"):
                s["is_pr"] = False
                s["is_pr_1rm"] = False
                s["is_pr_weight"] = False
                s["is_pr_volume"] = False
                s["estimated_1rm"] = estimated_1rm(weight, reps)
                continue
            lane = best[bool(s.get("unilateral"))]
            e1rm = estimated_1rm(weight, reps) or 0
            volume = weight * reps
            s["estimated_1rm"] = e1rm
            s["is_pr_1rm"] = e1rm > lane["1rm"]
            s["is_pr_weight"] = weight > lane["weight"]
            s["is_pr_volume"] = volume > lane["volume"]
            s["is_pr"] = s["is_pr_1rm"] or s["is_pr_weight"] or s["is_pr_volume"]
            lane["weight"] = max(lane["weight"], weight)
            lane["1rm"] = max(lane["1rm"], e1rm)
            lane["volume"] = max(lane["volume"], volume)
    return sessions


def flag_duration_prs(sessions):
    """Parallel to flag_session_prs, for time-type exercises (Dead Hang etc.)
    where weight/reps are never set so flag_session_prs always marks them
    non-PR. Only touches sets that actually have a duration_sec -- leaves
    whatever flag_session_prs already set on every other set alone, so the
    two compose safely when both are called on the same sessions list."""
    best_duration = 0
    for session in reversed(sessions):  # oldest-first, same convention as flag_session_prs
        for s in session["sets"]:
            duration = s.get("duration_sec")
            if duration is None:
                continue
            if s.get("set_type") in ("failure", "warmup", "assisted"):
                s["is_pr"] = False
                continue
            s["is_pr"] = duration > best_duration
            best_duration = max(best_duration, duration)
    return sessions


def exercise_summary_for_workout(conn, workout_id):
    """Per-exercise "N x Exercise -> Best set" breakdown for one workout --
    feeds both the History list card (Phase 4.2) and the detail view's
    per-exercise grouping (Phase 4.3), one shared query/function so the two
    screens can't quietly disagree about what "best" means. set_count is
    every set actually logged (including warmup/failure -- Strong's own "N x"
    label is a literal count of what was performed); best_set excludes
    warmup/failure, same convention already established in workout_pr_count
    and exercise_records, since a warm-up or a failed rep shouldn't be shown
    off as the session's best effort. unit_type decides which field "best"
    even means (highest weight_kg / longest duration_sec / most reps).
    best_set prefers a real bilateral (non-unilateral) set when the session
    has one, but falls back to the best unilateral set rather than showing
    nothing when every set for that exercise this session was unilateral --
    the returned dict's own "unilateral" key tells the caller which case it
    got, so the UI can tag it (e.g. "(U)") instead of presenting a
    one-sided number as if it were a two-handed/two-legged one."""
    rows = conn.execute(
        """SELECT e.name AS exercise_name, e.unit_type, s.weight_kg, s.reps,
                  s.duration_sec, s.rpe, s.set_type, s.unilateral
           FROM sets s JOIN exercises e ON e.id = s.exercise_id
           WHERE s.workout_id = ? ORDER BY s.id""",
        (workout_id,),
    ).fetchall()

    order = []
    grouped = {}
    for r in rows:
        name = r["exercise_name"]
        if name not in grouped:
            grouped[name] = {"unit_type": r["unit_type"], "set_count": 0, "best_set": None, "_best_unilateral": None}
            order.append(name)
        entry = grouped[name]
        entry["set_count"] += 1
        if r["set_type"] in ("failure", "warmup", "assisted"):
            continue

        unit_type = entry["unit_type"]
        if unit_type == "time":
            value = r["duration_sec"]
        elif unit_type == "reps_only":
            value = r["reps"]
        else:
            value = r["weight_kg"]
        if value is None:
            continue

        # Tracked in a separate bucket, not excluded outright (2026-09-16
        # fix -- excluding it entirely made a session that's ALL unilateral
        # sets, e.g. a unilateral-only exercise, show "-" for Best Set
        # instead of the real number). A real bilateral set in the same
        # session is still always preferred below, so a lighter one-arm rep
        # can never silently become "the" displayed best when a genuine
        # two-handed number exists to show instead.
        bucket_key = "_best_unilateral" if r["unilateral"] else "best_set"
        current_best = entry[bucket_key]
        current_value = None
        if current_best is not None:
            current_value = (current_best["duration_sec"] if unit_type == "time"
                              else current_best["reps"] if unit_type == "reps_only"
                              else current_best["weight_kg"])
        if current_best is None or value > current_value:
            entry[bucket_key] = {
                "weight_kg": r["weight_kg"], "reps": r["reps"],
                "duration_sec": r["duration_sec"], "rpe": r["rpe"],
                "unilateral": bool(r["unilateral"]),
            }

    for name in order:
        entry = grouped[name]
        if entry["best_set"] is None and entry["_best_unilateral"] is not None:
            entry["best_set"] = entry["_best_unilateral"]
        del entry["_best_unilateral"]

    return [{"exercise_name": name, **grouped[name]} for name in order]


def workout_pr_counts(conn, workout_ids):
    """{workout_id: pr_count} for many workouts at once -- same result as
    calling workout_pr_count per id (verified against every real workout,
    2026-09-30), but one query plus a single oldest-first walk instead of a
    baseline query per exercise per workout, which is what made the History
    list's include_pr=1 load (90 workouts) take ~0.4s.

    Same rules as workout_pr_count: baselines only count genuinely earlier
    workouts (started_at strictly less, so a workout sharing a timestamp
    never counts toward another's baseline), lanes split by exercise and
    laterality, and a later set in the same workout may beat an earlier one."""
    wanted = set(workout_ids)
    if not wanted:
        return {}
    marks = ",".join("?" * len(wanted))
    rows = conn.execute(
        f"""SELECT s.workout_id, s.exercise_id, s.unilateral, s.weight_kg, s.reps, s.weight_ratio, w.started_at
            FROM sets s JOIN workouts w ON w.id = s.workout_id
            WHERE s.exercise_id IN (SELECT DISTINCT exercise_id FROM sets WHERE workout_id IN ({marks}))
              AND s.set_type NOT IN ('failure', 'warmup', 'assisted')
              AND s.weight_kg IS NOT NULL AND s.reps IS NOT NULL
            ORDER BY w.started_at, s.workout_id, s.id""",
        list(wanted),
    ).fetchall()

    counts = {wid: 0 for wid in wanted}
    best = {}  # (exercise_id, unilateral) -> [best_weight, best_1rm], over workouts already folded in
    i = 0
    while i < len(rows):
        # One group per distinct started_at: score the wanted workouts in it
        # against `best` as it stood before the group, then fold the group in.
        started_at = rows[i]["started_at"]
        j = i
        while j < len(rows) and rows[j]["started_at"] == started_at:
            j += 1
        group = rows[i:j]
        local = {}  # (workout_id, lane) -> that workout's own running baseline
        for r in group:
            if r["workout_id"] not in wanted:
                continue
            lane = (r["exercise_id"], bool(r["unilateral"]))
            key = (r["workout_id"], lane)
            if key not in local:
                local[key] = list(best.get(lane, (0, 0)))
            baseline = local[key]
            weight = r["weight_kg"] * r["weight_ratio"]
            e1rm = estimated_1rm(weight, r["reps"]) or 0
            if weight > baseline[0] or e1rm > baseline[1]:
                counts[r["workout_id"]] += 1
                baseline[0] = max(baseline[0], weight)
                baseline[1] = max(baseline[1], e1rm)
        for r in group:
            lane = (r["exercise_id"], bool(r["unilateral"]))
            weight = r["weight_kg"] * r["weight_ratio"]
            e1rm = estimated_1rm(weight, r["reps"]) or 0
            entry = best.setdefault(lane, [0, 0])
            entry[0] = max(entry[0], weight)
            entry[1] = max(entry[1], e1rm)
        i = j
    return counts


def workout_pr_count(conn, workout_id):
    """How many PRs happened during this specific workout -- feeds the history
    card footer ('N PRs'), matching Strong's own history-card layout. Compares
    each set against only genuinely earlier workouts (by started_at), and lets
    a later set in the same session beat an earlier one in the same session
    (a real progressive-overload PR within one workout should still count)."""
    workout = conn.execute("SELECT started_at FROM workouts WHERE id = ?", (workout_id,)).fetchone()
    if workout is None:
        return 0
    sets = conn.execute(
        "SELECT id, exercise_id, weight_kg, reps, set_type, unilateral, weight_ratio FROM sets WHERE workout_id = ? ORDER BY id",
        (workout_id,),
    ).fetchall()

    count = 0
    baseline_cache = {}  # (exercise_id, unilateral) -> [best_weight, best_1rm]
    for s in sets:
        if s["weight_kg"] is None or s["reps"] is None or s["set_type"] in ("failure", "warmup", "assisted"):
            continue
        weight = s["weight_kg"] * s["weight_ratio"]
        # Keyed by laterality too (2026-09-16) -- a unilateral set only ever
        # competes against prior unilateral sets of the same exercise, never
        # against bilateral ones, so an always-one-sided exercise (Reverse
        # Fly (Machine)) still gets real PR detection instead of never
        # counting at all.
        cache_key = (s["exercise_id"], bool(s["unilateral"]))
        if cache_key not in baseline_cache:
            prior = conn.execute(
                """SELECT s2.weight_kg, s2.reps, s2.weight_ratio FROM sets s2 JOIN workouts w2 ON w2.id = s2.workout_id
                   WHERE s2.exercise_id = ? AND w2.started_at < ? AND s2.set_type NOT IN ('failure', 'warmup', 'assisted')
                         AND s2.unilateral = ?
                         AND s2.weight_kg IS NOT NULL AND s2.reps IS NOT NULL""",
                (cache_key[0], workout["started_at"], 1 if cache_key[1] else 0),
            ).fetchall()
            best_weight = max((p["weight_kg"] * p["weight_ratio"] for p in prior), default=0)
            best_1rm = max((estimated_1rm(p["weight_kg"] * p["weight_ratio"], p["reps"]) or 0 for p in prior), default=0)
            baseline_cache[cache_key] = [best_weight, best_1rm]

        baseline = baseline_cache[cache_key]
        e1rm = estimated_1rm(weight, s["reps"]) or 0
        if weight > baseline[0] or e1rm > baseline[1]:
            count += 1
            baseline[0] = max(baseline[0], weight)
            baseline[1] = max(baseline[1], e1rm)
    return count


