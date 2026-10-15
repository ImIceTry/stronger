// ---------- workout-screen feature toggles + radial menu choice ----------
// Everything optional on the workout screen is listed here once. Every
// feature defaults to ON, so a fresh install behaves exactly like before;
// turning one off only hides/disables it, never deletes logged data.
// Core behaviour (logging, editing and deleting sets, adding/removing
// exercises, finishing, persistence) is deliberately not in this list.

const FEATURE_GROUPS = [
  { id: "sets", label: "Set rows" },
  { id: "timers", label: "Timers" },
  { id: "exercise", label: "Exercise card" },
  { id: "workout", label: "Whole workout" },
  { id: "feedback", label: "Feedback & alerts" },
];

const FEATURE_REGISTRY = [
  { id: "previousColumn", group: "sets", label: "Previous column", desc: "Last workout's numbers next to each set; tap to copy them" },
  { id: "goalLine", group: "sets", label: "Goal line", desc: "Suggested target shown under the previous numbers", requires: "previousColumn" },
  { id: "prefill", group: "sets", label: "Pre-filled values", desc: "Grey suggestions from last time in the weight and reps boxes" },
  { id: "weightHint", group: "sets", label: "Weight hint", desc: "Suggestion badge above the numpad while entering weight" },
  { id: "rpe", group: "sets", label: "RPE", desc: "Rate of perceived exertion step and badges" },
  { id: "setWarmup", group: "sets", label: "Warm-up sets", desc: "Tag a set as a warm-up" },
  { id: "setDrop", group: "sets", label: "Drop sets", desc: "Tag a set as a drop set and add its follow-up row" },
  { id: "setAssisted", group: "sets", label: "Assisted sets", desc: "Tag a set as assisted, with the assisted rep count" },
  { id: "unilateral", group: "sets", label: "Unilateral sets", desc: "One-sided flag per set and 'always unilateral' per exercise" },
  { id: "startSide", group: "sets", label: "Starting side", desc: "Which side to start with on one-sided exercises", requires: "unilateral" },
  { id: "fieldModeToggle", group: "sets", label: "Reps / time switch", desc: "Tap the REPS header to switch an exercise to timed sets" },

  { id: "restTimer", group: "timers", label: "Rest timer", desc: "Rest bars between sets, automatic countdown after each set" },
  { id: "manualTimer", group: "timers", label: "Stopwatch / timer button", desc: "Standalone timer in the top bar" },
  { id: "elapsedTime", group: "timers", label: "Workout duration", desc: "Running clock in the top bar and mini bar" },

  { id: "exerciseNotes", group: "exercise", label: "Exercise notes", desc: "Note for one exercise in this workout" },
  { id: "stickyNotes", group: "exercise", label: "Sticky notes", desc: "Notes that stay on an exercise across workouts" },
  { id: "supersets", group: "exercise", label: "Supersets", desc: "Group exercises into supersets" },
  { id: "machineVariant", group: "exercise", label: "Machine / variant", desc: "Machine or variant chip, with its weight factor" },
  { id: "machineSettings", group: "exercise", label: "Machine settings", desc: "Seat height, pad position and similar settings" },
  { id: "handleGrip", group: "exercise", label: "Cable handle / grip", desc: "Handle and grip chip on cable exercises" },
  { id: "replaceExercise", group: "exercise", label: "Replace exercise", desc: "Swap an exercise for another one mid-workout" },
  { id: "reorder", group: "exercise", label: "Reorder exercises", desc: "Long-press an exercise bar or use the workout menu" },
  { id: "exerciseLink", group: "exercise", label: "Exercise name opens details", desc: "Tapping the exercise name opens its history and charts" },

  { id: "workoutNotes", group: "workout", label: "Workout notes", desc: "One note for the whole workout" },
  { id: "radialGesture", group: "workout", label: "Radial menu swipe", desc: "Swipe right on an exercise card to open the quick-action circle" },

  { id: "prToast", group: "feedback", label: "PR celebration", desc: "Toast when a set beats your previous best" },
  { id: "anomalyHint", group: "feedback", label: "Low-weight warning", desc: "Asks about a set far below your usual weight" },
  { id: "finishSummary", group: "feedback", label: "Finish summary", desc: "Review screen with a comparison to last time before saving" },
  { id: "workoutNotification", group: "feedback", label: "Workout notification", desc: "Ongoing notification with rest countdown and next set (app only)" },
];

