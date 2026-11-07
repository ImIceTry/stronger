// Regression test for public/js/app-outbox.js (setting changes saved for later)
// and its two hooks in app-api.js (apiGet overlays pending changes, apiPut is the
// fallback). Plain scripts loaded into a vm context the way the browser loads
// them; the network, the stored copies and IndexedDB are mocks.
// Run: node workout-app-ui/tests/outbox.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const JS = (f) => fs.readFileSync(path.join(__dirname, "..", "public", "js", f), "utf8");
const API_SRC = JS("app-api.js");
const OUTBOX_SRC = JS("app-outbox.js");
const tick = () => new Promise((r) => setImmediate(r));
const clone = (x) => JSON.parse(JSON.stringify(x));
// objects built inside the vm have that realm's prototypes, so compare as plain data
const eq = (actual, expected, msg) => assert.deepStrictEqual(clone(actual), clone(expected), msg);

// A just-enough IndexedDB: open / createObjectStore / getAll / put / delete.
function fakeIndexedDB() {
  const dbs = {};
  return {
    dbs,
    open(name) {
      const req = {};
      setImmediate(() => {
        const isNew = !dbs[name];
        const db = dbs[name] || (dbs[name] = { stores: {} });
        req.result = {
          createObjectStore: (n, o) => { db.stores[n] = { key: o.keyPath, rows: new Map(), next: 1 }; },
          transaction: (n) => {
            const st = db.stores[n];
            const tx = {};
            const run = (fn) => {
              const r = {};
              setImmediate(() => { r.result = fn(); if (r.onsuccess) r.onsuccess(); setImmediate(() => tx.oncomplete && tx.oncomplete()); });
              return r;
            };
            tx.objectStore = () => ({
              getAll: () => run(() => [...st.rows.values()].map(clone)),
              put: (v) => run(() => { v = clone(v); if (v[st.key] == null) v[st.key] = st.next++; st.rows.set(v[st.key], v); return v[st.key]; }),
              delete: (k) => run(() => { st.rows.delete(k); }),
            });
            return tx;
          },
        };
        if (isNew && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}

// answer(path, opts) -> {ok,status,json} or throws (network error)
function load({ answer = () => { throw new Error("offline"); }, online = true, idb = fakeIndexedDB(), known = {} } = {}) {
  const store = new Map();
  const calls = [];
  const state = { online };
  const ctx = vm.createContext({
    API_BASE: "",
    apiFetch: async (p, opts) => { calls.push({ path: p, method: (opts && opts.method) || "GET", timeoutMs: opts && opts.timeoutMs }); await tick(); return answer(p, opts); },
    GetCache: { get: async (p) => store.get(p), set: async (p, d) => { store.set(p, clone(d)); } },
    updateOfflineBadge: () => {},
    navigator: { get onLine() { return state.online; } },
    indexedDB: idb,
    AbortController, setTimeout, clearTimeout, WeakMap, JSON, Promise, Object, Array, Number, String, Math, Error,
    ImageCache: {}, urlFetch: async () => { throw new Error("unused"); }, GRAFANA_SNAPSHOT_BASE: "",
    document: { querySelectorAll: () => [] },
    ensureTemplateId: async (tpl) => { if (tpl.id == null) tpl.id = 99; return tpl.id; },
    stickyNoteCache: known.sticky, defaultUnilateralCache: known.uni, defaultRestCache: known.rest,
    variantRatioCache: known.ratios || {}, machineSettingsCache: known.machine || {},
  });
  vm.runInContext(API_SRC, ctx);
  vm.runInContext(OUTBOX_SRC, ctx);
  return { ctx, store, calls, state, idb };
}
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const NAME = "Lat%20Pulldown";
const MS = `/api/exercises/${NAME}/machine-settings`;
const CTX = `/api/exercises/${NAME}/context`;
const nobody = () => { throw new Error("Failed to fetch"); };

// top-level const is not a property of the vm context, so read it by name
const ob = (t) => vm.runInContext("Outbox", t.ctx);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const peek = async (t) => (await ob(t).pendingCount());

test("a path that is not one of the five settings is plain apiPut", async () => {
  const t = load({ answer: () => json({ ok: 1 }) });
  await t.ctx.apiPutLater(`/api/exercises/${NAME}/details`, { a: 1 });
  assert.strictEqual(t.calls.length, 1);
  assert.strictEqual(await peek(t), 0);
});

test("online and answered: the server's own answer comes back, nothing is queued", async () => {
  const t = load({ answer: () => json({ note: "from server" }) });
  const r = await t.ctx.apiPutLater(`/api/exercises/${NAME}/sticky-note`, { note: "x" });
  eq(r, { note: "from server" });
  assert.strictEqual(await peek(t), 0);
  assert.strictEqual(t.calls[0].timeoutMs, 3000);
});

test("server cannot be reached: the change is applied locally, queued, and no error is raised", async () => {
  const t = load({ answer: nobody, known: { machine: { "Lat Pulldown": { Mcfit: [["Pad", "2"]] } } } });
  const r = await t.ctx.apiPutLater(MS, { variant: "SportsArt", settings: [[" Seat ", " 5 "], ["", "ignored"]] });
  // the other machine's settings (held in memory) are kept, this one is set, names trimmed, blank names dropped
  eq(r, { machine_settings: { Mcfit: [["Pad", "2"]], SportsArt: [["Seat", "5"]] } });
  assert.strictEqual(await peek(t), 1);
});

test("the device reports no connection: no attempt at all, straight to the queue", async () => {
  const t = load({ online: false, answer: () => json({}) });
  const r = await t.ctx.apiPutLater(`/api/exercises/${NAME}/default-rest`, { default_rest_sec: 150 });
  eq(r, { default_rest_sec: 150 });
  assert.strictEqual(t.calls.length, 0);
  assert.strictEqual(await peek(t), 1);
});

for (const code of [502, 530, 403, 429]) {
  test(`the server or tunnel answers HTTP ${code}: treated as unreachable, queued`, async () => {
    const t = load({ answer: () => json({}, code) });
    await t.ctx.apiPutLater(`/api/exercises/${NAME}/default-unilateral`, { default_unilateral: true });
    assert.strictEqual(await peek(t), 1);
  });
}

test("a login or portal page (200 that is not JSON): treated as unreachable, queued", async () => {
  const t = load({ answer: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("<"); } }) });
  await t.ctx.apiPutLater(`/api/exercises/${NAME}/default-unilateral`, { default_unilateral: true });
  assert.strictEqual(await peek(t), 1);
});

test("the server refuses the value (400): the error reaches the caller, nothing is queued", async () => {
  const t = load({ answer: () => json({ error: "ratio must be between" }, 400) });
  await assert.rejects(t.ctx.apiPutLater(`/api/exercises/${NAME}/variant-ratios`, { variant: "A", ratio: 0.5 }), (e) => e.rejected === true && /ratio must be between/.test(e.message));
  assert.strictEqual(await peek(t), 0);
});

test("values the server would refuse are refused at once, even with no signal (same rules as server.py)", async () => {
  const t = load({ answer: nobody });
  const bad = [
    [`/api/exercises/${NAME}/variant-ratios`, { variant: "A", ratio: 500 }],
    [`/api/exercises/${NAME}/variant-ratios`, { variant: "  ", ratio: 1 }],
    [`/api/exercises/${NAME}/default-unilateral`, { default_unilateral: "yes" }],
    [`/api/exercises/${NAME}/default-rest`, { default_rest_sec: -5 }],
    [`/api/exercises/${NAME}/default-rest`, { default_rest_sec: 1.5 }],
    [MS, { variant: "", settings: Array.from({ length: 21 }, () => ["a", "b"]) }],
    [MS, { variant: "", settings: [["a".repeat(41), "b"]] }],
    [MS, { variant: "", settings: [["a"]] }],
  ];
  for (const [p, b] of bad) await assert.rejects(t.ctx.apiPutLater(p, b), (e) => e.rejected === true, JSON.stringify(b).slice(0, 40));
  assert.strictEqual(await peek(t), 0);
  assert.strictEqual(t.calls.length, 0);
});

test("NaN from an empty ratio box becomes null like on the wire: the ratio is cleared, not refused", async () => {
  const t = load({ answer: nobody, known: { ratios: { "Lat Pulldown": { A: 2, B: 1.5 } } } });
  const r = await t.ctx.apiPutLater(`/api/exercises/${NAME}/variant-ratios`, { variant: "A", ratio: NaN });
  eq(r, { ratios: { B: 1.5 } });
});

test("sticky note: trimmed; emptied means no note (null), like the server", async () => {
  const t = load({ answer: nobody });
  eq(await t.ctx.apiPutLater(`/api/exercises/${NAME}/sticky-note`, { note: "  paused reps  " }), { note: "paused reps" });
  eq(await t.ctx.apiPutLater(`/api/exercises/${NAME}/sticky-note`, { note: "   " }), { note: null });
});

test("the same setting changed twice offline keeps only the last change; another machine is a separate entry", async () => {
  const t = load({ answer: nobody });
  await t.ctx.apiPutLater(MS, { variant: "A", settings: [["Seat", "1"]] });
  await t.ctx.apiPutLater(MS, { variant: "A", settings: [["Seat", "2"]] });
  await t.ctx.apiPutLater(MS, { variant: "B", settings: [["Seat", "9"]] });
  assert.strictEqual(await peek(t), 2);
  const sent = [];
  t.ctx.apiFetch = async (p, o) => { sent.push(JSON.parse(o.body)); return json({}); };
  assert.strictEqual(await ob(t).flush(), 2);
  eq(sent.map((b) => b.settings[0][1]), ["2", "9"]);
});

test("a change made while an older one for the same setting is queued goes behind it, it does not race past", async () => {
  const t = load({ answer: nobody });
  await t.ctx.apiPutLater(`/api/exercises/${NAME}/default-rest`, { default_rest_sec: 90 });
  assert.strictEqual(t.calls.length, 1); // the first, failed attempt
  t.ctx.apiFetch = async (p) => { t.calls.push({ path: p, method: "PUT" }); throw new Error("offline"); };
  const r = await t.ctx.apiPutLater(`/api/exercises/${NAME}/default-rest`, { default_rest_sec: 120 });
  eq(r, { default_rest_sec: 120 });
  assert.strictEqual(t.calls.length, 1, "no second attempt: the older change goes first");
  assert.strictEqual(await peek(t), 1); // replaced, not duplicated
});

test("flush: replays in order, removes what was accepted", async () => {
  const t = load({ answer: nobody });
  await t.ctx.apiPutLater(`/api/exercises/${NAME}/default-rest`, { default_rest_sec: 90 });
  await t.ctx.apiPutLater(`/api/exercises/Low%20Row/sticky-note`, { note: "n" });
  const order = [];
  t.ctx.apiFetch = async (p) => { order.push(p); return json({}); };
  assert.strictEqual(await ob(t).flush(), 2);
  eq(order, [`/api/exercises/${NAME}/default-rest`, "/api/exercises/Low%20Row/sticky-note"]);
  assert.strictEqual(await peek(t), 0);
});

test("flush: stops at the first 'server did not answer', keeps the rest, in order", async () => {
  const t = load({ answer: nobody });
  await t.ctx.apiPutLater(`/api/exercises/${NAME}/default-rest`, { default_rest_sec: 90 });
  await t.ctx.apiPutLater(`/api/exercises/Low%20Row/sticky-note`, { note: "n" });
  const seen = [];
  t.ctx.apiFetch = async (p) => { seen.push(p); throw new Error("still offline"); };
  assert.strictEqual(await ob(t).flush(), 0);
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(await peek(t), 2);
});

test("flush: a refused change is set aside as 'not saved' and does not block the ones after it", async () => {
  const t = load({ answer: nobody });
  await t.ctx.apiPutLater(`/api/exercises/${NAME}/variant-ratios`, { variant: "A", ratio: 2 });
  await t.ctx.apiPutLater(`/api/exercises/${NAME}/default-rest`, { default_rest_sec: 90 });
  t.ctx.apiFetch = async (p) => (p.endsWith("variant-ratios") ? json({ error: "nope" }, 400) : json({}));
  assert.strictEqual(await ob(t).flush(), 1);
  assert.strictEqual(await peek(t), 0);
  assert.strictEqual(await ob(t).failedCount(), 1);
  assert.match((await ob(t).failedItems())[0].reason, /nope/);
  await ob(t).dismissFailed();
  assert.strictEqual(await ob(t).failedCount(), 0);
});

test("overlay: a read (server answer or stored copy) shows the pending change on top, only for that exercise", async () => {
  const t = load({ answer: nobody });
  await t.ctx.apiPutLater(MS, { variant: "A", settings: [["Seat", "5"]] });
  await t.ctx.apiPutLater(`/api/exercises/${NAME}/sticky-note`, { note: "new" });
  const old = { last: null, sticky_note: "old", machine_settings: { B: [["Pad", "1"]] }, default_rest_sec: 120 };
  const got = await ob(t).overlay(CTX, old);
  eq(got, { last: null, sticky_note: "new", machine_settings: { B: [["Pad", "1"]], A: [["Seat", "5"]] }, default_rest_sec: 120 });
  eq(await ob(t).overlay(MS, { machine_settings: {} }), { machine_settings: { A: [["Seat", "5"]] } });
  eq(await ob(t).overlay("/api/exercises/Low%20Row/context", old), old);
  eq(await ob(t).overlay("/api/workouts", { w: 1 }), { w: 1 });
  assert.strictEqual(old.sticky_note, "old"); // the input is not mutated
});

test("the stored copies are patched when a change is queued: a reload with no signal shows it", async () => {
  const t = load({ answer: nobody });
  t.store.set(CTX, { last: null, sticky_note: null, machine_settings: {} });
  t.store.set(MS, { machine_settings: {} });
  await t.ctx.apiPutLater(MS, { variant: "A", settings: [["Seat", "5"]] });
  eq(t.store.get(MS), { machine_settings: { A: [["Seat", "5"]] } });
  eq(t.store.get(CTX).machine_settings, { A: [["Seat", "5"]] });
  // and through apiGet with no network at all
  eq((await t.ctx.apiGet(CTX)).machine_settings, { A: [["Seat", "5"]] });
});

test("apiGet: an online answer that does not have the pending change yet is shown with it, and stored with it", async () => {
  const t = load({ answer: nobody });
  await t.ctx.apiPutLater(`/api/exercises/${NAME}/default-rest`, { default_rest_sec: 150 });
  t.ctx.apiFetch = async () => json({ last: null, default_rest_sec: 120 }); // server not caught up yet
  const got = await t.ctx.apiGet(CTX);
  assert.strictEqual(got.default_rest_sec, 150);
  assert.strictEqual(t.store.get(CTX).default_rest_sec, 150);
});

test("a reload does not lose queued changes (they live in IndexedDB), and they upload afterwards", async () => {
  const idb = fakeIndexedDB();
  const first = load({ idb, answer: nobody });
  await first.ctx.apiPutLater(MS, { variant: "A", settings: [["Seat", "5"]] });
  assert.strictEqual(await peek(first), 1);
  const second = load({ idb, answer: () => json({}) }); // new page load, same database
  assert.strictEqual(await peek(second), 1);
  assert.strictEqual(await ob(second).flush(), 1);
  assert.strictEqual(await peek(second), 0);
  assert.strictEqual(second.calls[0].method, "PUT");
  assert.strictEqual(second.calls[0].timeoutMs, 8000);
});

test("the outbox uses its own database: the workout queue's database is never opened or changed", async () => {
  const idb = fakeIndexedDB();
  const t = load({ idb, answer: nobody });
  await t.ctx.apiPutLater(`/api/exercises/${NAME}/default-rest`, { default_rest_sec: 90 });
  eq(Object.keys(idb.dbs), ["workout-app-outbox"]);
});

// ---- the template part of Finish ----
const wo = (followup) => ({ name: "Pull", started_at: "2026-11-07 10:00:00", sets: [{ exercise_name: "Lat Pulldown", set_order: 1 }], ...(followup ? { followup } : {}) });
const syncAnd = (templateAnswer) => (p, opts) => {
  if (p === "/api/workouts/sync") return json({ id: 42 });
  if (p.startsWith("/api/templates/")) return templateAnswer(p, opts);
  return json({}, 404);
};

test("follow-up: after the workout uploads, 'update' makes the template match it; the server never sees the follow-up", async () => {
  const t = load({ answer: syncAnd(() => json({})) });
  let syncBody = null;
  const inner = t.ctx.apiFetch;
  t.ctx.apiFetch = async (p, o) => { if (p === "/api/workouts/sync") syncBody = o.body; return inner(p, o); };
  await t.ctx.syncWorkout(wo({ tpl: { id: 7, name: "Pull", source_workout_id: 3 }, update: true }));
  assert.ok(syncBody, "the workout was sent");
  assert.ok(!syncBody.includes("followup"), "the follow-up is for this app only");
  assert.ok(syncBody.includes("Lat Pulldown"), "the workout itself is sent in full");
  const put = t.calls.find((c) => c.path === "/api/templates/7/sync-from-workout");
  assert.ok(put, "sync-from-workout called after the upload");
});

test("follow-up: 'keep' only marks the template as used today (touch-logged)", async () => {
  const t = load({ answer: syncAnd(() => json({})) });
  await t.ctx.syncWorkout(wo({ tpl: { id: 7, name: "Pull", source_workout_id: 3 }, update: false }));
  assert.ok(t.calls.find((c) => c.path === "/api/templates/7/touch-logged"));
  assert.ok(!t.calls.find((c) => c.path.endsWith("sync-from-workout")));
});

test("follow-up: a template that is still virtual (no id yet) is created first, then used", async () => {
  const t = load({ answer: syncAnd(() => json({})) });
  await t.ctx.syncWorkout(wo({ tpl: { id: null, name: "Pull", source_workout_id: 3 }, update: false }));
  assert.ok(t.calls.find((c) => c.path === "/api/templates/99/touch-logged"));
});

test("follow-up: the body of the template call carries the new workout's id", async () => {
  const t = load({ answer: syncAnd(() => json({})) });
  const bodies = [];
  const inner = t.ctx.apiFetch;
  t.ctx.apiFetch = async (p, o) => { if (p.startsWith("/api/templates/")) bodies.push(JSON.parse(o.body)); return inner(p, o); };
  await t.ctx.syncWorkout(wo({ tpl: { id: 7 }, update: true }));
  eq(bodies, [{ workout_id: 42 }]);
});

test("follow-up: no answer from the server (network error, 502, 530): syncWorkout fails so the queue keeps the workout and replays it", async () => {
  for (const failure of [() => { throw new Error("Failed to fetch"); }, () => json({}, 502), () => json({}, 530)]) {
    const t = load({ answer: syncAnd(failure) });
    await assert.rejects(t.ctx.syncWorkout(wo({ tpl: { id: 7 }, update: true })));
  }
});

test("follow-up: the server's own refusal (404 template gone, 400, plain 500) is final: the workout upload still succeeds", async () => {
  for (const code of [404, 400, 500]) {
    const t = load({ answer: syncAnd(() => json({ error: "x" }, code)) });
    eq(await t.ctx.syncWorkout(wo({ tpl: { id: 7 }, update: true })), { id: 42 });
  }
});

test("no follow-up in the payload: no template call at all", async () => {
  const t = load({ answer: syncAnd(() => json({})) });
  await t.ctx.syncWorkout(wo(null));
  assert.ok(!t.calls.some((c) => c.path.startsWith("/api/templates/")));
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log("ok   " + name);
    } catch (e) {
      console.log("FAIL " + name + "\n     " + (e && e.message));
      process.exitCode = 1;
    }
  }
  console.log(`${passed}/${tests.length} passed`);
})();
