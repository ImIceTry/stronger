// ---------- workout-screen feature toggles + radial menu choice ----------
// Everything optional on the workout screen is listed here once. The original
// features default to ON; new ones are added with `defaultOff: true`, so each
// person opts in (AGENTS.md). Turning one off only hides/disables it, never
// deletes logged data.
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
  { id: "weightHint", group: "sets", label: "Weight hint", desc: "Suggestion badge above the numpad while entering weight", where: "Shows while you type a weight on the numpad." },
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
  { id: "replaceExercise", group: "exercise", label: "Replace exercise", desc: "Swap an exercise for another one mid-workout", where: "The \u22ef menu on an exercise, then Replace exercise." },
  { id: "reorder", group: "exercise", label: "Reorder exercises", desc: "Long-press an exercise bar or use the workout menu", where: "Long-press an exercise name, or use the \u22ef menu next to the workout name." },
  { id: "exerciseLink", group: "exercise", label: "Exercise name opens details", desc: "Tapping the exercise name opens its history and charts" },

  { id: "workoutNotes", group: "workout", label: "Workout notes", desc: "One note for the whole workout", where: "The \u22ef menu next to the workout name." },
  { id: "radialGesture", group: "workout", label: "Radial menu swipe", desc: "Swipe right on an exercise card to open the quick-action circle", where: "Swipe right on any exercise card." },

  { id: "prToast", group: "feedback", label: "PR celebration", desc: "Toast when a set beats your previous best", where: "Pops up right after you log a set that beats your best." },
  { id: "anomalyHint", group: "feedback", label: "Low-weight warning", desc: "Asks about a set far below your usual weight", where: "Appears right after you log a weight far below your usual." },
  { id: "finishSummary", group: "feedback", label: "Finish summary", desc: "Review screen with a comparison to last time before saving", where: "Appears after you tap Finish, before the workout is saved." },
  { id: "workoutNotification", group: "feedback", label: "Workout notification", desc: "Ongoing notification with rest countdown and next set (app only)", where: "In your phone's notification shade while a workout runs." },
];

// Canonical order of the radial circle; `feature` is the toggle that must be
// on for the action to exist at all (null = core, always available).
const RADIAL_ACTION_META = [
  { key: "note", label: "Exercise note", icon: "note", feature: "exerciseNotes" },
  { key: "sticky", label: "Sticky note", icon: "stickyNote", feature: "stickyNotes" },
  { key: "unilateral", label: "Always unilateral", icon: "unilateral", feature: "unilateral" },
  { key: "start-side", label: "Starting side", icon: "startSide", feature: "startSide" },
  { key: "rest", label: "Rest timer", icon: "restTimer", feature: "restTimer" },
  { key: "variant", label: "Machine / variant", icon: "machineVariant", feature: "machineVariant" },
  { key: "machine-settings", label: "Machine settings", icon: "machineSettings", feature: "machineSettings" },
  { key: "replace", label: "Replace", icon: "replace", feature: "replaceExercise" },
  { key: "superset", label: "Superset", icon: "superset", feature: "supersets" },
  { key: "remove", label: "Remove", icon: "remove", feature: null },
];

const FEATURES_OFF_KEY = "workoutFeaturesOff";
// defaultOff features the user switched on (the OFF list only covers default-on ones)
const FEATURES_ON_KEY = "workoutFeaturesOn";
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
  const def = FEATURE_BY_ID[id];
  if (def && def.defaultOff) return !(readStoredList(FEATURES_ON_KEY) || []).includes(id);
  return (readStoredList(FEATURES_OFF_KEY) || []).includes(id);
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
  const def = FEATURE_BY_ID[id];
  if (!def) return;
  const key = def.defaultOff ? FEATURES_ON_KEY : FEATURES_OFF_KEY;
  const list = new Set(readStoredList(key) || []);
  if (on === !!def.defaultOff) list.add(id); else list.delete(id);
  localStorage.setItem(key, JSON.stringify([...list]));
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
  localStorage.removeItem(FEATURES_ON_KEY);
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

// Each section of the screen shows a small "example exercise" that reacts to
// the switches below it. It is a static mock built from the SAME CSS classes
// as the real workout screen (renderExerciseCard in app-render.js and the
// active bar in index.html), so it looks identical but touches no workout
// state. If the real card's markup changes, mirror it here.

