// ---------- exercises tab, exercise detail page (moved from app.js, 2026-09-17) ----------

// ---------- exercises tab ----------

async function renderExercisesScreen() {
  const listEl = document.getElementById("exercises-list");
  listEl.innerHTML = skeletonHtml();
  try {
    if (!allExercisesCache) {
      const data = await apiGet("/api/exercises/all");
      allExercisesCache = data.exercises;
    }
    renderExercisesList(allExercisesCache);
  } catch (err) {
    listEl.innerHTML = "<div class='meta'>Can't load exercises right now (offline?).</div>";
  }
}

// "name" (default, alphabetical -- matches the list's own natural sort
// order from the backend), "frequency" (most-performed first), "last"
// (most-recently-performed first) -- 2026-09-15, ImIceTry's ask. Persisted
// same as templateViewMode above.
let exerciseSortMode = localStorage.getItem("exerciseSortMode") || "name";

// A name's alpha-header letter, or "*" for the couple of history-only
// exercises that start with a digit (2026-09-15, ImIceTry's ask) -- Strong-
// style catch-all bucket instead of each digit getting its own header.
function exerciseAlphaKey(name) {
  return /^[A-Za-z]/.test(name) ? name[0].toUpperCase() : "*";
}

function sortExercisesForDisplay(exercises) {
  const list = exercises.slice();
  if (exerciseSortMode === "frequency") {
    list.sort((a, b) => b.times_performed - a.times_performed || a.name.localeCompare(b.name));
  } else if (exerciseSortMode === "last") {
    list.sort((a, b) => {
      if (!a.last_performed && !b.last_performed) return a.name.localeCompare(b.name);
      if (!a.last_performed) return 1; // never-performed sinks to the bottom
      if (!b.last_performed) return -1;
      return b.last_performed.localeCompare(a.last_performed);
    });
  }
  // "name" mode: already alphabetical from the backend's own ORDER BY --
  // re-sorting here would just redo work and risks disagreeing with the
  // "*" grouping's own assumption that digit-led names already sort
  // together (ASCII digits < letters), so leave it as received.
  return list;
}

function renderExercisesList(exercises) {
  const query = document.getElementById("exercises-search").value.trim();
  // Forgiving match (app-exercise-search.js) used only to decide WHICH rows
  // show -- the tab's own sort choice still decides their order.
  const hits = query ? new Set(rankExercises(query, exercises, Infinity).map((e) => e.name)) : null;
  const filtered = hits ? exercises.filter((e) => hits.has(e.name)) : exercises;
  const sorted = sortExercisesForDisplay(filtered);
  const listEl = document.getElementById("exercises-list");
  listEl.innerHTML = "";
  let lastLetter = "";
  sorted.forEach((ex) => {
    if (exerciseSortMode === "name") {
      const letter = exerciseAlphaKey(ex.name);
      if (letter !== lastLetter) {
        const header = document.createElement("div");
        header.className = "exercise-alpha-header";
        header.textContent = letter;
        listEl.appendChild(header);
        lastLetter = letter;
      }
    }
    const row = document.createElement("div");
    row.className = "exercise-row";
    row.innerHTML = `
      <span class="ex-avatar">${escapeHtml(ex.name[0].toUpperCase())}</span>
      <span class="ex-row-main">
        <span class="ex-name">${escapeHtml(ex.name)}</span>
        ${ex.category ? `<span class="ex-category">${escapeHtml(ex.category)}</span>` : ""}
      </span>
      ${ex.times_performed > 0 ? `<span class="ex-count">${ex.times_performed}&times;</span>` : ""}
    `;
    row.addEventListener("click", () => showExerciseDetail(ex.name));
    listEl.appendChild(row);
  });
  if (sorted.length === 0) listEl.innerHTML = "<div class='meta'>No matching exercises.</div>";
}

const EXERCISE_SORT_LABELS = { name: "Name (A-Z)", frequency: "Frequency (most first)", last: "Last performed (most recent first)" };

