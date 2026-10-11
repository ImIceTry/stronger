// ---------- docked panel (RPE picker; Phase 3's numpad reuses this) ----------
// Unlike the modal system below, this has no dimmed backdrop -- it's
// anchored to the bottom of the viewport, matching Strong's own RPE picker
// (active-workout-rpe-picker.jpg), not a centered sheet over a scrim.
// "Tap outside" is detected via a real document-level listener (armed on
// open, removed on close) rather than a dedicated overlay element, since
// there's no overlay for an outside tap to land on.

const dockedPanel = document.getElementById("docked-panel");
let dockedPanelOutsideTapListener = null;
// The callback a physical back-press should fire -- always the same
// function as whatever this open/re-render passed as onOutsideTap, so back
// gets the exact same commit-pending-value-or-discard semantics as tapping
// outside (RPE commits the preview, numpad just discards -- see each
// caller). Retargeted on every openDockedPanel call, including re-renders
// mid-session (numpad's goNext, RPE resuming into it), so back always fires
// whichever step is actually current.
let dockedPanelCurrentOutsideTap = null;

// Real bug fixed here (2026-09-18, ImIceTry: numpad covers the sets on the
// very last exercise, can't see what he's typing). The docked panel is
// `position: fixed`, so it floats over the page instead of pushing
// scrollable content up -- for any exercise with more cards below it, that
// covered strip at the very bottom of the viewport just lands on content
// the user isn't looking at anyway. The LAST exercise has nothing below it
// to absorb that, so once scrolled to the bottom (the natural resting
// position while working through it), the panel lands directly over the
// very rows being edited, with no scroll room left to clear them.
// Reserves exactly the panel's own real height (measured, not guessed --
// numpad/RPE-picker/rest-edit are all slightly different heights) as extra
// bottom padding on the active-workout screen's scrollable body while any
// docked panel is open, restored on close. Harmless when a docked panel
// opens from a different screen (e.g. the Exercises tab's chart-range
// picker) -- .active-overlay-body is simply hidden/inert then, so padding
// it has no visible effect.
const activeOverlayBody = document.querySelector(".active-overlay-body");

function openDockedPanel(html, onOutsideTap) {
  dockedPanel.innerHTML = html;
  dockedPanel.classList.remove("hidden");
  if (activeOverlayBody) {
    // Extra padding alone only extends how FAR you COULD scroll -- it
    // doesn't move the current scroll position, so a field already sitting
    // at the old bottom edge stays exactly where it is, still covered.
    // Snapping scroll to the new max only when already near the old
    // bottom (not on every open) targets exactly the reported case --
    // tapping a field in the middle of the page shouldn't yank the scroll
    // position around, since nothing was covered there to begin with.
    const wasNearBottom = activeOverlayBody.scrollHeight - activeOverlayBody.scrollTop - activeOverlayBody.clientHeight < 40;
    activeOverlayBody.style.paddingBottom = `${dockedPanel.getBoundingClientRect().height + 16}px`;
    if (wasNearBottom) {
      activeOverlayBody.scrollTop = activeOverlayBody.scrollHeight - activeOverlayBody.clientHeight;
    }
  }
  if (dockedPanelOutsideTapListener) {
    document.removeEventListener("click", dockedPanelOutsideTapListener, true);
  }
  dockedPanelOutsideTapListener = (e) => {
    // Passes the real tap target through (2026-09-18) so a caller can tell
    // "tapped a specific other element" apart from a generic outside tap --
    // the numpad uses this to recognize a tap on this same row's other
    // linked field and swap to it instead of closing (see openNumpad's own
    // comment). closeDockedPanelViaNav (the back-button path) still calls
    // this with no target at all, which callers should treat the same as
    // a plain outside tap.
    if (!dockedPanel.contains(e.target)) onOutsideTap(e.target);
  };
  // capture phase so this still fires even if the tapped element elsewhere
  // (e.g. another icon button) would otherwise stop propagation
  document.addEventListener("click", dockedPanelOutsideTapListener, true);
  dockedPanelCurrentOutsideTap = onOutsideTap;
  // One stable nav-layer entry per panel session, not one per re-render --
  // same dedup guard as openModal/openTemplatePreview, needed because
  // openDockedPanel gets called again while already on top (numpad
  // advancing fields, RPE resuming a numpad session).
  const top = navLayers[navLayers.length - 1];
  if (!top || top.onClose !== closeDockedPanelViaNav) {
    pushNavLayer(closeDockedPanelViaNav);
  }
}

