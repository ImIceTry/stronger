// ---------- history screen (moved from app.js, 2026-09-17) ----------

// ---------- history screen ----------

async function renderHistoryScreen() {
  // No inline calendar here anymore -- just the recent-workouts list. The
  // full Strong-style calendar lives in the modal (openCalendarModal), opened
  // via the calendar icon; workouts only surface when you tap into a day
  // there or into a card here, not both places always visible at once.
  let workouts = [];
  try {
    // 15 read as "only about 2 months" at ImIceTry's real training frequency
    // (2026-09-10) -- bumped well past that rather than guessing again.
    const data = await apiGet("/api/workouts?include_pr=1&include_summary=1&limit=90");
    workouts = data.workouts;
  } catch (err) {
    // offline -- list just stays empty, no crash
  }

  const pending = await Queue.getAll();
  const recentCutoff = new Date(Date.now() - 30 * 86400000);
  pending.forEach((item) => {
    if (new Date(item.payload.started_at.replace(" ", "T")) >= recentCutoff) {
      workouts.push({ ...item.payload, id: null, pending: true });
    }
  });

  renderRecentList(workouts);
}

async function openCalendarModal() {
  let workouts = [];
  try {
    const data = await apiGet("/api/workouts");
    workouts = data.workouts;
  } catch (err) {
    // offline -- show the calendar with nothing marked rather than failing outright
  }
  const workoutsByDate = {};
  workouts.forEach((w) => {
    const d = w.started_at.slice(0, 10);
    (workoutsByDate[d] = workoutsByDate[d] || []).push(w);
  });

  const today = new Date();
  // Spans the real history, not a fixed 3-month window -- was hardcoded to
  // "current + 2 previous months" (matched the one reference screenshot's
  // example span, but that screenshot just happened to have limited data,
  // not a real 3-month design limit). Falls back to 2 months back if there's
  // no workout history yet (offline first load, brand new install).
  let earliest = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  workouts.forEach((w) => {
    const d = new Date(w.started_at.replace(" ", "T"));
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    if (monthStart < earliest) earliest = monthStart;
  });
  const startMonth = earliest;
  const endMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const todayStr = fmtDateOnly(today);

  let html = `<div class="cal-modal-sticky-header">` +
    `<h3>Calendar</h3>` +
    `<div class="cal-modal-weekdays">${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => `<span>${d}</span>`).join("")}</div>` +
    `</div>` +
    `<div class="cal-modal-grid calendar">`;

  // Transition pairs collected while building the grid (each: the real
  // last-day-of-month date string and the real first-day-of-next-month
  // date string either side of a month boundary) -- used after the grid
  // is actually in the DOM to draw a real connected line between the two
  // real cells, see drawMonthBoundaries below. Can't compute the connector
  // from date math alone; it needs each cell's real measured position.
  const transitions = [];
  let cur = new Date(startMonth);
  let lastMonth = -1;
  let lastDateStr = null;
  while (cur <= endMonth) {
    if (cur.getDate() === 1) {
      if (lastMonth !== -1) {
        // Real bug caught here (2026-09-18): only the very first month
        // needs leading empty cells to align its 1st onto the right
        // weekday column. Every month after that follows immediately
        // after the previous month's real last day with no gap, and
        // consecutive calendar days always land on consecutive grid
        // columns automatically (day N+1's weekday is always day N's
        // weekday + 1, matching the grid's own every-7-wraps cycle) -- so
        // inserting MORE empty cells here, on top of that already-correct
        // auto-flow, pushed every single day from the 2nd month onward
        // one column too far right. This was masked before today by the
        // old month-pill div, which spanned the full row width and forced
        // a fresh row start of its own -- removing that pill (in favor of
        // this connected-line divider) exposed the extra-cell bug that
        // was always latent underneath it.
        transitions.push({ from: lastDateStr, to: fmtDateOnly(cur) });
      } else {
        const wd = cur.getDay();
        for (let i = 0; i < wd; i++) html += `<div class="day empty"></div>`;
      }
      lastMonth = cur.getMonth();
    }
    const dateStr = fmtDateOnly(cur);
    let cls = "day";
    if (workoutsByDate[dateStr]) cls += " trained";
    if (dateStr === todayStr) cls += " today";
    html += `<div class="${cls}" data-date="${dateStr}">${cur.getDate()}</div>`;
    lastDateStr = dateStr;
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  html += `</div>`;

  openModal(html);
  modalContent.classList.add("calendar-modal");
  // Opens scrolled to today, not the earliest month -- the grid now spans
  // the full real history (could be 2+ years), so landing at the very start
  // would bury the one date you almost always actually want.
  const todayEl = modalContent.querySelector(".day.today");
  if (todayEl) todayEl.scrollIntoView({ block: "center" });
  drawMonthBoundaries(transitions);
  modalContent.querySelectorAll(".day.trained").forEach((el) => {
    el.addEventListener("click", () => {
      const dayWorkouts = workoutsByDate[el.dataset.date];
      // closeModal() directly, not closeTopNavLayer() -- this closes the
      // calendar and opens that workout's detail in one motion, which
      // should still take exactly one back-press to undo, not two. See
      // closeModal()'s own self-cleanup comment for why calling it directly
      // here (rather than going through history.back()) keeps navLayers
      // truthful for this same-gesture close-then-open-something-else case.
      closeModal();
      if (dayWorkouts && dayWorkouts.length) {
        showScreen("history");
        showWorkoutDetail(dayWorkouts[0].id, dayWorkouts[0]);
      }
    });
  });
}

// UI Polish Pass (2026-09-18) -- the month boundary needs to read as one
// real line running BETWEEN dates (in the gaps), never touching or
// crossing a date cell itself. Runs after the grid is actually in the DOM
// since it needs each real day cell's measured position -- pure date math
// alone can't know where a cell landed on screen.
//
// Real bug found and fixed here: the original version assumed the
// outgoing month's last real day is always in the row ABOVE the incoming
// month's first real day, and drew a diagonal from one cell's bottom edge
// to the other's top edge. That's only true when the last day happens to
// fall on a Saturday (6 out of 7 possible weekdays) -- every OTHER case
// has the two days sitting in the SAME row, adjacent columns (e.g. June
// 30 Sunday -> July 1 Monday), and the "diagonal" from one cell's bottom
// up to the other's top then traveled almost a full row height, slicing
// straight through both cells' own content -- exactly the "cuts out a
// date" ImIceTry reported. Two real cases now handled separately: same-row
// (draw one vertical line in the gap between the two adjacent columns)
// and cross-row/Saturday-to-Sunday (one continuous horizontal line
// spanning the full row-gap width, centered in the gap -- still touches
// neither cell, and reads as one real line left-to-right rather than two
// disconnected ticks, per ImIceTry's follow-up ask).
const MONTH_NAMES_SHORT_CAPS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const SVG_NS = "http://www.w3.org/2000/svg";

function drawMonthBoundaries(transitions) {
  const grid = modalContent.querySelector(".cal-modal-grid");
  if (!grid || !transitions.length) return;
  const overlay = document.createElement("div");
  overlay.className = "cal-month-boundary-overlay";
  const gridRect = grid.getBoundingClientRect();
  const rowGap = parseFloat(getComputedStyle(grid).rowGap) || 0;
  const colWidth = (gridRect.width - 6 * rowGap) / 7;
  // Labels always sit centered under the Monday column (index 1), not at
  // the actual bend point -- ImIceTry's ask: a label that jumps around
  // depending on which weekday the transition happens to fall on read as
  // inconsistent; anchoring every one to the same column keeps them all
  // scanning down one vertical line regardless of where the real boundary
  // sits within its row.
  const leftLabelX = colWidth + rowGap + colWidth / 2;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "cal-month-boundary-svg");
  overlay.appendChild(svg);

  const addPath = (d) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "cal-month-boundary-path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  };

  const addLabel = (x, y, to) => {
    const toDate = new Date(to.replace(" ", "T"));
    const label = document.createElement("div");
    label.className = "cal-month-boundary-label";
    label.textContent = `${MONTH_NAMES_SHORT_CAPS[toDate.getMonth()]} ${toDate.getFullYear()}`;
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
    overlay.appendChild(label);
  };

  transitions.forEach(({ from, to }) => {
    const fromEl = grid.querySelector(`[data-date="${from}"]`);
    const toEl = grid.querySelector(`[data-date="${to}"]`);
    if (!fromEl || !toEl) return;
    // offsetTop/offsetLeft/offsetWidth/offsetHeight, not
    // getBoundingClientRect() -- real bug found here (2026-09-18):
    // .day.trained is scaled up via `transform: scale(1.15)` (see
    // style-history.css), and getBoundingClientRect() reports the
    // POST-transform, visually-scaled box. Since that scale is centered on
    // the cell, a trained cell's measured top/bottom shift up/down by
    // several px relative to an untrained neighbor in the exact same grid
    // row -- which was throwing off the same-row check below whenever one
    // side of a transition happened to be trained (e.g. Aug 31 2026
    // trained, Sep 1 not), misclassifying a same-row transition as
    // cross-row and drawing a full-width line under the WRONG row,
    // visually grouping several days of the new month in with the old one.
    // offset* is unaffected by transforms (it reflects the untransformed
    // layout box), and since .cal-modal-grid is `position: relative`, it's
    // also already the offsetParent for every .day -- these numbers are
    // grid-relative for free, no gridRect subtraction needed.
    const fromRight = fromEl.offsetLeft + fromEl.offsetWidth;
    const fromTop = fromEl.offsetTop;
    const fromBottom = fromEl.offsetTop + fromEl.offsetHeight;
    const toLeft = toEl.offsetLeft;
    const toTop = toEl.offsetTop;

    const sameRow = Math.abs(fromTop - toTop) < 2;

    if (sameRow) {
      // The common case (6 of 7 possible last-weekdays): the two real days
      // sit right next to each other in the same row. A real staircase
      // bend (horizontal-vertical-horizontal), each straight run going all
      // the way to its own grid edge -- not a short cap near the bend
      // (ImIceTry's ask: a short cap left the far side of the row, e.g. Aug
      // 30 sitting two full columns from the nearest visible line, with no
      // line actually separating it from Sept's cells).
      //
      // Real bug caught here (2026-09-18, screenshot): the two runs were
      // originally assigned backwards -- old month's own columns (0..x)
      // got the line ABOVE the row, new month's own columns (x..edge) got
      // it BELOW. But "above the row, under column N" is only a real
      // boundary if the row ABOVE has a DIFFERENT month at that same
      // column -- and the row above this shared row is entirely the OLD
      // month, so a line under the old month's own columns there just cut
      // across the middle of one unbroken month (May 31 read as fenced off
      // from the rest of May above it). The real transitions are the
      // opposite pairing: above the row, under the NEW month's columns
      // (that column WAS old month in the row above, e.g. previous week's
      // Thursday == May, this week's Thursday == June); below the row,
      // under the OLD month's columns (that column IS new month in the
      // row below, e.g. May 31 above, June 7 below).
      const x = (fromRight + toLeft) / 2;
      const topY = fromTop - rowGap / 2;
      const bottomY = fromBottom + rowGap / 2;
      const gridWidth = gridRect.width;
      // A real curve at each bend, not a squared-off corner (ImIceTry's
      // ask) -- quadratic-curve corners (the bend's own x,y as control
      // point) round the two direction changes into a soft S. Clamped to
      // rowGap/2, not just some fixed max: the curve's vertical reach past
      // topY/bottomY is exactly r, and topY/bottomY already sit at the
      // dead center of the row-gap (rowGap/2 in from the nearest real row)
      // -- an r bigger than that pushes the curve past the gap and into
      // the actual day cell above/below it. Since `gap: 20px` sets row-gap
      // and column-gap to the same value, the same rowGap/2 clamp also
      // keeps the curve from crossing sideways into the neighboring
      // column's cell.
      const r = Math.max(0, Math.min(rowGap / 2, x, gridWidth - x));

      addPath(
        `M ${gridWidth},${topY} ` +
        `L ${x + r},${topY} ` +
        `Q ${x},${topY} ${x},${topY + r} ` +
        `L ${x},${bottomY - r} ` +
        `Q ${x},${bottomY} ${x - r},${bottomY} ` +
        `L 0,${bottomY}`
      );

      addLabel(leftLabelX, bottomY, to);
    } else {
      // The Saturday-to-Sunday case: the two real days are in different
      // rows and different (non-adjacent) columns -- but since a whole
      // real week separates them either way, one continuous line spanning
      // the full row-gap (left edge to right edge) reads better than two
      // separate ticks that don't visually connect to anything (ImIceTry's
      // ask): it still touches neither cell, sitting centered in the gap.
      // No bend here, so no curve needed -- a straight run start to finish.
      const gridWidth = gridRect.width;
      const y = fromBottom + rowGap / 2;
      addPath(`M 0,${y} L ${gridWidth},${y}`);
      addLabel(leftLabelX, y, to);
    }
  });

  grid.appendChild(overlay);
}

