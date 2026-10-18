// ---------- row actions: delete/edit/uncheck a set, swipe-to-delete, elapsed timer, long-press (moved from app.js, 2026-09-17) ----------

// set_order is a fixed target position now (Strong-parity), not derived
// from array position -- both lookups below key directly off it instead of
// the old "count matching entries up to this array index" dance.
// Swiping away a set that hasn't been logged yet (2026-09-10) -- unlike
// deleteConfirmedSet there's no real data to remove, just this position's
// own pending state, and no renumbering: see skippedPositionsByExercise's
// own comment for why later positions keep their original numbers instead
// of shifting up.
function deletePendingSet(exerciseName, position) {
  if (!skippedPositionsByExercise[exerciseName]) skippedPositionsByExercise[exerciseName] = new Set();
  skippedPositionsByExercise[exerciseName].add(position);
  if (pendingInputByExercise[exerciseName]) delete pendingInputByExercise[exerciseName][position];
  if (pendingRpeByExercise[exerciseName]) delete pendingRpeByExercise[exerciseName][position];
  if (pendingSetTypeByExercise[exerciseName]) delete pendingSetTypeByExercise[exerciseName][position];
  if (pendingUnilateralByExercise[exerciseName]) delete pendingUnilateralByExercise[exerciseName][position];
  if (pendingSideByExercise[exerciseName]) delete pendingSideByExercise[exerciseName][position];
  if (pendingVariantByExercise[exerciseName]) delete pendingVariantByExercise[exerciseName][position];
  if (pendingHandleGripByExercise[exerciseName]) delete pendingHandleGripByExercise[exerciseName][position];
  if (pendingAssistedRepsByExercise[exerciseName]) delete pendingAssistedRepsByExercise[exerciseName][position];
  renderActiveScreen();
}

function deleteConfirmedSet(exerciseName, setOrder) {
  const globalIndex = activeWorkout.sets.findIndex(
    (s) => s.exercise_name === exerciseName && s.set_order === setOrder
  );
  if (globalIndex === -1) return;
  activeWorkout.sets.splice(globalIndex, 1);
  renumberExercise(exerciseName); // genuine removal collapses the gap
  persistActiveWorkout();
  renderActiveScreen();
}

// Editing a confirmed set's own weight/reps/duration value (tapping the
// KG/REPS button, not the checkmark) must not revert it to pending (bug
// reported 2026-09-22: "auto-uncomplete on edit") -- editConfirmedSet below
// removes the set and reopens its slot as a fresh pending row, which is
// correct for the checkmark's own explicit uncheck (unconfirmSet) but wrong
// here, since it visibly un-completes the row for a plain value correction.
// Mutates the confirmed set object directly instead, same "edit in place, no
// reopening" shape openRpePickerForConfirmedSet/openSetTypePickerForConfirmedSet
// already use -- the row stays rendered as confirmed for the entire edit.
function editConfirmedSetField(exerciseName, setOrder, field) {
  const set = activeWorkout.sets.find((s) => s.exercise_name === exerciseName && s.set_order === setOrder);
  if (!set) return;
  const position = setOrder - 1;
  const mode = set.duration_sec != null ? "time" : "reps";
  const secondKey = mode === "time" ? "duration" : "reps";
  const fields = [
    { key: "weight", allowDecimal: true, initialValue: set.weight_kg != null ? String(set.weight_kg) : "", selectOnType: true, confirmedSetOrder: setOrder,
      ...weightHintFieldConfig(exerciseName, previousForSetIndex(previousFor(exerciseName), historicalIndexFor(exerciseName, position))) },
    mode === "time"
      ? { key: "duration", isDuration: true, initialValue: set.duration_sec != null ? secondsToMmssBuffer(set.duration_sec) : "", selectOnType: true, confirmedSetOrder: setOrder }
      : { key: "reps", allowDecimal: false, initialValue: set.reps != null ? String(set.reps) : "", selectOnType: true, confirmedSetOrder: setOrder },
  ];
  const initialValues = fields.map((f) => f.initialValue);
  // The numpad's typing only patches the on-screen text and parks the digits
  // in pendingInputByExercise, which a finished row never reads -- so the
  // value has to be written onto the set itself, or the next redraw reverts
  // the box to the old number (bug reported 2026-10-03: "changing reps/kg in
  // a finished set doesn't get saved, it reverts as soon as you close the
  // numpad"). That used to happen only on NEXT from the last field.
  const commit = (values) => {
    set.weight_kg = values[0] === "" ? null : parseFloat(values[0]);
    if (mode === "time") {
      set.duration_sec = values[1] === "" ? null : mmssBufferToSeconds(values[1]);
    } else {
      set.reps = values[1] === "" ? null : parseInt(values[1], 10);
    }
    persistActiveWorkout();
    renderActiveScreen();
  };
  // Closing any other way (outside tap, collapse arrow, back button) keeps
  // what was typed too -- but only when something actually changed, so a
  // tap-and-close on an untouched set doesn't rewrite it (a timed set's
  // mm:ss buffer is also lossy past 99:59).
  const onClose = (values) => {
    // the numpad's own live typing parked these in the pending store, which
    // a finished row never reads -- drop them so a later pending row at this
    // position can't inherit them
    if (pendingInputByExercise[exerciseName]) delete pendingInputByExercise[exerciseName][position];
    const changed = values.some((v, i) => v !== (initialValues[i] != null ? String(initialValues[i]) : ""));
    if (changed) commit(values);
  };
  openNumpad(exerciseName, position, fields, (values) => {
    if (pendingInputByExercise[exerciseName]) delete pendingInputByExercise[exerciseName][position];
    commit(values);
  }, field === secondKey ? 1 : 0, onClose);
}

