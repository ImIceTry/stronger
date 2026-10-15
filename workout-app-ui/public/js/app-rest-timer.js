// ---------- rest timer, rest/workout notifications (moved from app.js, 2026-09-17) ----------

// Notifications (2026-09-10 investigation, built then pulled back out same
// day, ImIceTry's own call -- "remove that for now, that is gonna need some
// more work"). The Service Worker (sw.js) and the actual wiring stay out
// entirely rather than sitting disabled/dead, so there's exactly one thing
// to pick back up cleanly if this returns later, not a half-connected relic.

// -- rest timer --
// Lives inline as the divider between the set just confirmed and whatever
// comes next (renderExerciseCard renders it as .rest-divider, live-tagged
// via restTimerContext), not a separate banner floating elsewhere on
// screen -- ticking is a direct DOM patch on that one element each second,
// same "poke specific labels, don't re-render everything" pattern
// startElapsedTimer already uses, so it doesn't disturb whatever else the
// user might be doing on another exercise's card mid-rest.
// Rest-timer system notification (2026-09-12, ImIceTry's own ask, "so I can
// still see it ticking when I leave the app") -- real limitation, not a
// bug: the Web Notification API has no chronometer/live-countdown widget
// (that's an Android-native Notification.Builder feature, never exposed to
// web push/local notifications), and once the OS actually suspends a
// backgrounded tab/PWA, no JS timer keeps running to update anything
// regardless of API -- true second-by-second ticking while fully
// backgrounded would need a server push (VAPID + a push service) or a
// native wrapper, neither of which exist here. This is the closest honest
// approximation: one notification, same tag so each update replaces the
// last rather than stacking, refreshed every 5s while the page is still
// alive to run JS at all (covers "switched to another app briefly",
// "screen still on but different tab", etc.) -- not a literal 1Hz tick.
let restNotification = null;

// Extra context appended to the rest notification body: which superset this
// is, and how many other countdowns are still running.
function restNotificationExtra(exerciseName) {
  const group = activeSupersetGroups()[exerciseName] || null;
  return (group ? ` · Superset ${group}` : "") + (parallelRestTimers.length ? ` · +${parallelRestTimers.length} running` : "");
}

function updateRestNotification(exerciseName, remaining) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const label = formatClock(remaining);
  try {
    if (restNotification) restNotification.close();
    restNotification = new Notification(`Resting — ${exerciseName}`, {
      body: `${label} remaining${restNotificationExtra(exerciseName)}`,
      tag: "rest-timer",
      silent: true,
      renotify: false,
    });
  } catch (err) {
    // Notification constructor throws on some mobile browsers when the
    // page isn't the active/focused one -- harmless, just means this
    // particular refresh doesn't show, not worth surfacing to the user.
  }
}
function closeRestNotification(finalBody) {
  if (restNotification) {
    restNotification.close();
    restNotification = null;
  }
  if (finalBody && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("Rest complete", { body: finalBody, tag: "rest-timer" });
    } catch (err) { /* see updateRestNotification's own comment */ }
  }
}

// Real background live-workout notification (2026-09-14, Open Problem 27
// goal 1) -- unlike updateRestNotification above, this runs a genuine
// Android foreground service (@capawesome-team/capacitor-android-foreground-service),
// which keeps the app process alive and off Doze's worst throttling while
// backgrounded, so periodic updates actually land on a real device instead
// of being best-effort. Native-Android only; no-ops on web/PWA, which keeps
// using the Web Notification approximation above.
const ForegroundServicePlugin = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
  ? window.Capacitor.Plugins.ForegroundService
  : null;
if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && !ForegroundServicePlugin) {
  console.warn("ForegroundService plugin not registered -- background workout notification unavailable this session.");
}
const WORKOUT_NOTIFICATION_CHANNEL_ID = "workout_active";
const WORKOUT_NOTIFICATION_ID = 1;
const WORKOUT_NOTIFICATION_COMPLETE_SET_BUTTON_ID = 1;
const WORKOUT_NOTIFICATION_REST_MINUS30_BUTTON_ID = 2;
const WORKOUT_NOTIFICATION_REST_PLUS30_BUTTON_ID = 3;
const WORKOUT_NOTIFICATION_REST_SKIP_BUTTON_ID = 4;
let workoutForegroundServiceActive = false;
let workoutNotificationChannelReady = false;
let workoutNotificationButtonListenerAttached = false;
// Dedup key for the last content refreshWorkoutNotificationContent actually
// posted (2026-09-24, Island flakiness fix -- see 01 Daily Logs/[C] Open
// Items.md -> workout-app-hyperisland-rate-limiting-flaky). Multiple call
// sites legitimately call refreshWorkoutNotificationContent on the same
// state-change (e.g. logSet's own renderActiveScreen re-render followed
// immediately by startRestTimer's authoritative call) -- harmless for the
// plain ForegroundService fallback, but a real logcat capture showed two
// RestMediaNotification.show()/stop() native calls landing within a few ms
// of each other every time, and HyperOS's own DynamicIslandBaseContentView
// throws a NullPointerException (caught, non-fatal, but corrupts that
// Island's transition state) when it has to process two posts that close
// together -- true even when both posts carry identical content, so this
// has to dedup by content, not just fix call order.
let lastWorkoutNotificationKey = null;

