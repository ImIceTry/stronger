// ---------- api (fetch helpers, cache-aware GET, Grafana snapshot loader) ----------
// Falls back to the last cached response when the server could not be reached
// or did not answer as the backend: the fetch itself fails, or the answer is a
// gateway/server error, a login or captive-portal page (redirect, 401/403, a
// body that is not JSON). An answer that is the backend's own ("not found",
// "bad request") still throws normally, so it is never replaced by old data.
// The offline badge shows whenever the stored copy was served.
//
// GET_TIMEOUT_MS (2026-09-14 fix, ImIceTry's own report that Templates/History
// still showed nothing real-world despite the cache fallback below already
// working under Playwright's simulated test): that test broke `fetch`
// instantly, which only ever exercises an outright connection refusal. Real
// "bad signal at the gym" is usually the opposite -- the OS still reports a
// live interface, but a Tailscale MagicDNS lookup or the actual request to
// docker-host just hangs for a long time before failing, if it ever does.
// With no timeout, `await fetch(...)` sits there and the screen never
// reaches the catch block that would've served the cache. Racing it against
// a short abort makes a stalled request fail fast and fall through the same
// path a real network error already does.
const GET_TIMEOUT_MS = 4000;

// Statuses that mean "the backend did not answer" rather than "the backend
// answered no": gateway/tunnel errors (5xx, 408, 429), an Access or captive
// portal redirect (3xx), a login refusal (401, 403). 404 and 400 are the
// backend's own answers and must reach the caller (/last 404s on purpose for an
// exercise without history).
function readFailureMayUseStoredCopy(status) {
  return status >= 500 || status === 408 || status === 429 || status === 401 || status === 403 || (status >= 300 && status < 400);
}

// A setting change still waiting in the outbox (app-outbox.js) is part of what
// the screen must show, even if the server or the stored copy has not seen it yet.
async function withPendingChanges(path, data) {
  return typeof Outbox !== "undefined" ? Outbox.overlay(path, data) : data;
}

// The stored copy of a GET, or the reason it could not be had. With
// opts.fresh (the background download in app-offline-prefetch.js) there is no
// fallback: the caller needs to know the server did not answer.
async function storedCopyOrThrow(path, failure, opts) {
  if (opts && opts.fresh) {
    failure.unreachable = true;
    throw failure;
  }
  const cached = await GetCache.get(path).catch(() => undefined);
  if (cached === undefined) throw failure;
  updateOfflineBadge(true);
  return withPendingChanges(path, cached);
}

async function apiGet(path, opts) {
  let res;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GET_TIMEOUT_MS);
    try {
      res = await apiFetch(path, { signal: controller.signal, timeoutMs: GET_TIMEOUT_MS });
    } finally {
      clearTimeout(timeout);
    }
  } catch (networkErr) {
    return storedCopyOrThrow(path, networkErr, opts);
  }
  if (!res.ok) {
    const failure = new Error(`GET ${path} -> ${res.status}`);
    if (!readFailureMayUseStoredCopy(res.status)) throw failure;
    return storedCopyOrThrow(path, failure, opts);
  }
  let data;
  try {
    data = await res.json();
  } catch (notJson) {
    // A 200 that is not JSON is a captive-portal or error page, not our API.
    return storedCopyOrThrow(path, notJson, opts);
  }
  data = await withPendingChanges(path, data);
  GetCache.set(path, data).catch(() => {});
  updateOfflineBadge(false);
  return data;
}

// After a workout is saved on the server, the stored copy of each exercise's
// "previous" numbers is one workout behind (it was fetched when that workout
// was started). Fetching it again writes the new numbers through, so the next
// workout started with no signal compares against the one just saved. Called
// by syncWorkout, which is also what replays the offline queue, so a workout
// that was finished with no signal is covered as soon as it uploads.
// Best effort and in the background: it never delays or fails a save.
async function refreshStoredExerciseContext(payload) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const names = [...new Set(((payload && payload.sets) || []).map((s) => s.exercise_name).filter(Boolean))];
  for (let i = 0; i < names.length; i += 3) {
    await Promise.all(names.slice(i, i + 3).map((name) =>
      apiGet(`/api/exercises/${encodeURIComponent(name)}/context`).catch(() => {})));
  }
}

// Grafana panel snapshots (2026-09-14, see index.html's Statistics section
// for why these are static <img>s now instead of live iframes). Same
// "network first, fall back to last-known-good on failure" shape as apiGet
// above, just fetching a Blob instead of JSON and racing the same timeout
// so a stalled connection doesn't leave the panel stuck loading forever.
// grafanaSnapshotUrls tracks each element's current blob: URL so a repeat
// visit to Statistics revokes the old one instead of leaking it.
const grafanaSnapshotUrls = new WeakMap();
async function loadGrafanaSnapshots() {
  document.querySelectorAll("[data-snapshot]").forEach(async (img) => {
    const name = img.dataset.snapshot;
    let blob;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GET_TIMEOUT_MS);
      let res;
      try {
        res = await urlFetch(`${GRAFANA_SNAPSHOT_BASE}${name}.png`, { signal: controller.signal, timeoutMs: GET_TIMEOUT_MS, responseType: "blob" });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) throw new Error(`GET ${name}.png -> ${res.status}`);
      blob = await res.blob();
      ImageCache.set(name, blob).catch(() => {});
    } catch (err) {
      blob = await ImageCache.get(name).catch(() => undefined);
      if (!blob) return; // never successfully cached and can't fetch now -- leave the <img> empty rather than show a broken-image icon
    }
    const oldUrl = grafanaSnapshotUrls.get(img);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    const url = URL.createObjectURL(blob);
    grafanaSnapshotUrls.set(img, url);
    img.src = url;
  });
}

// Bounded like apiGet (2026-09-30) -- a stalled gym connection used to leave
// the upload hanging indefinitely. Much longer than GET_TIMEOUT_MS since this
// is a real write; aborting after the server already committed is safe
// because the payload stays queued and the backend returns the existing
// workout for a replayed started_at instead of inserting it twice.
const SYNC_TIMEOUT_MS = 20000;
async function syncWorkout(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  let res;
  try {
    res = await apiFetch("/api/workouts/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      timeoutMs: SYNC_TIMEOUT_MS,
      idempotent: true,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`sync -> ${res.status}`);
  const result = await res.json();
  refreshStoredExerciseContext(payload).catch(() => {});
  return result;
}

async function apiPut(path, body) {
  const res = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  return res.json();
}

async function apiDelete(path) {
  const res = await apiFetch(path, { method: "DELETE" });
  if (!res.ok) {
    // Real, actionable 400s (e.g. "can't delete, a template still points
    // at this") used to get swallowed into a generic status-code-only
    // Error, so every caller's catch block could only ever guess "offline?"
    // (2026-09-16, needed for delete_workout's own real refusal message).
    let detail = "";
    try {
      const body = await res.json();
      if (body && body.error) detail = body.error;
    } catch (_e) {
      // non-JSON error body -- fall through with just the status
    }
    throw new Error(detail || `DELETE ${path} -> ${res.status}`);
  }
  return res.json();
}

async function updateWorkout(workoutId, payload) {
  const res = await apiFetch(`/api/workouts/${workoutId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`update -> ${res.status}`);
  return res.json();
}
