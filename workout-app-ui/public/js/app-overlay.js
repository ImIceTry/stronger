// ---------- active workout overlay + mini-bar ----------
// The active workout is NOT one of the tab screens -- it's a full-screen
// overlay that floats on top of whichever tab is selected underneath, so you
// can back out to History/Exercises/Profile mid-workout and still see it's
// running via the mini-bar, then jump back in from anywhere.

let activeOverlayOpen = false;

function showActiveWorkoutOverlay() {
  activeOverlayOpen = true;
  document.getElementById("active-overlay").classList.remove("hidden");
  updateMiniBar();
  renderActiveScreen();
  // Physical back collapses to the mini-bar -- the same, safe thing the
  // collapse button does -- rather than leaving the app. Deliberately NOT
  // cancel or finish: those stay explicit-button-only actions, since this
  // is the app's most safety-critical flow. Dedup-guarded like
  // openModal/openTemplatePreview since this can be called again (mini-bar
  // tap) once the overlay's already the top layer -- though in practice the
  // mini-bar only shows when the overlay is closed.
  const top = navLayers[navLayers.length - 1];
  if (!top || top.onClose !== hideActiveWorkoutOverlay) {
    pushNavLayer(hideActiveWorkoutOverlay);
  }
}

function hideActiveWorkoutOverlay() {
  activeOverlayOpen = false;
  document.getElementById("active-overlay").classList.add("hidden");
  clearInterval(elapsedTimerHandle);
  updateMiniBar();
  // Keep navLayers truthful even when this is called directly (Cancel,
  // Finish, Save) rather than through closeTopNavLayer -- and consume the
  // browser's own history entry to match (see handlingPopstate above).
  const top = navLayers[navLayers.length - 1];
  if (top && top.onClose === hideActiveWorkoutOverlay) {
    navLayers.pop();
    if (!handlingPopstate) history.back();
  }
}

function updateMiniBar() {
  const bar = document.getElementById("mini-bar");
  const show = activeWorkout && !activeOverlayOpen;
  bar.classList.toggle("hidden", !show);
  document.body.classList.toggle("mini-bar-visible", show);
  if (show) {
    document.getElementById("mini-bar-name").textContent =
      editingWorkoutId != null ? `Editing: ${activeWorkout.name}` : activeWorkout.name;
    if (editingWorkoutId == null) startElapsedTimer(); // keeps ticking while collapsed
  }
}

document.getElementById("btn-collapse-active").addEventListener("click", closeTopNavLayer);
document.getElementById("mini-bar").addEventListener("click", showActiveWorkoutOverlay);
document.getElementById("btn-manual-timer").addEventListener("click", openManualTimerModal);
document.getElementById("btn-stop-manual-timer").addEventListener("click", () => stopManualTimer(false));

// Standalone timer, started from the top-bar circle icon (2026-09-13,
// ImIceTry's own ask) -- a plain countdown independent of any per-set rest
// timer, for things like a plank hold or a between-exercises breather.
// Reuses the same preset-grid + custom-seconds pattern as
// openRestTimerModal above, but starting a countdown instead of saving a
// default. Picking a new duration while one's already running just
// restarts it (startManualTimer clears the old interval first).
function openManualTimerModal() {
  const presets = [60, 120, 180, 240];
  const presetButtons = presets.map((s) => `<button data-preset="${s}">${formatClock(s)}</button>`).join("");
  openModal(`
    <h3>Timer</h3>
    <p class="modal-hint">A standalone timer, separate from any exercise's rest timer.</p>
    <div class="rest-preset-grid">${presetButtons}</div>
    <div class="modal-actions">
      <input id="manual-timer-custom" type="number" inputmode="numeric" class="exercise-note-input" placeholder="Custom seconds">
    </div>
    <div class="modal-actions">
      <button id="manual-timer-start" class="btn-primary">Start</button>
    </div>
  `);
  const customInput = modalContent.querySelector("#manual-timer-custom");
  const startAndClose = (seconds) => {
    closeTopNavLayer();
    startManualTimer(seconds);
  };
  modalContent.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => startAndClose(parseInt(btn.dataset.preset, 10)));
  });
  modalContent.querySelector("#manual-timer-start").addEventListener("click", () => {
    const seconds = parseInt(customInput.value, 10);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      alert("Enter a valid number of seconds.");
      return;
    }
    startAndClose(seconds);
  });
}

function startManualTimer(seconds) {
  clearInterval(manualTimerHandle);
  manualTimerContext = { remaining: seconds, total: seconds };
  const bar = document.getElementById("manual-timer-bar");
  const tick = bar.querySelector(".manual-timer-tick");
  const progress = bar.querySelector(".manual-timer-progress");
  bar.classList.remove("hidden");
  const update = () => {
    tick.textContent = formatClock(manualTimerContext.remaining);
    const pct = manualTimerContext.total > 0 ? Math.max(0, Math.min(100, (manualTimerContext.remaining / manualTimerContext.total) * 100)) : 0;
    progress.style.width = `${pct}%`;
  };
  update();
  manualTimerHandle = setInterval(() => {
    manualTimerContext.remaining -= 1;
    if (manualTimerContext.remaining <= 0) {
      stopManualTimer(true);
      return;
    }
    update();
  }, 1000);
}

