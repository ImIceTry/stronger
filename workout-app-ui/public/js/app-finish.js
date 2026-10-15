// ---------- finish / save workout (moved from app.js, 2026-09-17) ----------

// -- finish / save --

// Sets with real typed-but-never-confirmed values (see persistTyped above) --
// only counts entries that actually carry a value, not every open row (most
// rows the user never touched at all).
// Every still-open row (not confirmed, not swiped away) across every
// exercise card currently in the workout, for every position up to that
// exercise's own totalPositions -- same totalPositions math
// renderExerciseCard uses (max confirmed order / previous-session set
// count / extra sets added this session). Only counts a position if it has
// a real value to lose: either something typed (pendingInputByExercise) or
// a historical ghost prefill (last time's weight/reps/duration) -- a bare
// "Add Set" row nobody ever touched and with no history to prefill from
// isn't losing anything by being left alone.
//
// 2026-09-16, ImIceTry's ask: the old collectPendingSets only caught the
// narrower "typed a value, never hit the checkmark" case -- a fully
// untouched ghost row (last time's numbers just sitting there, never even
// tapped) silently vanished on Finish with no prompt at all, which is most
// of what "unfinished sets" actually means in practice.
function collectUnfinishedSets() {
  const result = [];
  activeWorkout.exercises.forEach((exerciseName) => {
    const confirmedSets = activeWorkout.sets.filter((s) => s.exercise_name === exerciseName);
    const confirmedOrders = new Set(confirmedSets.map((s) => s.set_order));
    const maxConfirmedOrder = confirmedSets.length ? Math.max(...confirmedSets.map((s) => s.set_order)) : 0;
    const previousData = previousPerformanceCache[exerciseName] || null;
    const prevSetCount = previousData && previousData.sets ? previousData.sets.length : 0;
    const extraSets = extraSetsByExercise[exerciseName] || 0;
    const totalPositions = Math.max(maxConfirmedOrder, prevSetCount, 1) + extraSets;
    const skipped = skippedPositionsByExercise[exerciseName] || new Set();

    for (let position = 0; position < totalPositions; position++) {
      if (confirmedOrders.has(position + 1) || skipped.has(position)) continue;
      const typed = (pendingInputByExercise[exerciseName] || {})[position];
      const hasTyped = typed && (typed.weight || typed.reps || typed.duration);
      const prevForIndex = previousForSetIndex(previousData, historicalIndexFor(exerciseName, position));
      const hasHistorical = prevForIndex && (prevForIndex.weight_kg != null || prevForIndex.reps != null || prevForIndex.duration_sec != null);
      if (!hasTyped && !hasHistorical) continue;
      result.push({ exerciseName, index: position });
    }
  });
  return result;
}

// Confirms one open row with whatever it's currently showing -- typed
// input if there is any, otherwise the same historical ghost prefill the
// row itself displays -- the same value tapping its own checkmark would
// submit either way. Reused so "Complete them" (Finish dialog) can do this
// for every still-open row collectUnfinishedSets found, typed or not.
function completeOpenSet(exerciseName, index) {
  const unitType = unitTypeCache[exerciseName] || "weight_reps";
  const typed = (pendingInputByExercise[exerciseName] || {})[index];
  const previousData = previousPerformanceCache[exerciseName] || null;
  const prevForIndex = previousForSetIndex(previousData, historicalIndexFor(exerciseName, index));
  if (pendingInputByExercise[exerciseName]) delete pendingInputByExercise[exerciseName][index];
  const weight = typed && typed.weight ? parseFloat(typed.weight)
    : (prevForIndex && prevForIndex.weight_kg != null ? prevForIndex.weight_kg : null);
  if (unitType === "time") {
    const duration = typed && typed.duration ? mmssBufferToSeconds(typed.duration)
      : (prevForIndex && prevForIndex.duration_sec != null ? prevForIndex.duration_sec : null);
    logSet(exerciseName, index, { weight_kg: weight, duration_sec: duration });
  } else {
    const reps = typed && typed.reps ? parseInt(typed.reps, 10)
      : (prevForIndex && prevForIndex.reps != null ? prevForIndex.reps : null);
    logSet(exerciseName, index, { weight_kg: weight, reps });
  }
}

