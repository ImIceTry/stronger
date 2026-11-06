// ---------- share on finish (feature "shareOnFinish", off by default) ----------
// A Share button on the finish summary, before the workout is saved. Same text
// and same share sheet / clipboard fallbacks as the Share button on a saved
// workout (buildWorkoutShareText and shareWorkoutText in app-history.js).

// Called by showFinishSummary (app-finish.js) once its modal is on screen.
function addFinishShareButton(durationSec, unitTypeByExercise, totalVolume) {
  if (!featureEnabled("shareOnFinish")) return;
  const footer = modalContent.querySelector(".modal-full-footer");
  if (!footer || footer.querySelector("#finish-summary-share")) return;
  const btn = document.createElement("button");
  btn.id = "finish-summary-share";
  btn.type = "button";
  btn.className = "btn-secondary finish-share-btn";
  btn.textContent = "Share";
  btn.addEventListener("click", () => {
    const w = {
      name: activeWorkout.name,
      started_at: activeWorkout.started_at,
      duration_sec: durationSec,
      sets: activeWorkout.sets,
    };
    shareWorkoutText(w.name, buildWorkoutShareText(w, unitTypeByExercise, totalVolume));
  });
  footer.insertBefore(btn, footer.firstChild);
}