document.getElementById("open-calendar-btn").addEventListener("click", openCalendarModal);

const MONTH_NAMES_FULL = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const WEEKDAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "Wednesday, September 9, 2026 at 19:24" -- matches Strong's own history
// card date format exactly (reference screenshot, 2026-09-12), used instead
// of toLocaleDateString/Intl so it doesn't drift with the browser's own
// locale/timezone settings -- started_at is a naive local-time string
// already, parsed by hand the same way the rest of this file treats it.
function formatLongDateTime(startedAt) {
  const [datePart, timePart] = startedAt.split(" ");
  const [year, month, day] = datePart.split("-").map((n) => parseInt(n, 10));
  const d = new Date(year, month - 1, day);
  const hhmm = timePart ? timePart.slice(0, 5) : "";
  return `${WEEKDAY_NAMES_FULL[d.getDay()]}, ${MONTH_NAMES_FULL[month - 1]} ${day}, ${year} at ${hhmm}`;
}

function renderRecentList(monthWorkouts) {
  const sorted = [...monthWorkouts].sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  const list = document.getElementById("history-list");
  list.innerHTML = "";

  // Group by calendar month, matching Strong's "September / 3 workouts"
  // section headers instead of one flat list.
  const groups = [];
  let lastKey = null;
  sorted.forEach((w) => {
    const d = new Date(w.started_at.replace(" ", "T"));
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== lastKey) {
      groups.push({ label: MONTH_NAMES_FULL[d.getMonth()], items: [] });
      lastKey = key;
    }
    groups[groups.length - 1].items.push(w);
  });

  groups.forEach((group) => {
    const header = document.createElement("div");
    header.className = "history-month-header";
    header.innerHTML = `<h2>${group.label}</h2><span>${group.items.length} workout${group.items.length === 1 ? "" : "s"}</span>`;
    list.appendChild(header);

    group.items.forEach((w) => {
      const item = document.createElement("div");
      item.className = "list-item";
      const pendingTag = w.pending ? " (pending sync)" : "";
      const footer = w.pending
        ? ""
        : `<div class="footer">
             <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>${w.duration_sec ? formatWorkoutDurationLabel(w.duration_sec) : "-"}</span>
             <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20l6-10 4 6 3-5 5 9z"/></svg>${Math.round(w.volume_kg || 0)} kg</span>
             <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8M12 17v4M6 4h12v3a6 6 0 0 1-12 0V4z"/><path d="M6 5H4a2 2 0 0 0 2 4M18 5h2a2 2 0 0 1-2 4"/></svg>${w.pr_count || 0} PRs</span>
           </div>`;
      const exerciseSummary = w.pending || !w.exercises || !w.exercises.length
        ? ""
        : `<div class="history-summary">
             <div class="history-summary-header"><span>Sets</span><span>Best set</span></div>
             ${w.exercises.map((ex) => {
               const rpeTag = ex.best_set && ex.best_set.rpe != null ? ` @${ex.best_set.rpe}` : "";
               // best_set.unilateral (2026-09-16) marks a fallback -- every
               // set for this exercise this session was unilateral, so
               // there's no real bilateral number to prefer instead. Tagged
               // the same way a confirmed set's own row already is, so it
               // doesn't read as a real two-handed working weight.
               const bestUnilateralTag = ex.best_set && ex.best_set.unilateral ? " (U)" : "";
               const bestText = ex.best_set ? `${formatSetValue(ex.unit_type, ex.best_set)}${rpeTag}${bestUnilateralTag}` : "-";
               return `<div class="history-summary-row">
                 <span>${ex.set_count} &times; ${escapeHtml(ex.exercise_name)}</span>
                 <span>${bestText}</span>
               </div>`;
             }).join("")}
           </div>`;
      item.innerHTML = `<div class="title">${escapeHtml(w.name)}${pendingTag}</div>` +
                        `<div class="meta">${escapeHtml(formatLongDateTime(w.started_at))}</div>${exerciseSummary}${footer}`;
      if (w.id != null) {
        item.addEventListener("click", () => showWorkoutDetail(w.id, w));
      }
      list.appendChild(item);
    });
  });
}

