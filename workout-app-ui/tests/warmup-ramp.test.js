// Regression test for public/js/app-warmup-ramp.js. The insertion runs against
// the app's REAL position-shifting helpers (the first part of
// app-set-manipulation.js, up to toggleSetType), so the check that the
// PREVIOUS column keeps pointing at the right historical set is real.
// Run: node tests/warmup-ramp.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const JS = (f) => fs.readFileSync(path.join(__dirname, "..", "public", "js", f), "utf8");
const plain = (x) => JSON.parse(JSON.stringify(x));

// helpers only: everything before toggleSetType
const manip = JS("app-set-manipulation.js");
const MANIP_HELPERS = manip.slice(0, manip.indexOf("function toggleSetType"));
assert.ok(MANIP_HELPERS.includes("function shiftPositionsAfter") && MANIP_HELPERS.includes("function shiftHistoricalIndexMap"));

function load({ previousSets = [], logged = [] } = {}) {
  const calls = { persist: 0, render: 0 };
  const ctx = vm.createContext({
    featureEnabled: () => true, localStorage: { getItem: () => null, setItem() {} },
    activeWorkout: { sets: logged },
    previousFor: () => (previousSets.length ? { sets: previousSets } : null),
    persistActiveWorkout: () => { calls.persist++; },
    renderActiveScreen: () => { calls.render++; },
    restTimerContext: null, parallelRestTimers: [],
    escapeHtml: (s) => String(s),
    JSON, Math, Number, String, Set, parseFloat, isFinite, Array, Object,
  });
  vm.runInContext(`var pendingInputByExercise = {}, pendingRpeByExercise = {}, pendingSetTypeByExercise = {},
    pendingUnilateralByExercise = {}, pendingVariantByExercise = {}, pendingHandleGripByExercise = {}, pendingSideByExercise = {},
    pendingAssistedRepsByExercise = {}, skippedPositionsByExercise = {}, dropContinuationByExercise = {},
    previousIndexByExercise = {}, extraSetsByExercise = {};
    function historicalIndexFor(exerciseName, position) {
      const map = previousIndexByExercise[exerciseName];
      return map && Object.prototype.hasOwnProperty.call(map, position) ? map[position] : position;
    }`, ctx);
  vm.runInContext(MANIP_HELPERS, ctx);
  vm.runInContext(JS("app-plates.js"), ctx);
  vm.runInContext(JS("app-warmup-ramp.js"), ctx);
  return { ctx, calls, get: (expr) => plain(vm.runInContext(expr, ctx)) };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const ramp = (ctx, w, bar) => plain(ctx.warmupRampSets(w, { bar }));
const kgs = (r) => r.map((s) => s.weight_kg);

test("barbell, 80 kg working: 40/60/80 percent rounded to 2.5, reps 5/3/2", () => {
  const { ctx } = load();
  assert.deepStrictEqual(ramp(ctx, 80, 20), [{ weight_kg: 32.5, reps: 5 }, { weight_kg: 47.5, reps: 3 }, { weight_kg: 65, reps: 2 }]);
});

test("barbell, 100 kg working", () => {
  assert.deepStrictEqual(kgs(ramp(load().ctx, 100, 20)), [40, 60, 80]);
});

test("barbell near the bar: never below the empty bar, always climbing, never at the working weight", () => {
  const { ctx } = load();
  assert.deepStrictEqual(kgs(ramp(ctx, 40, 20)), [20, 25, 32.5]);
  assert.deepStrictEqual(ramp(ctx, 25, 20), [{ weight_kg: 20, reps: 5 }]);
  assert.deepStrictEqual(ramp(ctx, 20, 20), []);
  assert.deepStrictEqual(ramp(ctx, 15, 20), []);
  [30, 45, 62.5, 90, 140, 200].forEach((w) => {
    const r = kgs(ramp(ctx, w, 20));
    r.forEach((kg, i) => { assert.ok(kg >= 20 && kg < w); if (i) assert.ok(kg > r[i - 1]); });
  });
});

test("not a barbell: a ramp from 30 kg up, none for light weights", () => {
  const { ctx } = load();
  assert.deepStrictEqual(kgs(ramp(ctx, 30, 0)), [12.5, 17.5, 25]);
  assert.deepStrictEqual(ramp(ctx, 29, 0), []);
  assert.deepStrictEqual(ramp(ctx, 12.5, 0), []);
});

test("not a number gives no ramp", () => {
  const { ctx } = load();
  ["", "abc", 0, -5, null, undefined].forEach((v) => assert.deepStrictEqual(ramp(ctx, v, 20), []));
});

test("working weight from history: heaviest non-warm-up set, or null", () => {
  assert.strictEqual(load({ previousSets: [{ weight_kg: 40, set_type: "warmup" }, { weight_kg: 80 }, { weight_kg: 77.5 }] }).ctx.warmupWorkingWeightFromHistory("X"), 80);
  assert.strictEqual(load().ctx.warmupWorkingWeightFromHistory("X"), null);
  assert.strictEqual(load({ previousSets: [{ weight_kg: null }] }).ctx.warmupWorkingWeightFromHistory("X"), null);
});

test("insertWarmupSets: three warm-ups in front of three planned sets; PREVIOUS keeps pointing at the right history", () => {
  const prev = [{ weight_kg: 80, reps: 8 }, { weight_kg: 80, reps: 8 }, { weight_kg: 77.5, reps: 8 }];
  const t = load({ previousSets: prev });
  // something typed earlier into the first planned row must move with it
  t.ctx.pendingInputByExercise = { X: { 0: { weight: "82.5", reps: "8" } } };
  const done = t.ctx.insertWarmupSets("X", [{ weight_kg: 32.5, reps: 5 }, { weight_kg: 47.5, reps: 3 }, { weight_kg: 65, reps: 2 }]);
  assert.strictEqual(done, true);
  assert.strictEqual(t.get("extraSetsByExercise.X"), 3); // total positions 3 + 3 = 6
  const input = t.get("pendingInputByExercise.X");
  assert.deepStrictEqual(input[0], { weight: "32.5", reps: "5" });
  assert.deepStrictEqual(input[2], { weight: "65", reps: "2" });
  assert.deepStrictEqual(input[3], { weight: "82.5", reps: "8" }); // the typed row moved down by three
  assert.deepStrictEqual(t.get("pendingSetTypeByExercise.X"), { 0: "warmup", 1: "warmup", 2: "warmup" });
  const hist = (p) => t.get(`historicalIndexFor("X", ${p})`);
  assert.deepStrictEqual([0, 1, 2].map(hist), [null, null, null]); // warm-ups have no previous numbers
  assert.deepStrictEqual([3, 4, 5].map(hist), [0, 1, 2]); // working sets still map to history 0, 1, 2
  assert.strictEqual(t.calls.persist, 1);
  assert.strictEqual(t.calls.render, 1);
});

test("insertWarmupSets with no history at all (one empty planned row)", () => {
  const t = load();
  t.ctx.insertWarmupSets("X", [{ weight_kg: 20, reps: 5 }, { weight_kg: 30, reps: 3 }]);
  assert.strictEqual(t.get("extraSetsByExercise.X"), 2);
  assert.deepStrictEqual(t.get("pendingSetTypeByExercise.X"), { 0: "warmup", 1: "warmup" });
  assert.strictEqual(t.get('historicalIndexFor("X", 2)'), 0);
});

test("insertWarmupSets refuses once a set is logged for that exercise, and for an empty list", () => {
  const t = load({ logged: [{ exercise_name: "X", set_order: 1 }] });
  assert.strictEqual(t.ctx.insertWarmupSets("X", [{ weight_kg: 20, reps: 5 }]), false);
  assert.strictEqual(t.calls.render, 0);
  assert.strictEqual(load().ctx.insertWarmupSets("X", []), false);
  // a different exercise's logged set does not block this one
  assert.strictEqual(load({ logged: [{ exercise_name: "Y", set_order: 1 }] }).ctx.insertWarmupSets("X", [{ weight_kg: 20, reps: 5 }]), true);
});

test("a second ramp-sized insert stays consistent with the mapping", () => {
  const prev = [{ weight_kg: 60, reps: 8 }, { weight_kg: 60, reps: 8 }];
  const t = load({ previousSets: prev });
  t.ctx.insertWarmupSets("X", [{ weight_kg: 20, reps: 5 }]); // 1 warm-up in front of 2
  assert.deepStrictEqual([0, 1, 2].map((p) => t.get(`historicalIndexFor("X", ${p})`)), [null, 0, 1]);
});

test("warmupPreviewText wording", () => {
  const { ctx } = load();
  assert.strictEqual(ctx.warmupPreviewText(80, 20), "32.5 kg × 5  →  47.5 kg × 3  →  65 kg × 2");
  assert.strictEqual(ctx.warmupPreviewText(20, 20), "No warm-up needed at this weight.");
  assert.strictEqual(ctx.warmupPreviewText("", 20), "Enter your working weight.");
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
}
console.log(`${passed}/${tests.length} passed`);
