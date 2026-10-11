"""Input validation for the sync/update payload. Raises ValueError with a
specific message on the first problem found -- server.py's existing except
Exception handler already turns that into a 400 with the message, so this
just needs to be precise, not build its own response format."""
import re

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")

MAX_WEIGHT_KG = 500
MAX_REPS = 200

HANDLES = ("Straight bar", "EZ bar", "V-bar", "Rope", "Single D-handle", "Wide lat bar", "Close-grip triangle", "Cuffs")
GRIPS = ("Overhand", "Underhand", "Neutral")


def validate_date_string(value, field_name):
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise ValueError(f"{field_name} must be 'YYYY-MM-DD HH:MM:SS', got: {value!r}")


def validate_set(s, index):
    exercise_name = s.get("exercise_name")
    if not isinstance(exercise_name, str) or not exercise_name.strip():
        raise ValueError(f"sets[{index}].exercise_name is required")

    weight = s.get("weight_kg")
    if weight is not None:
        if not isinstance(weight, (int, float)) or weight < 0:
            raise ValueError(f"sets[{index}].weight_kg must be a non-negative number, got: {weight!r}")
        if weight > MAX_WEIGHT_KG:
            raise ValueError(f"sets[{index}].weight_kg ({weight}) exceeds the sanity cap of {MAX_WEIGHT_KG}kg")

    reps = s.get("reps")
    if reps is not None:
        if not isinstance(reps, int) or reps < 0:
            raise ValueError(f"sets[{index}].reps must be a non-negative integer, got: {reps!r}")
        if reps > MAX_REPS:
            raise ValueError(f"sets[{index}].reps ({reps}) exceeds the sanity cap of {MAX_REPS}")

    rpe = s.get("rpe")
    if rpe is not None:
        if not isinstance(rpe, (int, float)) or not (0 <= rpe <= 10):
            raise ValueError(f"sets[{index}].rpe must be between 0 and 10, got: {rpe!r}")

    set_type = s.get("set_type", "normal")
    # "failure" stays a valid (but no longer creatable) value -- 2 real
    # historical sets still carry it, and update_workout replaces a whole
    # workout's sets wholesale on every edit, so re-syncing an untouched old
    # workout must still round-trip its own recorded value without erroring.
    # "assisted" replaces it going forward (2026-09-18, ImIceTry's ask):
    # Failure never showed in History and duplicated what RPE 10 already
    # means, so it's being retired as a creatable option in favor of a
    # genuinely different concept (assisted_reps below).
    if set_type not in ("normal", "drop", "failure", "warmup", "assisted"):
        raise ValueError(f"sets[{index}].set_type must be normal/drop/warmup/assisted, got: {set_type!r}")

    assisted_reps = s.get("assisted_reps")
    if assisted_reps is not None:
        if not isinstance(assisted_reps, int) or isinstance(assisted_reps, bool) or assisted_reps < 0:
            raise ValueError(f"sets[{index}].assisted_reps must be a non-negative integer or null, got: {assisted_reps!r}")
        if assisted_reps > MAX_REPS:
            raise ValueError(f"sets[{index}].assisted_reps ({assisted_reps}) exceeds the sanity cap of {MAX_REPS}")

    for field, allowed in (("handle", HANDLES), ("grip", GRIPS)):
        value = s.get(field)
        if value is not None and value not in allowed:
            raise ValueError(f"sets[{index}].{field} must be one of {', '.join(allowed)} or null, got: {value!r}")

    unilateral = s.get("unilateral", False)
    if not isinstance(unilateral, bool):
        raise ValueError(f"sets[{index}].unilateral must be a boolean, got: {unilateral!r}")

    variant = s.get("variant")
    if variant is not None and not isinstance(variant, str):
        raise ValueError(f"sets[{index}].variant must be a string or null, got: {variant!r}")

    side = s.get("side")
    if side is not None and side not in ("left", "right"):
        raise ValueError(f"sets[{index}].side must be 'left', 'right', or null, got: {side!r}")

    weight_ratio = s.get("weight_ratio", 1.0)
    if weight_ratio is not None:
        if not isinstance(weight_ratio, (int, float)) or isinstance(weight_ratio, bool) or not (0.01 <= weight_ratio <= 100):
            raise ValueError(f"sets[{index}].weight_ratio must be a number between 0.01 and 100, got: {weight_ratio!r}")


def validate_sync_payload(data):
    if not data.get("sets"):
        raise ValueError("sets required (at least one)")
    validate_date_string(data["started_at"], "started_at")
    if data.get("finished_at"):
        validate_date_string(data["finished_at"], "finished_at")
    for i, s in enumerate(data["sets"]):
        validate_set(s, i)
