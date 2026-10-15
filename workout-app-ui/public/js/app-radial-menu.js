// Radial quick menu: swipe left-to-right anywhere on an exercise card (set
// rows included -- their own swipe is right-to-left, "delete set") and the
// card's actions fan out in a circle around the finger. Release over an icon
// to pick it, or lift off and tap one. The card swiped in is the target exercise.

const RADIAL_SWIPE_MIN_DX = 75;
const RADIAL_RADIUS = 116;
const RADIAL_ICON_SIZE = 52;
const RADIAL_ARM_DISTANCE = 24;
const RADIAL_DWELL_MS = 150;
let radialMenuEl = null;

function radialActionsFor(exerciseName) {
  const actions = [
    { key: "note", icon: "note", label: "Note", run: () => openAddNoteModal(exerciseName) },
    {
      key: "sticky", icon: "stickyNote", label: "Sticky note",
      run: async () => openStickyNoteModal(exerciseName, await fetchStickyNote(exerciseName)),
    },
    {
      key: "unilateral", icon: "unilateral", label: "Always unilateral",
      run: async () => {
        await fetchDefaultUnilateral(exerciseName);
        if (await toggleDefaultUnilateral(exerciseName)) renderActiveScreen();
      },
    },
    {
      key: "start-side", icon: "startSide", label: startSideMenuLabel(exerciseName),
      run: () => cycleStartSide(exerciseName),
    },
    { key: "rest", icon: "restTimer", label: "Rest timer", run: () => openRestTimerModal(exerciseName) },
    { key: "variant", icon: "machineVariant", label: "Machine / variant", run: () => openMachineVariantModal(exerciseName) },
    { key: "machine-settings", icon: "machineSettings", label: "Machine settings", run: () => openMachineSettingsModal(exerciseName) },
  ];
  actions.push(
    { key: "replace", icon: "replace", label: "Replace", run: () => startReplaceExercise(exerciseName) },
    { key: "superset", icon: "superset", label: "Superset", run: () => openSupersetPicker(exerciseName) },
    { key: "remove", icon: "remove", label: "Remove", danger: true, run: () => removeExerciseFromWorkout(exerciseName) },
  );
  const chosen = new Set(radialSelection());
  const shown = actions.filter((a) => chosen.has(a.key) && radialKeyAvailable(a.key));
  const unilateral = shown.find((a) => a.key === "unilateral");
  const startSide = shown.find((a) => a.key === "start-side");
  if (unilateral || startSide) {
    fetchDefaultUnilateral(exerciseName).then((on) => {
      if (startSide) startSide.label = startSideMenuLabel(exerciseName, on);
      if (unilateral) unilateral.label = on ? "Always unilateral: on (tap to turn off)" : "Always unilateral: off (tap to turn on)";
    });
  }
  return shown;
}

window.addEventListener("popstate", () => closeRadialMenu());

function closeRadialMenu() {
  if (radialMenuEl) radialMenuEl.remove();
  radialMenuEl = null;
}