// Only used by unconfirmSet's own revert-to-pending flow now (2026-09-22) --
// editing weight/reps/duration goes through editConfirmedSetField above
// instead, which stays confirmed throughout.
function editConfirmedSet(exerciseName, setOrder, openField) {
  const globalIndex = activeWorkout.sets.findIndex(
    (s) => s.exercise_name === exerciseName && s.set_order === setOrder
  );
  if (globalIndex === -1) return;
  const removed = activeWorkout.sets[globalIndex];
  activeWorkout.sets.splice(globalIndex, 1);
  // No renumbering here, unlike delete -- editing reopens exactly this
  // set's own slot for re-entry rather than removing it, so every other
  // set keeps its own number while this one's briefly empty again.
  const reopenedIndex = setOrder - 1;
  if (!pendingRpeByExercise[exerciseName]) pendingRpeByExercise[exerciseName] = {};
  pendingRpeByExercise[exerciseName][reopenedIndex] = removed.rpe ?? undefined;
  if (!pendingSetTypeByExercise[exerciseName]) pendingSetTypeByExercise[exerciseName] = {};
  pendingSetTypeByExercise[exerciseName][reopenedIndex] = removed.set_type || "normal";
  if (!pendingUnilateralByExercise[exerciseName]) pendingUnilateralByExercise[exerciseName] = {};
  pendingUnilateralByExercise[exerciseName][reopenedIndex] = !!removed.unilateral;
  if (!pendingSideByExercise[exerciseName]) pendingSideByExercise[exerciseName] = {};
  if (removed.side) pendingSideByExercise[exerciseName][reopenedIndex] = removed.side;
  if (!pendingAssistedRepsByExercise[exerciseName]) pendingAssistedRepsByExercise[exerciseName] = {};
  pendingAssistedRepsByExercise[exerciseName][reopenedIndex] = removed.assisted_reps ?? null;
  if (!pendingVariantByExercise[exerciseName]) pendingVariantByExercise[exerciseName] = {};
  pendingVariantByExercise[exerciseName][reopenedIndex] = removed.variant || null;
  if (!pendingHandleGripByExercise[exerciseName]) pendingHandleGripByExercise[exerciseName] = {};
  pendingHandleGripByExercise[exerciseName][reopenedIndex] = { handle: removed.handle || null, grip: removed.grip || null };
  // Reopening must render in the same mode the removed set actually used
  // (2026-09-12) -- the card's own REPS/TIME toggle is exercise-wide and can
  // disagree with any one specific set (e.g. a normally reps-based exercise
  // that happened to get logged as a timed hold once), and openField below
  // targets a field name that only exists in that set's own mode.
  fieldModeOverrideByExercise[exerciseName] = removed.duration_sec != null ? "time" : "reps";
  // Re-fill the now-reopened pending row with the removed set's own values
  // (not the previous-performance prefill) so editing doesn't lose data --
  // pendingInputByExercise is exactly what render-time prefill already
  // reads, so setting it before rendering replaces the old post-render DOM
  // poke (which targeted the now-removed native <input> elements).
  if (!pendingInputByExercise[exerciseName]) pendingInputByExercise[exerciseName] = {};
  pendingInputByExercise[exerciseName][reopenedIndex] = {
    weight: removed.weight_kg != null ? String(removed.weight_kg) : "",
    reps: removed.reps != null ? String(removed.reps) : "",
    duration: removed.duration_sec != null ? secondsToMmssBuffer(removed.duration_sec) : "",
  };
  persistActiveWorkout();
  renderActiveScreen();
  // No pencil button anymore (2026-09-10) -- tapping the KG/REPS value
  // itself is what reopens this set, so jump straight into the numpad on
  // that exact field instead of making it a second tap.
  if (openField) {
    const el = document.querySelector(`[data-numpad-field="${exerciseName}:${reopenedIndex}:${openField}"]`);
    if (el) el.click();
  }
}

