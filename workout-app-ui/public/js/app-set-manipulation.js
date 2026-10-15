// ---------- set-manipulation core: shift positions, set-type toggle, unilateral toggle, warm-up ramp, field-mode picker (moved from app.js, 2026-09-17) ----------

// Shifts every position strictly after afterIndex by delta (+1 to open a
// gap, -1 to close one) across every per-exercise state keyed by position:
// confirmed sets' own set_order (which *is* their position, 1-based),
// pending input/RPE/type, skipped positions, rest overrides, the drop-
// continuation map itself, and the live rest timer's own position if it's
// caught in the shift. Used by toggleSetType (2026-09-11) so a drop set's
// continuation row can live directly after its source instead of always
// tacked onto the tail -- inserting/removing it mid-list means everything
// after it has to renumber, unlike every other add/remove in this app
// (ADD SET, swipe-delete) which deliberately never renumbers.
function shiftPositionsAfter(exerciseName, afterIndex, delta) {
  const shiftKeyedMap = (map) => {
    if (!map || !map[exerciseName]) return;
    const old = map[exerciseName];
    const next = {};
    Object.keys(old).forEach((k) => {
      const pos = parseInt(k, 10);
      next[pos > afterIndex ? pos + delta : pos] = old[k];
    });
    map[exerciseName] = next;
  };
  activeWorkout.sets.forEach((s) => {
    if (s.exercise_name === exerciseName && (s.set_order - 1) > afterIndex) {
      s.set_order += delta;
    }
  });
  shiftKeyedMap(pendingInputByExercise);
  shiftKeyedMap(pendingRpeByExercise);
  shiftKeyedMap(pendingSetTypeByExercise);
  shiftKeyedMap(pendingUnilateralByExercise);
  shiftKeyedMap(pendingVariantByExercise);
  shiftKeyedMap(pendingHandleGripByExercise);
  shiftKeyedMap(pendingSideByExercise);
  shiftKeyedMap(pendingAssistedRepsByExercise);
  if (activeWorkout.restPositionOverrides) shiftKeyedMap(activeWorkout.restPositionOverrides);
  if (skippedPositionsByExercise[exerciseName]) {
    skippedPositionsByExercise[exerciseName] = new Set(
      [...skippedPositionsByExercise[exerciseName]].map((pos) => (pos > afterIndex ? pos + delta : pos))
    );
  }
  if (dropContinuationByExercise[exerciseName]) {
    const old = dropContinuationByExercise[exerciseName];
    const next = {};
    Object.keys(old).forEach((k) => {
      const srcPos = parseInt(k, 10);
      const contPos = old[k];
      next[srcPos > afterIndex ? srcPos + delta : srcPos] = contPos > afterIndex ? contPos + delta : contPos;
    });
    dropContinuationByExercise[exerciseName] = next;
  }
  if (restTimerContext && restTimerContext.exerciseName === exerciseName && restTimerContext.position > afterIndex) {
    restTimerContext.position += delta;
  }
  parallelRestTimers.forEach((c) => {
    if (c.exerciseName === exerciseName && c.position > afterIndex) c.position += delta;
  });
}

// Companion to shiftPositionsAfter, kept separate since it needs an actual
// upper bound (shiftKeyedMap only remaps whatever keys already happen to
// exist) and different seeding on insert: every position strictly after
// afterIndex needs its previous-performance mapping explicitly carried
// forward (not just left to fall back to identity, which would now point
// at the wrong historical set), and the newly-opened slot itself gets null
// (a drop continuation has no previous-performance counterpart of its own).
function shiftHistoricalIndexMap(exerciseName, afterIndex, delta, totalPositions) {
  if (!previousIndexByExercise[exerciseName]) previousIndexByExercise[exerciseName] = {};
  const map = previousIndexByExercise[exerciseName];
  if (delta > 0) {
    for (let p = totalPositions - 1; p > afterIndex; p--) {
      map[p + delta] = historicalIndexFor(exerciseName, p);
    }
    map[afterIndex + delta] = null;
  } else {
    for (let p = afterIndex + 1; p < totalPositions; p++) {
      map[p + delta] = historicalIndexFor(exerciseName, p);
    }
    delete map[totalPositions - 1];
  }
}

