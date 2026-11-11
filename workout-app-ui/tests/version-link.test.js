// Regression test for public/js/app-version-link.js.
// Run: node tests/version-link.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-version-link.js"), "utf8");
const FEATURES = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-features.js"), "utf8");

function load({ enabled = true, config, native = false, noElement = false } = {}) {
  const opened = [];
  const attrs = {};
  const classes = new Set();
  const el = {
    listeners: {},
    addEventListener(t, f) { this.listeners[t] = f; },
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
  };
  const win = {
    APP_CONFIG: config,
    open: (...a) => opened.push(["open", ...a]),
    location: { set href(v) { opened.push(["href", v]); } },
  };
  if (native) win.Capacitor = { isNativePlatform: () => true };
  const state = { enabled };
  const ctx = vm.createContext({
    window: win,
    document: { getElementById: (id) => (id === "app-version" && !noElement ? el : null) },
    featureEnabled: (id) => state.enabled && id === "versionLink",
  });
  vm.runInContext(SRC, ctx);
  return { ctx, el, opened, attrs, classes, state };
}

const tests = [];
const test = (n, f) => tests.push([n, f]);
const DEFAULT = "https://github.com/ImIceTry/stronger/tags";

test("switch on, browser: the click opens the default page in a new tab", () => {
  const t = load();
  t.el.listeners.click();
  assert.deepStrictEqual(t.opened, [["open", DEFAULT, "_blank", "noopener"]]);
});

test("switch off: the click does nothing and the version is not styled as a link", () => {
  const t = load({ enabled: false });
  t.el.listeners.click();
  assert.deepStrictEqual(t.opened, []);
  assert.ok(!t.classes.has("is-link"));
  assert.strictEqual(t.attrs.role, undefined);
});

test("switch on: the version looks like a link; turning it off removes that", () => {
  const t = load();
  assert.ok(t.classes.has("is-link"));
  assert.strictEqual(t.attrs.role, "link");
  t.state.enabled = false;
  t.ctx.refreshVersionLink();
  assert.ok(!t.classes.has("is-link"));
  assert.strictEqual(t.attrs.role, undefined);
});

test("own https address from the config wins", () => {
  const t = load({ config: { updateUrl: " https://example.org/apk/ " } });
  t.el.listeners.click();
  assert.strictEqual(t.opened[0][1], "https://example.org/apk/");
});

test("a config address that is not https (or empty, or not text) falls back to the default", () => {
  for (const bad of ["http://example.org/apk/", "javascript:alert(1)", "", "   ", 5, null, "https://has space.org/x y"]) {
    const t = load({ config: { updateUrl: bad } });
    t.el.listeners.click();
    assert.strictEqual(t.opened[0][1], DEFAULT, String(bad));
  }
});

test("native app: the address is handed to the shell by navigating, not by window.open", () => {
  const t = load({ native: true, config: { updateUrl: "https://example.org/apk/" } });
  t.el.listeners.click();
  assert.deepStrictEqual(t.opened, [["href", "https://example.org/apk/"]]);
});

test("no version element on the page: loading does not throw", () => {
  load({ noElement: true });
});

test("the feature is registered, off by default, with where-text", () => {
  const stub = () => ({ addEventListener() {}, classList: { toggle() {} } });
  const ctx = vm.createContext({ localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: stub, querySelector: stub, addEventListener() {} } });
  vm.runInContext(FEATURES + "\nthis.__f = FEATURE_BY_ID.versionLink; this.__g = FEATURE_GROUPS.map(g => g.id);", ctx);
  assert.ok(ctx.__f && ctx.__f.defaultOff === true && ctx.__f.where);
  assert.ok(ctx.__g.includes(ctx.__f.group));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
}
console.log(`${passed}/${tests.length} passed`);
