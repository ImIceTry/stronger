"""Automated regression test for the Workout App backend. Spins up server.py
against a throwaway temp database (never the real one) on its own port,
exercises every endpoint, and asserts the responses are correct.

Run: .venv/bin/python test_api.py
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

PORT = 8099
BASE = f"http://127.0.0.1:{PORT}"


def request(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print(f"  ok: {message}")


def main():
    tmp_dir = tempfile.mkdtemp(prefix="workout_app_test_")
    env = os.environ.copy()
    env["WORKOUT_DB_PATH"] = os.path.join(tmp_dir, "workout.db")
    env["STRONG_EXPORTS_DIR"] = os.path.join(tmp_dir, "exports")
    env["WORKOUT_APP_PORT"] = str(PORT)

    server_dir = os.path.dirname(os.path.abspath(__file__))
    proc = subprocess.Popen(
        [os.path.join(server_dir, ".venv", "bin", "python"), "server.py"],
        cwd=server_dir, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    try:
        for _ in range(20):
            time.sleep(0.2)
            try:
                request("GET", "/api/health")
                break
            except Exception:
                continue
        else:
            raise RuntimeError("server never came up")

        print("health check")
        status, body = request("GET", "/api/health")
        check(status == 200 and body["ok"] is True and body["workouts"] == 0, "fresh DB has 0 workouts")

        print("sync a workout with rpe + drop set")
        status, body = request("POST", "/api/workouts/sync", {
            "name": "Push", "started_at": "2026-01-01 08:00:00", "finished_at": "2026-01-01 08:30:00",
            "duration_sec": 1800,
            "sets": [
                {"exercise_name": "Bench Press", "set_order": 1, "weight_kg": 60, "reps": 8, "rpe": 8.5, "rest_after_sec": 90},
                # 40x10 (400 volume) loses to 60x8 (480) on every PR axis -- volume
                # PRs exist since 2026-09-12, so a drop set only counts as "weaker"
                # if its volume is lower too (the old 50x10 was a real volume PR).
                {"exercise_name": "Bench Press", "set_order": 2, "weight_kg": 40, "reps": 10, "rpe": 10, "set_type": "drop"},
            ],
        })
        check(status == 200, "sync succeeds")
        workout_id = body["id"]

        print("replayed sync (lost response / double queue flush) doesn't duplicate")
        replay = {
            "name": "Push", "started_at": "2026-01-01 08:00:00", "finished_at": "2026-01-01 08:30:00",
            "duration_sec": 1800,
            "sets": [{"exercise_name": "Bench Press", "set_order": 1, "weight_kg": 60, "reps": 8}],
        }
        status, body = request("POST", "/api/workouts/sync", replay)
        check(status == 200 and body["id"] == workout_id and body.get("duplicate") is True,
              f"replay returns the existing id, got {body}")
        status, body = request("GET", "/api/health")
        check(body["workouts"] == 1, f"still exactly 1 workout, got {body['workouts']}")

        print("previous performance")
        status, body = request("GET", "/api/exercises/Bench%20Press/last")
        check(status == 200 and body["sets"][0]["weight_kg"] == 60, "previous performance reflects the set")

        print("exercise context bundles the per-card lookups")
        status, body = request("GET", "/api/exercises/Bench%20Press/context")
        check(status == 200 and body["last"]["sets"][0]["weight_kg"] == 60 and body["unit_type"] == "weight_reps"
              and body["default_rest_sec"] is None and body["variant_ratios"] == {} and body["default_unilateral"] is False,
              f"context matches the individual endpoints, got {body}")
        status, body = request("GET", "/api/exercises/Never%20Logged/context")
        check(status == 200 and body["last"] is None and body["unit_type"] is None, "unknown exercise -> empty context, not 404")

        print("records / 1RM math")
        status, body = request("GET", "/api/exercises/Bench%20Press/records")
        check(status == 200 and body["estimated_1rm"]["value"] == 76.0, f"Epley 1RM correct, got {body['estimated_1rm']}")

        print("history with PR flags")
        status, body = request("GET", "/api/exercises/Bench%20Press/history")
        sets = body["sessions"][0]["sets"]
        check(sets[0]["is_pr"] is True, "first set is a PR")
        check(sets[1]["is_pr"] is False, "weaker drop set is not a PR")

        print("workouts list aggregates volume/PR count")
        status, body = request("GET", f"/api/workouts?include_pr=1")
        w = body["workouts"][0]
        check(w["volume_kg"] == 880.0, f"volume correct, got {w['volume_kg']}")
        check(w["pr_count"] == 1, f"pr_count correct, got {w['pr_count']}")

        print("exercise summary: per-exercise best-set breakdown (Phase 4.1)")
        status, body = request("GET", "/api/workouts?include_summary=1")
        summary = body["workouts"][0]["exercises"][0]
        check(summary["exercise_name"] == "Bench Press", "list summary has the right exercise")
        check(summary["set_count"] == 2, "list summary set_count correct")
        check(summary["best_set"]["weight_kg"] == 60,
              f"list summary picks the higher-weight set (drop set is weaker), got {summary['best_set']}")
        status, body = request("GET", f"/api/workouts/{workout_id}")
        check(body["exercise_summary"][0]["best_set"]["weight_kg"] == 60,
              "detail endpoint's exercise_summary agrees with the list endpoint's")

        print("edit workout via PUT")
        status, body = request("PUT", f"/api/workouts/{workout_id}", {
            "name": "Push (edited)", "started_at": "2026-01-01 08:00:00",
            "sets": [{"exercise_name": "Bench Press", "set_order": 1, "weight_kg": 65, "reps": 8}],
        })
        check(status == 200, "edit succeeds")
        status, body = request("GET", f"/api/workouts/{workout_id}")
        check(body["name"] == "Push (edited)" and len(body["sets"]) == 1, "edit actually replaced the sets")

        print("validation rejects bad input")
        status, body = request("POST", "/api/workouts/sync", {
            "name": "Bad", "started_at": "2026-01-01 09:00:00",
            "sets": [{"exercise_name": "X", "set_order": 1, "weight_kg": -5, "reps": 8}],
        })
        check(status == 400, "negative weight rejected")

        status, body = request("POST", "/api/workouts/sync", {
            "name": "Bad", "started_at": "not-a-date",
            "sets": [{"exercise_name": "X", "set_order": 1, "weight_kg": 10, "reps": 8}],
        })
        check(status == 400, "bad date format rejected")

        print("exercises/all listing works")
        status, body = request("GET", "/api/exercises/all")
        check(status == 200 and len(body["exercises"]) >= 1, "exercises/all returns rows")
        check("unit_type" in body["exercises"][0], "exercises/all includes unit_type")

        print("time-type exercise: sync, previous-performance, duration-PR")
        status, body = request("POST", "/api/workouts/sync", {
            "name": "Hang", "started_at": "2026-01-02 08:00:00", "finished_at": "2026-01-02 08:10:00",
            "duration_sec": 600,
            "sets": [
                {"exercise_name": "Plank Hold", "set_order": 1, "duration_sec": 30},
                {"exercise_name": "Plank Hold", "set_order": 2, "duration_sec": 45},
            ],
        })
        check(status == 200, "time-type sync succeeds")
        hang_workout_id = body["id"]
        # unit_type is only ever computed by the one-time backfill script (Phase
        # 0.3), not on ordinary sync -- simulate "already classified" directly,
        # same as a real exercise that went through that one-time pass would be.
        conn = sqlite3.connect(env["WORKOUT_DB_PATH"])
        conn.execute("UPDATE exercises SET unit_type = 'time' WHERE name = 'Plank Hold'")
        conn.commit()
        conn.close()

        status, body = request("GET", "/api/exercises/Plank%20Hold/last")
        check(status == 200 and body["unit_type"] == "time", "previous-performance reports unit_type")
        check(body["sets"][1]["duration_sec"] == 45, "previous-performance includes duration_sec")

        status, body = request("GET", "/api/exercises/Plank%20Hold/history")
        sets = body["sessions"][0]["sets"]
        check(sets[0]["is_pr"] is True, "first duration set (30s) is a PR")
        check(sets[1]["is_pr"] is True, "longer second set (45s) is also a PR")

        status, body = request("GET", f"/api/workouts/{hang_workout_id}")
        summary = body["exercise_summary"][0]
        check(summary["unit_type"] == "time", "exercise_summary reports unit_type")
        check(summary["set_count"] == 2, "exercise_summary set_count correct")
        check(summary["best_set"]["duration_sec"] == 45,
              f"best_set picks the longer duration, got {summary['best_set']}")

        print("warm-up sets excluded from records/PRs")
        status, body = request("POST", "/api/workouts/sync", {
            "name": "Squat Day", "started_at": "2026-01-03 08:00:00", "finished_at": "2026-01-03 08:30:00",
            "duration_sec": 1800,
            "sets": [
                {"exercise_name": "Squat", "set_order": 1, "weight_kg": 100, "reps": 10, "set_type": "warmup"},
                {"exercise_name": "Squat", "set_order": 2, "weight_kg": 60, "reps": 8},
            ],
        })
        check(status == 200, "warm-up sync succeeds")
        squat_workout_id = body["id"]
        status, body = request("GET", f"/api/workouts/{squat_workout_id}")
        squat_summary = body["exercise_summary"][0]
        check(squat_summary["set_count"] == 2, "exercise_summary set_count includes the warm-up set")
        check(squat_summary["best_set"]["weight_kg"] == 60,
              f"exercise_summary best_set excludes the warm-up despite its higher weight, got {squat_summary['best_set']}")
        status, body = request("GET", "/api/exercises/Squat/records")
        check(status == 200 and body["max_weight"]["value"] == 60,
              f"warm-up set (100kg) excluded from max_weight, got {body['max_weight']}")
        status, body = request("GET", "/api/exercises/Squat/history")
        sets = body["sessions"][0]["sets"]
        check(sets[0]["is_pr"] is False, "warm-up set never flags as a PR even though its weight is higher")
        check(sets[1]["is_pr"] is True, "the real 60kg set still flags as a PR (first real set for this exercise)")

        print("handle/grip: validated fixed lists, round-trip through get and update")
        status, body = request("POST", "/api/workouts/sync", {
            "name": "Cable Day", "started_at": "2026-01-04 08:00:00", "finished_at": "2026-01-04 08:30:00",
            "duration_sec": 1800,
            "sets": [
                {"exercise_name": "Triceps Pushdown (Cable)", "set_order": 1, "weight_kg": 30, "reps": 10,
                 "handle": "Rope", "grip": "Neutral"},
                {"exercise_name": "Triceps Pushdown (Cable)", "set_order": 2, "weight_kg": 30, "reps": 10},
            ],
        })
        check(status == 200, "sync with handle/grip succeeds")
        cable_id = body["id"]
        status, body = request("GET", f"/api/workouts/{cable_id}")
        got = [(x["handle"], x["grip"]) for x in body["sets"]]
        check(got == [("Rope", "Neutral"), (None, None)], f"handle/grip round-trip via GET, got {got}")
        status, body = request("PUT", f"/api/workouts/{cable_id}", {
            "name": "Cable Day", "started_at": "2026-01-04 08:00:00", "sets": [
                {"exercise_name": "Triceps Pushdown (Cable)", "set_order": 1, "weight_kg": 30, "reps": 10,
                 "handle": "V-bar", "grip": "Overhand"},
            ],
        })
        check(status == 200, "update with new handle/grip succeeds")
        status, body = request("GET", f"/api/workouts/{cable_id}")
        check((body["sets"][0]["handle"], body["sets"][0]["grip"]) == ("V-bar", "Overhand"), "update replaces handle/grip")
        status, body = request("POST", "/api/workouts/sync", {
            "name": "Bad", "started_at": "2026-01-05 08:00:00", "finished_at": "2026-01-05 08:30:00",
            "duration_sec": 1800,
            "sets": [{"exercise_name": "Triceps Pushdown (Cable)", "set_order": 1, "weight_kg": 30, "reps": 10, "handle": "Banana"}],
        })
        check(status == 400, f"unknown handle rejected with 400, got {status}")

        print("sticky note: get/set/clear persists across exercise, not workout-scoped")
        status, body = request("GET", "/api/exercises/Plank%20Hold/sticky-note")
        check(status == 200 and body["note"] is None, "no sticky note yet")
        status, body = request("PUT", "/api/exercises/Plank%20Hold/sticky-note", {"note": "try the paused variant"})
        check(status == 200 and body["note"] == "try the paused variant", "sticky note set")
        status, body = request("GET", "/api/exercises/Plank%20Hold/sticky-note")
        check(status == 200 and body["note"] == "try the paused variant", "sticky note persists on re-fetch")
        status, body = request("PUT", "/api/exercises/Plank%20Hold/sticky-note", {"note": ""})
        check(status == 200 and body["note"] is None, "clearing the note removes it (empty == none, not an empty string)")

        print("machine factors: a named machine with factor 1 is kept, null removes it")
        status, body = request("PUT", "/api/exercises/Lat%20Pulldown/variant-ratios", {"variant": "Old machine", "ratio": 1})
        check(status == 200 and body["ratios"] == {"Old machine": 1}, f"factor 1 stored, got {body}")
        status, body = request("PUT", "/api/exercises/Lat%20Pulldown/variant-ratios", {"variant": "Heavy machine", "ratio": 1.05})
        check(status == 200 and body["ratios"] == {"Old machine": 1, "Heavy machine": 1.05}, f"two machines kept, got {body}")
        status, body = request("PUT", "/api/exercises/Lat%20Pulldown/variant-ratios", {"variant": "Old machine", "ratio": None})
        check(status == 200 and body["ratios"] == {"Heavy machine": 1.05}, f"null removes only that machine, got {body}")

        print("muscle scores: strength/intensity/progress blend, real math not just a shape check")
        now = datetime.now()  # matches records.py's own "now" basis (naive local, fixed 2026-09-16)
        old_date = (now - timedelta(days=60)).strftime("%Y-%m-%d %H:%M:%S")
        recent_date = (now - timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")
        for date, weight in [(old_date, 50), (recent_date, 60)]:
            request("POST", "/api/workouts/sync", {
                "name": "Push", "started_at": date, "finished_at": date, "duration_sec": 1800,
                "sets": [{"exercise_name": "Overhead Press", "set_order": 1, "weight_kg": weight, "reps": 8}],
            })
        conn = sqlite3.connect(env["WORKOUT_DB_PATH"])
        conn.execute("UPDATE exercises SET primary_muscles = 'shoulders', unit_type = 'weight_reps' WHERE name = 'Overhead Press'")
        conn.commit()
        conn.close()

        status, body = request("GET", "/api/muscle-scores")
        shoulders = body["muscles"]["shoulders"]
        check(status == 200, "muscle-scores endpoint responds")
        check(shoulders["strength"] == 1.0, f"strength is 1.0 -- the recent 60kg set IS the all-time best, got {shoulders['strength']}")
        check(shoulders["intensity"] == 1.0, f"intensity is 1.0 -- same reason, got {shoulders['intensity']}")
        # progress: est_1rm(60,8)=76.0, est_1rm(50,8)=63.33..., ratio=1.2 -> (1.2-0.5)/1.0=0.7
        check(abs(shoulders["progress"] - 0.7) < 0.01, f"progress reflects the real 50kg->60kg improvement, got {shoulders['progress']}")
        check("forearms" not in body["muscles"], "a muscle with zero real sets is absent, not a fabricated score")
        check(shoulders["sets_7d"] == 1.0, f"only the 5-days-ago set counts toward the week, got {shoulders['sets_7d']}")

        print("weekly hard sets: warm-ups skipped, a drop pair is one set, secondary movers count half")
        week_date = (now - timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S")
        request("POST", "/api/workouts/sync", {
            "name": "Arms", "started_at": week_date, "finished_at": week_date, "duration_sec": 1800,
            "sets": [
                {"exercise_name": "Cable Curl", "set_order": 1, "weight_kg": 10, "reps": 12, "set_type": "warmup"},
                {"exercise_name": "Cable Curl", "set_order": 2, "weight_kg": 20, "reps": 10},
                {"exercise_name": "Cable Curl", "set_order": 3, "weight_kg": 20, "reps": 9, "set_type": "drop"},
                {"exercise_name": "Cable Curl", "set_order": 4, "weight_kg": 15, "reps": 6, "set_type": "drop"},
            ],
        })
        conn = sqlite3.connect(env["WORKOUT_DB_PATH"])
        conn.execute("UPDATE exercises SET primary_muscles = 'biceps, forearms:0.5' WHERE name = 'Cable Curl'")
        conn.commit()
        conn.close()
        status, body = request("GET", "/api/muscle-scores")
        check(body["muscles"]["biceps"]["sets_7d"] == 2.0, f"biceps: 1 normal + 1 drop pair = 2, got {body['muscles']['biceps']['sets_7d']}")
        check(body["muscles"]["forearms"]["sets_7d"] == 1.0, f"forearms as secondary: 2 x 0.5 = 1, got {body['muscles']['forearms']['sets_7d']}")

        print("last session per machine (last_by_variant, 2026-10-15)")

        def sync_day(day, exercise, sets):
            status, _ = request("POST", "/api/workouts/sync", {
                "name": "Push", "started_at": f"2026-02-{day:02d} 08:00:00",
                "finished_at": f"2026-02-{day:02d} 08:30:00", "duration_sec": 1800,
                "sets": [{"exercise_name": exercise, "set_order": i + 1, "weight_kg": w, "reps": r, **extra}
                         for i, (w, r, extra) in enumerate(sets)],
            })
            check(status == 200, f"synced {exercise} on 2026-02-{day:02d}")

        def pairs(bucket):
            return [(s["weight_kg"], s["reps"]) for s in bucket["sets"]]

        sports_art = {"variant": "SportsArt", "weight_ratio": 0.25}
        life_fitness = {"variant": "LifeFitness"}
        raise_name = "Machine Test Raise"
        sync_day(1, raise_name, [(40, 12, sports_art), (40, 8, sports_art), (35, 12, sports_art)])
        sync_day(3, raise_name, [(20, 10, {})])
        sync_day(8, raise_name, [(9.25, 12, life_fitness), (9.25, 12, life_fitness), (9.25, 10, life_fitness)])
        sync_day(12, raise_name, [(40, 12, sports_art), (45, 6, sports_art)])
        sync_day(15, raise_name, [(10, 12, life_fitness)])
        status, ctx = request("GET", "/api/exercises/Machine%20Test%20Raise/context")
        by = ctx.get("last_by_variant")
        check(status == 200 and by is not None, "context carries last_by_variant")
        check(set(by) == {"SportsArt", "LifeFitness", ""}, f"one bucket per machine plus the untagged one, got {sorted(by)}")
        check(ctx["last"]["date"].startswith("2026-02-15") and ctx["last"]["sets"][0]["variant"] == "LifeFitness",
              "`last` stays the newest session of any machine, older builds keep working")
        check(by["SportsArt"]["date"].startswith("2026-02-12") and pairs(by["SportsArt"]) == [(40, 12), (45, 6)],
              f"SportsArt bucket is its own latest session, got {pairs(by['SportsArt'])}")
        check(by["LifeFitness"]["date"].startswith("2026-02-15") and pairs(by["LifeFitness"]) == [(10, 12)],
              f"LifeFitness bucket is its own latest session, got {pairs(by['LifeFitness'])}")
        check(by[""]["date"].startswith("2026-02-03") and pairs(by[""]) == [(20, 10)],
              f"untagged sets form their own bucket, got {pairs(by[''])}")
        check(all(b["unit_type"] == "weight_reps" and "workout_id" in b and b["sets"][0]["variant"] in (None, "SportsArt", "LifeFitness")
                  for b in by.values()), "each bucket has the same shape as `last`")

        print("a session that mixes machines splits into one bucket per machine")
        mixed_name = "Machine Test Mixed"
        sync_day(18, mixed_name, [(23.75, 12, {}), (23.75, 10, life_fitness), (23.75, 8, life_fitness)])
        status, ctx = request("GET", "/api/exercises/Machine%20Test%20Mixed/context")
        by = ctx["last_by_variant"]
        check(set(by) == {"", "LifeFitness"}, f"mixed session -> untagged + LifeFitness buckets, got {sorted(by)}")
        check([s["set_order"] for s in by["LifeFitness"]["sets"]] == [2, 3] and [s["set_order"] for s in by[""]["sets"]] == [1],
              "each bucket holds only the sets logged on that machine")

        print("an exercise that only ever used one machine behaves as before")
        status, ctx = request("GET", "/api/exercises/Bench%20Press/context")
        check(set(ctx["last_by_variant"]) == {""} and ctx["last_by_variant"][""] == ctx["last"],
              "single untagged history -> one bucket equal to `last`")
        status, ctx = request("GET", "/api/exercises/Never%20Logged/context")
        check(ctx["last"] is None and ctx["last_by_variant"] == {}, "unknown exercise -> no buckets")

        print("\nAll checks passed.")
    finally:
        proc.terminate()
        proc.wait(timeout=5)
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"\nFAILED: {e}")
        sys.exit(1)
