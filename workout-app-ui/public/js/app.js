// Changed only by scripts/release.sh, together with build.gradle's versionName
// and versionCode. The header shows APP_VERSION+<commit>; the commit comes from
// js/build-info.js, which deploy and APK builds stamp (scripts/stamp-build.sh).
const APP_VERSION = "0.4.3";
const BUILD_ID = self.STRONGER_BUILD || "dev";
const REST_SECONDS_DEFAULT = 90;
// App-wide double-progression rep ceiling (2026-09-24, ImIceTry's ask). See
// fetchRepCeiling below -- an exercise's own rep_ceiling column overrides
// this when set.
const REP_CEILING_DEFAULT = 12;
const ACTIVE_WORKOUT_KEY = "activeWorkout";
// Capacitor's Android WebView serves bundled assets from https://localhost,
// so relative /api/ paths resolve to nowhere -- point them at the real
// backend explicitly there. Browser/PWA use stays same-origin (empty base).
// Both values come from js/config.js (gitignored, site-specific -- see
// config.example.js), never hardcoded here.
const API_BASE = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
  ? (window.APP_CONFIG && window.APP_CONFIG.nativeApiBase) || ""
  : "";
// Grafana panel snapshots are an optional add-on (see README) -- an unset
// base leaves the Statistics tab's panel images blank rather than broken,
// same fallback loadGrafanaSnapshots() already has for a failed fetch.
const GRAFANA_SNAPSHOT_BASE = (window.APP_CONFIG && window.APP_CONFIG.grafanaSnapshotBase) || "";

let activeWorkout = null; // { name, started_at, exercises: [names], sets: [], supersets: {name: groupLetter} }
let editingWorkoutId = null; // set when the active screen is editing an already-synced workout, not logging a new one
let previousPerformanceCache = {};
let lastByVariantCache = {}; // exerciseName -> {machine: last session on that machine, "" = untagged} (2026-10-15)
let stickyNoteCache = {};
let unitTypeCache = {};
let defaultUnilateralCache = {};
let defaultRestCache = {};
let repCeilingCache = {};
let machineSettingsCache = {}; // exerciseName -> {variant: [[name, value], ...]}
let variantRatioCache = {}; // exerciseName -> {variant: ratio, ...}
let restTimerHandle = null;
// Which specific rest-divider is currently ticking, if any -- { exerciseName,
// position } -- so renderExerciseCard knows which divider (of possibly many
// across several exercise cards) gets the live countdown + Skip button
// instead of the plain historical time.
let restTimerContext = null;
// Superset: a partner exercise's rest keeps running while you do the other
// one's set, so more than one countdown can be live. restTimerContext is the
// one the notification/numpad act on; the rest wait here.
let parallelRestTimers = [];
// Standalone timer (2026-09-13) -- entirely separate from restTimerHandle/
// restTimerContext above, which are always tied to one specific exercise's
// set position. This one belongs to the workout as a whole (started via the
// top-bar circle icon), so it has its own handle/context and its own bar in
// the DOM instead of patching a set row.
let manualTimerHandle = null;
let manualTimerContext = null; // { remaining, total }
let elapsedTimerHandle = null;
let pendingRpeByExercise = {};
// exerciseName -> {position: RPE}: the values in pendingRpeByExercise that are only the ghost
// prefill from the previous session, not a pick. A machine change clears exactly these, so the
// new machine's own last RPE refills them (2026-10-15).
let seededRpeByExercise = {};
let pendingSetTypeByExercise = {};
// Orthogonal to set_type (normal/drop/failure/warmup describe how hard a set
// was pushed; this is about which limb(s) did the work) -- a one-arm rep
// logs a real weight_kg that isn't comparable to the same exercise's normal
// two-handed numbers, so it's tracked as its own toggle rather than folded
// into set_type (2026-09-16, prompted by a real Preacher Curl session that
// misread as a strength crash before this existed).
let pendingUnilateralByExercise = {};
// Per-position override of activeWorkout.variantByExercise's exercise-wide
// default (2026-09-17) -- only ever populated by editConfirmedSet reopening
// an already-logged set, so that re-confirming it during an edit keeps its
// own original variant instead of silently picking up whatever the
// exercise-wide default happens to be right now (which could differ, e.g.
// editing an old workout logged under a machine that's since been replaced).
let pendingVariantByExercise = {};
// Same idea for cable handle + grip (2026-10-06): position -> {handle, grip}.
let pendingHandleGripByExercise = {};
// Start side is now an exercise-wide option (activeWorkout.startSideByExercise,
// 2026-10-14). This per-position map only carries the side of a logged set
// that was reopened for editing, so re-confirming it keeps its own value.
let pendingSideByExercise = {};
// How many reps were assisted on a set tagged "assisted" (2026-09-18,
// replaces the old "failure" set type) -- only ever meaningful alongside
// pendingSetTypeByExercise[exerciseName][i] === "assisted", same strict-
// refinement relationship pendingSideByExercise has with unilateral above.
let pendingAssistedRepsByExercise = {};
// Weight/reps the user has already typed for the pending set, kept alive
// across the re-render that picking an RPE/set-type triggers -- otherwise
// that render re-applies the *previous session's* prefill and silently
// wipes whatever was just typed.
let pendingInputByExercise = {};
// The currently-open numpad session's identity + a way to swap it to a
// different field in place, or null when no numpad is open (2026-09-18).
// Lets app-render.js's weight/reps field click handlers tell "the numpad
// for THIS row is already open, just switch fields" apart from "nothing's
// open, start a fresh session" -- see openNumpad's own comment on the bug
// this fixes.
let activeNumpadSession = null;
// How many sets beyond history/confirmed-so-far have been explicitly added
// via each exercise's own ADD SET control (Strong's own text link, not an
// auto-grown extra row) -- {exerciseName: count}.
let extraSetsByExercise = {};
// Pending (not-yet-confirmed) positions swiped away for this session --
// {exerciseName: Set<position>} -- 2026-09-10. Positions come from history
// prefill or ADD SET alike; a skipped one simply renders nothing (row +
// its rest divider both), rather than trying to renumber every position
// after it, which would mean re-keying pendingInputByExercise/
// pendingRpeByExercise/pendingSetTypeByExercise and reinterpreting which
// historical set's PREVIOUS data every later row refers to -- a real
// redesign, not a swipe gesture's worth of change.
let skippedPositionsByExercise = {};
// Per-exercise override of which mode an as-yet-unconfirmed row's second
// field uses -- "reps" or "time" -- set by tapping the REPS/TIME header
// label (openFieldModePicker). Every exercise now renders the same KG +
// REPS/TIME + RPE layout (2026-09-12, ImIceTry's own ask -- Dead Hang/Hanging
// Leg Raise used to get a totally different collapsed single-column
// layout); this is what lets a given exercise's entry field be switched
// between the two instead of being permanently fixed by its unit_type.
// Undefined means "use the exercise's own unit_type as the default"; a
// confirmed set's own display never consults this -- it always goes by
// whichever of reps/duration_sec that specific set actually has.
let fieldModeOverrideByExercise = {};
// Set right before the render call that follows a real confirm action
// (logSet), keyed "exerciseName::setOrder" -- lets renderExerciseCard tell
// "this specific row just got confirmed, play its mount animation" apart
// from "this row is being redrawn because something else on the screen
// changed" (2026-09-12 fix). Every render rebuilds every exercise card from
// scratch, confirmed or not, so a plain CSS mount animation on the
// confirmed/RPE-badge/checkmark elements was replaying on EVERY unrelated
// render (confirming set 3 replayed set 1's "just confirmed" flash too) --
// read that as the RPE badge "blinking" for no reason. renderActiveScreen
// snapshots this into a local var and clears the global immediately, so
// only the one render pass that's actually responding to this confirm ever
// sees it true; the async cache-fill re-renders later never do.
let justConfirmedKey = null;
// Reorder mode (2026-09-12, ImIceTry's own ask) -- long-pressing any
// exercise's name collapses the whole active-workout screen down to just
// the exercise names (no set tables), and dragging one re-sorts
// reorderExercises; exitReorderMode(true) commits that order back into
// activeWorkout.exercises. reorderExercises is a working copy, not touched
// live in-place, so a cancel (exitReorderMode(false)) or backing out
// doesn't leave the real order half-changed.
let reorderMode = false;
let reorderExercises = [];
let reorderDragIndex = null;
// Maps a drop set's own source position to the continuation position it
// added -- {exerciseName: {sourceIndex: continuationIndex}} -- so turning
// the drop flag back off (2026-09-11) can find and remove exactly that
// continuation row again, not just leave it stranded.
let dropContinuationByExercise = {};
let allExercisesCache = null; // /api/exercises/all, cached for the Exercises tab + superset picker
let exerciseDetailCurrentName = null;
// "grid" (Strong's own 2-column default) or "list" -- Templates header's
// "···" menu, persisted across reloads (2026-09-10).
let templateViewMode = localStorage.getItem("templateViewMode") || "grid";
// True while the active-workout overlay is open for *building a template*
// (Home screen "+", 2026-09-10) rather than logging a real workout -- same
// exercise-picker UI reused as-is (ImIceTry's own call), just the top Finish
// button becomes "Save Template" and saves the exercise list directly
// instead of syncing a workout. Never true at the same time as
// editingWorkoutId (mutually exclusive entry points).
let buildingTemplateMode = false;

