// Fold a finished exercise to one line (switch "collapseDone").
//
// Once every set row of an exercise is logged, its card shows only the name
// and a summary ("✓ 3 sets  90×9  85×7  80×9"). The finished work stays
// readable, the boundary to the next exercise is obvious, and the workout
// gets shorter to scroll as it goes. Tapping the folded card (summary or name)
// opens the sets again; an up-arrow next to ⋯ folds it back.
//
// It stays open while its rest timer runs or the numpad is editing it, so the
// timer you are watching never disappears, and it never folds while editing a
// saved workout or building a template, where every row is there to be changed.
// Called at the end of every renderExerciseCard pass, which rebuilds the card.

// Both sets are per workout: opened by a tap, and folded with the up-arrow.
// A choice the user made wins over the automatic "stay open" below.
const expandedFinishedExercises = new Set();
const foldedByUser = new Set();
let expandedFinishedFor = null; // which workout the sets above belong to

function collapseFinishedExercise(card, exerciseName) {
  if (!activeWorkout || buildingTemplateMode || editingWorkoutId != null) return;
  if (expandedFinishedFor !== activeWorkout.started_at) {
    expandedFinishedExercises.clear();
    foldedByUser.clear();
    expandedFinishedFor = activeWorkout.started_at;
  }
  if (!finishedRows(card)) return;

  // Finished but open (opened by a tap, or held open by its rest timer or the
  // numpad): an up-arrow next to ⋯ folds it on request.
  const holdOpen = expandedFinishedExercises.has(exerciseName)
    || (!foldedByUser.has(exerciseName)
      && ((activeNumpadSession && activeNumpadSession.exerciseName === exerciseName)
        || card.querySelector(".rest-divider.live")));
  if (holdOpen) addFoldButton(card, exerciseName);
  else foldCard(card, exerciseName);
}

// The logged rows when every set row is logged, else null.
function finishedRows(card) {
  const rows = [...card.querySelectorAll(".set-row")];
  const done = rows.filter((r) => r.classList.contains("confirmed"));
  return rows.length && done.length === rows.length ? done : null;
}

function addFoldButton(card, exerciseName) {
  if (card.querySelector("h3 .fold-btn")) return;
  const btn = document.createElement("button");
  btn.className = "icon-btn fold-btn";
  btn.title = "Fold";
  btn.setAttribute("aria-label", `Fold ${exerciseName}`);
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 15l6-6 6 6"/></svg>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    expandedFinishedExercises.delete(exerciseName);
    foldedByUser.add(exerciseName);
    btn.remove();
    foldCard(card, exerciseName);
  });
  card.querySelector("h3 .options-btn").before(btn);
}

function foldCard(card, exerciseName) {
  const done = finishedRows(card);
  if (!done) return;
  const chips = done.map((row) => {
    const kg = (row.querySelector(".col-kg")?.textContent || "").trim();
    const second = (row.querySelector(".col-reps")?.textContent || "").trim();
    return kg && kg !== "-" && kg !== "0" ? `${kg}×${second}` : second;
  });
  const summary = document.createElement("button");
  summary.className = "done-summary";
  summary.setAttribute("aria-label", `${exerciseName}: ${done.length} sets done, show the sets`);
  summary.innerHTML =
    `<span class="done-summary-count">✓ ${done.length} ${done.length === 1 ? "set" : "sets"}</span>` +
    chips.map((c) => `<span class="done-summary-chip">${escapeHtml(c)}</span>`).join("");
  card.querySelector("h3").after(summary);
  card.classList.add("collapsed-done");
  card.dataset.foldedExercise = exerciseName;
  wireFoldedCardTap(card);
}

// While folded, a tap anywhere on the card (the name included, which would
// otherwise open the exercise's history outside the workout) opens the sets
// first. Only the ⋯ menu keeps its own action. Capture phase, so it runs
// before the name's own handler; wired once, because the card element is
// reused by every renderExerciseCard pass.
function wireFoldedCardTap(card) {
  if (card.dataset.foldTapWired) return;
  card.dataset.foldTapWired = "1";
  card.addEventListener("click", (e) => {
    if (!card.classList.contains("collapsed-done")) return;
    if (e.target.closest(".options-btn")) return;
    e.preventDefault();
    e.stopPropagation();
    const exerciseName = card.dataset.foldedExercise;
    expandedFinishedExercises.add(exerciseName);
    foldedByUser.delete(exerciseName);
    card.classList.remove("collapsed-done");
    const summary = card.querySelector(".done-summary");
    if (summary) summary.remove();
    addFoldButton(card, exerciseName);
  }, true);
}