function openExercisesSortMenu() {
  openModal(
    Object.entries(EXERCISE_SORT_LABELS)
      .map(
        ([mode, label]) =>
          `<div class="exercise-row" data-mode="${mode}">${escapeHtml(label)}${mode === exerciseSortMode ? " &#10003;" : ""}</div>`
      )
      .join("")
  );
  Object.keys(EXERCISE_SORT_LABELS).forEach((mode) => {
    modalContent.querySelector(`[data-mode="${mode}"]`).addEventListener("click", () => {
      exerciseSortMode = mode;
      localStorage.setItem("exerciseSortMode", mode);
      closeTopNavLayer();
      if (allExercisesCache) renderExercisesList(allExercisesCache);
    });
  });
}

document.getElementById("exercises-sort-btn").addEventListener("click", openExercisesSortMenu);

document.getElementById("exercises-search").addEventListener("input", () => {
  if (allExercisesCache) renderExercisesList(allExercisesCache);
});

// ---------- exercise detail page (History / Charts-stub / Records) ----------

// onClose (2026-09-11) lets a caller reopen wherever it came from instead of
// always landing on the Exercises tab -- the active-workout overlay (see
// openExerciseDetailFromActiveWorkout below) needs to reopen itself, not
// jump the user out to a different tab entirely.
// Universal search (2026-09-17, Function Expansion Plan item 2.1) -- the
// Home header's search icon did nothing ("Search (not built yet)"). One
// query across templates, exercises, and past workouts by name, jumping
// straight to the match rather than making the user guess which of the 3
// tabs it lives in. Templates default to non-archived only (a plain GET
// /api/templates, same default list_templates itself already uses, same
// set Home's own "My Templates" shows) -- searching for an archived one is
// an edge case not worth the extra request/complexity for now. Workouts
// and exercises are fetched in full (254 workouts, ~900 exercises) and
// filtered client-side rather than adding a new backend search endpoint --
// both lists are already small enough for this app's own personal-scale
// data that a substring filter over the full set is instant.
function openSearchScreen() {
  showScreenRaw("screen-search");
  pushNavLayer(() => showScreen("home"));
  const input = document.getElementById("search-input");
  input.value = "";
  document.getElementById("search-results").innerHTML = "";
  input.focus();
}

let searchDebounceTimer = null;
document.getElementById("search-input").addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  const query = document.getElementById("search-input").value.trim();
  searchDebounceTimer = setTimeout(() => runSearch(query), 150);
});

