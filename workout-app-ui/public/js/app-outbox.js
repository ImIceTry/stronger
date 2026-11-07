// ---------- outbox: setting changes saved on the phone, uploaded when the server answers ----------
// Behind the "offlineSync" switch (AGENTS.md: new behaviour starts off).
//
// The five per-exercise settings you can change during a workout (sticky note,
// "always unilateral", default rest, a machine's weight factor, saved machine
// settings) used to need the server at that moment: with no signal the save
// failed with an alert and the change was lost. With the switch on, a change
// that cannot reach the server is applied on the phone at once (the screen, the
// in-memory caches and the stored copies all show it) and kept here, then
// uploaded in order when the server answers again. No message appears.
//
// Why replaying is safe: every one of these is "set this value" (PUT), so
// sending it twice, or late, leaves the same state; a newer change to the same
// thing replaces an older queued one (last write wins). The server stays the
// judge of what is valid: a value it refuses (HTTP 400/404) is moved to a
// "not saved" list instead of blocking the queue, and shows in the pending badge.
//
// Own IndexedDB database on purpose: the workout queue's database (queue.js) is
// never upgraded for this, so a workout waiting to upload cannot be put at risk.

const OUTBOX_DB_NAME = "workout-app-outbox";
const OUTBOX_PATH_RE = /^\/api\/exercises\/([^/]+)\/(sticky-note|default-unilateral|default-rest|variant-ratios|machine-settings)$/;
const OUTBOX_READ_RE = /^\/api\/exercises\/([^/]+)\/(context|sticky-note|default-unilateral|default-rest|variant-ratios|machine-settings)$/;
const OUTBOX_SEND_TIMEOUT_MS = 3000; // a save attempt while the screen is waiting
const OUTBOX_FLUSH_TIMEOUT_MS = 8000; // a replay in the background

const isPlainString = (x) => typeof x === "string";

// One entry per field: where it sits in the /context response (contextKey), its
// value when nothing is saved (empty), how the field's own endpoint wraps it
// (wrap/unwrap), the new value after a change (apply), which entries of one
// exercise are the same setting (key), and the server's own checks
// (validate, same rules as the PUT handlers in server.py) so a value it would
// refuse is refused here too, at the moment of saving, as it is today.
const OUTBOX_FIELDS = {
  "sticky-note": {
    contextKey: "sticky_note", empty: null,
    wrap: (v) => ({ note: v }), unwrap: (r) => (r && r.note != null ? r.note : null),
    apply: (_cur, body) => String(body.note == null ? "" : body.note).trim() || null,
    key: () => "", validate: () => null,
  },
  "default-unilateral": {
    contextKey: "default_unilateral", empty: false,
    wrap: (v) => ({ default_unilateral: v }), unwrap: (r) => !!(r && r.default_unilateral),
    apply: (_cur, body) => !!body.default_unilateral,
    key: () => "", validate: (b) => (typeof b.default_unilateral === "boolean" ? null : "default_unilateral must be a boolean"),
  },
  "default-rest": {
    contextKey: "default_rest_sec", empty: null,
    wrap: (v) => ({ default_rest_sec: v }), unwrap: (r) => (r && r.default_rest_sec != null ? r.default_rest_sec : null),
    apply: (_cur, body) => (body.default_rest_sec == null ? null : body.default_rest_sec),
    key: () => "",
    validate: (b) => (b.default_rest_sec == null || (Number.isInteger(b.default_rest_sec) && b.default_rest_sec >= 0) ? null : "default_rest_sec must be a non-negative integer or null"),
  },
  "variant-ratios": {
    contextKey: "variant_ratios", empty: {},
    wrap: (v) => ({ ratios: v }), unwrap: (r) => (r && r.ratios) || {},
    apply: (cur, body) => {
      const out = Object.assign({}, cur);
      const variant = String(body.variant).trim();
      if (body.ratio == null) delete out[variant]; else out[variant] = body.ratio;
      return out;
    },
    key: (b) => String(b.variant == null ? "" : b.variant).trim(),
    validate: (b) => {
      if (!isPlainString(b.variant) || !b.variant.trim()) return "variant is required and must be a non-empty string";
      if (b.ratio != null && (typeof b.ratio !== "number" || !(b.ratio >= 0.01 && b.ratio <= 100))) return "ratio must be a number between 0.01 and 100, or null";
      return null;
    },
  },
  "machine-settings": {
    contextKey: "machine_settings", empty: {},
    wrap: (v) => ({ machine_settings: v }), unwrap: (r) => (r && r.machine_settings) || {},
    apply: (cur, body) => {
      const out = Object.assign({}, cur);
      const variant = String(body.variant || "").trim();
      const pairs = body.settings.map((p) => [p[0].trim(), p[1].trim()]).filter((p) => p[0]);
      if (pairs.length) out[variant] = pairs; else delete out[variant];
      return out;
    },
    key: (b) => String(b.variant || "").trim(),
    validate: (b) => {
      if (b.variant != null && !isPlainString(b.variant)) return "variant must be a string";
      if (!Array.isArray(b.settings) || b.settings.length > 20) return "settings must be a list of at most 20 [name, value] pairs";
      for (const p of b.settings) {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(isPlainString)) return "each setting must be a [name, value] pair of strings";
        if (p[0].trim() && (p[0].trim().length > 40 || p[1].trim().length > 40)) return "setting name and value must be at most 40 characters";
      }
      return null;
    },
  },
};