// ---------- helpers, api ---------- (moved to app-utils.js / app-api.js, 2026-09-17)


// ---------- docked panel, back-button layers, modal ---------- (moved to app-nav.js, 2026-09-17)


// ---------- collapsing large title, screens ---------- (moved to app-screens.js, 2026-09-17)


// ---------- active workout overlay + mini-bar ---------- (moved to app-overlay.js, 2026-09-17)


// ---------- home screen ---------- (moved to app-home.js, 2026-09-17)



// ---------- active workout (also doubles as the edit-past-workout screen) ----------

// Only one activeWorkout slot exists; starting, editing or template-building
// while one is running would silently overwrite it (and its logged sets).
function blockIfWorkoutRunning(what) {
  if (!activeWorkout) return false;
  alert(`A workout is already in progress. Finish or cancel it before ${what}.`);
  return true;
}

// Clears every per-exercise cache/pending map before a workout is started or
// opened for editing. One list shared by both entry points (2026-09-30):
// they used to keep separate copies, and a map missing from one of them is
// exactly how the 2026-09-22 drop-set numbering bug happened -- stale
// dropContinuationByExercise/previousIndexByExercise entries from an earlier
// workout in the same open session leaked into the next one. Any new
// per-exercise map belongs here.
function resetPerWorkoutState() {
  previousPerformanceCache = {};
  lastByVariantCache = {};
  stickyNoteCache = {};
  defaultUnilateralCache = {};
  defaultRestCache = {};
  repCeilingCache = {};
  variantRatioCache = {};
  machineSettingsCache = {};
  exerciseHistoryForPrCache = {};
  unitTypeCache = {};
  pendingRpeByExercise = {};
  seededRpeByExercise = {};
  pendingSetTypeByExercise = {};
  pendingUnilateralByExercise = {};
  pendingSideByExercise = {};
  pendingAssistedRepsByExercise = {};
  pendingVariantByExercise = {};
  pendingHandleGripByExercise = {};
  pendingInputByExercise = {};
  extraSetsByExercise = {};
  skippedPositionsByExercise = {};
  fieldModeOverrideByExercise = {};
  dropContinuationByExercise = {};
  previousIndexByExercise = {};
}

async function startWorkout(fromWorkoutId, templateName, presetExercises, templateRef) {
  if (blockIfWorkoutRunning("starting another one")) return;
  let exercises = [];
  if (presetExercises) {
    // A scratch template (2026-09-10) has no source workout to fetch sets
    // from -- its exercise list is handed straight in instead.
    exercises = presetExercises.slice();
  } else if (fromWorkoutId != null) {
    try {
      const detail = await apiGet(`/api/workouts/${fromWorkoutId}`);
      const seen = new Set();
      detail.sets.forEach((s) => {
        if (!seen.has(s.exercise_name)) {
          seen.add(s.exercise_name);
          exercises.push(s.exercise_name);
        }
      });
    } catch (err) {
      // offline or gone -- fall back to a blank workout rather than blocking
    }
  }
  const now = new Date();
  editingWorkoutId = null;
  buildingTemplateMode = false;
  activeWorkout = {
    // Starting from a template pre-fills its name, same as every other field
    // it seeds -- previously this always fell back to "Workout" even from a
    // template, forcing a retype every single time. Blank/"+ New Workout"
    // starts (no templateName) keep the original generic default.
    name: templateName || "Workout",
    started_at: fmtDateTime(now),
    exercises,
    sets: [],
    supersets: {},
    exerciseNotes: {},
    restOverrides: {},
    variantByExercise: {},
    startSideByExercise: {},
    handleByExercise: {},
    gripByExercise: {},
    workoutNotes: "",
    // Only set when actually started from a template (see openTemplatePreview's
    // two "start" handlers) -- gates the Finish-time "update the template to
    // match" dialog (Open Problem, 2026-09-14, ImIceTry's own ask). `tpl` keeps
    // the exact object handed in so `ensureTemplateId` can still materialize
    // a virtual (never-yet-saved) template card at Finish time if needed.
    templateRef: templateRef || null,
  };
  resetPerWorkoutState();
  persistActiveWorkout();
  showActiveWorkoutOverlay();
}

function startEditingWorkout(workout) {
  if (blockIfWorkoutRunning("editing a workout")) return;
  const seen = new Set();
  const exercises = [];
  workout.sets.forEach((s) => {
    if (!seen.has(s.exercise_name)) {
      seen.add(s.exercise_name);
      exercises.push(s.exercise_name);
    }
  });
  editingWorkoutId = workout.id;
  buildingTemplateMode = false;
  activeWorkout = {
    name: workout.name,
    started_at: workout.started_at,
    exercises,
    sets: workout.sets.map((s) => ({ ...s })),
    supersets: {},
    exerciseNotes: {},
    restOverrides: {},
    variantByExercise: {},
    startSideByExercise: {},
    handleByExercise: {},
    gripByExercise: {},
    // Editing an already-synced workout starts with its real saved note,
    // not blank -- workout.workout_notes comes straight from
    // get_workout_detail's own response.
    workoutNotes: workout.workout_notes || "",
  };
  resetPerWorkoutState();
  persistActiveWorkout();
  showActiveWorkoutOverlay();
}

function persistActiveWorkout() {
  if (activeWorkout) {
    localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify({ activeWorkout, editingWorkoutId }));
  } else {
    localStorage.removeItem(ACTIVE_WORKOUT_KEY);
  }
}

function restoreActiveWorkout() {
  const raw = localStorage.getItem(ACTIVE_WORKOUT_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    // Format changed tonight to {activeWorkout, editingWorkoutId} -- guard
    // against an older saved shape (plain activeWorkout object) rather than
    // crashing on a stale localStorage entry from before this change.
    if (!parsed || !parsed.activeWorkout || !Array.isArray(parsed.activeWorkout.sets)) {
      localStorage.removeItem(ACTIVE_WORKOUT_KEY);
      return false;
    }
    activeWorkout = parsed.activeWorkout;
    editingWorkoutId = parsed.editingWorkoutId || null;
    if (!activeWorkout.supersets) activeWorkout.supersets = {};
    if (!activeWorkout.exerciseNotes) activeWorkout.exerciseNotes = {};
    if (!activeWorkout.restOverrides) activeWorkout.restOverrides = {};
    return true;
  } catch (err) {
    return false;
  }
}

// Collapses gaps after a genuine delete (not an edit-reopen, which leaves
// its own slot open on purpose -- see editConfirmedSet) -- sorts by the
// *current* set_order first since confirmation order no longer has to
// match it, then reassigns 1..N so nothing's left numbered out of sequence.
function renumberExercise(exerciseName) {
  const forExercise = activeWorkout.sets
    .filter((s) => s.exercise_name === exerciseName)
    .sort((a, b) => a.set_order - b.set_order);
  forExercise.forEach((s, i) => { s.set_order = i + 1; });
}

async function fetchPreviousPerformance(exerciseName) {
  if (exerciseName in previousPerformanceCache) return previousPerformanceCache[exerciseName];
  try {
    const data = await apiGet(`/api/exercises/${encodeURIComponent(exerciseName)}/last`);
    previousPerformanceCache[exerciseName] = data;
    return data;
  } catch (err) {
    previousPerformanceCache[exerciseName] = null;
    return null;
  }
}

async function fetchStickyNote(exerciseName) {
  if (exerciseName in stickyNoteCache) return stickyNoteCache[exerciseName];
  try {
    const data = await apiGet(`/api/exercises/${encodeURIComponent(exerciseName)}/sticky-note`);
    stickyNoteCache[exerciseName] = data.note;
    return data.note;
  } catch (err) {
    stickyNoteCache[exerciseName] = null;
    return null;
  }
}

// Exercise-level "always unilateral" default (2026-09-17, Function Expansion
// Plan item 1.3) -- replaces the repeated manual DB surgery this project
// kept doing to retroactively mark an exercise's whole history unilateral.
// Set once via the options menu; every open (not yet explicitly touched)
// pending position for that exercise then defaults to it, see
// isPositionUnilateral below.
async function fetchDefaultUnilateral(exerciseName) {
  if (exerciseName in defaultUnilateralCache) return defaultUnilateralCache[exerciseName];
  try {
    const data = await apiGet(`/api/exercises/${encodeURIComponent(exerciseName)}/default-unilateral`);
    defaultUnilateralCache[exerciseName] = !!data.default_unilateral;
    return defaultUnilateralCache[exerciseName];
  } catch (err) {
    defaultUnilateralCache[exerciseName] = false;
    return false;
  }
}