async function startWorkoutForegroundNotification(name) {
  if (!ForegroundServicePlugin || workoutForegroundServiceActive || !featureEnabled("workoutNotification")) return;
  try {
    await ForegroundServicePlugin.requestPermissions();
    if (!workoutNotificationChannelReady) {
      await ForegroundServicePlugin.createNotificationChannel({
        id: WORKOUT_NOTIFICATION_CHANNEL_ID,
        name: "Active workout",
        description: "Shows the in-progress workout while the app is in the background.",
        importance: 2, // Importance.Low -- ongoing status, not worth a sound/heads-up
      });
      workoutNotificationChannelReady = true;
    }
    ensureWorkoutNotificationButtonListener();
    await ForegroundServicePlugin.startForegroundService({
      id: WORKOUT_NOTIFICATION_ID,
      title: name || "Workout",
      body: "Starting...",
      smallIcon: "ic_stat_workout",
      notificationChannelId: WORKOUT_NOTIFICATION_CHANNEL_ID,
      silent: true,
    });
    workoutForegroundServiceActive = true;
    lastWorkoutNotificationKey = null; // fresh service instance -- nothing posted to it yet
  } catch (err) {
    // Notification permission denied, or some other native hiccup -- the
    // workout itself is unaffected either way, not worth alerting the user,
    // but do log it (visible via `adb logcat` under chromium/console) since
    // this whole path failing silently is exactly what made the first
    // version of this feature look like a no-op with zero trace of why.
    console.warn("startWorkoutForegroundNotification failed:", err);
  }
}

// Notification content (2026-09-14, ImIceTry's own follow-up ask): rather than
// mirroring the workout's own elapsed time -- something already visible
// on-screen and not very actionable from the notification shade -- it
// mirrors whatever's actually useful to glance at mid-set: the live rest
// countdown while resting, or the next set (with last time's suggested
// weight/reps, same prefill the ghost row on screen already shows) plus a
// one-tap "Complete set" action once rest is over. restTimerHandle (not
// just restTimerContext, which can briefly hold a stale/incomplete value --
// see logSet) is the actual source of truth for "currently resting".
function refreshWorkoutNotificationContent() {
  if (!workoutForegroundServiceActive) return;
  const resting = restTimerHandle != null && restTimerContext;
  // Same key the native call would actually be posting with -- if it matches
  // the last thing we posted, skip the native round-trip entirely rather
  // than repost identical content (see lastWorkoutNotificationKey's comment).
  const key = resting
    ? `rest:${restTimerContext.exerciseName}:${restTimerContext.position}:${formatClock(restTimerContext.remaining)}:${parallelRestTimers.length}`
    : (() => {
        const next = findNextPendingSet();
        return next ? `next:${next.exerciseName}:${next.position}:${next.weight}:${next.reps}:${next.durationSec}` : "next:done";
      })();
  if (key === lastWorkoutNotificationKey) return;
  lastWorkoutNotificationKey = key;
  if (resting) {
    updateRestForegroundNotification(restTimerContext.exerciseName, restTimerContext.remaining);
  } else {
    updateIdleForegroundNotification();
  }
}

// MediaSession-backed pill (2026-09-18, ImIceTry's ask after seeing Spotify's
// notification rendered as a status-bar pill on his phone -- that's HyperOS's
// "Island" feature, which only picks up real MediaSession-backed
// notifications, never a plain one no matter its content). See
// RestMediaNotificationPlugin.java for why this replaces notification id 1
// in place rather than posting a second one. Native-Android only, same
// isNativePlatform gate as ForegroundServicePlugin above; no-ops (silently,
// via the same try/catch-and-log pattern) if the plugin isn't registered,
// e.g. an APK built before this landed.
const RestMediaNotificationPlugin = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
  ? window.Capacitor.Plugins.RestMediaNotification
  : null;
