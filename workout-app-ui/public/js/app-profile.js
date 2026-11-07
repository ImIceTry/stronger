// ---------- profile tab ----------

async function renderProfileScreen() {
  const countEl = document.getElementById("profile-workout-count");
  try {
    const data = await apiGet("/api/workouts");
    countEl.textContent = `${data.workouts.length} workouts`;
  } catch (err) {
    countEl.textContent = "";
  }
  renderMuscleMap();
}

// ---------- sync queue wiring ----------

async function updatePendingBadge() {
  const n = await Queue.count();
  // Setting changes waiting in the outbox stay invisible; only one the server
  // refused is shown, since that one will never upload by itself.
  const failed = typeof Outbox !== "undefined" ? await Outbox.failedCount() : 0;
  const badge = document.getElementById("pending-badge");
  const parts = [];
  if (n > 0) parts.push(`${n} pending`);
  if (failed > 0) parts.push(`${failed} setting${failed > 1 ? "s" : ""} not saved`);
  if (parts.length) {
    badge.textContent = parts.join(" · ");
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

async function flushQueue() {
  const synced = await Queue.flush(syncWorkout);
  // Not behind the switch: changes queued before it was turned off still upload.
  if (typeof Outbox !== "undefined") await Outbox.flush().catch(() => {});
  if (synced > 0) allExercisesCache = null; // times_performed/last_performed may have shifted
  updatePendingBadge();
  if (!document.getElementById("screen-history").classList.contains("hidden")) {
    renderHistoryScreen();
  }
}

window.addEventListener("online", flushQueue);
setInterval(flushQueue, 30000);

// Flags reads served from GetCache (queue.js) rather than a live response --
// navigator.onLine alone can't tell (some platforms report it optimistically
// true with no real signal), so screens showing cached templates/history
// still get an honest indicator instead of looking like a normal live load.
function updateOfflineBadge(fromCache) {
  const badge = document.getElementById("offline-badge");
  if (fromCache) badge.classList.remove("hidden");
  else badge.classList.add("hidden");
}
window.addEventListener("online", () => updateOfflineBadge(false));