// Distinguishes "never touched this position" (falls back to the exercise-
// wide default) from "explicitly toggled off" (stays off regardless of the
// default) -- a plain `!!map[name][pos]` can't tell those apart, since both
// read as false. Used both at render time (the pending badge) and at
// logSet time (what actually gets submitted), so they can never disagree.
function isPositionUnilateral(exerciseName, position) {
  if (!featureEnabled("unilateral")) return false;
  const override = (pendingUnilateralByExercise[exerciseName] || {})[position];
  if (override !== undefined) return !!override;
  return !!defaultUnilateralCache[exerciseName];
}

// Persistent per-exercise rest default (2026-09-17, Function Expansion Plan
// item 1.3, remaining sub-scope) -- distinct from activeWorkout.restOverrides,
// which is workout-local and resets every workout. null (not yet fetched,
// or explicitly cleared server-side) means "fall back to the app's own
// global REST_SECONDS_DEFAULT," same convention db.get_exercise_default_rest
// already uses.
async function fetchDefaultRest(exerciseName) {
  if (exerciseName in defaultRestCache) return defaultRestCache[exerciseName];
  try {
    const data = await apiGet(`/api/exercises/${encodeURIComponent(exerciseName)}/default-rest`);
    defaultRestCache[exerciseName] = data.default_rest_sec;
    return defaultRestCache[exerciseName];
  } catch (err) {
    defaultRestCache[exerciseName] = null;
    return null;
  }
}

// Per-exercise override for the weight-hint's double-progression rep
// ceiling (2026-09-24). null (not yet fetched, or explicitly cleared
// server-side) means "fall back to REP_CEILING_DEFAULT," same convention
// db.get_exercise_rep_ceiling already uses.
async function fetchRepCeiling(exerciseName) {
  if (exerciseName in repCeilingCache) return repCeilingCache[exerciseName];
  try {
    const data = await apiGet(`/api/exercises/${encodeURIComponent(exerciseName)}/rep-ceiling`);
    repCeilingCache[exerciseName] = data.rep_ceiling;
    return repCeilingCache[exerciseName];
  } catch (err) {
    repCeilingCache[exerciseName] = null;
    return null;
  }
}

// {variant: [[name, value], ...]} saved machine settings (2026-10-10). Not
// part of exerciseContextLoaded: the chip simply appears once it arrives.
async function fetchMachineSettings(exerciseName) {
  if (exerciseName in machineSettingsCache) return machineSettingsCache[exerciseName];
  try {
    const data = await apiGet(`/api/exercises/${encodeURIComponent(exerciseName)}/machine-settings`);
    machineSettingsCache[exerciseName] = data.machine_settings || {};
  } catch (err) {
    return {};
  }
  return machineSettingsCache[exerciseName];
}

// {variant: ratio} for every variant of this exercise that has a saved
// effective-weight ratio (2026-09-17) -- see sets.weight_ratio's own
// comment in db.py. Whole-map, not per-variant, since openMachineVariantModal
// needs to look up "does the variant currently being typed have a saved
// ratio" without a request per keystroke.
async function fetchVariantRatios(exerciseName) {
  if (exerciseName in variantRatioCache) return variantRatioCache[exerciseName];
  try {
    const data = await apiGet(`/api/exercises/${encodeURIComponent(exerciseName)}/variant-ratios`);
    variantRatioCache[exerciseName] = data.ratios || {};
    return variantRatioCache[exerciseName];
  } catch (err) {
    variantRatioCache[exerciseName] = {};
    return {};
  }
}

// last_performance's own response already includes unit_type (Phase 0.4),
// so the common case (an exercise with real history) needs no extra
// request. Falls back to /api/exercises/all (also has unit_type, and is
// already cached elsewhere for the Exercises tab/superset picker) for an
// exercise with zero logged sets yet, where /last 404s. If truly neither
// has it (a brand new exercise name that's never been synced at all, so no
// exercises row exists), 'weight_reps' is the correct default -- it's
// literally the schema column's own default for a freshly created row.
async function fetchUnitType(exerciseName) {
  if (exerciseName in unitTypeCache) return unitTypeCache[exerciseName];
  const last = await fetchPreviousPerformance(exerciseName);
  if (last && last.unit_type) {
    unitTypeCache[exerciseName] = last.unit_type;
    return last.unit_type;
  }
  if (!allExercisesCache) {
    try {
      const data = await apiGet("/api/exercises/all");
      allExercisesCache = data.exercises;
    } catch (err) {
      allExercisesCache = allExercisesCache || [];
    }
  }
  const meta = allExercisesCache.find((e) => e.name === exerciseName);
  const unitType = (meta && meta.unit_type) || "weight_reps";
  unitTypeCache[exerciseName] = unitType;
  return unitType;
}

// Everything one exercise card needs, in a single request (2026-09-30) --
// replaces firing all seven fetchers above per exercise on every workout
// start, each one re-rendering the card when it landed. Fills the same
// caches those fetchers use (only the ones still empty, so a value already
// changed this session isn't overwritten by a slower response), so every
// other caller keeps working unchanged. Falls back to the individual
// fetchers when this fails: a backend that predates /context 404s, and
// offline only the per-field responses may be in GetCache yet.
async function fetchExerciseContext(exerciseName) {
  let ctx;
  try {
    ctx = await apiGet(`/api/exercises/${encodeURIComponent(exerciseName)}/context`);
  } catch (err) {
    await Promise.all([
      fetchPreviousPerformance(exerciseName), fetchStickyNote(exerciseName), fetchUnitType(exerciseName),
      fetchDefaultUnilateral(exerciseName), fetchDefaultRest(exerciseName), fetchRepCeiling(exerciseName),
      fetchVariantRatios(exerciseName),
    ]);
    return;
  }
  const fill = (cache, value) => { if (!(exerciseName in cache)) cache[exerciseName] = value; };
  fill(previousPerformanceCache, ctx.last || null);
  fill(lastByVariantCache, ctx.last_by_variant || null);
  fill(unitTypeCache, ctx.unit_type || "weight_reps");
  fill(stickyNoteCache, ctx.sticky_note ?? null);
  fill(defaultUnilateralCache, !!ctx.default_unilateral);
  fill(defaultRestCache, ctx.default_rest_sec ?? null);
  fill(repCeilingCache, ctx.rep_ceiling ?? null);
  fill(variantRatioCache, ctx.variant_ratios || {});
  fill(machineSettingsCache, ctx.machine_settings || {});
}

function exerciseContextLoaded(exerciseName) {
  return [previousPerformanceCache, stickyNoteCache, unitTypeCache, defaultUnilateralCache,
    defaultRestCache, repCeilingCache, variantRatioCache].every((cache) => exerciseName in cache);
}

// The previous session that the PREVIOUS column, prefill, Goal line, weight
// hint, next-set notification and finish dialog compare against (2026-10-15,
// ImIceTry: he trains different weights on different machines). With the
// machine feature on it is the last session on the machine selected for
// this exercise; null when that machine has no history yet, so the row shows
// "-" with no prefill or Goal, because another machine's numbers are on
// another scale (SportsArt reads 40 where Life Fitness reads 9.25). Feature
// off, or a backend that predates last_by_variant: the newest session of any
// machine, as before.
function previousFor(exerciseName) {
  const byMachine = lastByVariantCache[exerciseName];
  if (!byMachine || !featureEnabled("machineVariant")) return previousPerformanceCache[exerciseName] || null;
  const machine = (activeWorkout && activeWorkout.variantByExercise && activeWorkout.variantByExercise[exerciseName]) || "";
  return byMachine[machine] || null;
}

function previousForSetIndex(data, index) {
  if (!data || !data.sets || index == null) return null;
  return data.sets[index] || null; // sets are ordered by set_order ascending
}

// A row's position normally maps 1:1 onto previousData.sets' own order
// (position N's "previous performance" is history's Nth set) -- but a
// drop-set continuation inserted mid-list (2026-09-11) breaks that: the
// continuation itself has no previous-performance counterpart of its own
// (null), and every position after it needs to keep pointing at the same
// historical set it always did, not silently shift onto its neighbor's.
// previousIndexByExercise holds the override once a position's mapping
// diverges from plain identity; toggleSetType is the only writer. Absence
// of an entry means "still identity" -- most positions never need one.
let previousIndexByExercise = {};
function historicalIndexFor(exerciseName, position) {
  const map = previousIndexByExercise[exerciseName];
  return map && Object.prototype.hasOwnProperty.call(map, position) ? map[position] : position;
}

// ---------- exercise-level menus: superset grouping, exercise options, notes, sticky note, machine/variant, replace/remove exercise, rest timer modal ---------- (moved to app-exercise-menu.js, 2026-09-17)



// ---------- RPE picker ---------- (moved to app-rpe-picker.js, 2026-09-17)



// -- numpad (docked keypad, active-workout-numpad.jpg) --
// Default step size per field kind (Phase 3.1's spec) -- weight steps in
// realistic plate increments, reps/duration step by 1.
const NUMPAD_STEP = { weight: 2.5, reps: 1, duration: 1 };

