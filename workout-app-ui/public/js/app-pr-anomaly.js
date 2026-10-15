// ---------- log-time anomaly hint, PR celebration (moved from app.js, 2026-09-17) ----------

// Log-time anomaly hint (2026-09-17, Function Expansion Plan item 1.2) --
// every one of Preacher Curl-one-handed, Leg Extension #252, and similar
// real data corrections this project has done by hand took a full session
// to find *months* after the fact, despite being detectable the instant
// they were logged as "this set is far below your own trend." Targets
// specifically the sudden-weight-crash pattern (not e.g. a name mixup like
// Leg Press/Seated Leg Press, which looks like a perfectly normal set for
// the wrong exercise and has no weight signal to key off at all) -- a soft,
// dismissible hint at the moment of entry rather than blocking the log.
const ANOMALY_DROP_THRESHOLD = 0.65; // below 65% of the recent bilateral baseline

function checkForLogAnomaly(exerciseName, set) {
  if (!featureEnabled("anomalyHint")) return;
  if (set.weight_kg == null) return; // reps-only/time exercises have no weight to compare
  if (set.unilateral || set.set_type !== "normal") return; // already self-explained -- don't nag
  const prev = previousPerformanceCache[exerciseName];
  if (!prev || !prev.sets || !prev.sets.length) return;
  // Bilateral-only baseline, same reasoning records.py's own prefer-
  // bilateral-else-unilateral fallback uses -- comparing a real two-handed
  // number against an always-unilateral exercise's history would flag
  // every single set of it as an anomaly.
  const bilateralWeights = prev.sets
    .filter((s) => !s.unilateral && s.set_type !== "warmup" && s.set_type !== "failure" && s.set_type !== "assisted" && s.weight_kg != null)
    .map((s) => s.weight_kg);
  if (!bilateralWeights.length) return;
  const baseline = bilateralWeights.reduce((a, b) => a + b, 0) / bilateralWeights.length;
  if (baseline > 0 && set.weight_kg < baseline * ANOMALY_DROP_THRESHOLD) {
    showAnomalyHint(exerciseName, set, baseline);
  }
}

function showAnomalyHint(exerciseName, set, baseline) {
  const baselineDisplay = Math.round(baseline * 10) / 10;
  openModal(`
    <h3>${escapeHtml(exerciseName)}: ${set.weight_kg}kg looks low</h3>
    <p class="modal-hint">Last time's working weight was around ${baselineDisplay}kg. If there's a real reason, tag it now instead of finding it months later:</p>
    <div class="exercise-row" data-action="unilateral">One-handed / one-legged this time</div>
    <div class="exercise-row" data-action="machine">Different machine/variant</div>
    <div class="exercise-row" data-action="warmup">Actually a warm-up</div>
    <div class="exercise-row" data-action="keep">Keep as is &mdash; real number</div>
  `);
  modalContent.classList.add("size-comfortable"); // UI Polish Pass 2026-09-18
  modalContent.querySelector('[data-action="unilateral"]').addEventListener("click", () => {
    set.unilateral = true;
    persistActiveWorkout();
    closeTopNavLayer();
    renderActiveScreen();
  });
  modalContent.querySelector('[data-action="machine"]').addEventListener("click", () => {
    // closeModal() (sync), not closeTopNavLayer() (async history.back()) --
    // this chains straight into another openModal() call, and racing that
    // against a pending back-navigation is the exact nav-layer-desync bug
    // this same item already found and fixed once for the hint's own
    // openModal() call (2026-09-17). Found here on a second pass, not live
    // in production before a session caught it: the "Create superset" menu
    // row already established closeModal() as the safe pattern for this
    // exact "close one modal, immediately open another" shape.
    closeModal();
    openMachineVariantModal(exerciseName);
  });
  modalContent.querySelector('[data-action="warmup"]').addEventListener("click", () => {
    set.set_type = "warmup";
    persistActiveWorkout();
    closeTopNavLayer();
    renderActiveScreen();
  });
  modalContent.querySelector('[data-action="keep"]').addEventListener("click", () => {
    closeTopNavLayer();
  });
}

