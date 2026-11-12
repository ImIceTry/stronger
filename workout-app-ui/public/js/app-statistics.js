// ---------- Statistics tab: charts drawn by the app (switch "statsCharts") ----------
// The Statistics tab otherwise shows pre-rendered Grafana snapshots, which only
// exist where someone runs their own Grafana pipeline (see README). These charts
// are drawn here from data the API already returns, so they need no add-on, no
// new endpoint, and work offline from the same cache apiGet uses:
//   /api/workouts                          every workout with volume, sets, duration
//   /api/workouts?include_summary=1&limit=40   which exercises were trained lately
//   /api/exercises/<name>/history          one exercise's sessions (already
//                                          prefetched for offline use)
// Per-session numbers reuse computeExerciseSessionSeries (app-exercises.js), so a
// value here never disagrees with that exercise's own Charts and Records tabs.

const STATS_STATE_KEY = "statsChartsState";
const STATS_RECENT_LIMIT = 40;      // workouts scanned for "trained lately"
const STATS_RANKING_SIZE = 8;       // exercises in the progress list
const STATS_RANKING_DAYS = 90;
const STATS_CALENDAR_WEEKS = 26;

const STATS_EXERCISE_METRICS = [
  { key: "best1rm", label: "Est. 1RM", unit: "kg" },
  { key: "maxWeight", label: "Max weight", unit: "kg" },
  { key: "volume", label: "Volume", unit: "kg" },
];
const STATS_REPS_METRIC = { key: "maxReps", label: "Max reps", unit: "" };
const STATS_EXERCISE_RANGES = [["90", "3M"], ["365", "1Y"], ["all", "All"]];
const STATS_WEEK_METRICS = [
  { key: "volume", label: "Volume" },
  { key: "workouts", label: "Workouts" },
  { key: "minutes", label: "Time" },
];
const STATS_WEEK_RANGES = [["12", "12W"], ["26", "6M"], ["52", "1Y"]];

let statsState = { exercise: null, metric: "best1rm", range: "365", weekMetric: "volume", weekRange: "12" };
try {
  statsState = { ...statsState, ...JSON.parse(localStorage.getItem(STATS_STATE_KEY) || "{}") };
} catch (err) { /* private mode or a corrupt value: keep the defaults */ }

function saveStatsState() {
  try { localStorage.setItem(STATS_STATE_KEY, JSON.stringify(statsState)); } catch (err) { /* not worth failing over */ }
}

// started_at is local time without a zone ("YYYY-MM-DD HH:MM:SS"); parsing it
// with a "T" keeps it local instead of shifting it as UTC.
function statsParseDate(s) {
  return new Date(String(s).replace(" ", "T"));
}

function statsYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function statsWeekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

function statsShortDate(d) {
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function statsFormat(value, unit) {
  if (value == null || Number.isNaN(value)) return "-";
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("en")}${unit ? ` ${unit}` : ""}`;
}

// Axis labels have little room: 31200 -> "31k".
function statsCompact(value) {
  if (Math.abs(value) >= 10000) return `${Math.round(value / 1000)}k`;
  if (Math.abs(value) >= 1000) return `${Math.round(value / 100) / 10}k`;
  return String(Math.round(value * 10) / 10);
}

// Three round gridline values that span [min, max].
function statsNiceTicks(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const rawStep = (max - min) / 2;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = lo; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

function statsChipsHtml(options, active, attr) {
  return `<div class="stats-chips">${options
    .map(([value, label]) => `<button class="stats-chip${value === active ? " active" : ""}" data-${attr}="${value}">${label}</button>`)
    .join("")}</div>`;
}

// Reps-only series for exercises logged without weight (pull-ups,
// dips, timed holds have none) -- otherwise they would chart as "no data".
function statsRepsSeries(sessions) {
  return sessions
    .slice()
    .reverse()
    .map((session) => {
      const reps = session.sets
        .filter((s) => s.set_type !== "warmup" && s.reps != null && s.reps > 0)
        .map((s) => s.reps);
      return reps.length ? { date: session.started_at, maxReps: Math.max(...reps) } : null;
    })
    .filter(Boolean);
}

function statsSeriesFor(history) {
  const weighted = computeExerciseSessionSeries(history.sessions || []);
  if (weighted.length) return { series: weighted, metrics: STATS_EXERCISE_METRICS };
  return { series: statsRepsSeries(history.sessions || []), metrics: [STATS_REPS_METRIC] };
}

function statsFilterRange(series, range) {
  if (range === "all") return series;
  const cutoff = Date.now() - Number(range) * 86400000;
  return series.filter((p) => statsParseDate(p.date).getTime() >= cutoff);
}

// ---------- shared tooltip: tap or hover any mark carrying data-tip ----------
function wireStatsTooltip(card) {
  const svg = card.querySelector("svg.stats-svg");
  if (!svg) return;
  const tip = card.querySelector(".stats-tip");
  const show = (e) => {
    const target = e.target.closest("[data-tip]");
    svg.querySelectorAll(".stats-hot").forEach((el) => el.classList.remove("stats-hot"));
    if (!target) { tip.classList.add("hidden"); return; }
    const markId = target.dataset.mark;
    if (markId) svg.querySelectorAll(`[data-mark-of="${markId}"]`).forEach((el) => el.classList.add("stats-hot"));
    tip.textContent = target.dataset.tip;
    tip.classList.remove("hidden");
    const cardBox = card.getBoundingClientRect();
    const markBox = target.getBoundingClientRect();
    const x = markBox.left + markBox.width / 2 - cardBox.left;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.max(half + 4, Math.min(cardBox.width - half - 4, x))}px`;
    tip.style.top = `${svg.getBoundingClientRect().top - cardBox.top - 6}px`;
  };
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointermove", show);
  // A finger "leaves" right after every tap, which would hide the tip the tap
  // just opened; only a mouse leaving means the reader moved on.
  svg.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    tip.classList.add("hidden");
    svg.querySelectorAll(".stats-hot").forEach((el) => el.classList.remove("stats-hot"));
  });
}