// -30s/+30s/Skip (2026-09-19) -- restores the same buttons the plain
// ForegroundService notification had before this switched to the
// HyperOS/MediaSession-based one, which started out with none at all
// (ImIceTry noticed). Same target functions the old notification's own
// buttons called.
if (RestMediaNotificationPlugin) {
  RestMediaNotificationPlugin.addListener("buttonClicked", (event) => {
    if (!event) return;
    if (event.button === "minus30") adjustLiveRestTimer(-30);
    else if (event.button === "plus30") adjustLiveRestTimer(30);
    else if (event.button === "skip") skipLiveRestFromNotification();
  });
}

async function updateRestForegroundNotification(exerciseName, remainingSec) {
  if (!ForegroundServicePlugin || !workoutForegroundServiceActive) return;
  const title = `Resting — ${exerciseName}`;
  const body = `${formatClock(remainingSec)} remaining${restNotificationExtra(exerciseName)}`;
  if (RestMediaNotificationPlugin) {
    try {
      // Real bug fixed here (2026-09-19, ImIceTry: "even when it's compact...
      // it's at 0:00"): remainingSec was never actually passed, so the
      // native side's default of 0 made every countdown target "right now."
      await RestMediaNotificationPlugin.show({ title, body, remainingSec });
      return;
    } catch (err) {
      console.warn("RestMediaNotification.show failed, falling back to plain notification:", err);
    }
  }
  try {
    await ForegroundServicePlugin.updateForegroundService({
      id: WORKOUT_NOTIFICATION_ID,
      title,
      body,
      smallIcon: "ic_stat_workout",
      notificationChannelId: WORKOUT_NOTIFICATION_CHANNEL_ID,
      silent: true,
      // -30s/+30s/Skip (2026-09-14, ImIceTry's own ask) act on the live
      // countdown directly via adjustLiveRestTimer/skipLiveRestFromNotification
      // -- no Complete-set action here, that only makes sense once rest is over.
      buttons: [
        { id: WORKOUT_NOTIFICATION_REST_MINUS30_BUTTON_ID, title: "-30s" },
        { id: WORKOUT_NOTIFICATION_REST_PLUS30_BUTTON_ID, title: "+30s" },
        { id: WORKOUT_NOTIFICATION_REST_SKIP_BUTTON_ID, title: "Skip" },
      ],
    });
  } catch (err) {
    console.warn("updateRestForegroundNotification failed:", err);
  }
}

async function updateIdleForegroundNotification() {
  if (!ForegroundServicePlugin || !workoutForegroundServiceActive) return;
  if (RestMediaNotificationPlugin) {
    try { await RestMediaNotificationPlugin.stop(); } catch (err) { /* nothing was active, fine */ }
  }
  const next = findNextPendingSet();
  const title = next ? next.exerciseName : (activeWorkout.name || "Workout");
  // formatSetValue's "&times;" is an HTML entity meant for innerHTML
  // rendering in-app -- the notification body is plain text, so it showed
  // up literally as "&times;" instead of "×" (2026-09-14 fix, spotted live).
  const body = next
    ? `Set ${logicalSetNumber(next.exerciseName, next.position)}: ${formatSetValue(next.unitType, { weight_kg: next.weight, reps: next.reps, duration_sec: next.durationSec }).replace(/&times;/g, "×")}`
    : "All sets done";
  try {
    await ForegroundServicePlugin.updateForegroundService({
      id: WORKOUT_NOTIFICATION_ID,
      title,
      body,
      smallIcon: "ic_stat_workout",
      notificationChannelId: WORKOUT_NOTIFICATION_CHANNEL_ID,
      silent: true,
      buttons: next ? [{ id: WORKOUT_NOTIFICATION_COMPLETE_SET_BUTTON_ID, title: "Complete set" }] : [],
    });
  } catch (err) {
    console.warn("updateIdleForegroundNotification failed:", err);
  }
}