function outboxParseWrite(path) {
  const m = OUTBOX_PATH_RE.exec(path);
  return m ? { name: decodeURIComponent(m[1]), field: m[2] } : null;
}

// Applies the pending changes of one exercise to a response read from the
// server or from the stored copy. `items` are pending entries in queue order.
function outboxOverlay(path, data, items) {
  const m = OUTBOX_READ_RE.exec(path);
  if (!m || !items.length || data == null || typeof data !== "object") return data;
  const name = decodeURIComponent(m[1]);
  const mine = items.filter((it) => it.name === name);
  if (!mine.length) return data;
  if (m[2] === "context") {
    const out = Object.assign({}, data);
    for (const it of mine) {
      const f = OUTBOX_FIELDS[it.field];
      out[f.contextKey] = f.apply(out[f.contextKey] === undefined ? f.empty : out[f.contextKey], it.body);
    }
    return out;
  }
  const f = OUTBOX_FIELDS[m[2]];
  const own = mine.filter((it) => it.field === m[2]);
  if (!own.length) return data;
  let value = f.unwrap(data);
  for (const it of own) value = f.apply(value, it.body);
  return f.wrap(value);
}

function outboxRejected(reason) {
  const err = new Error(reason);
  err.rejected = true;
  return err;
}

// deps: store {all, put, remove}  send(path, body, timeoutMs) -> {status, data|reason}
//       stored {get, set}         known(name, field) -> value held in memory, or undefined
function createOutbox(deps) {
  const { store, send, stored, known } = deps;
  const encode = (name) => encodeURIComponent(name);
  let items = null; // pending + failed, in id order; loaded once
  let loading = null;
  let flushing = null;

  const ready = () => {
    if (!loading) loading = store.all().then((all) => { items = all.sort((a, b) => a.id - b.id); }).catch(() => { items = []; });
    return loading;
  };
  const pending = () => items.filter((it) => it.state === "pending");

  // The same change, applied to the stored copies of the exercise (the combined
  // /context one and the field's own), so a reload with no signal shows it too.
  async function patchStored(item) {
    const f = OUTBOX_FIELDS[item.field];
    const ctxPath = `/api/exercises/${encode(item.name)}/context`;
    const fieldPath = `/api/exercises/${encode(item.name)}/${item.field}`;
    const ctx = await stored.get(ctxPath).catch(() => undefined);
    if (ctx !== undefined) await stored.set(ctxPath, outboxOverlay(ctxPath, ctx, [item])).catch(() => {});
    const own = await stored.get(fieldPath).catch(() => undefined);
    if (own !== undefined) await stored.set(fieldPath, outboxOverlay(fieldPath, own, [item])).catch(() => {});
  }

  // What the field holds now, for building the answer the caller expects.
  async function currentValue(name, field) {
    const f = OUTBOX_FIELDS[field];
    const inMemory = known ? known(name, field) : undefined;
    if (inMemory !== undefined) return inMemory;
    const own = await stored.get(`/api/exercises/${encode(name)}/${field}`).catch(() => undefined);
    if (own !== undefined) return f.unwrap(own);
    const ctx = await stored.get(`/api/exercises/${encode(name)}/context`).catch(() => undefined);
    if (ctx && ctx[f.contextKey] !== undefined) return ctx[f.contextKey];
    return f.empty;
  }

  async function enqueue(path, body, target) {
    const f = OUTBOX_FIELDS[target.field];
    const key = f.key(body);
    const dropped = items.filter((it) => it.state === "pending" && it.name === target.name && it.field === target.field && it.key === key);
    for (const old of dropped) { await store.remove(old.id).catch(() => {}); }
    items = items.filter((it) => !dropped.includes(it));
    const item = { path, name: target.name, field: target.field, key, body, queued_at: new Date().toISOString(), state: "pending" };
    item.id = await store.put(item);
    items.push(item);
    const answer = f.wrap(f.apply(await currentValue(target.name, target.field), body));
    await patchStored(item);
    return answer;
  }

  // The entry point for a change. Same answer shape as the server's PUT.
  async function save(path, body) {
    const target = outboxParseWrite(path);
    const f = OUTBOX_FIELDS[target.field];
    await ready();
    body = JSON.parse(JSON.stringify(body)); // as it would arrive: NaN becomes null, undefined is dropped
    const problem = f.validate(body);
    if (problem) throw outboxRejected(problem);
    const key = f.key(body);
    const queuedBefore = pending().some((it) => it.name === target.name && it.field === target.field && it.key === key);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    // An older change to the same thing still waiting must go first, so while
    // one is queued the new one is queued behind it instead of racing past.
    if (!offline && !queuedBefore) {
      const r = await send(path, body, OUTBOX_SEND_TIMEOUT_MS);
      if (r.status === "ok") {
        await patchStored({ name: target.name, field: target.field, body });
        return r.data;
      }
      if (r.status === "rejected") throw outboxRejected(r.reason);
    }
    return enqueue(path, body, target);
  }

  // Replays the queue in order. Stops at the first "server did not answer" so a
  // still-offline stretch does not burn through retries; a refused entry is set
  // aside and the rest go on.
  function flush() {
    if (!flushing) {
      flushing = (async () => {
        await ready();
        let sent = 0;
        for (const item of pending()) {
          const r = await send(item.path, item.body, OUTBOX_FLUSH_TIMEOUT_MS);
          if (r.status === "ok") {
            await store.remove(item.id).catch(() => {});
            items = items.filter((it) => it !== item);
            sent += 1;
          } else if (r.status === "rejected") {
            item.state = "failed";
            item.reason = r.reason;
            await store.put(item).catch(() => {});
          } else {
            break;
          }
        }
        return sent;
      })().finally(() => { flushing = null; });
    }
    return flushing;
  }

  async function overlay(path, data) {
    if (!OUTBOX_READ_RE.test(path)) return data;
    await ready();
    return outboxOverlay(path, data, pending());
  }

  return {
    ready, save, flush, overlay,
    pendingCount: async () => { await ready(); return pending().length; },
    failedCount: async () => { await ready(); return items.filter((it) => it.state === "failed").length; },
    failedItems: async () => { await ready(); return items.filter((it) => it.state === "failed"); },
    dismissFailed: async () => {
      await ready();
      for (const it of items.filter((x) => x.state === "failed")) await store.remove(it.id).catch(() => {});
      items = items.filter((it) => it.state !== "failed");
    },
  };
}

