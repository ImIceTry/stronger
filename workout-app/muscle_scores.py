"""Per-muscle-group scoring for the body map (Profile tab). Split out of
records.py (2026-09-17, Loop 2 refactor) -- a distinct concern (muscle-group
volume/progress aggregation) from records.py's own PR/1RM/records math,
genuinely half the original file by itself."""

from datetime import datetime, timedelta

from records import estimated_1rm


def _parse_muscles(raw):
    """Yields (muscle_name, weight) pairs. A bare name ("chest") is a
    primary mover, weight 1.0 -- the common case, since most of this app's
    exercises are single-muscle isolation movements. "name:0.5" marks a
    real secondary/synergist mover (2026-09-15, ImIceTry's own question --
    "have you considered how much a muscle is used, or just if it is
    used?" -- the research-backed compound-lift re-tagging that same day
    had already identified which movers were primary vs secondary per
    exercise; this just stops discarding that distinction by treating
    every listed muscle as equally worked). 0.5 rather than a finer-grained
    per-exercise number: real EMG activation percentages don't translate
    cleanly into a training-stimulus discount, so a flat primary/secondary
    split is the honest level of precision, not false accuracy."""
    result = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        if ":" in token:
            name, weight = token.split(":", 1)
            result.append((name.strip(), float(weight)))
        else:
            result.append((token, 1.0))
    return result