const PREVIEW_EXERCISE = "Seated Cable Row";
const PREVIEW_GROUPS = ["sets", "timers", "exercise", "workout"];
const PF_ICONS = {
  timer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="active-bar-timer-icon"><path d="M9 2h6"/><path d="M12 2v3"/><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/></svg>`,
  dots: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="header-icon"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>`,
  check: `<svg class="confirmed-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="rest-bar-icon"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
};
const PF_RADIAL_RADIUS = 86;
const PF_FLASH_MS = 1700;

// Preview-only override: "tap a row to see it" shows a switched-off feature
// for a moment without touching the stored setting.
let previewForced = null;
let previewForcedRadial = null;
let previewRevertTimer = null;

function pfOn(id) {
  if (previewForced && previewForced.has(id)) return true;
  const def = FEATURE_BY_ID[id];
  if (!def) return true;
  return !featureSwitchedOff(id) && (!def.requires || pfOn(def.requires));
}

function pfForcedChain(id) {
  const chain = new Set();
  for (let def = FEATURE_BY_ID[id]; def; def = def.requires ? FEATURE_BY_ID[def.requires] : null) chain.add(def.id);
  return chain;
}

function pfTopBar(withNameRow) {
  const menuOn = pfOn("workoutNotes") || pfOn("reorder");
  return `
    <div class="active-bar">
      <span class="active-bar-left">
        <button class="icon-btn-plain" tabindex="-1">&#9660;</button>
        ${pfOn("manualTimer") ? `<button class="icon-btn-plain" tabindex="-1" data-pf="manualTimer">${PF_ICONS.timer}</button>` : ""}
      </span>
      ${pfOn("elapsedTime") ? `<span class="pf-clock" data-pf="elapsedTime">24:10</span>` : ""}
      <button class="active-bar-finish btn-caps" tabindex="-1">Finish</button>
    </div>
    ${withNameRow ? `<div class="active-name-row pf-name-row">
      <span class="pf-workout-name">Push day</span>
      ${menuOn ? `<button class="icon-btn" tabindex="-1" data-pf="workoutNotes reorder">${PF_ICONS.dots}</button>` : ""}
    </div>` : ""}`;
}

function pfCardHead() {
  const chips = [];
  if (pfOn("handleGrip")) chips.push(`<button class="machine-variant-tag handle-chip" tabindex="-1" data-pf="handleGrip">V-bar &middot; Neutral</button>`);
  if (pfOn("machineSettings")) chips.push(`<button class="machine-variant-tag" tabindex="-1" data-pf="machineSettings">&#9776; Seat 4 &middot; Pad 2</button>`);
  if (pfOn("machineVariant")) chips.push(`<button class="machine-variant-tag" tabindex="-1" data-pf="machineVariant">&#9881; Hammer Strength</button>`);
  if (pfOn("startSide")) chips.push(`<button class="machine-variant-tag" tabindex="-1" data-pf="startSide">&#8596; Start Left</button>`);
  return `
    ${pfOn("supersets") ? `<div class="superset-label" data-pf="supersets">Superset A</div>` : ""}
    <h3>
      <button class="exercise-name-link" tabindex="-1" data-pf="exerciseLink"${pfOn("exerciseLink") ? "" : " disabled"}>${PREVIEW_EXERCISE}</button>
      <button class="icon-btn options-btn" tabindex="-1">&#8943;</button>
    </h3>
    ${pfOn("stickyNotes") ? `<div class="variant-bar" data-pf="stickyNotes">Keep elbows tucked in</div>` : ""}
    ${chips.join("\n")}
    ${pfOn("exerciseNotes") ? `<div class="exercise-note" data-pf="exerciseNotes">Pause for a second at the chest</div>` : ""}`;
}