// Double-progression advice from one historical set -- pulled out of
// openNumpad's weight-hint badge (2026-09-30) so that badge and the pending
// row's "Goal" line (ImIceTry's pick from the review feature list) share one
// set of rules and can never disagree. prev: {rpe, weight_kg, reps};
// ceiling: this exercise's rep ceiling; nextWeight: the next heavier weight
// (see nextWeightUp), or null. symbol/text are exactly what the badge
// always showed. target is a concrete {weight_kg, reps} to beat last time:
// one more rep at the same weight, or -- when the badge says move up, or
// one more rep would pass the ceiling -- the next weight, at the same reps
// if last time felt easy (RPE <= 7), otherwise at however many reps keep
// the same Epley estimated 1RM. null when last time has no weight/reps.
function progressionAdvice(prev, ceiling, nextWeight) {
  const rpe = prev ? prev.rpe : null;
  const w = prev ? prev.weight_kg : null;
  const reps = prev ? prev.reps : null;
  const heavier = (keepReps) => {
    if (nextWeight == null || w == null || reps == null) return null;
    if (keepReps) return { weight_kg: nextWeight, reps };
    const e1rm = w * (1 + reps / 30);
    // + 1e-9: float division lands a hair under whole numbers (50x12 -> 52.5
    // gives 9.9999999...), which floor() turned into one rep short.
    return { weight_kg: nextWeight, reps: Math.max(1, Math.floor(30 * (e1rm / nextWeight - 1) + 1e-9)) };
  };
  const beat = () => {
    if (w == null || reps == null) return null;
    return reps + 1 <= ceiling ? { weight_kg: w, reps: reps + 1 } : heavier(false);
  };
  // Directional only, never a fabricated exact number -- easy last time
  // (low RPE) suggests going up, near failure suggests backing off, no
  // RPE on record stays neutral rather than guessing. +/o/- instead of
  // arrows (2026-09-10 follow-up) -- reads less like a directional
  // control and more like a small info badge, which is what it is.
  if (rpe != null && rpe <= 7) {
    return { symbol: "+", text: `Last time's RPE was ${rpe} (felt easy) -- try going up in weight.`, target: heavier(true) || beat() };
  }
  if (rpe != null && rpe >= 8 && rpe < 9.5) {
    // 2026-09-23, ImIceTry's own correction: he rarely logs below RPE 7 at
    // all, so the original <=7 "easy" threshold almost never fired for
    // him in practice -- 8-9.49 was landing in the same "hold, about
    // right" bucket as a genuine mid-range RPE, when for his real range
    // it actually means there's still room to push. Widened to suggest
    // moving up (weight or reps, his call which) anywhere from 8 up to
    // the existing 9.5 double-progression check below, which stays
    // separate since that's a real near-failure signal, not just "not
    // easy."
    return { symbol: "+", text: `Last time's RPE was ${rpe} -- you've got room, try more weight or reps this time.`, target: beat() };
  }
  if (rpe != null && rpe >= 9.5) {
    // Double-progression check (2026-09-18, ImIceTry's own ask; rewritten
    // 2026-09-24 per his correction). Used to compare last time's reps
    // against the best-ever reps logged at that exact weight -- but if
    // every attempt at a weight has been a grinding RPE-10 set, the
    // historical "best" IS an RPE-10 rep count, so merely tying it
    // (likely, since you're also going to RPE 10) falsely read as
    // "you've got room, move up," forever, with no real progression
    // happening (confirmed against real Chest Fly data: two separate
    // RPE-10 sets at 55kg, both 8 reps, would keep re-triggering "+").
    // Fixed ceiling instead: only once reps hits the exercise's own
    // rep-ceiling override (or the app-wide REP_CEILING_DEFAULT) does a
    // near-failure set suggest moving up.
    if (reps != null && reps >= ceiling) {
      return { symbol: "+", text: `Last time's RPE was ${rpe} at ${reps} reps -- that's hit the ${ceiling}-rep ceiling at ${w}kg, consider moving up.`, target: heavier(false) };
    }
    return { symbol: "=", text: `Last time's RPE was ${rpe} (close to failure) -- hold this weight and aim for more reps (up to ${ceiling}) before moving up.`, target: beat() };
  }
  if (rpe != null) {
    return { symbol: "o", text: `Last time's RPE was ${rpe} -- about right, try holding the same weight.`, target: beat() };
  }
  return { symbol: "o", text: "No RPE on record from last time, so no suggestion either way.", target: beat() };
}

// The next heavier weight worth suggesting for this exercise: the lightest
// weight above `weight` logged in the last NEXT_WEIGHT_WINDOW_DAYS on the
// same side-mode (machines only go up in their own stack/pin steps), else
// `weight` plus the smallest gap between those weights (1.25 on a .25/.75
// cable tower, the 1.5 add-on on the Reverse Fly machine), else the
// numpad's default 2.5 step. Recent only because older history can be from
// a different machine (Leg Extension's lone 53kg from 2024 would otherwise
// be "next" after today's 50). Reads the full history renderActiveScreen
// already warms per exercise; falls back to the default step until loaded.
// Since 2026-10-15 it also counts only weights logged on the machine selected
// for this exercise (machine feature on): each machine has its own stack steps
// and scale, and mixing them made the step up from 9.25 on Life Fitness land
// on SportsArt's 35.
const NEXT_WEIGHT_WINDOW_DAYS = 180;
function nextWeightUp(exerciseName, weight, unilateral) {
  if (weight == null) return null;
  const since = fmtDateTime(new Date(Date.now() - NEXT_WEIGHT_WINDOW_DAYS * 86400000));
  const used = new Set();
  const machineAware = featureEnabled("machineVariant");
  const machine = (activeWorkout && activeWorkout.variantByExercise && activeWorkout.variantByExercise[exerciseName]) || "";
  (exerciseHistoryForPrCache[exerciseName] || []).forEach((session) => {
    if (session.started_at < since) return;
    session.sets.forEach((s) => {
      if (machineAware && (s.variant || "") !== machine) return;
      if (s.weight_kg != null && s.set_type !== "warmup" && !!s.unilateral === !!unilateral) used.add(s.weight_kg);
    });
  });
  const sorted = [...used].sort((a, b) => a - b);
  const above = sorted.find((x) => x > weight);
  if (above != null) return above;
  let step = null;
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.round((sorted[i] - sorted[i - 1]) * 100) / 100;
    if (gap >= 1 && (step == null || gap < step)) step = gap;
  }
  return Math.round((weight + (step ?? NUMPAD_STEP.weight)) * 100) / 100;
}

// fields: ordered [{ key, allowDecimal, initialValue }] the numpad walks
// through via NEXT. onDone(values) fires with the final per-field string
// values once NEXT is tapped on the last field (equivalent to the card's
// own checkmark). Reuses the Phase 2.3 docking mechanism, not a second one.
// onCancel(values) fires on every other way the numpad closes (outside tap,
// collapse arrow, back button, Skip) with the current typed values, so a
// caller can keep them -- editConfirmedSetField commits them there, since a
// finished set has nowhere else to hold a half-typed edit (2026-10-03).
// Real bug fixed here (2026-09-19, ImIceTry: "I can select a box in every
// set" -- multiple rows' fields showing .active at once even though only
// one can actually be typed into). updateFieldDisplay only ever toggles
// .active on THIS session's own field elements; nothing ever cleared it
// off a previous session's element once the numpad moved to a different
// row entirely (switching fields within the same row was already fine,
// since that row's own elements get toggled correctly). Closing a numpad
// without confirming a new one doesn't trigger a re-render, so the stale
// .active class just sat in the live DOM indefinitely. Called once when a
// new session opens (so a stray highlight from a previous row never
// survives into it) and at every close path (so a stray highlight isn't
// left visible with no numpad open at all).
function clearNumpadFieldHighlight() {
  document.querySelectorAll('[data-numpad-field].active').forEach((el) => el.classList.remove("active"));
}

