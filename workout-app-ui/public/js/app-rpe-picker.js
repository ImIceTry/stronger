// ---------- RPE picker (moved from app.js, 2026-09-17) ----------

// -- RPE picker --

// Standard RPE->RIR description scale -- fixed fitness knowledge, not
// per-exercise data (same call already made for the picker's own label
// wording), so this is a static lookup, not fetched from the backend.
const RPE_DESCRIPTIONS = {
  6: "Could do 4+ more reps",
  6.5: "Could do 3-4 more reps",
  7: "Could do 3 more reps",
  7.5: "Could do 2-3 more reps",
  8: "Could do 2 more reps",
  8.5: "Could do 1-2 more reps",
  9: "Could do 1 more rep",
  9.5: "Could maybe do 1 more rep",
  10: "Maximum exertion. No more reps possible.",
};

// Touch has no hover phase, so showing the description text before commit
// needs a real two-step interaction: tap previews (updates text/highlight,
// stays open), tapping the same value again (or tapping outside) commits.
function openRpePicker(exerciseName, index, onClose) {
  const values = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
  let previewValue = (pendingRpeByExercise[exerciseName] || {})[index] ?? null;

  const commit = (v) => {
    if (!pendingRpeByExercise[exerciseName]) pendingRpeByExercise[exerciseName] = {};
    pendingRpeByExercise[exerciseName][index] = v;
    renderActiveScreen();
    // Hand back to the numpad (its render() reopens this same docked-panel
    // slot in place, no new nav layer -- openDockedPanel's own dedup guard
    // sees this RPE picker's layer is still the top and just swaps content)
    // rather than closing first and letting it push a fresh one. Closing
    // first used to leave a phantom history entry every single RPE
    // round-trip (2026-09-10 bug fix, see handlingPopstate above) -- once
    // that phantom got a compensating history.back() of its own, doing it
    // in the wrong order here raced that back() against the numpad's own
    // reopen and closed the numpad right back out again.
    if (onClose) onClose();
    else closeDockedPanel();
  };

  const render = () => {
    const buttons = values
      .map((v) => `<button data-rpe="${v}" class="${previewValue === v ? "selected" : ""}">${v}</button>`)
      .join("");
    const description = previewValue != null ? RPE_DESCRIPTIONS[previewValue] : "";
    dockedPanel.innerHTML = `
      <div class="rpe-picker-header">
        <span class="icon-btn" title="What is RPE? (not built yet)">?</span>
        <span class="rpe-pill">RPE</span>
      </div>
      <div class="rpe-grid">${buttons}</div>
      ${description ? `<div class="rpe-description">${escapeHtml(description)}</div>` : ""}
    `;
    dockedPanel.querySelectorAll("[data-rpe]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = parseFloat(btn.dataset.rpe);
        if (previewValue === v) {
          commit(v);
        } else {
          previewValue = v;
          // Live update (2026-10-04, ImIceTry's ask): the row shows the new RPE
          // on the first tap, while this picker is still open -- the second
          // tap / outside tap now only closes it.
          if (!pendingRpeByExercise[exerciseName]) pendingRpeByExercise[exerciseName] = {};
          pendingRpeByExercise[exerciseName][index] = v;
          renderActiveScreen();
          render();
        }
      });
    });
  };

  // Tapping outside the panel commits whatever's currently previewed --
  // same "outside tap closes it" spirit as the calendar modal's own
  // outside-tap/back-gesture close, via the docked-panel system instead of
  // the modal one (this panel is no longer a centered sheet over a scrim).
  openDockedPanel("", () => {
    if (previewValue != null) {
      commit(previewValue);
    } else if (onClose) {
      onClose(); // same reasoning as commit() above -- reopen in place, don't close first
    } else {
      closeDockedPanel();
    }
  });
  render();
}

// One-tap RPE straight from an already-confirmed row (2026-09-17, Function
// Expansion Plan item 2.6) -- deliberately a separate function from
// openRpePicker above rather than a shared code path: that one always
// writes to pendingRpeByExercise and hands control back to the numpad via
// onClose, neither of which applies here (there's no pending row, no
// numpad open). Mutates the confirmed set object directly, matching the
// established pattern captureRealRestOnPriorSet already uses for
// retroactively patching an already-logged set -- looked up fresh by
// exercise+set_order on every call rather than a passed-in reference, so
// it can't go stale if something else edits activeWorkout.sets first.
//
// onClose (2026-10-04): the numpad's RPE key on a finished set's kg/reps edit
// passes one to hand back to the numpad in place, the same way openRpePicker
// does for a pending row -- that key used to open openRpePicker, whose
// pendingRpeByExercise write a finished row never reads, so the pick vanished
// (ImIceTry's report: "RPE doesn't change when a set is finished").
function openRpePickerForConfirmedSet(exerciseName, setOrder, onClose) {
  const set = activeWorkout.sets.find((s) => s.exercise_name === exerciseName && s.set_order === setOrder);
  if (!set) return;
  const values = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
  let previewValue = set.rpe ?? null;

  const commit = (v) => {
    set.rpe = v;
    persistActiveWorkout();
    renderActiveScreen();
    if (onClose) onClose();
    else closeDockedPanel();
  };

  const render = () => {
    const buttons = values
      .map((v) => `<button data-rpe="${v}" class="${previewValue === v ? "selected" : ""}">${v}</button>`)
      .join("");
    const description = previewValue != null ? RPE_DESCRIPTIONS[previewValue] : "";
    dockedPanel.innerHTML = `
      <div class="rpe-picker-header">
        <span class="icon-btn" title="What is RPE? (not built yet)">?</span>
        <span class="rpe-pill">RPE</span>
      </div>
      <div class="rpe-grid">${buttons}</div>
      ${description ? `<div class="rpe-description">${escapeHtml(description)}</div>` : ""}
    `;
    dockedPanel.querySelectorAll("[data-rpe]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = parseFloat(btn.dataset.rpe);
        if (previewValue === v) {
          commit(v);
        } else {
          previewValue = v;
          // Live update (2026-10-04, ImIceTry's ask), same as openRpePicker.
          set.rpe = v;
          persistActiveWorkout();
          renderActiveScreen();
          render();
        }
      });
    });
  };

  openDockedPanel("", () => {
    if (previewValue != null) commit(previewValue);
    else if (onClose) onClose();
    else closeDockedPanel();
  });
  render();
}
