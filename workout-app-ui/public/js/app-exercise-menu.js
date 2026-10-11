// ---------- exercise-level menus: superset grouping, exercise options, notes, sticky note, machine/variant, replace/remove exercise, rest timer modal (moved from app.js, 2026-09-17) ----------

// -- superset grouping (client-side only -- Strong's own CSV format has no
// such field, so there's nothing meaningful to sync; purely a workout-session UX grouping) --

function nextSupersetLetter() {
  const used = new Set(Object.values(activeWorkout.supersets || {}));
  for (const c of "ABCDEFGH") {
    if (!used.has(c)) return c;
  }
  return "X";
}

function openSupersetPicker(exerciseName) {
  const others = activeWorkout.exercises.filter((n) => n !== exerciseName);
  if (others.length === 0) {
    openModal(`<p>Add another exercise first to link it with ${escapeHtml(exerciseName)}.</p>`);
    return;
  }
  const rows = others
    .map((n) => `<div class="exercise-row" data-name="${escapeHtml(n)}">${escapeHtml(n)}</div>`)
    .join("");
  openModal(`<h3>Link with...</h3>${rows}`);
  modalContent.classList.add("size-comfortable"); // UI Polish Pass 2026-09-18 -- option list
  modalContent.querySelectorAll(".exercise-row").forEach((row) => {
    row.addEventListener("click", () => {
      const otherName = row.dataset.name;
      const existingGroup = activeWorkout.supersets[otherName] || activeWorkout.supersets[exerciseName];
      const group = existingGroup || nextSupersetLetter();
      activeWorkout.supersets[exerciseName] = group;
      activeWorkout.supersets[otherName] = group;
      persistActiveWorkout();
      closeTopNavLayer();
      renderActiveScreen();
    });
  });
}

// -- exercise options menu ("..." next to an exercise name) --
// Built incrementally, one real action per commit -- see the Overnight Plan's
// Phase 1 sub-steps. Each item either opens its own modal/flow or, once its
// sub-step is done, gets added to the list below.

// Row icons (UI Polish Pass, 2026-09-18, item 3 migration to the side
// panel) -- one per action, drawn per the plan's own "minimal but clean"
// guidance (few shapes, consistent stroke-width:2, no linecap/linejoin
// override). Kept as a lookup object rather than inlined per row so the
// same icon markup can't drift between the initial render and the two
// rows whose label gets rewritten after an async fetch resolves.
const EXERCISE_MENU_ICONS = {
  note: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
  stickyNote: `<path d="M4 4h12l4 4v12H4Z"/><path d="M16 4v4h4"/>`,
  // Half-filled circle -- a standard "split/half" glyph, reused here for
  // "which side" rather than drawing a literal split body at 20px.
  unilateral: `<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/>`,
  restTimer: `<path d="M9 2h6"/><path d="M12 2v3"/><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/>`,
  machineSettings: `<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>`,
  machineVariant: `<path d="M17 3 21 7l-4 4"/><path d="M21 7H3"/><path d="M7 21 3 17l4-4"/><path d="M3 17h18"/>`,
  // Same circular-arrow shape the mislabeled "Timer" mini-bar icon used to
  // use (item 2) -- a genuinely correct replace/refresh icon, just on the
  // wrong button before; reusing it here is the fix for both at once.
  replace: `<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>`,
  superset: `<path d="M9 17H7a5 5 0 0 1 0-10h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><path d="M8 12h8"/>`,
  remove: `<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>`,
  // Below: template-menu-only icons (openTemplateOptionsMenu). folder/share
  // reuse the exact paths already drawn for the Home header's own folder
  // button (index.html #btn-template-folders) and the workout-detail
  // header's own share button (#workout-detail-share-btn), rather than
  // drawing a second slightly-different version of an icon already in the
  // app -- same shape, same meaning, everywhere it appears.
  folder: `<path d="M3 7h5l2 2h11v10H3z"/>`,
  share: `<path d="M12 3v13M7 8l5-5 5 5M5 21h14"/>`,
  duplicate: `<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
  archive: `<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 13h4"/>`,
};
function sidePanelRow(action, iconKey, label) {
  return `<div class="side-panel-row" data-action="${action}"><svg class="side-panel-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS[iconKey]}</svg><span class="side-panel-row-label">${label}</span></div>`;
}

// Replace is only offered before anything is logged; once sets exist the
// remove+add-exercise flow already covers switching mid-workout.
function startReplaceExercise(exerciseName) {
  if (activeWorkout.sets.some((s) => s.exercise_name === exerciseName)) {
    alert("Can't replace an exercise that already has logged sets this workout. Remove it and add the new one instead.");
    return;
  }
  openReplaceExerciseModal(exerciseName);
}

