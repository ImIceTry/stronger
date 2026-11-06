// ---------- plate calculator (feature "plateCalculator", off by default) ----------
// A line above the numpad that says which plates go on each side of the bar for
// the weight being typed, on barbell exercises only. The bar weight and the
// plates you own live on this device (localStorage) and are edited in
// Settings > Workout screen features.

const PLATE_SETTINGS_KEY = "plateSettings";
const PLATE_DEFAULTS = { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };

// "25 20, 10; 5 2.5" -> [25, 20, 10, 5, 2.5]. Heaviest first, no duplicates,
// at most 12. A dot is the decimal mark (the numpad uses one too), so a comma
// only ever separates.
function parsePlateList(text) {
  const seen = new Set();
  String(text == null ? "" : text).split(/[\s,;]+/).forEach((tok) => {
    const n = parseFloat(tok);
    if (isFinite(n) && n > 0 && n <= 100) seen.add(Math.round(n * 100) / 100);
  });
  return [...seen].sort((a, b) => b - a).slice(0, 12);
}

function loadPlateSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLATE_SETTINGS_KEY));
    const bar = Number(raw && raw.bar);
    const plates = Array.isArray(raw && raw.plates) ? parsePlateList(raw.plates.join(" ")) : [];
    if (isFinite(bar) && bar >= 0 && bar <= 60 && plates.length) return { bar, plates };
  } catch (_e) {
    // unreadable or never saved: fall through to the defaults
  }
  return { bar: PLATE_DEFAULTS.bar, plates: PLATE_DEFAULTS.plates.slice() };
}

function savePlateSettings(settings) {
  try {
    localStorage.setItem(PLATE_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_e) {
    // storage full or blocked: the defaults stay in effect
  }
}

const round3 = (x) => Math.round(x * 1000) / 1000;
const fmtKg = (x) => String(Math.round(x * 100) / 100);

// Plates for ONE side, heaviest first, taking the biggest plate that still
// fits each time. Returns null for a weight that is not a positive number.
//   { under }                               lighter than the empty bar
//   { perSide, total, exact, leftPerSide }  total is what the plates really add up to
function computePlates(target, bar, plates) {
  const t = Number(target);
  if (!isFinite(t) || t <= 0) return null;
  if (t < bar) return { under: true, perSide: [], total: bar, exact: false, leftPerSide: 0 };
  let rest = round3((t - bar) / 2);
  const perSide = [];
  [...plates].sort((a, b) => b - a).forEach((p) => {
    while (rest + 1e-9 >= p) {
      perSide.push(p);
      rest = round3(rest - p);
    }
  });
  const loaded = perSide.reduce((sum, p) => sum + p, 0);
  return { perSide, total: round3(bar + 2 * loaded), exact: rest < 1e-9, leftPerSide: rest };
}

function describePlates(target, bar, plates) {
  const r = computePlates(target, bar, plates);
  if (!r) return "";
  if (r.under) return `Lighter than the bar (${fmtKg(bar)} kg)`;
  if (!r.perSide.length) return r.exact ? "Bar only" : `Bar only (${fmtKg(r.leftPerSide)} per side short)`;
  const groups = [];
  r.perSide.forEach((p) => {
    const last = groups[groups.length - 1];
    if (last && last[1] === p) last[0] += 1;
    else groups.push([1, p]);
  });
  const list = groups.map(([n, p]) => (n > 1 ? `${n}×${fmtKg(p)}` : fmtKg(p))).join(" + ");
  return r.exact ? `Per side: ${list}` : `Per side: ${list} (loads ${fmtKg(r.total)} kg)`;
}

function isBarbellExercise(name) {
  return /barbell/i.test(String(name || ""));
}

// Called by openNumpad (app.js) when it draws the panel: an empty placeholder
// that updatePlatesLine fills, or nothing at all when it does not apply.
function platesLineHtml(exerciseName, field) {
  if (!featureEnabled("plateCalculator")) return "";
  if (!field || field.key !== "weight" || !isBarbellExercise(exerciseName)) return "";
  return `<div class="plates-line" data-plates-line></div>`;
}

// Called by openNumpad after every digit, step or backspace.
function updatePlatesLine(field, valueText) {
  if (typeof dockedPanel === "undefined" || !dockedPanel) return;
  const el = dockedPanel.querySelector("[data-plates-line]");
  if (!el) return;
  const s = loadPlateSettings();
  el.textContent = describePlates(valueText, s.bar, s.plates);
}

// ---- settings row on the Workout screen features screen ----
function plateSettingsRowHtml() {
  if (!featureEnabled("plateCalculator")) return "";
  const s = loadPlateSettings();
  return `<div class="settings-row settings-row-clickable" id="plate-settings-row">
      <div class="settings-row-text"><span>Plate calculator: bar and plates</span>
      <span class="settings-row-hint">Bar ${fmtKg(s.bar)} kg &middot; plates ${s.plates.map(fmtKg).join(", ")}</span></div>
    </div>`;
}

function openPlateSettingsModal() {
  const s = loadPlateSettings();
  openModal(`
    <h3>Plate calculator</h3>
    <label class="plate-field">Bar weight (kg)
      <input id="plate-bar-input" type="number" inputmode="decimal" min="0" max="60" step="0.5" value="${fmtKg(s.bar)}">
    </label>
    <label class="plate-field">Plates you have (kg, one side)
      <input id="plate-list-input" type="text" value="${s.plates.map(fmtKg).join(", ")}">
    </label>
    <div class="meta">Separate with commas or spaces; use a dot for decimals.</div>
    <div class="modal-actions">
      <button id="plate-reset" class="btn-secondary">Defaults</button>
      <button id="plate-save" class="btn-primary">Save</button>
    </div>
  `);
  modalContent.classList.add("size-compact");
  modalContent.querySelector("#plate-reset").addEventListener("click", () => {
    modalContent.querySelector("#plate-bar-input").value = fmtKg(PLATE_DEFAULTS.bar);
    modalContent.querySelector("#plate-list-input").value = PLATE_DEFAULTS.plates.map(fmtKg).join(", ");
  });
  modalContent.querySelector("#plate-save").addEventListener("click", () => {
    const bar = parseFloat(modalContent.querySelector("#plate-bar-input").value);
    const plates = parsePlateList(modalContent.querySelector("#plate-list-input").value);
    if (!isFinite(bar) || bar < 0 || bar > 60 || !plates.length) {
      alert("Enter a bar weight between 0 and 60 kg and at least one plate.");
      return;
    }
    savePlateSettings({ bar, plates });
    closeTopNavLayer();
    if (typeof renderWorkoutFeaturesScreen === "function") renderWorkoutFeaturesScreen();
  });
}