// The nav-layer onClose target -- a stable function reference (not a fresh
// closure per call) so the dedup guard above can recognize "already open."
function closeDockedPanelViaNav() {
  if (dockedPanelCurrentOutsideTap) dockedPanelCurrentOutsideTap();
}

function closeDockedPanel() {
  dockedPanel.classList.add("hidden");
  dockedPanel.innerHTML = "";
  if (activeOverlayBody) activeOverlayBody.style.paddingBottom = "";
  if (dockedPanelOutsideTapListener) {
    document.removeEventListener("click", dockedPanelOutsideTapListener, true);
    dockedPanelOutsideTapListener = null;
  }
  dockedPanelCurrentOutsideTap = null;
  // Keep navLayers truthful even when this is called directly rather than
  // through closeTopNavLayer (every real close path goes through here:
  // RPE's commit(), the numpad's own outside-tap/goNext-on-last-field) --
  // and consume the browser's own history entry to match (see
  // handlingPopstate above), not just the in-memory array.
  const top = navLayers[navLayers.length - 1];
  if (top && top.onClose === closeDockedPanelViaNav) {
    navLayers.pop();
    if (!handlingPopstate) history.back();
  }
}

// ---------- back-button-dismissible layers ----------
// Shared by every modal/full-screen drill-in that the phone's physical back
// button should dismiss instead of leaving the app (the calendar, the
// template preview, History's workout detail, the Exercises tab's exercise
// detail, every popup that goes through openModal -- options menus, add
// note, sticky note, rest timer, superset/replace pickers, etc. -- plus the
// numpad/RPE docked-panel and the active-workout overlay, both wired in
// 2026-09-09). The docked panel's onClose is literally its own
// onOutsideTap, so back gets the exact same commit-or-discard semantics as
// an outside tap, per picker -- no new semantics invented. The overlay's
// onClose is the same function its own collapse button uses (never cancel
// or finish, both of which stay explicit-button-only given this is the
// app's most safety-critical flow with 4+ real exit paths).
//
// Every close path (an explicit X/back-arrow tap, tapping outside, the
// phone's real back button) converges on the SAME place -- the popstate
// handler below -- so there is only ever one way a layer actually closes,
// and the two trigger paths can never desync from each other.
// Each pushed layer gets a unique, always-increasing id rather than being
// tracked by array position/depth -- some transitions close one layer and
// immediately push a different one in the same gesture (e.g. tapping a
// calendar day closes the calendar and opens that workout's detail), which
// can coincidentally leave the array back at the same length it was at
// before, even though a real, different history entry now sits underneath.
// A raw depth comparison can't tell those two moments apart; a monotonic id
// always can, since a layer pushed later always has a strictly higher id
// than one pushed earlier, however the array length happens to look.
// Seeded from whatever navLayerId (if any) is already sitting on the
// current history entry, not always 0 -- a same-document reload (pull to
// refresh mid-modal, a service-worker update) resets this in-memory counter
// but NOT the browser's own history stack, which can still hold a stale
// pushState from before the reload. Without this seed, a freshly pushed
// layer can coincidentally get the same id the stale entry already had,
// and the popstate handler's `> targetId` check then silently no-ops on
// the very next back-press instead of closing anything.
let navLayerCounter = (history.state && history.state.navLayerId) || 0;
const navLayers = []; // stack of {id, onClose}, top = most recently opened

function pushNavLayer(onClose) {
  const entry = { id: ++navLayerCounter, onClose };
  navLayers.push(entry);
  history.pushState({ navLayerId: entry.id }, "");
}

// Call this from every explicit in-app close trigger instead of calling a
// layer's own close function directly.
function closeTopNavLayer() {
  if (navLayers.length > 0) history.back();
}

