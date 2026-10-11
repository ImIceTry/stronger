// ---------- add exercise / autocomplete, template builder (moved from app.js, 2026-09-17) ----------

// -- add exercise / autocomplete --

let suggestTimer = null;
const exerciseInput = document.getElementById("exercise-input");
const suggestionsEl = document.getElementById("exercise-suggestions");

// Forgiving, usage-ranked matching (app-exercise-search.js) over the cached
// exercise list; with nothing typed it offers the exercises done most
// recently/often. Falls back to the server's plain substring search only if
// the list can't be loaded.
async function showExerciseSuggestions(q) {
  try {
    const all = await loadAllExercisesCached();
    if (exerciseInput.value.trim() !== q) return; // typed further while the list loaded
    renderSuggestions(rankExercises(q, all, q ? 20 : 8).map((e) => e.name));
  } catch (err) {
    if (!q) {
      suggestionsEl.classList.add("hidden");
      return;
    }
    try {
      const data = await apiGet(`/api/exercises?q=${encodeURIComponent(q)}`);
      if (exerciseInput.value.trim() === q) renderSuggestions(data.exercises);
    } catch (err2) {
      suggestionsEl.classList.add("hidden");
    }
  }
}

exerciseInput.addEventListener("input", () => {
  clearTimeout(suggestTimer);
  const q = exerciseInput.value.trim();
  suggestTimer = setTimeout(() => showExerciseSuggestions(q), 120);
});

exerciseInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const name = exerciseInput.value.trim();
    if (name) addExerciseToWorkout(name);
  }
});

function renderSuggestions(names) {
  if (!names.length) {
    suggestionsEl.classList.add("hidden");
    return;
  }
  suggestionsEl.innerHTML = "";
  names.forEach((name) => {
    const div = document.createElement("div");
    div.textContent = name;
    div.addEventListener("click", () => addExerciseToWorkout(name));
    suggestionsEl.appendChild(div);
  });
  suggestionsEl.classList.remove("hidden");
}

function addExerciseToWorkout(name) {
  if (!activeWorkout.exercises.includes(name)) {
    activeWorkout.exercises.push(name);
    persistActiveWorkout();
  }
  renderActiveScreen();
}

// Home screen "+" (2026-09-10) -- opens the exact same exercise-picker
// overlay a blank workout uses (ImIceTry's own call: build it like starting a
// workout), just flagged as template-building so Finish becomes Save
// Template instead of logging a real session. Starts with an empty name
// (not the usual "Workout" default) since a template needs its own real name.
async function startTemplateBuilder() {
  if (blockIfWorkoutRunning("building a template")) return;
  await startWorkout(null);
  buildingTemplateMode = true;
  activeWorkout.name = "";
  document.getElementById("workout-name").placeholder = "Template name";
  renderActiveScreen();
}

// Sends only the exercise list -- never touches workouts/sets, so a
// template being built can't pollute real training history/stats even
// though it reuses that same logging UI. Any sets someone happens to type
// in while building are silently discarded; only activeWorkout.exercises
// (the ordered, deduped exercise list) is sent.
async function saveAsTemplate() {
  const name = (activeWorkout.name || "").trim();
  if (!name) {
    alert("Give this template a name first.");
    return;
  }
  const exerciseNames = orderedExerciseList();
  if (exerciseNames.length === 0) {
    alert("Add at least one exercise before saving.");
    return;
  }
  try {
    await apiPost("/api/templates/scratch", { name, exercise_names: exerciseNames });
  } catch (err) {
    alert("Couldn't save this template (offline?). Try again once you have signal.");
    return;
  }
  activeWorkout = null;
  buildingTemplateMode = false;
  persistActiveWorkout();
  hideActiveWorkoutOverlay();
  showScreen("home");
}
