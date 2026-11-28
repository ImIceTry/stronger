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

// -- the open search is a layer of its own (2026-11-28, ImIceTry: "it's as
// high as it gets on screen and you can't close it with the back button") --
// Opening it moves the box to the top of the workout screen with the list
// filling the room below (it used to hang off the page's last row, half
// behind the keyboard or the phone's buttons), and registers a nav layer, so
// the back button / back gesture or a tap anywhere else closes just the search
// instead of folding the whole workout away.

const addExerciseBox = document.getElementById("add-exercise-box");
let addSearchOutsideTap = null;

function addSearchOpen() {
  return addExerciseBox.classList.contains("searching");
}

// The box takes the overlay body's full visible height while searching, so
// the body can always scroll it to the top, however little sits below it.
function fitAddSearch() {
  if (!addSearchOpen() || !activeOverlayBody) return;
  addExerciseBox.style.setProperty("--add-search-h", activeOverlayBody.clientHeight - 24 + "px");
  const delta = addExerciseBox.getBoundingClientRect().top - activeOverlayBody.getBoundingClientRect().top - 8;
  activeOverlayBody.scrollTop += delta;
}

function openAddExerciseSearch() {
  document.getElementById("btn-add-exercise-empty").classList.add("hidden");
  addExerciseBox.classList.remove("hidden");
  exerciseInput.focus();
  showExerciseSuggestions(""); // nothing typed yet: offer recently/often done exercises
  if (addSearchOpen()) return;
  addExerciseBox.classList.add("searching");
  fitAddSearch();
  pushNavLayer(closeAddExerciseSearchViaNav);
  // A tap outside the box closes the search; the tap itself still goes through.
  addSearchOutsideTap = (e) => {
    if (!addExerciseBox.contains(e.target)) closeAddExerciseSearch();
  };
  document.addEventListener("click", addSearchOutsideTap, true);
  window.addEventListener("resize", fitAddSearch); // the keyboard opening or closing
}

// Leaves searching mode only (layout, listeners, the nav layer); callers decide
// whether the box itself collapses. Direct closes consume their own history
// entry like closeDockedPanel does; a back press (handlingPopstate) already did.
function endAddExerciseSearch() {
  if (!addSearchOpen()) return;
  addExerciseBox.classList.remove("searching");
  addExerciseBox.style.removeProperty("--add-search-h");
  if (addSearchOutsideTap) document.removeEventListener("click", addSearchOutsideTap, true);
  addSearchOutsideTap = null;
  window.removeEventListener("resize", fitAddSearch);
  const top = navLayers[navLayers.length - 1];
  if (top && top.onClose === closeAddExerciseSearchViaNav) {
    navLayers.pop();
    if (!handlingPopstate) history.back();
  }
}

function closeAddExerciseSearch() {
  endAddExerciseSearch();
  exerciseInput.value = "";
  exerciseInput.blur();
  suggestionsEl.classList.add("hidden");
  addExerciseBox.classList.add("hidden");
  document.getElementById("btn-add-exercise-empty").classList.remove("hidden");
}

function closeAddExerciseSearchViaNav() {
  closeAddExerciseSearch();
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
    if (activeWorkout.editTemplateId != null) {
      await saveEditedTemplate(name, exerciseNames);
    } else {
      await apiPost("/api/templates/scratch", { name, exercise_names: exerciseNames });
    }
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