// Epley formula, matching records.py's estimated_1rm() exactly -- computed
// client-side per set (not a running best) since it's a pure function of
// that set's own weight_kg/reps, not worth a backend round-trip for.
// Strong's own reference screenshot's numbers don't match this formula
// (its 1RM column looks closer to Brzycki -- 70kg x7 -> 84 there, which is
// Brzycki's 70*36/30, not Epley's 86.3) -- deliberately not chasing that:
// every other 1RM in this app (Records tab, PR flagging) already uses Epley,
// and disagreeing with itself between screens would be worse than disagreeing
// with an opaque, undocumented reference number on one screen.
function estimated1rmClient(weightKg, reps) {
  if (weightKg == null || reps == null || reps <= 0) return null;
  return weightKg * (1 + reps / 30);
}

// Shared between the real (saved) workout-detail screen below and the
// pre-finish summary shown from finishOrSaveWorkout (2026-09-16, ImIceTry's
// ask) -- same set-grouping/sorting/row-building either way, just wrapped
// differently (one's a full screen with PERFORM AGAIN + a menu, the other's
// a modal step with a single Continue button, before the workout is even
// saved -- see showFinishSummary).
// Handle / grip / machine variant used for an exercise's sets (2026-10-10,
// ImIceTry's ask) -- one line of distinct combinations, so a switch mid-exercise
// still shows both.
function machineFactorSuffix(ratio) {
  return ratio != null && ratio !== 1 ? ` \u00d7${+Number(ratio).toFixed(3)}` : "";
}