function openNumpad(exerciseName, index, fields, onDone, startIndex, onCancel) {
  clearNumpadFieldHighlight();
  let fieldIndex = startIndex || 0;
  const values = fields.map((f) => (f.initialValue != null && f.initialValue !== "" ? String(f.initialValue) : ""));
  // Weight-hint popup open/closed state (2026-09-18) -- tap the badge to
  // toggle, same "tap again to undo" convention as toggleSetType.
  // Per-field, not persisted: reset whenever the numpad moves to a new field
  // so a stale popup can't linger onto a field it doesn't apply to.
  let weightHintOpen = false;
  // For a field with selectOnType (2026-09-11, the rest-timer edit --
  // ImIceTry's own ask): the very first digit typed after opening replaces
  // the whole prefilled value instead of appending onto it, same as a
  // native input whose text is pre-selected on focus. Resets whenever the
  // field changes so a later field (if any) gets the same one-shot
  // behavior, not just the first field opened.
  let awaitingFirstKeystroke = !!currentField().selectOnType;

  function currentField() { return fields[fieldIndex]; }

  const persistTyped = () => {
    // Same pendingInputByExercise store the render-time prefill already
    // reads -- keeps the existing "survive an RPE/set-type re-render
    // mid-entry" behavior working for numpad-driven typing too. Keyed by
    // set index now, not just exercise, so typing ahead into a later
    // preview row (Phase: show-every-set) doesn't clobber the current row's
    // own typed-but-not-yet-confirmed values.
    const entry = {};
    fields.forEach((f, i) => { entry[f.key] = values[i]; });
    if (!pendingInputByExercise[exerciseName]) pendingInputByExercise[exerciseName] = {};
    pendingInputByExercise[exerciseName][index] = entry;
  };

  const updateFieldDisplay = () => {
    fields.forEach((f, i) => {
      const el = document.querySelector(`[data-numpad-field="${exerciseName}:${index}:${f.key}"]`);
      if (!el) return;
      el.textContent = f.isDuration ? (values[i] ? formatMmssBuffer(values[i]) : "-") : (values[i] || "-");
      el.classList.toggle("active", i === fieldIndex);
      // Stays ghost-styled through typing too now (2026-09-10 revision) --
      // only actually confirming the set solidifies it, see fieldsHtml.
    });
    persistTyped();
  };

  const appendDigit = (d) => {
    if (awaitingFirstKeystroke) {
      values[fieldIndex] = "";
      awaitingFirstKeystroke = false;
    }
    if (currentField().isDuration) {
      // Cash-register shift: once the buffer is full, drop the oldest
      // digit instead of growing unbounded.
      values[fieldIndex] = (values[fieldIndex].length >= 4 ? values[fieldIndex].slice(1) : values[fieldIndex]) + d;
    } else {
      values[fieldIndex] += d;
    }
    updateFieldDisplay();
  };
  const appendDecimal = () => {
    if (currentField().allowDecimal && !values[fieldIndex].includes(".")) {
      values[fieldIndex] += values[fieldIndex] ? "." : "0.";
      updateFieldDisplay();
    }
  };
  const backspace = () => {
    values[fieldIndex] = values[fieldIndex].slice(0, -1);
    updateFieldDisplay();
  };
  const stepValue = (delta) => {
    if (currentField().isDuration) {
      const seconds = mmssBufferToSeconds(values[fieldIndex]) + delta;
      values[fieldIndex] = secondsToMmssBuffer(Math.max(0, seconds));
      updateFieldDisplay();
      return;
    }
    const cur = parseFloat(values[fieldIndex]) || 0;
    const next = Math.max(0, cur + delta);
    values[fieldIndex] = currentField().allowDecimal
      ? String(Math.round(next * 100) / 100)
      : String(Math.round(next));
    updateFieldDisplay();
  };
  const goNext = () => {
    if (fieldIndex < fields.length - 1) {
      switchToField(fieldIndex + 1);
    } else {
      activeNumpadSession = null;
      clearNumpadFieldHighlight();
      closeDockedPanel();
      onDone(values);
    }
  };
  // Jumps this SAME open session to a different field in place -- used by
  // both NEXT (always +1) and a direct tap on this row's other linked
  // field (weight <-> reps/duration), see the onOutsideTap handler below.
  const switchToField = (i) => {
    fieldIndex = i;
    awaitingFirstKeystroke = !!currentField().selectOnType;
    weightHintOpen = false;
    render();
    updateFieldDisplay();
  };

  const render = () => {
    const decimalCell = currentField().allowDecimal
      ? `<button class="numpad-key" data-action="decimal">.</button>`
      : `<span class="numpad-blank"></span>`;
    // The slot that used to always be "RPE" is now per-field (2026-09-10):
    // "rpe" (unchanged, the default -- reps_only/time fields keep it),
    // "weightHint" (the KG step of a weight+reps set: a simple up/hold/down
    // suggestion instead, RPE doesn't apply while you're still picking a
    // weight), or "skip" (any rest-divider edit -- always present now,
    // 2026-09-11: closes without starting/restarting anything, also
    // stopping this position's own timer first if it's the one currently
    // live. NEXT is the only way to (re)start a countdown now, uniformly
    // for idle/live/historical alike).
    const slot = currentField().numpadSlot || (featureEnabled("rpe") ? "rpe" : "none");
    let rpeCell;
    let weightHintText = "";
    if (slot === "skip") {
      rpeCell = `<button class="numpad-key numpad-action" data-action="skip-rest">Skip</button>`;
    } else if (slot === "none") {
      rpeCell = `<span class="numpad-blank"></span>`;
    } else if (slot === "weightHint") {
      const advice = progressionAdvice(
        { rpe: currentField().weightHintRpe, weight_kg: currentField().weightHintWeight, reps: currentField().weightHintReps },
        currentField().weightHintCeiling || REP_CEILING_DEFAULT,
        null,
      );
      const symbol = advice.symbol;
      weightHintText = advice.text;
      rpeCell = `<button class="numpad-key numpad-action weight-hint-btn" data-action="weight-hint"><span class="weight-hint-box">${symbol}</span></button>`;
    } else {
      rpeCell = `<button class="numpad-key numpad-action" data-action="rpe">RPE</button>`;
    }
    // Small inline popup (2026-09-18), replacing what used to be a plain
    // native alert() -- tap the badge again to dismiss (same toggle
    // convention as toggleSetType), or tap fully outside the
    // numpad, which already closes the whole panel regardless. Sits in
    // normal flow right above the grid rather than as an absolutely-
    // positioned overlay, so it can't misalign against whichever grid cell
    // the badge happens to be in that render.
    const weightHintPopupHtml = (slot === "weightHint" && weightHintOpen)
      ? `<div class="weight-hint-popup">${escapeHtml(weightHintText)}</div>`
      : "";
    openDockedPanel(`
      ${weightHintPopupHtml}
      <div class="numpad-grid">
        <button class="numpad-key" data-digit="1">1</button>
        <button class="numpad-key" data-digit="2">2</button>
        <button class="numpad-key" data-digit="3">3</button>
        <button class="numpad-key numpad-action numpad-collapse" data-action="collapse" title="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button>
        <button class="numpad-key" data-digit="4">4</button>
        <button class="numpad-key" data-digit="5">5</button>
        <button class="numpad-key" data-digit="6">6</button>
        <span class="numpad-step-pair">
          <button class="numpad-action" data-action="step-down">&minus;</button>
          <button class="numpad-action" data-action="step-up">&plus;</button>
        </span>
        <button class="numpad-key" data-digit="7">7</button>
        <button class="numpad-key" data-digit="8">8</button>
        <button class="numpad-key" data-digit="9">9</button>
        ${rpeCell}
        ${decimalCell}
        <button class="numpad-key" data-digit="0">0</button>
        <button class="numpad-key numpad-action" data-action="backspace">&#9003;</button>
        <button class="numpad-key numpad-action numpad-next" data-action="next">NEXT</button>
      </div>
    `, (target) => {
      // Real bug fixed here (2026-09-18, ImIceTry: "tapping the reps box
      // closes the numpad instead of swapping to it, so I have to tap
      // twice"). openDockedPanel's outside-tap listener runs in the
      // capture phase, ahead of the field's own click handler in
      // app-render.js -- so without this check, tapping this SAME row's
      // OTHER linked field (weight <-> reps/duration) would always close
      // this numpad first, and only THEN would that field's own handler
      // open a brand new session, one tap too late. Recognize that case
      // and just swap this session to the tapped field in place instead.
      // target is undefined for the back-button close path (closeDockedPanelViaNav
      // calls this with no target at all) -- treat that the same as a plain
      // outside tap rather than throwing on target.closest.
      const otherIndex = target ? fields.findIndex((f, i) => i !== fieldIndex &&
        target.closest(`[data-numpad-field="${exerciseName}:${index}:${f.key}"]`)) : -1;
      if (otherIndex !== -1) {
        switchToField(otherIndex);
        return;
      }
      // Same problem, one row over: tapping a DIFFERENT set's own field
      // (e.g. set 1's kg, then set 2's kg) hit the exact same "closes
      // first, one tap too late" issue as the same-row case above -- each
      // row wires its own independent openNumpad call in app-render.js, so
      // there's no shared `fields` array to swap within here. Close below
      // as normal, then re-dispatch a click on that element so its own
      // handler opens a fresh session for it, instead of this capture-phase
      // close silently swallowing the tap that caused it (2026-09-19,
      // ImIceTry's report). null for a genuine outside tap, same as before.
      //
      // Deferred via setTimeout, not called synchronously (2026-09-19,
      // second real bug found in the same fix): calling .click() directly
      // here dispatches a fully synchronous NESTED event while the browser
      // is still partway through dispatching the ORIGINAL click. That
      // nested dispatch's own bubble phase reaches document (where
      // openDockedPanel, called synchronously inside it, had just attached
      // a brand new capture-phase listener for the field that same nested
      // click just opened) -- so the still-unfinished nested dispatch
      // immediately re-triggers that brand new listener's own "outside tap"
      // handling against itself and closes right back. A setTimeout defers
      // the re-click to a genuinely separate task, after both the original
      // and any nested dispatch have fully finished, so there's nothing
      // still-open left to reenter.
      const otherRowFieldEl = target ? target.closest("[data-numpad-field]") : null;
      // Tapping truly outside mid-entry just closes without confirming --
      // same as a native input losing focus, not an accidental-confirm risk
      // (unlike the RPE picker, there's no single "committed value" concept
      // here to commit to; whatever's typed is already visible/preserved
      // via persistTyped() regardless of how the panel closes). onCancel
      // (2026-09-11) lets a caller undo persistTyped's own side effect when
      // that's wrong for this particular field -- a rest-timer edit reuses
      // the same pendingInputByExercise slot a row's real weight/reps
      // typing already occupies, so closing without committing needs to
      // restore that, not just leave the numpad's own scratch value sitting
      // in a KG/REPS row's spot.
      activeNumpadSession = null;
      clearNumpadFieldHighlight();
      closeDockedPanel();
      if (onCancel) onCancel(values);
      if (otherRowFieldEl) {
        // onCancel may redraw the screen (a confirmed set's edit commits
        // there), which replaces otherRowFieldEl with a fresh element -- look
        // the target up again by its key instead of clicking a detached one.
        const targetKey = otherRowFieldEl.getAttribute("data-numpad-field");
        setTimeout(() => {
          const live = otherRowFieldEl.isConnected
            ? otherRowFieldEl
            : [...document.querySelectorAll("[data-numpad-field]")].find((el) => el.getAttribute("data-numpad-field") === targetKey);
          if (live) live.click();
        }, 0);
      }
    });

    dockedPanel.querySelectorAll("[data-digit]").forEach((btn) => {
      btn.addEventListener("click", () => appendDigit(btn.dataset.digit));
    });
    const decimalBtn = dockedPanel.querySelector('[data-action="decimal"]');
    if (decimalBtn) decimalBtn.addEventListener("click", appendDecimal);
    dockedPanel.querySelector('[data-action="backspace"]').addEventListener("click", backspace);
    // A field can override the shared per-key default (e.g. the rest timer
    // edit steps by 30s, not the 1s a logged set's own duration field uses)
    // by carrying its own `step`.
    const step = currentField().step ?? NUMPAD_STEP[currentField().key] ?? 1;
    // A field can also override what +/- actually DOES (2026-09-14, ImIceTry's
    // own report): a live rest timer's +/-30 needs to nudge the real running
    // countdown immediately, same as the notification's own -30s/+30s
    // buttons, not buffer into `values` and wait for NEXT to apply -- that
    // buffered flow is right for a from-scratch typed duration (a bigger,
    // deliberate replace), wrong for "bump by 30s" (a small live tweak).
    // onStep(delta) performs the real side effect and returns the resulting
    // seconds so `values`/the display stay in sync in case NEXT still gets
    // pressed afterward; returning null/undefined skips syncing.
    const runStep = (delta) => {
      const field = currentField();
      if (field.onStep) {
        const resultSeconds = field.onStep(delta);
        if (resultSeconds != null) {
          values[fieldIndex] = field.isDuration ? secondsToMmssBuffer(resultSeconds) : String(resultSeconds);
        }
        updateFieldDisplay();
        return;
      }
      stepValue(delta);
    };
    dockedPanel.querySelector('[data-action="step-down"]').addEventListener("click", () => runStep(-step));
    dockedPanel.querySelector('[data-action="step-up"]').addEventListener("click", () => runStep(step));
    dockedPanel.querySelector('[data-action="next"]').addEventListener("click", goNext);
    // Was "switch to keyboard" (never actually built) -- repurposed into a
    // plain close button (2026-09-10, ImIceTry's own call): whatever's typed
    // is already persisted live via persistTyped, so closing loses nothing.
    dockedPanel.querySelector('[data-action="collapse"]').addEventListener("click", () => {
      activeNumpadSession = null;
      clearNumpadFieldHighlight();
      closeDockedPanel();
      if (onCancel) onCancel(values);
    });
    const rpeBtn = dockedPanel.querySelector('[data-action="rpe"]');
    if (rpeBtn) {
      rpeBtn.addEventListener("click", () => {
        // Opens Phase 2's RPE panel without leaving the numpad flow -- resumes
        // exactly where it left off (same fieldIndex/values) once RPE closes.
        // A finished set's own edit (editConfirmedSetField tags its fields)
        // must write the RPE onto the set itself, not the pending-row store.
        const confirmedOrder = currentField().confirmedSetOrder;
        if (confirmedOrder != null) openRpePickerForConfirmedSet(exerciseName, confirmedOrder, () => render());
        else openRpePicker(exerciseName, index, () => render());
      });
    }
    const weightHintBtn = dockedPanel.querySelector('[data-action="weight-hint"]');
    if (weightHintBtn) {
      weightHintBtn.addEventListener("click", () => {
        weightHintOpen = !weightHintOpen;
        render();
      });
    }
    const skipBtn = dockedPanel.querySelector('[data-action="skip-rest"]');
    if (skipBtn) {
      skipBtn.addEventListener("click", () => {
        activeNumpadSession = null;
        clearNumpadFieldHighlight();
        closeDockedPanel();
        if (onCancel) onCancel(values);
        // Only stop a timer if it's actually this position's own -- editing
        // an idle/historical divider while some other position's timer is
        // live elsewhere shouldn't cancel that unrelated countdown.
        if (restTimerContext && restTimerContext.exerciseName === exerciseName && restTimerContext.position === index) {
          stopRestTimerManually();
        }
      });
    }
  };

  render();
  updateFieldDisplay();
  // refresh: lets a card redraw (a rest timer ending mid-edit) repaint the
  // typed text and the .active highlight, which the redraw otherwise resets
  // to the saved value -- see the end of renderExerciseCard (2026-10-03).
  activeNumpadSession = { exerciseName, index, switchToField, refresh: updateFieldDisplay };
}

