// ---------- reorder mode (moved from app.js, 2026-09-17) ----------

function enterReorderMode() {
  if (reorderMode || buildingTemplateMode) return;
  reorderMode = true;
  reorderExercises = [...orderedExerciseList()];
  if (hapticsEnabled() && navigator.vibrate) navigator.vibrate(15);
  document.addEventListener("pointermove", handleReorderPointerMove);
  document.addEventListener("pointerup", handleReorderPointerUp);
  document.addEventListener("pointercancel", handleReorderPointerUp);
  crossfadeExerciseList(renderActiveScreen);
}

function exitReorderMode(commit) {
  reorderMode = false;
  reorderDragIndex = null;
  document.removeEventListener("pointermove", handleReorderPointerMove);
  document.removeEventListener("pointerup", handleReorderPointerUp);
  document.removeEventListener("pointercancel", handleReorderPointerUp);
  if (commit) {
    activeWorkout.exercises = [...reorderExercises];
    persistActiveWorkout();
  }
  crossfadeExerciseList(renderActiveScreen);
}

// UI Polish Pass (2026-09-18), item 4's second half -- entering/exiting
// reorder mode used to swap the whole exercise list's content instantly
// (a normal-cards <-> handle-and-name-only content swap, not a real
// navigation), which read as an abrupt cut next to the FLIP-animated drag
// itself. A plain crossfade communicates "the content changed" without
// implying spatial movement that isn't actually happening. #exercise-list
// itself is never replaced by renderActiveScreen (only its innerHTML is),
// so the same element reference is valid before and after swapFn() runs.
// The 140ms setTimeout must match --motion-fast (style-base.css) -- kept
// as a plain literal since JS can't read a CSS custom property as a
// timing number without an extra getComputedStyle round-trip for one value.
//
// Real height morph added on top of the plain fade (2026-09-18, ImIceTry's
// follow-up: the fade alone still read as "choppy" -- he wanted to
// actually SEE the full set rows collapse down into just names, not have
// the page silently jump to a new height underneath a fade). Pins the
// container at its pre-swap height during the fade-out (so nothing jumps
// yet), then -- once the new content is already in the DOM -- transitions
// height down to the new content's own natural height while it fades in,
// so the list visibly shrinks into its collapsed (or grows back into its
// full) state instead of snapping there instantly. explicit height is
// released back to auto once settled so later content changes (e.g.
// scrolling mid-drag) aren't clipped by a stale fixed value.
function crossfadeExerciseList(swapFn) {
  const listEl = document.getElementById("exercise-list");
  if (!listEl) { swapFn(); return; }
  const fromHeight = listEl.getBoundingClientRect().height;
  listEl.style.height = `${fromHeight}px`;
  listEl.style.overflow = "hidden";
  listEl.style.transition = `opacity var(--motion-fast) var(--motion-ease)`;
  listEl.style.opacity = "0";
  setTimeout(() => {
    swapFn();
    const toHeight = listEl.scrollHeight;
    listEl.style.transition = "none";
    listEl.style.height = `${fromHeight}px`; // hold at the old height -- no jump yet
    listEl.style.opacity = "0";
    listEl.getBoundingClientRect(); // flush layout so the transition below isn't coalesced away
    listEl.style.transition = `opacity var(--motion-fast) var(--motion-ease), height var(--motion-base) var(--motion-ease)`;
    listEl.style.height = `${toHeight}px`;
    listEl.style.opacity = "1";
    setTimeout(() => {
      listEl.style.height = "";
      listEl.style.overflow = "";
    }, 220);
  }, 140);
}

// FLIP animation (UI Polish Pass, 2026-09-18, item 4) -- was a pure
// splice-then-innerHTML-rebuild, so every *displaced* row (everything but
// the one actually being dragged) teleported straight to its new position
// on each move instead of visibly sliding there. Rows are now keyed by
// exercise name (data-exercise-name) rather than positional index, so a
// row's identity survives across a reorder and its First/Last rects can
// be compared correctly even though the whole list is still torn down and
// rebuilt each move (a real persistent-node approach isn't needed here --
// only the *visual* motion was missing, not the DOM identity itself).
function renderReorderRows() {
  const container = document.getElementById("reorder-rows");
  if (!container) return;
  const firstRects = new Map();
  Array.from(container.children).forEach((row) => {
    if (row.dataset.exerciseName) firstRects.set(row.dataset.exerciseName, row.getBoundingClientRect());
  });
  container.innerHTML = "";
  reorderExercises.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "exercise-reorder-row" + (i === reorderDragIndex ? " dragging" : "");
    row.dataset.index = i;
    row.dataset.exerciseName = name;
    row.innerHTML = `<span class="reorder-handle">&#9776;</span><span class="reorder-name">${escapeHtml(name)}</span>`;
    row.querySelector(".reorder-handle").addEventListener("pointerdown", (e) => {
      reorderDragIndex = i;
      playClickSound();
      if (hapticsEnabled() && navigator.vibrate) navigator.vibrate(10);
      renderReorderRows();
    });
    container.appendChild(row);
  });
  Array.from(container.children).forEach((row) => {
    const first = firstRects.get(row.dataset.exerciseName);
    if (!first) return;
    const last = row.getBoundingClientRect();
    const dy = first.top - last.top;
    if (Math.abs(dy) < 1) return;
    row.style.transition = "none";
    row.style.transform = `translateY(${dy}px)`;
    // Force a layout flush before clearing transform/transition -- without
    // it the browser can coalesce the "none" and the real transition into
    // one paint and skip the animation entirely (the same reason every
    // other FLIP implementation needs this line, not specific to this app).
    row.getBoundingClientRect();
    requestAnimationFrame(() => {
      row.style.transition = `transform var(--motion-base) var(--motion-ease)`;
      row.style.transform = "";
    });
  });
}

function handleReorderPointerMove(e) {
  if (reorderDragIndex == null) return;
  const container = document.getElementById("reorder-rows");
  if (!container) return;
  const rows = Array.from(container.children);
  let targetIndex = rows.findIndex((row) => {
    const rect = row.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2;
  });
  if (targetIndex === -1) targetIndex = rows.length - 1;
  if (targetIndex !== reorderDragIndex) {
    const [moved] = reorderExercises.splice(reorderDragIndex, 1);
    reorderExercises.splice(targetIndex, 0, moved);
    reorderDragIndex = targetIndex;
    renderReorderRows();
  }
}

function handleReorderPointerUp() {
  if (reorderDragIndex == null) return;
  reorderDragIndex = null;
  renderReorderRows();
}
