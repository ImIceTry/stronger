// Regression test for public/js/app-native-http.js (plain script, no module
// system, so it is loaded into a vm context the way the browser loads it; the
// Capacitor plugin and fetch are mocks).
// Run: node tests/native-http.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-native-http.js"), "utf8");
const PRIMARY = "https://primary.example";
const FALLBACK = "https://fallback.example";
const HEADERS = { "CF-Access-Client-Id": "id-1", "CF-Access-Client-Secret": "secret-1" };
const plain = (x) => JSON.parse(JSON.stringify(x));
const json = (data, status = 200) => ({ status, headers: { "Content-Type": "application/json" }, data });

// opts: { config, native, plugin: false (missing) | function request(req, n) }
function load({ config, native = true, plugin }) {
  const calls = { fetch: [], plugin: [] };
  const warns = [];
  const win = { APP_CONFIG: config };
  if (native) {
    win.Capacitor = {
      isNativePlatform: () => true,
      Plugins: plugin === false ? {} : {
        CapacitorHttp: { request: async (req) => { calls.plugin.push(req); return plugin(req, calls.plugin.length); } },
      },
    };
  }
  const ctx = vm.createContext({
    window: win, API_BASE: PRIMARY, console: { warn: (m) => warns.push(m) },
    fetch: async (url, opts) => { calls.fetch.push({ url, opts }); return { ok: true, status: 200, via: "fetch" }; },
    atob, Blob, Uint8Array, String, JSON,
  });
  vm.runInContext(SRC, ctx);
  return { ctx, calls, warns, enabled: vm.runInContext("NATIVE_HTTP.enabled", ctx) };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const FULL = { accessHeaders: HEADERS, nativeApiBaseFallback: FALLBACK };

test("not native: plain fetch to API_BASE + path, the plugin is never used", async () => {
  const t = load({ config: FULL, native: false });
  assert.strictEqual(t.enabled, false);
  const res = await t.ctx.apiFetch("/api/x", { timeoutMs: 1 });
  assert.strictEqual(res.via, "fetch");
  assert.strictEqual(t.calls.fetch[0].url, PRIMARY + "/api/x");
});

test("native but nothing configured: behaviour unchanged, plain fetch", async () => {
  const t = load({ config: {}, plugin: async () => json({}) });
  assert.strictEqual(t.enabled, false);
  await t.ctx.apiFetch("/api/x");
  assert.strictEqual(t.calls.plugin.length, 0);
  assert.strictEqual(t.calls.fetch.length, 1);
});

test("native, configured, plugin missing: warns and falls back to plain fetch", async () => {
  const t = load({ config: FULL, plugin: false });
  assert.strictEqual(t.enabled, false);
  assert.strictEqual(t.warns.length, 1);
  await t.ctx.apiFetch("/api/x");
  assert.strictEqual(t.calls.fetch.length, 1);
});

test("GET: native request to the primary with the Access headers, timeouts, no redirects", async () => {
  const t = load({ config: FULL, plugin: async () => json({ ok: 1 }) });
  const res = await t.ctx.apiFetch("/api/x", { timeoutMs: 4000, headers: { Accept: "application/json" } });
  assert.strictEqual(t.calls.plugin.length, 1);
  const req = plain(t.calls.plugin[0]);
  assert.strictEqual(req.url, PRIMARY + "/api/x");
  assert.strictEqual(req.method, "GET");
  assert.deepStrictEqual(req.headers, Object.assign({ Accept: "application/json" }, HEADERS));
  assert.strictEqual(req.connectTimeout, 4000);
  assert.strictEqual(req.readTimeout, 4000);
  assert.strictEqual(req.disableRedirects, true);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(plain(await res.json()), { ok: 1 });
});

test("default timeout is 15 s when the caller gives none", async () => {
  const t = load({ config: FULL, plugin: async () => json({}) });
  await t.ctx.apiFetch("/api/x");
  assert.strictEqual(t.calls.plugin[0].readTimeout, 15000);
});

test("POST: the JSON string body reaches the plugin as parsed data", async () => {
  const t = load({ config: FULL, plugin: async () => json({ id: 7 }) });
  await t.ctx.apiFetch("/api/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: 1 }) });
  const req = plain(t.calls.plugin[0]);
  assert.strictEqual(req.method, "POST");
  assert.deepStrictEqual(req.data, { a: 1 });
  assert.strictEqual(req.headers["Content-Type"], "application/json");
});

test("GET: primary throws -> fallback, and the Access headers are NOT sent to the fallback", async () => {
  const t = load({ config: FULL, plugin: async (req, n) => { if (n === 1) throw new Error("connect failed"); return json({ from: "fallback" }); } });
  const res = await t.ctx.apiFetch("/api/x");
  assert.strictEqual(t.calls.plugin.length, 2);
  assert.strictEqual(t.calls.plugin[1].url, FALLBACK + "/api/x");
  assert.deepStrictEqual(plain(t.calls.plugin[1].headers), {});
  assert.deepStrictEqual(plain(await res.json()), { from: "fallback" });
});

test("POST (not idempotent): primary throws -> rethrown, never repeated against the fallback", async () => {
  const t = load({ config: FULL, plugin: async () => { throw new Error("read timed out"); } });
  await assert.rejects(() => t.ctx.apiFetch("/api/x", { method: "POST", body: "{}" }), /read timed out/);
  assert.strictEqual(t.calls.plugin.length, 1);
});

test("POST marked idempotent: primary throws -> fallback is tried", async () => {
  const t = load({ config: FULL, plugin: async (req, n) => { if (n === 1) throw new Error("x"); return json({ ok: 1 }); } });
  const res = await t.ctx.apiFetch("/api/x", { method: "POST", body: "{}", idempotent: true });
  assert.strictEqual(t.calls.plugin.length, 2);
  assert.strictEqual(res.ok, true);
});

test("POST (not idempotent) blocked by Access (302): never reached the server, so the fallback is used", async () => {
  const t = load({ config: FULL, plugin: async (req, n) => (n === 1 ? { status: 302, headers: { Location: "https://team.example/login" }, data: "" } : json({ ok: 1 })) });
  const res = await t.ctx.apiFetch("/api/x", { method: "POST", body: "{}" });
  assert.strictEqual(t.calls.plugin.length, 2);
  assert.strictEqual(t.calls.plugin[1].url, FALLBACK + "/api/x");
  assert.strictEqual(res.ok, true);
});

test("an HTML page with status 200 (login page) counts as blocked", async () => {
  const t = load({ config: FULL, plugin: async (req, n) => (n === 1 ? { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, data: "<html>" } : json({ ok: 1 })) });
  const res = await t.ctx.apiFetch("/api/x");
  assert.strictEqual(t.calls.plugin.length, 2);
  assert.deepStrictEqual(plain(await res.json()), { ok: 1 });
});

test("the last base's answer is returned as is, even a 502 HTML page (no exception, ok false)", async () => {
  const html = { status: 502, headers: { "Content-Type": "text/html" }, data: "<html>bad gateway" };
  const t = load({ config: FULL, plugin: async () => html });
  const res = await t.ctx.apiFetch("/api/x");
  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.ok, false);
});

test("both bases throw: the last error surfaces", async () => {
  const t = load({ config: FULL, plugin: async (req, n) => { throw new Error("fail " + n); } });
  await assert.rejects(() => t.ctx.apiFetch("/api/x"), /fail 2/);
});

test("only headers configured (no fallback): one attempt, a thrown error is rethrown", async () => {
  const t = load({ config: { accessHeaders: HEADERS }, plugin: async () => { throw new Error("down"); } });
  assert.strictEqual(t.enabled, true);
  await assert.rejects(() => t.ctx.apiFetch("/api/x"), /down/);
  assert.strictEqual(t.calls.plugin.length, 1);
});

test("real HTTP errors pass through as responses (404 is ok:false, not an exception)", async () => {
  const t = load({ config: FULL, plugin: async () => json({ error: "nope" }, 404) });
  const res = await t.ctx.apiFetch("/api/x", { method: "DELETE" });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 404);
  assert.deepStrictEqual(plain(await res.json()), { error: "nope" });
});