async function runSearch(query) {
  const resultsEl = document.getElementById("search-results");
  if (!query) {
    resultsEl.innerHTML = "";
    return;
  }
  resultsEl.innerHTML = skeletonHtml(2);
  const q = query.toLowerCase();
  try {
    const [exercisesData, templatesData, workoutsData] = await Promise.all([
      allExercisesCache ? Promise.resolve({ exercises: allExercisesCache }) : apiGet("/api/exercises/all"),
      apiGet("/api/templates"),
      apiGet("/api/workouts"),
    ]);
    if (!allExercisesCache) allExercisesCache = exercisesData.exercises;

    const exerciseMatches = rankExercises(query, exercisesData.exercises, 10);
    const workoutById = new Map(workoutsData.workouts.map((w) => [w.id, w]));
    // Rebuilds the same {id, name, source_workout_id, started_at} shape
    // renderHomeScreen's own template join already builds -- openTemplatePreview
    // needs exactly this, not the raw /api/templates row.
    const templateMatches = (templatesData.templates || [])
      .filter((t) => t.name.toLowerCase().includes(q))
      .map((t) => {
        const sourceWorkout = workoutById.get(t.source_workout_id);
        return { id: t.id, name: t.name, source_workout_id: t.source_workout_id, started_at: sourceWorkout ? sourceWorkout.started_at : t.updated_at };
      })
      .slice(0, 10);
    const workoutMatches = workoutsData.workouts.filter((w) => w.name.toLowerCase().includes(q)).slice(0, 15);

    if (!exerciseMatches.length && !templateMatches.length && !workoutMatches.length) {
      resultsEl.innerHTML = "<div class='meta'>No matches.</div>";
      return;
    }

    const section = (title, rowsHtml) => (rowsHtml ? `<div class="section-label">${title}</div>${rowsHtml}` : "");
    resultsEl.innerHTML =
      section("Templates", templateMatches.map((t) => `<div class="exercise-row" data-search-template="${t.id}">${escapeHtml(t.name)}</div>`).join("")) +
      section("Exercises", exerciseMatches.map((e) => `<div class="exercise-row" data-search-exercise="${escapeHtml(e.name)}">${escapeHtml(e.name)}</div>`).join("")) +
      section("Workouts", workoutMatches.map((w) => `<div class="exercise-row" data-search-workout="${w.id}">${escapeHtml(w.name)} <span class="meta">${w.started_at.slice(0, 10)}</span></div>`).join(""));

    // Each drill-in's own onClose returns to this screen directly (showScreenRaw,
    // not showScreen -- "search" isn't a bottom-nav tab, and showScreen's own
    // tab-switch logic would drop this screen's nav layer as stale).
    resultsEl.querySelectorAll("[data-search-template]").forEach((row) => {
      const tpl = templateMatches.find((t) => String(t.id) === row.dataset.searchTemplate);
      row.addEventListener("click", () => openTemplatePreview(tpl));
    });
    resultsEl.querySelectorAll("[data-search-exercise]").forEach((row) => {
      row.addEventListener("click", () => showExerciseDetail(row.dataset.searchExercise, () => showScreenRaw("screen-search")));
    });
    resultsEl.querySelectorAll("[data-search-workout]").forEach((row) => {
      const wid = parseInt(row.dataset.searchWorkout, 10);
      row.addEventListener("click", () => showWorkoutDetail(wid, workoutById.get(wid), () => showScreenRaw("screen-search")));
    });
  } catch (err) {
    resultsEl.innerHTML = "<div class='meta'>Can't search right now (offline?).</div>";
  }
}

document.getElementById("home-search-btn").addEventListener("click", openSearchScreen);
document.getElementById("search-back").addEventListener("click", closeTopNavLayer);

function showExerciseDetail(name, onClose) {
  exerciseDetailCurrentName = name;
  document.getElementById("exercise-detail-name").textContent = name;
  const meta = allExercisesCache && allExercisesCache.find((e) => e.name === name);
  document.getElementById("exercise-detail-subtitle").textContent = meta && meta.category ? meta.category : "";
  showScreenRaw("screen-exercise-detail");
  pushNavLayer(onClose || (() => showScreen("exercises")));
  document.querySelectorAll(".ed-tab").forEach((t) => t.classList.toggle("active", t.dataset.edTab === "history"));
  document.querySelectorAll(".ed-panel").forEach((p) => p.classList.add("hidden"));
  document.getElementById("ed-panel-history").classList.remove("hidden");
  loadExerciseHistoryTab(name);
}

// Tapping an exercise's own name inside the active-workout card (2026-09-11,
// ImIceTry's own ask) opens the same exercise-detail page the Exercises tab
// uses, but needs to visually hide the workout overlay first (exercise-
// detail is a full-screen tab, not something that layers on top of the
// overlay) and reopen it again on close, rather than stranding the user on
// the Exercises tab with their in-progress workout only reachable via the
// mini-bar. Deliberately does NOT call hideActiveWorkoutOverlay() -- that
// pops the overlay's own nav layer and fires a real history.back(), which
// races against this function's own immediate pushNavLayer (via
// showExerciseDetail) for a *different* layer right after, corrupting the
// history stack (confirmed live: navLayers ended up empty and the physical
// back button stopped doing anything). Instead this just hides the overlay
// in place, leaving its nav-layer entry untouched in the stack -- the
// exercise-detail page's own layer then sits directly on top of it, so one
// back-press returns to (and reopens) the overlay, and a second one closes
// it for real, exactly like any other panel stacked over the overlay.
function openExerciseDetailFromActiveWorkout(exerciseName) {
  activeOverlayOpen = false;
  document.getElementById("active-overlay").classList.add("hidden");
  clearInterval(elapsedTimerHandle);
  updateMiniBar();
  showExerciseDetail(exerciseName, () => showActiveWorkoutOverlay());
}