// Shared by the options menu and the radial quick menu. Returns true if saved.
async function toggleDefaultUnilateral(exerciseName) {
  const next = !defaultUnilateralCache[exerciseName];
  try {
    const result = await apiPut(`/api/exercises/${encodeURIComponent(exerciseName)}/default-unilateral`, { default_unilateral: next });
    defaultUnilateralCache[exerciseName] = !!result.default_unilateral;
    return true;
  } catch (err) {
    alert("Couldn't save (offline?). Try again once you have signal.");
    return false;
  }
}

async function openExerciseOptionsMenu(exerciseName) {
  const hasNote = !!(activeWorkout.exerciseNotes && activeWorkout.exerciseNotes[exerciseName]);
  const hasVariant = !!(activeWorkout.variantByExercise && activeWorkout.variantByExercise[exerciseName]);
  openSidePanel(exerciseName, [
    sidePanelRow("add-note", "note", hasNote ? "Edit note" : "Add note"),
    sidePanelRow("sticky-note", "stickyNote", "Loading sticky note&hellip;"),
    sidePanelRow("default-unilateral", "unilateral", "Loading&hellip;"),
    sidePanelRow("rest-timer", "restTimer", "Update rest timer"),
    sidePanelRow("machine-variant", "machineVariant", hasVariant ? "Change machine/variant" : "Set machine/variant"),
    sidePanelRow("machine-settings", "machineSettings", "Machine settings"),
    sidePanelRow("replace", "replace", "Replace exercise"),
    sidePanelRow("superset", "superset", "Create superset"),
    sidePanelRow("remove", "remove", "Remove exercise"),
  ].join(""));
  sidePanel.querySelector('[data-action="add-note"]').addEventListener("click", () => {
    // closeSidePanel() directly, not closeTopNavLayer() -- this closes the
    // panel and opens a new modal in the same gesture, and closeTopNavLayer's
    // history.back() doesn't resolve synchronously (it's async via popstate,
    // see app-nav.js's own comment on that class of bug from 2026-09-16's
    // stuck Finish dialog). Opening the next modal before that resolves
    // would desync navLayers from the browser's real history stack. Real bug
    // fixed here (2026-09-18): this row used to open the modal with the side
    // panel still open underneath it, and since the modal is only
    // size-compact (not full-screen), the still-visible panel behind it
    // covered part of the modal instead of getting out of the way.
    closeSidePanel();
    openAddNoteModal(exerciseName);
  });
  sidePanel.querySelector('[data-action="machine-variant"]').addEventListener("click", () => {
    closeSidePanel(); // see add-note's own comment just above -- same bug, same fix
    openMachineVariantModal(exerciseName);
  });
  sidePanel.querySelector('[data-action="machine-settings"]').addEventListener("click", () => {
    closeSidePanel();
    openMachineSettingsModal(exerciseName);
  });
  sidePanel.querySelector('[data-action="rest-timer"]').addEventListener("click", () => {
    closeSidePanel(); // see add-note's own comment above -- same bug, same fix
    openRestTimerModal(exerciseName);
  });
  sidePanel.querySelector('[data-action="replace"]').addEventListener("click", () => {
    closeSidePanel(); // see add-note's own comment above -- same bug, same fix
    startReplaceExercise(exerciseName);
  });
  sidePanel.querySelector('[data-action="superset"]').addEventListener("click", () => {
    // Deliberately the exact same function the link-icon button already
    // calls -- this menu item is wiring only, not a second implementation
    // of superset creation (the plan's own instruction: don't duplicate it).
    closeSidePanel();
    openSupersetPicker(exerciseName);
  });
  sidePanel.querySelector('[data-action="remove"]').addEventListener("click", () => {
    // Real bug fixed here (2026-09-22 report: "remove exercise button not
    // working"). removeExerciseFromWorkout awaits showConfirmDialog, which
    // pushes its own nav layer synchronously -- but closeTopNavLayer's
    // history.back() is async (resolves later via popstate), so that
    // confirm dialog's pushState landed while the browser was still
    // mid-transition from the panel's own close. The delayed popstate then
    // caught up and swept the just-opened confirm dialog away as collateral
    // (same class of bug as the 2026-09-18 "Edit" fix, 2e6b612) -- the
    // dialog flashed and closed itself before ImIceTry could tap Remove.
    // closeSidePanel() pops synchronously first, same fix already applied
    // to add-note/machine-variant/rest-timer above.
    closeSidePanel();
    removeExerciseFromWorkout(exerciseName);
  });

  // Sticky notes live server-side (persist across future workouts, unlike
  // the this-workout-only note above) -- shares the same cache/fetch path
  // the exercise card's variant bar uses (Phase 1.9), so the menu label and
  // the card never disagree about current state.
  const stickyRow = sidePanel.querySelector('[data-action="sticky-note"]');
  const currentSticky = await fetchStickyNote(exerciseName);
  if (!sidePanel.contains(stickyRow)) return; // menu closed while the fetch was in flight
  stickyRow.querySelector(".side-panel-row-label").textContent = currentSticky ? "Edit sticky note" : "Add sticky note";
  stickyRow.addEventListener("click", () => {
    // Missed in the 2026-09-18 pass that added this same closeSidePanel()
    // call to add-note/machine-variant -- this row opens a modal in the
    // same gesture too, so it needs the synchronous close for the same
    // reason (see add-note's own comment above). Confirmed live 2026-09-19:
    // without it, the panel stayed visible behind the sticky-note modal.
    closeSidePanel();
    openStickyNoteModal(exerciseName, currentSticky);
  });

  // Exercise-level "always unilateral" default (2026-09-17, item 1.3) --
  // same lazy-fetch-then-fill pattern as the sticky note row above, since
  // this is also server-side/persists-across-workouts state, not
  // workout-local like activeWorkout.variantByExercise.
  const unilateralRow = sidePanel.querySelector('[data-action="default-unilateral"]');
  const isDefaultUnilateral = await fetchDefaultUnilateral(exerciseName);
  if (!sidePanel.contains(unilateralRow)) return; // menu closed while the fetch was in flight
  unilateralRow.querySelector(".side-panel-row-label").textContent = isDefaultUnilateral ? "Always unilateral: On (tap to turn off)" : "Always unilateral: Off (tap to turn on)";
  unilateralRow.addEventListener("click", async () => {
    if (!(await toggleDefaultUnilateral(exerciseName))) return;
    closeTopNavLayer();
    renderActiveScreen();
  });
}

