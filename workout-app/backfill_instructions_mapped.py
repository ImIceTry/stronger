"""2026-10-06 (ImIceTry's ask): instructions for his own logged exercises.

Part 1: SOURCED -- his Strong-style name -> the free-exercise-db entry for the
same movement, whose text is copied verbatim (Unlicense). Mapping was checked
by name only, not by eye on every text; equipment variants are noted below.
Part 2: WRITTEN -- no dataset entry fits, so short instructions were written by
Claude (not from any dataset). Kept in this file so the origin stays visible.

Only fills rows whose instructions are NULL/empty; never overwrites.

Usage:
    .venv/bin/python backfill_instructions_mapped.py            # dry run
    .venv/bin/python backfill_instructions_mapped.py --apply
"""
import json
import sys
import urllib.request

import db

SOURCE_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"

SOURCED = {
    "Lying Leg Curl (Machine)": "Lying Leg Curls",
    "Seated Leg Curl (Machine)": "Seated Leg Curl",
    "Preacher Curl (Machine)": "Machine Preacher Curls",
    "Triceps Pushdown (Cable)": "Triceps Pushdown",
    "Triceps Extension (Machine)": "Machine Triceps Extension",
    "Calf Press on Leg Press": "Calf Press On The Leg Press Machine",
    "Torso Rotation (Machine)": "Torso Rotation",
    "Pull Up": "Pullups",
    "Lat Pulldown (Single Arm)": "One Arm Lat Pulldown",
    "Lateral Raise (Cable)": "Cable Seated Lateral Raise",
    "Incline Chest Press (Machine)": "Leverage Incline Chest Press",
    "Chest Press (Machine)": "Machine Bench Press",
    "High Row (Machine)": "Leverage High Row",
    "Skullcrusher (Barbell)": "EZ-Bar Skullcrusher",
    "Bicep Curl (Barbell)": "Barbell Curl",
    "Incline Bench Press (Barbell)": "Barbell Incline Bench Press - Medium Grip",
    "Decline Bench Press (Smith Machine)": "Smith Machine Decline Press",
    "Incline Bench Press (Smith Machine)": "Smith Machine Incline Bench Press",
    "Reverse Curl (EZ-Bar)": "EZ-Bar Curl",
    "Shoulder Press (Machine)": "Machine Shoulder (Military) Press",
    "Incline Bench Press (Dumbbell)": "Incline Dumbbell Press",
    "Leg Extension (Machine)": "Leg Extensions",
    "Seated Row (Cable)": "Seated Cable Rows",
    "Reverse Curl (Dumbbell)": "Standing Dumbbell Reverse Curl",
    "Lateral Raise (Dumbbell)": "Side Lateral Raise",
    "Seated Leg Press (Machine)": "Leg Press",
    "Seated Calf Raise (Plate Loaded)": "Seated Calf Raise",
    "Hammer Curl (Cable)": "Cable Hammer Curls - Rope Attachment",
    "Bicep Curl (Cable)": "Standing Biceps Cable Curl",
    "Crunch (Machine)": "Ab Crunch Machine",
    "Chest Fly": "Butterfly",
    "Reverse Fly (Machine)": "Reverse Machine Flyes",
}