function openRadialMenu(exerciseName, x, y) {
  closeRadialMenu();
  const actions = radialActionsFor(exerciseName);
  if (!actions.length) return null;
  const margin = RADIAL_RADIUS + RADIAL_ICON_SIZE / 2 + 8;
  const cx = Math.min(Math.max(x, margin), window.innerWidth - margin);
  const cy = Math.min(Math.max(y, margin), window.innerHeight - margin);

  const overlay = document.createElement("div");
  overlay.className = "radial-overlay";
  const label = document.createElement("div");
  label.className = "radial-label";
  label.style.left = `${cx}px`;
  label.style.top = `${cy}px`;
  label.textContent = exerciseName;
  overlay.appendChild(label);

  const items = actions.map((action, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / actions.length;
    const ix = cx + RADIAL_RADIUS * Math.cos(angle);
    const iy = cy + RADIAL_RADIUS * Math.sin(angle);
    const btn = document.createElement("button");
    btn.className = "radial-item" + (action.danger ? " danger" : "");
    btn.style.left = `${ix}px`;
    btn.style.top = `${iy}px`;
    btn.setAttribute("aria-label", action.label);
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS[action.icon]}</svg>`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      chooseRadialAction(action);
    });
    overlay.appendChild(btn);
    return { action, btn, ix, iy };
  });

  document.body.appendChild(overlay);
  radialMenuEl = overlay;

  // Icons burst out from the menu centre (where the finger is). Layout stays
  // as positioned above; the animation only offsets each icon's transform.
  if (overlay.animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    overlay.animate({ opacity: [0, 1] }, { duration: 140 });
    label.animate({ opacity: [0, 1] }, { duration: 200, delay: 80, fill: "backwards" });
    items.forEach(({ btn, ix, iy }, i) => {
      btn.animate(
        [
          { transform: `translate(${cx - ix}px, ${cy - iy}px) scale(0.2)`, opacity: 0 },
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
        ],
        { duration: 260, delay: i * 18, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.25)", fill: "backwards" },
      );
    });
  }

  // An icon only counts as hovered once the finger has moved away from where
  // the menu opened -- near a screen edge the circle is shifted and an icon
  // can already sit under the finger, which must not be picked by lifting.
  // Lifting only picks an icon the finger has rested on for a moment, so a
  // long swipe that merely passes over or ends on one doesn't trigger it.
  let hovered = null;
  let hoveredSince = 0;
  let armed = false;
  let leading = true; // the finger that opened the menu is still down

  const setHover = (hit) => {
    if (hit === hovered) return;
    if (hovered) hovered.btn.classList.remove("hover");
    hovered = hit;
    hoveredSince = performance.now();
    if (hit) hit.btn.classList.add("hover");
    label.textContent = hit ? hit.action.label : exerciseName;
    if (hit && navigator.vibrate) navigator.vibrate(8);
  };
  const hover = (px, py) => {
    if (!armed && Math.hypot(px - x, py - y) >= RADIAL_ARM_DISTANCE) armed = true;
    let hit = null;
    let best = RADIAL_ICON_SIZE / 2 + 8;
    if (armed) {
      for (const it of items) {
        const d = Math.hypot(px - it.ix, py - it.iy);
        if (d <= best) { best = d; hit = it; }
      }
    }
    setHover(hit);
  };
  const release = (canPick = true) => {
    leading = false;
    if (canPick && hovered && performance.now() - hoveredSince >= RADIAL_DWELL_MS) {
      swallowNextClick();
      chooseRadialAction(hovered.action);
    } else {
      setHover(null);
    }
  };

  // Once the opening finger has lifted the menu stays open, and a new touch
  // (or a mouse) behaves exactly like the first one: slide over an icon to see
  // what it does, rest on it and lift to pick it, or just tap it.
  let touching = false;
  let downX = 0;
  let downY = 0;
  let dragged = false;
  overlay.addEventListener("pointerdown", (e) => {
    if (leading) return;
    touching = true;
    dragged = false;
    downX = e.clientX;
    downY = e.clientY;
    armed = true;
    hover(e.clientX, e.clientY);
  });
  overlay.addEventListener("pointermove", (e) => {
    if (leading) return;
    if (!touching && e.pointerType !== "mouse") return;
    if (touching && Math.hypot(e.clientX - downX, e.clientY - downY) > 10) dragged = true;
    armed = true;
    hover(e.clientX, e.clientY);
  });
  const endTouch = (e) => {
    if (!touching) return;
    touching = false;
    if (e.type === "pointerup") release(); else setHover(null);
  };
  overlay.addEventListener("pointerup", endTouch);
  overlay.addEventListener("pointercancel", endTouch);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && !dragged) closeRadialMenu();
  });

  return { hover, release };
}

// A tap that picks on lift is still followed by a click, which would land on
// whatever the chosen action just opened (e.g. dismiss a modal's backdrop).
function swallowNextClick() {
  const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
  document.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 400);
}

function chooseRadialAction(action) {
  if (!radialMenuEl) return; // already chosen or closed -- a lift-pick is followed by a click
  closeRadialMenu();
  action.run();
}

function wireExerciseCardRadialSwipe(card, exerciseName) {
  let startX = null;
  let startY = null;
  let menu = null;

  card.addEventListener("pointerdown", (e) => {
    startX = null;
    if (radialMenuEl) return;
    startX = e.clientX;
    startY = e.clientY;
    menu = null;
  });
  card.addEventListener("pointermove", (e) => {
    if (startX == null) return;
    if (menu) {
      menu.hover(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { startX = null; return; } // vertical scroll
    if (dx > RADIAL_SWIPE_MIN_DX && dx > Math.abs(dy) * 1.5) {
      if (!featureEnabled("radialGesture")) { startX = null; return; }
      try { card.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone -- harmless */ }
      menu = openRadialMenu(exerciseName, e.clientX, e.clientY);
      if (!menu) startX = null;
    }
  });
  const finish = (e) => {
    const m = menu;
    menu = null;
    startX = null;
    if (!m) return;
    // The browser still fires a click on the card after this release.
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    card.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => card.removeEventListener("click", swallow, { capture: true }), 400);
    m.release(e.type === "pointerup");
  };
  card.addEventListener("pointerup", finish);
  card.addEventListener("pointercancel", finish);
}
