// ---------- native HTTP for a backend behind Cloudflare Access (Android build) ----------
// A WebView fetch() cannot work there: a cross-origin request with custom
// headers triggers a CORS preflight, and Access answers (and drops) preflights
// itself. Capacitor's native HTTP plugin sends the request from Android code
// instead, so there is no preflight and the Access service-token headers can be
// sent. It also takes real connect/read timeouts, and lets a second base URL
// (for example a VPN address) serve as a fallback when the first cannot be used.
//
// Opt-in: only on the native build, and only when js/config.js sets
// accessHeaders or nativeApiBaseFallback. Otherwise apiFetch() and urlFetch()
// are the plain fetch the app always used. The headers go to the primary base
// only, never to the fallback. A native request ignores opts.signal: the
// per-attempt timeoutMs is enforced by the plugin instead.
const NATIVE_HTTP = (() => {
  const cfg = window.APP_CONFIG || {};
  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const plugin = isNative && cap.Plugins ? cap.Plugins.CapacitorHttp : null;
  const headers = cfg.accessHeaders && typeof cfg.accessHeaders === "object" ? cfg.accessHeaders : null;
  const fallback = cfg.nativeApiBaseFallback || "";
  const wanted = !!(headers || fallback);
  if (isNative && wanted && !plugin) {
    console.warn("config.js asks for native HTTP but the CapacitorHttp plugin is missing; using plain fetch");
  }
  return { enabled: !!(plugin && wanted), plugin, headers, fallback };
})();

const NATIVE_DEFAULT_TIMEOUT_MS = 15000;

// The app always sends JSON as a string; the plugin wants the parsed value for
// a JSON content type.
function nativeBody(body) {
  if (body == null) return undefined;
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch (_e) {
    return body;
  }
}

function nativeRequest(url, opts, extraHeaders) {
  const timeout = opts.timeoutMs || NATIVE_DEFAULT_TIMEOUT_MS;
  const req = {
    url,
    method: String(opts.method || "GET").toUpperCase(),
    headers: Object.assign({}, opts.headers, extraHeaders),
    connectTimeout: timeout,
    readTimeout: timeout,
    // An Access login redirect must stay visible as a redirect.
    disableRedirects: true,
  };
  const data = nativeBody(opts.body);
  if (data !== undefined) req.data = data;
  if (opts.responseType) req.responseType = opts.responseType;
  return NATIVE_HTTP.plugin.request(req);
}

// What Access returns instead of the API: a redirect to its login page, or an
// HTML error page. The backend itself only ever answers JSON, images or text
// calendars, so this means the request never reached it.
function notOurApi(raw) {
  const h = raw.headers || {};
  const type = String(h["Content-Type"] || h["content-type"] || "");
  return (raw.status >= 300 && raw.status < 400) || type.includes("text/html");
}

// Just enough of a fetch Response for the callers in app-api.js.
function nativeResponse(raw) {
  const status = raw.status | 0;
  const data = raw.data;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof data === "string" ? JSON.parse(data) : data),
    text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
    // responseType "blob" arrives as a base64 string.
    blob: async () => {
      const h = raw.headers || {};
      const type = h["Content-Type"] || h["content-type"] || "application/octet-stream";
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    },
  };
}

// Safe to send again to the fallback after an exception from the primary: the
// server may or may not have seen the first request, so only requests that
// can be repeated (reads, and writes the caller marks idempotent).
function canRepeatAfterError(opts) {
  const method = String(opts.method || "GET").toUpperCase();
  return method === "GET" || method === "HEAD" || opts.idempotent === true;
}

// Request to the app's own backend: API_BASE + path, with the fallback base.
async function apiFetch(path, opts) {
  opts = opts || {};
  if (!NATIVE_HTTP.enabled) {
    return fetch(API_BASE + path, opts).catch((err) => {
      // A failed request may only be a login that has run out (app-signin-again.js).
      if (typeof checkAccessSession === "function") checkAccessSession();
      throw err;
    });
  }
  const bases = [API_BASE];
  if (NATIVE_HTTP.fallback && NATIVE_HTTP.fallback !== API_BASE) bases.push(NATIVE_HTTP.fallback);
  let lastErr;
  for (let i = 0; i < bases.length; i++) {
    const last = i === bases.length - 1;
    let raw;
    try {
      raw = await nativeRequest(bases[i] + path, opts, i === 0 ? NATIVE_HTTP.headers : null);
    } catch (e) {
      lastErr = e;
      if (!last && canRepeatAfterError(opts)) continue;
      throw e;
    }
    // Blocked by Access: it never reached the server, so any method may go on.
    if (!last && notOurApi(raw)) {
      lastErr = new Error(`${path}: blocked before the backend (HTTP ${raw.status})`);
      continue;
    }
    return nativeResponse(raw);
  }
  throw lastErr;
}

// Request to an absolute URL (the Grafana snapshots). Under the primary base it
// carries the Access headers; anywhere else it is the plain fetch.
async function urlFetch(url, opts) {
  opts = opts || {};
  if (NATIVE_HTTP.enabled && API_BASE && url.indexOf(API_BASE) === 0) {
    return nativeResponse(await nativeRequest(url, opts, NATIVE_HTTP.headers));
  }
  return fetch(url, opts);
}