function openAddNoteModal(exerciseName) {
  const current = (activeWorkout.exerciseNotes && activeWorkout.exerciseNotes[exerciseName]) || "";
  openModal(`
    <h3>Note &mdash; ${escapeHtml(exerciseName)}</h3>
    <textarea id="exercise-note-input" class="exercise-note-input" rows="3" placeholder="Note for this workout only...">${escapeHtml(current)}</textarea>
    <div class="modal-actions">
      <button id="exercise-note-save" class="btn-primary">Save</button>
    </div>
  `);
  modalContent.classList.add("size-compact"); // UI Polish Pass 2026-09-18 -- single-input prompt
  const textarea = modalContent.querySelector("#exercise-note-input");
  textarea.focus();
  modalContent.querySelector("#exercise-note-save").addEventListener("click", () => {
    const text = textarea.value.trim();
    if (!activeWorkout.exerciseNotes) activeWorkout.exerciseNotes = {};
    if (text) {
      activeWorkout.exerciseNotes[exerciseName] = text;
    } else {
      delete activeWorkout.exerciseNotes[exerciseName];
    }
    persistActiveWorkout();
    closeTopNavLayer();
    renderActiveScreen();
  });
}

// Workout-wide note, distinct from a per-exercise one above -- goes into
// workouts.workout_notes (2026-09-17, Function Expansion Plan item 2.4).
// The column and the sync/update payload field have existed since the
// original build, but nothing in the UI ever wrote to it -- only 1 of 254
// real workouts has one, and that one came from folding in a free-text row
// during the original Strong-export migration, not from this app.
function openWorkoutNotesModal() {
  const current = activeWorkout.workoutNotes || "";
  openModal(`
    <h3>Workout notes</h3>
    <textarea id="workout-notes-input" class="exercise-note-input" rows="4" placeholder="Notes for this whole workout...">${escapeHtml(current)}</textarea>
    <div class="modal-actions">
      <button id="workout-notes-save" class="btn-primary">Save</button>
    </div>
  `);
  modalContent.classList.add("size-compact"); // UI Polish Pass 2026-09-18
  const textarea = modalContent.querySelector("#workout-notes-input");
  textarea.focus();
  modalContent.querySelector("#workout-notes-save").addEventListener("click", () => {
    activeWorkout.workoutNotes = textarea.value.trim();
    persistActiveWorkout();
    closeTopNavLayer();
  });
}