function exerciseGearLabel(sets) {
  const seen = [];
  sets.forEach((s) => {
    const machine = s.variant ? s.variant + machineFactorSuffix(s.weight_ratio) : "";
    const label = [s.handle, s.grip, machine].filter(Boolean).join(" \u00b7 ");
    if (label && !seen.includes(label)) seen.push(label);
  });
  return seen.join(" / ");
}

function renderWorkoutSummaryBlocks(sets, unitTypeByExercise) {
  // Group sets per exercise, preserving first-appearance order -- same
  // grouping shape as exercise_summary_for_workout, built independently
  // here since this view needs every set (not just the best one).
  const order = [];
  const grouped = {};
  sets.forEach((s) => {
    if (!grouped[s.exercise_name]) {
      grouped[s.exercise_name] = [];
      order.push(s.exercise_name);
    }
    grouped[s.exercise_name].push(s);
  });
  // Sets sync in confirmation order, which can now differ from set_order
  // (any pending row can be confirmed first, Strong-parity) -- sort each
  // exercise's own sets back into their logical 1..N sequence for display.
  order.forEach((exerciseName) => grouped[exerciseName].sort((a, b) => a.set_order - b.set_order));

  return order.map((exerciseName) => {
    const unitType = unitTypeByExercise[exerciseName] || "weight_reps";
    const showOneRm = unitType === "weight_reps";
    const rows = grouped[exerciseName].map((s) => {
      const typeTag = (s.set_type === "drop" ? " (D)" : s.set_type === "failure" ? " (F)" : s.set_type === "warmup" ? " (W)" : s.set_type === "assisted" ? ` (A${s.assisted_reps != null ? s.assisted_reps : ""})` : "") + (s.unilateral ? " (U)" : "") + (s.side === "left" ? " (L→R)" : s.side === "right" ? " (R→L)" : "");
      const rpeTag = s.rpe != null ? ` @${s.rpe}` : "";
      const oneRm = showOneRm ? estimated1rmClient(s.weight_kg, s.reps) : null;
      return `<div class="wd-set-row${showOneRm ? "" : " no-1rm"}">
        <span class="wd-set-num">${s.set_order}${typeTag}</span>
        <span class="wd-set-value">${formatSetValue(unitType, s)}${rpeTag}</span>
        ${showOneRm ? `<span class="wd-set-1rm">${oneRm != null ? Math.round(oneRm) : "-"}</span>` : ""}
      </div>`;
    }).join("");
    const gear = exerciseGearLabel(grouped[exerciseName]);
    return `<div class="wd-exercise-block">
      <div class="wd-exercise-header">
        <span>${escapeHtml(exerciseName)}</span>
        ${showOneRm ? `<span>1RM</span>` : ""}
      </div>
      ${gear ? `<div class="wd-exercise-gear">${escapeHtml(gear)}</div>` : ""}
      ${rows}
    </div>`;
  }).join("");
}