function pfSetTable({ header, restBar, addSet }) {
  const showPrev = pfOn("previousColumn");
  const rpe = pfOn("rpe");
  const prefill = pfOn("prefill");
  const tagDisabled = ["setWarmup", "setDrop", "setAssisted", "unilateral"].some(pfOn) ? "" : " disabled";
  const headerHtml = header ? `
    <div class="set-table-header">
      <span class="col-set">SET</span>
      ${showPrev ? `<span class="col-previous" data-pf="previousColumn">PREVIOUS</span>` : ""}
      <span class="col-kg">KG</span>
      ${pfOn("fieldModeToggle") ? `<button class="col-reps field-mode-toggle" tabindex="-1" data-pf="fieldModeToggle">REPS</button>` : `<span class="col-reps">REPS</span>`}
      <span class="col-check"></span>
    </div>` : "";
  const confirmedRow = `
    <div class="set-row-swipe-wrap"><div class="swipe-delete-bg">Delete</div>
      <div class="set-row confirmed">
        <button class="col-set" tabindex="-1"${tagDisabled}>1</button>
        ${showPrev ? `<span class="col-previous" data-pf="previousColumn">57.5kg &times; 8${rpe ? " @7" : ""}</span>` : ""}
        <button class="col-kg" tabindex="-1">60</button>
        <div class="rpe-badge-wrap"><button class="col-reps" tabindex="-1">8</button>${rpe ? `<button class="rpe-badge" tabindex="-1" data-pf="rpe">8</button>` : ""}</div>
        <span class="col-check"><button class="confirm-btn confirmed" tabindex="-1">${PF_ICONS.check}</button></span>
      </div>
    </div>`;
  const restHtml = restBar ? (pfOn("restTimer") ? `
    <button class="rest-divider live" tabindex="-1" data-pf="restTimer">
      <div class="rest-divider-progress" style="width: 60%"></div>
      <span class="rest-divider-content">${PF_ICONS.clock}<span class="rest-divider-tick">0:54</span></span>
    </button>` : "") : "";
  const pendingRow = `
    <div class="set-row-swipe-wrap"><div class="swipe-delete-bg">Delete</div>
      <div class="set-row pending">
        <button class="col-set" tabindex="-1"${tagDisabled}>2</button>
        ${showPrev ? `<button class="col-previous" tabindex="-1" data-pf="previousColumn">60kg &times; 8${rpe ? " @8" : ""}${pfOn("goalLine") ? `<span class="prev-goal" data-pf="goalLine">Goal 62.5kg &times; 8</span>` : ""}</button>` : ""}
        <div class="col-kg numpad-field ghost" data-pf="prefill">${prefill ? "60" : "-"}</div>
        <div class="rpe-badge-wrap"><div class="col-reps numpad-field ghost" data-pf="prefill">${prefill ? "8" : "-"}</div>${rpe && prefill ? `<span class="rpe-badge ghost" data-pf="rpe prefill">8</span>` : ""}</div>
        <span class="col-check"><button class="confirm-btn" tabindex="-1">${PF_ICONS.check}</button></span>
      </div>
    </div>`;
  const addSetHtml = addSet ? `<button class="text-link-btn add-set-btn" tabindex="-1">ADD SET${pfOn("restTimer") ? `<span data-pf="restTimer"> (1:30)</span>` : ""}</button>` : "";
  return `${headerHtml}<div class="set-list">${confirmedRow}${restHtml}${restBar ? "" : pendingRow}</div>${addSetHtml}`;
}

function pfTagPills() {
  const tags = [
    ["setWarmup", "W", "Warm-up", "warmup"],
    ["setDrop", "D", "Drop", "drop"],
    ["setAssisted", "A", "Assisted", "assisted"],
    ["unilateral", "U", "One-sided", "unilateral"],
  ].filter(([id]) => pfOn(id));
  const body = tags.length
    ? tags.map(([id, letter, name, cls]) => `<span class="pf-tag ${cls}" data-pf="${id}"><b>${letter}</b> ${name}</span>`).join("")
    : `<span class="pf-tag-none">No tags, the set number does nothing</span>`;
  return `<div class="pf-tags"><span class="pf-tags-label">Tap a set number to tag it:</span>${body}</div>`;
}

function pfCard(inner, extraClass) {
  return `<div class="exercise-card${extraClass || ""}${pfOn("previousColumn") ? "" : " no-prev"}">${inner}</div>`;
}