// Active-workout "..." menu (2026-09-17, Function Expansion Plan item 2.4)
// -- was a dead button ("More (not built yet)"). Reorder exercises already
// exists via long-press on an exercise's name bar (2026-09-13) but that's a
// gesture with zero visual affordance -- surfaced here too as a real,
// discoverable menu entry rather than a second implementation (calls the
// exact same enterReorderMode()). Save-as-template and a workout-wide rest
// default are real further scope for this same menu, deliberately left for
// a later pass rather than expanding this one further.
function openActiveWorkoutMenu() {
  const hasNotes = !!(activeWorkout.workoutNotes && activeWorkout.workoutNotes.trim());
  openModal(`
    <div class="exercise-row" data-action="workout-notes">${hasNotes ? "Edit workout notes" : "Add workout notes"}</div>
    <div class="exercise-row" data-action="reorder">Reorder exercises</div>
  `);
  modalContent.querySelector('[data-action="workout-notes"]').addEventListener("click", () => {
    // closeModal() (sync), not closeTopNavLayer() (async history.back()) --
    // chains straight into another openModal() call; see openMachineVariantModal's
    // own call site (item 1.2) for the exact same bug found and fixed today.
    closeModal();
    openWorkoutNotesModal();
  });
  modalContent.querySelector('[data-action="reorder"]').addEventListener("click", () => {
    closeTopNavLayer();
    enterReorderMode();
  });
}

document.getElementById("active-workout-menu-btn").addEventListener("click", openActiveWorkoutMenu);

function openStickyNoteModal(exerciseName, currentSticky) {
  openModal(`
    <h3>Sticky note &mdash; ${escapeHtml(exerciseName)}</h3>
    <p class="modal-hint">Persists across future workouts for this exercise (unlike the regular note).</p>
    <textarea id="sticky-note-input" class="exercise-note-input" rows="3" placeholder="e.g. try the paused variant next time...">${escapeHtml(currentSticky || "")}</textarea>
    <div class="modal-actions">
      <button id="sticky-note-save" class="btn-primary">Save</button>
    </div>
  `);
  modalContent.classList.add("size-compact"); // UI Polish Pass 2026-09-18 -- single-input prompt
  const textarea = modalContent.querySelector("#sticky-note-input");
  textarea.focus();
  modalContent.querySelector("#sticky-note-save").addEventListener("click", async () => {
    const text = textarea.value.trim();
    try {
      const result = await apiPut(`/api/exercises/${encodeURIComponent(exerciseName)}/sticky-note`, { note: text });
      // Update the cache directly from the server's own response rather than
      // re-fetching -- the variant bar (Phase 1.9) should reflect the new
      // state immediately, not wait for the next cold fetch of this exercise.
      stickyNoteCache[exerciseName] = result.note;
    } catch (err) {
      alert("Couldn't save sticky note (offline?). Try again once you have signal.");
      return;
    }
    closeTopNavLayer();
    renderActiveScreen();
  });
}

