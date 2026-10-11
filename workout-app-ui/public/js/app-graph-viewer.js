// Fullscreen graph viewer for the Statistics tab (2026-10-10, ImIceTry's ask).
// Tapping a Grafana snapshot opens that panel live (tooltips, drag-to-zoom,
// range chips) in a fullscreen iframe, via the same embed-proxy the old inline
// iframes used. "Image" switches to the cached snapshot with pinch-zoom, drag
// and double-tap zoom (done here with pointer events: the viewport meta
// disables the browser's own pinch-zoom). The live view needs the proxy to
// answer /api/user/auth-tokens/rotate itself, or Grafana reloads in a loop.

const GRAFANA_PANELS = {
  "workout-1": ["workout-overview", "workout", 1],
  "workout-2": ["workout-overview", "workout", 2],
  "workout-3": ["workout-overview", "workout", 3],
  "workout-4": ["workout-overview", "workout", 4],
  "workout-5": ["workout-overview", "workout", 5],
  "yazio-1": ["yazio-overview", "nutrition", 1],
  "yazio-2": ["yazio-overview", "nutrition", 2],
  "yazio-3": ["yazio-overview", "nutrition", 3],
};
const GRAFANA_VIEWER_RANGES = [["Default", ""], ["30d", "now-30d"], ["90d", "now-90d"], ["1y", "now-1y"]];

function grafanaLiveUrl(name, from) {
  const panel = GRAFANA_PANELS[name];
  const base = GRAFANA_SNAPSHOT_BASE.replace(/snapshots\/?$/, "");
  if (!panel || !base) return null;
  const range = from ? `&from=${from}&to=now` : "";
  return `${base}d-solo/${panel[0]}/${panel[1]}?orgId=1&panelId=${panel[2]}&theme=dark${range}`;
}

// Pinch / drag / double-tap zoom for the snapshot image.
function setupImageZoom(stage) {
  const img = stage.querySelector("img");
  if (!img) return;
  let scale = 1, tx = 0, ty = 0;
  const MAX_SCALE = 8;
  const apply = () => {
    const w = stage.clientWidth * scale, h = img.clientHeight * scale;
    tx = Math.min(0, Math.max(Math.min(0, stage.clientWidth - w), tx));
    // Shorter than the screen: keep vertically centered; taller: clamp to the edges.
    ty = h <= stage.clientHeight ? (stage.clientHeight - h) / 2 : Math.min(0, Math.max(stage.clientHeight - h, ty));
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };
  const zoomAt = (cx, cy, newScale) => {
    newScale = Math.min(MAX_SCALE, Math.max(1, newScale));
    tx = cx - ((cx - tx) / scale) * newScale;
    ty = cy - ((cy - ty) / scale) * newScale;
    scale = newScale;
    apply();
  };
  const pointers = new Map();
  let startDist = 0, startScale = 1, lastTap = 0;
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      startDist = Math.hypot(a.x - b.x, a.y - b.y);
      startScale = scale;
    } else if (pointers.size === 1) {
      const now = Date.now();
      if (now - lastTap < 300) {
        const r = stage.getBoundingClientRect();
        if (scale > 1) { scale = 1; tx = 0; ty = 0; apply(); }
        else zoomAt(e.clientX - r.left, e.clientY - r.top, 3);
        lastTap = 0;
      } else lastTap = now;
    }
  });
  stage.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const r = stage.getBoundingClientRect();
    if (pointers.size === 2) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, startScale * (dist / startDist));
    } else {
      tx += e.clientX - p.x;
      ty += e.clientY - p.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      apply();
    }
  });
  const end = (e) => { pointers.delete(e.pointerId); };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  img.addEventListener("load", apply);
}

function openGraphViewer(snapshotImg) {
  const name = snapshotImg.dataset.snapshot;
  const imgSrc = snapshotImg.src;
  let mode = grafanaLiveUrl(name, "") ? "live" : "image";
  let from = "";

  const overlay = document.createElement("div");
  overlay.className = "graph-viewer";
  document.body.appendChild(overlay);

  const render = () => {
    const liveUrl = grafanaLiveUrl(name, from);
    overlay.innerHTML = `
      <div class="graph-viewer-bar">
        <button class="graph-viewer-close" aria-label="Close">&times;</button>
        <div class="graph-viewer-ranges">
          ${mode === "live"
            ? GRAFANA_VIEWER_RANGES.map(([label, value]) =>
                `<button class="range-btn${value === from ? " active" : ""}" data-from="${value}">${label}</button>`).join("")
            : `<span class="graph-viewer-hint">Pinch to zoom, drag to move, double-tap to zoom in/out</span>`}
        </div>
        ${liveUrl && imgSrc ? `<button class="range-btn graph-viewer-mode">${mode === "live" ? "Image" : "Live"}</button>` : ""}
      </div>
      ${mode === "live"
        ? `<iframe class="graph-viewer-frame" src="${liveUrl}"></iframe>`
        : `<div class="graph-viewer-zoom">${imgSrc ? `<img src="${imgSrc}" alt="" draggable="false">` : `<p class="modal-hint">No snapshot cached yet.</p>`}</div>`}
    `;
    overlay.querySelector(".graph-viewer-close").addEventListener("click", closeTopNavLayer);
    const modeBtn = overlay.querySelector(".graph-viewer-mode");
    if (modeBtn) modeBtn.addEventListener("click", () => { mode = mode === "live" ? "image" : "live"; render(); });
    overlay.querySelectorAll("[data-from]").forEach((btn) =>
      btn.addEventListener("click", () => { from = btn.dataset.from; render(); }));
    const stage = overlay.querySelector(".graph-viewer-zoom");
    if (stage) setupImageZoom(stage);
  };
  render();
  pushNavLayer(() => overlay.remove());
}

document.addEventListener("click", (e) => {
  const img = e.target.closest && e.target.closest("img.grafana-embed[data-snapshot]");
  if (img) openGraphViewer(img);
});
