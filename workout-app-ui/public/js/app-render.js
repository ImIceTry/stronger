// ---------- rendering: exercise list order, set-value formatting, rest divider, exercise card (moved from app.js, 2026-09-17) ----------

// -- rendering --

function orderedExerciseList() {
  // Superset-grouped exercises render adjacent to each other; everything else keeps its original order.
  const groups = activeWorkout.supersets || {};
  const seen = new Set();
  const result = [];
  activeWorkout.exercises.forEach((name) => {
    if (seen.has(name)) return;
    result.push(name);
    seen.add(name);
    const group = groups[name];
    if (group) {
      activeWorkout.exercises.forEach((other) => {
        if (other !== name && !seen.has(other) && groups[other] === group) {
          result.push(other);
          seen.add(other);
        }
      });
    }
  });
  return result;
}

// Where this exercise sits within its (adjacent) superset run, so the cards
// of one superset can be drawn joined together.
function supersetSlot(exerciseName) {
  const groups = activeWorkout.supersets || {};
  const group = groups[exerciseName];
  if (!group) return { cont: false, last: true };
  const list = orderedExerciseList();
  const i = list.indexOf(exerciseName);
  return { cont: i > 0 && groups[list[i - 1]] === group, last: !(i + 1 < list.length && groups[list[i + 1]] === group) };
}

// Shared weight_reps/time/reps_only formatter -- used for both a confirmed
// set's own display and the PREVIOUS column (same {weight_kg, reps,
// duration_sec} shape either way). Showing "0kg x 18" for a reps_only
// exercise would be actively wrong, not just cosmetic -- this is why
// Phase 3.2 exists.
function formatSetValue(unitType, s) {
  if (!s) return "-";
  if (unitType === "time") {
    return s.duration_sec != null ? formatMmssBuffer(secondsToMmssBuffer(s.duration_sec)) : "-";
  }
  if (unitType === "reps_only") {
    return s.reps != null ? `${s.reps} reps` : "-";
  }
  return `${s.weight_kg ?? "-"}kg &times; ${s.reps ?? "-"}`;
}