// Registered once per app process, not per workout -- addListener stacks
// handlers if called again, and startWorkoutForegroundNotification runs on
// every workout start.
function ensureWorkoutNotificationButtonListener() {
  if (workoutNotificationButtonListenerAttached || !ForegroundServicePlugin) return;
  workoutNotificationButtonListenerAttached = true;
  ForegroundServicePlugin.addListener("buttonClicked", (event) => {
    if (!event) return;
    if (event.buttonId === WORKOUT_NOTIFICATION_COMPLETE_SET_BUTTON_ID) completeSetFromNotification();
    else if (event.buttonId === WORKOUT_NOTIFICATION_REST_MINUS30_BUTTON_ID) adjustLiveRestTimer(-30);
    else if (event.buttonId === WORKOUT_NOTIFICATION_REST_PLUS30_BUTTON_ID) adjustLiveRestTimer(30);
    else if (event.buttonId === WORKOUT_NOTIFICATION_REST_SKIP_BUTTON_ID) skipLiveRestFromNotification();
  });
}

// Finds the same "next set" the idle notification just displayed and logs it
// with its suggested weight/reps/duration -- functionally identical to
// tapping that row's own checkmark in-app (see the confirm-btn handler in
// renderExerciseCard), just reachable from the notification shade without
// opening the phone.
function completeSetFromNotification() {
  const next = findNextPendingSet();
  if (!next || !activeWorkout) return;
  const mode = fieldModeOverrideByExercise[next.exerciseName] || (next.unitType === "time" ? "time" : "reps");
  if (mode === "time") {
    logSet(next.exerciseName, next.position, { weight_kg: next.weight, duration_sec: next.durationSec });
  } else {
    logSet(next.exerciseName, next.position, { weight_kg: next.weight, reps: next.reps });
  }
}

// Same {weight, reps, duration} a pending row's ghost prefill computes at
// render time (see renderExerciseCard) -- pulled out standalone so the
// notification can compute it for whatever set is next without needing a
// live DOM row for that exercise's card.
function computeNextSetPrefill(exerciseName, position) {
  const previousData = previousFor(exerciseName);
  const prevForIndex = previousForSetIndex(previousData, historicalIndexFor(exerciseName, position));
  const typedInput = (pendingInputByExercise[exerciseName] || {})[position];
  const suggest = featureEnabled("prefill") ? prevForIndex : null;
  const weight = typedInput
    ? (typedInput.weight === "" ? null : typedInput.weight)
    : (suggest && suggest.weight_kg != null ? suggest.weight_kg : null);
  const reps = typedInput
    ? (typedInput.reps === "" ? null : typedInput.reps)
    : (suggest && suggest.reps != null ? suggest.reps : null);
  const durationSec = typedInput && typedInput.duration
    ? mmssBufferToSeconds(typedInput.duration)
    : (suggest && suggest.duration_sec != null ? suggest.duration_sec : null);
  return { weight, reps, durationSec };
}

// The first set, in on-screen exercise/position order, that's neither
// confirmed nor swiped away -- same totalPositions/confirmedByOrder logic
// renderExerciseCard uses per-card, just walked across every exercise until
// the first gap turns up. Returns null once nothing is left to do.
function findNextPendingSet() {
  if (!activeWorkout) return null;
  for (const exerciseName of orderedExerciseList()) {
    const confirmedSets = activeWorkout.sets.filter((s) => s.exercise_name === exerciseName);
    const confirmedByOrder = new Map(confirmedSets.map((s) => [s.set_order, s]));
    const maxConfirmedOrder = confirmedSets.length ? Math.max(...confirmedSets.map((s) => s.set_order)) : 0;
    const previousData = previousFor(exerciseName);
    const prevSetCount = previousData && previousData.sets ? previousData.sets.length : 0;
    const extraSets = extraSetsByExercise[exerciseName] || 0;
    const totalPositions = Math.max(maxConfirmedOrder, prevSetCount, 1) + extraSets;
    const skipped = skippedPositionsByExercise[exerciseName] || new Set();
    for (let position = 0; position < totalPositions; position++) {
      if (confirmedByOrder.has(position + 1)) continue;
      if (skipped.has(position)) continue;
      const unitType = unitTypeCache[exerciseName] || "weight_reps";
      const { weight, reps, durationSec } = computeNextSetPrefill(exerciseName, position);
      return { exerciseName, position, unitType, weight, reps, durationSec };
    }
  }
  return null;
}

async function stopWorkoutForegroundNotification() {
  if (!ForegroundServicePlugin || !workoutForegroundServiceActive) return;
  workoutForegroundServiceActive = false;
  lastWorkoutNotificationKey = null;
  if (RestMediaNotificationPlugin) {
    try { await RestMediaNotificationPlugin.stop(); } catch (err) { /* nothing was active, fine */ }
  }
  try {
    await ForegroundServicePlugin.stopForegroundService();
  } catch (err) {
    console.warn("stopWorkoutForegroundNotification failed:", err);
  }
}