// Displayed SET number for a position -- distinct from position/set_order
// (which shiftPositionsAfter deliberately keeps as a real, unique physical
// slot per row so a drop's continuation has somewhere of its own to live).
// A drop pair is conceptually one set logged in two parts, so both its rows
// show the same number and nothing after the pair renumbers -- walks back
// through dropContinuationByExercise to find the pair's original source
// position (handles a continuation itself being dropped again), then counts
// only non-continuation positions up to and including it.
function logicalSetNumber(exerciseName, position) {
  const map = dropContinuationByExercise[exerciseName] || {};
  const parentOf = {};
  Object.keys(map).forEach((k) => {
    parentOf[map[k]] = parseInt(k, 10);
  });
  let root = position;
  while (parentOf[root] != null) root = parentOf[root];
  let count = 0;
  for (let p = 0; p <= root; p++) {
    if (parentOf[p] == null) count++;
  }
  return count;
}

// Seeds dropContinuationByExercise/pendingSetTypeByExercise from a fresh
// exercise's OWN previous-performance history (2026-09-22 bug report: doing
// an exercise again after logging a drop set last time rendered it as N
// separately-numbered plain rows -- e.g. 4 "sets" instead of 2 normal + 1
// drop -- since dropContinuationByExercise only ever gets built live as
// *this* session's own toggleSetType calls happen, it starts empty for a
// just-added exercise even though its history clearly has a drop pair).
// Positions map 1:1 to previousData.sets by plain identity at this point
// (nothing's been typed or confirmed yet), so unlike toggleSetType's own
// live insert this never needs shiftPositionsAfter/shiftHistoricalIndexMap
// -- every slot these positions need already exists in totalPositions
// (prevSetCount already counts the continuation row as its own physical
// set); this only fixes how that existing slot is NUMBERED/badged.
// Consecutive-run scan (not just pairwise) so a longer chain (a
// continuation itself dropped again) seeds correctly too, matching
// logicalSetNumber's own walk-up-to-root tolerance for that case.
function seedDropHistoryFromPrevious(exerciseName, sets) {
  if (!sets || sets.length < 2) return;
  // Already seeded this exercise, or the user's own toggle already ran
  // before this async history fetch resolved -- don't clobber either.
  if (dropContinuationByExercise[exerciseName]) return;
  for (let i = 0; i < sets.length - 1; i++) {
    if (sets[i].set_type === "drop" && sets[i + 1].set_type === "drop") {
      if (!dropContinuationByExercise[exerciseName]) dropContinuationByExercise[exerciseName] = {};
      dropContinuationByExercise[exerciseName][i] = i + 1;
      if (!pendingSetTypeByExercise[exerciseName]) pendingSetTypeByExercise[exerciseName] = {};
      if (pendingSetTypeByExercise[exerciseName][i] == null) pendingSetTypeByExercise[exerciseName][i] = "drop";
      if (pendingSetTypeByExercise[exerciseName][i + 1] == null) pendingSetTypeByExercise[exerciseName][i + 1] = "drop";
    }
  }
}