// ---------- set-manipulation core: shift positions, set-type toggle, unilateral/side toggle, warm-up ramp, field-mode picker ---------- (moved to app-set-manipulation.js, 2026-09-17)



// ---------- rendering: exercise list order, set-value formatting, rest divider, exercise card ---------- (moved to app-render.js, 2026-09-17)



// ---------- row actions: delete/edit/uncheck a set, swipe-to-delete, elapsed timer, long-press ---------- (moved to app-row-actions.js, 2026-09-17)



// ---------- reorder mode ---------- (moved to app-reorder.js, 2026-09-17)



async function renderActiveScreen(opts = {}) {
  startElapsedTimer();
  const nameInput = document.getElementById("workout-name");
  nameInput.value = activeWorkout.name;
  nameInput.oninput = () => {
    activeWorkout.name = nameInput.value;
    persistActiveWorkout();
  };

  const listEl = document.getElementById("exercise-list");
  listEl.innerHTML = "";

  // Reorder mode (2026-09-12) -- collapses the whole list down to just
  // names + a drag handle, replacing the normal per-exercise cards
  // entirely until Done is tapped. Skips every other render concern below
  // (previous-performance fetches etc. -- nothing in this view needs them).
  if (reorderMode) {
    listEl.innerHTML = `
      <div class="reorder-header">
        <span>Hold and drag to reorder</span>
        <button class="text-link-btn reorder-done-btn">Done</button>
      </div>
      <div id="reorder-rows"></div>
    `;
    listEl.querySelector(".reorder-done-btn").addEventListener("click", () => exitReorderMode(true));
    renderReorderRows();
    document.getElementById("btn-add-exercise-empty").classList.add("hidden");
    document.getElementById("add-exercise-box").classList.add("hidden");
    return;
  }

  // Snapshot-and-clear (2026-09-12, see justConfirmedKey's own comment) --
  // only this one synchronous render pass gets to see it; anything else
  // that calls renderExerciseCard afterward (the async cache-fill re-
  // renders just below, or any future unrelated render) sees it already
  // cleared.
  const justConfirmedThisRender = justConfirmedKey;
  justConfirmedKey = null;

  for (const exerciseName of orderedExerciseList()) {
    const card = document.createElement("div");
    card.className = "exercise-card";
    listEl.appendChild(card);
    // Once per card element: renderExerciseCard runs again on the same card as
    // fetches land, and card-level listeners would stack up on each pass.
    wireExerciseCardRadialSwipe(card, exerciseName);

    const cached = previousFor(exerciseName);
    // See seedDropHistoryFromPrevious's own comment -- needed on this
    // cache-hit path too (re-adding an exercise already fetched once this
    // session skips the .then() below entirely).
    if (cached && cached.sets) seedDropHistoryFromPrevious(exerciseName, cached.sets);
    // Default to weight_reps for the very first paint, before the async
    // fetch below resolves -- matches the schema column's own default, so
    // an exercise that turns out to be 'time'/'reps_only' just re-renders
    // once the real value is known, same pattern as previousData/stickyNote.
    renderExerciseCard(card, exerciseName, cached || null, unitTypeCache[exerciseName] || "weight_reps", justConfirmedThisRender);

    if (!exerciseContextLoaded(exerciseName)) {
      const hadPrevious = exerciseName in previousPerformanceCache;
      fetchExerciseContext(exerciseName).then(() => {
        if (!activeWorkout) return; // finished/discarded while this was in flight
        const data = previousPerformanceCache[exerciseName] || null;
        // Only on the first load of last time's sets, same as before the
        // /context merge -- clearing the variant deletes its key, so running
        // this on every later fetch would quietly re-apply a cleared variant.
        if (!hadPrevious && data && data.sets) {
          // Machine/variant auto-carry-forward (Function Expansion Plan item
          // 3.2): most exercises only ever have one machine, so this should
          // cost zero taps for the common case -- inherit last time's variant
          // automatically rather than asking. Only when nothing's been chosen
          // yet this workout (an explicit choice already made this session
          // always wins).
          if (!activeWorkout.variantByExercise) activeWorkout.variantByExercise = {};
          if (featureEnabled("machineVariant") && !(exerciseName in activeWorkout.variantByExercise)) {
            const lastVariant = data.sets.map((s) => s.variant).find((v) => v);
            if (lastVariant) activeWorkout.variantByExercise[exerciseName] = lastVariant;
          }
          // Start side (left/right first) carries forward the same way.
          if (!activeWorkout.startSideByExercise) activeWorkout.startSideByExercise = {};
          if (featureEnabled("startSide") && !(exerciseName in activeWorkout.startSideByExercise)) {
            const lastSide = data.sets.map((s) => s.side).filter(Boolean).pop();
            if (lastSide) activeWorkout.startSideByExercise[exerciseName] = lastSide;
          }
          // Handle/grip carry forward the same way (2026-10-06).
          if (!activeWorkout.handleByExercise) activeWorkout.handleByExercise = {};
          if (!activeWorkout.gripByExercise) activeWorkout.gripByExercise = {};
          if (featureEnabled("handleGrip") && !(exerciseName in activeWorkout.handleByExercise)) {
            const lastHandle = data.sets.map((s) => s.handle).filter(Boolean).pop(); // last set = where you ended up
            if (lastHandle) activeWorkout.handleByExercise[exerciseName] = lastHandle;
          }
          if (featureEnabled("handleGrip") && !(exerciseName in activeWorkout.gripByExercise)) {
            const lastGrip = data.sets.map((s) => s.grip).filter(Boolean).pop();
            if (lastGrip) activeWorkout.gripByExercise[exerciseName] = lastGrip;
          }
          // Seeded from the machine now selected (the carry-forward above may
          // just have picked it), not from the newest session of any machine.
          const seedFrom = previousFor(exerciseName);
          if (seedFrom && seedFrom.sets) seedDropHistoryFromPrevious(exerciseName, seedFrom.sets);
        }
        renderExerciseCard(card, exerciseName, previousFor(exerciseName), unitTypeCache[exerciseName] || "weight_reps");
      });
    }

    // Warmed here too (2026-09-18), not just at confirm-time PR checking --
    // PR toasts need it at confirm time, and the pending rows' Goal line
    // (2026-09-30) reads it for the next weight up, so the card re-renders
    // once it lands.
    if (!(exerciseName in exerciseHistoryForPrCache)) {
      fetchExerciseHistoryForPr(exerciseName).then(() => {
        if (!activeWorkout) return;
        renderExerciseCard(card, exerciseName, previousFor(exerciseName), unitTypeCache[exerciseName] || "weight_reps");
      });
    }

  }

  // A redraw the user didn't cause (a rest timer ending, 2026-10-03: ImIceTry's
  // report that it closed the add-exercise box mid-search) passes
  // preserveAddBox and leaves an open box -- and what was typed into it -- alone.
  // Every redraw caused by a user action still collapses it as before.
  const keepAddBox = !!opts.preserveAddBox && !document.getElementById("add-exercise-box").classList.contains("hidden");
  if (!keepAddBox) {
    document.getElementById("exercise-input").value = "";
    document.getElementById("exercise-suggestions").classList.add("hidden");
  }

  // The collapsed "Add Exercise" link (originally just the empty-workout
  // state, matching active-workout-empty.jpg) is now the default in every
  // state (2026-09-10, ImIceTry's own call) -- the boxed input always starts
  // hidden and only appears once you tap the link, same reveal-and-focus
  // handler either way. Every render (including right after adding an
  // exercise) resets back to collapsed, so it's always ready for the next add.
  if (!keepAddBox) {
    document.getElementById("btn-add-exercise-empty").classList.remove("hidden");
    document.getElementById("add-exercise-box").classList.add("hidden");
  }
  document.getElementById("btn-finish-top").textContent = buildingTemplateMode
    ? "Save Template"
    : editingWorkoutId != null ? "Save" : "Finish";
  // UI Polish Pass (2026-09-18) -- persistent indicator alongside the
  // button label above, so template-building mode doesn't rely on
  // noticing a renamed button/placeholder alone.
  document.getElementById("building-template-badge").classList.toggle("hidden", !buildingTemplateMode);
}