// ---------- line chart (one exercise over time) ----------
function statsLineSvg(series, key, unit, width) {
  const height = 170;
  const padL = 34, padR = 10, padT = 12, padB = 22;
  const values = series.map((p) => p[key]);
  const ticks = statsNiceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const times = series.map((p) => statsParseDate(p.date).getTime());
  const t0 = times[0], t1 = times[times.length - 1];
  const sx = (t) => padL + (t1 === t0 ? (width - padL - padR) / 2 : ((t - t0) / (t1 - t0)) * (width - padL - padR));
  const sy = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * (height - padT - padB);
  const grid = ticks.map((v) => `
    <line class="stats-grid" x1="${padL}" x2="${width - padR}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}"></line>
    <text class="stats-axis" x="${padL - 6}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${statsCompact(v)}</text>`).join("");
  const pts = series.map((p, i) => [sx(times[i]), sy(p[key])]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const bestIndex = values.indexOf(Math.max(...values));
  // Hit areas are vertical strips around each point, much wider than the dot,
  // so a thumb finds the nearest session instead of having to land on 5 px.
  const mids = pts.map(([x], i) => [
    i === 0 ? padL : (pts[i - 1][0] + x) / 2,
    i === pts.length - 1 ? width - padR : (x + pts[i + 1][0]) / 2,
  ]);
  // Dots only while they have room; dense series keep just the best and the
  // latest session marked, the rest is the line.
  const roomy = (width - padL - padR) / pts.length >= 9;
  const dots = pts.map(([x, y], i) => {
    const d = statsParseDate(series[i].date);
    const tipText = `${d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}: ${statsFormat(values[i], unit)}${i === bestIndex ? " (best)" : ""}`;
    return `
      <circle class="stats-dot${i === bestIndex ? " best" : ""}${roomy || i === bestIndex || i === pts.length - 1 ? "" : " quiet"}" data-mark-of="p${i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === bestIndex || i === pts.length - 1 ? 4.5 : 3}"></circle>
      <rect class="stats-hit" data-mark="p${i}" data-tip="${escapeHtml(tipText)}" x="${mids[i][0].toFixed(1)}" y="0" width="${Math.max(1, mids[i][1] - mids[i][0]).toFixed(1)}" height="${height}"></rect>`;
  }).join("");
  const first = statsParseDate(series[0].date), last = statsParseDate(series[series.length - 1].date);
  const fmt = (d) => d.toLocaleDateString("en", { month: "short", year: "numeric" });
  return `
    <svg class="stats-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(key)} over time">
      ${grid}
      <polyline class="stats-line" points="${line}"></polyline>
      ${dots}
      <text class="stats-axis" x="${padL}" y="${height - 6}">${fmt(first)}</text>
      <text class="stats-axis" x="${width - padR}" y="${height - 6}" text-anchor="end">${fmt(last)}</text>
    </svg>`;
}

// ---------- bar chart (per week) ----------
function statsBarSvg(weeks, unitFn, width) {
  const height = 150;
  const padL = 34, padR = 6, padT = 12, padB = 22;
  const values = weeks.map((w) => w.value);
  const ticks = statsNiceTicks(0, Math.max(1, ...values));
  const hi = ticks[ticks.length - 1];
  const sy = (v) => padT + (1 - v / hi) * (height - padT - padB);
  const slot = (width - padL - padR) / weeks.length;
  const gap = Math.min(4, slot * 0.25);
  const barW = Math.max(1, slot - gap);
  const grid = ticks.map((v) => `
    <line class="stats-grid" x1="${padL}" x2="${width - padR}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}"></line>
    <text class="stats-axis" x="${padL - 6}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${statsCompact(v)}</text>`).join("");
  const radius = Math.min(4, barW / 2);
  const bars = weeks.map((w, i) => {
    const x = padL + i * slot + gap / 2;
    const y = sy(w.value);
    const h = Math.max(0, sy(0) - y);
    const tipText = `Week of ${statsShortDate(w.start)}${w.current ? " (so far)" : ""}: ${unitFn(w.value)}`;
    // Rounded at the data end only, square on the baseline.
    const path = h > 0
      ? `M${x},${sy(0)} V${y + Math.min(radius, h)} Q${x},${y} ${x + Math.min(radius, h)},${y} H${x + barW - Math.min(radius, h)} Q${x + barW},${y} ${x + barW},${y + Math.min(radius, h)} V${sy(0)} Z`
      : "";
    return `
      ${path ? `<path class="stats-bar${w.current ? " current" : ""}" data-mark-of="w${i}" d="${path}"></path>` : ""}
      <rect class="stats-hit" data-mark="w${i}" data-tip="${escapeHtml(tipText)}" x="${(padL + i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height}"></rect>`;
  }).join("");
  // Average of the finished weeks only: the running week would drag it down.
  const done = weeks.filter((w) => !w.current);
  const avg = done.length ? done.reduce((s, w) => s + w.value, 0) / done.length : null;
  const avgLine = avg
    ? `<line class="stats-avg" x1="${padL}" x2="${width - padR}" y1="${sy(avg).toFixed(1)}" y2="${sy(avg).toFixed(1)}"></line>`
    : "";
  const labelEvery = Math.ceil(weeks.length / 4);
  const xLabels = weeks.map((w, i) => (i % labelEvery === 0
    ? `<text class="stats-axis" x="${(padL + i * slot + slot / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle">${statsShortDate(w.start)}</text>`
    : "")).join("");
  return {
    avg,
    svg: `
      <svg class="stats-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Per week">
        ${grid}${bars}${avgLine}${xLabels}
      </svg>`,
  };
}

// ---------- sparkline for the ranking rows ----------
function statsSparkSvg(values) {
  const w = 64, h = 22;
  if (values.length < 2) return "";
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 6)).toFixed(1)}`).join(" ");
  return `<svg class="stats-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}"></polyline></svg>`;
}

// ---------- the cards ----------
function statsCardWidth(host) {
  // Card has 16px padding on each side; fall back to a phone width while hidden.
  return Math.max(240, Math.floor((host.clientWidth || 360) - 34));
}

async function renderStatsExerciseCard(card, ctx) {
  const { exerciseOptions, width } = ctx;
  if (!statsState.exercise || !exerciseOptions.all.includes(statsState.exercise)) {
    statsState.exercise = exerciseOptions.recent[0] || exerciseOptions.all[0] || null;
  }
  const name = statsState.exercise;
  const optionHtml = (n) => `<option value="${escapeHtml(n)}"${n === name ? " selected" : ""}>${escapeHtml(n)}</option>`;
  const rest = exerciseOptions.all.filter((n) => !exerciseOptions.recent.includes(n));
  card.innerHTML = `
    <div class="chart-card-header"><span>Exercise progress</span></div>
    <select class="stats-select" aria-label="Exercise">
      ${exerciseOptions.recent.length ? `<optgroup label="Trained lately">${exerciseOptions.recent.map(optionHtml).join("")}</optgroup>` : ""}
      <optgroup label="All exercises">${rest.map(optionHtml).join("")}</optgroup>
    </select>
    <div class="stats-body">${skeletonHtml(2)}</div>`;
  card.querySelector(".stats-select").addEventListener("change", (e) => {
    statsState.exercise = e.target.value;
    saveStatsState();
    renderStatsExerciseCard(card, ctx);
  });
  if (!name) { card.querySelector(".stats-body").innerHTML = "<div class='chart-stub-note'>No exercises yet.</div>"; return; }

  let history;
  try {
    history = await apiGet(`/api/exercises/${encodeURIComponent(name)}/history`);
  } catch (err) {
    card.querySelector(".stats-body").innerHTML = "<div class='meta'>Can't load this exercise right now (offline?).</div>";
    return;
  }
  if (statsState.exercise !== name) return; // picked another one while this loaded
  const { series, metrics } = statsSeriesFor(history);
  const metric = metrics.find((m) => m.key === statsState.metric) || metrics[0];
  const inRange = statsFilterRange(series, statsState.range);
  const body = card.querySelector(".stats-body");
  const controls = `
    <div class="stats-controls">
      ${statsChipsHtml(metrics.map((m) => [m.key, m.label]), metric.key, "metric")}
      ${statsChipsHtml(STATS_EXERCISE_RANGES, statsState.range, "range")}
    </div>`;
  let headline = "";
  let chart;
  if (inRange.length >= 2) {
    const firstV = inRange[0][metric.key], lastV = inRange[inRange.length - 1][metric.key];
    const diff = lastV - firstV;
    const pct = firstV ? Math.round((diff / firstV) * 100) : null;
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
    headline = `
      <div class="chart-card-value">${statsFormat(lastV, metric.unit)}</div>
      <div class="stats-delta${diff > 0 ? " up" : diff < 0 ? " down" : ""}">${sign}${statsFormat(Math.abs(diff), metric.unit)}${pct != null ? ` (${sign}${Math.abs(pct)} %)` : ""} since ${statsShortDate(statsParseDate(inRange[0].date))} &middot; ${inRange.length} sessions</div>`;
    chart = statsLineSvg(inRange, metric.key, metric.unit, width);
  } else {
    chart = `<div class="chart-stub-note">${inRange.length === 1 ? "Only one session in this range -- pick a longer one to see a trend." : series.length ? "No sessions in this range -- pick a longer one." : "No sets logged for this exercise yet."}</div>`;
  }
  body.innerHTML = `${controls}${headline}<div class="stats-plot">${chart}<div class="stats-tip hidden"></div></div>`;
  body.querySelectorAll("[data-metric]").forEach((b) => b.addEventListener("click", () => {
    statsState.metric = b.dataset.metric; saveStatsState(); renderStatsExerciseCard(card, ctx);
  }));
  body.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    statsState.range = b.dataset.range; saveStatsState(); renderStatsExerciseCard(card, ctx);
  }));
  wireStatsTooltip(body.querySelector(".stats-plot"));
}

// Which lifts are moving: est. 1RM of the latest sessions against the first
// ones inside the window. Comparing the best of a few sessions at each end,
// not single sessions, keeps one off day from flipping the sign.
async function renderStatsRankingCard(card, ctx, onPick) {
  const cutoff = Date.now() - STATS_RANKING_DAYS * 86400000;
  card.innerHTML = `
    <div class="chart-card-header"><span>Which lifts are moving</span></div>
    <div class="stats-sub">Est. 1RM, last ${STATS_RANKING_DAYS} days: first sessions vs. latest</div>
    <div class="stats-body">${skeletonHtml(3)}</div>`;
  const candidates = ctx.exerciseOptions.recent.slice(0, STATS_RANKING_SIZE * 2);
  const rows = [];
  for (let i = 0; i < candidates.length; i += 3) {
    const batch = await Promise.all(candidates.slice(i, i + 3).map(async (name) => {
      try {
        const history = await apiGet(`/api/exercises/${encodeURIComponent(name)}/history`);
        const series = computeExerciseSessionSeries(history.sessions || [])
          .filter((p) => statsParseDate(p.date).getTime() >= cutoff);
        if (series.length < 3) return null;
        const n = Math.min(3, Math.floor(series.length / 2));
        const startBest = Math.max(...series.slice(0, n).map((p) => p.best1rm));
        const endBest = Math.max(...series.slice(-n).map((p) => p.best1rm));
        if (!startBest) return null;
        return { name, pct: ((endBest - startBest) / startBest) * 100, diff: endBest - startBest, values: series.map((p) => p.best1rm) };
      } catch (err) {
        return null;
      }
    }));
    rows.push(...batch.filter(Boolean));
    if (rows.length >= STATS_RANKING_SIZE) break;
  }
  const body = card.querySelector(".stats-body");
  if (!rows.length) {
    body.innerHTML = `<div class="chart-stub-note">Needs at least three weighted sessions of an exercise in the last ${STATS_RANKING_DAYS} days.</div>`;
    return;
  }
  rows.sort((a, b) => b.pct - a.pct);
  body.innerHTML = rows.slice(0, STATS_RANKING_SIZE).map((r) => {
    const rounded = Math.round(r.pct);
    const cls = rounded > 0 ? "up" : rounded < 0 ? "down" : "";
    const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
    return `
      <button class="stats-rank-row" data-pick="${escapeHtml(r.name)}">
        <span class="stats-rank-name">${escapeHtml(r.name)}</span>
        ${statsSparkSvg(r.values)}
        <span class="stats-delta ${cls}">${sign}${Math.abs(rounded)} %</span>
      </button>`;
  }).join("");
  body.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => onPick(b.dataset.pick)));
}

function statsWeeklyBuckets(workouts, weekCount) {
  const thisWeek = statsWeekStart(new Date());
  const weeks = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - 7 * i);
    weeks.push({ start, key: statsYmd(start), volume: 0, workouts: 0, minutes: 0, current: i === 0 });
  }
  const byKey = new Map(weeks.map((w) => [w.key, w]));
  workouts.forEach((w) => {
    const week = byKey.get(statsYmd(statsWeekStart(statsParseDate(w.started_at))));
    if (!week) return;
    week.volume += w.volume_kg || 0;
    week.workouts += 1;
    week.minutes += (w.duration_sec || 0) / 60;
  });
  return weeks;
}

function renderStatsWeeklyCard(card, ctx) {
  const metric = STATS_WEEK_METRICS.find((m) => m.key === statsState.weekMetric) || STATS_WEEK_METRICS[0];
  const weeks = statsWeeklyBuckets(ctx.workouts, Number(statsState.weekRange)).map((w) => ({ ...w, value: w[metric.key] }));
  const unitFn = {
    volume: (v) => statsFormat(v, "kg"),
    workouts: (v) => `${v} workout${v === 1 ? "" : "s"}`,
    minutes: (v) => (v >= 60 ? `${Math.floor(v / 60)} h ${Math.round(v % 60)} min` : `${Math.round(v)} min`),
  }[metric.key];
  const { svg, avg } = statsBarSvg(weeks, unitFn, ctx.width);
  const current = weeks[weeks.length - 1];
  card.innerHTML = `
    <div class="chart-card-header"><span>Per week</span></div>
    <div class="stats-controls">
      ${statsChipsHtml(STATS_WEEK_METRICS.map((m) => [m.key, m.label]), metric.key, "wmetric")}
      ${statsChipsHtml(STATS_WEEK_RANGES, statsState.weekRange, "wrange")}
    </div>
    <div class="chart-card-value">${unitFn(current.value)}</div>
    <div class="stats-sub">this week so far${avg != null ? ` &middot; average ${unitFn(metric.key === "workouts" ? Math.round(avg * 10) / 10 : avg)} (dashed line)` : ""}</div>
    <div class="stats-plot">${svg}<div class="stats-tip hidden"></div></div>`;
  card.querySelectorAll("[data-wmetric]").forEach((b) => b.addEventListener("click", () => {
    statsState.weekMetric = b.dataset.wmetric; saveStatsState(); renderStatsWeeklyCard(card, ctx);
  }));
  card.querySelectorAll("[data-wrange]").forEach((b) => b.addEventListener("click", () => {
    statsState.weekRange = b.dataset.wrange; saveStatsState(); renderStatsWeeklyCard(card, ctx);
  }));
  wireStatsTooltip(card.querySelector(".stats-plot"));
}

// Training calendar: one column per week, Monday on top, a filled cell per day
// with a workout. Shows rhythm and gaps at a glance, which the weekly bars
// average away.
function renderStatsCalendarCard(card, ctx) {
  const byDay = new Map();
  ctx.workouts.forEach((w) => {
    const key = statsYmd(statsParseDate(w.started_at));
    byDay.set(key, [...(byDay.get(key) || []), w.name || "Workout"]);
  });
  const weeks = Math.min(STATS_CALENDAR_WEEKS, Math.floor((ctx.width - 22) / 12));
  const cell = Math.floor((ctx.width - 22) / weeks) - 2;
  const size = Math.max(6, Math.min(16, cell));
  const step = size + 2;
  const today = new Date();
  const firstMonday = statsWeekStart(today);
  firstMonday.setDate(firstMonday.getDate() - 7 * (weeks - 1));
  let cells = "";
  let trained = 0;
  for (let c = 0; c < weeks; c++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(firstMonday);
      d.setDate(d.getDate() + c * 7 + r);
      if (d > today) continue;
      const names = byDay.get(statsYmd(d));
      if (names) trained += names.length;
      const tipText = `${d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}: ${names ? names.join(", ") : "rest"}`;
      cells += `<rect class="stats-day${names ? " on" : ""}" data-mark-of="d${c}-${r}" x="${22 + c * step}" y="${r * step}" width="${size}" height="${size}" rx="2"></rect>
        <rect class="stats-hit" data-mark="d${c}-${r}" data-tip="${escapeHtml(tipText)}" x="${22 + c * step - 1}" y="${r * step - 1}" width="${step}" height="${step}"></rect>`;
    }
  }
  const height = 7 * step;
  const dayLabels = [[0, "Mon"], [2, "Wed"], [4, "Fri"]]
    .map(([r, l]) => `<text class="stats-axis" x="0" y="${r * step + size - 1}">${l}</text>`).join("");
  card.innerHTML = `
    <div class="chart-card-header"><span>Training days</span></div>
    <div class="stats-sub">${trained} workouts in the last ${weeks} weeks &middot; ${(trained / weeks).toFixed(1)} per week</div>
    <div class="stats-plot">
      <svg class="stats-svg" viewBox="0 0 ${22 + weeks * step} ${height}" width="${22 + weeks * step}" height="${height}" role="img" aria-label="Training days">${dayLabels}${cells}</svg>
      <div class="stats-tip hidden"></div>
    </div>`;
  wireStatsTooltip(card.querySelector(".stats-plot"));
}

let statsRenderToken = 0;
async function renderStatisticsCharts() {
  const host = document.getElementById("stats-native");
  const grafana = document.getElementById("stats-grafana");
  if (!host) return;
  const on = featureEnabled("statsCharts");
  host.classList.toggle("hidden", !on);
  // Without a snapshot base the Grafana panels can only ever be empty boxes;
  // with these charts on, hide them instead of leaving blanks underneath.
  if (grafana) grafana.classList.toggle("hidden", on && !GRAFANA_SNAPSHOT_BASE);
  if (!on) return;

  const token = ++statsRenderToken;
  host.innerHTML = `<div class="chart-card">${skeletonHtml(3)}</div>`;
  let workouts, recent, all;
  try {
    [workouts, recent, all] = await Promise.all([
      apiGet("/api/workouts"),
      apiGet(`/api/workouts?include_summary=1&limit=${STATS_RECENT_LIMIT}`),
      apiGet("/api/exercises"),
    ]);
  } catch (err) {
    if (token === statsRenderToken) host.innerHTML = "<div class='chart-card'><div class='meta'>Can't load statistics right now (offline?).</div></div>";
    return;
  }
  if (token !== statsRenderToken) return;

  // "Trained lately" = most sessions among the latest workouts, ties by recency.
  const counts = new Map();
  (recent.workouts || []).forEach((w, idx) => (w.exercises || []).forEach((e) => {
    const c = counts.get(e.exercise_name) || { n: 0, last: idx };
    c.n += 1;
    counts.set(e.exercise_name, c);
  }));
  const recentNames = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[1].last - b[1].last).map(([n]) => n);
  const allNames = [...new Set([...(all.exercises || []), ...recentNames])].sort((a, b) => a.localeCompare(b));

  host.innerHTML = `
    <div class="chart-card" id="stats-card-exercise"></div>
    <div class="chart-card" id="stats-card-ranking"></div>
    <div class="chart-card" id="stats-card-weekly"></div>
    <div class="chart-card" id="stats-card-calendar"></div>`;
  const ctx = {
    workouts: workouts.workouts || [],
    exerciseOptions: { recent: recentNames, all: allNames },
    width: statsCardWidth(host),
  };
  const exerciseCard = document.getElementById("stats-card-exercise");
  renderStatsExerciseCard(exerciseCard, ctx);
  renderStatsWeeklyCard(document.getElementById("stats-card-weekly"), ctx);
  renderStatsCalendarCard(document.getElementById("stats-card-calendar"), ctx);
  renderStatsRankingCard(document.getElementById("stats-card-ranking"), ctx, (name) => {
    statsState.exercise = name;
    saveStatsState();
    renderStatsExerciseCard(exerciseCard, ctx);
    exerciseCard.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