// Machine/variant tag (2026-09-17, Function Expansion Plan item 3.2) --
// workout-local only (activeWorkout.variantByExercise), unlike the sticky
// note above which persists server-side across workouts. It doesn't need
// its own persistence: the "carry forward automatically" behaviour comes
// from reading the *last logged set's own* variant on the exercise's next
// occurrence (see fetchPreviousPerformance's .then), not from a separately
// stored default. Clearing it here just means "not specified" for the rest
// of this workout, same as an exercise that never had one set.
async function openMachineVariantModal(exerciseName) {
  const current = (activeWorkout.variantByExercise || {})[exerciseName] || "";
  // Effective-weight ratio (2026-09-17) -- some machines display a stack/
  // pin number that isn't the real resistance at the point of contact (a
  // 4:1-pulley lateral-raise machine reading "40" for a true 10kg). Kept
  // to this same modal since it only ever makes sense alongside a variant
  // (the same exercise's *other* machine is presumably a normal 1:1 one) --
  // see sets.weight_ratio's own comment in db.py for how it's applied.
  const ratios = await fetchVariantRatios(exerciseName);
  const currentRatio = current && ratios[current] != null ? ratios[current] : "";
  openModal(`
    <h3>Machine / variant &mdash; ${escapeHtml(exerciseName)}</h3>
    <p class="modal-hint">Applies to every set of this exercise for the rest of this workout. Carries forward to your next session automatically.</p>
    <input id="machine-variant-input" type="text" class="exercise-note-input" placeholder="e.g. old machine, 4-pulley, plate-loaded" value="${escapeHtml(current)}">
    <p class="modal-hint">Effective weight ratio -- only if this machine's own displayed number isn't the real resistance (e.g. 0.25 for a 4:1-pulley machine reading 4x the true load). Leave blank for a normal 1:1 machine. The number you log stays exactly what's on the machine; only PRs/1RM/volume use the adjusted value.</p>
    <input id="machine-variant-ratio" type="number" step="0.01" min="0.01" max="100" class="exercise-note-input" placeholder="e.g. 0.25" value="${currentRatio}">
    <div class="modal-actions">
      <button id="machine-variant-save" class="btn-primary">Save</button>
    </div>
  `);
  // UI Polish Pass 2026-09-18 -- size-compact, not -comfortable as the plan
  // doc first guessed: this is a 2-input form (like add-note/rest-timer),
  // not a scrollable option list, once actually looked at.
  modalContent.classList.add("size-compact");
  const input = modalContent.querySelector("#machine-variant-input");
  const ratioInput = modalContent.querySelector("#machine-variant-ratio");
  input.focus();
  modalContent.querySelector("#machine-variant-save").addEventListener("click", async () => {
    const text = input.value.trim();
    if (!activeWorkout.variantByExercise) activeWorkout.variantByExercise = {};
    if (text) {
      activeWorkout.variantByExercise[exerciseName] = text;
    } else {
      delete activeWorkout.variantByExercise[exerciseName];
    }
    persistActiveWorkout();
    // Only saved server-side (persists across every future workout) when
    // there's an actual variant to attach it to -- a ratio with no variant
    // name has nothing to key off next time this exercise is logged.
    if (text) {
      const ratioRaw = ratioInput.value.trim();
      const ratio = ratioRaw ? parseFloat(ratioRaw) : null;
      try {
        const result = await apiPut(`/api/exercises/${encodeURIComponent(exerciseName)}/variant-ratios`, { variant: text, ratio });
        variantRatioCache[exerciseName] = result.ratios;
      } catch (err) {
        alert("Saved the variant, but couldn't save the weight ratio (offline?). Try again once you have signal.");
      }
    }
    closeTopNavLayer();
    renderActiveScreen();
  });
}

// Saved machine settings (2026-10-10, ImIceTry's ask): free-form named values
// (seat height, back pad, ...) stored server-side per (exercise, machine/
// variant), so the next session shows what you used last time.
function machineSettingsFor(exerciseName) {
  const variant = (activeWorkout.variantByExercise || {})[exerciseName] || "";
  return ((machineSettingsCache[exerciseName] || {})[variant]) || [];
}

async function openMachineSettingsModal(exerciseName) {
  const variant = (activeWorkout.variantByExercise || {})[exerciseName] || "";
  const all = await fetchMachineSettings(exerciseName);
  const rows = (all[variant] || []).map((p) => [p[0], p[1]]);
  const rowHtml = (name, value) => `<div class="ms-row">
      <input type="text" class="exercise-note-input ms-name" maxlength="40" placeholder="Setting (e.g. Seat)" value="${escapeHtml(name)}">
      <input type="text" class="exercise-note-input ms-value" maxlength="40" placeholder="Value" value="${escapeHtml(value)}">
    </div>`;
  openModal(`
    <h3>Machine settings &mdash; ${escapeHtml(exerciseName)}</h3>
    <p class="modal-hint">${variant ? `For machine: ${escapeHtml(variant)}. ` : ""}Shown again next time you do this exercise. Clear a name to remove that line.</p>
    <div id="ms-rows">${(rows.length ? rows : [["", ""]]).map((p) => rowHtml(p[0], p[1])).join("")}</div>
    <div class="modal-actions">
      <button id="ms-add" class="btn-secondary">+ Add setting</button>
      <button id="ms-save" class="btn-primary">Save</button>
    </div>
  `);
  modalContent.classList.add("size-comfortable");
  const container = modalContent.querySelector("#ms-rows");
  modalContent.querySelector("#ms-add").addEventListener("click", () => {
    container.insertAdjacentHTML("beforeend", rowHtml("", ""));
    container.lastElementChild.querySelector(".ms-name").focus();
  });
  modalContent.querySelector("#ms-save").addEventListener("click", async () => {
    const settings = [...container.querySelectorAll(".ms-row")]
      .map((r) => [r.querySelector(".ms-name").value.trim(), r.querySelector(".ms-value").value.trim()])
      .filter((p) => p[0]);
    try {
      const result = await apiPut(`/api/exercises/${encodeURIComponent(exerciseName)}/machine-settings`, { variant, settings });
      machineSettingsCache[exerciseName] = result.machine_settings || {};
    } catch (err) {
      alert("Couldn't save the machine settings (offline?). Try again once you have signal.");
      return;
    }
    closeTopNavLayer();
    renderActiveScreen();
  });
}