// ---- the real instance: IndexedDB store, apiFetch as the sender ----
let outboxDbPromise = null;
function openOutboxDb() {
  if (!outboxDbPromise) {
    outboxDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(OUTBOX_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("items", { keyPath: "id", autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return outboxDbPromise;
}
async function outboxTx(mode, fn) {
  const db = await openOutboxDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", mode);
    const req = fn(tx.objectStore("items"));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}
const outboxIdbStore = {
  all: () => outboxTx("readonly", (s) => s.getAll()),
  put: (item) => outboxTx("readwrite", (s) => s.put(item)),
  remove: (id) => outboxTx("readwrite", (s) => s.delete(id)),
};

async function outboxSend(path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await apiFetch(path, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: controller.signal, timeoutMs, idempotent: true,
    });
  } catch (err) {
    return { status: "unreachable", reason: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    if (!readFailureMayUseStoredCopy(res.status)) {
      try { const b = await res.json(); if (b && b.error) reason = b.error; } catch (_e) { /* keep the status */ }
      return { status: "rejected", reason };
    }
    return { status: "unreachable", reason };
  }
  try {
    return { status: "ok", data: await res.json() };
  } catch (_e) {
    return { status: "unreachable", reason: "not JSON" }; // a captive-portal page, not our API
  }
}

// What the screen already shows for an exercise (the in-memory caches of app.js).
function outboxKnownValue(name, field) {
  const caches = {
    "sticky-note": typeof stickyNoteCache !== "undefined" ? stickyNoteCache : null,
    "default-unilateral": typeof defaultUnilateralCache !== "undefined" ? defaultUnilateralCache : null,
    "default-rest": typeof defaultRestCache !== "undefined" ? defaultRestCache : null,
    "variant-ratios": typeof variantRatioCache !== "undefined" ? variantRatioCache : null,
    "machine-settings": typeof machineSettingsCache !== "undefined" ? machineSettingsCache : null,
  };
  const cache = caches[field];
  return cache && name in cache ? cache[name] : undefined;
}

const Outbox = createOutbox({ store: outboxIdbStore, send: outboxSend, stored: GetCache, known: outboxKnownValue });

// Drop-in for apiPut at the five call sites in app-exercise-menu.js. With the
// switch off, or for any other path, it is exactly apiPut.
async function apiPutLater(path, body) {
  if (!OUTBOX_PATH_RE.test(path) || (typeof featureEnabled === "function" && !featureEnabled("offlineSync"))) {
    return apiPut(path, body);
  }
  return Outbox.save(path, body);
}