// True only while the popstate handler below is actively unwinding layers
// for a real back-navigation. Every direct-close path (closeDockedPanel,
// closeModal, hideActiveWorkoutOverlay, closeTemplatePreview) pops its own
// navLayers entry without ever calling history.back() -- that silently left
// the browser's own history stack one entry ahead of navLayers every time
// (2026-09-10 bug report: the active-workout collapse button "randomly"
// doing nothing until a refresh -- the first press only retraced that
// phantom entry, the second press was the one that actually closed
// anything). Fix: direct closes below also fire a compensating
// history.back(), guarded by this flag so that call's own popstate doesn't
// try to close a second, unrelated layer.
let handlingPopstate = false;

window.addEventListener("popstate", (e) => {
  handlingPopstate = true;
  try {
    const targetId = e.state && e.state.navLayerId;
    // Close every layer pushed more recently than wherever we've actually
    // landed -- not just the top one, in case more than one was somehow
    // skipped past in a single navigation.
    while (navLayers.length > 0 && (targetId == null || navLayers[navLayers.length - 1].id > targetId)) {
      const entry = navLayers.pop();
      entry.onClose();
    }
  } finally {
    handlingPopstate = false;
  }
});

// ---------- native Android hardware back button (Capacitor) ----------
// Real bug fixed here (2026-09-18, ImIceTry: "right now I keep closing the
// app instead of whatever menu I have opened"). Everything above this
// point (navLayers, closeTopNavLayer, per-layer onClose semantics) was
// already correct and battle-tested against the PWA's own back gesture --
// the native Android wrap just never delivered the hardware back button to
// any of it. Capacitor 4+ deliberately removed its old automatic
// "hardware back -> webView.goBack()" default (a documented breaking
// change); apps have to explicitly listen for it via @capacitor/app now.
// Without that listener, a bare `BridgeActivity` (this app's MainActivity
// has no back-press override of its own) just finishes/exits the Activity
// on every single press, regardless of what's open in the WebView --
// exactly the symptom reported. Routes the hardware button through the
// exact same closeTopNavLayer()/history.back() path a browser back-gesture
// already uses, so every layer's own existing close behavior (numpad
// discards, side panel closes, the active-workout overlay collapses to the
// mini-bar rather than exiting) keeps working unchanged; only truly
// nothing-open (bare Home/History/etc.) falls through to actually exiting.
//
// Needs @capacitor/app installed + `npx cap sync android` + a Gradle
// rebuild before this does anything on-device -- none of which docker-host
// has the toolchain for (see workout-app-native-build-stale in Open
// Items). Guarded so it's a silent no-op on the plain PWA/browser, which
// never has window.Capacitor.
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
  window.Capacitor.Plugins.App.addListener("backButton", () => {
    if (navLayers.length > 0) {
      closeTopNavLayer();
    } else {
      window.Capacitor.Plugins.App.exitApp();
    }
  });
}

// ---------- modal (RPE picker, superset picker) ----------

const modalOverlay = document.getElementById("modal-overlay");
const modalContent = document.getElementById("modal-content");

function openModal(html) {
  modalContent.innerHTML = html;
  modalOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden"; // stop the page behind from intercepting scroll gestures
  // Several flows close one modal's content and immediately open another
  // (e.g. the options menu's "Create superset" row calling openSupersetPicker)
  // -- that's one visible overlay swapping content, not two stacked layers,
  // so only push a fresh nav layer if the overlay wasn't already the top of
  // the stack. Without this guard a single back-press would only unwind one
  // of the two pushes, leaving a phantom entry that eats the next back-press
  // with nothing visible to show for it.
  const top = navLayers[navLayers.length - 1];
  if (!top || top.onClose !== closeModal) {
    pushNavLayer(closeModal);
  }
}

function closeModal() {
  modalOverlay.classList.add("hidden");
  modalContent.innerHTML = "";
  modalContent.className = "modal-content"; // reset any size modifier (e.g. calendar-modal)
  document.body.style.overflow = "";
  // Keep navLayers truthful even when this is called directly rather than
  // through closeTopNavLayer -- e.g. right before a different kind of layer
  // opens in the same gesture (a calendar day tap closes this modal and
  // opens that workout's detail in one motion).
  const top = navLayers[navLayers.length - 1];
  if (top && top.onClose === closeModal) navLayers.pop();
}

