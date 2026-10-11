"""Workout App backend. Stdlib-only http.server, same pattern as
~/services/dashboard/capture_server.py -- manual route dispatch, no framework.
"""
import hmac
import json
import os
import re
import urllib.parse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import csv_mirror
import db
import gcal_sync
import ics_feed
import planner
import records
import muscle_scores
import validation

HOST = os.environ.get("WORKOUT_APP_HOST", "0.0.0.0")
PORT = int(os.environ.get("WORKOUT_APP_PORT", "8092"))
MAX_BODY = 65536
# Refreshed hourly by ~/services/grafana's own yazio-db-snapshot sidecar,
# already parsed from the Yazio nutrition export's raw JSON -- reused here
# instead of re-parsing the source export separately (see
# grafana/scripts/yazio_to_sqlite.py for that parsing logic).
YAZIO_DB_PATH = os.environ.get(
    "YAZIO_DB_PATH", os.path.expanduser("~/services/grafana/db-snapshot/yazio.db")
)

RE_PLAN_DETAIL = re.compile(r"^/api/plan/([A-Za-z0-9_-]+)$")
RE_ICS_FEED = re.compile(r"^/api/calendar/([A-Za-z0-9_-]+)\.ics$")
RE_WORKOUT_DETAIL = re.compile(r"^/api/workouts/(\d+)$")
RE_EXERCISE_LAST = re.compile(r"^/api/exercises/([^/]+)/last$")
RE_EXERCISE_RECORDS = re.compile(r"^/api/exercises/([^/]+)/records$")
RE_EXERCISE_HISTORY = re.compile(r"^/api/exercises/([^/]+)/history$")
RE_EXERCISE_STICKY_NOTE = re.compile(r"^/api/exercises/([^/]+)/sticky-note$")
RE_EXERCISE_DEFAULT_UNILATERAL = re.compile(r"^/api/exercises/([^/]+)/default-unilateral$")
RE_EXERCISE_DEFAULT_REST = re.compile(r"^/api/exercises/([^/]+)/default-rest$")
RE_EXERCISE_REP_CEILING = re.compile(r"^/api/exercises/([^/]+)/rep-ceiling$")
RE_EXERCISE_VARIANT_RATIOS = re.compile(r"^/api/exercises/([^/]+)/variant-ratios$")
RE_EXERCISE_MACHINE_SETTINGS = re.compile(r"^/api/exercises/([^/]+)/machine-settings$")
RE_EXERCISE_ABOUT = re.compile(r"^/api/exercises/([^/]+)/about$")
RE_EXERCISE_DETAILS = re.compile(r"^/api/exercises/([^/]+)/details$")
RE_EXERCISE_CONTEXT = re.compile(r"^/api/exercises/([^/]+)/context$")
RE_TEMPLATE_DETAIL = re.compile(r"^/api/templates/(\d+)$")
RE_TEMPLATE_ARCHIVE = re.compile(r"^/api/templates/(\d+)/archive$")
RE_TEMPLATE_DUPLICATE = re.compile(r"^/api/templates/(\d+)/duplicate$")
RE_TEMPLATE_EXERCISES = re.compile(r"^/api/templates/(\d+)/exercises$")
RE_TEMPLATE_SYNC_FROM_WORKOUT = re.compile(r"^/api/templates/(\d+)/sync-from-workout$")
RE_TEMPLATE_TOUCH_LOGGED = re.compile(r"^/api/templates/(\d+)/touch-logged$")
RE_TEMPLATE_FOLDER = re.compile(r"^/api/templates/(\d+)/folder$")
RE_TEMPLATE_FOLDER_DETAIL = re.compile(r"^/api/template-folders/(\d+)$")
MAX_TEMPLATE_NAME_LEN = 200
MAX_FOLDER_NAME_LEN = 100


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # journald already captures stdout/stderr

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # The Capacitor Android app serves its bundled UI from https://localhost,
        # so API calls from it are cross-origin -- allow them (single-user app,
        # no cookies/auth to leak).
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BODY:
            raise ValueError("missing or oversized body")
        raw = self.rfile.read(length)
        return json.loads(raw)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        conn = db.get_conn()
        try:
            if path == "/api/health":
                count = conn.execute("SELECT COUNT(*) AS n FROM workouts").fetchone()["n"]
                self._json(200, {"ok": True, "workouts": count})
                return

            if path == "/api/exercises":
                q = qs.get("q", [""])[0]
                self._json(200, {"exercises": db.exercise_autocomplete(conn, q)})
                return

            if path == "/api/exercises/all":
                self._json(200, {"exercises": db.list_exercises(conn)})
                return

            m = RE_ICS_FEED.match(path)
            if m:
                if not ics_feed.TOKEN or not hmac.compare_digest(m.group(1), ics_feed.TOKEN):
                    self._json(404, {"error": "not found"})
                    return
                try:
                    planned = gcal_sync.list_planned() if gcal_sync.enabled() else []
                except Exception:
                    planned = []
                body = ics_feed.build(conn, planned).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/calendar; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if path == "/api/plan":
                planned, error = [], False
                if gcal_sync.enabled():
                    try:
                        planned = gcal_sync.list_planned()
                    except Exception:
                        error = True
                self._json(200, {"suggestion": planner.suggest(conn), "planned": planned,
                                 "calendar_enabled": gcal_sync.enabled(), "planned_error": error})
                return

            if path == "/api/muscle-scores":
                self._json(200, {"muscles": muscle_scores.muscle_group_scores(conn)})
                return

            m = RE_EXERCISE_LAST.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                result = db.last_performance(conn, name)
                if result is None:
                    self._json(404, {"error": "no history for exercise"})
                else:
                    self._json(200, result)
                return

            m = RE_EXERCISE_CONTEXT.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                self._json(200, db.exercise_context(conn, name))
                return

            m = RE_EXERCISE_RECORDS.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                result = records.exercise_records(conn, name)
                if result is None:
                    self._json(404, {"error": "no history for exercise"})
                else:
                    self._json(200, result)
                return

            m = RE_EXERCISE_HISTORY.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                sessions = db.exercise_history(conn, name)
                if sessions is None:
                    self._json(404, {"error": "no history for exercise"})
                    return
                records.flag_session_prs(sessions)
                records.flag_duration_prs(sessions)
                self._json(200, {"sessions": sessions})
                return

            m = RE_EXERCISE_STICKY_NOTE.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                self._json(200, {"note": db.get_sticky_note(conn, name)})
                return

            m = RE_EXERCISE_DEFAULT_UNILATERAL.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                self._json(200, {"default_unilateral": db.get_exercise_default_unilateral(conn, name)})
                return

            m = RE_EXERCISE_DEFAULT_REST.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                self._json(200, {"default_rest_sec": db.get_exercise_default_rest(conn, name)})
                return

            m = RE_EXERCISE_REP_CEILING.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                self._json(200, {"rep_ceiling": db.get_exercise_rep_ceiling(conn, name)})
                return

            m = RE_EXERCISE_VARIANT_RATIOS.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                self._json(200, {"ratios": db.get_all_variant_ratios(conn, name)})
                return

            m = RE_EXERCISE_MACHINE_SETTINGS.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                self._json(200, {"machine_settings": db.get_machine_settings(conn, name)})
                return

            m = RE_EXERCISE_ABOUT.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                result = db.exercise_about(conn, name)
                if result is None:
                    self._json(404, {"error": "exercise not found"})
                else:
                    self._json(200, result)
                return

            if path == "/api/bodyweight":
                limit_raw = qs.get("limit", [None])[0]
                limit = int(limit_raw) if limit_raw else None
                self._json(200, {"entries": db.list_bodyweight(conn, limit)})
                return

            if path == "/api/workouts":
                date_from = qs.get("from", [None])[0]
                date_to = qs.get("to", [None])[0]
                include_pr = qs.get("include_pr", ["0"])[0] == "1"
                include_summary = qs.get("include_summary", ["0"])[0] == "1"
                limit_raw = qs.get("limit", [None])[0]
                limit = int(limit_raw) if limit_raw else None
                workouts = db.list_workouts(conn, date_from, date_to, limit)
                if include_pr:  # only ever paired with a limit in practice -- expensive to compute unbounded over 246+ rows
                    pr_counts = records.workout_pr_counts(conn, [w["id"] for w in workouts])
                    for w in workouts:
                        w["pr_count"] = pr_counts[w["id"]]
                if include_summary:  # same gating rationale -- the Phase 4.2 per-exercise "Best set" breakdown
                    for w in workouts:
                        w["exercises"] = records.exercise_summary_for_workout(conn, w["id"])
                self._json(200, {"workouts": workouts})
                return

            if path == "/api/templates":
                include_archived = qs.get("archived", ["0"])[0] == "1"
                self._json(200, {"templates": db.list_templates(conn, include_archived)})
                return

            if path == "/api/template-folders":
                self._json(200, {"folders": db.list_folders(conn)})
                return

            m = RE_TEMPLATE_EXERCISES.match(path)
            if m:
                template = db.get_template(conn, int(m.group(1)))
                if template is None:
                    self._json(404, {"error": "template not found"})
                    return
                self._json(200, {"exercises": db.get_template_exercises(conn, int(m.group(1)))})
                return

            m = RE_WORKOUT_DETAIL.match(path)
            if m:
                detail = db.get_workout_detail(conn, int(m.group(1)))
                if detail is None:
                    self._json(404, {"error": "workout not found"})
                else:
                    detail["exercise_summary"] = records.exercise_summary_for_workout(conn, int(m.group(1)))
                    self._json(200, detail)
                return

            self._json(404, {"error": "not found"})
        except Exception as exc:
            self._json(500, {"error": f"{type(exc).__name__}: {exc}"})
        finally:
            conn.close()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        conn = db.get_conn()
        try:
            if path == "/api/bodyweight":
                data = self._read_json_body()
                date = data.get("date")
                weight_kg = data.get("weight_kg")
                if not isinstance(date, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                    raise ValueError("date must be 'YYYY-MM-DD'")
                if not isinstance(weight_kg, (int, float)) or not (20 <= weight_kg <= 400):
                    raise ValueError("weight_kg must be a number between 20 and 400")
                db.log_bodyweight(conn, date, weight_kg, "manual")
                self._json(200, {"entries": db.list_bodyweight(conn, 30)})
                return

            if path == "/api/bodyweight/import-yazio":
                try:
                    imported = db.import_yazio_bodyweight(conn, YAZIO_DB_PATH)
                except FileNotFoundError as exc:
                    self._json(404, {"error": str(exc)})
                    return
                self._json(200, {"imported": imported, "entries": db.list_bodyweight(conn, 30)})
                return

            if path == "/api/plan":
                if not gcal_sync.enabled():
                    raise ValueError("calendar sync is not configured")
                data = self._read_json_body()
                name = _clean_template_name(data.get("name"))
                start = str(data.get("start") or "")
                datetime.strptime(start, "%Y-%m-%d %H:%M")
                self._json(200, gcal_sync.create_planned(name, start))
                return

            if path == "/api/workouts/sync":
                data = self._read_json_body()
                validation.validate_sync_payload(data)
                name = str(data.get("name") or "Workout").strip()
                started_at = data["started_at"]
                finished_at = data.get("finished_at") or started_at
                duration_sec = data.get("duration_sec")
                workout_notes = str(data.get("workout_notes") or "")
                sets = data["sets"]
                workout_id, created = db.sync_workout(
                    conn, name, started_at, finished_at, duration_sec, workout_notes, sets
                )
                if not created:  # replay of an already-synced workout, see sync_workout
                    self._json(200, {"id": workout_id, "csv_path": None, "duplicate": True})
                    return
                all_rows = db.all_workouts_with_sets(conn)
                csv_path = csv_mirror.write_full_export(all_rows)
                gcal_sync.upsert(workout_id)
                self._json(200, {"id": workout_id, "csv_path": csv_path})
                return

            if path == "/api/templates":
                data = self._read_json_body()
                name = _clean_template_name(data.get("name"))
                source_workout_id = data.get("source_workout_id")
                if not isinstance(source_workout_id, int):
                    raise ValueError("source_workout_id is required")
                if db.get_workout_detail(conn, source_workout_id) is None:
                    self._json(404, {"error": "source workout not found"})
                    return
                template = db.materialize_template(conn, name, source_workout_id)
                self._json(200, template)
                return

            if path == "/api/templates/scratch":
                data = self._read_json_body()
                name = _clean_template_name(data.get("name"))
                exercise_names = data.get("exercise_names")
                if not isinstance(exercise_names, list) or not exercise_names:
                    raise ValueError("exercise_names must be a non-empty list")
                cleaned = []
                for n in exercise_names:
                    n = str(n or "").strip()
                    if not n:
                        raise ValueError("exercise_names entries must be non-empty strings")
                    cleaned.append(n)
                template = db.create_scratch_template(conn, name, cleaned)
                self._json(200, template)
                return

            if path == "/api/template-folders":
                data = self._read_json_body()
                name = str(data.get("name") or "").strip()
                if not name:
                    raise ValueError("name is required")
                if len(name) > MAX_FOLDER_NAME_LEN:
                    raise ValueError(f"name exceeds {MAX_FOLDER_NAME_LEN} characters")
                folder = db.create_folder(conn, name)
                self._json(200, folder)
                return

            m = RE_TEMPLATE_DUPLICATE.match(path)
            if m:
                template = db.duplicate_template(conn, int(m.group(1)))
                if template is None:
                    self._json(404, {"error": "template not found"})
                else:
                    self._json(200, template)
                return

            m = RE_TEMPLATE_ARCHIVE.match(path)
            if m:
                data = self._read_json_body()
                ok = db.set_template_archived(conn, int(m.group(1)), bool(data.get("archived")))
                if not ok:
                    self._json(404, {"error": "template not found"})
                else:
                    self._json(200, db.get_template(conn, int(m.group(1))))
                return

            self._json(404, {"error": "not found"})
        except Exception as exc:
            self._json(400, {"error": f"{type(exc).__name__}: {exc}"})
        finally:
            conn.close()

    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path
        conn = db.get_conn()
        try:
            m = RE_EXERCISE_STICKY_NOTE.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                data = self._read_json_body()
                db.set_sticky_note(conn, name, data.get("note"))
                self._json(200, {"note": db.get_sticky_note(conn, name)})
                return

            m = RE_EXERCISE_DEFAULT_UNILATERAL.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                data = self._read_json_body()
                value = data.get("default_unilateral")
                if not isinstance(value, bool):
                    raise ValueError("default_unilateral must be a boolean")
                db.set_exercise_default_unilateral(conn, name, value)
                self._json(200, {"default_unilateral": db.get_exercise_default_unilateral(conn, name)})
                return

            m = RE_EXERCISE_DEFAULT_REST.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                data = self._read_json_body()
                value = data.get("default_rest_sec")
                if value is not None and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
                    raise ValueError("default_rest_sec must be a non-negative integer or null")
                db.set_exercise_default_rest(conn, name, value)
                self._json(200, {"default_rest_sec": db.get_exercise_default_rest(conn, name)})
                return

            m = RE_EXERCISE_REP_CEILING.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                data = self._read_json_body()
                value = data.get("rep_ceiling")
                if value is not None and (not isinstance(value, int) or isinstance(value, bool) or value <= 0):
                    raise ValueError("rep_ceiling must be a positive integer or null")
                db.set_exercise_rep_ceiling(conn, name, value)
                self._json(200, {"rep_ceiling": db.get_exercise_rep_ceiling(conn, name)})
                return

            m = RE_EXERCISE_VARIANT_RATIOS.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                data = self._read_json_body()
                variant = data.get("variant")
                if not isinstance(variant, str) or not variant.strip():
                    raise ValueError("variant is required and must be a non-empty string")
                ratio = data.get("ratio")
                if ratio is not None:
                    if not isinstance(ratio, (int, float)) or isinstance(ratio, bool) or not (0.01 <= ratio <= 100):
                        raise ValueError("ratio must be a number between 0.01 and 100, or null")
                db.set_variant_ratio(conn, name, variant.strip(), ratio)
                self._json(200, {"ratios": db.get_all_variant_ratios(conn, name)})
                return

            m = RE_EXERCISE_MACHINE_SETTINGS.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                data = self._read_json_body()
                variant = data.get("variant") or ""
                if not isinstance(variant, str):
                    raise ValueError("variant must be a string")
                raw = data.get("settings")
                if not isinstance(raw, list) or len(raw) > 20:
                    raise ValueError("settings must be a list of at most 20 [name, value] pairs")
                settings = []
                for item in raw:
                    if not isinstance(item, (list, tuple)) or len(item) != 2 or not all(isinstance(x, str) for x in item):
                        raise ValueError("each setting must be a [name, value] pair of strings")
                    sname, svalue = item[0].strip(), item[1].strip()
                    if not sname:
                        continue
                    if len(sname) > 40 or len(svalue) > 40:
                        raise ValueError("setting name and value must be at most 40 characters")
                    settings.append([sname, svalue])
                db.set_machine_settings(conn, name, variant.strip(), settings)
                self._json(200, {"machine_settings": db.get_machine_settings(conn, name)})
                return

            m = RE_EXERCISE_DETAILS.match(path)
            if m:
                name = urllib.parse.unquote(m.group(1))
                data = self._read_json_body()
                unit_type = data.get("unit_type", "weight_reps")
                if unit_type not in ("weight_reps", "reps_only", "time"):
                    raise ValueError("unit_type must be weight_reps, reps_only, or time")
                db.set_exercise_details(
                    conn,
                    name,
                    str(data.get("category") or "").strip(),
                    str(data.get("equipment") or "").strip(),
                    str(data.get("primary_muscles") or "").strip(),
                    unit_type,
                    str(data.get("instructions") or "").strip(),
                )
                self._json(200, db.exercise_about(conn, name))
                return

            m = RE_TEMPLATE_DETAIL.match(path)
            if m:
                data = self._read_json_body()
                name = _clean_template_name(data.get("name"))
                ok = db.rename_template(conn, int(m.group(1)), name)
                if not ok:
                    self._json(404, {"error": "template not found"})
                else:
                    self._json(200, db.get_template(conn, int(m.group(1))))
                return

            m = RE_TEMPLATE_FOLDER.match(path)
            if m:
                data = self._read_json_body()
                folder_id = data.get("folder_id")
                if folder_id is not None and not isinstance(folder_id, int):
                    raise ValueError("folder_id must be an integer or null")
                ok = db.set_template_folder(conn, int(m.group(1)), folder_id)
                if not ok:
                    self._json(404, {"error": "template not found"})
                else:
                    self._json(200, db.get_template(conn, int(m.group(1))))
                return

            m = RE_TEMPLATE_SYNC_FROM_WORKOUT.match(path)
            if m:
                data = self._read_json_body()
                workout_id = data.get("workout_id")
                if not isinstance(workout_id, int):
                    raise ValueError("workout_id is required")
                if db.get_workout_detail(conn, workout_id) is None:
                    self._json(404, {"error": "workout not found"})
                    return
                template = db.sync_template_from_workout(conn, int(m.group(1)), workout_id)
                if template is None:
                    self._json(404, {"error": "template not found"})
                else:
                    self._json(200, template)
                return

            m = RE_TEMPLATE_TOUCH_LOGGED.match(path)
            if m:
                # "Keep as is" side of the Finish dialog (2026-09-22, ImIceTry's
                # ask) -- bumps last_logged_at without touching source_workout_id
                # or updated_at, see touch_template_logged's own docstring.
                data = self._read_json_body()
                workout_id = data.get("workout_id")
                if not isinstance(workout_id, int):
                    raise ValueError("workout_id is required")
                if db.get_workout_detail(conn, workout_id) is None:
                    self._json(404, {"error": "workout not found"})
                    return
                template = db.touch_template_logged(conn, int(m.group(1)))
                if template is None:
                    self._json(404, {"error": "template not found"})
                else:
                    self._json(200, template)
                return

            m = RE_WORKOUT_DETAIL.match(path)
            if not m:
                self._json(404, {"error": "not found"})
                return
            data = self._read_json_body()
            validation.validate_sync_payload(data)
            workout_id = int(m.group(1))
            name = str(data.get("name") or "Workout").strip()
            workout_notes = data.get("workout_notes")
            workout_notes = str(workout_notes) if workout_notes is not None else None
            ok = db.update_workout(conn, workout_id, name, data["sets"], workout_notes)
            if not ok:
                self._json(404, {"error": "workout not found"})
                return
            all_rows = db.all_workouts_with_sets(conn)
            csv_path = csv_mirror.write_full_export(all_rows)
            gcal_sync.upsert(workout_id)
            self._json(200, {"id": workout_id, "csv_path": csv_path})
        except Exception as exc:
            self._json(400, {"error": f"{type(exc).__name__}: {exc}"})
        finally:
            conn.close()

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        conn = db.get_conn()
        try:
            m = RE_PLAN_DETAIL.match(path)
            if m:
                if not gcal_sync.enabled():
                    raise ValueError("calendar sync is not configured")
                gcal_sync.delete_planned(m.group(1))
                self._json(200, {"ok": True})
                return

            m = RE_WORKOUT_DETAIL.match(path)
            if m:
                workout_id = int(m.group(1))
                row = conn.execute("SELECT calendar_event_id FROM workouts WHERE id = ?", (workout_id,)).fetchone()
                ok = db.delete_workout(conn, workout_id)
                if not ok:
                    self._json(404, {"error": "workout not found"})
                else:
                    gcal_sync.delete(row["calendar_event_id"] if row else None)
                    self._json(200, {"ok": True})
                return

            m = RE_TEMPLATE_DETAIL.match(path)
            if m:
                ok = db.soft_delete_template(conn, int(m.group(1)))
                if not ok:
                    self._json(404, {"error": "template not found"})
                else:
                    self._json(200, {"ok": True})
                return

            m = RE_TEMPLATE_FOLDER_DETAIL.match(path)
            if m:
                ok = db.delete_folder(conn, int(m.group(1)))
                if not ok:
                    self._json(404, {"error": "folder not found"})
                else:
                    self._json(200, {"ok": True})
                return

            self._json(404, {"error": "not found"})
        except Exception as exc:
            self._json(400, {"error": f"{type(exc).__name__}: {exc}"})
        finally:
            conn.close()


def _clean_template_name(name):
    name = str(name or "").strip()
    if not name:
        raise ValueError("name is required")
    if len(name) > MAX_TEMPLATE_NAME_LEN:
        raise ValueError(f"name exceeds {MAX_TEMPLATE_NAME_LEN} characters")
    return name


def main():
    db.init_db()
    gcal_sync.start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
