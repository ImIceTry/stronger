// Regression test for public/js/app-exercise-search.js (plain script, no module
// system, so it is loaded into a vm context the way the browser loads it).
// Run: node tests/exercise-search.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ctx = vm.createContext({ allExercisesCache: null, apiGet: async () => ({ exercises: [] }) });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-exercise-search.js"), "utf8"), ctx);
const { rankExercises, withinOneEdit, normalizeExerciseText } = ctx;

const daysAgo = (n) => {
  const d = new Date(Date.now() - n * 86400000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
};
const ex = (name, times = 0, last = null) => ({ name, times_performed: times, last_performed: last ? daysAgo(last) : null });
const LIST = [
  ex("Cable Crunch", 1, 40),
  ex("Crunch (Machine)", 3, 2),
  ex("Crunch Twist", 1, 12),
  ex("Sit Up", 1, 40),
  ex("Bench Press (Barbell)", 5, 5),
  ex("Overhead Press (Dumbbell)", 2, 5),
  ex("Press Up"),
  ex("Dumbbell Bench Press"),
  ex("Squat (Barbell)", 5, 2),
  ex("Leg Extension (Machine)", 2, 2),
  ex("Triceps Pushdown (Cable)", 2, 5),
  ex("Hanging Leg Raise"),
  ex("Calf Raise (Machine)", 1, 9),
];
// Arrays made inside the vm context have a different prototype, so
// deepStrictEqual would call identical contents "not equal" -- copy them out.
const names = (q, limit) => Array.from(rankExercises(q, LIST, limit), (e) => e.name);

let passed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log("ok  - " + label); }
  catch (err) { console.error("FAIL- " + label + "\n      " + err.message); process.exitCode = 1; }
}

test("'crunches' (plural) finds Crunch (Machine) first, then the other crunches", () => {
  assert.deepStrictEqual(names("crunches"), ["Crunch (Machine)", "Crunch Twist", "Cable Crunch"]);
});
test("'crunch mac' (no parenthesis, partial word) finds Crunch (Machine) alone", () => {
  assert.deepStrictEqual(names("crunch mac"), ["Crunch (Machine)"]);
});
test("'crunch machine' and 'machine crunch' (any order) find it", () => {
  assert.strictEqual(names("crunch machine")[0], "Crunch (Machine)");
  assert.strictEqual(names("machine crunch")[0], "Crunch (Machine)");
});
test("ranking inside a match puts recent/frequent first, not alphabetical", () => {
  // alphabetical would start with Cable Crunch
  assert.deepStrictEqual(names("crunch"), ["Crunch (Machine)", "Crunch Twist", "Cable Crunch"]);
});
test("a done-often word match beats a never-done name that merely starts with the word", () => {
  const r = names("press");
  assert.ok(r.indexOf("Bench Press (Barbell)") < r.indexOf("Press Up"), r.join(" | "));
  assert.ok(r.indexOf("Overhead Press (Dumbbell)") < r.indexOf("Press Up"), r.join(" | "));
});
test("old substring behavior kept: 'ench' still finds Bench Press", () => {
  assert.ok(names("ench").includes("Bench Press (Barbell)"));
});
test("exact name (any case/punctuation) comes first", () => {
  assert.strictEqual(names("CRUNCH (machine)")[0], "Crunch (Machine)");
  assert.strictEqual(names("sit up")[0], "Sit Up");
});
test("typo fallback: swapped/missing letters still find the exercise", () => {
  assert.strictEqual(names("curnch")[0], "Crunch (Machine)");
  assert.strictEqual(names("benhc")[0], "Bench Press (Barbell)");
  assert.strictEqual(names("squt")[0], "Squat (Barbell)");
});
test("typo fallback is not used when a normal match exists", () => {
  assert.ok(!names("crunch").includes("Squat (Barbell)"));
  assert.deepStrictEqual(names("calf"), ["Calf Raise (Machine)"]);
});
test("a completely different word finds nothing (no wild guesses)", () => {
  assert.deepStrictEqual(names("zzzz"), []);
  assert.deepStrictEqual(names("treadmill"), []);
  assert.deepStrictEqual(names("sot"), []); // 3 letters: too short for typo matching
});
test("empty query returns only exercises you have done, most worth showing first", () => {
  const r = names("", 8);
  assert.ok(r.length > 0 && r.length <= 8);
  assert.ok(!r.includes("Press Up") && !r.includes("Hanging Leg Raise") && !r.includes("Dumbbell Bench Press"));
  const all = names("", 20); // Sit Up (once, 40 days ago) ranks below everything recent
  assert.ok(all.indexOf("Squat (Barbell)") < all.indexOf("Sit Up"), all.join(" | "));
});
test("limit is respected", () => {
  assert.strictEqual(rankExercises("e", LIST, 3).length, 3);
});
test("withinOneEdit", () => {
  assert.ok(withinOneEdit("crunch", "curnch"));
  assert.ok(withinOneEdit("crunch", "crunchh"));
  assert.ok(withinOneEdit("crunch", "crnch"));
  assert.ok(withinOneEdit("abc", "abd"));
  assert.ok(!withinOneEdit("crunch", "crunk"));
  assert.ok(!withinOneEdit("abc", "bcd"));
});
test("normalize strips punctuation, case and accents", () => {
  assert.strictEqual(normalizeExerciseText("  Crunch (Machine)! "), "crunch machine");
  assert.strictEqual(normalizeExerciseText("Pull-Up"), "pull up");
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
