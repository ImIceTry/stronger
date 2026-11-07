// Regression test for the stored-copy behaviour of apiGet / syncWorkout in
// public/js/app-api.js: what the app shows when the server cannot be reached or
// does not answer as the backend, and that a saved workout refreshes the stored
// "previous numbers" of its exercises. Plain script, loaded into a vm context the
// way the browser loads it; apiFetch, the stored-copy store and the badge are mocks.
// Run: node workout-app-ui/tests/offline-cache.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-api.js"), "utf8");
const tick = () => new Promise((r) => setImmediate(r));
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const status = (code) => ({ ok: false, status: code, json: async () => ({ error: "x" }) });
const notJson = () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } });

// answer(path, opts, n) returns a response, or throws to simulate a network error.
function load(answer, { online = true, switchOn = null, clock = null } = {}) {
  const store = new Map();
  const calls = [];
  const badge = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const ctx = vm.createContext({
    API_BASE: "",
    apiFetch: async (p, opts) => {
      calls.push({ path: p, method: (opts && opts.method) || "GET" });
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try { await tick(); return answer(p, opts, calls.length); } finally { inFlight--; }
    },
    GetCache: { get: async (p) => store.get(p), set: async (p, d) => { store.set(p, d); } },
    updateOfflineBadge: (v) => badge.push(v),
    AbortController, setTimeout, clearTimeout, WeakMap,
    navigator: { onLine: online },
    ...(switchOn === null ? {} : { featureEnabled: (id) => id === "offlineSync" && switchOn.value }),
    ...(clock === null ? {} : { Date: { now: () => clock.now } }),
    ImageCache: {}, urlFetch: async () => { throw new Error("unused"); }, GRAFANA_SNAPSHOT_BASE: "",
    document: { querySelectorAll: () => [] },
  });
  vm.runInContext(SRC, ctx);
  return { ctx, store, calls, badge, maxInFlight: () => maxInFlight };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const P = "/api/exercises/Lat%20Pulldown/context";

test("answered: returns the data, stores it, badge hidden", async () => {
  const t = load(() => ok({ v: 1 }));
  assert.deepStrictEqual(await t.ctx.apiGet(P), { v: 1 });
  assert.deepStrictEqual(t.store.get(P), { v: 1 });
  assert.deepStrictEqual(t.badge, [false]);
});

test("network error with a stored copy: serves it and shows the offline badge", async () => {
  const t = load(() => { throw new Error("Failed to fetch"); });
  t.store.set(P, { v: "old" });
  assert.deepStrictEqual(await t.ctx.apiGet(P), { v: "old" });
  assert.deepStrictEqual(t.badge, [true]);
});

test("network error with no stored copy: throws the network error", async () => {
  const t = load(() => { throw new Error("Failed to fetch"); });
  await assert.rejects(t.ctx.apiGet(P), /Failed to fetch/);
});

for (const code of [500, 502, 503, 504, 530, 408, 429, 401, 403, 302]) {
  test(`HTTP ${code} (server, tunnel or login page) with a stored copy: serves it`, async () => {
    const t = load(() => status(code));
    t.store.set(P, { v: "old" });
    assert.deepStrictEqual(await t.ctx.apiGet(P), { v: "old" });
    assert.deepStrictEqual(t.badge, [true]);
  });
}

test("HTTP 502 with no stored copy: still throws, naming the status", async () => {
  const t = load(() => status(502));
  await assert.rejects(t.ctx.apiGet(P), /-> 502/);
});

for (const code of [400, 404]) {
  test(`HTTP ${code} is the backend's own answer: throws, the stored copy is not used`, async () => {
    const t = load(() => status(code));
    t.store.set(P, { v: "old" });
    await assert.rejects(t.ctx.apiGet(P), new RegExp(`-> ${code}`));
    assert.deepStrictEqual(t.badge, []);
  });
}

test("a 200 that is not JSON (captive portal, error page) with a stored copy: serves it", async () => {
  const t = load(() => notJson());
  t.store.set(P, { v: "old" });
  assert.deepStrictEqual(await t.ctx.apiGet(P), { v: "old" });
  assert.deepStrictEqual(t.badge, [true]);
});

test("a 200 that is not JSON with no stored copy: throws", async () => {
  const t = load(() => notJson());
  await assert.rejects(t.ctx.apiGet(P), /Unexpected token/);
});

test("a good answer replaces the stored copy, and a failure after it serves the new one", async () => {
  let mode = "ok";
  const t = load(() => (mode === "ok" ? ok({ v: "new" }) : status(502)));
  t.store.set(P, { v: "old" });
  await t.ctx.apiGet(P);
  mode = "down";
  assert.deepStrictEqual(await t.ctx.apiGet(P), { v: "new" });
});

// ---- syncWorkout refreshes the stored numbers of the exercises it saved ----
const payload = (names) => ({ name: "Pull", started_at: "2026-11-07 10:00:00", sets: names.map((n, i) => ({ exercise_name: n, set_order: i + 1, weight_kg: 50, reps: 8 })) });
const syncAnswer = (versions) => (p, opts) => {
  if (opts && opts.method === "POST") return ok({ id: 279 });
  const m = p.match(/^\/api\/exercises\/(.+)\/context$/);
  return m ? ok({ last: { weight: versions.v } }) : status(404);
};

test("a saved workout fetches the context of each of its exercises once, so the stored copy is current", async () => {
  const versions = { v: "after" };
  const t = load(syncAnswer(versions));
  t.store.set(P, { last: { weight: "before" } });
  const res = await t.ctx.syncWorkout(payload(["Lat Pulldown", "Lat Pulldown", "Low Row (Machine)"]));
  assert.deepStrictEqual(res, { id: 279 });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepStrictEqual(t.store.get(P), { last: { weight: "after" } });
  assert.deepStrictEqual(t.store.get("/api/exercises/Low%20Row%20(Machine)/context"), { last: { weight: "after" } });
  assert.strictEqual(t.calls.filter((c) => c.path.endsWith("/context")).length, 2);
});

test("the refresh runs at most 3 requests at a time", async () => {
  const names = Array.from({ length: 8 }, (_, i) => `Ex ${i}`);
  const t = load(syncAnswer({ v: 1 }));
  await t.ctx.syncWorkout(payload(names));
  for (let i = 0; i < 20; i++) await tick();
  assert.strictEqual(t.calls.filter((c) => c.path.endsWith("/context")).length, 8);
  assert.ok(t.maxInFlight() <= 3, "max in flight " + t.maxInFlight());
});

test("a failing refresh never fails or delays the save", async () => {
  const t = load((p, opts) => (opts && opts.method === "POST" ? ok({ id: 5 }) : status(404)));
  assert.deepStrictEqual(await t.ctx.syncWorkout(payload(["Lat Pulldown"])), { id: 5 });
  for (let i = 0; i < 5; i++) await tick();
});

test("a failed save does not refresh anything", async () => {
  const t = load(() => status(500));
  await assert.rejects(t.ctx.syncWorkout(payload(["Lat Pulldown"])), /sync -> 500/);
  for (let i = 0; i < 5; i++) await tick();
  assert.strictEqual(t.calls.filter((c) => c.path.endsWith("/context")).length, 0);
});

test("while the device reports no connection, a save does not try the refresh", async () => {
  const t = load(syncAnswer({ v: 1 }), { online: false });
  await t.ctx.syncWorkout(payload(["Lat Pulldown"]));
  for (let i = 0; i < 5; i++) await tick();
  assert.strictEqual(t.calls.filter((c) => c.path.endsWith("/context")).length, 0);
});

// ---- with "Offline sync" on: what a save refreshes ----
test("switch on: a save also refreshes the lists, the new workout, the templates and each exercise's history", async () => {
  const t = load(syncAnswer({ v: 1 }), { switchOn: { value: true } });
  await t.ctx.syncWorkout(payload(["Lat Pulldown", "Low Row (Machine)"]));
  for (let i = 0; i < 12; i++) await tick();
  const asked = t.calls.map((c) => c.path);
  for (const p of ["/api/workouts", "/api/workouts?include_pr=1&limit=60", "/api/templates?archived=1", "/api/workouts/279",
    "/api/exercises/Lat%20Pulldown/history", "/api/exercises/Low%20Row%20(Machine)/history"]) assert.ok(asked.includes(p), p);
});

test("switch off: only the exercises' context is refreshed, as before", async () => {
  const t = load(syncAnswer({ v: 1 }), { switchOn: { value: false } });
  await t.ctx.syncWorkout(payload(["Lat Pulldown"]));
  for (let i = 0; i < 12; i++) await tick();
  assert.deepStrictEqual(t.calls.filter((c) => c.method === "GET").map((c) => c.path), ["/api/exercises/Lat%20Pulldown/context"]);
});

// ---- with "Offline sync" on: once the server has been found unreachable, stored reads do not wait again ----
test("breaker: after one unreachable read, a read that has a stored copy answers at once, with no request", async () => {
  const sw = { value: true };
  const t = load(() => { throw new Error("Failed to fetch"); }, { switchOn: sw, clock: { now: 1000 } });
  t.store.set("/a", { v: "a" });
  t.store.set("/b", { v: "b" });
  assert.deepStrictEqual(await t.ctx.apiGet("/a"), { v: "a" });
  assert.strictEqual(t.calls.length, 1);
  assert.deepStrictEqual(await t.ctx.apiGet("/b"), { v: "b" });
  assert.strictEqual(t.calls.length, 1, "the second read made no request");
  assert.deepStrictEqual(t.badge.slice(-1), [true]);
});

test("breaker: a read with no stored copy still tries the network", async () => {
  const t = load(() => { throw new Error("Failed to fetch"); }, { switchOn: { value: true }, clock: { now: 1000 } });
  t.store.set("/a", { v: "a" });
  await t.ctx.apiGet("/a");
  await assert.rejects(t.ctx.apiGet("/never-stored"), /Failed to fetch/);
  assert.strictEqual(t.calls.length, 2);
});

test("breaker: ends after 20 seconds, and at the first successful answer", async () => {
  const clock = { now: 1000 };
  let up = false;
  const t = load(() => { if (!up) throw new Error("Failed to fetch"); return ok({ v: "live" }); }, { switchOn: { value: true }, clock });
  t.store.set("/a", { v: "a" });
  await t.ctx.apiGet("/a"); // marks the server down at 1000
  clock.now = 1000 + 19000;
  await t.ctx.apiGet("/a");
  assert.strictEqual(t.calls.length, 1, "still inside the 20 s");
  clock.now = 1000 + 21000;
  up = true;
  assert.deepStrictEqual(await t.ctx.apiGet("/a"), { v: "live" });
  assert.strictEqual(t.calls.length, 2, "after 20 s it asks again");
  t.store.set("/b", { v: "stored" });
  assert.deepStrictEqual(await t.ctx.apiGet("/b"), { v: "live" }); // up again: live answers, no shortcut
  assert.strictEqual(t.calls.length, 3);
});

test("breaker: one successful answer inside the 20 s ends it at once", async () => {
  const clock = { now: 1000 };
  let up = false;
  const t = load((p) => { if (!up) throw new Error("Failed to fetch"); return ok({ v: "live " + p }); }, { switchOn: { value: true }, clock });
  t.store.set("/a", { v: "a" });
  t.store.set("/b", { v: "b" });
  await t.ctx.apiGet("/a"); // down
  up = true;
  await t.ctx.apiGet("/never-stored"); // no copy, so it asks the server and succeeds
  assert.deepStrictEqual(await t.ctx.apiGet("/b"), { v: "live /b" }, "asked the server again, no stale shortcut");
});

test("breaker: with the switch off every read still tries the network", async () => {
  const t = load(() => { throw new Error("Failed to fetch"); }, { switchOn: { value: false }, clock: { now: 1000 } });
  t.store.set("/a", { v: "a" });
  t.store.set("/b", { v: "b" });
  await t.ctx.apiGet("/a");
  await t.ctx.apiGet("/b");
  assert.strictEqual(t.calls.length, 2);
});

test("breaker: the background download (fresh) ignores it and always asks the server", async () => {
  const t = load(() => { throw new Error("Failed to fetch"); }, { switchOn: { value: true }, clock: { now: 1000 } });
  t.store.set("/a", { v: "a" });
  await t.ctx.apiGet("/a");
  await assert.rejects(t.ctx.apiGet("/a", { fresh: true }), (e) => e.unreachable === true);
  assert.strictEqual(t.calls.length, 2);
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
