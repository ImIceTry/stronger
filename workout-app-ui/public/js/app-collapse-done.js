// Fold a finished exercise to one line (switch "collapseDone").
//
// Once every set row of an exercise is logged, its card shows only the name
// and a summary ("✓ 3 sets  90×9  85×7  80×9"). The finished work stays
// readable, the boundary to the next exercise is obvious, and the workout
// gets shorter to scroll as it goes. Tapping the folded card (summary or name)
// opens the sets again for the rest of this workout.
//
// It stays open while its rest timer runs or the numpad is editing it, so the
// timer you are watching never disappears, and it never folds while editing a
// saved workout or building a template, where every row is there to be changed.
// Called at the end of every renderExerciseCard pass, which rebuilds the card.

const expandedFinishedExercises = new Set();
let expandedFinishedFor = null; // which workout the set above belongs to

function collapseFinishedExercise(card, exerciseName) {
  if (!activeWorkout || buildingTemplateMode || editingWorkoutId != null) return;
  if (expandedFinishedFor !== activeWorkout.started_at) {
    expandedFinishedExercises.clear();
    expandedFinishedFor = activeWorkout.started_at;
  }
  if (expandedFinishedExercises.has(exerciseName)) return;
  if (activeNumpadSession && activeNumpadSession.exerciseName === exerciseName) return;
  if (card.querySelector(".rest-divider.live")) return;

  const rows = [...card.querySelectorAll(".set-row")];
  const done = rows.filter((r) => r.classList.contains("confirmed"));
  if (!rows.length || done.length !== rows.length) return;

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
    expandedFinishedExercises.add(card.dataset.foldedExercise);
    card.classList.remove("collapsed-done");
    const summary = card.querySelector(".done-summary");
    if (summary) summary.remove();
  }, true);
}