function previewHtml(key) {
  let inner;
  if (key === "sets") inner = pfCard(pfSetTable({ header: true }) + pfTagPills());
  else if (key === "timers") inner = pfTopBar(false) + pfCard(pfSetTable({ header: false, restBar: true, addSet: true }));
  else if (key === "exercise") inner = pfCard(pfCardHead(), pfOn("supersets") ? " superset" : "");
  else inner = pfTopBar(true);
  return `<div class="pf-preview" data-pf-key="${key}" inert aria-hidden="true">
    <div class="pf-preview-label">Example: ${PREVIEW_EXERCISE}</div>${inner}</div>`;
}

function radialPreviewHtml() {
  const gestureOn = featureEnabled("radialGesture");
  const shown = new Set(radialSelection().filter(radialKeyAvailable));
  if (previewForcedRadial) shown.add(previewForcedRadial);
  const list = RADIAL_ACTION_META.filter((m) => shown.has(m.key));
  const items = list.map((m, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / list.length;
    const dx = (PF_RADIAL_RADIUS * Math.cos(angle)).toFixed(1);
    const dy = (PF_RADIAL_RADIUS * Math.sin(angle)).toFixed(1);
    return `<span class="radial-item${m.key === "remove" ? " danger" : ""}" data-pf="radial:${m.key}" style="left: calc(50% + ${dx}px); top: calc(50% + ${dy}px)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS[m.icon]}</svg></span>`;
  }).join("");
  const note = !gestureOn ? "The swipe is turned off in Workout above, so this circle never opens"
    : list.length ? "" : "Nothing selected, so the swipe does nothing";
  return `<div class="pf-preview pf-radial${gestureOn ? "" : " pf-off"}" data-pf-key="radial" inert aria-hidden="true">
    <div class="pf-preview-label">Example: swipe right on ${PREVIEW_EXERCISE}</div>
    <div class="pf-radial-stage"><div class="radial-label pf-radial-center">${PREVIEW_EXERCISE}</div>${items}</div>
    ${note ? `<div class="pf-radial-note">${note}</div>` : ""}</div>`;
}

function previewEls(token) {
  return [...document.querySelectorAll(`#workout-features-body .pf-preview [data-pf~="${token}"]`)];
}

function flashEls(els) {
  els.forEach((el) => {
    el.classList.remove("pf-flash");
    void el.offsetWidth;
    el.classList.add("pf-flash");
  });
}

// Position of every preview part a switch controls, taken BEFORE the preview
// is redrawn, so a part that disappears can leave a dashed outline behind.
function snapshotRegions(token) {
  const snap = {};
  document.querySelectorAll("#workout-features-body .pf-preview").forEach((p) => {
    const base = p.getBoundingClientRect();
    snap[p.dataset.pfKey] = [...p.querySelectorAll(`[data-pf~="${token}"]`)].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - base.left - p.clientLeft, y: r.top - base.top - p.clientTop, w: r.width, h: r.height };
    });
  });
  return snap;
}

function playChangeFlash(token, snap) {
  document.querySelectorAll("#workout-features-body .pf-preview").forEach((p) => {
    const now = [...p.querySelectorAll(`[data-pf~="${token}"]`)];
    if (now.length) {
      flashEls(now);
      return;
    }
    (snap[p.dataset.pfKey] || []).forEach((r) => {
      const ghost = document.createElement("div");
      ghost.className = "pf-ghost";
      ghost.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
      p.appendChild(ghost);
      setTimeout(() => ghost.remove(), PF_FLASH_MS);
    });
  });
}

function redrawPreviews() {
  document.querySelectorAll("#workout-features-body .pf-preview").forEach((p) => {
    const key = p.dataset.pfKey;
    p.outerHTML = key === "radial" ? radialPreviewHtml() : previewHtml(key);
  });
}

function endForcedPreview() {
  clearTimeout(previewRevertTimer);
  previewRevertTimer = null;
  previewForced = null;
  previewForcedRadial = null;
}

// Tapping a row's name shows that feature in the example, even when it is
// switched off right now, then puts the example back.
function locatePreview(token, isRadial) {
  endForcedPreview();
  if (isRadial) previewForcedRadial = token.slice("radial:".length);
  else previewForced = pfForcedChain(token);
  redrawPreviews();
  flashEls(previewEls(token));
  previewRevertTimer = setTimeout(() => {
    endForcedPreview();
    redrawPreviews();
  }, PF_FLASH_MS);
}