// Share a finished workout (2026-09-17, Function Expansion Plan item 2.2) --
// plain text, not an image: no new rendering pipeline needed (reuses the
// same set data the detail screen itself already fetched), and text pastes
// cleanly into any destination (SMS, a chat app, a note) without the sizing/
// cropping problems an image would carry across wildly different screens.
function buildWorkoutShareText(w, unitTypeByExercise, totalVolume) {
  const order = [];
  const grouped = {};
  w.sets.forEach((s) => {
    if (!grouped[s.exercise_name]) {
      grouped[s.exercise_name] = [];
      order.push(s.exercise_name);
    }
    grouped[s.exercise_name].push(s);
  });
  order.forEach((name) => grouped[name].sort((a, b) => a.set_order - b.set_order));

  const lines = [`${w.name} — ${w.started_at.slice(0, 10)}`, ""];
  order.forEach((exerciseName) => {
    const gear = exerciseGearLabel(grouped[exerciseName]);
    lines.push(gear ? `${exerciseName} (${gear})` : exerciseName);
    grouped[exerciseName].forEach((s) => {
      const unitType = unitTypeByExercise[exerciseName] || "weight_reps";
      const typeTag = (s.set_type === "drop" ? " (D)" : s.set_type === "failure" ? " (F)" : s.set_type === "warmup" ? " (W)" : s.set_type === "assisted" ? ` (A${s.assisted_reps != null ? s.assisted_reps : ""})` : "") + (s.unilateral ? " (U)" : "") + (s.side === "left" ? " (L→R)" : s.side === "right" ? " (R→L)" : "");
      const rpeTag = s.rpe != null ? ` @${s.rpe}` : "";
      // formatSetValue's "&times;" is an HTML entity meant for innerHTML --
      // this is plain text (a textarea value / share sheet body), so it
      // needs the real "×" character instead, or it leaks out as the
      // literal 7 characters "&times;". Same class of bug this project
      // already found and fixed once for the rest-timer notification body
      // (2026-09-14) -- caught here before shipping by actually reading the
      // rendered textarea value during verification, not just checking the
      // function returned without erroring.
      const value = formatSetValue(unitType, s).replace(/&times;/g, "×");
      lines.push(`  ${s.set_order}${typeTag}: ${value}${rpeTag}`);
    });
    lines.push("");
  });
  lines.push(`Volume: ${Math.round(totalVolume || 0)} kg`);
  if (w.duration_sec) lines.push(`Duration: ${formatWorkoutDurationLabel(w.duration_sec)}`);
  return lines.join("\n");
}

