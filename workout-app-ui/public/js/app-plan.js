// ---------- "Next up" card: suggestion + planned sessions (2026-10-07) ----------
// Planned sessions live in the Workout Google Calendar (backend gcal_sync.py);
// dragging one there changes its time here, so this only ever reads it back.

const PLAN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatPlanTime(startStr) {
  const d = new Date(startStr.replace(" ", "T"));
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${PLAN_DAYS[d.getDay()]} ${d.getDate()} ${MONTH_NAMES_SHORT[d.getMonth()]}, ${hh}:${mm}`;
}

async function renderNextUpCard() {
  const el = document.getElementById("next-up-card");
  if (!el) return;
  let plan;
  try {
    plan = await apiGet("/api/plan");
  } catch (_err) {
    el.classList.add("hidden");
    return;
  }
  const s = plan.suggestion;
  if (!s) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const plannedHtml = plan.planned
    .map((p) => `<div class="next-up-planned" data-id="${escapeHtml(p.event_id)}">
        <span>${escapeHtml(p.name)} &middot; ${escapeHtml(formatPlanTime(p.start))}</span>
        <button class="icon-btn-plain next-up-remove" title="Remove planned session">&times;</button>
      </div>`)
    .join("");
  const note = plan.planned_error
    ? "<div class='meta'>Calendar unreachable, planned sessions not shown.</div>"
    : plan.planned.length
      ? "<div class='meta'>Drag a planned session in Google Calendar to reschedule it.</div>"
      : "";
  el.innerHTML = `
    <div class="subtle-label">Next up</div>
    <div class="next-up-title">${escapeHtml(s.name)}</div>
    <div class="meta">${escapeHtml(s.reason)}</div>
    <div class="next-up-actions">
      <button id="next-up-open" class="btn-primary">Open</button>
      ${plan.calendar_enabled ? '<button id="next-up-plan" class="btn-secondary">Plan it</button>' : ""}
    </div>
    ${plannedHtml}
    ${note}
  `;
  el.querySelector("#next-up-open").addEventListener("click", () => {
    openTemplatePreview({ id: s.template_id, name: s.name, source_workout_id: s.source_workout_id, started_at: null });
  });
  const planBtn = el.querySelector("#next-up-plan");
  if (planBtn) planBtn.addEventListener("click", () => openPlanModal(s.name));
  el.querySelectorAll(".next-up-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await apiDelete(`/api/plan/${btn.closest(".next-up-planned").dataset.id}`);
      } catch (_err) {
        alert("Couldn't remove it (offline?).");
        return;
      }
      renderNextUpCard();
    });
  });
}

function openPlanModal(name) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  openModal(`
    <h3>Plan ${escapeHtml(name)}</h3>
    <input id="plan-start-input" type="datetime-local" class="exercise-note-input" value="${value}">
    <div class="modal-actions">
      <button id="plan-save" class="btn-primary">Add to calendar</button>
    </div>
  `);
  modalContent.classList.add("size-compact");
  modalContent.querySelector("#plan-save").addEventListener("click", async () => {
    const raw = modalContent.querySelector("#plan-start-input").value;
    if (!raw) return;
    try {
      await apiPost("/api/plan", { name, start: raw.replace("T", " ").slice(0, 16) });
    } catch (_err) {
      alert("Couldn't add it to the calendar (offline?). Try again.");
      return;
    }
    closeTopNavLayer();
    renderNextUpCard();
  });
}
