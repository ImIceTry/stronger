// ---------- "sign in again" banner (always on, no switch) ----------
// When the backend sits behind Cloudflare Access and the login has run out,
// every request is answered with a redirect to Access's login page. A fetch()
// cannot follow that cross-origin redirect, so it only reports "Failed to
// fetch", which looks exactly like being offline. A request made with
// redirect "manual" tells the two apart: it comes back as an "opaqueredirect"
// only when a login redirect answered it, and it throws when really offline.
//
// The banner never blocks the workout screen: it pushes the top bar and the
// workout overlay down by its own height (--signin-banner-h, see style-modals.css)
// instead of covering them, so FINISH stays reachable. Sets are logged on the
// phone, and the active workout survives the page reload that signing in involves.
// Without Access in front (home Wi-Fi, a VPN address) /api/health answers
// normally and nothing ever shows.

const SIGNIN_CHECK_GAP_MS = 20000;
let signinLastCheckAt = 0;
let signinBannerShown = false;

async function accessLoginRequired() {
  try {
    const res = await fetch(API_BASE + "/api/health", { redirect: "manual", cache: "no-store" });
    return res.type === "opaqueredirect";
  } catch (_e) {
    return false; // really offline, or any other failure: not a login problem
  }
}

function showSigninAgainBanner() {
  if (signinBannerShown) return;
  signinBannerShown = true;
  const bar = document.createElement("div");
  bar.id = "signin-again-banner";
  bar.className = "signin-again-banner";
  bar.setAttribute("role", "alert");
  bar.innerHTML = `<span>Your login has ended. A workout in progress stays saved on this phone.</span>
    <button type="button" id="signin-again-btn">Sign in</button>`;
  document.body.appendChild(bar);
  document.body.classList.add("signin-banner-on");
  // Rounded up so a fractional height can never leave a sliver of overlap.
  const fit = () => document.documentElement.style.setProperty("--signin-banner-h", Math.ceil(bar.getBoundingClientRect().height) + "px");
  fit();
  window.addEventListener("resize", fit);
  bar.querySelector("#signin-again-btn").addEventListener("click", () => location.reload());
}

// Called when a request to the backend fails. Cheap: at most one check every
// 20 s, and none once the banner is up.
async function checkAccessSession() {
  const now = Date.now();
  if (signinBannerShown || now - signinLastCheckAt < SIGNIN_CHECK_GAP_MS) return;
  signinLastCheckAt = now;
  if (await accessLoginRequired()) showSigninAgainBanner();
}