// showScreen only knows about nav-tab screens; exercise-detail is reached from
// the Exercises tab, not the bottom nav, so it needs its own display toggle.
function showScreenRaw(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  setupCollapsingTitle(null); // exercise-detail keeps its title inline in the header row, never collapsed
}

document.getElementById("exercise-detail-back").addEventListener("click", closeTopNavLayer);

document.querySelectorAll(".ed-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".ed-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".ed-panel").forEach((p) => p.classList.add("hidden"));
    document.getElementById(`ed-panel-${tab.dataset.edTab}`).classList.remove("hidden");
    if (tab.dataset.edTab === "history") loadExerciseHistoryTab(exerciseDetailCurrentName);
    if (tab.dataset.edTab === "charts") loadExerciseChartsTab(exerciseDetailCurrentName);
    if (tab.dataset.edTab === "records") loadExerciseRecordsTab(exerciseDetailCurrentName);
    if (tab.dataset.edTab === "about") loadExerciseAboutTab(exerciseDetailCurrentName);
  });
});

async function loadExerciseHistoryTab(name) {
  const panel = document.getElementById("ed-panel-history");
  panel.innerHTML = skeletonHtml(2);
  try {
    const data = await apiGet(`/api/exercises/${encodeURIComponent(name)}/history`);
    if (!data.sessions.length) {
      panel.innerHTML = "<div class='meta'>No history yet for this exercise.</div>";
      return;
    }
    // Matches Strong's own History tab layout (reference screenshots,
    // 2026-09-12): bold workout name, full weekday date on its own line,
    // a "Sets Performed" / "1RM" column header, each set showing its
    // weight/reps/RPE on the left and estimated 1RM on the right, and a
    // separate trophy pill per PR type actually hit (1RM / Weight / Vol.)
    // rather than one combined star -- a set can hit more than one at once.
    panel.innerHTML = data.sessions
      .map((session) => {
        const lines = session.sets
          .map((s) => {
            const tag = (s.set_type === "drop" ? " (D)" : s.set_type === "failure" ? " (F)" : s.set_type === "warmup" ? " (W)" : s.set_type === "assisted" ? ` (A${s.assisted_reps != null ? s.assisted_reps : ""})` : "") + (s.unilateral ? " (U)" : "") + (s.side === "left" ? " (L)" : s.side === "right" ? " (R)" : "");
            const rpeTag = s.rpe != null ? ` @ ${s.rpe}` : "";
            const setNumHtml = `<span class="ed-history-set-num">${s.set_order}${tag}</span>`;
            const left = s.duration_sec != null
              ? `${setNumHtml}${formatMmssBuffer(secondsToMmssBuffer(s.duration_sec))}`
              : `${setNumHtml}${s.weight_kg ?? "-"} kg &times; ${s.reps ?? "-"}${rpeTag}`;
            const right = s.estimated_1rm != null ? Math.round(s.estimated_1rm) : "-";
            const pills = [];
            if (s.is_pr_1rm) pills.push("1RM");
            if (s.is_pr_weight) pills.push("Weight");
            if (s.is_pr_volume) pills.push("Vol.");
            if (!s.is_pr_1rm && !s.is_pr_weight && !s.is_pr_volume && s.is_pr) pills.push("PR");
            const pillsHtml = pills.length
              ? `<div class="pr-pills">${pills.map((p) => `<span class="pr-pill">&#127942; ${p}</span>`).join("")}</div>`
              : "";
            return `<div class="ed-history-set-line"><span>${left}</span><span>${right}</span></div>${pillsHtml}`;
          })
          .join("");
        return `<div class="detail ed-history-card">
          <h3>${escapeHtml(session.workout_name)}</h3>
          <div class="ed-history-date">${escapeHtml(formatLongDateTime(session.started_at))}</div>
          <div class="ed-history-col-header"><span>Sets Performed</span><span>1RM</span></div>
          ${lines}
        </div>`;
      })
      .join("");
  } catch (err) {
    panel.innerHTML = "<div class='meta'>Can't load history right now (offline?).</div>";
  }
}

