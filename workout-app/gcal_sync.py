"""One-way sync of finished workouts into a dedicated Google Calendar.

Stdlib-only (matches the rest of the backend): the service-account JWT is
signed with the `openssl` binary and calls go through urllib. Disabled (every
public function is a no-op) unless GCAL_KEY_FILE and GCAL_CALENDAR_ID are set.

Syncing never touches the request path: handlers only enqueue work, one
background thread talks to Google, and failures are retried with backoff and
logged -- a Google outage can never block logging a workout.

workouts.calendar_event_id NULL means "no event yet"; the worker reconciles
those at startup and hourly (adopting events that already exist, matched by
start time, before creating new ones, so nothing is duplicated).
"""
import base64
import json
import os
import queue
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import db

KEY_FILE = os.environ.get("GCAL_KEY_FILE", "")
CALENDAR_ID = os.environ.get("GCAL_CALENDAR_ID", "")
TZ = ZoneInfo("Europe/Berlin")
SCOPE = "https://www.googleapis.com/auth/calendar.events"
API = "https://www.googleapis.com/calendar/v3/calendars/" + urllib.parse.quote(CALENDAR_ID, safe="")
RETRY_DELAYS = (30, 120, 600, 3600)
RECONCILE_EVERY_SEC = 3600
DEFAULT_MINUTES = 60

_queue = queue.Queue()
_token = {"value": None, "expires": 0.0}
_started = False


def enabled():
    return bool(KEY_FILE and CALENDAR_ID)


def _log(msg):
    print(f"[gcal] {msg}", file=sys.stderr, flush=True)


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _access_token():
    if _token["value"] and time.time() < _token["expires"] - 60:
        return _token["value"]
    with open(KEY_FILE) as fh:
        key = json.load(fh)
    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    claims = {
        "iss": key["client_email"], "scope": SCOPE, "aud": key["token_uri"],
        "iat": now, "exp": now + 3600,
    }
    signing_input = _b64(json.dumps(header).encode()) + "." + _b64(json.dumps(claims).encode())
    sig = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", _pem_path(key)],
        input=signing_input.encode(), capture_output=True, check=True,
    ).stdout
    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": signing_input + "." + _b64(sig),
    }).encode()
    with urllib.request.urlopen(urllib.request.Request(key["token_uri"], data=body), timeout=20) as resp:
        tok = json.load(resp)
    _token["value"] = tok["access_token"]
    _token["expires"] = time.time() + tok.get("expires_in", 3600)
    return _token["value"]


_pem_cache = {}


def _pem_path(key):
    # openssl needs the private key as a file; keep one 0600 copy next to the
    # JSON key's directory rather than rewriting it on every token refresh.
    path = _pem_cache.get("path")
    if path and os.path.exists(path):
        return path
    path = os.path.join(os.path.dirname(os.path.abspath(KEY_FILE)), ".calendar-key.pem")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(key["private_key"])
    _pem_cache["path"] = path
    return path


def _call(method, url, payload=None, timeout=20):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + _access_token(),
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            _token["value"] = None
        raise


def _fmt_weight(w):
    return str(int(w)) if float(w).is_integer() else f"{w:g}"


def _set_text(s):
    if s["duration_sec"] and not s["reps"]:
        text = f"{s['duration_sec']}s"
    else:
        text = f"{_fmt_weight(s['weight_kg'] or 0)}x{s['reps'] or 0}"
    if s["set_type"] == "drop":
        text += " drop"
    elif s["set_type"] == "failure":
        text += " fail"
    elif s["set_type"] == "assisted":
        text += f" assisted{s['assisted_reps'] or ''}"
    if s["side"]:
        text += f" {s['side']}"
    return text


