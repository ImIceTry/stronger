// Regression test for public/js/app-offline-prefetch.js (the background download
// of what a workout needs). Plain script loaded into a vm context; apiGet, the
// clock storage and the connection state are mocks.
// Run: node workout-app-ui/tests/offline-prefetch.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-offline-prefetch.js"), "utf8");
const tick = () => new Promise((r) => setImmediate(r));
const HOUR = 3600 * 1000;
const enc = encodeURIComponent;

// data: path -> response; a value that is an Error is thrown ({unreachable} marks "no server")
function load({ data = {}, online = true, lastRun = null } = {}) {
  const calls = [];
  const local = new Map(lastRun == null ? [] : [["offlinePrefetchAt", String(lastRun)]]);
  let inFlight = 0, maxInFlight = 0;
  const ctx = vm.createContext({
    apiGet: async (p, opts) => {
      calls.push({ p, fresh: !!(opts && opts.fresh) });
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await tick();
        const v = data[p];
        if (v instanceof Error) throw v;
        if (v === undefined) { const e = new Error(`GET ${p} -> 404`); throw e; }
        return v;
      } finally { inFlight--; }
    },
    navigator: { onLine: online },
    localStorage: { getItem: (k) => (local.has(k) ? local.get(k) : null), setItem: (k, v) => local.set(k, v) },
    encodeURIComponent, Date, Set, Map, Promise, Number, String, Array,
  });
  vm.runInContext(SRC, ctx);
  return { ctx, calls, local, maxInFlight: () => maxInFlight };
}
const unreachable = () => Object.assign(new Error("Failed to fetch"), { unreachable: true });

const home = {
  "/api/workouts": { workouts: [{ id: 30 }, { id: 29 }, { id: 28 }, { id: 27 }, { id: 26 }, { id: 25 }, { id: 24 }, { id: 23 }] },
  "/api/templates?archived=1": { templates: [
    { id: 1, name: "Pull", source_workout_id: 20, archived: 0, deleted: 0 },
    { id: 2, name: "Scratch", source_workout_id: null, archived: 0, deleted: 0 },
    { id: 3, name: "Old", source_workout_id: 11, archived: 1, deleted: 0 },
    { id: 4, name: "Gone", source_workout_id: 12, archived: 0, deleted: 1 },
  ] },
  "/api/template-folders": { folders: [] },
  "/api/exercises/all": { exercises: [] },
  "/api/workouts?include_pr=1&limit=60": { workouts: [] },
};
const set = (...names) => ({ sets: names.map((n, i) => ({ exercise_name: n, set_order: i + 1 })) });
const full = () => Object.assign({}, home, {
  "/api/workouts/20": set("Lat Pulldown", "Low Row (Machine)"),
  "/api/templates/2/exercises": { exercises: ["Bench Press", "Lat Pulldown"] },
  "/api/workouts/30": set("Squat"), "/api/workouts/29": set("Squat", "Deadlift"),
  "/api/workouts/28": set("Curl"), "/api/workouts/27": set("Curl"), "/api/workouts/26": set("Row"), "/api/workouts/25": set("Fly"),
  [`/api/exercises/${enc("Lat Pulldown")}/context`]: { last: {} },
});
const ctxPath = (n) => `/api/exercises/${enc(n)}/context`;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("offline, or downloaded less than 6 hours ago: nothing is requested", async () => {
  for (const opts of [{ online: false }, { lastRun: Date.now() - 5 * HOUR }]) {
    const t = load(Object.assign({ data: full() }, opts));
    assert.strictEqual(await t.ctx.runOfflinePrefetch(), false);
    assert.strictEqual(t.calls.length, 0, JSON.stringify(opts));
  }
});