// The rest divider after a set row -- shown for every row now, not just
// confirmed ones, so it's already visible (idle, showing the exercise's
// configured rest) instead of appearing out of nowhere the moment a set
// gets confirmed (ImIceTry's own request, 2026-09-10). Three states: live
// (ticking, tappable to adjust), historical (a confirmed set's own
// recorded rest_after_sec, static), or idle (preview of what confirming
// this row *would* use, static, visually muted since it hasn't happened).
function buildRestDividerHtml(exerciseName, position, confirmedSet, suppressForDropPair, isJustActivated) {
  // No divider between a drop set's own two halves (2026-09-11, ImIceTry's
  // own call) -- there's no real rest in between (you drop the weight and
  // keep going), so showing one read as a normal inter-set gap that isn't
  // real. The two rows sit directly adjacent instead, reading as one
  // connected unit rather than two separate sets.
  if (suppressForDropPair) return "";
  // A template's exercise list has no real sets happening, so there's
  // nothing for a rest timer to sit between -- suppress it entirely while
  // building/editing a scratch template (2026-09-10, ImIceTry's own call).
  if (buildingTemplateMode) return "";
  const liveCtx = allRestContexts().find((c) => c.exerciseName === exerciseName && c.position === position);
  const isLiveRest = !!liveCtx;
  const isHistorical = confirmedSet && confirmedSet.rest_after_sec != null;
  // A live divider paints its running countdown straight away (2026-09-29),
  // not the exercise's configured rest length: with superset partners, a
  // full re-render (e.g. confirming the other exercise's set) redraws this
  // divider while its own timer is mid-count, and the per-second tick only
  // repaints it up to 1s later -- so it used to flash back to the start
  // value first. The bar width gets the same treatment.
  const seconds = isLiveRest ? liveCtx.remaining : isHistorical ? confirmedSet.rest_after_sec : restSecondsFor(exerciseName, position);
  const timeLabel = formatClock(seconds);
  const livePct = isLiveRest && liveCtx.total > 0 ? Math.max(0, Math.min(100, (liveCtx.remaining / liveCtx.total) * 100)) : 100;
  const isIdle = !isLiveRest && !isHistorical;
  const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="rest-bar-icon"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`;
  // The ENTIRE bar is now the tappable target (2026-09-10), not just the
  // time text -- idle opens the numpad to edit this exercise's default
  // rest, live opens it to edit the running countdown. Live also gets its
  // own explicit stop control, separate from the bar tap (which edits the
  // duration, not cancels it).
  if (isLiveRest) {
    // The ticking span is its own element, separate from the icon (2026-09-10
    // fix) -- startRestTimer's per-second update patches .rest-divider-tick's
    // textContent directly; targeting the button itself instead used to wipe
    // out the icon on the very first tick since textContent replaces all
    // children, not just the text. Also carries data-numpad-field (2026-09-11)
    // so the edit numpad's own updateFieldDisplay() patches it live while
    // typing, same mechanism a KG/REPS field already uses. No more separate
    // stop button (2026-09-11) -- ending early now happens via the numpad's
    // own Skip control (see openRestEditNumpad), so the whole bar has
    // exactly one tap target again. .rest-divider-progress is an empty div
    // whose width the same per-second update shrinks from 100%, giving the
    // bar's own depletion a visual, not just the digits (ImIceTry's own call).
    // just-activated (2026-09-12) plays the idle-line-to-bar morph exactly
    // once, on the same render that logSet's confirm turned this specific
    // position's rest divider live -- not on every later render while it's
    // still ticking (isLiveRest alone stays true for many renders, e.g. if
    // some other exercise's own confirm redraws this whole card again while
    // this timer is still running).
    return `<button class="rest-divider live${isJustActivated ? " just-activated" : ""}" data-rest-divider="${exerciseName}::${position}">
      <div class="rest-divider-progress" style="width: ${livePct}%"></div>
      <span class="rest-divider-content">${icon}<span class="rest-divider-tick" data-numpad-field="${exerciseName}:${position}:duration">${timeLabel}</span></span>
    </button>`;
  }
  if (isIdle) {
    // Just a line with the time in the middle (2026-09-12, ImIceTry's own
    // ask) -- no icon, no box, a hairline on each side instead. Tightens
    // every idle gap between sets, which is most of them most of the time
    // (a rest divider is only ever the fuller bar while actually live or
    // once it has real recorded history). Tapping it still opens the same
    // edit numpad as before; it morphs into the live bar for real once a
    // set gets confirmed and this position's timer actually starts (see
    // the .just-activated branch above).
    return `<button class="rest-divider idle" data-idle-rest="${exerciseName}" data-idle-position="${position}" data-rest-divider="${exerciseName}::${position}">
      <span class="rest-divider-line"></span>
      <span class="rest-divider-time idle" data-numpad-field="${exerciseName}:${position}:duration">${timeLabel}</span>
      <span class="rest-divider-line"></span>
    </button>`;
  }
  // Historical (a finished set's own recorded rest) is a real button now too
  // (2026-09-11, previously a plain unclickable div) -- editing a rest you
  // already logged should stay possible after the fact, same as a confirmed
  // set's own KG/REPS values already are.
  return `<button class="rest-divider historical" data-historical-rest="${exerciseName}" data-historical-position="${position}" data-rest-divider="${exerciseName}::${position}">
    ${icon}<span class="rest-divider-time" data-numpad-field="${exerciseName}:${position}:duration">${timeLabel}</span>
  </button>`;
}

// A pending row's "Goal" line (2026-09-30, ImIceTry's pick from the review
// feature list): progressionAdvice's target for this row's historical set,
// i.e. the concrete numbers that beat last time. Shown only -- the row's
// own prefill stays last time's numbers, so tapping the checkmark untouched
// still logs exactly what it always did. weight_reps and reps_only only (a
// timed hold has no rep/weight ladder), and not for warm-up/drop/assisted
// rows or history sets, which aren't straight working sets to progress on.
const NO_GOAL_SET_TYPES = ["warmup", "drop", "assisted", "failure"];
function pendingGoalText(exerciseName, prev, unitType, mode, rowSetType) {
  if (!prev || mode === "time" || unitType === "time") return "";
  if (NO_GOAL_SET_TYPES.includes(rowSetType) || NO_GOAL_SET_TYPES.includes(prev.set_type)) return "";
  if (unitType === "reps_only") return prev.reps != null ? `${prev.reps + 1} reps` : "";
  const ceiling = repCeilingCache[exerciseName] ?? REP_CEILING_DEFAULT;
  const { target } = progressionAdvice(prev, ceiling, nextWeightUp(exerciseName, prev.weight_kg, prev.unilateral));
  return target ? `${target.weight_kg}kg &times; ${target.reps}` : "";
}

function renderExerciseCard(card, exerciseName, previousData, unitType, justConfirmedThisRender) {
  unitType = unitType || "weight_reps";
  // Every exercise renders the same KG + REPS/TIME + RPE layout now
  // (2026-09-12, ImIceTry's own ask) -- no more collapsing time/reps_only
  // exercises into a single-column layout that dropped the RPE option.
  // `mode` is this card's current default for its still-open rows (REPS
  // unless the exercise's own unit_type says otherwise, or the header
  // toggle has overridden it for this session) -- a confirmed set never
  // consults it, since that row already has its own real reps/duration_sec.
  const mode = fieldModeOverrideByExercise[exerciseName] || (unitType === "time" ? "time" : "reps");
  const confirmedSets = activeWorkout.sets.filter((s) => s.exercise_name === exerciseName);
  const confirmedByOrder = new Map(confirmedSets.map((s) => [s.set_order, s]));
  const maxConfirmedOrder = confirmedSets.length ? Math.max(...confirmedSets.map((s) => s.set_order)) : 0;
  const group = activeWorkout.supersets ? activeWorkout.supersets[exerciseName] : null;

  // Reference screenshots of Strong (2026-09-10) show every set from last
  // time up front with its own live checkmark -- not growing one at a time,
  // and any of them can be confirmed in any order. That only works because
  // set_order here is a fixed target position (assigned at render time from
  // which row you're looking at), not "however many are done so far + 1" --
  // confirming set 3 first doesn't strand set 1's row, it just leaves it
  // open at position 1 same as before. Extra sets beyond history are added
  // explicitly via the ADD SET control (matching Strong's own text link),
  // not auto-grown, tracked per exercise in extraSetsByExercise.
  const prevSetCount = previousData && previousData.sets ? previousData.sets.length : 0;
  const extraSets = extraSetsByExercise[exerciseName] || 0;
  const totalPositions = Math.max(maxConfirmedOrder, prevSetCount, 1) + extraSets;

  const exercisePendingInput = pendingInputByExercise[exerciseName] || {};
  const exercisePendingRpe = pendingRpeByExercise[exerciseName] || {};
  const exercisePendingSetType = pendingSetTypeByExercise[exerciseName] || {};

  // Confirmed or still-pending, either way -- used to detect a drop set's
  // own two-row pair so the divider between them can be suppressed (see
  // buildRestDividerHtml's suppressForDropPair).
  const setTypeAtPosition = (pos) => {
    const confirmed = confirmedByOrder.get(pos + 1);
    if (confirmed) return confirmed.set_type || "normal";
    return exercisePendingSetType[pos] || "normal";
  };

  const rowsHtml = [];
  for (let position = 0; position < totalPositions; position++) {
    const setOrder = position + 1;
    const s = confirmedByOrder.get(setOrder);
    // Shared by both branches below -- PREVIOUS always means last time's
    // performance (history), never this row's own just-logged data. Used
    // to leak the confirmed set's own {weight/reps/rpe} into this column
    // instead (2026-09-11 fix): harmless for weight/reps since those
    // usually match what was prefilled anyway, but meant a real historical
    // RPE visibly disappeared the instant you confirmed the set it was
    // shown next to, since a freshly-confirmed set rarely has its own RPE
    // picked yet.
    const prevForIndex = previousForSetIndex(previousData, historicalIndexFor(exerciseName, position));
    const prevRpeTag = prevForIndex && prevForIndex.rpe != null ? ` @${prevForIndex.rpe}` : "";
    const prevText = prevForIndex ? `${formatSetValue(unitType, prevForIndex)}${prevRpeTag}` : "-";
    if (s) {
      // "assisted" (2026-09-18) shows its own rep count inline when known --
      // "(A)" alone would lose the one piece of data this set type actually
      // exists to capture, unlike drop/warmup/failure which are pure flags.
      // "failure" stays rendered too (not just accepted by validation) --
      // the 2 real historical sets still tagged with it need to keep
      // reading correctly, even though it's no longer a creatable option.
      const typeTag = (s.set_type === "drop" ? " (D)" : s.set_type === "failure" ? " (F)" : s.set_type === "warmup" ? " (W)" : s.set_type === "assisted" ? ` (A${s.assisted_reps != null ? s.assisted_reps : ""})` : "") + (s.unilateral ? " (U)" : "") + (s.side === "left" ? " (L)" : s.side === "right" ? " (R)" : "");
      // Only the row matching this exact confirm action plays its mount
      // animation (2026-09-12 fix, see justConfirmedKey) -- every other
      // already-confirmed row on the screen renders in its plain settled
      // state, even though it's also a freshly-created DOM node this render.
      const isJustConfirmed = justConfirmedThisRender === `${exerciseName}::${s.set_order}`;
      const justConfirmedClass = isJustConfirmed ? " just-confirmed" : "";
      // Always a real, tappable button now (2026-09-17, Function Expansion
      // Plan item 2.6) -- previously a plain <span> shown only when RPE
      // already had a value, so a confirmed set with none had no way to add
      // one short of reopening the whole set via editConfirmedSet (which
      // also resets its weight/reps entry state, real overkill just to
      // attach an RPE after the fact). "+RPE" ghost prompt when unset, same
      // muted styling the rest of this app's ghost-prefill affordances use.
      const confirmedRpeBadge = `<button class="rpe-badge${justConfirmedClass}${s.rpe == null ? " ghost" : ""}" data-rpe-edit-order="${s.set_order}">${s.rpe != null ? s.rpe : "+RPE"}</button>`;
      // A confirmed set's own mode is whatever it actually holds, not this
      // card's current toggle -- switching the header's REPS/TIME default
      // later shouldn't retroactively relabel a set already logged.
      const confirmedMode = s.duration_sec != null ? "time" : "reps";
      const secondFieldText = confirmedMode === "time"
        ? formatMmssBuffer(secondsToMmssBuffer(s.duration_sec))
        : (s.reps ?? "-");
      // No more pencil/× buttons (2026-09-10, ImIceTry's own call) -- tapping
      // the KG/REPS value itself reopens exactly this set for editing
      // (reuses editConfirmedSet, same as the old pencil did, then opens
      // the numpad straight to the field that was tapped), and delete is a
      // left-swipe on the row now instead of a dedicated button -- see
      // wireSwipeToDelete below.
      const valueCells = `<button class="col-kg" data-edit-order="${s.set_order}" data-edit-field="weight" data-numpad-field="${escapeHtml(exerciseName)}:${position}:weight">${s.weight_kg ?? "-"}</button>
           <div class="rpe-badge-wrap"><button class="col-reps" data-edit-order="${s.set_order}" data-edit-field="${confirmedMode === "time" ? "duration" : "reps"}" data-numpad-field="${escapeHtml(exerciseName)}:${position}:${confirmedMode === "time" ? "duration" : "reps"}">${secondFieldText}</button>${confirmedRpeBadge}</div>`;
      // Same simple checkmark glyph a pending row's own confirm-btn uses now
      // (2026-09-12, ImIceTry's own ask) -- just recolored via CSS
      // (button.confirm-btn.confirmed .confirmed-check), not a different
      // icon shape swapped in on confirm.
      rowsHtml.push(`
      <div class="set-row-swipe-wrap" data-swipe-order="${s.set_order}">
        <div class="swipe-delete-bg">Delete</div>
        <div class="set-row confirmed${justConfirmedClass}">
          <button class="col-set" data-set-type-edit-order="${s.set_order}">${logicalSetNumber(exerciseName, position)}${typeTag}</button>
          <span class="col-previous">${prevText}</span>
          ${valueCells}
          <span class="col-check"><button class="confirm-btn confirmed" data-uncheck-order="${s.set_order}" title="Uncheck"><svg class="confirmed-check${justConfirmedClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></button></span>
        </div>
      </div>`);
      rowsHtml.push(buildRestDividerHtml(exerciseName, position, s, s.set_type === "drop" && setTypeAtPosition(position + 1) === "drop", isJustConfirmed));
      continue;
    }

    // Swiped away (2026-09-10) -- a pending row (not yet logged) can be
    // deleted too now, same left-swipe gesture as a confirmed one. Renders
    // nothing at all for this position, no divider either, rather than
    // renumbering everything after it -- see skippedPositionsByExercise.
    if ((skippedPositionsByExercise[exerciseName] || new Set()).has(position)) continue;

    const typedInput = exercisePendingInput[position];
    const prefillWeight = typedInput ? typedInput.weight
      : (prevForIndex && prevForIndex.weight_kg != null ? prevForIndex.weight_kg : "");
    const prefillReps = typedInput ? typedInput.reps
      : (prevForIndex && prevForIndex.reps != null ? prevForIndex.reps : "");
    const prefillDuration = typedInput ? typedInput.duration
      : (prevForIndex && prevForIndex.duration_sec != null ? secondsToMmssBuffer(prevForIndex.duration_sec) : "");

    // Stays a dim "ghost" suggestion for as long as the set itself is still
    // pending -- typing via the numpad or tapping PREVIOUS both still just
    // fill in a value to review, not a committed one (2026-09-10 revision:
    // previously solidified the moment either happened, which ImIceTry found
    // misleading -- tapping the checkmark on it still logs exactly this
    // number either way; only that checkmark should turn it solid).
    const ghostClass = " ghost";
    // Same ghost-prefill treatment as weight/reps/duration now (2026-09-12,
    // ImIceTry's own ask) -- previously RPE only ever appeared once the
    // picker was explicitly opened, unlike every other field. Seeded into
    // pendingRpeByExercise itself, not just read for display, since logSet
    // reads that map directly (RPE has no DOM-backed field for it to read
    // from the way weight/reps/duration do via readField) -- confirming
    // without ever touching RPE must still submit this suggested value.
    let rowRpe = exercisePendingRpe[position];
    if (rowRpe === undefined && prevForIndex && prevForIndex.rpe != null) {
      rowRpe = prevForIndex.rpe;
      if (!pendingRpeByExercise[exerciseName]) pendingRpeByExercise[exerciseName] = {};
      pendingRpeByExercise[exerciseName][position] = rowRpe;
    }
    const rowSetType = exercisePendingSetType[position] || "normal";
    // RPE badge sits on the reps box's own corner (2026-09-11, moved off
    // KG -- RPE describes how the reps felt). Needs its own wrapper (not a
    // child of the numpad-field div itself) since that div's textContent
    // doubles as the numpad's read/write data -- a nested badge would
    // corrupt weight/reps parsing. Ghost-styled like every other pending
    // field, whether it's a real pick or this prefill, until confirmed.
    const rpeBadge = rowRpe != null ? `<span class="rpe-badge ghost">${rowRpe}</span>` : "";
    const secondFieldKey = mode === "time" ? "duration" : "reps";
    const secondFieldDisplay = mode === "time"
      ? (prefillDuration ? formatMmssBuffer(prefillDuration) : "-")
      : (prefillReps || "-");
    const fieldsHtml = `
      <div class="col-kg numpad-field${ghostClass}" data-numpad-field="${escapeHtml(exerciseName)}:${position}:weight">${prefillWeight || "-"}</div>
      <div class="rpe-badge-wrap">
        <div class="col-reps numpad-field${ghostClass}" data-numpad-field="${escapeHtml(exerciseName)}:${position}:${secondFieldKey}">${secondFieldDisplay}</div>
        ${rpeBadge}
      </div>`;

    // Tapping PREVIOUS copies those exact numbers into the fields below,
    // same as if typed (2026-09-10) -- distinct from the passive prefill
    // (item 25), an explicit "use last time's numbers" action. Only a real
    // button when there's actually a previous value to copy.
    const goalText = pendingGoalText(exerciseName, prevForIndex, unitType, mode, rowSetType);
    const previousCell = prevForIndex
      ? `<button class="col-previous" data-prev-index="${position}">${prevText}${goalText ? `<span class="prev-goal">Goal ${goalText}</span>` : ""}</button>`
      : `<span class="col-previous">${prevText}</span>`;
    // The set number itself is now the type control (2026-09-10, replaces
    // the old "Set options" link) -- tap it to pick Warm-up/Drop/Assisted,
    // and it shows the type's own letter instead of the number while one's
    // active, same convention confirmed rows already use inline (typeTag).
    // Plain "A" here, no rep count (2026-09-18) -- unlike the confirmed
    // row's own typeTag, this badge replaces the set NUMBER itself, where a
    // 2-3 char count would crowd out legibility; the count still shows once
    // the set is actually confirmed.
    const typeLetter = rowSetType === "drop" ? "D" : rowSetType === "failure" ? "F" : rowSetType === "warmup" ? "W" : rowSetType === "assisted" ? "A" : null;
    // Independent flag, not a 4th type letter -- combines with one (e.g.
    // "D¹") or stands alone ("U") when the set is otherwise Normal.
    const isPendingUnilateral = isPositionUnilateral(exerciseName, position);
    const setBadge = typeLetter
      ? typeLetter + (isPendingUnilateral ? "¹" : "")
      : (isPendingUnilateral ? "U" : null);
    // Both classes at once when combined (e.g. "tagged drop unilateral") --
    // CSS selectors like .tagged.drop still match regardless of what else is
    // in the list, so this doesn't change any existing single-tag styling.
    const pendingSide = isPendingUnilateral ? (pendingSideByExercise[exerciseName] || {})[position] : null;
    const activeSetTags = [];
    if (typeLetter) activeSetTags.push(rowSetType);
    if (isPendingUnilateral) activeSetTags.push("unilateral");
    if (pendingSide) activeSetTags.push("side-" + pendingSide);
    const setBadgeClass = activeSetTags.length ? " tagged " + activeSetTags.join(" ") : "";
    rowsHtml.push(`
      <div class="set-row-swipe-wrap" data-swipe-pending="${position}">
        <div class="swipe-delete-bg">Delete</div>
        <div class="set-row pending" data-pending-index="${position}">
          <button class="col-set${setBadgeClass}" data-set-type-btn="${position}">${setBadge || logicalSetNumber(exerciseName, position)}</button>
          ${previousCell}
          ${fieldsHtml}
          <span class="col-check"><button class="confirm-btn"><svg class="confirmed-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></button></span>
        </div>
      </div>`);
    rowsHtml.push(buildRestDividerHtml(exerciseName, position, null, rowSetType === "drop" && setTypeAtPosition(position + 1) === "drop"));
  }
  const combinedRowsHtml = rowsHtml.join("");

  const exerciseNote = activeWorkout.exerciseNotes ? activeWorkout.exerciseNotes[exerciseName] : null;
  const stickyNote = stickyNoteCache[exerciseName];
  // Machine/variant tag (2026-09-17, Function Expansion Plan item 3.2) --
  // deliberately only rendered when actually set (usually auto-carried
  // forward from last time, see fetchPreviousPerformance's .then above), not
  // shown as an empty "+" hint on every card -- most exercises only ever
  // have one machine, so this should stay invisible for the common case.
  // Setting one for the first time goes through the options menu instead.
  const machineVariant = (activeWorkout.variantByExercise || {})[exerciseName];
  // Cable handle/grip chip (2026-10-06) -- always shown on exercises that
  // support it so there's a visible way to set it; placement is provisional.
  const machineSettings = machineSettingsFor(exerciseName);
  const machineSettingsLabel = machineSettings.map((p) => p[1] ? `${p[0]} ${p[1]}` : p[0]).join(" \u00b7 ");
  const handleGripSupported = exerciseSupportsHandleGrip(exerciseName);
  const handleGripLabel = [(activeWorkout.handleByExercise || {})[exerciseName], (activeWorkout.gripByExercise || {})[exerciseName]].filter(Boolean).join(" \u00b7 ");

  // The REPS/TIME label is a real button now (2026-09-12) -- tapping it
  // opens openFieldModePicker to switch this exercise's still-open rows
  // between the two, instead of that choice being permanently fixed by the
  // exercise's own unit_type.
  const headerCells = `<span class="col-kg">KG</span><button class="col-reps field-mode-toggle" data-field-mode-toggle="${escapeHtml(exerciseName)}">${mode === "time" ? "TIME" : "REPS"}</button>`;

  const addSetSeconds = restSecondsFor(exerciseName, null);
  const addSetLabel = `ADD SET (${formatClock(addSetSeconds)})`;

  const slot = supersetSlot(exerciseName);
  card.className = "exercise-card" + (group ? " superset" : "") + (slot.cont ? " superset-cont" : "") + (group && !slot.last ? " superset-open" : "");
  card.innerHTML = `
    ${group && !slot.cont ? `<div class="superset-label">Superset ${group}</div>` : ""}
    <h3>
      <button class="exercise-name-link" data-exercise-name="${escapeHtml(exerciseName)}">${escapeHtml(exerciseName)}</button>
      <button class="icon-btn options-btn" title="More">&#8943;</button>
    </h3>
    ${stickyNote ? `<div class="variant-bar">${escapeHtml(stickyNote)}</div>` : ""}
    ${handleGripSupported ? `<button class="machine-variant-tag handle-chip" data-handle-grip-chip="${escapeHtml(exerciseName)}">${handleGripLabel ? escapeHtml(handleGripLabel) : "+ Handle / grip"} &#9662;</button>` : ""}
    ${machineSettingsLabel ? `<button class="machine-variant-tag" data-machine-settings-tag="${escapeHtml(exerciseName)}">&#9776; ${escapeHtml(machineSettingsLabel)}</button>` : ""}
    ${machineVariant ? `<button class="machine-variant-tag" data-machine-variant-tag="${escapeHtml(exerciseName)}">&#9881; ${escapeHtml(machineVariant)}</button>` : ""}
    ${exerciseNote ? `<div class="exercise-note">${escapeHtml(exerciseNote)}</div>` : ""}
    <div class="set-table-header">
      <span class="col-set">SET</span>
      <span class="col-previous">PREVIOUS</span>
      ${headerCells}
      <span class="col-check"></span>
    </div>
    <div class="set-list">${combinedRowsHtml}</div>
    <button class="text-link-btn add-set-btn">${addSetLabel}</button>
  `;

  const readField = (el) => {
    if (!el) return null;
    const text = el.textContent.trim();
    return text === "-" || text === "" ? null : text;
  };

  // Every still-open position gets its own fully independent numpad,
  // confirm button, and RPE/set-type strip -- confirming any one of them
  // just logs that exact position's set_order, so doing set 3 before set 1
  // leaves set 1's row open rather than orphaning it.
  for (let position = 0; position < totalPositions; position++) {
    if (confirmedByOrder.has(position + 1)) continue;
    const index = position;
    const rowEl = card.querySelector(`.set-row.pending[data-pending-index="${index}"]`);
    if (!rowEl) continue;

    const prevBtn = rowEl.querySelector(`[data-prev-index="${index}"]`);
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        const prev = previousForSetIndex(previousData, historicalIndexFor(exerciseName, index));
        if (!prev) return;
        if (!pendingInputByExercise[exerciseName]) pendingInputByExercise[exerciseName] = {};
        pendingInputByExercise[exerciseName][index] = {
          weight: prev.weight_kg != null ? String(prev.weight_kg) : "",
          reps: prev.reps != null ? String(prev.reps) : "",
          duration: prev.duration_sec != null ? secondsToMmssBuffer(prev.duration_sec) : "",
        };
        renderActiveScreen();
      });
    }

    // One shared wiring path for every exercise now (2026-09-12) -- the
    // second field is either a plain-digit REPS numpad step or an isDuration
    // TIME one depending on this card's current mode, but both share the
    // same weight-first-then-second-field flow, RPE step included, that
    // only weight_reps sets used to get.
    {
      const weightField = rowEl.querySelector('[data-numpad-field$=":weight"]');
      const secondField = rowEl.querySelector(mode === "time" ? '[data-numpad-field$=":duration"]' : '[data-numpad-field$=":reps"]');
      const prevForIndex = previousForSetIndex(previousData, historicalIndexFor(exerciseName, position));
      const secondFieldConfig = mode === "time"
        ? { key: "duration", isDuration: true, initialValue: readField(secondField), selectOnType: true }
        : { key: "reps", allowDecimal: false, initialValue: readField(secondField), selectOnType: true };
      const readSecondValue = (raw) => {
        if (mode === "time") return { duration_sec: mmssBufferToSeconds(raw) };
        return { reps: raw === "" ? null : parseInt(raw, 10) };
      };
      const openWeightSecondNumpad = (startKey) => {
        const fields = [
          {
            key: "weight", allowDecimal: true, initialValue: readField(weightField), numpadSlot: "weightHint", selectOnType: true,
            weightHintRpe: prevForIndex ? prevForIndex.rpe : null,
            // Double-progression data (2026-09-18, ImIceTry's own ask) -- lets
            // the RPE>=9.5 branch tell "genuinely hit your ceiling at this
            // weight" apart from "just used too much weight for the reps."
            weightHintWeight: prevForIndex ? prevForIndex.weight_kg : null,
            weightHintReps: prevForIndex ? prevForIndex.reps : null,
            // 2026-09-24, ImIceTry's ask: replaces the old "beat your own
            // historical best reps" comparison, which broke once your
            // best-ever at a weight was itself an RPE-10 grind -- a fixed
            // ceiling instead, per-exercise overridable via repCeilingCache.
            weightHintCeiling: exerciseName in repCeilingCache
              ? (repCeilingCache[exerciseName] != null ? repCeilingCache[exerciseName] : REP_CEILING_DEFAULT)
              : REP_CEILING_DEFAULT,
          },
          secondFieldConfig,
        ];
        openNumpad(exerciseName, index, fields, (values) => {
          const weight = values[0] === "" ? null : parseFloat(values[0]);
          if (pendingInputByExercise[exerciseName]) delete pendingInputByExercise[exerciseName][index];
          logSet(exerciseName, index, { weight_kg: weight, ...readSecondValue(values[1]) });
        }, startKey === "second" ? 1 : 0);
      };
      // isSameRowAlreadyOpen: the capture-phase outside-tap listener inside
      // openNumpad (app.js) already runs BEFORE this bubble-phase click
      // handler and, for a tap on this same row's other linked field,
      // swaps the existing session to it in place -- without this guard,
      // this handler would then also fire and open a second, redundant
      // fresh session on top of that swap (real bug fixed 2026-09-18, see
      // openNumpad's own comment on the outside-tap side of this fix).
      const isSameRowAlreadyOpen = () => activeNumpadSession
        && activeNumpadSession.exerciseName === exerciseName
        && activeNumpadSession.index === index;
      weightField.addEventListener("click", () => { if (!isSameRowAlreadyOpen()) openWeightSecondNumpad("weight"); });
      secondField.addEventListener("click", () => { if (!isSameRowAlreadyOpen()) openWeightSecondNumpad("second"); });
      rowEl.querySelector(".confirm-btn").addEventListener("click", () => {
        const weightStr = readField(weightField);
        const weight = weightStr === null ? null : parseFloat(weightStr);
        const secondRaw = mode === "time" ? parseMmssDisplay(secondField.textContent.trim()) : readField(secondField);
        if (pendingInputByExercise[exerciseName]) delete pendingInputByExercise[exerciseName][index];
        if (mode === "time") {
          logSet(exerciseName, index, { weight_kg: weight, duration_sec: secondRaw });
        } else {
          logSet(exerciseName, index, { weight_kg: weight, reps: secondRaw === null ? null : parseInt(secondRaw, 10) });
        }
      });
    }

    card.querySelector(`[data-set-type-btn="${index}"]`).addEventListener("click", () => openSetTypePicker(exerciseName, index, totalPositions));
  }

  card.querySelector(".options-btn").addEventListener("click", () => openExerciseOptionsMenu(exerciseName));
  const machineSettingsTag = card.querySelector("[data-machine-settings-tag]");
  if (machineSettingsTag) machineSettingsTag.addEventListener("click", () => openMachineSettingsModal(exerciseName));
  const machineVariantTag = card.querySelector("[data-machine-variant-tag]");
  if (machineVariantTag) machineVariantTag.addEventListener("click", () => openMachineVariantModal(exerciseName));
  const handleGripChip = card.querySelector("[data-handle-grip-chip]");
  if (handleGripChip) handleGripChip.addEventListener("click", () => openHandleGripModal(exerciseName));
  card.querySelector("[data-field-mode-toggle]").addEventListener("click", () => openFieldModePicker(exerciseName, mode));
  card.querySelector(".exercise-name-link").addEventListener("click", () => openExerciseDetailFromActiveWorkout(exerciseName));
  // Holding anywhere on the name bar enters reorder mode, not just the name
  // text itself (2026-09-13, ImIceTry's own ask) -- the old target was just
  // the narrow name button, easy to miss when reaching for "the bar" as a
  // whole the way you'd grab a drag handle.
  wireLongPress(card.querySelector("h3"), enterReorderMode, 500);
  card.querySelector(".add-set-btn").addEventListener("click", () => {
    extraSetsByExercise[exerciseName] = (extraSetsByExercise[exerciseName] || 0) + 1;
    renderActiveScreen();
  });
  card.querySelectorAll("[data-edit-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const order = parseInt(btn.dataset.editOrder, 10);
      // Same double-open guard the pending-row weight/second fields use
      // (2026-09-18 fix, see openWeightSecondNumpad) -- openNumpad's own
      // capture-phase outside-tap listener already swaps to this field in
      // place when it's the OTHER field of an already-open session on this
      // exact row, so this bubble-phase handler must not also open a second
      // one on top of that swap.
      const isSameRowAlreadyOpen = activeNumpadSession
        && activeNumpadSession.exerciseName === exerciseName
        && activeNumpadSession.index === order - 1;
      if (!isSameRowAlreadyOpen) editConfirmedSetField(exerciseName, order, btn.dataset.editField);
    });
  });
  card.querySelectorAll("[data-rpe-edit-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openRpePickerForConfirmedSet(exerciseName, parseInt(btn.dataset.rpeEditOrder, 10));
    });
  });
  card.querySelectorAll("[data-set-type-edit-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openSetTypePickerForConfirmedSet(exerciseName, parseInt(btn.dataset.setTypeEditOrder, 10));
    });
  });
  card.querySelectorAll(".set-row-swipe-wrap[data-swipe-order]").forEach((wrap) => {
    wireSwipeToDelete(wrap, () => deleteConfirmedSet(exerciseName, parseInt(wrap.dataset.swipeOrder, 10)));
  });
  // Pending rows are swipeable too now (2026-09-10, ImIceTry's own follow-up)
  // -- not just confirmed ones.
  card.querySelectorAll(".set-row-swipe-wrap[data-swipe-pending]").forEach((wrap) => {
    wireSwipeToDelete(wrap, () => deletePendingSet(exerciseName, parseInt(wrap.dataset.swipePending, 10)));
  });
  const liveRestBtn = card.querySelector(".rest-divider.live");
  if (liveRestBtn) {
    liveRestBtn.addEventListener("click", () => {
      promoteRestTimer(exerciseName);
      openRestEditNumpad(exerciseName, restTimerContext.position);
    });
  }
  card.querySelectorAll("[data-idle-rest]").forEach((btn) => {
    btn.addEventListener("click", () => openRestEditNumpad(exerciseName, parseInt(btn.dataset.idlePosition, 10)));
  });
  card.querySelectorAll("[data-historical-rest]").forEach((btn) => {
    btn.addEventListener("click", () => openRestEditNumpad(exerciseName, parseInt(btn.dataset.historicalPosition, 10)));
  });
  card.querySelectorAll("[data-uncheck-order]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      unconfirmSet(exerciseName, parseInt(btn.dataset.uncheckOrder, 10) - 1);
    });
  });
  // A redraw rebuilds every box from saved data, so a numpad still open on
  // this exercise would show the old value and lose its highlight until the
  // next keypress (a finished set's typed digits live only inside the numpad,
  // 2026-10-03). Repaint from the numpad's own values.
  if (activeNumpadSession && activeNumpadSession.exerciseName === exerciseName && activeNumpadSession.refresh) {
    activeNumpadSession.refresh();
  }
}