// Cable handle/attachment + grip (2026-10-06, ImIceTry's ask). Fixed lists, kept
// in sync with HANDLES/GRIPS in the backend's validation.py. Workout-local like
// variantByExercise: set once per exercise, carried forward from last time,
// snapshotted onto each set when it is confirmed.
const HANDLE_OPTIONS = ["Straight bar", "EZ bar", "V-bar", "Rope", "Single D-handle", "Wide lat bar", "Close-grip triangle", "Cuffs"];
const GRIP_OPTIONS = ["Overhand", "Underhand", "Neutral"];
const HANDLE_EXERCISE_RE = /\(Cable\)|pulldown/i;
const GRIP_ONLY_EXERCISE_RE = /pull[- ]?up|chin[- ]?up/i;

function exerciseSupportsHandles(exerciseName) {
  return HANDLE_EXERCISE_RE.test(exerciseName);
}

function exerciseSupportsHandleGrip(exerciseName) {
  return exerciseSupportsHandles(exerciseName) || GRIP_ONLY_EXERCISE_RE.test(exerciseName);
}

function openHandleGripModal(exerciseName) {
  if (!activeWorkout.handleByExercise) activeWorkout.handleByExercise = {};
  if (!activeWorkout.gripByExercise) activeWorkout.gripByExercise = {};
  let handle = activeWorkout.handleByExercise[exerciseName] || null;
  let grip = activeWorkout.gripByExercise[exerciseName] || null;
  const showHandles = exerciseSupportsHandles(exerciseName);
  const optionButtons = (kind, options, selected) => options
    .map((o) => `<button class="handle-option${o === selected ? " selected" : ""}" data-kind="${kind}" data-value="${escapeHtml(o)}">${escapeHtml(o)}</button>`)
    .join("");
  openModal(`
    <h3>Handle / grip &mdash; ${escapeHtml(exerciseName)}</h3>
    <p class="modal-hint">Applies to every set of this exercise for the rest of this workout. Carries forward to your next session. Tap a selected option again to clear it.</p>
    ${showHandles ? `<div class="handle-group-label">Handle</div><div class="handle-options" data-group="handle">${optionButtons("handle", HANDLE_OPTIONS, handle)}</div>` : ""}
    <div class="handle-group-label">Grip</div>
    <div class="handle-options" data-group="grip">${optionButtons("grip", GRIP_OPTIONS, grip)}</div>
    <div class="modal-actions">
      <button id="handle-grip-save" class="btn-primary">Save</button>
    </div>
  `);
  modalContent.classList.add("size-comfortable");
  modalContent.querySelectorAll(".handle-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.kind;
      const value = btn.dataset.value;
      const wasSelected = btn.classList.contains("selected");
      modalContent.querySelectorAll(`.handle-option[data-kind="${kind}"]`).forEach((b) => b.classList.remove("selected"));
      if (!wasSelected) btn.classList.add("selected");
      if (kind === "handle") handle = wasSelected ? null : value;
      else grip = wasSelected ? null : value;
    });
  });
  modalContent.querySelector("#handle-grip-save").addEventListener("click", () => {
    if (handle) activeWorkout.handleByExercise[exerciseName] = handle;
    else delete activeWorkout.handleByExercise[exerciseName];
    if (grip) activeWorkout.gripByExercise[exerciseName] = grip;
    else delete activeWorkout.gripByExercise[exerciseName];
    persistActiveWorkout();
    closeTopNavLayer();
    renderActiveScreen();
  });
}

function openReplaceExerciseModal(oldName) {
  openModal(`
    <h3>Replace ${escapeHtml(oldName)}</h3>
    <input id="replace-exercise-input" type="text" class="exercise-note-input" placeholder="Search exercises...">
    <div id="replace-exercise-suggestions" class="replace-suggestions"></div>
  `);
  modalContent.classList.add("size-comfortable"); // UI Polish Pass 2026-09-18
  const input = modalContent.querySelector("#replace-exercise-input");
  const suggestions = modalContent.querySelector("#replace-exercise-suggestions");
  input.focus();
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    timer = setTimeout(async () => {
      if (!q) {
        suggestions.innerHTML = "";
        return;
      }
      try {
        // Same forgiving, usage-ranked matching as the add-exercise box,
        // falling back to the server's substring search if the list can't load.
        let matches;
        try {
          matches = rankExercises(q, await loadAllExercisesCached(), 20).map((e) => e.name);
        } catch (listErr) {
          matches = (await apiGet(`/api/exercises?q=${encodeURIComponent(q)}`)).exercises;
        }
        if (input.value.trim() !== q) return; // typed further while loading
        suggestions.innerHTML = "";
        matches.forEach((name) => {
          const row = document.createElement("div");
          row.className = "exercise-row";
          row.textContent = name;
          row.addEventListener("click", () => {
            replaceExerciseInWorkout(oldName, name);
            closeTopNavLayer();
          });
          suggestions.appendChild(row);
        });
      } catch (err) {
        suggestions.innerHTML = "";
      }
    }, 200);
  });
}

