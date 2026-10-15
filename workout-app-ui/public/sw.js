// Minimal service worker (2026-09-12) -- makes the PWA properly
// installable (a fetch-handling SW is part of the standard install
// criteria) and gives the app shell an offline fallback. Deliberately
// NOT caching API responses -- this is a live set-logging tool, a stale
// cached workout/history response would be actively wrong to show, not
// just outdated, so every real data fetch always goes to the network.
const CACHE_NAME = "stronger-shell-v50";
// Loop 2 (2026-09-17) split the old monolithic app.js into a dozen plain
// <script> files -- every one of them needs to be listed here too, or a
// single flaky-connection fetch failure for just one of them has no
// offline/failure fallback at all (unlike the old one-file app.js, where
// a failed fetch meant the whole shell fell back to cache together). A
// half-loaded shell like that doesn't crash outright -- most rendering
// still works since it's spread across the other script tags that did
// load -- it just silently breaks whatever that one missing file defined,
// which is a much harder bug to spot than an obvious full failure.
// All JS moved into js/ (2026-09-17, tidying up the flat public/ directory
// this same split created) -- sw.js itself stays at the root since a
// service worker's default scope is the directory it's served from, and
// this one needs to control the whole site, not just js/.
const SHELL_ASSETS = [
  "./", "index.html", "manifest.json",
  "css/style-base.css", "css/style-overlay.css", "css/style-active-workout.css",
  "css/style-history.css", "css/style-exercises.css", "css/style-shared-ui.css",
  "css/style-modals.css",
  "js/queue.js", "js/muscle-map.js",
  "js/app-utils.js", "js/app-features.js", "js/app-exercise-search.js", "js/app-api.js", "js/app-nav.js", "js/app-screens.js",
  "js/app-overlay.js", "js/app-settings.js", "js/app-profile.js",
  "js/app-history.js", "js/app-exercises.js", "js/app-home.js", "js/app-plan.js",
  "js/app-rest-timer.js", "js/app-finish.js", "js/app-pr-anomaly.js",
  "js/app-add-exercise.js", "js/app-rpe-picker.js", "js/app-reorder.js",
  "js/app-row-actions.js", "js/app-exercise-menu.js", "js/app-radial-menu.js", "js/app-graph-viewer.js",
  "js/app-set-manipulation.js", "js/app-render.js", "js/app.js",
];
// Gitignored per-install file, absent on a fresh install -- addAll() is
// all-or-nothing, so listing it above would stop the worker installing.
const OPTIONAL_ASSETS = ["js/config.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all([
        cache.addAll(SHELL_ASSETS),
        ...OPTIONAL_ASSETS.map((asset) => cache.add(asset).catch(() => {})),
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Never intercept the API -- only the static app shell falls back to
  // cache, and only when the network genuinely fails (spotty gym signal),
  // never preferred over a live response.
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