function toggleSetType(exerciseName, index, type, totalPositions) {
  if (!pendingSetTypeByExercise[exerciseName]) pendingSetTypeByExercise[exerciseName] = {};
  const current = pendingSetTypeByExercise[exerciseName][index];
  const turningOn = current !== type;
  pendingSetTypeByExercise[exerciseName][index] = turningOn ? type : "normal";
  // assisted_reps only ever means something alongside set_type === "assisted"
  // (2026-09-18) -- clear it whenever the type moves away from that, whether
  // toggled off directly or switched to a different type entirely. Setting
  // a value when turning ON assisted is the caller's own job (prompting for
  // the rep count is async, which this function deliberately stays clear of
  // -- see openSetTypePicker's assisted-btn handler).
  if (pendingSetTypeByExercise[exerciseName][index] !== "assisted" && pendingAssistedRepsByExercise[exerciseName]) {
    delete pendingAssistedRepsByExercise[exerciseName][index];
  }
  // A real drop set is two weights back-to-back at the same rep target, not
  // one row -- insert a connected row directly after the source (2026-09-11,
  // ImIceTry's own call -- previously always tacked onto the tail, which read
  // as unrelated to its own source once other sets sat in between), tagged
  // "drop" too so both rows read as the same set's two halves. Tracked in
  // dropContinuationByExercise so turning the flag back off can find this
  // same row again.
  if (turningOn && type === "drop" && totalPositions != null) {
    const continuationIndex = index + 1;
    shiftHistoricalIndexMap(exerciseName, index, 1, totalPositions);
    shiftPositionsAfter(exerciseName, index, 1);
    extraSetsByExercise[exerciseName] = (extraSetsByExercise[exerciseName] || 0) + 1;
    pendingSetTypeByExercise[exerciseName][continuationIndex] = "drop";
    if (!dropContinuationByExercise[exerciseName]) dropContinuationByExercise[exerciseName] = {};
    dropContinuationByExercise[exerciseName][index] = continuationIndex;
  }
  // Turning a drop set back off removes its continuation row too (2026-09-11,
  // ImIceTry's own ask), closing the gap the same way it was opened -- only
  // when it's safe to: the continuation was never actually confirmed as a
  // real logged set. If it was, just drop its own "drop" tag instead so it
  // stops looking like it still belongs to a pair, without touching or
  // renumbering around real logged data.
  if (!turningOn && type === "drop") {
    const byExercise = dropContinuationByExercise[exerciseName];
    const continuationIndex = byExercise ? byExercise[index] : undefined;
    if (continuationIndex != null) {
      const alreadyConfirmed = activeWorkout.sets.some((s) => s.exercise_name === exerciseName && s.set_order === continuationIndex + 1);
      if (!alreadyConfirmed) {
        delete pendingSetTypeByExercise[exerciseName][continuationIndex];
        if (pendingInputByExercise[exerciseName]) delete pendingInputByExercise[exerciseName][continuationIndex];
        if (pendingRpeByExercise[exerciseName]) delete pendingRpeByExercise[exerciseName][continuationIndex];
        if (pendingUnilateralByExercise[exerciseName]) delete pendingUnilateralByExercise[exerciseName][continuationIndex];
        if (pendingSideByExercise[exerciseName]) delete pendingSideByExercise[exerciseName][continuationIndex];
        if (pendingVariantByExercise[exerciseName]) delete pendingVariantByExercise[exerciseName][continuationIndex];
        if (pendingHandleGripByExercise[exerciseName]) delete pendingHandleGripByExercise[exerciseName][continuationIndex];
        if (pendingAssistedRepsByExercise[exerciseName]) delete pendingAssistedRepsByExercise[exerciseName][continuationIndex];
        if (totalPositions != null) shiftHistoricalIndexMap(exerciseName, continuationIndex, -1, totalPositions);
        shiftPositionsAfter(exerciseName, continuationIndex, -1);
        extraSetsByExercise[exerciseName] = Math.max(0, (extraSetsByExercise[exerciseName] || 0) - 1);
        // shiftPositionsAfter just replaced dropContinuationByExercise[exerciseName]
        // with a brand-new object internally -- `byExercise` above still points at
        // the old, now-discarded one, so deleting through it here would silently
        // no-op and leave a ghost continuation entry behind (found 2026-09-16:
        // toggling a drop set on then off left set numbers reading "1 1 2"
        // forever). Re-read the live map instead of reusing the stale reference.
        if (dropContinuationByExercise[exerciseName]) delete dropContinuationByExercise[exerciseName][index];
      } else {
        pendingSetTypeByExercise[exerciseName][continuationIndex] = "normal";
        delete byExercise[index];
      }
    }
  }
  renderActiveScreen();
}

// Independent of set_type (a set can be a unilateral drop set, etc.) -- no
// continuation-row/renumbering side effects like toggleSetType("drop") has,
// just a plain flag flip.
function toggleUnilateral(exerciseName, index) {
  // Toggle off the *effective* current state (explicit override, or the
  // exercise-wide default if this position was never touched) -- not the
  // raw pending map alone, otherwise tapping this on a position that's
  // showing as unilateral only because of the exercise default would
  // compute !undefined = true and silently fail to turn it off.
  const turningOff = isPositionUnilateral(exerciseName, index);
  if (!pendingUnilateralByExercise[exerciseName]) pendingUnilateralByExercise[exerciseName] = {};
  pendingUnilateralByExercise[exerciseName][index] = !turningOff;
  // A side only ever means something on a unilateral set -- clear it rather
  // than let it silently survive on a set that's no longer marked as one.
  if (turningOff && pendingSideByExercise[exerciseName]) delete pendingSideByExercise[exerciseName][index];
  renderActiveScreen();
}

