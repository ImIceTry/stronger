// ---------- version link (feature "versionLink", off by default) ----------
// Tapping the version in the top bar opens the page where the newest version
// can be downloaded, in the phone's browser. Where that page is comes from
// APP_CONFIG.updateUrl in js/config.js (your own downloads page); without it,
// the public releases of the project are opened.

const DEFAULT_UPDATE_URL = "https://github.com/ImIceTry/stronger/tags";

// Only https addresses are ever opened.
function updateLinkUrl() {
  const cfg = typeof window !== "undefined" && window.APP_CONFIG;
  const own = cfg && typeof cfg.updateUrl === "string" ? cfg.updateUrl.trim() : "";
  return /^https:\/\/\S+$/.test(own) ? own : DEFAULT_UPDATE_URL;
}

function openUpdateLink() {
  if (!featureEnabled("versionLink")) return false;
  const url = updateLinkUrl();
  const cap = typeof window !== "undefined" && window.Capacitor;
  if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
    // The Android shell hands any address outside the app to the system browser
    // and leaves the app page where it is.
    window.location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
  return true;
}

function refreshVersionLink() {
  const el = document.getElementById("app-version");
  if (!el) return;
  const on = featureEnabled("versionLink");
  el.classList.toggle("is-link", on);
  if (on) {
    el.setAttribute("role", "link");
    el.setAttribute("title", "Open the download page");
  } else {
    el.removeAttribute("role");
    el.removeAttribute("title");
  }
}

(function setupVersionLink() {
  const el = document.getElementById("app-version");
  if (!el) return;
  el.addEventListener("click", openUpdateLink);
  refreshVersionLink();
})();
