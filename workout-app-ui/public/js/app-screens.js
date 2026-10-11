// ---------- collapsing large title ----------
// The page's own big <h1> is the only title element -- it docks (via
// position: sticky, see style.css) at the very top of the screen as you
// scroll, right where #topbar sits, and this shrinks its text in place over
// the last bit of approach, so it reads as one title morphing smaller and
// settling into that spot rather than a second compact title appearing.
// #topbar itself is a fixed overlay, not part of the document flow (see
// style.css), so it has no reserved space of its own for the title to dock
// below -- instead its opacity fades out over the same approach, driven by
// the same progress value below, so the version number/sync badge just
// dissolve as a title arrives rather than the two ever visually colliding.
const TITLE_DOCK_OFFSET = 0; // where the title's sticky "top" lands -- style.css .page-title must match
const TITLE_MIN_SCALE = 0.62;
const topbarEl = document.getElementById("topbar");
let titleScrollHandler = null;
let titleScrollTicking = false;

function setupCollapsingTitle(screenEl) {
  if (titleScrollHandler) {
    window.removeEventListener("scroll", titleScrollHandler);
    titleScrollHandler = null;
  }
  const header = screenEl && screenEl.querySelector(":scope > .section-header");
  const h1 = header && header.querySelector("h1");
  if (!header || !h1) {
    // Screens with no collapsing title of their own (exercise-detail,
    // workout-detail -- both back-button screens, see showScreenRaw) never
    // fade the bar out, so make sure it's not left faded from whichever
    // screen was active before this one.
    topbarEl.style.opacity = "1";
    return;
  }
  header.classList.add("page-title");

  // The approach distance is captured fresh each time a screen is shown
  // (this runs at scrollY effectively 0 for the newly-visible screen) --
  // not a fixed px guess, since the header's natural resting distance from
  // its dock point isn't the same constant on every screen/device (differs
  // with content above it, viewport safe-area insets, etc). A fixed guess
  // here previously meant progress was already partway to 1 at rest instead
  // of starting clean at 0.
  const restingDistance = Math.max(1, header.getBoundingClientRect().top - TITLE_DOCK_OFFSET);

  const applyScale = () => {
    titleScrollTicking = false;
    // Once stuck, rect.top clamps to TITLE_DOCK_OFFSET and stays there --
    // that's what makes this "distance to stick" hit 0 and stay fully
    // shrunk, rather than tracking raw (and screen-dependent) scrollY.
    const distanceToStick = header.getBoundingClientRect().top - TITLE_DOCK_OFFSET;
    const progress = Math.min(1, Math.max(0, 1 - distanceToStick / restingDistance));
    h1.style.setProperty("--title-scale", (1 - progress * (1 - TITLE_MIN_SCALE)).toFixed(3));
    topbarEl.style.opacity = (1 - progress).toFixed(3);
  };
  titleScrollHandler = () => {
    if (titleScrollTicking) return;
    titleScrollTicking = true;
    requestAnimationFrame(applyScale);
  };
  applyScale();
  window.addEventListener("scroll", titleScrollHandler, { passive: true });
}

// ---------- screens ----------

function showScreen(name) {
  // Tapping "Workout" while a workout is already running opens the overlay
  // instead of navigating to that tab's own content -- the overlay floats
  // independent of tab selection, so this deliberately does NOT touch which
  // underlying tab is selected (collapsing later returns you to wherever
  // you actually were, not to the Workout tab).
  if (name === "home" && activeWorkout) {
    showActiveWorkoutOverlay();
    return;
  }
  // Jumping straight to a bottom-nav tab (rather than pressing back out of
  // whatever drill-in/modal is open) bypasses the whole back-button system
  // below -- any layer still sitting in navLayers is now stale (its close
  // callback would show the wrong screen if a later back-press resurrected
  // it), so drop them. Their already-pushed history entries are harmlessly
  // orphaned rather than cleaned up too -- reconciling those as well would
  // mean firing off history.go() here, which risks the same back()/
  // pushState() same-tick ordering problems this whole system was built to
  // avoid; costs at most one extra back-press to fully clear, not a
  // wrong-screen bug.
  navLayers.length = 0;
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  const screenEl = document.getElementById(`screen-${name}`);
  screenEl.classList.remove("hidden");
  document.querySelectorAll(".nav-tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.screen === name);
  });
  // All screens share one document scroll position (they're hidden/shown,
  // not separately-scrolling containers), so switching tabs while scrolled
  // down on the previous one would otherwise leave the new screen starting
  // mid-scroll too -- and since setupCollapsingTitle below captures its
  // shrink range from wherever the header happens to be right now, a
  // leftover scroll position corrupts that calibration and can hand back a
  // title that's already collapsed before you've touched this screen at
  // all. Reset before setupCollapsingTitle runs, not after.
  window.scrollTo(0, 0);
  setupCollapsingTitle(screenEl);
  if (name === "home") renderHomeScreen();
  if (name === "history") renderHistoryScreen();
  if (name === "exercises") renderExercisesScreen();
  if (name === "profile") renderProfileScreen();
  if (name === "statistics") loadGrafanaSnapshots();
  // Remembered across reloads (see boot()) so refreshing the page doesn't
  // always dump you back on Home -- only for the 4 real bottom-nav
  // destinations, not sub-screens reached by drilling in from one of them.
  localStorage.setItem("lastScreen", name);
}

document.querySelectorAll(".nav-tab").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});
