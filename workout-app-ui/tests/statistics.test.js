// Regression test for the pure helpers in public/js/app-statistics.js (plain
// script loaded into a vm context the way the browser loads it).
// Run: node tests/statistics.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-statistics.js"), "utf8");
const plain = (x) => JSON.parse(JSON.stringify(x));

function load(stored = {}) {
  const store = { ...stored };
  const ctx = vm.createContext({
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    computeExerciseSessionSeries: () => [],
    JSON, Math, Number, String, Date, Map, Set, Array, Object,
  });
  vm.runInContext(SRC, ctx);
  return { ctx, store };
}

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 18:00:00`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("week starts on Monday, also for a Sunday", () => {
  const { ctx } = load();
  // 2026-11-15 is a Sunday, 2026-11-09 the Monday before it.
  assert.strictEqual(ctx.statsYmd(ctx.statsWeekStart(new Date(2026, 10, 15, 23, 30))), "2026-11-09");
  assert.strictEqual(ctx.statsYmd(ctx.statsWeekStart(new Date(2026, 10, 9, 0, 5))), "2026-11-09");
});

test("weekly buckets: oldest first, last one is the running week, sums per week", () => {
  const { ctx } = load();
  const thisMonday = ctx.statsWeekStart(new Date());
  const lastWeek = new Date(thisMonday); lastWeek.setDate(lastWeek.getDate() - 3);
  const workouts = [
    { started_at: stamp(thisMonday), volume_kg: 1000, duration_sec: 3600 },
    { started_at: stamp(lastWeek), volume_kg: 500, duration_sec: 1800 },
    { started_at: stamp(lastWeek), volume_kg: 250, duration_sec: null },
    { started_at: stamp(daysAgo(400)), volume_kg: 9999, duration_sec: 60 }, // outside the window
  ];
  const weeks = plain(ctx.statsWeeklyBuckets(workouts, 4));
  assert.strictEqual(weeks.length, 4);
  assert.deepStrictEqual(weeks.map((w) => w.current), [false, false, false, true]);
  assert.deepStrictEqual(weeks.map((w) => w.workouts), [0, 0, 2, 1]);
  assert.deepStrictEqual(weeks.map((w) => w.volume), [0, 0, 750, 1000]);
  assert.deepStrictEqual(weeks.map((w) => w.minutes), [0, 0, 30, 60]);
});

test("nice ticks span the data with round steps", () => {
  const { ctx } = load();
  const ticks = plain(ctx.statsNiceTicks(23.4, 61.2));
  assert.ok(ticks[0] <= 23.4 && ticks[ticks.length - 1] >= 61.2, JSON.stringify(ticks));
  const step = ticks[1] - ticks[0];
  assert.ok([1, 2, 2.5, 5].some((m) => [1, 10, 100].some((p) => Math.abs(step - m * p) < 1e-9)), `step ${step}`);
  assert.deepStrictEqual(plain(ctx.statsNiceTicks(0, 26000)), [0, 20000, 40000]);
  assert.ok(ctx.statsNiceTicks(5, 5).length >= 2); // flat series still gets a range
});

test("reps-only series: oldest first, warm-ups ignored, sessions without reps dropped", () => {
  const { ctx } = load();
  const series = plain(ctx.statsRepsSeries([
    { started_at: "2026-11-10 18:00:00", sets: [{ set_type: "normal", reps: 12 }, { set_type: "warmup", reps: 20 }] },
    { started_at: "2026-11-05 18:00:00", sets: [{ set_type: "warmup", reps: 15 }] },
    { started_at: "2026-11-01 18:00:00", sets: [{ set_type: "normal", reps: 8 }, { set_type: "drop", reps: 10 }] },
  ]));
  assert.deepStrictEqual(series, [
    { date: "2026-11-01 18:00:00", maxReps: 10 },
    { date: "2026-11-10 18:00:00", maxReps: 12 },
  ]);
});

test("range filter keeps everything for 'all' and only recent points otherwise", () => {
  const { ctx } = load();
  const series = [{ date: stamp(daysAgo(200)) }, { date: stamp(daysAgo(40)) }, { date: stamp(daysAgo(2)) }];
  assert.strictEqual(ctx.statsFilterRange(series, "all").length, 3);
  assert.strictEqual(ctx.statsFilterRange(series, "90").length, 2);
});

test("saved choices survive a reload; a corrupt saved value falls back to defaults", () => {
  const saved = load({ statsChartsState: JSON.stringify({ exercise: "Chest Fly", weekMetric: "minutes" }) }).ctx;
  assert.strictEqual(vm.runInContext("statsState.exercise", saved), "Chest Fly");
  assert.strictEqual(vm.runInContext("statsState.weekMetric", saved), "minutes");
  assert.strictEqual(vm.runInContext("statsState.metric", saved), "best1rm");
  const broken = load({ statsChartsState: "{not json" }).ctx;
  assert.strictEqual(vm.runInContext("statsState.weekRange", broken), "12");
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
}
console.log(`${passed}/${tests.length} passed`);
