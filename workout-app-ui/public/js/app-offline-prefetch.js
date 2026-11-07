// ---------- offline sync: download what a workout needs while there is signal ----------
// Part of offline sync: always on, like logging and saving a workout.
//
// The stored copies the app falls back to (queue.js GetCache) are only filled
// by screens you happened to open online. This fills the ones a workout needs,
// in the background, whenever the app is open with a connection and the last
// download is more than 6 hours old: Home's lists, every template's exercise
// list, the exercise list for search, the workout list the finish summary compares against, and the "previous numbers and settings"
// (/context) of each exercise in a template or in the last few workouts. It
// fetches the same paths the screens use, so a stored copy is the one a screen
// looks for. Nothing is shown; if the server does not answer it stops and tries
// again at the next trigger.

const PREFETCH_AT_KEY = "offlinePrefetchAt";
const PREFETCH_EVERY_MS = 6 * 60 * 60 * 1000;
const PREFETCH_RECENT_WORKOUTS = 6;
const PREFETCH_MAX_EXERCISES = 60;
const PREFETCH_PARALLEL = 3;

let prefetchRunning = null;

function prefetchDue(now) {
  let at = 0;
  try { at = Number(localStorage.getItem(PREFETCH_AT_KEY)) || 0; } catch (_e) { /* storage unavailable: always due */ }
  return now - at >= PREFETCH_EVERY_MS;
}

// Fetches `paths` a few at a time into `got` (path -> data, or null when the
// server answered "no" for that one). Throws as soon as the server cannot be
// reached, so an offline start ends after the first round instead of timing
// out on every path.
async function prefetchGet(paths, got) {
  for (let i = 0; i < paths.length; i += PREFETCH_PARALLEL) {
    const round = await Promise.all(paths.slice(i, i + PREFETCH_PARALLEL).map((p) =>
      apiGet(p, { fresh: true }).then((data) => ({ p, data }), (err) => ({ p, err }))));
    for (const r of round) {
      if (r.err && r.err.unreachable) throw r.err;
      got.set(r.p, r.err ? null : r.data);
    }
  }
}

// Exercise names out of what the template and workout paths returned: a
// workout has sets with exercise_name, a template without a source workout has
// an exercises list of names.
function prefetchExerciseNames(paths, got) {
  const names = [];
  for (const p of paths) {
    const data = got.get(p);
    if (!data) continue;
    if (Array.isArray(data.sets)) data.sets.forEach((s) => names.push(s.exercise_name));
    if (Array.isArray(data.exercises)) data.exercises.forEach((e) => names.push(typeof e === "string" ? e : e && e.name));
  }
  return [...new Set(names.filter(Boolean))].slice(0, PREFETCH_MAX_EXERCISES);
}

function runOfflinePrefetch(opts) {
  opts = opts || {};
  if (prefetchRunning) return prefetchRunning;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve(false);
  if (!opts.force && !prefetchDue(Date.now())) return Promise.resolve(false);
  prefetchRunning = (async () => {
    try {
      const got = new Map();
      await prefetchGet(["/api/workouts", "/api/workouts?include_pr=1&limit=60", "/api/templates?archived=1", "/api/template-folders", "/api/exercises/all"], got);
      const templates = ((got.get("/api/templates?archived=1") || {}).templates || []).filter((t) => !t.archived && !t.deleted);
      const recent = ((got.get("/api/workouts") || {}).workouts || []).slice(0, PREFETCH_RECENT_WORKOUTS);
      const detailPaths = [...new Set([
        ...templates.map((t) => (t.source_workout_id ? `/api/workouts/${t.source_workout_id}` : `/api/templates/${t.id}/exercises`)),
        ...recent.map((w) => `/api/workouts/${w.id}`),
      ])];
      await prefetchGet(detailPaths, got);
      const names = prefetchExerciseNames(detailPaths, got);
      await prefetchGet(names.map((n) => `/api/exercises/${encodeURIComponent(n)}/context`), got);
      try { localStorage.setItem(PREFETCH_AT_KEY, String(Date.now())); } catch (_e) { /* tried again next time */ }
      return true;
    } catch (_err) {
      return false; // the server did not answer: the next trigger tries again
    }
  })().finally(() => { prefetchRunning = null; });
  return prefetchRunning;
}

if (typeof window !== "undefined" && window.addEventListener) {
  const maybePrefetch = () => { runOfflinePrefetch().catch(() => {}); };
  window.addEventListener("online", maybePrefetch);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") maybePrefetch(); });
  setTimeout(maybePrefetch, 8000); // after the first screen has loaded
}