// position-specific edits (tapping one idle/live/historical divider) live in
// restPositionOverrides, separate from restOverrides (the exercise-wide
// default set via the exercise's own "Rest timer" settings modal) -- so
// editing one set's rest never silently changes what every other set for
// the same exercise previews or uses (2026-09-11, ImIceTry's own call).
function restSecondsFor(exerciseName, position) {
  const posOverrides = activeWorkout.restPositionOverrides && activeWorkout.restPositionOverrides[exerciseName];
  const posOverride = posOverrides ? posOverrides[position] : null;
  if (posOverride != null) return posOverride;
  const exerciseOverride = activeWorkout.restOverrides && activeWorkout.restOverrides[exerciseName];
  if (exerciseOverride != null) return exerciseOverride;
  // Persistent per-exercise default (2026-09-17) sits between the workout-
  // local override above and the app's own hardcoded fallback below -- set
  // once via the exercise's own "Rest timer" modal, applies to every future
  // workout until changed, unlike restOverrides which resets every time.
  const persistentDefault = defaultRestCache[exerciseName];
  return persistentDefault != null ? persistentDefault : REST_SECONDS_DEFAULT;
}

// fields: { weight_kg, reps, duration_sec } -- all optional, unset ones
// default to null. Object shape (not positional args) since which fields
// are meaningful depends on the exercise's unit_type (Phase 3.2 branches
// on this; duration_sec is plumbed through now even though nothing sets it
// yet, so that branch doesn't need another signature change later). index
// is the fixed target position being confirmed (0-based) -- set_order is
// index + 1 directly, not derived from how many are already logged, so any
// row can confirm in any order (Strong-parity, 2026-09-10) without
// stranding whichever ones are still open.
// Real-elapsed-rest capture (2026-09-17, Function Expansion Plan item 1.1):
// restSecondsFor's value is only ever a plan (the timer's target/override),
// known before the rest actually happens -- it can't reflect what really
// occurred (skipped early, run long, timer never started at all). The one
// number that's always true regardless of the timer is the real wall-clock
// gap between this exercise's last confirmed set and the one being confirmed
// now, so patch it onto that prior set once it's knowable. Deriving the
// prior set fresh from activeWorkout.sets on every call (rather than a
// separately-maintained map) makes this automatically correct across
// uncheck/re-confirm, since it only ever reads the array's current state.
const REST_CAPTURE_SANITY_CAP_SEC = 3600; // beyond this, a real pause/interruption is more likely than genuine rest -- leave the original planned value alone rather than record a misleading number.
function captureRealRestOnPriorSet(exerciseName, confirmedAt) {
  const sameExercise = activeWorkout.sets.filter((s) => s.exercise_name === exerciseName);
  const priorSet = sameExercise[sameExercise.length - 1];
  if (!priorSet || !priorSet.logged_at) return;
  const priorTime = new Date(priorSet.logged_at.replace(" ", "T"));
  const elapsedSec = Math.round((confirmedAt - priorTime) / 1000);
  if (elapsedSec >= 0 && elapsedSec <= REST_CAPTURE_SANITY_CAP_SEC) {
    priorSet.rest_after_sec = elapsedSec;
  }
}