// Reached by tapping the set number itself now (2026-09-10), not a
// separate "Set options" link -- RPE moved entirely into the numpad's own
// reps step (items 19/20), so this is just Normal/Warm-up/Drop/Failure.
// Tapping the already-active type again turns it back to Normal, same
// toggleSetType semantics as before. Unilateral (2026-09-16) is a separate,
// independently-toggleable flag rather than a 4th mutually-exclusive type --
// see toggleUnilateral's own comment.
// Prompt for how many reps at the end of a set were assisted (spotter or
// machine help) -- 2026-09-18, replaces the old plain "Failure" toggle.
// Reuses the plain openModal single-input pattern openAddNoteModal already
// uses, not a new dialog shape. Resolves null if left blank (still tags the
// set Assisted, just without a specific count) -- dismissing without
// saving (tap outside/back) leaves this promise unresolved, same accepted
// characteristic every other promise-based dialog in this app already has
// (askUnfinishedSetsChoice etc.); the caller just never applies the toggle
// in that case, which reads as a plain cancel, not a visible bug.
function promptAssistedReps(currentValue) {
  return new Promise((resolve) => {
    openModal(`
      <h3>Assisted reps</h3>
      <p class="modal-hint">How many reps at the end had a spotter or machine assist?</p>
      <input id="assisted-reps-input" type="number" inputmode="numeric" min="0" class="exercise-note-input" placeholder="e.g. 2" value="${currentValue != null ? currentValue : ""}">
      <div class="modal-actions">
        <button id="assisted-reps-save" class="btn-primary">Save</button>
      </div>
    `);
    modalContent.classList.add("size-compact");
    const input = modalContent.querySelector("#assisted-reps-input");
    input.focus();
    modalContent.querySelector("#assisted-reps-save").addEventListener("click", () => {
      const raw = input.value.trim();
      const n = raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
      // closeModal() directly, not closeTopNavLayer() -- both this prompt's
      // caller (openSetTypePicker's assisted-btn handler) close the docked
      // panel right after this resolves. closeTopNavLayer()'s history.back()
      // doesn't resolve synchronously, so resolve() would fire (and the
      // caller's own closeDockedPanel() would run) before this modal's own
      // layer was actually popped -- closeDockedPanel's dedup check would
      // then see the modal's layer still on top instead of the docked
      // panel's, and silently skip closing it. Same class of race as the
      // 2026-09-16 stuck Finish dialog and today's other nav-layer fixes.
      closeModal();
      resolve(n);
    });
  });
}

// Tag buttons for the set-type panel. A tag type that is switched off is left
// out unless the set already carries it, so existing data can still be cleared.
function setTypeButtonsHtml(currentType, isUnilateral) {
  const btn = (feature, cls, label, type, active) =>
    (featureEnabled(feature) || active) ? `<button class="${cls}-btn ${active ? `active ${type}` : ""}">${label}</button>` : "";
  return [
    btn("setWarmup", "warmup", "Warm-up", "warmup", currentType === "warmup"),
    btn("setDrop", "drop", "Drop", "drop", currentType === "drop"),
    btn("setAssisted", "assisted", "Assisted", "assisted", currentType === "assisted"),
    btn("unilateral", "unilateral", "Unilateral", "unilateral", isUnilateral),
  ].join("");
}

function onPanelButton(selector, handler) {
  const el = dockedPanel.querySelector(selector);
  if (el) el.addEventListener("click", handler);
}

function openSetTypePicker(exerciseName, index, totalPositions) {
  const currentType = (pendingSetTypeByExercise[exerciseName] || {})[index] || "normal";
  const isUnilateral = isPositionUnilateral(exerciseName, index);
  openDockedPanel(`
    <div class="set-type-toggle row-options-panel">${setTypeButtonsHtml(currentType, isUnilateral)}</div>
  `, () => closeDockedPanel());
  onPanelButton(".warmup-btn", () => {
    toggleSetType(exerciseName, index, "warmup");
    closeDockedPanel();
  });
  onPanelButton(".drop-btn", () => {
    toggleSetType(exerciseName, index, "drop", totalPositions);
    closeDockedPanel();
  });
  onPanelButton(".assisted-btn", async () => {
    const turningOn = currentType !== "assisted";
    if (turningOn) {
      // Deliberately does NOT close the docked panel before this -- the
      // prompt's own modal has a full backdrop that already covers it
      // completely, and closing here first would race the same way
      // promptAssistedReps' own comment describes (this panel's close is
      // async via history.back(), which wouldn't have resolved yet by the
      // time openModal below synchronously pushes a new layer on top).
      // closeDockedPanel() only runs once, below, after the prompt has
      // already fully resolved.
      const reps = await promptAssistedReps((pendingAssistedRepsByExercise[exerciseName] || {})[index]);
      if (!pendingAssistedRepsByExercise[exerciseName]) pendingAssistedRepsByExercise[exerciseName] = {};
      pendingAssistedRepsByExercise[exerciseName][index] = reps;
      toggleSetType(exerciseName, index, "assisted");
      closeDockedPanel();
    } else {
      toggleSetType(exerciseName, index, "assisted");
      closeDockedPanel();
    }
  });
  onPanelButton(".unilateral-btn", () => {
    toggleUnilateral(exerciseName, index);
    closeDockedPanel();
  });
}