test("due: downloads Home's lists, the exercise list, each active template, recent workouts and every exercise's context", async () => {
  const t = load({ data: full(), lastRun: Date.now() - 7 * HOUR });
  assert.strictEqual(await t.ctx.runOfflinePrefetch(), true);
  const asked = t.calls.map((c) => c.p);
  for (const p of ["/api/workouts", "/api/workouts?include_pr=1&limit=60", "/api/templates?archived=1", "/api/template-folders", "/api/exercises/all"]) assert.ok(asked.includes(p), p);
  // a template with a source workout: that workout; one without: its exercise list
  assert.ok(asked.includes("/api/workouts/20"));
  assert.ok(asked.includes("/api/templates/2/exercises"));
  // archived and deleted templates are skipped
  assert.ok(!asked.includes("/api/workouts/11") && !asked.includes("/api/workouts/12"));
  // the 6 most recent workouts, not the 8
  for (const id of [30, 29, 28, 27, 26, 25]) assert.ok(asked.includes(`/api/workouts/${id}`), String(id));
  assert.ok(!asked.includes("/api/workouts/24") && !asked.includes("/api/workouts/23"));
  // every exercise once
  const contexts = asked.filter((p) => p.endsWith("/context"));
  assert.deepStrictEqual([...contexts].sort(), ["Lat Pulldown", "Low Row (Machine)", "Bench Press", "Squat", "Deadlift", "Curl", "Row", "Fly"].map(ctxPath).sort());
  assert.ok(t.calls.every((c) => c.fresh), "every request asks for a fresh answer, not the stored copy");
  assert.ok(Number(t.local.get("offlinePrefetchAt")) > Date.now() - 5000);
});

test("the download is not repeated within 6 hours, but force runs it", async () => {
  const t = load({ data: full() });
  assert.strictEqual(await t.ctx.runOfflinePrefetch(), true);
  const n = t.calls.length;
  assert.strictEqual(await t.ctx.runOfflinePrefetch(), false);
  assert.strictEqual(t.calls.length, n);
  assert.strictEqual(await t.ctx.runOfflinePrefetch({ force: true }), true);
  assert.strictEqual(t.calls.length, 2 * n);
});

test("the server cannot be reached: stops after the first round, records nothing, so the next trigger retries", async () => {
  const data = full();
  for (const p of Object.keys(data)) data[p] = unreachable();
  const t = load({ data });
  assert.strictEqual(await t.ctx.runOfflinePrefetch(), false);
  assert.ok(t.calls.length <= 3, "asked " + t.calls.length);
  assert.strictEqual(t.local.has("offlinePrefetchAt"), false);
});

test("the server's own 'no' for one item (a deleted workout) skips that item and the rest goes on", async () => {
  const data = full();
  delete data["/api/workouts/20"]; // 404
  const t = load({ data });
  assert.strictEqual(await t.ctx.runOfflinePrefetch(), true);
  assert.ok(t.calls.some((c) => c.p === ctxPath("Squat")));
  assert.ok(!t.calls.some((c) => c.p === ctxPath("Low Row (Machine)")), "its exercises come from that workout, which is gone");
});

test("at most 3 requests at a time", async () => {
  const t = load({ data: full() });
  await t.ctx.runOfflinePrefetch();
  assert.ok(t.maxInFlight() <= 3, "max in flight " + t.maxInFlight());
});

test("at most 60 exercises, however many the templates hold", async () => {
  const data = Object.assign({}, home, { "/api/templates?archived=1": { templates: [{ id: 1, source_workout_id: 20, archived: 0, deleted: 0 }] },
    "/api/workouts": { workouts: [] }, "/api/workouts/20": set(...Array.from({ length: 90 }, (_, i) => `Ex ${i}`)) });
  const t = load({ data });
  await t.ctx.runOfflinePrefetch();
  assert.strictEqual(t.calls.filter((c) => c.p.endsWith("/context")).length, 60);
});

test("two triggers at once share one download", async () => {
  const t = load({ data: full() });
  const [a, b] = await Promise.all([t.ctx.runOfflinePrefetch(), t.ctx.runOfflinePrefetch()]);
  assert.strictEqual(a, true);
  assert.strictEqual(b, true);
  const once = new Set(t.calls.map((c) => c.p)).size;
  assert.strictEqual(t.calls.length, once, "no path asked twice");
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
