// Filter chips on an exercise's History tab (machine / cable handle), and the
// preselection when the tab is opened from a workout's exercise name. Filters
// only the History list: Charts and Records still use every session.
// Behind the "historyFilter" switch.

// {name, machine, handle}: null = no filter; "" = the sets logged without one.
let exerciseHistoryFilter = { name: null, machine: null, handle: null };

// What the workout has selected for this exercise, as the starting filter.
function historyFilterFromWorkout(exerciseName) {
  const filter = {};
  if (!activeWorkout) return filter;
  if (featureEnabled("machineVariant")) filter.machine = (activeWorkout.variantByExercise || {})[exerciseName] || "";
  if (featureEnabled("handleGrip") && exerciseSupportsHandles(exerciseName)) {
    filter.handle = (activeWorkout.handleByExercise || {})[exerciseName] || "";
  }
  return filter;
}

function setExerciseHistoryFilter(name, preset) {
  exerciseHistoryFilter = { name, machine: null, handle: null, ...(featureEnabled("historyFilter") ? preset || {} : {}) };
}

function historyFilterValues(sessions, key) {
  const seen = new Set();
  sessions.forEach((session) => session.sets.forEach((s) => seen.add(s[key] || "")));
  return [...seen];
}

// Drops a preselected value this exercise has no history for, so the list
// never opens empty because of it.
function historyFilterPrune(sessions) {
  ["machine", "handle"].forEach((kind) => {
    const key = kind === "machine" ? "variant" : "handle";
    if (exerciseHistoryFilter[kind] != null && !historyFilterValues(sessions, key).includes(exerciseHistoryFilter[kind])) {
      exerciseHistoryFilter[kind] = null;
    }
  });
}

function applyHistoryFilter(sessions) {
  const { machine, handle } = exerciseHistoryFilter;
  if (machine == null && handle == null) return sessions;
  return sessions
    .map((session) => ({
      ...session,
      sets: session.sets.filter((s) => (machine == null || (s.variant || "") === machine) && (handle == null || (s.handle || "") === handle)),
    }))
    .filter((session) => session.sets.length);
}

// One row of chips per kind, shown only when the history has two or more values for it.
function historyFilterChipsHtml(sessions) {
  const rows = [["machine", "variant", "Machine"], ["handle", "handle", "Handle"]].map(([kind, key, label]) => {
    if (kind === "handle" && !exerciseSupportsHandles(exerciseDetailCurrentName)) return "";
    const values = historyFilterValues(sessions, key);
    if (values.length < 2) return "";
    const chip = (value, text) => `<button type="button" class="machine-variant-tag${exerciseHistoryFilter[kind] === value ? " selected" : ""}" data-history-filter="${kind}" data-value="${escapeHtml(value == null ? "" : value)}" data-all="${value == null ? 1 : 0}">${escapeHtml(text)}</button>`;
    const chips = [chip(null, "All"), ...values.sort().map((v) => chip(v, v || "None"))].join("");
    return `<div class="machine-variant-chips" aria-label="${label}">${chips}</div>`;
  });
  return rows.join("");
}

function wireHistoryFilterChips(panel, reload) {
  panel.querySelectorAll("[data-history-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      exerciseHistoryFilter[btn.dataset.historyFilter] = btn.dataset.all === "1" ? null : btn.dataset.value;
      reload();
    });
  });
}