// Canonical order of the radial circle; `feature` is the toggle that must be
// on for the action to exist at all (null = core, always available).
const RADIAL_ACTION_META = [
  { key: "note", label: "Exercise note", feature: "exerciseNotes" },
  { key: "sticky", label: "Sticky note", feature: "stickyNotes" },
  { key: "unilateral", label: "Always unilateral", feature: "unilateral" },
  { key: "start-side", label: "Starting side", feature: "startSide" },
  { key: "rest", label: "Rest timer", feature: "restTimer" },
  { key: "variant", label: "Machine / variant", feature: "machineVariant" },
  { key: "machine-settings", label: "Machine settings", feature: "machineSettings" },
  { key: "replace", label: "Replace", feature: "replaceExercise" },
  { key: "superset", label: "Superset", feature: "supersets" },
  { key: "remove", label: "Remove", feature: null },
];

const FEATURES_OFF_KEY = "workoutFeaturesOff";
const RADIAL_KEYS_KEY = "radialMenuKeys";
const FEATURE_BY_ID = Object.fromEntries(FEATURE_REGISTRY.map((f) => [f.id, f]));

function readStoredList(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    return Array.isArray(raw) ? raw : null;
  } catch (err) {
    return null;
  }
}

function featureSwitchedOff(id) {
  const off = readStoredList(FEATURES_OFF_KEY);
  return !!off && off.includes(id);
}

// A feature is on when its own switch is on AND the feature it depends on is
// on -- e.g. the goal line lives inside the previous column, so it can't
// outlive it. Unknown ids count as on so a typo can never silently hide UI.
function featureEnabled(id) {
  const def = FEATURE_BY_ID[id];
  if (!def) return true;
  if (featureSwitchedOff(id)) return false;
  return def.requires ? featureEnabled(def.requires) : true;
}

function setFeatureEnabled(id, on) {
  if (!FEATURE_BY_ID[id]) return;
  const off = new Set(readStoredList(FEATURES_OFF_KEY) || []);
  if (on) off.delete(id); else off.add(id);
  localStorage.setItem(FEATURES_OFF_KEY, JSON.stringify([...off]));
  applyFeatureVisibility();
  stopDisabledBackgroundWork();
}

// Live things that must not outlive their switch (a countdown already running,
// the ongoing notification already posted).
function stopDisabledBackgroundWork() {
  if (!featureEnabled("restTimer") && typeof restTimerHandle !== "undefined" && restTimerHandle != null) dropRestTimers();
  if (!featureEnabled("workoutNotification") && typeof stopWorkoutForegroundNotification === "function") stopWorkoutForegroundNotification();
}

function resetFeatures() {
  localStorage.removeItem(FEATURES_OFF_KEY);
  localStorage.removeItem(RADIAL_KEYS_KEY);
  applyFeatureVisibility();
  stopDisabledBackgroundWork();
}

// Keys the user wants in the circle (default: all of them), kept in canonical
// order. The feature filter is applied separately in radialActionsFor so a
// choice survives a feature being switched off and on again.
function radialSelection() {
  const stored = readStoredList(RADIAL_KEYS_KEY);
  const chosen = stored ? new Set(stored) : null;
  return RADIAL_ACTION_META.map((m) => m.key).filter((k) => !chosen || chosen.has(k));
}

function setRadialKeyChosen(key, on) {
  const next = new Set(radialSelection());
  if (on) next.add(key); else next.delete(key);
  localStorage.setItem(RADIAL_KEYS_KEY, JSON.stringify(RADIAL_ACTION_META.map((m) => m.key).filter((k) => next.has(k))));
}

function radialKeyAvailable(key) {
  const meta = RADIAL_ACTION_META.find((m) => m.key === key);
  return !!meta && (meta.feature == null || featureEnabled(meta.feature));
}