// Real per-exercise charts (2026-09-17, Function Expansion Plan item 1.4) --
// client-side SVG rather than Grafana: the existing Grafana pipeline
// (grafana/scripts/refresh_panel_snapshots.sh) renders a *fixed* list of 8
// panels every 15 min via headless Chrome, so going per-exercise there
// would mean ~120 renders per cycle and silently rot as new exercises get
// logged. Drawing from data the API already returns (exercise_history)
// works offline through the same IndexedDB cache apiGet already uses, and
// needs no new backend endpoint at all.

// Per-session aggregates for charting -- deliberately excludes warmup/
// failure sets, same convention records.py's own PR/volume math already
// uses, so a chart's "best" line never disagrees with the real Records tab
// for the same exercise. est_1rm uses the exact same Epley formula/
// rounding as records.estimated_1rm (weight * (1 + reps/30), 1 decimal) so
// the two never drift apart even though this copy runs client-side.
function computeExerciseSessionSeries(sessions) {
  // exercise_history returns sessions newest-first; charts read left-to-
  // right as time moving forward, so reverse once here rather than at
  // every call site that wants chronological order.
  return sessions
    .slice()
    .reverse()
    .map((session) => {
      const realSets = session.sets.filter(
        (s) => s.set_type !== "warmup" && s.set_type !== "failure" && s.set_type !== "assisted" && s.weight_kg != null && s.reps != null && s.reps > 0
      );
      if (!realSets.length) return null;
      let best1rm = 0;
      let maxWeight = 0;
      let volume = 0;
      realSets.forEach((s) => {
        // Effective weight (raw * weight_ratio), same as records.py's own
        // _compute_records -- a variant with a saved ratio (2026-09-17,
        // sets.weight_ratio) has to plot true comparable resistance here
        // too, or this chart would silently disagree with the Records tab
        // for the exact set of exercises this feature exists for.
        const weight = s.weight_kg * (s.weight_ratio ?? 1);
        const e1rm = Math.round(weight * (1 + s.reps / 30) * 10) / 10;
        if (e1rm > best1rm) best1rm = e1rm;
        if (weight > maxWeight) maxWeight = weight;
        volume += weight * s.reps;
      });
      return { date: session.started_at, best1rm, maxWeight, volume: Math.round(volume) };
    })
    .filter(Boolean); // sessions that were entirely warmup/failure have nothing real to plot
}

const CHART_TIME_RANGES = { all: null, 90: 90, 30: 30 };

function filterSeriesByRange(series, rangeDays) {
  if (!rangeDays) return series;
  const cutoff = Date.now() - rangeDays * 86400000;
  return series.filter((point) => new Date(point.date.replace(" ", "T")).getTime() >= cutoff);
}

