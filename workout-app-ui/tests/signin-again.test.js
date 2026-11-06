// Regression test for public/js/app-signin-again.js and its hook in
// app-native-http.js: a login redirect from Cloudflare Access must be told
// apart from being offline, the banner must show once, and a failed request
// must still fail the way it did before.
// Run: node tests/signin-again.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const JS = (f) => fs.readFileSync(path.join(__dirname, "..", "public", "js", f), "utf8");

function el() {
  const e = { children: [], listeners: {}, attrs: {}, innerHTML: "", id: "", className: "", height: 57.8 };
  e.getBoundingClientRect = () => ({ height: e.height });
  e.setAttribute = (k, v) => { e.attrs[k] = v; };
  e.appendChild = (c) => { e.children.push(c); return c; };
  e.addEventListener = (type, fn) => { e.listeners[type] = fn; };
  e.querySelector = () => e; // the banner has one button
  return e;
}

// responder(url, init) returns a Response-like or throws; now() is the fake clock
function load(responder) {
  const state = { fetches: [], reloads: 0, t: 1_000_000, windowListeners: {}, rootStyle: {} };
  const body = el();
  body.classList = { added: [], add(c) { this.added.push(c); } };
  const ctx = vm.createContext({
    API_BASE: "https://app.example",
    window: { addEventListener: (type, fn) => { state.windowListeners[type] = fn; } }, // native HTTP stays off: apiFetch is the plain fetch path
    document: { createElement: () => el(), body, documentElement: { style: { setProperty: (k, v) => { state.rootStyle[k] = v; } } } },
    location: { reload: () => { state.reloads++; } },
    Date: { now: () => state.t },
    fetch: async (url, init) => { state.fetches.push({ url, init }); return responder(url, init); },
    console, Promise, Object, String, Error,
  });
  vm.runInContext(JS("app-native-http.js"), ctx);
  vm.runInContext(JS("app-signin-again.js"), ctx);
  return { ctx, state, body };
}

const tick = () => new Promise((r) => setImmediate(r));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("accessLoginRequired: opaqueredirect is a login, anything else is not", async () => {
  assert.strictEqual(await load(() => ({ type: "opaqueredirect", status: 0 })).ctx.accessLoginRequired(), true);
  assert.strictEqual(await load(() => ({ type: "basic", status: 200 })).ctx.accessLoginRequired(), false);
  assert.strictEqual(await load(() => ({ type: "basic", status: 500 })).ctx.accessLoginRequired(), false);
});

test("accessLoginRequired: really offline (fetch throws) is not a login problem", async () => {
  const t = load(() => { throw new TypeError("Failed to fetch"); });
  assert.strictEqual(await t.ctx.accessLoginRequired(), false);
});

test("the check asks /api/health with redirect manual and no cache", async () => {
  const t = load(() => ({ type: "basic" }));
  await t.ctx.accessLoginRequired();
  assert.strictEqual(t.state.fetches[0].url, "https://app.example/api/health");
  assert.strictEqual(t.state.fetches[0].init.redirect, "manual");
  assert.strictEqual(t.state.fetches[0].init.cache, "no-store");
});

test("checkAccessSession: login redirect -> one banner with a Sign in button that reloads", async () => {
  const t = load(() => ({ type: "opaqueredirect" }));
  await t.ctx.checkAccessSession();
  assert.strictEqual(t.body.children.length, 1);
  const banner = t.body.children[0];
  assert.strictEqual(banner.id, "signin-again-banner");
  assert.strictEqual(banner.attrs.role, "alert");
  assert.ok(banner.innerHTML.includes("Your login has ended"));
  assert.ok(banner.innerHTML.includes("workout in progress stays saved"));
  // it pushes the page down by its own height instead of covering the top bar
  assert.ok(t.body.classList.added.includes("signin-banner-on"));
  assert.strictEqual(t.state.rootStyle["--signin-banner-h"], "58px"); // 57.8 rounded up
  banner.height = 79.2; // e.g. after a rotation the text wraps differently
  t.state.windowListeners.resize();
  assert.strictEqual(t.state.rootStyle["--signin-banner-h"], "80px");
  banner.listeners.click();
  assert.strictEqual(t.state.reloads, 1);
  // once shown, no further checks and no second banner
  t.state.t += 60_000;
  await t.ctx.checkAccessSession();
  assert.strictEqual(t.body.children.length, 1);
  assert.strictEqual(t.state.fetches.length, 1);
});

test("checkAccessSession: not a login -> no banner, and at most one check per 20 seconds", async () => {
  const t = load(() => ({ type: "basic" }));
  await t.ctx.checkAccessSession();
  await t.ctx.checkAccessSession();
  assert.strictEqual(t.state.fetches.length, 1);
  assert.strictEqual(t.body.children.length, 0);
  t.state.t += 20_001;
  await t.ctx.checkAccessSession();
  assert.strictEqual(t.state.fetches.length, 2);
});

test("apiFetch (plain path): a failed request still throws the same error and triggers one check", async () => {
  const t = load((url) => {
    if (url.endsWith("/api/health")) return { type: "opaqueredirect" };
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(() => t.ctx.apiFetch("/api/workouts"), /Failed to fetch/);
  await tick();
  assert.strictEqual(t.body.children.length, 1); // the failed call led to the banner
  assert.strictEqual(t.state.fetches.filter((f) => f.url.endsWith("/api/health")).length, 1);
});

test("apiFetch (plain path): a successful request does not check anything", async () => {
  const t = load(() => ({ ok: true, status: 200, type: "basic" }));
  const res = await t.ctx.apiFetch("/api/workouts");
  assert.strictEqual(res.ok, true);
  await tick();
  assert.strictEqual(t.state.fetches.length, 1);
  assert.strictEqual(t.body.children.length, 0);
});

test("apiFetch (plain path): offline failure -> same error, no banner", async () => {
  const t = load(() => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(() => t.ctx.apiFetch("/api/workouts"), /Failed to fetch/);
  await tick();
  assert.strictEqual(t.body.children.length, 0);
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
  }
  console.log(`${passed}/${tests.length} passed`);
})();