// Patches the on-screen rest divider's own tick/progress -- pulled out
// standalone (2026-09-14) so both the running interval below and a
// notification-driven adjustment (adjustLiveRestTimer, no interval tick of
// its own) can repaint it the same way, reading straight off
// restTimerContext rather than a closure-local snapshot.
function updateRestTimerDom(exerciseName, position, ctx = restTimerContext) {
  const tick = document.querySelector(`[data-rest-divider="${exerciseName}::${position}"] .rest-divider-tick`);
  if (tick) tick.textContent = formatClock(ctx.remaining);
  // Bar depletes leftward as time passes (2026-09-11, ImIceTry's own call) --
  // width itself carries the countdown, not just the digits. transition on
  // .rest-divider-progress (CSS) smooths each 1px-per-second jump instead
  // of snapping.
  const progress = document.querySelector(`[data-rest-divider="${exerciseName}::${position}"] .rest-divider-progress`);
  if (progress) {
    const pct = ctx.total > 0 ? Math.max(0, Math.min(100, (ctx.remaining / ctx.total) * 100)) : 0;
    progress.style.width = `${pct}%`;
  }
}

// The actual per-second countdown loop -- separated from startRestTimer
// (2026-09-14) so openRestEditNumpad can pause it (clearInterval) while its
// edit numpad is open on a *live* countdown and resume it afterward without
// resetting remaining/total, instead of the previous behavior where the
// interval kept ticking underneath the open numpad and silently overwrote
// whatever +/-30 or typed digits you'd just entered.
//
// Real bug (2026-09-23, bug list item 5: "rest timer sometimes stops when
// app is in background"): remaining used to be a pure per-tick decrement
// (`remaining -= 1` every 1000ms). Android/Chromium throttles or fully
// suspends a backgrounded WebView's JS timers regardless of the foreground
// service's wake lock -- that keeps the CPU awake, not the WebView's JS
// execution, which is throttled based on page visibility, not power state.
// So a backgrounded rest period would silently stop counting down (or lose
// ticks) even though the notification itself kept existing. Fixed by making
// restTimerContext.endAt (a wall-clock deadline) the single source of
// truth and deriving `remaining` from it every time this fires, instead of
// accumulating a per-tick decrement -- so however many ticks the WebView
// actually got to run, the displayed value always reflects real elapsed
// time, not "how many 1000ms intervals fired."
function allRestContexts() {
  return restTimerContext ? [restTimerContext, ...parallelRestTimers] : [];
}

function supersetGroupOf(exerciseName) {
  return activeSupersetGroups()[exerciseName] || null;
}

// Counts down the non-primary timers; a finished one rings on its own.
function tickParallelRestTimers() {
  if (!parallelRestTimers.length) return;
  const now = Date.now();
  let expired = false;
  parallelRestTimers = parallelRestTimers.filter((c) => {
    c.remaining = Math.max(0, Math.ceil((c.endAt - now) / 1000));
    if (c.remaining <= 0) { expired = true; return false; }
    updateRestTimerDom(c.exerciseName, c.position, c);
    return true;
  });
  if (expired) {
    if (hapticsEnabled() && navigator.vibrate) navigator.vibrate([80, 60, 80]);
    playBellSound();
    renderActiveScreen({ preserveAddBox: true });
  }
}

// Makes a running parallel timer the primary one (tapping its divider), so
// the edit numpad, -30/+30 and Skip act on it.
function promoteRestTimer(exerciseName) {
  const i = parallelRestTimers.findIndex((c) => c.exerciseName === exerciseName);
  if (i < 0 || !restTimerContext) return;
  const [chosen] = parallelRestTimers.splice(i, 1);
  parallelRestTimers.push(restTimerContext);
  restTimerContext = chosen;
  beginRestTimerTick(chosen.exerciseName, chosen.position);
  refreshWorkoutNotificationContent();
}