def build_event(conn, workout_id):
    w = conn.execute("SELECT * FROM workouts WHERE id = ?", (workout_id,)).fetchone()
    if w is None:
        return None
    rows = conn.execute(
        "SELECT s.*, e.name AS exercise FROM sets s JOIN exercises e ON e.id = s.exercise_id "
        "WHERE s.workout_id = ? ORDER BY s.set_order", (workout_id,)
    ).fetchall()
    per_exercise = {}
    volume = 0.0
    for s in rows:
        per_exercise.setdefault(s["exercise"], []).append(_set_text(s))
        volume += (s["weight_kg"] or 0) * (s["reps"] or 0)
    minutes = round((w["duration_sec"] or DEFAULT_MINUTES * 60) / 60)
    lines = [f"{w['name']} - {minutes} min, {len(rows)} sets, {round(volume)} kg volume (raw kg x reps)"]
    lines += [f"{name}: {', '.join(sets)}" for name, sets in per_exercise.items()]
    start = datetime.strptime(w["started_at"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ)
    end = start + timedelta(minutes=max(minutes, 1))
    return {
        "summary": w["name"],
        "description": "\n".join(lines),
        "start": {"dateTime": start.isoformat(), "timeZone": "Europe/Berlin"},
        "end": {"dateTime": end.isoformat(), "timeZone": "Europe/Berlin"},
        "reminders": {"useDefault": False},
        "extendedProperties": {"private": {"workoutId": str(workout_id)}},
    }


def _upsert(workout_id):
    conn = db.get_conn()
    try:
        event = build_event(conn, workout_id)
        if event is None:
            return
        row = conn.execute("SELECT calendar_event_id FROM workouts WHERE id = ?", (workout_id,)).fetchone()
        event_id = row["calendar_event_id"]
        if event_id:
            try:
                _call("PUT", f"{API}/events/{event_id}", event)
                return
            except urllib.error.HTTPError as exc:
                if exc.code not in (404, 410):
                    raise
        created = _call("POST", f"{API}/events", event)
        conn.execute("UPDATE workouts SET calendar_event_id = ? WHERE id = ?", (created["id"], workout_id))
        conn.commit()
        try:
            _consume_planned(event["summary"], event["start"]["dateTime"][:10])
        except Exception as exc:
            _log(f"consume planned failed: {type(exc).__name__}: {exc}")
    finally:
        conn.close()


def _delete(event_id):
    try:
        _call("DELETE", f"{API}/events/{event_id}")
    except urllib.error.HTTPError as exc:
        if exc.code not in (404, 410):
            raise


def _local_start(date_time):
    return datetime.fromisoformat(date_time).astimezone(TZ).strftime("%Y-%m-%d %H:%M:%S")


def _reconcile():
    """Link existing calendar events to workouts without an id, then create
    events for whatever is still unlinked."""
    conn = db.get_conn()
    try:
        pending = conn.execute(
            "SELECT id, started_at FROM workouts WHERE calendar_event_id IS NULL ORDER BY started_at"
        ).fetchall()
        if not pending:
            return
        by_id, by_start = {}, {}
        token = None
        while True:
            params = {"maxResults": 2500, "singleEvents": "true", "showDeleted": "false"}
            if token:
                params["pageToken"] = token
            page = _call("GET", f"{API}/events?" + urllib.parse.urlencode(params))
            for ev in page.get("items", []):
                private = ev.get("extendedProperties", {}).get("private", {})
                if private.get("planned") == "1":
                    continue
                wid = private.get("workoutId")
                if wid:
                    by_id[int(wid)] = ev["id"]
                start = ev.get("start", {}).get("dateTime")
                if start:
                    by_start.setdefault(_local_start(start), ev["id"])
            token = page.get("nextPageToken")
            if not token:
                break
        linked = set(r[0] for r in conn.execute("SELECT calendar_event_id FROM workouts WHERE calendar_event_id IS NOT NULL"))
        adopted = 0
        for w in pending:
            event_id = by_id.get(w["id"]) or by_start.get(w["started_at"])
            if event_id and event_id not in linked:
                conn.execute("UPDATE workouts SET calendar_event_id = ? WHERE id = ?", (event_id, w["id"]))
                linked.add(event_id)
                adopted += 1
        conn.commit()
        _log(f"reconcile: adopted {adopted} existing events")
        missing = [r["id"] for r in conn.execute("SELECT id FROM workouts WHERE calendar_event_id IS NULL ORDER BY started_at")]
    finally:
        conn.close()
    for wid in missing:
        _upsert(wid)
    if missing:
        _log(f"reconcile: created {len(missing)} events")


def _run(job, attempt=0):
    kind, arg = job
    try:
        if kind == "upsert":
            _upsert(arg)
        elif kind == "delete":
            _delete(arg)
    except Exception as exc:
        if attempt < len(RETRY_DELAYS):
            delay = RETRY_DELAYS[attempt]
            _log(f"{kind} {arg} failed ({type(exc).__name__}: {exc}); retry in {delay}s")
            threading.Timer(delay, lambda: _queue.put((job, attempt + 1))).start()
        else:
            _log(f"{kind} {arg} gave up after {attempt + 1} attempts: {exc}")


def _worker():
    last_reconcile = 0.0
    while True:
        try:
            item = _queue.get(timeout=60)
        except queue.Empty:
            item = None
        if item is not None:
            job, attempt = item
            _run(job, attempt)
        if time.time() - last_reconcile >= RECONCILE_EVERY_SEC:
            last_reconcile = time.time()
            try:
                _reconcile()
            except Exception as exc:
                _log(f"reconcile failed: {type(exc).__name__}: {exc}")


def start():
    global _started
    if not enabled() or _started:
        return
    _started = True
    threading.Thread(target=_worker, name="gcal-sync", daemon=True).start()
    _log("enabled")


def upsert(workout_id):
    if enabled():
        _queue.put((("upsert", workout_id), 0))


def delete(event_id):
    if enabled() and event_id:
        _queue.put((("delete", event_id), 0))


# ---- planned sessions: events the app creates ahead of time, which ImIceTry can
# drag around in Google Calendar; the app always reads the time back from there.

_planned_cache = {"at": 0.0, "items": []}
PLANNED_MINUTES = 75
PLANNED_FILTER = "privateExtendedProperty=" + urllib.parse.quote("planned=1")


def _planned_query(time_min, time_max=None):
    q = f"{API}/events?singleEvents=true&orderBy=startTime&{PLANNED_FILTER}&timeMin={urllib.parse.quote(time_min)}"
    if time_max:
        q += "&timeMax=" + urllib.parse.quote(time_max)
    return _call("GET", q, timeout=6).get("items", [])


def _planned_item(ev):
    private = ev.get("extendedProperties", {}).get("private", {})
    return {
        "event_id": ev["id"],
        "name": private.get("name") or ev.get("summary", ""),
        "start": _local_start(ev["start"]["dateTime"]),
        "end": _local_start(ev["end"]["dateTime"]),
    }


def list_planned(max_age=30):
    """Upcoming planned sessions, newest read from Google Calendar (cached
    briefly). Raises on failure; callers decide how to degrade."""
    if time.time() - _planned_cache["at"] > max_age:
        now = datetime.now(TZ).isoformat()
        _planned_cache["items"] = [_planned_item(e) for e in _planned_query(now)]
        _planned_cache["at"] = time.time()
    return _planned_cache["items"]


def create_planned(name, start_local):
    start = datetime.strptime(start_local, "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
    end = start + timedelta(minutes=PLANNED_MINUTES)
    event = {
        "summary": f"{name} (planned)",
        "description": "Planned by the Workout App. Drag it in Google Calendar to reschedule.",
        "start": {"dateTime": start.isoformat(), "timeZone": "Europe/Berlin"},
        "end": {"dateTime": end.isoformat(), "timeZone": "Europe/Berlin"},
        "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": 30}]},
        "extendedProperties": {"private": {"planned": "1", "name": name}},
    }
    created = _call("POST", f"{API}/events", event, timeout=8)
    _planned_cache["at"] = 0.0
    return _planned_item(created)


def delete_planned(event_id):
    _delete(event_id)
    _planned_cache["at"] = 0.0


def _consume_planned(name, day):
    """A logged workout fulfils the planned block of the same name that day."""
    day_start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=TZ)
    for ev in _planned_query(day_start.isoformat(), (day_start + timedelta(days=1)).isoformat()):
        item = _planned_item(ev)
        if item["name"].lower() == name.lower():
            _delete(ev["id"])
            _planned_cache["at"] = 0.0
            return