function openWorkoutFeaturesScreen() {
  showScreenRaw("screen-workout-features");
  pushNavLayer(() => {
    endForcedPreview();
    showScreenRaw("screen-settings");
  });
  renderWorkoutFeaturesScreen();
}

function renderWorkoutFeaturesScreen(changedId) {
  const body = document.getElementById("workout-features-body");
  const snap = changedId ? snapshotRegions(changedId) : null;
  endForcedPreview();
  const toggleRow = (attr, id, label, desc, checked, disabled, where, iconHtml) => `
    <div class="settings-row${disabled ? " settings-row-disabled" : ""}">
      <div class="settings-row-text">
        <span>${iconHtml || ""}${label}</span>
        <span class="settings-row-hint">${desc}</span>
        ${where ? `<span class="settings-row-where">Where: ${where}</span>` : ""}
      </div>
      <label class="toggle-switch"><input type="checkbox" ${attr}="${id}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}><span class="toggle-track"></span></label>
    </div>`;
  const groups = FEATURE_GROUPS.map((g) => {
    const rows = FEATURE_REGISTRY.filter((f) => f.group === g.id).map((f) => {
      const parentOff = f.requires && !featureEnabled(f.requires);
      const hint = parentOff ? `Needs "${FEATURE_BY_ID[f.requires].label}"` : f.desc;
      return toggleRow("data-feature", f.id, f.label, hint, featureEnabled(f.id), parentOff, parentOff ? "" : f.where);
    }).join("");
    return `<div class="settings-section-title">${g.label}</div><div class="pf-group">${PREVIEW_GROUPS.includes(g.id) ? previewHtml(g.id) : ""}${rows}</div>`;
  }).join("");
  const selected = new Set(radialSelection());
  const radialRows = RADIAL_ACTION_META.map((m) => {
    const available = radialKeyAvailable(m.key);
    const hint = available ? "" : "Feature is turned off";
    const icon = `<svg class="settings-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS[m.icon]}</svg>`;
    return toggleRow("data-radial-key", m.key, m.label, hint, selected.has(m.key), !available, "", icon);
  }).join("");
  body.innerHTML = `
    ${groups}
    <div class="settings-section-title">Radial quick menu</div>
    <div class="meta settings-radial-intro">Choose what appears in the circle when you swipe right on an exercise.</div>
    <div class="pf-group">${radialPreviewHtml()}${radialRows}</div>
    <div class="settings-row settings-row-clickable" id="workout-features-reset">
      <div class="settings-row-text"><span>Reset to defaults</span><span class="settings-row-hint">Puts every feature back to its default and restores the full radial menu</span></div>
    </div>`;
  if (changedId) playChangeFlash(changedId, snap);
}

document.getElementById("settings-workout-features-row").addEventListener("click", openWorkoutFeaturesScreen);
document.getElementById("workout-features-back").addEventListener("click", () => closeTopNavLayer());
document.getElementById("workout-features-body").addEventListener("change", (e) => {
  const input = e.target;
  if (input.dataset.feature) {
    setFeatureEnabled(input.dataset.feature, input.checked);
    renderWorkoutFeaturesScreen(input.dataset.feature);
  } else if (input.dataset.radialKey) {
    const token = `radial:${input.dataset.radialKey}`;
    const snap = snapshotRegions(token);
    endForcedPreview();
    setRadialKeyChosen(input.dataset.radialKey, input.checked);
    redrawPreviews();
    playChangeFlash(token, snap);
  }
});
document.getElementById("workout-features-body").addEventListener("click", (e) => {
  if (e.target.closest("#workout-features-reset")) {
    resetFeatures();
    renderWorkoutFeaturesScreen();
    return;
  }
  const text = e.target.closest(".settings-row-text");
  const input = text && text.closest(".settings-row").querySelector("[data-feature], [data-radial-key]");
  if (!input) return;
  if (input.dataset.feature) locatePreview(input.dataset.feature, false);
  else locatePreview(`radial:${input.dataset.radialKey}`, true);
});

applyFeatureVisibility();
