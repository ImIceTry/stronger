// Regression test for logicalSetNumber (public/js/app-set-manipulation.js).
// Runs against the app's REAL helpers (the part of the file before
// toggleSetType). Swiped-away pending sets keep their slot but no longer
// render, so they must not count: delete an added 4th set, add another, and
// the new row has to read 4, not 5.
// Run: node tests/set-numbering.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-set-manipulation.js"), "utf8");
const helpers = src.slice(0, src.indexOf("function toggleSetType"));
assert.ok(helpers.includes("function logicalSetNumber"));

function load({ skipped = [], drops = {} } = {}) {
  const ctx = vm.createContext({ Object, Set, parseInt });
  vm.runInContext(`var dropContinuationByExercise = {}, skippedPositionsByExercise = {}`, ctx);
  vm.runInContext(helpers, ctx);
  ctx.dropContinuationByExercise.Squat = drops;
  ctx.skippedPositionsByExercise.Squat = new Set(skipped);
  return (position) => vm.runInContext(`logicalSetNumber("Squat", ${position})`, ctx);
}

// plain sets are numbered by position
{
  const n = load();
  assert.deepStrictEqual([0, 1, 2, 3].map(n), [1, 2, 3, 4]);
}

// the 4th set (position 3) was added and swiped away, then another was added
// at position 4: it is the 4th visible set
{
  const n = load({ skipped: [3] });
  assert.strictEqual(n(4), 4, "the set added after a deleted one takes its number");
  assert.deepStrictEqual([0, 1, 2].map(n), [1, 2, 3]);
}

// a deleted set in the middle: the rows after it close the gap
{
  const n = load({ skipped: [1] });
  assert.deepStrictEqual([0, 2, 3].map(n), [1, 2, 3]);
}

// a skipped position never hides itself: asked for its own number it still counts
{
  const n = load({ skipped: [2] });
  assert.strictEqual(n(2), 3);
}

// a drop pair is one set logged in two parts: both rows show the same number,
// and a deleted set before the pair is not counted
{
  const n = load({ drops: { 2: 3 }, skipped: [1] });
  assert.deepStrictEqual([0, 2, 3, 4].map(n), [1, 2, 2, 3]);
}

console.log("set-numbering: ok");
