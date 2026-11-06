// Regression test for public/js/app-plates.js (plain script loaded into a vm
// context the way the browser loads it).
// Run: node tests/plates.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-plates.js"), "utf8");
const plain = (x) => JSON.parse(JSON.stringify(x));

function load({ enabled = true, stored = null } = {}) {
  const store = {};
  if (stored != null) store.plateSettings = stored;
  const panelEl = { textContent: "" };
  const ctx = vm.createContext({
    featureEnabled: (id) => enabled && id === "plateCalculator",
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    dockedPanel: { querySelector: (sel) => (sel === "[data-plates-line]" ? panelEl : null) },
    JSON, Math, Number, String, Set, parseFloat, isFinite, Array,
  });
  vm.runInContext(SRC, ctx);
  return { ctx, store, panelEl };
}

const STD = [25, 20, 15, 10, 5, 2.5, 1.25];
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("computePlates: common loads on a 20 kg bar", () => {
  const { ctx } = load();
  const per = (t) => plain(ctx.computePlates(t, 20, STD));
  assert.deepStrictEqual(per(60).perSide, [20]);
  assert.deepStrictEqual(per(100).perSide, [25, 15]);
  assert.deepStrictEqual(per(62.5).perSide, [20, 1.25]);
  assert.deepStrictEqual(per(142.5).perSide, [25, 25, 10, 1.25]);
  assert.strictEqual(per(100).total, 100);
  assert.strictEqual(per(100).exact, true);
});

test("computePlates: the empty bar, lighter than the bar, and a weight the plates cannot make", () => {
  const { ctx } = load();
  assert.deepStrictEqual(plain(ctx.computePlates(20, 20, STD)), { perSide: [], total: 20, exact: true, leftPerSide: 0 });
  assert.strictEqual(ctx.computePlates(15, 20, STD).under, true);
  const r = plain(ctx.computePlates(21, 20, STD)); // 0.5 per side is smaller than the smallest plate
  assert.deepStrictEqual(r.perSide, []);
  assert.strictEqual(r.exact, false);
  assert.strictEqual(r.leftPerSide, 0.5);
  const r2 = plain(ctx.computePlates(63, 20, STD)); // 21.5 per side: 20 + 1.25, 0.25 left
  assert.deepStrictEqual(r2.perSide, [20, 1.25]);
  assert.strictEqual(r2.total, 62.5);
  assert.strictEqual(r2.exact, false);
});

test("computePlates: not a positive number gives null; plate order does not matter", () => {
  const { ctx } = load();
  ["", "abc", 0, -5, null, undefined].forEach((v) => assert.strictEqual(ctx.computePlates(v, 20, STD), null));
  assert.deepStrictEqual(plain(ctx.computePlates(60, 20, [1.25, 20, 5])).perSide, [20]);
});

test("describePlates wording", () => {
  const { ctx } = load();
  const d = (t, bar = 20, plates = STD) => ctx.describePlates(t, bar, plates);
  assert.strictEqual(d(60), "Per side: 20");
  assert.strictEqual(d(142.5), "Per side: 2×25 + 10 + 1.25");
  assert.strictEqual(d(20), "Bar only");
  assert.strictEqual(d(15), "Lighter than the bar (20 kg)");
  assert.strictEqual(d(63), "Per side: 20 + 1.25 (loads 62.5 kg)");
  assert.strictEqual(d(21), "Bar only (0.5 per side short)");
  assert.strictEqual(d(""), "");
  assert.strictEqual(d("45", 15, STD), "Per side: 15");
});

test("parsePlateList: separators, junk, duplicates, order", () => {
  const { ctx } = load();
  assert.deepStrictEqual(plain(ctx.parsePlateList("25, 20 10;5 2.5 2.5 abc -3 0 1000")), [25, 20, 10, 5, 2.5]);
  assert.deepStrictEqual(plain(ctx.parsePlateList("")), []);
  assert.deepStrictEqual(plain(ctx.parsePlateList("1.25 2.5 5")), [5, 2.5, 1.25]);
});

test("settings: defaults, a saved value, and a broken value falling back", () => {
  let t = load();
  assert.deepStrictEqual(plain(t.ctx.loadPlateSettings()), { bar: 20, plates: STD });
  t.ctx.savePlateSettings({ bar: 15, plates: [20, 10] });
  assert.deepStrictEqual(plain(t.ctx.loadPlateSettings()), { bar: 15, plates: [20, 10] });
  t = load({ stored: "{not json" });
  assert.strictEqual(t.ctx.loadPlateSettings().bar, 20);
  t = load({ stored: JSON.stringify({ bar: 500, plates: [20] }) });
  assert.strictEqual(t.ctx.loadPlateSettings().bar, 20);
  t = load({ stored: JSON.stringify({ bar: 20, plates: [] }) });
  assert.deepStrictEqual(plain(t.ctx.loadPlateSettings().plates), STD);
});

test("platesLineHtml only for the weight field of a barbell exercise with the feature on", () => {
  const w = { key: "weight" };
  assert.ok(load().ctx.platesLineHtml("Bench Press (Barbell)", w).includes("data-plates-line"));
  assert.ok(load().ctx.platesLineHtml("barbell curl", w).includes("data-plates-line"));
  assert.strictEqual(load().ctx.platesLineHtml("Bench Press (Barbell)", { key: "reps" }), "");
  assert.strictEqual(load().ctx.platesLineHtml("Lat Pulldown (Cable)", w), "");
  assert.strictEqual(load().ctx.platesLineHtml("Overhead Press (Dumbbell)", w), "");
  assert.strictEqual(load({ enabled: false }).ctx.platesLineHtml("Bench Press (Barbell)", w), "");
  assert.strictEqual(load().ctx.platesLineHtml("Bench Press (Barbell)", null), "");
});

test("updatePlatesLine writes into the panel using the saved bar and plates", () => {
  const t = load({ stored: JSON.stringify({ bar: 15, plates: [20, 10, 5] }) });
  t.ctx.updatePlatesLine({ key: "weight" }, "75");
  assert.strictEqual(t.panelEl.textContent, "Per side: 20 + 10");
  t.ctx.updatePlatesLine({ key: "weight" }, "");
  assert.strictEqual(t.panelEl.textContent, "");
});

test("settings row is empty when the feature is off and lists bar and plates when on", () => {
  assert.strictEqual(load({ enabled: false }).ctx.plateSettingsRowHtml(), "");
  const html = load().ctx.plateSettingsRowHtml();
  assert.ok(html.includes('id="plate-settings-row"') && html.includes("Bar 20 kg") && html.includes("25, 20, 15, 10, 5, 2.5, 1.25"));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
}
console.log(`${passed}/${tests.length} passed`);