WRITTEN = {
    "Triceps Extension (Cable)": [
        "Set a cable pulley to a high or low position with a rope or straight bar, and stand facing away from the stack (or lean forward) with your elbows pointing forward and tucked in.",
        "Start with your forearms folded so your hands are by your head or chest.",
        "Keeping your upper arms still, straighten your elbows until your arms are fully extended.",
        "Pause briefly, then slowly bend your elbows back to the start under control.",
        "Keep your shoulders and torso steady; only the forearms move.",
    ],
    "Chest Dip (Assisted)": [
        "Set the assist weight on the machine, kneel or stand on the pad, and grip the parallel handles.",
        "Lean your torso forward slightly and let your elbows flare a little to the sides.",
        "Lower yourself under control until your upper arms are about parallel to the floor, or you feel a stretch in the chest.",
        "Press back up through your palms until your arms are straight, keeping the forward lean.",
        "A higher assist weight makes it easier; lower it as you get stronger.",
    ],
    "Triceps Dip (Assisted)": [
        "Set the assist weight on the machine, kneel or stand on the pad, and grip the parallel handles.",
        "Keep your torso upright and your elbows tucked close to your body.",
        "Lower yourself under control until your upper arms are about parallel to the floor.",
        "Press back up until your arms are fully straight, without shrugging your shoulders up.",
        "A higher assist weight makes it easier; lower it as you get stronger.",
    ],
    "Dead Hang": [
        "Grab a pull-up bar with an overhand grip, hands about shoulder width apart.",
        "Step off or lift your feet so your arms are fully straight and your body hangs still.",
        "Keep a firm grip and relax your shoulders without letting them shrug up to your ears; keep your legs together and still.",
        "Hold for the planned time, then step down or lower your feet to the floor under control.",
    ],
    "Iso-Lateral Row (Machine)": [
        "Adjust the seat so the handles are within reach when your chest rests against the pad.",
        "Grip each handle and sit tall with your shoulders pulled slightly back and down.",
        "Pull the handles toward your torso, driving your elbows back, until your shoulder blades squeeze together.",
        "Pause briefly, then slowly let the handles return until your arms are straight and you feel a stretch in your back.",
        "Each arm moves independently, so keep both sides working evenly and avoid twisting your torso.",
    ],
    "Low Row (Machine)": [
        "Adjust the seat and chest pad so you can reach the low handles with your arms straight.",
        "Sit tall with your chest against the pad and your feet planted.",
        "Pull the handles toward your lower ribs, leading with your elbows and squeezing your shoulder blades together.",
        "Pause briefly, then slowly extend your arms back to the start.",
        "Do not lean back or jerk the weight; keep your torso still.",
    ],
    "Lateral Raise (Machine)": [
        "Adjust the seat so your shoulders line up with the machine's pivot, and set the pads against the outside of your upper arms or elbows.",
        "Sit tall with your back against the pad and your arms by your sides.",
        "Raise your arms out to the sides until your upper arms are about parallel to the floor.",
        "Pause briefly, then lower slowly and under control without letting the weight stack touch down.",
        "Do not shrug or swing; keep the movement slow so the side of the shoulder does the work.",
    ],
    "Shoulder Press (Plate Loaded)": [
        "Adjust the seat so the handles start at about shoulder height, then load the plates evenly on both sides.",
        "Sit with your back flat against the pad, feet planted, and grip the handles.",
        "Press the handles up until your arms are almost fully straight, without locking your elbows hard.",
        "Lower slowly until your hands are back at shoulder height.",
        "Keep your core tight and avoid arching your lower back off the pad.",
    ],
}


def main():
    apply = "--apply" in sys.argv
    with urllib.request.urlopen(SOURCE_URL, timeout=30) as resp:
        by_name = {e["name"]: e for e in json.load(resp)}

    updates = []
    for mine, theirs in SOURCED.items():
        steps = by_name[theirs]["instructions"]
        updates.append((mine, "\n".join(steps), f"sourced <- {theirs}"))
    for mine, steps in WRITTEN.items():
        updates.append((mine, "\n".join(steps), "written"))

    db.init_db()
    conn = db.get_conn()
    try:
        done = 0
        for name, text, how in updates:
            row = conn.execute(
                "SELECT id, instructions FROM exercises WHERE name = ?", (name,)
            ).fetchone()
            if row is None:
                print(f"MISSING in DB: {name}")
            elif row["instructions"]:
                print(f"skip (already has text): {name}")
            else:
                print(f"{'APPLY' if apply else 'would apply'}: {name}  [{how}]")
                if apply:
                    conn.execute(
                        "UPDATE exercises SET instructions = ? WHERE id = ?",
                        (text, row["id"]),
                    )
                done += 1
        if apply:
            conn.commit()
        print(f"\n{done} exercises {'updated' if apply else 'would be updated'}.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
