"""Read-only ICS feed of the training schedule, for sharing with someone else.

Served at /api/calendar/<token>.ics and disabled unless WORKOUT_ICS_TOKEN is
set. Deliberately minimal: workout name, start and duration only -- no sets,
weights or notes -- plus upcoming planned sessions.
"""
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TOKEN = os.environ.get("WORKOUT_ICS_TOKEN", "")
TZ = ZoneInfo("Europe/Berlin")
HISTORY_DAYS = 120
FMT = "%Y-%m-%d %H:%M:%S"


def _utc(local_str):
    dt = datetime.strptime(local_str[:19], FMT).replace(tzinfo=TZ)
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _esc(text):
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _event(uid, summary, start_local, end_local, description, stamp):
    return [
        "BEGIN:VEVENT", f"UID:{uid}@workout-app", f"DTSTAMP:{stamp}",
        f"DTSTART:{_utc(start_local)}", f"DTEND:{_utc(end_local)}",
        f"SUMMARY:{_esc(summary)}", f"DESCRIPTION:{_esc(description)}", "END:VEVENT",
    ]


def build(conn, planned):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    since = (datetime.now() - timedelta(days=HISTORY_DAYS)).strftime(FMT)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Workout App//EN", "CALSCALE:GREGORIAN",
             "X-WR-CALNAME:Workouts", "X-PUBLISHED-TTL:PT1H"]
    for w in conn.execute("SELECT id, name, started_at, duration_sec FROM workouts WHERE started_at >= ? ORDER BY started_at", (since,)):
        minutes = max(round((w["duration_sec"] or 3600) / 60), 1)
        start = datetime.strptime(w["started_at"], FMT)
        end = (start + timedelta(minutes=minutes)).strftime(FMT)
        lines += _event(f"workout-{w['id']}", w["name"], w["started_at"], end, f"{minutes} min", stamp)
    for p in planned:
        lines += _event(f"planned-{p['event_id']}", f"{p['name']} (planned)", p["start"], p["end"], "Planned session", stamp)
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