// Superset data stays on the workout while the feature is off; it just stops
// grouping, joining cards or sharing rest timers.
function activeSupersetGroups() {
  return featureEnabled("supersets") && activeWorkout ? (activeWorkout.supersets || {}) : {};
}

// The set-number button opens a tag picker; with every tag type off there is
// nothing to pick, so the button goes inert.
function setTypeOptionsAvailable() {
  return ["setWarmup", "setDrop", "setAssisted", "unilateral"].some(featureEnabled);
}

// Static bits of the workout screen that a feature switch just shows/hides.
function applyFeatureVisibility() {
  const set = (id, show) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", !show);
  };
  set("btn-manual-timer", featureEnabled("manualTimer"));
  set("active-elapsed", featureEnabled("elapsedTime"));
  set("active-elapsed-sub", featureEnabled("elapsedTime"));
  set("mini-bar-elapsed", featureEnabled("elapsedTime"));
  set("active-workout-menu-btn", featureEnabled("workoutNotes") || featureEnabled("reorder"));
  if (!featureEnabled("manualTimer") && typeof stopManualTimer === "function" && typeof manualTimerHandle !== "undefined" && manualTimerHandle != null) {
    stopManualTimer(false);
  }
}

// ---------- settings sub-screen ----------

function openWorkoutFeaturesScreen() {
  showScreenRaw("screen-workout-features");
  pushNavLayer(() => showScreenRaw("screen-settings"));
  renderWorkoutFeaturesScreen();
}

function renderWorkoutFeaturesScreen() {
  const body = document.getElementById("workout-features-body");
  const toggleRow = (attr, id, label, desc, checked, disabled) => `
    <div class="settings-row${disabled ? " settings-row-disabled" : ""}">
      <div class="settings-row-text">
        <span>${label}</span>
        <span class="settings-row-hint">${desc}</span>
      </div>
      <label class="toggle-switch"><input type="checkbox" ${attr}="${id}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}><span class="toggle-track"></span></label>
    </div>`;
  const groups = FEATURE_GROUPS.map((g) => {
    const rows = FEATURE_REGISTRY.filter((f) => f.group === g.id).map((f) => {
      const parentOff = f.requires && !featureEnabled(f.requires);
      const hint = parentOff ? `Needs "${FEATURE_BY_ID[f.requires].label}"` : f.desc;
      return toggleRow("data-feature", f.id, f.label, hint, featureEnabled(f.id), parentOff);
    }).join("");
    return `<div class="settings-section-title">${g.label}</div>${rows}`;
  }).join("");
  const selected = new Set(radialSelection());
  const radialRows = RADIAL_ACTION_META.map((m) => {
    const available = radialKeyAvailable(m.key);
    const hint = available ? "" : "Feature is turned off";
    return toggleRow("data-radial-key", m.key, m.label, hint, selected.has(m.key), !available);
  }).join("");
  body.innerHTML = `
    ${groups}
    <div class="settings-section-title">Radial quick menu</div>
    <div class="meta settings-radial-intro">Choose what appears in the circle when you swipe right on an exercise.</div>
    ${radialRows}
    <div class="settings-row settings-row-clickable" id="workout-features-reset">
      <div class="settings-row-text"><span>Reset to defaults</span><span class="settings-row-hint">Turns every feature back on and restores the full radial menu</span></div>
    </div>`;
}

document.getElementById("settings-workout-features-row").addEventListener("click", openWorkoutFeaturesScreen);
document.getElementById("workout-features-back").addEventListener("click", () => closeTopNavLayer());
document.getElementById("workout-features-body").addEventListener("change", (e) => {
  const input = e.target;
  if (input.dataset.feature) {
    setFeatureEnabled(input.dataset.feature, input.checked);
    renderWorkoutFeaturesScreen();
  } else if (input.dataset.radialKey) {
    setRadialKeyChosen(input.dataset.radialKey, input.checked);
  }
});
document.getElementById("workout-features-body").addEventListener("click", (e) => {
  if (e.target.closest("#workout-features-reset")) {
    resetFeatures();
    renderWorkoutFeaturesScreen();
  }
});

applyFeatureVisibility();