// Minimal hand-rolled SVG line chart -- no bundler in this project to pull
// in a real charting library through, and this is one small utility
// feature, not a dashboard; a plain polyline is proportionate. Uses the
// app's own existing --blue accent (already the button/link color
// elsewhere) rather than inventing a new one, per this vault's own
// dataviz guidance to keep a page's palette consistent, not ad hoc.
function renderTrendChartSvg(series, key, unit) {
  if (series.length < 2) {
    return `<div class="chart-stub-note">${series.length === 1 ? "Only one real session so far -- needs at least two to chart a trend." : "No real sets logged yet."}</div>`;
  }
  const width = 300;
  const height = 110;
  const padX = 8;
  const padY = 14;
  const values = series.map((p) => p[key]);
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const rangeY = maxY - minY || 1;
  const stepX = (width - padX * 2) / (series.length - 1);
  const scaleY = (v) => height - padY - ((v - minY) / rangeY) * (height - padY * 2);
  const coords = series.map((p, i) => [padX + i * stepX, scaleY(p[key])]);
  const pointsAttr = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const dots = coords.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="var(--blue)"></circle>`).join("");
  return `
    <svg viewBox="0 0 ${width} ${height}" class="trend-chart" preserveAspectRatio="none">
      <polyline points="${pointsAttr}" fill="none" stroke="var(--blue)" stroke-width="2"></polyline>
      ${dots}
    </svg>
    <div class="trend-chart-range">
      <span>${series[0].date.slice(0, 10)}</span>
      <span>${minY}${unit} &ndash; ${maxY}${unit}</span>
      <span>${series[series.length - 1].date.slice(0, 10)}</span>
    </div>`;
}

async function loadExerciseChartsTab(name) {
  const panel = document.getElementById("ed-panel-charts");
  panel.innerHTML = skeletonHtml(2);
  try {
    const [recordsData, historyData] = await Promise.all([
      apiGet(`/api/exercises/${encodeURIComponent(name)}/records`),
      apiGet(`/api/exercises/${encodeURIComponent(name)}/history`),
    ]);
    const fullSeries = computeExerciseSessionSeries(historyData.sessions);
    const metrics = [
      { key: "best1rm", title: "Est. 1RM over time", unit: "kg", value: recordsData.estimated_1rm.value },
      { key: "maxWeight", title: "Max weight over time", unit: "kg", value: recordsData.max_weight.value },
      { key: "volume", title: "Volume per session", unit: "kg", value: recordsData.max_volume.value },
    ];
    const unilateralNote = recordsData.unilateral
      ? `<div class="chart-stub-note">These records are from unilateral (one-sided) sets -- no bilateral history exists for this exercise to prefer instead.</div>`
      : "";
    panel.innerHTML = unilateralNote + metrics.map((m) => `
      <div class="chart-card" data-chart-key="${m.key}" data-chart-range="all">
        <div class="chart-card-header">
          <span>${m.title}</span>
          <button class="icon-btn chart-range-btn" title="Time range">&#8943;</button>
        </div>
        <div class="chart-card-value">${m.value ?? "-"} ${m.unit}</div>
        <div class="chart-body">${renderTrendChartSvg(fullSeries, m.key, m.unit)}</div>
      </div>`).join("");

    panel.querySelectorAll("[data-chart-key]").forEach((card) => {
      const key = card.dataset.chartKey;
      const metric = metrics.find((m) => m.key === key);
      card.querySelector(".chart-range-btn").addEventListener("click", () => {
        openDockedPanel(`
          <div class="set-type-toggle row-options-panel">
            <button class="range-btn ${card.dataset.chartRange === "all" ? "active unilateral" : ""}" data-range="all">All time</button>
            <button class="range-btn ${card.dataset.chartRange === "90" ? "active unilateral" : ""}" data-range="90">Last 90 days</button>
            <button class="range-btn ${card.dataset.chartRange === "30" ? "active unilateral" : ""}" data-range="30">Last 30 days</button>
          </div>
        `, () => closeDockedPanel());
        dockedPanel.querySelectorAll("[data-range]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const rangeKey = btn.dataset.range;
            card.dataset.chartRange = rangeKey;
            const filtered = filterSeriesByRange(fullSeries, CHART_TIME_RANGES[rangeKey]);
            card.querySelector(".chart-body").innerHTML = renderTrendChartSvg(filtered, key, metric.unit);
            closeDockedPanel();
          });
        });
      });
    });
  } catch (err) {
    panel.innerHTML = "<div class='meta'>Can't load records right now (offline?).</div>";
  }
}

async function loadExerciseRecordsTab(name) {
  const panel = document.getElementById("ed-panel-records");
  panel.innerHTML = skeletonHtml(2);
  try {
    const r = await apiGet(`/api/exercises/${encodeURIComponent(name)}/records`);
    const repRows = r.by_rep_count
      .map((row) => `<div class="reps-table-row"><span>${row.reps}</span><span>${row.weight_kg}kg (est. ${row.estimated_1rm ?? "-"}kg)</span><span>${escapeHtml(row.date)}</span></div>`)
      .join("");
    panel.innerHTML = `
      <div class="detail ed-info-card">
        <div class="section-label">Personal Records</div>
        ${r.unilateral ? `<div class="meta">One-sided (unilateral) track -- no bilateral history exists for this exercise.</div>` : ""}
        <div class="records-row"><span class="label">Estimated 1RM</span><span class="value">${r.estimated_1rm.value ?? "-"} kg</span></div>
        <div class="records-row"><span class="label">Max weight</span><span class="value">${r.max_weight.value ?? "-"} kg</span></div>
        <div class="records-row"><span class="label">Max volume (single set)</span><span class="value">${r.max_volume.value ?? "-"} kg</span></div>
        <button id="view-records-history-btn" class="btn-primary btn-caps records-history-btn">View Records History</button>
        <div class="reps-table-header"><span>Reps</span><span>Best Performance</span><span>Date</span></div>
        ${repRows || "<div class='meta'>Not enough data yet.</div>"}
      </div>
    `;
    const btn = document.getElementById("view-records-history-btn");
    if (btn) {
      btn.addEventListener("click", () => {
        document.querySelector('.ed-tab[data-ed-tab="history"]').click();
      });
    }
  } catch (err) {
    panel.innerHTML = "<div class='meta'>Can't load records right now (offline?).</div>";
  }
}

// Static reference info, not derived from logged sets like the other three
// tabs (2026-09-16, ImIceTry's ask). instructions is legitimately absent for
// most of his own exercises (see db.exercise_about's own comment on why --
// exact-name matching against the imported library, not fuzzy/generated) --
// shown as an honest "not sourced yet" note, not hidden or faked.
async function loadExerciseAboutTab(name) {
  const panel = document.getElementById("ed-panel-about");
  panel.innerHTML = skeletonHtml(2);
  try {
    const r = await apiGet(`/api/exercises/${encodeURIComponent(name)}/about`);
    const chip = (muscle, secondary) => `<span class="about-muscle-chip${secondary ? " secondary" : ""}">${escapeHtml(muscle)}</span>`;
    const muscles = [...r.primary_muscles.map((m) => chip(m, false)), ...r.secondary_muscles.map((m) => chip(m, true))].join("");
    const instructionsHtml = r.instructions
      ? `<ol class="about-instructions-list">${r.instructions.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>`
      : `<div class="meta">No instructions sourced for this exercise yet.</div>`;
    panel.innerHTML = `
      <div class="detail ed-info-card">
        ${r.category ? `<div class="records-row"><span class="label">Category</span><span class="value">${escapeHtml(r.category)}</span></div>` : ""}
        ${r.equipment ? `<div class="records-row"><span class="label">Equipment</span><span class="value">${escapeHtml(r.equipment)}</span></div>` : ""}
        ${muscles ? `<div class="section-label">Muscles Worked</div><div class="about-muscle-chips">${muscles}</div>` : ""}
        <div class="section-label">Instructions</div>
        ${instructionsHtml}
      </div>
    `;
  } catch (err) {
    panel.innerHTML = "<div class='meta'>Can't load exercise info right now (offline?).</div>";
  }
}

// Exercise details editor (2026-09-17, Function Expansion Plan item 1.3,
// remaining sub-scope) -- category/equipment/muscle-tags/unit-type/
// instructions have all existed since early in this project's history but
// were only ever editable via one-off DB scripts (backfill_muscle_groups.py,
// direct sqlite3 renames, etc.). The exercise-detail screen's own "..."
// button was dead ("not built yet" in spirit, though it had no title at
// all) -- now opens a real edit form. Muscles and instructions are edited
// in their real raw stored encoding (comma-separated "name"/"name:0.5" for
// muscles, one instruction step per line) rather than a more elaborate
// structured UI, matching this feature's actual audience: ImIceTry
// maintaining his own data, not an end-user needing hand-holding through
// the encoding.
function openExerciseDetailMenu(name) {
  // UI Polish Pass 2026-09-18, item 3 -- migrated to the side panel like
  // every other "..." menu; icon reuses the same pencil shape
  // EXERCISE_MENU_ICONS.note already defines (app-exercise-menu.js) rather
  // than drawing a second, near-identical "edit" glyph.
  openSidePanel(name, `<div class="side-panel-row" data-action="edit-details"><svg class="side-panel-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS.note}</svg><span class="side-panel-row-label">Edit exercise details</span></div>`);
  sidePanel.querySelector('[data-action="edit-details"]').addEventListener("click", () => {
    closeSidePanel();
    openEditExerciseDetailsModal(name);
  });
}

async function openEditExerciseDetailsModal(name) {
  openModal(`<h3>${escapeHtml(name)}</h3><div class="meta">Loading&hellip;</div>`);
  modalContent.classList.add("size-comfortable"); // UI Polish Pass 2026-09-18 -- multi-field form
  let current;
  try {
    current = await apiGet(`/api/exercises/${encodeURIComponent(name)}/about`);
  } catch (err) {
    modalContent.innerHTML = "<div class='meta'>Can't load exercise details right now (offline?).</div>";
    return;
  }
  const unitTypes = [
    ["weight_reps", "Weight + Reps"],
    ["reps_only", "Reps only"],
    ["time", "Time"],
  ];
  modalContent.innerHTML = `
    <h3>Edit ${escapeHtml(name)}</h3>
    <input id="ex-details-category" type="text" class="exercise-note-input" placeholder="Category" value="${escapeHtml(current.category || "")}">
    <input id="ex-details-equipment" type="text" class="exercise-note-input" placeholder="Equipment" value="${escapeHtml(current.equipment || "")}">
    <input id="ex-details-muscles" type="text" class="exercise-note-input" placeholder="Muscles (comma-separated, e.g. chest, triceps:0.5)" value="${escapeHtml(current.raw_primary_muscles || "")}">
    <p class="modal-hint">Muscles: plain name for a primary mover, "name:0.5" for secondary (same encoding this app already stores).</p>
    <select id="ex-details-unit-type" class="exercise-note-input">
      ${unitTypes.map(([v, label]) => `<option value="${v}" ${v === current.unit_type ? "selected" : ""}>${label}</option>`).join("")}
    </select>
    <textarea id="ex-details-instructions" class="exercise-note-input" rows="5" placeholder="Instructions, one step per line">${escapeHtml(current.raw_instructions || "")}</textarea>
    <div class="modal-actions">
      <button id="ex-details-save" class="btn-primary">Save</button>
    </div>
  `;
  modalContent.querySelector("#ex-details-save").addEventListener("click", async () => {
    const payload = {
      category: modalContent.querySelector("#ex-details-category").value.trim(),
      equipment: modalContent.querySelector("#ex-details-equipment").value.trim(),
      primary_muscles: modalContent.querySelector("#ex-details-muscles").value.trim(),
      unit_type: modalContent.querySelector("#ex-details-unit-type").value,
      instructions: modalContent.querySelector("#ex-details-instructions").value.trim(),
    };
    try {
      await apiPut(`/api/exercises/${encodeURIComponent(name)}/details`, payload);
      // Cached copies of anything this could have changed need to be
      // dropped, not just left stale until the next full reload --
      // unitTypeCache in particular feeds live set-logging decisions
      // (weight/reps vs time fields), not just this read-only display.
      delete unitTypeCache[name];
      allExercisesCache = null;
    } catch (err) {
      alert("Couldn't save (offline?). Nothing was changed.");
      return;
    }
    closeTopNavLayer();
    loadExerciseAboutTab(name);
  });
}

document.getElementById("exercise-detail-menu-btn").addEventListener("click", () => openExerciseDetailMenu(exerciseDetailCurrentName));
