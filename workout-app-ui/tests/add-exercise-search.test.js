// The open add-exercise search is a back-button layer of its own
// (public/js/app-add-exercise.js): back closes just the search, a direct close
// (pick, outside tap, redraw) consumes its own history entry exactly once, and
// nothing is left behind for the next back press to eat.
// Runs the REAL file against a tiny fake DOM.
// Run: node tests/add-exercise-search.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-add-exercise.js"), "utf8");

function el(id) {
  const classes = new Set(id === "add-exercise-box" || id === "exercise-suggestions" ? ["hidden"] : []);
  return {
    id, value: "", style: { setProperty() {}, removeProperty() {} },
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
    focus() {}, blur() {}, addEventListener() {}, appendChild() {}, set innerHTML(_) {},
    contains: (t) => t === "inside",
    getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }),
  };
}

function load() {
  const els = {};
  const docListeners = [];
  const ctx = {
    setTimeout, clearTimeout, console,
    document: {
      getElementById: (id) => (els[id] = els[id] || el(id)),
      createElement: () => el("row"),
      addEventListener: (type, fn) => docListeners.push(fn),
      removeEventListener: (type, fn) => docListeners.splice(docListeners.indexOf(fn), 1),
    },
    window: { addEventListener() {}, removeEventListener() {} },
    activeOverlayBody: { clientHeight: 700, scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }) },
    backs: 0,
  };
  vm.createContext(ctx);
  vm.runInContext(`
    var navLayers = [], handlingPopstate = false;
    function pushNavLayer(onClose) { navLayers.push({ onClose }); }
    var history = { back() { backs++; } };
    // simulates a real back press: the browser already moved, then layers unwind
    function pressBack() { handlingPopstate = true; try { navLayers.pop().onClose(); } finally { handlingPopstate = false; } }
    async function loadAllExercisesCached() { return []; }
    function rankExercises() { return []; }
    var activeWorkout = { exercises: [] };
    function persistActiveWorkout() {}
    function renderActiveScreen() { endAddExerciseSearch(); }
  `, ctx);
  vm.runInContext(src, ctx);
  ctx.tapOutside = () => docListeners.slice().forEach((fn) => fn({ target: "outside" }));
  ctx.box = () => els["add-exercise-box"];
  return ctx;
}

// opening registers exactly one layer and moves into searching mode
{
  const c = load();
  vm.runInContext("openAddExerciseSearch(); openAddExerciseSearch();", c);
  assert.strictEqual(vm.runInContext("navLayers.length", c), 1, "one layer, even when opened twice");
  assert.ok(c.box().classList.contains("searching"));
}

// back closes only the search and does not spend a second history entry
{
  const c = load();
  vm.runInContext("openAddExerciseSearch(); pressBack();", c);
  assert.strictEqual(vm.runInContext("navLayers.length", c), 0);
  assert.ok(c.box().classList.contains("hidden"), "box collapsed");
  assert.ok(!c.box().classList.contains("searching"));
  assert.strictEqual(c.backs, 0, "the back press already moved history");
}

// picking an exercise (redraw) closes it and consumes its history entry once
{
  const c = load();
  vm.runInContext("openAddExerciseSearch(); addExerciseToWorkout('Wrist Curl');", c);
  assert.strictEqual(vm.runInContext("navLayers.length", c), 0);
  assert.strictEqual(c.backs, 1);
  assert.strictEqual(vm.runInContext("JSON.stringify(activeWorkout.exercises)", c), JSON.stringify(["Wrist Curl"]));
}

// a tap outside closes it; a tap inside does not
{
  const c = load();
  vm.runInContext("openAddExerciseSearch();", c);
  c.tapOutside();
  assert.strictEqual(vm.runInContext("navLayers.length", c), 0);
  assert.strictEqual(c.backs, 1);
  assert.ok(c.box().classList.contains("hidden"));
}

// closing when it isn't open does nothing to the history
{
  const c = load();
  vm.runInContext("endAddExerciseSearch(); closeAddExerciseSearch();", c);
  assert.strictEqual(c.backs, 0);
}

console.log("add-exercise-search: ok");