// Tapping the checkmark on a confirmed set reverts it back to pending
// (2026-09-11, ImIceTry's own ask) -- reuses editConfirmedSet's own
// revert-to-pending logic (remove the set, restore its values as the
// reopened row's own prefill) just without also jumping into the numpad
// afterward. If this position's own rest timer happens to be running,
// stop it too -- the rest that follows a set that's no longer confirmed
// doesn't make sense to keep ticking.
function unconfirmSet(exerciseName, position) {
  if (restTimerContext && restTimerContext.exerciseName === exerciseName && restTimerContext.position === position) {
    stopRestTimer();
  }
  parallelRestTimers = parallelRestTimers.filter((c) => !(c.exerciseName === exerciseName && c.position === position));
  editConfirmedSet(exerciseName, position + 1, null);
}

// Left-swipe-to-delete on a confirmed set row (2026-09-10, replaces the old
// dedicated x button). Pointer events (not touch-only) so it also works
// with a mouse for desktop/testing. Reads mostly horizontal drags as a
// swipe; anything more vertical than horizontal is left alone so normal
// page scrolling still works starting from on top of a row.
function wireSwipeToDelete(wrapEl, onDelete) {
  const rowEl = wrapEl.querySelector(".set-row");
  const THRESHOLD = 70;
  let startX = null;
  let startY = null;
  let dragging = false;
  let deltaX = 0;

  wrapEl.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
    startY = e.clientY;
    dragging = false;
    deltaX = 0;
  });
  wrapEl.addEventListener("pointermove", (e) => {
    if (startX == null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { startX = null; return; } // vertical scroll, not a swipe
      if (dx > 0) { startX = null; return; } // rightward belongs to the card's radial menu
      dragging = true;
      try { wrapEl.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone, e.g. a fast tap-and-release -- harmless */ }
    }
    deltaX = Math.min(0, dx);
    rowEl.style.transform = `translateX(${deltaX}px)`;
  });
  const finish = () => {
    if (!dragging) { startX = null; return; }
    dragging = false;
    startX = null;
    rowEl.style.transition = "transform 150ms ease-out";
    if (deltaX < -THRESHOLD) {
      rowEl.style.transform = "translateX(-100%)";
      setTimeout(onDelete, 140);
    } else {
      rowEl.style.transform = "";
    }
    setTimeout(() => { rowEl.style.transition = ""; }, 160);
  };
  wrapEl.addEventListener("pointerup", finish);
  wrapEl.addEventListener("pointercancel", finish);
}

function startElapsedTimer() {
  clearInterval(elapsedTimerHandle);
  const label = document.getElementById("active-elapsed");
  const miniLabel = document.getElementById("mini-bar-elapsed");
  const subLabel = document.getElementById("active-elapsed-sub");
  if (editingWorkoutId != null) {
    label.textContent = `Editing`;
    subLabel.textContent = `Editing`;
    return; // a past workout's duration doesn't tick -- nothing to count up
  }
  const started = new Date(activeWorkout.started_at.replace(" ", "T"));
  const update = () => {
    const totalSec = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const text = formatClock(totalSec);
    label.textContent = text;
    miniLabel.textContent = text; // keeps ticking on the mini-bar even while collapsed
    subLabel.textContent = text; // small line under the workout name, matching Strong
  };
  startWorkoutForegroundNotification(activeWorkout.name); // no-op if already running
  // The native notification no longer mirrors workout elapsed time (ImIceTry's
  // own call, 2026-09-14) -- it shows the rest countdown or the next set
  // instead, so just make sure its content matches current state on every
  // render (handles e.g. a set being deleted while the idle content is showing).
  refreshWorkoutNotificationContent();
  update();
  elapsedTimerHandle = setInterval(update, 1000);
}

// Long-press detection (2026-09-12) -- shared by anything that needs a
// "hold this" gesture distinct from a tap. Cancels itself on real movement
// (a scroll/swipe starting on the same element shouldn't also fire the
// long-press) or on release before the threshold.
function wireLongPress(el, onLongPress, ms) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
    startY = e.clientY;
    cancel();
    timer = setTimeout(() => { timer = null; onLongPress(); }, ms || 500);
  });
  el.addEventListener("pointermove", (e) => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) cancel();
  });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
}