// Renames the card's slot identity everywhere it's keyed by name -- only
// ever called with zero logged sets for oldName (enforced by the caller),
// so there's no historical-set continuity to preserve, just client-side
// per-exercise state to carry over to the new name.
function replaceExerciseInWorkout(oldName, newName) {
  if (oldName === newName) return;
  const index = activeWorkout.exercises.indexOf(oldName);
  if (index !== -1) activeWorkout.exercises[index] = newName;

  if (activeWorkout.supersets && oldName in activeWorkout.supersets) {
    activeWorkout.supersets[newName] = activeWorkout.supersets[oldName];
    delete activeWorkout.supersets[oldName];
  }
  if (activeWorkout.exerciseNotes && oldName in activeWorkout.exerciseNotes) {
    activeWorkout.exerciseNotes[newName] = activeWorkout.exerciseNotes[oldName];
    delete activeWorkout.exerciseNotes[oldName];
  }
  if (activeWorkout.restOverrides && oldName in activeWorkout.restOverrides) {
    activeWorkout.restOverrides[newName] = activeWorkout.restOverrides[oldName];
    delete activeWorkout.restOverrides[oldName];
  }
  // Previous-performance lookup switches to the new exercise immediately --
  // no cache entry exists yet for newName, so renderActiveScreen's own
  // "fetch if not cached" path handles this with no extra code here.

  persistActiveWorkout();
  renderActiveScreen();
}

// Nothing has synced to the server yet for an in-progress workout, so this
// is pure client-side state surgery -- no API call needed, same reasoning
// as Cancel Workout's own confirm-then-wipe pattern (reused here, just
// scoped to one exercise instead of the whole workout).
async function removeExerciseFromWorkout(exerciseName) {
  if (!(await showConfirmDialog(`Remove ${exerciseName} and all its logged sets from this workout?`, { confirmLabel: "Remove", danger: true }))) {
    return;
  }
  activeWorkout.exercises = activeWorkout.exercises.filter((n) => n !== exerciseName);
  activeWorkout.sets = activeWorkout.sets.filter((s) => s.exercise_name !== exerciseName);
  if (activeWorkout.supersets) delete activeWorkout.supersets[exerciseName];
  if (activeWorkout.exerciseNotes) delete activeWorkout.exerciseNotes[exerciseName];
  if (activeWorkout.restOverrides) delete activeWorkout.restOverrides[exerciseName];
  if (activeWorkout.restPositionOverrides) delete activeWorkout.restPositionOverrides[exerciseName];
  if (activeWorkout.variantByExercise) delete activeWorkout.variantByExercise[exerciseName];
  if (activeWorkout.handleByExercise) delete activeWorkout.handleByExercise[exerciseName];
  if (activeWorkout.gripByExercise) delete activeWorkout.gripByExercise[exerciseName];
  delete pendingHandleGripByExercise[exerciseName];
  delete pendingRpeByExercise[exerciseName];
  delete pendingSetTypeByExercise[exerciseName];
  delete pendingUnilateralByExercise[exerciseName];
  delete pendingSideByExercise[exerciseName];
  delete pendingVariantByExercise[exerciseName];
  delete pendingInputByExercise[exerciseName];
  delete extraSetsByExercise[exerciseName];
  delete dropContinuationByExercise[exerciseName];
  delete previousIndexByExercise[exerciseName];
  persistActiveWorkout();
  renderActiveScreen();
}

