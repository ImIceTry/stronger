// ---------- warm-up ramp (feature "warmupRamp", off by default) ----------
// "Add warm-up sets" in the exercise menu: from the weight you are about to
// work with, adds a few lighter sets tagged as warm-ups in front of the first
// set. They are ordinary pending rows (prefilled, not confirmed), so each one
// is checked off, edited or swiped away like any other. Only offered before
// anything is logged for the exercise.

// [share of the working weight, reps]
const WARMUP_STEPS = [[0.4, 5], [0.6, 3], [0.8, 2]];
const WARMUP_ROUND_KG = 2.5;
// Below this a non-barbell exercise needs no ramp at all.
const WARMUP_MIN_KG = 30;

// Pure: the warm-up sets for a working weight. `bar` is the empty bar for a
// barbell exercise (0 otherwise): no set goes below it, and a barbell
// exercise whose steps all collapse still gets one set on the empty bar.
function warmupRampSets(working, opts) {
  const w = Number(working);
  const bar = (opts && opts.bar) || 0;
  const step = (opts && opts.step) || WARMUP_ROUND_KG;
  if (!isFinite(w) || w <= 0) return [];
  if (!bar && w < WARMUP_MIN_KG) return [];
  const floor = bar || step;
  const out = [];
  WARMUP_STEPS.forEach(([share, reps]) => {
    let kg = Math.round((w * share) / step) * step;
    if (kg < floor) kg = floor;
    if (kg >= w) return; // never warm up at or above the working weight
    if (out.length && kg <= out[out.length - 1].weight_kg) return; // always climbing
    out.push({ weight_kg: Math.round(kg * 100) / 100, reps });
  });
  if (!out.length && bar && w > bar) out.push({ weight_kg: bar, reps: 8 });
  return out;
}

// Heaviest non-warm-up weight from last time on the selected machine, or null.
function warmupWorkingWeightFromHistory(exerciseName) {
  const prev = typeof previousFor === "function" ? previousFor(exerciseName) : null;
  const weights = ((prev && prev.sets) || [])
    .filter((s) => s.set_type !== "warmup" && s.weight_kg != null)
    .map((s) => s.weight_kg);
  return weights.length ? Math.max(...weights) : null;
}

function exerciseHasLoggedSets(exerciseName) {
  return activeWorkout.sets.some((s) => s.exercise_name === exerciseName);
}

// Opens `sets.length` new positions in front of the first one, with the same
// helpers a drop set's continuation row uses, so previous-performance numbers
// keep pointing at the right historical set, then fills them in.
function insertWarmupSets(exerciseName, sets) {
  const count = sets.length;
  if (!count || exerciseHasLoggedSets(exerciseName)) return false;
  const prev = previousFor(exerciseName);
  const prevCount = prev && prev.sets ? prev.sets.length : 0;
  let total = Math.max(prevCount, 1) + (extraSetsByExercise[exerciseName] || 0);
  for (let k = 0; k < count; k++) {
    shiftHistoricalIndexMap(exerciseName, -1, 1, total);
    shiftPositionsAfter(exerciseName, -1, 1);
    total += 1;
  }
  extraSetsByExercise[exerciseName] = (extraSetsByExercise[exerciseName] || 0) + count;
  if (!pendingInputByExercise[exerciseName]) pendingInputByExercise[exerciseName] = {};
  if (!pendingSetTypeByExercise[exerciseName]) pendingSetTypeByExercise[exerciseName] = {};
  sets.forEach((s, i) => {
    pendingInputByExercise[exerciseName][i] = { weight: String(s.weight_kg), reps: String(s.reps) };
    pendingSetTypeByExercise[exerciseName][i] = "warmup";
  });
  persistActiveWorkout();
  renderActiveScreen();
  return true;
}

function warmupPreviewText(working, bar) {
  const sets = warmupRampSets(working, { bar });
  if (!sets.length) {
    return Number(working) > 0 ? "No warm-up needed at this weight." : "Enter your working weight.";
  }
  return sets.map((s) => `${fmtKg(s.weight_kg)} kg × ${s.reps}`).join("  →  ");
}

function openWarmupRampModal(exerciseName) {
  const bar = isBarbellExercise(exerciseName) ? loadPlateSettings().bar : 0;
  const known = warmupWorkingWeightFromHistory(exerciseName);
  openModal(`
    <h3>Warm-up sets &mdash; ${escapeHtml(exerciseName)}</h3>
    <label class="plate-field">Working weight (kg)
      <input id="warmup-working" type="number" inputmode="decimal" min="0" step="2.5" value="${known != null ? fmtKg(known) : ""}" placeholder="e.g. 80">
    </label>
    <div class="meta">${known != null ? "From last time. " : ""}${bar ? `Never below the empty bar (${fmtKg(bar)} kg). ` : ""}Added as warm-up sets before your first set.</div>
    <div id="warmup-preview" class="warmup-preview"></div>
    <div class="modal-actions">
      <button id="warmup-add" class="btn-primary">Add warm-up sets</button>
    </div>
  `);
  modalContent.classList.add("size-compact");
  const input = modalContent.querySelector("#warmup-working");
  const preview = modalContent.querySelector("#warmup-preview");
  const addBtn = modalContent.querySelector("#warmup-add");
  const refresh = () => {
    preview.textContent = warmupPreviewText(input.value, bar);
    addBtn.disabled = warmupRampSets(input.value, { bar }).length === 0;
  };
  input.addEventListener("input", refresh);
  refresh();
  if (known == null) input.focus();
  addBtn.addEventListener("click", () => {
    const sets = warmupRampSets(input.value, { bar });
    if (!sets.length) return;
    // Same close path as the note modal: closeTopNavLayer() keeps the browser
    // history in step, and the redraw opens no new layer, so nothing races.
    closeTopNavLayer();
    insertWarmupSets(exerciseName, sets);
  });
}