function tickRestTimer(exerciseName, position, lastNotifiedRef) {
  tickParallelRestTimers();
  if (!restTimerContext) return;
  exerciseName = restTimerContext.exerciseName;
  position = restTimerContext.position;
  restTimerContext.remaining = Math.max(0, Math.ceil((restTimerContext.endAt - Date.now()) / 1000));
  // A short heads-up buzz on every one of the last 3 seconds (2026-09-16,
  // ImIceTry's ask -- "at 3 and less it vibrates each time"), not just once
  // at the 3s mark -- distinct from the longer completion pattern in
  // stopRestTimer, so the two are tellable apart by feel alone. Fires
  // again on every pass through this range, including a re-entry caused
  // by a live +30/-30 adjustment, which reads as correct -- "within the
  // last 3 seconds" is true again either way.
  if (restTimerContext.remaining <= 3 && restTimerContext.remaining >= 1 && hapticsEnabled() && navigator.vibrate) {
    navigator.vibrate(20);
  }
  if (restTimerContext.remaining <= 0) {
    stopRestTimer();
    return;
  }
  updateRestTimerDom(exerciseName, position);
  // The native notification is deliberately NOT refreshed periodically
  // here at all anymore (2026-09-19, second attempt -- a 5s throttle
  // still made the Island pop back into its big expanded state every 5s,
  // exactly matching that interval: ANY repost counts as a fresh "just
  // appeared" to HyperOS, no matter how infrequent). HyperOS renders the
  // live countdown natively off the timestamp we give it (same mechanism
  // as Android's own Chronometer) -- startRestTimer's one call at the
  // start is genuinely enough; the only time this needs a real update is
  // when the target itself actually changes, which adjustLiveRestTimer
  // already calls refreshWorkoutNotificationContent for directly. The
  // web/PWA Notification fallback (a completely different code path, no
  // Island/native ticking involved) still needs its own periodic refresh
  // to approximate ticking at all, so that keeps its 5s cadence.
  if (Date.now() - lastNotifiedRef.value >= 5000) {
    lastNotifiedRef.value = Date.now();
    updateRestNotification(exerciseName, restTimerContext.remaining);
  }
}

function beginRestTimerTick(exerciseName, position) {
  clearInterval(restTimerHandle);
  const lastNotifiedRef = { value: Date.now() };
  updateRestTimerDom(exerciseName, position);
  restTimerHandle = setInterval(() => tickRestTimer(exerciseName, position, lastNotifiedRef), 1000);
  // Backstop for the throttled/suspended-interval case itself: when the
  // WebView regains visibility (app foregrounded again), force one
  // immediate recompute rather than waiting up to 1s for the next natural
  // tick -- endAt-based math means this is always correct regardless of
  // how many ticks were actually missed while backgrounded. Remove before
  // re-adding since a restart (e.g. the rest-edit numpad's NEXT re-calling
  // startRestTimer for a new duration) calls this again without going
  // through stopRestTimer first -- without the remove, a workout with
  // several rest periods would pile up one listener per restart.
  document.removeEventListener("visibilitychange", handleRestTimerVisibilityChange);
  document.addEventListener("visibilitychange", handleRestTimerVisibilityChange);
}

function handleRestTimerVisibilityChange() {
  if (document.visibilityState !== "visible") return;
  if (!restTimerContext || restTimerHandle == null) return;
  tickRestTimer(restTimerContext.exerciseName, restTimerContext.position, { value: 0 });
}

function startRestTimer(exerciseName, position, seconds) {
  if (!featureEnabled("restTimer")) return;
  // remaining lives on restTimerContext itself (not a closure-local var) so
  // openRestEditNumpad can read the actual current countdown, not just
  // whatever it was originally started with. total is the countdown's own
  // starting point (fixed for its lifetime, even across a manual restart
  // via the edit numpad) so the progress bar has a stable 100% to shrink
  // down from. endAt is the real wall-clock deadline every tick derives
  // remaining from (see tickRestTimer's comment) -- seconds is only the
  // initial input, not something later code should keep decrementing.
  const previous = restTimerContext;
  parallelRestTimers = parallelRestTimers.filter((c) => c.exerciseName !== exerciseName);
  const group = supersetGroupOf(exerciseName);
  if (previous && restTimerHandle != null && group && previous.exerciseName !== exerciseName
      && supersetGroupOf(previous.exerciseName) === group && previous.remaining > 0) {
    parallelRestTimers.push(previous);
  }
  restTimerContext = { exerciseName, position, remaining: seconds, total: seconds, endAt: Date.now() + seconds * 1000 };
  // The countdown that ends first drives the notification and the numpad.
  const soonest = parallelRestTimers.reduce((a, c) => (!a || c.endAt < a.endAt ? c : a), null);
  if (soonest && soonest.endAt < restTimerContext.endAt) {
    parallelRestTimers = parallelRestTimers.filter((c) => c !== soonest);
    parallelRestTimers.push(restTimerContext);
    restTimerContext = soonest;
  }
  exerciseName = restTimerContext.exerciseName;
  position = restTimerContext.position;
  seconds = restTimerContext.remaining;
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
  updateRestNotification(exerciseName, seconds);
  // beginRestTimerTick must run BEFORE this refresh, not after -- it's the
  // call that sets restTimerHandle, and refreshWorkoutNotificationContent
  // decides show-vs-idle by checking restTimerHandle != null. Calling it
  // first (the original order) meant the handle was always still null at
  // this exact point, so the Island/rest notification never posted right
  // when a rest period actually started -- it only ever showed up later, by
  // accident, if some unrelated re-render happened to call this again after
  // the handle was set. Real bug found via a logcat capture (2026-09-24,
  // see 01 Daily Logs/[C] Open Items.md -> workout-app-hyperisland-rate-limiting-flaky):
  // looked like OS-level rate limiting, wasn't -- HyperOS's own
  // DynamicIslandBaseContentView also throws a NullPointerException when
  // two posts land back-to-back, which is what this ordering fix avoids too.
  beginRestTimerTick(exerciseName, position);
  refreshWorkoutNotificationContent(); // native foreground notification switches to rest content
}