// Finish-time dialog #1 (2026-09-14, ImIceTry's own ask; broadened 2026-09-16
// to cover every still-open row, not just typed-but-unconfirmed ones -- see
// collectUnfinishedSets): open rows used to just be silently dropped
// (finishOrSaveWorkout only ever serialized activeWorkout.sets, never
// pendingInputByExercise or a row's own ghost prefill) -- now ImIceTry gets
// an explicit choice instead of a silent loss.
//
// Closes via closeModal() directly, not the usual closeTopNavLayer()
// (2026-09-16 fix, real bug: ImIceTry got a "Save workout" dialog that was
// permanently stuck, needing an app restart). Root cause: closeTopNavLayer
// calls history.back(), and the actual nav-layer pop/closeModal() only runs
// later when the browser's popstate event fires -- asynchronously, on its
// own task, not a microtask. finishOrSaveWorkout awaits this dialog's
// Promise and, when there's a template, immediately opens dialog #2 (below)
// right after -- which resumes as a microtask, before that popstate task
// has had a chance to run. openModal's own "already open, just swap
// content" guard then sees the stale (not-yet-popped) first layer and skips
// pushing a new one for dialog #2, so by the time dialog #2's own click
// handler calls closeTopNavLayer(), navLayers is already empty (the delayed
// popstate from dialog #1 got there first) -- its `if (navLayers.length >
// 0)` guard silently no-ops, history.back() never fires, and the dialog can
// never close through the normal path again. Calling closeModal() directly
// pops the nav layer synchronously instead, the same already-established
// pattern hideActiveWorkoutOverlay/closeTemplatePreview use for exactly
// this "about to immediately open something else" situation.
function askUnfinishedSetsChoice(count) {
  return new Promise((resolve) => {
    openModal(`
      <h3>Unfinished sets</h3>
      <p class="modal-hint">${count} set${count === 1 ? "" : "s"} ${count === 1 ? "hasn't" : "haven't"} been confirmed yet.</p>
      <div class="exercise-row" data-choice="discard">Discard them</div>
      <div class="exercise-row" data-choice="complete">Complete them with what's shown</div>
    `);
    modalContent.classList.add("size-comfortable"); // UI Polish Pass 2026-09-18
    modalContent.querySelectorAll("[data-choice]").forEach((row) => {
      row.addEventListener("click", () => {
        closeModal();
        resolve(row.dataset.choice);
      });
    });
  });
}

// A template's *current* saved exercise list, fetched fresh rather than
// trusting whatever startWorkout captured when this session began (the
// template could in principle have been edited elsewhere in the meantime,
// and a virtual/never-materialized primary template has no exercise list of
// its own to have captured anyway). Deliberately doesn't call
// ensureTemplateId -- that has a real side effect (creates a DB row for a
// virtual template), wrong to trigger just to preview a diff the user might
// decline. Real (primary) templates always carry source_workout_id, virtual
// or not, so branching on that alone (not tpl.id) covers both states.
async function getTemplateExerciseList(tpl) {
  if (tpl.source_workout_id != null) {
    const detail = await apiGet(`/api/workouts/${tpl.source_workout_id}`);
    const seen = new Set();
    const list = [];
    detail.sets.forEach((s) => {
      if (!seen.has(s.exercise_name)) {
        seen.add(s.exercise_name);
        list.push(s.exercise_name);
      }
    });
    return list;
  }
  // Scratch template -- always already has a real id (create_scratch_template
  // requires the exercise list up front, unlike a primary template there's no
  // virtual/lazy-materialized state to worry about here).
  const data = await apiGet(`/api/templates/${tpl.id}/exercises`);
  return data.exercises;
}