// Real Web Share API first (works on the native Android wrap and modern
// mobile browsers, brings up the OS's own share sheet), clipboard as the
// desktop-browser fallback, and a plain read-only textarea in a modal if
// even that isn't available -- never a dead end with nothing to actually
// do.
async function shareWorkoutText(title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return; // user cancelled the native share sheet -- not an error
      // fall through to clipboard/modal below on any other failure
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied to clipboard.");
      return;
    } catch (err) {
      // fall through to the modal below
    }
  }
  openModal(`
    <h3>Share workout</h3>
    <textarea class="exercise-note-input" rows="10" readonly>${escapeHtml(text)}</textarea>
    <div class="modal-actions">
      <button id="share-text-done" class="btn-primary">Done</button>
    </div>
  `);
  // UI Polish Pass (2026-09-18) -- was the one dialog in the app relying
  // purely on the generic backdrop-tap/back-button close, unlike e.g. the
  // rename modal's explicit Save button, since there's genuinely nothing
  // to save here -- an explicit close still reads more finished than
  // silently having no button at all.
  modalContent.classList.add("size-compact");
  document.getElementById("share-text-done").addEventListener("click", closeTopNavLayer);
}

async function showWorkoutDetail(workoutId, summary, onClose) {
  showScreenRaw("screen-workout-detail");
  pushNavLayer(onClose || (() => showScreen("history")));
  const bodyEl = document.getElementById("workout-detail-body");
  bodyEl.innerHTML = skeletonHtml();
  try {
    const w = await apiGet(`/api/workouts/${workoutId}`);
    const totalVolume = summary ? summary.volume_kg : w.sets.reduce((sum, s) => sum + (s.weight_kg || 0) * (s.reps || 0), 0);
    const prCount = summary ? summary.pr_count || 0 : null;

    const unitTypeByExercise = {};
    (w.exercise_summary || []).forEach((ex) => { unitTypeByExercise[ex.exercise_name] = ex.unit_type; });

    const exerciseBlocks = renderWorkoutSummaryBlocks(w.sets, unitTypeByExercise);

    bodyEl.innerHTML = `
      <h1 class="wd-title">${escapeHtml(w.name)}</h1>
      <div class="meta wd-date">${escapeHtml(formatLongDateTime(w.started_at))}</div>
      ${exerciseBlocks}
      <div class="detail-footer">
        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>${w.duration_sec ? formatWorkoutDurationLabel(w.duration_sec) : "-"}</span>
        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20l6-10 4 6 3-5 5 9z"/></svg>${Math.round(totalVolume || 0)} kg</span>
        ${prCount != null ? `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8M12 17v4M6 4h12v3a6 6 0 0 1-12 0V4z"/><path d="M6 5H4a2 2 0 0 0 2 4M18 5h2a2 2 0 0 1-2 4"/></svg>${prCount} PRs</span>` : ""}
      </div>
      <button class="btn-primary wd-perform-again" id="workout-detail-perform-again">PERFORM AGAIN</button>
    `;

    document.getElementById("workout-detail-perform-again").addEventListener("click", () => startWorkout(workoutId));
    document.getElementById("workout-detail-menu-btn").onclick = () => openWorkoutDetailMenu(w);
    document.getElementById("workout-detail-share-btn").onclick = () => {
      shareWorkoutText(w.name, buildWorkoutShareText(w, unitTypeByExercise, totalVolume));
    };
  } catch (err) {
    bodyEl.innerHTML = "Can't load this workout right now (offline?).";
  }
}

function openWorkoutDetailMenu(w) {
  // UI Polish Pass 2026-09-18, item 3 -- migrated to the side panel;
  // icons reuse EXERCISE_MENU_ICONS (app-exercise-menu.js) rather than
  // drawing near-duplicate edit/trash glyphs a second time.
  openSidePanel("Workout options", `
    <div class="side-panel-row" data-action="edit"><svg class="side-panel-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS.note}</svg><span class="side-panel-row-label">Edit this workout</span></div>
    <div class="side-panel-row template-row-danger" data-action="delete"><svg class="side-panel-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS.remove}</svg><span class="side-panel-row-label">Delete this workout</span></div>
  `);
  sidePanel.querySelector('[data-action="edit"]').addEventListener("click", () => {
    // closeSidePanel() directly, not closeTopNavLayer() -- real bug fixed
    // here (2026-09-18, ImIceTry: Edit "doesn't actually open the workout").
    // closeTopNavLayer()'s history.back() doesn't resolve synchronously; it
    // schedules a popstate for later. startEditingWorkout ends by calling
    // showActiveWorkoutOverlay(), which does a synchronous
    // history.pushState() of its own -- running that before the scheduled
    // back-navigation actually fires interleaves two history operations
    // out of order, so the delayed popstate can end up firing against the
    // freshly pushed overlay layer and immediately closing it again right
    // after it opened (same class of race as the 2026-09-16 stuck Finish
    // dialog -- see app-nav.js's own comment on that bug). closeSidePanel()
    // closes synchronously with no pending navigation, so there's nothing
    // left to race against.
    closeSidePanel();
    startEditingWorkout(w);
  });
  sidePanel.querySelector('[data-action="delete"]').addEventListener("click", async () => {
    // Real deletion, not reversible -- explicit in the confirm copy itself,
    // matching the same "say exactly what's at stake" convention the
    // template-delete confirm above already uses.
    if (!(await showConfirmDialog(`Delete this workout (${w.name}, ${w.started_at.slice(0, 10)})? This permanently removes it and all its logged sets -- it can't be undone.`, { confirmLabel: "Delete", danger: true }))) return;
    // closeTopNavLayer(), not closeModal() directly -- this is the general
    // "explicit in-app close, nothing else opening right after" case (see
    // closeTopNavLayer's own comment), unlike askUnfinishedSetsChoice/
    // askTemplateUpdateChoice's closeModal() calls which immediately chain
    // into opening a replacement dialog. Calling closeModal() here left a
    // real browser-history entry un-popped (closeModal only pops the JS
    // navLayers array, not history itself) -- the closeTopNavLayer() call
    // below then silently spent its one real history.back() undoing that
    // debt instead of actually leaving the workout's own detail screen, so
    // deleting a workout left you stranded on its now-empty detail view
    // instead of bouncing back to History (2026-09-16 bug report).
    closeTopNavLayer();
    try {
      await apiDelete(`/api/workouts/${w.id}`);
      allExercisesCache = null; // times_performed/last_performed may have shifted
      closeTopNavLayer(); // back out of the now-deleted workout's own detail screen
      await renderHistoryScreen();
    } catch (err) {
      alert(err.message || "Couldn't delete this workout (offline?). Try again once you have signal.");
    }
  });
}

document.getElementById("workout-detail-back").addEventListener("click", closeTopNavLayer);
