// Fold a finished exercise to one line (switch "collapseDone").
//
// Once every set row of an exercise is logged, its card shows only the name
// and a summary ("✓ 3 sets  90×9  85×7  80×9"). The finished work stays
// readable, the boundary to the next exercise is obvious, and the workout
// gets shorter to scroll as it goes. Tapping the summary opens the sets again
// for the rest of this workout.
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
  summary.addEventListener("click", () => {
    expandedFinishedExercises.add(exerciseName);
    card.classList.remove("collapsed-done");
    summary.remove();
  });
  card.querySelector("h3").after(summary);
  card.classList.add("collapsed-done");
}
