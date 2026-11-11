// ---------- version link (feature "versionLink", off by default) ----------
// Tapping the version in the top bar opens the page where the newest version
// can be downloaded, in the phone's browser. There is deliberately NO address in
// the repo: each person sets their own as APP_CONFIG.updateUrl in js/config.js
// (gitignored, see config.example.js). Without one, the tap says so.

// Only https addresses are ever opened; "" means none is set.
function updateLinkUrl() {
  const cfg = typeof window !== "undefined" && window.APP_CONFIG;
  const own = cfg && typeof cfg.updateUrl === "string" ? cfg.updateUrl.trim() : "";
  return /^https:\/\/\S+$/.test(own) ? own : "";
}

function openUpdateLink() {
  if (!featureEnabled("versionLink")) return false;
  const url = updateLinkUrl();
  if (!url) {
    alert("No update link is set. Add updateUrl (an https address) to js/config.js, see config.example.js, then rebuild or redeploy the app.");
    return false;
  }
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