test("a string JSON body from the plugin is parsed by json()", async () => {
  const t = load({ config: FULL, plugin: async () => json('{"a":2}') });
  const res = await t.ctx.apiFetch("/api/x");
  assert.deepStrictEqual(plain(await res.json()), { a: 2 });
});

test("urlFetch under the primary base: native, with the Access headers, blob() decodes base64", async () => {
  const t = load({ config: FULL, plugin: async () => ({ status: 200, headers: { "Content-Type": "image/png" }, data: "AQID" }) });
  const res = await t.ctx.urlFetch(PRIMARY + "/snapshots/a.png", { responseType: "blob", timeoutMs: 4000 });
  const req = plain(t.calls.plugin[0]);
  assert.strictEqual(req.url, PRIMARY + "/snapshots/a.png");
  assert.strictEqual(req.responseType, "blob");
  assert.deepStrictEqual(req.headers, HEADERS);
  const blob = await res.blob();
  assert.strictEqual(blob.type, "image/png");
  assert.deepStrictEqual(Array.from(new Uint8Array(await blob.arrayBuffer())), [1, 2, 3]);
});

test("urlFetch outside the primary base (e.g. an old VPN snapshot URL): plain fetch, no headers", async () => {
  const t = load({ config: FULL, plugin: async () => json({}) });
  await t.ctx.urlFetch("https://elsewhere.example/snapshots/a.png", { responseType: "blob" });
  assert.strictEqual(t.calls.plugin.length, 0);
  assert.strictEqual(t.calls.fetch[0].url, "https://elsewhere.example/snapshots/a.png");
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