// Adjusts the live countdown directly (2026-09-14) -- driven by the
// notification's own -30s/+30s buttons, so it has to work with no numpad
// and possibly no visible screen at all. total grows to match a +30 that
// pushes remaining past it, so the progress bar (and any later % calc)
// doesn't show over 100% instead of clamping oddly.
function adjustLiveRestTimer(deltaSeconds) {
  if (!restTimerContext || restTimerHandle == null) return; // not actually resting right now
  restTimerContext.endAt = Math.max(Date.now(), restTimerContext.endAt + deltaSeconds * 1000);
  restTimerContext.remaining = Math.max(0, Math.ceil((restTimerContext.endAt - Date.now()) / 1000));
  restTimerContext.total = Math.max(restTimerContext.total, restTimerContext.remaining);
  if (restTimerContext.remaining <= 0) {
    stopRestTimer();
    return;
  }
  updateRestTimerDom(restTimerContext.exerciseName, restTimerContext.position);
  refreshWorkoutNotificationContent();
}

// Same "Skip" action the in-app numpad's Skip button performs, reachable
// from the notification's own Skip button instead.
function skipLiveRestFromNotification() {
  if (restTimerContext && restTimerHandle != null) stopRestTimerManually();
}

// Silent teardown for when the rest timer feature is switched off mid-rest:
// no bell, no vibration, no "back to it" notification.
function dropRestTimers() {
  clearInterval(restTimerHandle);
  document.removeEventListener("visibilitychange", handleRestTimerVisibilityChange);
  restTimerHandle = null;
  restTimerContext = null;
  parallelRestTimers = [];
  if (restNotification) {
    try { restNotification.close(); } catch (err) { /* already gone */ }
    restNotification = null;
  }
  refreshWorkoutNotificationContent();
}

// Clears the live state and re-renders so the divider that had it drops
// back to its plain historical label -- only ever called on genuine natural
// expiry (a manual edit/restart calls startRestTimer directly, which clears
// the old interval itself without going through here).
function stopRestTimer() {
  clearInterval(restTimerHandle);
  document.removeEventListener("visibilitychange", handleRestTimerVisibilityChange);
  restTimerHandle = null;
  restTimerContext = null;
  if (hapticsEnabled() && navigator.vibrate) navigator.vibrate([80, 60, 80]);
  playBellSound();
  closeRestNotification("Time to get back to it.");
  if (parallelRestTimers.length) {
    parallelRestTimers.sort((a, b) => a.endAt - b.endAt);
    restTimerContext = parallelRestTimers.shift();
    beginRestTimerTick(restTimerContext.exerciseName, restTimerContext.position);
    refreshWorkoutNotificationContent();
  }
  // preserveAddBox: the timer ending must not close an add-exercise search
  // the user has open (2026-10-03).
  renderActiveScreen({ preserveAddBox: true });
}

// Cancels the countdown early, same end state as letting it run out --
// triggered by the numpad's own Skip button (2026-09-11, replacing the
// bar's separate ✕ control; the bar itself no longer has a second tap
// target, just the one that opens the edit numpad).
function stopRestTimerManually() {
  stopRestTimer();
}