// ImIceTry's ask (2026-09-18): "the option to change the type of set is
// locked [once confirmed], change that so it is always editable like the
// rest" -- weight/reps (editConfirmedSet) and RPE
// (openRpePickerForConfirmedSet) were both already editable post-confirm;
// set-type/unilateral/side rendered as a plain non-tappable span instead
// (app-render.js's confirmed-row branch), with no click handler at all.
// Mutates the confirmed set's own set_type/unilateral/side fields directly
// -- same "edit in place, no reopening" shape openRpePickerForConfirmedSet
// already uses for RPE -- rather than the pending-only maps
// openSetTypePicker itself reads/writes, which have no effect on an
// already-confirmed row's render. Deliberately does NOT offer Drop's
// continuation-row insertion (shiftPositionsAfter etc., see
// openSetTypePicker's own "drop" branch above) -- that mechanic builds a
// brand new row right after this one, a materially bigger operation than
// "relabel this already-logged set," and out of scope for what ImIceTry
// actually asked for here.
function openSetTypePickerForConfirmedSet(exerciseName, setOrder) {
  const set = activeWorkout.sets.find((s) => s.exercise_name === exerciseName && s.set_order === setOrder);
  if (!set) return;
  const currentType = set.set_type || "normal";
  openDockedPanel(`
    <div class="set-type-toggle row-options-panel">${setTypeButtonsHtml(currentType, !!set.unilateral)}</div>
  `, () => closeDockedPanel());
  const commit = () => {
    persistActiveWorkout();
    renderActiveScreen();
    closeDockedPanel();
  };
  const setType = (type) => {
    set.set_type = set.set_type === type ? "normal" : type;
    if (set.set_type !== "assisted") set.assisted_reps = null;
    commit();
  };
  onPanelButton(".warmup-btn", () => setType("warmup"));
  onPanelButton(".drop-btn", () => setType("drop"));
  onPanelButton(".assisted-btn", async () => {
    const turningOn = set.set_type !== "assisted";
    if (turningOn) {
      // Doesn't close the docked panel before this -- see openSetTypePicker's
      // own assisted-btn handler for why (the prompt's full-backdrop modal
      // already covers it; closing first would race its async history.back()
      // against this awaited openModal's own synchronous history.pushState()).
      const reps = await promptAssistedReps(set.assisted_reps);
      set.assisted_reps = reps;
      set.set_type = "assisted";
      commit(); // commit() closes the docked panel itself, once, here
    } else {
      setType("assisted");
    }
  });
  onPanelButton(".unilateral-btn", () => {
    set.unilateral = !set.unilateral;
    // A side only ever means something on a unilateral set -- same
    // convention toggleUnilateral already uses for a pending row.
    if (!set.unilateral) set.side = null;
    commit();
  });
}

// Reached by tapping the REPS/TIME header label itself (2026-09-12) -- every
// exercise shares one layout now, so switching what its second field means
// is a live per-exercise choice instead of a fixed unit_type. Only affects
// not-yet-confirmed rows: a set already logged keeps displaying by whatever
// it actually holds (reps vs duration_sec), regardless of how the toggle is
// set afterward. Clears any already-typed values for this exercise's open
// positions -- a reps number typed before switching to Time isn't a
// meaningful duration (and vice versa), so carrying it over silently would
// submit a fabricated value rather than an empty field.
function openFieldModePicker(exerciseName, currentMode) {
  openDockedPanel(`
    <div class="set-type-toggle row-options-panel">
      <button class="reps-btn ${currentMode === "reps" ? "active reps" : ""}">Reps</button>
      <button class="time-btn ${currentMode === "time" ? "active time" : ""}">Time</button>
    </div>
  `, () => closeDockedPanel());
  const apply = (mode) => {
    fieldModeOverrideByExercise[exerciseName] = mode;
    if (pendingInputByExercise[exerciseName]) {
      Object.values(pendingInputByExercise[exerciseName]).forEach((entry) => {
        delete entry.reps;
        delete entry.duration;
      });
    }
    closeDockedPanel();
    renderActiveScreen();
  };
  dockedPanel.querySelector(".reps-btn").addEventListener("click", () => apply("reps"));
  dockedPanel.querySelector(".time-btn").addEventListener("click", () => apply("time"));
}