// Removed/added exercises paired up positionally into "replaced" pairs where
// possible (first removed <-> first added, and so on) rather than always
// splitting them into two separate flat lists -- "swapped X for Y" reads as
// one deliberate decision, which is usually what actually happened (ImIceTry
// swapping one exercise for a similar one), vs. a pure removal or addition
// on their own. A judgment call, not a real sequence-alignment diff --
// doesn't try to detect pure reordering as a "change" at all, since that's
// not what this dialog is asking about.
function computeExerciseDiff(templateList, workoutList) {
  const removed = templateList.filter((name) => !workoutList.includes(name));
  const added = workoutList.filter((name) => !templateList.includes(name));
  const replaced = [];
  const pairCount = Math.min(removed.length, added.length);
  for (let i = 0; i < pairCount; i++) {
    replaced.push({ from: removed[i], to: added[i] });
  }
  return {
    removed: removed.slice(pairCount),
    added: added.slice(pairCount),
    replaced,
  };
}

// Finish-time dialog #2: only shown when this workout was actually started
// from a template (activeWorkout.templateRef) -- a from-scratch workout has
// nothing to offer changing. Closes via closeModal() directly -- see
// askUnfinishedSetsChoice's own comment for why (this is the dialog that
// was actually getting stuck, as the second of the two chained together).
//
// Shows the actual diff against the template now (2026-09-16, ImIceTry's ask)
// instead of a bare "update to match?" with nothing to go on -- rather than
// silently defaulting to "keep" when nothing changed, real nothing-to-decide
// case (running this workout added/removed nothing) skips the dialog
// entirely, matching the app's existing "don't ask when there's nothing to
// ask about" convention. Summarized as counts ("Replaced 2 exercises,
// removed 1") rather than naming each one (2026-09-16, ImIceTry's follow-up
// ask) -- this already runs right after the full workout summary
// (showFinishSummary), which just showed every exercise by name, so
// spelling them out again here was redundant.
function summarizeExerciseDiff(diff) {
  const parts = [];
  if (diff.replaced.length) parts.push(`replaced ${diff.replaced.length} exercise${diff.replaced.length === 1 ? "" : "s"}`);
  if (diff.removed.length) parts.push(`removed ${diff.removed.length} exercise${diff.removed.length === 1 ? "" : "s"}`);
  if (diff.added.length) parts.push(`added ${diff.added.length} exercise${diff.added.length === 1 ? "" : "s"}`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function askTemplateUpdateChoice(tpl, workoutExercises) {
  let templateList = [];
  try {
    templateList = await getTemplateExerciseList(tpl);
  } catch (err) {
    // Offline or the source workout/template vanished -- fall back to no
    // diff available rather than blocking Finish entirely over this.
    return "keep";
  }
  const diff = computeExerciseDiff(templateList, workoutExercises);
  if (diff.removed.length === 0 && diff.added.length === 0 && diff.replaced.length === 0) {
    return "keep";
  }

  // Uses the confirm-dialog-overlay tier (app-nav.js), not openModal, so this
  // question stacks above the still-open Finish summary instead of replacing
  // it (2026-09-19, ImIceTry's ask: "I want the summary to be kept open when it
  // asks me if I want to save the template") -- openModal/showFinishSummary
  // share one #modal-content element, so reusing it here would overwrite the
  // summary's own DOM regardless of whether that modal was ever explicitly
  // closed first. closeConfirmDialog(result) resolves with whatever value is
  // passed through, so "keep"/"update" work the same as its usual true/false.
  return new Promise((resolve) => {
    confirmDialogResolve = resolve;
    confirmDialogEl.innerHTML = `
      <p class="modal-hint">This workout differs from "${escapeHtml(tpl.name)}": ${summarizeExerciseDiff(diff)}.</p>
      <div class="modal-actions">
        <button id="confirm-dialog-confirm" class="btn-primary">Update "${escapeHtml(tpl.name)}" to match</button>
      </div>
      <div class="modal-actions">
        <button id="confirm-dialog-cancel" class="btn-secondary">Keep "${escapeHtml(tpl.name)}" as is</button>
      </div>
    `;
    confirmDialogOverlay.classList.remove("hidden");
    pushNavLayer(closeConfirmDialogViaNav);
    confirmDialogEl.querySelector("#confirm-dialog-confirm").addEventListener("click", () => closeConfirmDialog("update"));
    confirmDialogEl.querySelector("#confirm-dialog-cancel").addEventListener("click", () => closeConfirmDialog("keep"));
  });
}

// Finish-time dialog #1.5 (2026-09-16, ImIceTry's ask): a full review of what
// was actually logged, same visual shape (renderWorkoutSummaryBlocks) as
// tapping into a finished workout from History, shown between resolving
// unfinished sets and the template-diff decision -- previously Finish went
// straight from that (or nothing at all, for a from-scratch workout with no
// template) to actually committing the save with no chance to look over the
// whole session first. Modal, not a real navigable screen -- there's no
// workout id yet to navigate to (nothing's saved until after this) -- but
// full-screen sized (2026-09-18, ImIceTry's follow-up: it was "only a little
// window," wants it as a real full screen like the active-workout screen
// itself) via .size-full, reusing the exact same modal/nav-layer machinery
// every other size tier already relies on rather than a separate full-
// screen system. .modal-full-body/.modal-full-footer split the scrollable
// summary from a pinned bottom Continue button, matching how a real screen
// (e.g. the active-workout overlay) keeps its own action reachable without
// scrolling through everything above it first.
// "vs last time" block on the finish summary (2026-09-30, ImIceTry's pick from
// the review feature list): this session against the most recent earlier
// workout with the same name -- a template carries its name into the
// workout, and Home's template cards already treat "latest workout of this
// name" as the template's last session, so it's the same comparison.
// Volume uses effective weight over sets with both weight and reps (the
// History list's own volume_kg rule); Sets counts every logged set, same as
// the summary's "N x Exercise" lines; PRs follow records.workout_pr_count's
// rules (weight or est. 1RM beating all earlier history, per laterality
// lane) against the history already cached per exercise. Fills in after
// the summary is open and stays empty offline or with nothing to compare.
function sessionVolume(sets) {
  return sets.reduce((sum, s) => (s.weight_kg != null && s.reps != null ? sum + s.weight_kg * (s.weight_ratio ?? 1) * s.reps : sum), 0);
}

function countSessionPrs(sets) {
  const baselines = {}; // "exercise|unilateral" -> [bestWeight, best1rm]
  let count = 0;
  for (const s of sets) {
    if (s.weight_kg == null || s.reps == null || ["failure", "warmup", "assisted"].includes(s.set_type)) continue;
    const history = exerciseHistoryForPrCache[s.exercise_name];
    if (history === undefined) return null; // never loaded -- a count would be a guess
    const key = `${s.exercise_name}|${!!s.unilateral}`;
    if (!baselines[key]) {
      const prior = computePriorBestForLane(history, !!s.unilateral);
      baselines[key] = [prior.bestWeight, prior.best1rm];
    }
    const base = baselines[key];
    const weight = s.weight_kg * (s.weight_ratio ?? 1);
    const e1rm = Math.round(weight * (1 + s.reps / 30) * 10) / 10;
    if (weight > base[0] || e1rm > base[1]) {
      count += 1;
      base[0] = Math.max(base[0], weight);
      base[1] = Math.max(base[1], e1rm);
    }
  }
  return count;
}

async function fillFinishComparison(el, name, startedAt, sets, durationSec) {
  const wanted = (name || "").trim().toLowerCase();
  let last;
  let lastDetail;
  try {
    const data = await apiGet("/api/workouts?include_pr=1&limit=60");
    last = data.workouts.find((w) => (w.name || "").trim().toLowerCase() === wanted && w.started_at < startedAt);
    if (!last) return;
    lastDetail = await apiGet(`/api/workouts/${last.id}`);
  } catch (err) {
    return; // offline -- the summary just shows without the comparison
  }
  const volume = sessionVolume(sets);
  const lastVolume = sessionVolume(lastDetail.sets);
  const prs = countSessionPrs(sets);
  const signed = (n, unit) => `${n > 0 ? "+" : n < 0 ? "&minus;" : "&plusmn;"}${Math.abs(n)}${unit}`;
  const deltaClass = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
  const volumePct = lastVolume > 0 ? Math.round(((volume - lastVolume) / lastVolume) * 100) : null;
  const setDelta = sets.length - lastDetail.sets.length;
  const rows = [
    `<div class="finish-compare-row"><span>Volume</span><span>${Math.round(volume).toLocaleString("en-US")} kg${volumePct != null ? ` <em class="${deltaClass(volumePct)}">${signed(volumePct, "%")}</em>` : ""}</span></div>`,
    `<div class="finish-compare-row"><span>Sets</span><span>${sets.length} <em class="${deltaClass(setDelta)}">${signed(setDelta, "")}</em></span></div>`,
  ];
  if (prs != null) {
    rows.push(`<div class="finish-compare-row"><span>PRs</span><span>${prs} <em>last time ${last.pr_count ?? 0}</em></span></div>`);
  }
  if (last.duration_sec) {
    const minDelta = Math.round((durationSec - last.duration_sec) / 60);
    rows.push(`<div class="finish-compare-row"><span>Duration</span><span>${formatWorkoutDurationLabel(durationSec)} <em>${signed(minDelta, " min")}</em></span></div>`);
  }
  el.innerHTML = `
    <div class="finish-compare-title">vs last ${escapeHtml(last.name)} &middot; ${escapeHtml(relativeDate(last.started_at))}</div>
    ${rows.join("")}
  `;
}

function showFinishSummary(durationSec) {
  const unitTypeByExercise = {};
  activeWorkout.exercises.forEach((name) => {
    unitTypeByExercise[name] = unitTypeCache[name] || "weight_reps";
  });
  // Effective weight (raw * weight_ratio), same as the History list's own
  // volume_kg -- so the number here matches what History shows afterwards.
  const totalVolume = activeWorkout.sets.reduce((sum, s) => sum + (s.weight_kg || 0) * (s.weight_ratio ?? 1) * (s.reps || 0), 0);
  const exerciseBlocks = renderWorkoutSummaryBlocks(activeWorkout.sets, unitTypeByExercise);
  return new Promise((resolve) => {
    openModal(`
      <div class="modal-full-body">
        <h3>${escapeHtml(activeWorkout.name)}</h3>
        <div class="meta wd-date">${escapeHtml(formatLongDateTime(activeWorkout.started_at))}</div>
        ${exerciseBlocks}
        <div class="detail-footer">
          <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>${formatWorkoutDurationLabel(durationSec)}</span>
          <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20l6-10 4 6 3-5 5 9z"/></svg>${Math.round(totalVolume || 0)} kg</span>
        </div>
        <div class="finish-compare"></div>
      </div>
      <div class="modal-full-footer">
        <button id="finish-summary-continue" class="btn-primary">Looks good, continue</button>
      </div>
    `);
    modalContent.classList.add("size-full");
    fillFinishComparison(modalContent.querySelector(".finish-compare"), activeWorkout.name, activeWorkout.started_at,
      activeWorkout.sets.slice(), durationSec);
    modalContent.querySelector("#finish-summary-continue").addEventListener("click", () => {
      // Deliberately doesn't closeModal() here anymore (2026-09-19, ImIceTry's
      // ask: "I want the summary to be kept open when it asks me if I want
      // to save the template") -- askTemplateUpdateChoice (right after this
      // resolves, see finishOrSaveWorkout) now uses the separate
      // confirm-dialog-overlay tier specifically so it can stack above this
      // still-open summary instead of replacing it. The summary's own
      // closeModal() happens later, once the whole Finish flow is actually
      // done and about to navigate away (see finishOrSaveWorkout).
      resolve();
    });
  });
}

async function finishOrSaveWorkout() {
  if (!activeWorkout) return;

  if (editingWorkoutId == null) {
    const unfinished = collectUnfinishedSets();
    if (unfinished.length > 0) {
      // "ask" (default) shows the dialog same as before; "discard"/
      // "complete" apply that choice straight away, per the Settings
      // screen's "Handle incomplete sets" option (2026-09-16).
      const policy = unfinishedSetsPolicy();
      const choice = policy === "ask" ? await askUnfinishedSetsChoice(unfinished.length) : policy;
      if (choice === "complete") {
        unfinished.forEach((u) => completeOpenSet(u.exerciseName, u.index));
      } else {
        unfinished.forEach((u) => {
          if (pendingInputByExercise[u.exerciseName]) delete pendingInputByExercise[u.exerciseName][u.index];
        });
        persistActiveWorkout();
      }
    }
  }

  if (!activeWorkout || activeWorkout.sets.length === 0) {
    alert("Log at least one set before finishing.");
    return;
  }

  // Computed once, right here -- shown in the review summary below and
  // reused as-is for the real payload further down, rather than recomputed
  // a second time after the summary/template dialogs have also had their
  // own time sitting open (2026-09-16: previously computed only once, but
  // AFTER the template-diff dialog resolved, so a slow decision there
  // silently inflated the saved duration by however long that dialog sat
  // open -- moving it here makes it reflect when the workout actually
  // ended, not when Finish's own dialogs happened to close).
  const finishedAt = new Date();
  const startedDate = new Date(activeWorkout.started_at.replace(" ", "T"));
  const durationSec = Math.max(0, Math.round((finishedAt - startedDate) / 1000));

  // Finish-time dialog #1.5 (2026-09-16, ImIceTry's ask): a full review of
  // what was actually logged, before the template-diff decision -- an
  // edit-in-place save (editingWorkoutId != null) has no such review since
  // that path already shows the same data it started from.
  const summaryShown = editingWorkoutId == null && featureEnabled("finishSummary");
  if (summaryShown) {
    await showFinishSummary(durationSec);
  }

  let updateTemplateChoice = false;
  const templateRef = activeWorkout.templateRef;
  if (editingWorkoutId == null && templateRef) {
    // Real exercises actually performed (activeWorkout.sets, at least one
    // confirmed set), not activeWorkout.exercises -- that's just which cards
    // are showing on screen, seeded from the template at start and never
    // pruned just because a card sat untouched (2026-09-16 fix: ImIceTry did
    // 1 of a 7-exercise template's exercises and finished, expecting the
    // dialog to show 6 exercises "removed" -- it stayed silent instead,
    // since all 7 cards were technically still present with zero real diff
    // between "cards on screen" and "cards the template started with").
    const performedExercises = [];
    const seen = new Set();
    activeWorkout.sets.forEach((s) => {
      if (!seen.has(s.exercise_name)) {
        seen.add(s.exercise_name);
        performedExercises.push(s.exercise_name);
      }
    });
    // Settings screen's "Show template-update prompt" toggle (2026-09-16)
    // -- off means never ask, template just stays as-is no matter what
    // changed, same as always answering "keep" without being asked.
    if (templateDiffPromptEnabled()) {
      updateTemplateChoice = (await askTemplateUpdateChoice(templateRef.tpl, performedExercises)) === "update";
    }
  }

  clearInterval(elapsedTimerHandle);
  stopWorkoutForegroundNotification();

  if (editingWorkoutId != null) {
    const payload = {
      name: activeWorkout.name,
      started_at: activeWorkout.started_at,
      workout_notes: activeWorkout.workoutNotes || "",
      sets: applyExerciseNotesToSets(activeWorkout.sets, activeWorkout.exerciseNotes),
    };
    const workoutId = editingWorkoutId;
    // Don't clear activeWorkout/editingWorkoutId (or navigate away) until the
    // save actually succeeds -- doing it unconditionally beforehand meant a
    // failed PUT (bad signal, or any real server-side rejection) discarded
    // the in-progress edit anyway, contradicting the "nothing was lost" alert
    // below (2026-09-17, caught testing a superset edit that 400'd).
    try {
      await updateWorkout(workoutId, payload);
      allExercisesCache = null; // times_performed/last_performed may have shifted
      activeWorkout = null;
      editingWorkoutId = null;
      persistActiveWorkout();
      hideActiveWorkoutOverlay();
      showScreen("history");
    } catch (err) {
      alert("Couldn't save changes (offline?). Nothing was lost -- try again once you have signal.");
    }
    return;
  }

  const payload = {
    name: activeWorkout.name,
    started_at: activeWorkout.started_at,
    finished_at: fmtDateTime(finishedAt),
    duration_sec: durationSec,
    workout_notes: activeWorkout.workoutNotes || "",
    sets: applyExerciseNotesToSets(activeWorkout.sets, activeWorkout.exerciseNotes),
  };

  // The finish summary (if it was shown) has been sitting open this whole
  // time -- see its own comment on why its Continue button no longer closes
  // it directly. This is the actual close, now that there's nothing left to
  // show on top of it.
  if (summaryShown) closeModal();

  activeWorkout = null;
  persistActiveWorkout();
  clearInterval(restTimerHandle);
  restTimerContext = null;
  parallelRestTimers = [];
  hideActiveWorkoutOverlay();
  showScreen("home");

  // Queued first, uploaded second (2026-09-30): activeWorkout is already
  // cleared above, so if the app got killed while the upload was still in
  // flight on bad signal, the workout used to exist nowhere at all. Now it
  // sits in the offline queue until the upload succeeds; if the response is
  // lost after the server saved it, the queued replay is deduped server-side.
  let queueId = null;
  try {
    queueId = await Queue.enqueue(payload);
  } catch (err) {
    // IndexedDB unavailable -- still try the direct upload below
  }
  try {
    const result = await syncWorkout(payload);
    if (queueId != null) await Queue.remove(queueId).catch(() => {});
    allExercisesCache = null; // times_performed/last_performed may have shifted
    if (templateRef) {
      try {
        const templateId = await ensureTemplateId(templateRef.tpl);
        if (updateTemplateChoice) {
          await apiPut(`/api/templates/${templateId}/sync-from-workout`, { workout_id: result.id });
        } else {
          // "Keep as is" still counts as using the template today (2026-09-22,
          // ImIceTry's ask, reversing part of 2026-09-16's "templates stay
          // fixed" decision for the date specifically) -- bumps the Home
          // card's displayed date without touching source_workout_id, so the
          // exercise-list preview stays exactly as fixed as 2026-09-16 wanted.
          await apiPut(`/api/templates/${templateId}/touch-logged`, { workout_id: result.id });
        }
      } catch (err) {
        // The workout itself already saved fine -- a failed template sync
        // (offline, template deleted meanwhile) isn't worth losing that
        // over, just isn't worth a second alert on top of the one below.
      }
    }
  } catch (err) {
    if (queueId == null) await Queue.enqueue(payload);
    if (updateTemplateChoice) {
      alert("Saved offline -- the template wasn't updated since that needs the new workout's id, which only exists once it syncs. Try updating it manually once you're back online.");
    }
  }
  updatePendingBadge();
}

document.getElementById("btn-finish-top").addEventListener("click", () => {
  if (buildingTemplateMode) {
    saveAsTemplate();
  } else {
    finishOrSaveWorkout();
  }
});