def weekly_hard_sets(conn, now, days=7):
    """{muscle: weighted working-set count} over the last `days` days
    (2026-09-30, ImIceTry's pick from the full-review feature list) -- the
    number hypertrophy volume guidance is usually stated in (roughly 10-20
    hard sets per muscle per week). A primary mover counts a set as 1, a
    secondary mover (":0.5") as 0.5, same role weights as everywhere else in
    this file. Warm-ups don't count; a drop set's rows count as one set per
    pair, matching how the active-workout screen numbers them ("3(D), 3(D)").
    A row with nothing logged at all is skipped."""
    since = (now - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    rows = conn.execute(
        """SELECT s.workout_id, s.exercise_id, s.set_type, e.primary_muscles
           FROM sets s
           JOIN workouts w ON w.id = s.workout_id
           JOIN exercises e ON e.id = s.exercise_id
           WHERE w.started_at >= ? AND e.primary_muscles IS NOT NULL
             AND s.set_type != 'warmup'
             AND (s.reps IS NOT NULL OR s.duration_sec IS NOT NULL OR s.weight_kg IS NOT NULL)
           ORDER BY s.workout_id, s.exercise_id, s.id""",
        (since,),
    ).fetchall()

    per_exercise = {}  # (workout_id, exercise_id) -> [primary_muscles, set count]
    drop_run = {}      # (workout_id, exercise_id) -> length of the current consecutive drop run
    for r in rows:
        key = (r["workout_id"], r["exercise_id"])
        entry = per_exercise.setdefault(key, [r["primary_muscles"], 0])
        if r["set_type"] == "drop":
            run = drop_run.get(key, 0) + 1
            drop_run[key] = run
            if run % 2 == 1:  # first row of each pair counts, its continuation doesn't
                entry[1] += 1
        else:
            drop_run[key] = 0
            entry[1] += 1

    totals = {}
    for raw_muscles, count in per_exercise.values():
        for muscle, weight in _parse_muscles(raw_muscles):
            totals[muscle] = totals.get(muscle, 0.0) + count * weight
    return totals


def muscle_group_scores(conn, recent_days=30, prior_days=90, stale_days=14):
    """Per-muscle-group stats for the body map (Profile tab).

    `score` (0-1, drives the map's color) is a STALENESS score, not the
    blended quality score this used to be -- redesigned 2026-09-14 after
    ImIceTry flagged the old version as decorative, not useful: a single
    number averaging strength/intensity/progress couldn't say WHY a muscle
    was red (undertrained? regressing? just not loaded heavy enough?), and
    those need completely different actions. Staleness answers one concrete
    question -- how long since this muscle was actually trained -- and,
    unlike the other three signals, it's computable for every muscle
    regardless of unit_type, so it no longer leaves reps_only/time-based
    muscle groups permanently gray.

    score = weight * 1.0 if trained today, decaying linearly to weight * 0.0
    at `stale_days` days since -- taking the BEST (max) weight*decay value
    across every real touch, so a muscle trained both directly (weight 1.0)
    and as a secondary mover elsewhere (weight 0.5) reads off whichever
    touch actually gives it the strongest, most recent signal (2026-09-15:
    a secondary-only touch today correctly caps out at 0.5, not a full 1.0,
    rather than every listed muscle looking equally "just trained"
    regardless of how directly an exercise actually works it). A muscle
    tagged only as a primary mover everywhere behaves exactly as before
    this change -- weight 1.0 makes the max-decay computation collapse to
    "decay of the single most recent touch," the same formula the original
    2026-09-14 staleness redesign used.

    days_since_trained/last_trained_exercise stay unweighted -- an honest,
    literal answer to "when did I last do ANYTHING for this muscle,"
    regardless of how central that exercise was to it. The discount lives
    only in `score`, not in this factual detail.

    strength/intensity/progress are still computed as in the original
    2026-09-09 design (see git history), extended the same way: each
    exercise's contribution to a muscle's average is scaled by that
    exercise's weight for this muscle, so a secondary-mover exercise pulls
    the average toward itself half as hard as a primary one would.
    - strength: recent (last `recent_days`) best est-1RM per exercise, as a
      fraction of that exercise's *all-time* best est-1RM, averaged across
      the muscle group's exercises (weighted by recent set count * role
      weight, so a once-tried or secondary-only exercise can't dominate).
    - intensity: weighted average %1RM (each set's weight_kg / that
      exercise's all-time-best weight_kg) across the muscle group's real
      working sets in the last `recent_days`.
    - progress: recent-period weighted-average est-1RM vs the prior period
      (`recent_days` to `prior_days` ago) weighted-average est-1RM, as a
      ratio, clamped to [0.5, 1.5] before normalizing to 0-1.
    All three stay scoped to weight_reps exercises (est-1RM/%1RM are
    inherently weight-based) and are `None` when there's no real recent
    data to compute them from -- callers should treat that as "no data,"
    not a fabricated value.

    Every muscle that appears anywhere in the exercise library is always
    present in the returned dict (never absent), since staleness is always
    answerable -- "never trained" is itself a real, actionable result.
    """
    all_muscle_rows = conn.execute(
        "SELECT DISTINCT primary_muscles FROM exercises WHERE primary_muscles IS NOT NULL"
    ).fetchall()
    all_muscles = set()
    for r in all_muscle_rows:
        for name, _weight in _parse_muscles(r["primary_muscles"]):
            all_muscles.add(name)

    # Every real touch (any unit_type/set_type) with its role weight --
    # last_trained tracks the single most recent regardless of weight
    # (factual detail), staleness_score tracks the best weight*decay seen
    # across ALL touches (the actual color-driving signal).
    last_trained_rows = conn.execute(
        """SELECT e.primary_muscles AS muscle, w.started_at, e.name AS exercise_name
           FROM sets s
           JOIN workouts w ON w.id = s.workout_id
           JOIN exercises e ON e.id = s.exercise_id
           WHERE e.primary_muscles IS NOT NULL"""
    ).fetchall()

    # Naive local time, not UTC (2026-09-16 fix, ImIceTry caught the app
    # showing "Today" for a workout logged yesterday) -- started_at is
    # stored as whatever the logging device's own local wall-clock read (no
    # tz info, see app.js's fmtDateTime), matching every other "now" in this
    # codebase (db.py's _now_iso uses time.strftime, also local). Comparing
    # that against a genuinely UTC "now" silently shifted every elapsed-time
    # calculation here by the server's UTC offset (docker-host runs
    # Europe/Berlin, so +1/+2h depending on DST) -- small enough to rarely
    # matter for the staleness *score*'s continuous decay, but exactly the
    # kind of error that flips a display near a real midnight boundary.
    now = datetime.now()
    last_trained = {}  # muscle -> (started_at, exercise_name), unweighted latest
    staleness_score = {}  # muscle -> best weight * linear-decay seen
    for r in last_trained_rows:
        started = datetime.strptime(r["started_at"], "%Y-%m-%d %H:%M:%S")
        days_since_touch = (now - started).total_seconds() / 86400.0
        decay = max(0.0, 1.0 - days_since_touch / stale_days)
        for muscle, weight in _parse_muscles(r["muscle"]):
            if muscle not in last_trained or started > last_trained[muscle][0]:
                last_trained[muscle] = (started, r["exercise_name"])
            weighted = weight * decay
            if weighted > staleness_score.get(muscle, 0.0):
                staleness_score[muscle] = weighted

    rows = conn.execute(
        """SELECT e.primary_muscles AS muscle, s.exercise_id, s.weight_kg, s.reps,
                  w.started_at, s.unilateral, s.weight_ratio
           FROM sets s
           JOIN workouts w ON w.id = s.workout_id
           JOIN exercises e ON e.id = s.exercise_id
           WHERE e.primary_muscles IS NOT NULL
             AND e.unit_type = 'weight_reps'
             AND s.set_type NOT IN ('failure', 'warmup')
             AND s.weight_kg IS NOT NULL AND s.reps IS NOT NULL
             AND julianday('now') - julianday(w.started_at) <= ?""",
        (prior_days,),
    ).fetchall()
    # Effective weight (raw * weight_ratio) from here on -- every %1RM/
    # strength/intensity computation below needs true comparable resistance,
    # same reasoning as _compute_records. Converted to plain dicts once here
    # rather than at every individual r["weight_kg"] read downstream.
    rows = [{**dict(r), "weight_kg": r["weight_kg"] * r["weight_ratio"]} for r in rows]

    # all-time best est-1RM/weight per exercise, unbounded by the windows
    # above (a muscle group's "all-time peak" has to look further back than
    # prior_days whenever real history goes back further, which it does).
    alltime_rows = conn.execute(
        """SELECT s.exercise_id, s.weight_kg, s.reps, s.unilateral, s.weight_ratio
           FROM sets s
           JOIN exercises e ON e.id = s.exercise_id
           WHERE e.unit_type = 'weight_reps'
             AND s.set_type NOT IN ('failure', 'warmup')
             AND s.weight_kg IS NOT NULL AND s.reps IS NOT NULL"""
    ).fetchall()
    alltime_rows = [{**dict(r), "weight_kg": r["weight_kg"] * r["weight_ratio"]} for r in alltime_rows]

    # Prefer each exercise's bilateral history for its %1RM baseline; fall
    # back to unilateral only when the exercise has no bilateral sets at all
    # (2026-09-16, Reverse Fly (Machine) -- always done one-handed, so
    # excluding unilateral outright left it with a permanently-zero
    # denominator and no intensity/strength data ever). Applied identically
    # to alltime_rows below and the windowed `rows` above, so numerator and
    # denominator always come from the same lane.
    wants_bilateral = {r["exercise_id"] for r in alltime_rows if not r["unilateral"]}

    def _in_lane(r):
        eid = r["exercise_id"]
        return (not r["unilateral"]) if eid in wants_bilateral else bool(r["unilateral"])

    rows = [r for r in rows if _in_lane(r)]

    alltime_best_1rm = {}
    alltime_best_weight = {}
    for r in alltime_rows:
        if not _in_lane(r):
            continue
        e1rm = estimated_1rm(r["weight_kg"], r["reps"]) or 0
        eid = r["exercise_id"]
        if e1rm > alltime_best_1rm.get(eid, 0):
            alltime_best_1rm[eid] = e1rm
        if r["weight_kg"] > alltime_best_weight.get(eid, 0):
            alltime_best_weight[eid] = r["weight_kg"]

    # started_at is stored as a naive "YYYY-MM-DD HH:MM:SS" string (no
    # timezone), so `now` has to stay naive too for the comparisons below --
    # already computed above as a naive UTC datetime.
    recent_cutoff = now - timedelta(days=recent_days)

    # muscle -> exercise_id -> {"recent_1rm": [...], "recent_pct1rm": [...], "prior_1rm": [...], "weight": <this exercise's role weight for this muscle>}
    by_muscle = {}
    for r in rows:
        eid = r["exercise_id"]
        started = datetime.strptime(r["started_at"], "%Y-%m-%d %H:%M:%S")
        e1rm = estimated_1rm(r["weight_kg"], r["reps"])
        if e1rm is None:
            continue
        for muscle, muscle_weight in _parse_muscles(r["muscle"]):
            bucket = by_muscle.setdefault(muscle, {}).setdefault(
                eid, {"recent_1rm": [], "recent_pct1rm": [], "prior_1rm": [], "weight": muscle_weight}
            )
            best_w = alltime_best_weight.get(eid) or 0
            if started >= recent_cutoff:
                bucket["recent_1rm"].append(e1rm)
                if best_w > 0:
                    bucket["recent_pct1rm"].append(100.0 * r["weight_kg"] / best_w)
            else:
                bucket["prior_1rm"].append(e1rm)

    results = {}
    for muscle, exercises in by_muscle.items():
        strength_terms = []  # (weight, ratio) per exercise, weight = recent set count * role weight
        intensity_terms = []  # (role weight, %1RM value) per set
        recent_1rm_terms = []  # (role weight, est-1RM value) per set
        prior_1rm_terms = []

        for eid, data in exercises.items():
            w = data["weight"]
            all_time = alltime_best_1rm.get(eid) or 0
            if data["recent_1rm"] and all_time > 0:
                recent_best = max(data["recent_1rm"])
                ratio = min(1.0, recent_best / all_time)
                strength_terms.append((w * len(data["recent_1rm"]), ratio))
            intensity_terms.extend((w, v) for v in data["recent_pct1rm"])
            recent_1rm_terms.extend((w, v) for v in data["recent_1rm"])
            prior_1rm_terms.extend((w, v) for v in data["prior_1rm"])

        if not recent_1rm_terms:
            # No real recent (last recent_days) weight_reps training for this
            # muscle -- leave strength/intensity/progress unset rather than
            # fabricate them from stale/prior-only data. Staleness (below)
            # still gets computed from ALL set types, independent of this.
            results[muscle] = None
            continue

        # strength: weighted average of each exercise's recent-vs-all-time ratio
        total_weight = sum(w for w, _ in strength_terms)
        strength = (
            sum(w * ratio for w, ratio in strength_terms) / total_weight
            if total_weight > 0
            else None
        )

        # intensity: weighted average %1RM across recent real sets (role
        # weight, not just a plain mean, so a secondary-mover exercise pulls
        # this half as hard as a primary one would), capped at 100 (a set
        # can't exceed the exercise's own all-time-best weight without
        # redefining what "all-time-best" means mid-calculation)
        total_iw = sum(w for w, _ in intensity_terms)
        intensity = (
            min(100.0, sum(w * v for w, v in intensity_terms) / total_iw) / 100.0
            if total_iw > 0
            else None
        )

        # progress: recent weighted-avg vs prior weighted-avg, as a ratio --
        # 1.0 (flat) maps to the midpoint of the 0-1 output range, clamped
        # to +/-50% so one noisy outlier set can't swing the whole muscle
        # group's color
        if prior_1rm_terms:
            recent_avg = sum(w * v for w, v in recent_1rm_terms) / sum(w for w, _ in recent_1rm_terms)
            prior_avg = sum(w * v for w, v in prior_1rm_terms) / sum(w for w, _ in prior_1rm_terms)
            raw_ratio = recent_avg / prior_avg if prior_avg > 0 else 1.0
            clamped = max(0.5, min(1.5, raw_ratio))
            progress = (clamped - 0.5) / 1.0  # maps [0.5, 1.5] -> [0, 1]
            # Same ratio the clamped progress score above is built from,
            # exposed unclamped as a real percentage instead of a raw kg
            # delta (2026-09-16, switched from kg -- a flat "+5kg" reads
            # very differently across muscle groups with wildly different
            # absolute loads, e.g. a 30kg lateral raise vs a 150kg leg
            # press; percentage is the same unit everywhere since it's
            # already the ratio the color itself is derived from).
            progress_pct_delta = round((raw_ratio - 1) * 100, 1)
        else:
            # no prior-period data to compare against (e.g. a muscle only
            # just started being trained) -- neither reward nor penalize,
            # and no real delta to report either.
            progress = 0.5
            progress_pct_delta = None

        results[muscle] = {
            "strength": round(strength, 3) if strength is not None else None,
            "intensity": round(intensity, 3) if intensity is not None else None,
            "progress": round(progress, 3),
            "progress_pct_delta": progress_pct_delta,
        }

    sets_7d = weekly_hard_sets(conn, now)

    final = {}
    for muscle in all_muscles:
        detail = results.get(muscle)
        trained = last_trained.get(muscle)
        if trained:
            # Calendar-day difference, not raw elapsed hours/24 (2026-09-16
            # fix, same bug report) -- a workout at 23:50 yesterday is only
            # ~0.1 days of real elapsed time before a "now" of 00:10 today,
            # which used to floor to 0 and display "Today" despite being
            # yesterday by any normal calendar reckoning. Matches the exact
            # date-truncate-then-diff approach app.js's relativeDate()
            # already uses correctly for workout history dates.
            days_since = (now.date() - trained[0].date()).days
            last_exercise = trained[1]
        else:
            # No real set has ever touched this muscle -- reads as fully
            # "needs attention" (score 0, from staleness_score's own default
            # below), distinguished for the caller via days_since_trained
            # being None and last_trained_exercise being None rather than a
            # real name.
            days_since = None
            last_exercise = None

        final[muscle] = {
            "score": round(staleness_score.get(muscle, 0.0), 3),
            "days_since_trained": days_since,
            "last_trained_exercise": last_exercise,
            "strength": detail["strength"] if detail else None,
            "intensity": detail["intensity"] if detail else None,
            "progress": detail["progress"] if detail else None,
            "progress_pct_delta": detail["progress_pct_delta"] if detail else None,
            "sets_7d": round(sets_7d.get(muscle, 0.0), 1),
        }

    return final
