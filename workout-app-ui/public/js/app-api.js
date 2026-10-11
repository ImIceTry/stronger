// ---------- api (fetch helpers, cache-aware GET, Grafana snapshot loader) ----------
// Falls back to the last cached response only when the fetch itself fails
// (genuinely offline) -- a real HTTP error (404/500 etc.) still throws
// normally rather than silently serving stale cached data for what might be
// a real server-side problem.
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
async function apiGet(path) {
  let res;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GET_TIMEOUT_MS);
    try {
      res = await fetch(API_BASE + path, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (networkErr) {
    const cached = await GetCache.get(path).catch(() => undefined);
    if (cached !== undefined) {
      updateOfflineBadge(true);
      return cached;
    }
    throw networkErr;
  }
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  const data = await res.json();
  GetCache.set(path, data).catch(() => {});
  updateOfflineBadge(false);
  return data;
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
        res = await fetch(`${GRAFANA_SNAPSHOT_BASE}${name}.png`, { signal: controller.signal });
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
    res = await fetch(API_BASE + "/api/workouts/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`sync -> ${res.status}`);
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(API_BASE + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(API_BASE + path, { method: "DELETE" });
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
  const res = await fetch(`${API_BASE}/api/workouts/${workoutId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`update -> ${res.status}`);
  return res.json();
}