// App-styled replacement for the browser's native confirm() (2026-09-18,
// ImIceTry: the discard-workout/discard-edits prompt "looks like a system
// notification... make it look like actually part of the app design").
// Same real-modal shape askUnfinishedSetsChoice/askTemplateUpdateChoice
// already use (openModal + a Promise resolved from a button tap), not a
// new dialog system. danger:true swaps the confirm button to the same red
// #e0503c accent Delete labels already use elsewhere, for a destructive
// action (delete workout/template/folder) rather than a plain discard.
const confirmDialogOverlay = document.getElementById("confirm-dialog-overlay");
const confirmDialogEl = document.getElementById("confirm-dialog");
let confirmDialogResolve = null;

function closeConfirmDialog(result) {
  confirmDialogOverlay.classList.add("hidden");
  confirmDialogEl.innerHTML = "";
  // Same direct-close-consumes-its-own-history-entry shape closeDockedPanel/
  // closeSidePanel already use -- pop the JS array and, unless a popstate is
  // already mid-unwind, spend one real history.back() to match, so a
  // confirm-button tap and a real back-press/tap-outside dismiss stay
  // perfectly equivalent in what they leave behind.
  const top = navLayers[navLayers.length - 1];
  if (top && top.onClose === closeConfirmDialogViaNav) {
    navLayers.pop();
    if (!handlingPopstate) history.back();
  }
  if (confirmDialogResolve) {
    const resolve = confirmDialogResolve;
    confirmDialogResolve = null;
    resolve(result);
  }
}

// The nav-layer onClose target -- back button or tapping outside both
// resolve false, matching a real confirm()'s own Cancel/Escape semantics.
function closeConfirmDialogViaNav() {
  closeConfirmDialog(false);
}

function showConfirmDialog(message, opts) {
  opts = opts || {};
  const confirmLabel = opts.confirmLabel || "Confirm";
  const cancelLabel = opts.cancelLabel || "Cancel";
  return new Promise((resolve) => {
    confirmDialogResolve = resolve;
    confirmDialogEl.innerHTML = `
      <p class="modal-hint">${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button id="confirm-dialog-confirm" class="btn-primary${opts.danger ? " btn-danger" : ""}">${escapeHtml(confirmLabel)}</button>
      </div>
      <div class="modal-actions">
        <button id="confirm-dialog-cancel" class="btn-secondary">${escapeHtml(cancelLabel)}</button>
      </div>
    `;
    confirmDialogOverlay.classList.remove("hidden");
    pushNavLayer(closeConfirmDialogViaNav);
    confirmDialogEl.querySelector("#confirm-dialog-confirm").addEventListener("click", () => closeConfirmDialog(true));
    confirmDialogEl.querySelector("#confirm-dialog-cancel").addEventListener("click", () => closeConfirmDialog(false));
  });
}

confirmDialogOverlay.addEventListener("click", (e) => {
  if (e.target === confirmDialogOverlay) closeTopNavLayer();
});

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeTopNavLayer();
});

// ---------- side panel (exercise options, exercise-detail/workout-detail/
// template "..." menus -- UI Polish Pass, 2026-09-18, item 3) ----------
// Structured identically to the modal system above (real backdrop,
// tap-outside-to-close via the overlay's own click handler, same dedup-
// guard/nav-layer bookkeeping) rather than the docked-panel's no-backdrop
// pattern -- this has a real scrim, so it belongs with the system that
// already handles that shape, not the one that doesn't.

const sidePanelOverlay = document.getElementById("side-panel-overlay");
const sidePanel = document.getElementById("side-panel");

function openSidePanel(title, rowsHtml) {
  sidePanel.innerHTML = `<div class="side-panel-title">${escapeHtml(title)}</div>${rowsHtml}`;
  sidePanelOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  const top = navLayers[navLayers.length - 1];
  if (!top || top.onClose !== closeSidePanel) {
    pushNavLayer(closeSidePanel);
  }
}

function closeSidePanel() {
  sidePanelOverlay.classList.add("hidden");
  sidePanel.innerHTML = "";
  document.body.style.overflow = "";
  const top = navLayers[navLayers.length - 1];
  if (top && top.onClose === closeSidePanel) navLayers.pop();
}

sidePanelOverlay.addEventListener("click", (e) => {
  if (e.target === sidePanelOverlay) closeTopNavLayer();
});