// One numpad for editing any rest divider -- idle, live, or historical
// (2026-09-11, unified; previously live and idle/historical used separate
// functions with different button sets). Skip and NEXT are both always
// present now: Skip always closes without (re)starting anything (also
// stopping this position's own timer first if it happens to be the one
// currently live), NEXT always (re)starts the countdown from whatever's
// typed -- so a rest timer can be run as many times as wanted, including
// well after its set was confirmed, not just once automatically on
// confirm. The edit is scoped to this one position via
// restPositionOverrides[exerciseName][position], not the exercise's shared
// default -- editing one divider was previously found to silently change
// every other still-idle divider for the same exercise too. The tick/time
// span carries its own data-numpad-field so typed digits show immediately
// on the actual bar, same mechanism a KG/REPS field already uses.
function openRestEditNumpad(exerciseName, position) {
  const isLive = restTimerContext && restTimerContext.exerciseName === exerciseName && restTimerContext.position === position;
  const set = activeWorkout.sets.find((s) => s.exercise_name === exerciseName && s.set_order === position + 1);
  const initialSeconds = isLive ? restTimerContext.remaining
    : (set && set.rest_after_sec != null ? set.rest_after_sec : restSecondsFor(exerciseName, position));
  // The numpad's own scratch storage (pendingInputByExercise) is keyed only
  // by exerciseName+position -- the same key this row's real weight/reps
  // pending input already uses, so typing a rest duration into it would
  // otherwise clobber whatever's typed into that row's own KG/REPS fields
  // (2026-09-11 fix, found live: editing an idle divider's rest wiped the
  // ghost weight/reps prefill for that same position). Snapshot whatever
  // was there going in, restore exactly that (not a blanket delete) on
  // every way out -- NEXT's commit and Skip/outside-tap/collapse's
  // cancel-without-committing alike -- since a stray {duration: ...} left
  // behind would corrupt that row's prefill just as much as deleting a
  // real weight/reps entry would.
  const priorEntry = pendingInputByExercise[exerciseName] ? pendingInputByExercise[exerciseName][position] : undefined;
  const restorePriorInput = () => {
    if (!pendingInputByExercise[exerciseName]) pendingInputByExercise[exerciseName] = {};
    if (priorEntry !== undefined) {
      pendingInputByExercise[exerciseName][position] = priorEntry;
    } else {
      delete pendingInputByExercise[exerciseName][position];
    }
  };
  // step: 30 overrides the shared 1s default (NUMPAD_STEP.duration, meant
  // for a logged set's own duration field) -- rest adjustments are coarser,
  // ImIceTry's own call (2026-09-10). selectOnType (2026-09-11, same call):
  // the prefilled duration is "selected" on open, so the first digit typed
  // overwrites it outright instead of appending onto the end of it -- you
  // almost never want to build on top of the old duration, you want to
  // replace it. onStep, live only (2026-09-14 fix): +/-30 on an already-
  // running countdown nudges it immediately via adjustLiveRestTimer (same
  // thing the notification's own -30s/+30s buttons do) instead of buffering
  // into the numpad's own `values` and waiting for NEXT to apply it --
  // ImIceTry's own report that the buffered version "stops and waits till I
  // press next" is correct, that's not what a live nudge should feel like.
  const fields = [{
    key: "duration",
    isDuration: true,
    initialValue: secondsToMmssBuffer(initialSeconds),
    step: 30,
    numpadSlot: "skip",
    selectOnType: true,
    onStep: isLive ? (delta) => { adjustLiveRestTimer(delta); return restTimerContext ? restTimerContext.remaining : null; } : undefined,
  }];
  openNumpad(exerciseName, position, fields, (values) => {
    restorePriorInput();
    const newSeconds = mmssBufferToSeconds(values[0]);
    if (!activeWorkout.restPositionOverrides) activeWorkout.restPositionOverrides = {};
    if (!activeWorkout.restPositionOverrides[exerciseName]) activeWorkout.restPositionOverrides[exerciseName] = {};
    activeWorkout.restPositionOverrides[exerciseName][position] = newSeconds;
    if (set) set.rest_after_sec = newSeconds;
    persistActiveWorkout();
    startRestTimer(exerciseName, position, newSeconds);
    // Starting a timer for a divider that was idle or historical (not
    // already live) needs its own re-render to actually switch that
    // divider's markup over to the live variant (2026-09-11 fix) --
    // startRestTimer's own per-second update only patches an *existing*
    // .rest-divider-tick element, which an idle/historical divider doesn't
    // have yet. Restarting an already-live one doesn't strictly need this
    // (the live markup's already there) but re-rendering is harmless either
    // way. Must come after startRestTimer, not before, so restTimerContext
    // is already set when this render reads it.
    renderActiveScreen();
  }, undefined, restorePriorInput);
}