function logSet(exerciseName, index, fields) {
  const setOrder = index + 1;
  const restOn = featureEnabled("restTimer");
  const restSeconds = restOn ? restSecondsFor(exerciseName, index) : null;
  const rpe = featureEnabled("rpe") && pendingRpeByExercise[exerciseName] ? pendingRpeByExercise[exerciseName][index] : null;
  const setType = pendingSetTypeByExercise[exerciseName] ? pendingSetTypeByExercise[exerciseName][index] : null;
  const unilateral = isPositionUnilateral(exerciseName, index);
  // Start side is an exercise-wide choice (activeWorkout.startSideByExercise);
  // the per-position map only holds the value of a set reopened for editing.
  const sideOverride = pendingSideByExercise[exerciseName] ? pendingSideByExercise[exerciseName][index] : undefined;
  const side = unilateral ? (sideOverride !== undefined ? sideOverride : ((activeWorkout.startSideByExercise || {})[exerciseName] || null)) : null;
  const assistedReps = setType === "assisted" ? ((pendingAssistedRepsByExercise[exerciseName] || {})[index] ?? null) : null;
  const variantOverride = pendingVariantByExercise[exerciseName] ? pendingVariantByExercise[exerciseName][index] : undefined;
  const variant = variantOverride !== undefined ? variantOverride : ((activeWorkout.variantByExercise || {})[exerciseName] || null);
  const handleGripOverride = pendingHandleGripByExercise[exerciseName] ? pendingHandleGripByExercise[exerciseName][index] : undefined;
  const handle = handleGripOverride !== undefined ? handleGripOverride.handle : ((activeWorkout.handleByExercise || {})[exerciseName] || null);
  const grip = handleGripOverride !== undefined ? handleGripOverride.grip : ((activeWorkout.gripByExercise || {})[exerciseName] || null);
  // Snapshotted from exercise_variant_ratios at log time (2026-09-17), not
  // looked up live later -- see sets.weight_ratio's own comment in db.py
  // for why (a later correction to the saved ratio shouldn't retroactively
  // change what an already-logged set's own PR/1RM math used).
  const weightRatio = variant ? ((variantRatioCache[exerciseName] || {})[variant] ?? 1.0) : 1.0;
  const confirmedAt = new Date();
  captureRealRestOnPriorSet(exerciseName, confirmedAt);
  const newSet = {
    exercise_name: exerciseName,
    set_order: setOrder,
    weight_kg: fields.weight_kg ?? null,
    reps: fields.reps ?? null,
    duration_sec: fields.duration_sec ?? null,
    rest_after_sec: restSeconds,
    notes: "",
    logged_at: fmtDateTime(confirmedAt),
    rpe: rpe ?? null,
    set_type: setType || "normal",
    unilateral,
    variant,
    handle,
    grip,
    side,
    weight_ratio: weightRatio,
    assisted_reps: assistedReps,
  };
  activeWorkout.sets.push(newSet);
  if (pendingRpeByExercise[exerciseName]) delete pendingRpeByExercise[exerciseName][index];
  if (pendingSetTypeByExercise[exerciseName]) delete pendingSetTypeByExercise[exerciseName][index];
  if (pendingVariantByExercise[exerciseName]) delete pendingVariantByExercise[exerciseName][index];
  if (pendingHandleGripByExercise[exerciseName]) delete pendingHandleGripByExercise[exerciseName][index];
  if (pendingUnilateralByExercise[exerciseName]) delete pendingUnilateralByExercise[exerciseName][index];
  if (pendingSideByExercise[exerciseName]) delete pendingSideByExercise[exerciseName][index];
  if (pendingAssistedRepsByExercise[exerciseName]) delete pendingAssistedRepsByExercise[exerciseName][index];
  persistActiveWorkout();
  // See justConfirmedKey's own comment -- marks exactly this row (and its
  // rest divider, which goes idle->live on this same render) as the one
  // that should play its mount animation, not every other already-
  // confirmed row on the screen.
  justConfirmedKey = `${exerciseName}::${setOrder}`;
  // startRestTimer runs before the render now, not after (2026-09-24,
  // Island flakiness fix -- see 01 Daily Logs/[C] Open Items.md ->
  // workout-app-hyperisland-rate-limiting-flaky). The render's own
  // startElapsedTimer -> refreshWorkoutNotificationContent call used to
  // fire BEFORE startRestTimer, while restTimerHandle could still be
  // non-null from whatever the PREVIOUS rest period left it at (this set
  // confirmed before that prior rest naturally expired) but restTimerContext
  // only had a stub {exerciseName, position} with no real remaining/total --
  // posting the Island with a literal "NaN:NaN" body, a real bug caught
  // live in a logcat capture. startRestTimer sets a complete restTimerContext
  // (exerciseName/position included, same fields the render's own
  // isLiveRest divider check needs) and the real restTimerHandle before the
  // render ever runs, so the render's own redundant refresh now always sees
  // correct, identical content and gets skipped by
  // refreshWorkoutNotificationContent's own dedup guard instead of posting
  // garbage.
  if (restOn) startRestTimer(exerciseName, index, restSeconds);
  renderActiveScreen();
  // Deferred one tick, not called synchronously (2026-09-17 fix, found live):
  // the numpad's own goNext() calls closeDockedPanel() -- which fires an
  // async history.back() -- immediately before onDone(values) reaches this
  // function. openModal()'s synchronous history.pushState() racing that
  // pending back-navigation desyncs the nav-layer stack exactly the way
  // this project's own "Save workout" dialog bug did in Session 2
  // (2026-09-16) -- confirmed live: the hint modal silently never appeared
  // at all when triggered through the real numpad flow, despite working
  // fine when called directly. setTimeout queues this as a new macrotask
  // strictly after the already-queued popstate task from that back(), so
  // the nav-layer stack has always finished settling by the time this runs.
  setTimeout(() => checkForLogAnomaly(exerciseName, newSet), 0);
  // No nav-layer/history interaction at all here (unlike the anomaly hint
  // above) -- a PR is purely celebratory, nothing to decide, so a plain
  // auto-dismissing toast is both the right UX and sidesteps that whole
  // class of bug entirely. Safe to call directly, no setTimeout needed.
  checkForPr(exerciseName, newSet);
}

// ---------- log-time anomaly hint, PR celebration ---------- (moved to app-pr-anomaly.js, 2026-09-17)



// ---------- add exercise / autocomplete, template builder ---------- (moved to app-add-exercise.js, 2026-09-17)



// ---------- rest timer, rest/workout notifications ---------- (moved to app-rest-timer.js, 2026-09-17)



// ---------- finish / save workout ---------- (moved to app-finish.js, 2026-09-17)



// "Add Exercise" link (now the default collapsed state everywhere, not just
// empty-workout): reveal the real input immediately (don't wait for a
// re-render, since typing text doesn't commit an exercise yet) and focus it.
document.getElementById("btn-add-exercise-empty").addEventListener("click", () => {
  document.getElementById("btn-add-exercise-empty").classList.add("hidden");
  document.getElementById("add-exercise-box").classList.remove("hidden");
  document.getElementById("exercise-input").focus();
  showExerciseSuggestions(""); // nothing typed yet: offer recently/often done exercises
});

// ---------- history screen ---------- (moved to app-history.js, 2026-09-17)



// ---------- settings, account details/bodyweight ---------- (moved to app-settings.js, 2026-09-17)



// ---------- exercises tab ---------- (moved to app-exercises.js, 2026-09-17)
// ---------- exercise detail page ---------- (moved to app-exercises.js, 2026-09-17)



// ---------- profile tab, sync queue wiring ---------- (moved to app-profile.js, 2026-09-17)


// ---------- boot ----------

(function boot() {
  document.getElementById("app-version").textContent = `v${APP_VERSION}+${BUILD_ID}`;
  restoreActiveWorkout();

  // Reopens on whichever bottom-nav tab was last showing, not always Home --
  // set directly (bypassing showScreen's overlay special-case and its own
  // localStorage write) so there's a sensible tab to land on once an
  // in-progress workout's overlay collapses, then open the overlay on top of
  // it if a workout was actually restored. Only the 5 real tab names are
  // ever trusted here -- anything else (a stale/corrupt value) falls back
  // to Home rather than failing to find a matching screen element.
  const VALID_SCREENS = ["home", "history", "exercises", "profile", "statistics"];
  const lastScreen = localStorage.getItem("lastScreen");
  const initialScreen = VALID_SCREENS.includes(lastScreen) ? lastScreen : "home";

  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  const initialScreenEl = document.getElementById(`screen-${initialScreen}`);
  initialScreenEl.classList.remove("hidden");
  document.querySelectorAll(".nav-tab").forEach((el) => el.classList.toggle("active", el.dataset.screen === initialScreen));
  // Same reasoning as showScreen's own reset: browsers restore the previous
  // scroll position on reload by default (history.scrollRestoration
  // defaults to "auto"), and setupCollapsingTitle below calibrates its
  // shrink range from wherever the header actually is right now -- so
  // reopening the app mid-scroll on whatever screen was last open would
  // otherwise permanently miscalibrate that screen for the rest of the
  // session (until its next tab switch, which does reset).
  window.scrollTo(0, 0);
  setupCollapsingTitle(initialScreenEl);
  if (initialScreen === "home") renderHomeScreen();
  if (initialScreen === "history") renderHistoryScreen();
  if (initialScreen === "exercises") renderExercisesScreen();
  if (initialScreen === "profile") renderProfileScreen();
  if (initialScreen === "statistics") loadGrafanaSnapshots();

  if (activeWorkout) {
    showActiveWorkoutOverlay();
  }
  updatePendingBadge();
  flushQueue();

  // Service worker (2026-09-12) -- makes the PWA properly installable (a
  // fetch-handling SW is part of the standard install criteria most
  // browsers check) and gives the app shell an offline fallback. Never
  // caches /api/ responses -- see sw.js's own comment.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(`sw.js?build=${encodeURIComponent(BUILD_ID)}`).catch(() => {
      // Registration can fail on e.g. a non-HTTPS origin during local dev --
      // the app works fine without it, just without the installability/
      // offline-shell benefits, so this is deliberately silent.
    });
  }
})();