// PR celebration on confirm (2026-09-17, Function Expansion Plan item 2.7) --
// records.flag_session_prs already computes exactly this (is_pr_1rm/
// is_pr_weight/is_pr_volume) for the History tab's own trophy pills, but
// only when that tab is later opened -- nothing surfaces it live at the
// moment it actually happens. computePriorBestForLane is a client-side
// replica of that same function's running-best algorithm (same skip rules --
// no failure/warmup, no weight/reps means no comparison -- and the same
// separate bilateral/unilateral lanes, so a live celebration here can never
// disagree with what the History tab shows for the same set once it's
// fetched fresh) run against /history, which reflects the database as of
// before this workout synced -- exactly the right "prior best" baseline,
// no filtering needed to exclude the just-confirmed set since it isn't in
// the database yet.
// Also warmed proactively per exercise (renderActiveScreen, app.js) and
// read synchronously by the numpad's weight-hint badge (2026-09-18) --
// "best reps ever at this exact weight" needs the same full history this
// cache already holds, so it reuses it rather than fetching twice.
let exerciseHistoryForPrCache = {};

async function fetchExerciseHistoryForPr(exerciseName) {
  if (exerciseName in exerciseHistoryForPrCache) return exerciseHistoryForPrCache[exerciseName];
  try {
    const data = await apiGet(`/api/exercises/${encodeURIComponent(exerciseName)}/history`);
    exerciseHistoryForPrCache[exerciseName] = data.sessions;
    return data.sessions;
  } catch (err) {
    exerciseHistoryForPrCache[exerciseName] = [];
    return [];
  }
}

function computePriorBestForLane(sessions, unilateral) {
  let best1rm = 0;
  let bestWeight = 0;
  let bestVolume = 0;
  sessions.slice().reverse().forEach((session) => { // oldest-first, matching flag_session_prs' own walk order
    session.sets.forEach((s) => {
      if (s.weight_kg == null || s.reps == null || s.set_type === "failure" || s.set_type === "warmup" || s.set_type === "assisted") return;
      if (!!s.unilateral !== unilateral) return; // separate lanes, never mixed -- same reasoning as flag_session_prs
      // Effective weight (raw * weight_ratio), matching records.py's own
      // flag_session_prs -- a live PR toast can never disagree with what
      // the History tab's trophy pills show later for the same set only
      // if both compute the same effective number (2026-09-17).
      const weight = s.weight_kg * (s.weight_ratio ?? 1);
      const e1rm = Math.round(weight * (1 + s.reps / 30) * 10) / 10;
      const volume = weight * s.reps;
      if (e1rm > best1rm) best1rm = e1rm;
      if (weight > bestWeight) bestWeight = weight;
      if (volume > bestVolume) bestVolume = volume;
    });
  });
  return { best1rm, bestWeight, bestVolume };
}

async function checkForPr(exerciseName, set) {
  if (!featureEnabled("prToast")) return;
  if (set.weight_kg == null || set.reps == null || set.set_type === "failure" || set.set_type === "warmup" || set.set_type === "assisted") return;
  // Earlier sets of this same workout are prior bests too (2026-09-30), the
  // way flag_session_prs' oldest-first walk treats them -- without this,
  // repeating a PR weight on the next set toasted a second "New PR" that the
  // History tab never shows. Captured before the await so a set confirmed
  // while history is still loading can't count as "earlier".
  const earlierThisWorkout = activeWorkout
    ? activeWorkout.sets.filter((s) => s.exercise_name === exerciseName && s !== set)
    : [];
  const sessions = await fetchExerciseHistoryForPr(exerciseName);
  const prior = computePriorBestForLane([{ sets: earlierThisWorkout }, ...sessions], !!set.unilateral);
  const weight = set.weight_kg * (set.weight_ratio ?? 1);
  const e1rm = Math.round(weight * (1 + set.reps / 30) * 10) / 10;
  const volume = weight * set.reps;
  const hits = [];
  if (e1rm > prior.best1rm) hits.push("1RM");
  if (weight > prior.bestWeight) hits.push("Weight");
  if (volume > prior.bestVolume) hits.push("Vol.");
  if (hits.length) showPrToast(exerciseName, hits);
}

// Plain auto-dismissing toast, not a modal/docked-panel -- there's nothing
// to decide here, so no reason to touch the nav-layer/history stack at all
// (the anomaly hint above needs a real decision, hence the modal there).
function showPrToast(exerciseName, hits) {
  const toast = document.createElement("div");
  toast.className = "pr-toast";
  toast.innerHTML = `<strong>New PR</strong> &mdash; ${escapeHtml(exerciseName)}: ${hits.join(" / ")}`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 2400);
}
