// Offline-tolerant sync queue, plus a read-side GET cache (below) so screens
// that only ever read data -- templates, history, exercises -- have
// something to show with no signal at all, not just a way to queue writes.
// Both share one IndexedDB database/connection since they're the same
// "make this app usable offline" concern, just opposite directions of data
// flow.
const DB_NAME = "workout-app";
const DB_VERSION = 3;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("pending")) {
        db.createObjectStore("pending", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("get-cache")) {
        db.createObjectStore("get-cache", { keyPath: "path" });
      }
      // v3 (2026-09-14): last-known-good Grafana panel snapshot images,
      // same "cache the last real response, serve it only when a fresh
      // fetch fails" idea as get-cache above, just Blobs instead of JSON --
      // structured-clone handles Blob values natively, no base64 needed.
      if (!db.objectStoreNames.contains("image-cache")) {
        db.createObjectStore("image-cache", { keyPath: "name" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// A finished workout is a single self-contained payload (see app.js) -- no
// partial-state / ID-dependency problem to solve, so this only ever needs to
// store and replay whole payloads in order.
const Queue = (() => {
  const STORE = "pending";

  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
  }

  // Resolves to the new entry's key, so a caller that also sends the payload
  // right away can remove exactly this entry once that succeeds.
  async function enqueue(payload) {
    let req;
    await withStore("readwrite", (store) => {
      req = store.add({ payload, queued_at: new Date().toISOString() });
    });
    return req.result;
  }

  async function getAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(id) {
    return withStore("readwrite", (store) => {
      store.delete(id);
    });
  }

  async function count() {
    const all = await getAll();
    return all.length;
  }

  // Replays queued workouts in order against the real sync endpoint. Stops at
  // the first failure so a still-offline stretch doesn't burn through retries
  // out of order -- the next flush() call (online event, or the periodic
  // interval in app.js) picks up where this left off.
  //
  // Overlapping calls (boot, the "online" event and the 30s interval can all
  // land together, or one slow upload outlasts the interval) share the one
  // flush already running instead of each re-sending the same items -- the
  // backend dedupes replays too (sync_workout), this just avoids the extra
  // uploads.
  let running = null;
  function flush(syncFn) {
    if (!running) {
      running = (async () => {
        const items = await getAll();
        let synced = 0;
        for (const item of items) {
          try {
            await syncFn(item.payload);
            await remove(item.id);
            synced += 1;
          } catch (err) {
            break;
          }
        }
        return synced;
      })().finally(() => { running = null; });
    }
    return running;
  }

  return { enqueue, getAll, remove, count, flush };
})();

// Last-known-good snapshot of every GET response, keyed by request path.
// apiGet() (app.js) writes through on every successful fetch and reads this
// back only when the fetch itself fails outright (no signal) -- never
// preferred over a live response, same "network first, cache as last
// resort" rule the app shell's own service worker already uses.
const GetCache = (() => {
  const STORE = "get-cache";

  async function get(path) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(path);
      req.onsuccess = () => resolve(req.result ? req.result.data : undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async function set(path, data) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ path, data, cached_at: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { get, set };
})();

// Last-known-good Grafana panel snapshot, keyed by panel name (see
// loadGrafanaSnapshots in app.js). Same "network first, cache as last
// resort" rule as GetCache above, just for the Blob a snapshot <img>
// actually needs instead of parsed JSON.
const ImageCache = (() => {
  const STORE = "image-cache";

  async function get(name) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(name);
      req.onsuccess = () => resolve(req.result ? req.result.blob : undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async function set(name, blob) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ name, blob, cached_at: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { get, set };
})();
