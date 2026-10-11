// Site-specific config. Copy this file to config.js (gitignored, never
// committed) and fill in your own values. Both fields are optional -- a
// fresh install with an empty config.js (or none at all, since index.html's
// <script src="js/config.js"> simply 404s and window.APP_CONFIG stays
// undefined) works fine same-origin with the Grafana panels left blank.
window.APP_CONFIG = {
  // Absolute backend URL, used only by the native (Capacitor) Android build.
  // Its WebView serves bundled assets from https://localhost, so relative
  // /api/ paths resolve to nowhere -- point this at wherever the backend is
  // actually reachable from the phone (e.g. a Tailscale HTTPS URL). The
  // browser/PWA build always uses a same-origin relative path instead and
  // ignores this value.
  nativeApiBase: "",

  // Base URL to fetch pre-rendered Grafana panel snapshots from (see the
  // Function Expansion & Refactor Plan's "Loop 1 locked decisions" for why
  // these are static snapshots, not live iframes). Leave "" if you don't
  // run the optional Grafana add-on -- the Statistics tab's panel images
  // simply stay blank instead of broken.
  grafanaSnapshotBase: "",
};
