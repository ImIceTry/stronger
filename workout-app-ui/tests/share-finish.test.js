// Regression test for public/js/app-share-finish.js.
// Run: node tests/share-finish.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-share-finish.js"), "utf8");

function load({ enabled = true, hasFooter = true, hasButton = false } = {}) {
  const shared = [];
  const footer = {
    inserted: [], firstChild: { marker: "primary" },
    querySelector: (sel) => (sel === "#finish-summary-share" && hasButton ? {} : null),
    insertBefore(node, ref) { this.inserted.push([node, ref]); },
  };
  const buttons = [];
  const ctx = vm.createContext({
    featureEnabled: (id) => enabled && id === "shareOnFinish",
    activeWorkout: { name: "Push", started_at: "2026-11-06 09:00:00", sets: [{ exercise_name: "Bench Press (Barbell)", set_order: 1 }] },
    modalContent: { querySelector: (sel) => (sel === ".modal-full-footer" && hasFooter ? footer : null) },
    document: { createElement: () => { const b = { listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } }; buttons.push(b); return b; } },
    buildWorkoutShareText: (w, units, volume) => `TEXT(${w.name}|${w.started_at}|${w.duration_sec}|${w.sets.length}|${JSON.stringify(units)}|${volume})`,
    shareWorkoutText: (title, text) => shared.push([title, text]),
  });
  vm.runInContext(SRC, ctx);
  return { ctx, footer, buttons, shared };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("feature off: no button", () => {
  const t = load({ enabled: false });
  t.ctx.addFinishShareButton(3600, {}, 1000);
  assert.strictEqual(t.buttons.length, 0);
  assert.strictEqual(t.footer.inserted.length, 0);
});

test("feature on: a secondary Share button goes in front of the primary button", () => {
  const t = load();
  t.ctx.addFinishShareButton(3600, {}, 1000);
  assert.strictEqual(t.footer.inserted.length, 1);
  const [node, ref] = t.footer.inserted[0];
  assert.strictEqual(node.id, "finish-summary-share");
  assert.strictEqual(node.textContent, "Share");
  assert.ok(node.className.includes("btn-secondary"));
  assert.strictEqual(ref.marker, "primary");
});

test("click shares the same text the saved-workout Share button builds, with this workout's data", () => {
  const t = load();
  t.ctx.addFinishShareButton(3600, { "Bench Press (Barbell)": "weight_reps" }, 1234);
  t.buttons[0].listeners.click();
  assert.deepStrictEqual(t.shared, [["Push", 'TEXT(Push|2026-11-06 09:00:00|3600|1|{"Bench Press (Barbell)":"weight_reps"}|1234)']]);
});

test("no footer, or a button already there: nothing happens, no error", () => {
  const a = load({ hasFooter: false });
  a.ctx.addFinishShareButton(1, {}, 1);
  assert.strictEqual(a.buttons.length, 0);
  const b = load({ hasButton: true });
  b.ctx.addFinishShareButton(1, {}, 1);
  assert.strictEqual(b.buttons.length, 0);
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
}
console.log(`${passed}/${tests.length} passed`);