function openRestTimerModal(exerciseName) {
  // The exercise-wide default only, deliberately not restSecondsFor's
  // position-aware lookup -- this modal is explicitly about changing what
  // future sets use, not previewing any one already-idle divider's value.
  // Falls back through the same chain restSecondsFor itself uses (workout
  // override, then the persistent per-exercise default, 2026-09-17) so the
  // preset highlighted here always matches what a new set would actually get.
  const persistentDefault = defaultRestCache[exerciseName];
  const current = (activeWorkout.restOverrides && activeWorkout.restOverrides[exerciseName])
    ?? (persistentDefault != null ? persistentDefault : REST_SECONDS_DEFAULT);
  const presets = [60, 90, 120, 180];
  const presetButtons = presets
    .map((s) => `<button data-preset="${s}" class="${s === current ? "active" : ""}">${formatClock(s)}</button>`)
    .join("");
  openModal(`
    <h3>Rest timer &mdash; ${escapeHtml(exerciseName)}</h3>
    <p class="modal-hint">Applies to sets logged from now on in this workout, not already-confirmed sets.</p>
    <div class="rest-preset-grid">${presetButtons}</div>
    <div class="modal-actions">
      <input id="rest-timer-custom" type="number" inputmode="numeric" class="exercise-note-input" placeholder="Custom seconds" value="${current}">
    </div>
    <label class="modal-checkbox-row">
      <input type="checkbox" id="rest-timer-save-default">
      <span>Save as default for future workouts too${persistentDefault != null ? ` (currently ${formatClock(persistentDefault)})` : ""}</span>
    </label>
    <div class="modal-actions">
      <button id="rest-timer-save" class="btn-primary">Save</button>
    </div>
  `);
  modalContent.classList.add("size-compact"); // UI Polish Pass 2026-09-18
  const customInput = modalContent.querySelector("#rest-timer-custom");
  const saveDefaultCheckbox = modalContent.querySelector("#rest-timer-save-default");
  const applyAndClose = async (seconds) => {
    if (!activeWorkout.restOverrides) activeWorkout.restOverrides = {};
    activeWorkout.restOverrides[exerciseName] = seconds;
    persistActiveWorkout();
    // Persistent save is opt-in (unchecked by default) -- ticking it is a
    // deliberate "this is the real new normal for this exercise" decision,
    // distinct from the ordinary case of just wanting different rest for
    // this one workout, which the checkbox being unchecked already covers
    // exactly as before this existed.
    if (saveDefaultCheckbox.checked) {
      try {
        await apiPut(`/api/exercises/${encodeURIComponent(exerciseName)}/default-rest`, { default_rest_sec: seconds });
        defaultRestCache[exerciseName] = seconds;
      } catch (err) {
        alert("Couldn't save as the default (offline?) -- applied to this workout only.");
      }
    }
    closeTopNavLayer();
    // Real bug fixed here (2026-09-19, ImIceTry: "the rest timers don't
    // update, I have to tap every single one manually"). Nothing ever
    // re-rendered after changing the exercise-wide restOverrides value, so
    // every already-rendered idle divider for this exercise kept showing
    // whatever target it was drawn with at last render -- tapping one
    // individually "worked" only because that opens openRestEditNumpad,
    // which sets its own per-position override and re-renders itself.
    // A position that already has its own override (restPositionOverrides)
    // still correctly ignores this exercise-wide change either way, same
    // as before -- restSecondsFor's own priority chain is unaffected,
    // this just makes everything without one actually redraw.
    renderActiveScreen();
  };
  // Tapping a preset used to call applyAndClose directly, saving and
  // closing the modal in one tap -- ImIceTry's ask (2026-09-19): a preset
  // should just select/highlight it, same as typing a custom value, with
  // Save as the one real commit action either way (otherwise Save reads
  // as pointless dead weight next to a preset).
  modalContent.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      customInput.value = btn.dataset.preset;
      modalContent.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
  modalContent.querySelector("#rest-timer-save").addEventListener("click", () => {
    const seconds = parseInt(customInput.value, 10);
    if (!Number.isFinite(seconds) || seconds < 0) {
      alert("Enter a valid number of seconds.");
      return;
    }
    applyAndClose(seconds);
  });
}

// Notes are stored client-side per exercise for the duration of the workout
// (activeWorkout.exerciseNotes), then folded onto the *first* logged set for
// that exercise right before syncing -- sets.notes is the only note-carrying
// column that exists server-side, there's no separate exercise-level note
// table (per the plan's explicit choice, checked against sync_workout's
// payload shape first). An exercise with zero logged sets has nothing to
// carry the note to and it's simply not sent -- there's no other place for
// it to live.
function applyExerciseNotesToSets(sets, exerciseNotes) {
  if (!exerciseNotes) return sets;
  const appliedTo = new Set();
  return sets.map((s) => {
    const note = exerciseNotes[s.exercise_name];
    if (note && !appliedTo.has(s.exercise_name)) {
      appliedTo.add(s.exercise_name);
      return { ...s, notes: s.notes ? `${s.notes} ${note}`.trim() : note };
    }
    return s;
  });
}