// natural: true when the countdown actually reached 0 (gets the completion
// buzz), false when stopped early via the bar's own ✕ (silent, same as the
// per-set rest timer's Skip control never buzzing either).
function stopManualTimer(natural) {
  clearInterval(manualTimerHandle);
  manualTimerHandle = null;
  manualTimerContext = null;
  document.getElementById("manual-timer-bar").classList.add("hidden");
  if (natural && hapticsEnabled() && navigator.vibrate) navigator.vibrate([80, 60, 80]);
}

// Drag-to-dismiss on the top bar (2026-09-12, ImIceTry's own ask) -- pulling
// the sheet down past a distance/velocity threshold collapses it to the
// mini-bar, same end state as tapping the ▼ collapse button
// (closeTopNavLayer). A drag that doesn't clear the threshold snaps back
// to fully open instead of committing halfway -- there's no "partially
// open" resting state for this sheet, only open or collapsed.
(function wireActiveOverlayDragToDismiss() {
  const bar = document.getElementById("active-bar");
  const overlay = document.getElementById("active-overlay");
  const DISMISS_DISTANCE = 120;
  const DISMISS_VELOCITY = 0.6; // px/ms
  let startY = 0;
  let startTime = 0;
  let dragging = false;

  bar.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    startTime = Date.now();
    dragging = false;
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* already released, harmless */ }
  });
  bar.addEventListener("pointermove", (e) => {
    const dy = e.clientY - startY;
    if (!dragging) {
      if (dy < 8) return; // ignore small jitter and any upward movement
      dragging = true;
      overlay.classList.add("dragging");
    }
    overlay.style.transform = `translateY(${Math.max(0, dy)}px)`;
  });
  const finish = (e) => {
    if (!dragging) return;
    dragging = false;
    overlay.classList.remove("dragging");
    const dy = Math.max(0, e.clientY - startY);
    const velocity = dy / Math.max(1, Date.now() - startTime);
    overlay.style.transform = "";
    if (dy > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
      closeTopNavLayer();
    }
  };
  bar.addEventListener("pointerup", finish);
  bar.addEventListener("pointercancel", finish);
})();

// Reverse of the drag above (2026-09-13, ImIceTry's own ask) -- pulling up on
// the collapsed mini-bar reopens the full sheet, tracking the finger the
// same 1:1 way and snapping to fully open/closed on release. Tapping the
// mini-bar (existing listener above) still works as a shortcut for the
// same open action; this only engages once a drag clears the jitter guard.
(function wireMiniBarDragToOpen() {
  const bar = document.getElementById("mini-bar");
  const overlay = document.getElementById("active-overlay");
  const OPEN_DISTANCE = 60;
  const OPEN_VELOCITY = 0.5; // px/ms
  let startY = 0;
  let startTime = 0;
  let dragging = false;

  bar.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    startTime = Date.now();
    dragging = false;
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* already released, harmless */ }
  });
  bar.addEventListener("pointermove", (e) => {
    const dy = startY - e.clientY; // positive = dragged upward
    if (!dragging) {
      if (dy < 8) return; // ignore small jitter and any downward movement
      dragging = true;
      // Real state (activeOverlayOpen, mini-bar visibility) only commits on
      // release -- during the drag this is purely visual, sheet content
      // rendered ahead of time so there's nothing left to pop in once it's
      // dragged into view.
      renderActiveScreen();
      overlay.classList.remove("hidden");
      overlay.classList.add("dragging");
    }
    const clamped = Math.max(0, dy);
    overlay.style.transform = `translateY(calc(100% - ${clamped}px))`;
  });
  const finish = (e) => {
    if (!dragging) return;
    dragging = false;
    overlay.classList.remove("dragging");
    const dy = Math.max(0, startY - e.clientY);
    const velocity = dy / Math.max(1, Date.now() - startTime);
    overlay.style.transform = "";
    if (dy > OPEN_DISTANCE || velocity > OPEN_VELOCITY) {
      showActiveWorkoutOverlay();
    } else {
      overlay.classList.add("hidden"); // didn't clear the threshold -- back to collapsed
    }
  };
  bar.addEventListener("pointerup", finish);
  bar.addEventListener("pointercancel", finish);
})();

document.getElementById("btn-cancel-workout").addEventListener("click", async () => {
  const wasEditing = editingWorkoutId != null;
  const wasBuildingTemplate = buildingTemplateMode;
  const confirmMessage = wasBuildingTemplate
    ? "Discard this template?"
    : wasEditing ? "Discard these edits?" : "Cancel this workout? Everything logged will be lost.";
  // App-styled dialog, not the browser's native confirm() (2026-09-18,
  // ImIceTry: it "looks like a system notification... make it look like
  // actually part of the app design") -- see showConfirmDialog's own
  // comment (app-nav.js).
  if (!(await showConfirmDialog(confirmMessage, { confirmLabel: "Discard", danger: true }))) {
    return;
  }
  clearInterval(restTimerHandle);
  restTimerContext = null;
  parallelRestTimers = [];
  activeWorkout = null;
  editingWorkoutId = null;
  buildingTemplateMode = false;
  persistActiveWorkout();
  hideActiveWorkoutOverlay();
  stopWorkoutForegroundNotification();
  showScreen(wasEditing ? "history" : "home");
});
