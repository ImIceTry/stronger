// ---------- settings ----------
// The Profile tab's gear icon (2026-09-16, ImIceTry's ask -- it already
// looked like a real settings cog, matching Strong's own icon there, but
// had never been wired to anything). Scope is deliberately small: only
// settings that already have a real, working mechanism behind them
// (soundEnabled/hapticsEnabled sat unused since 2026-09-12; the
// incomplete-sets and template-diff prompts are today's own new dialogs)
// -- no fake toggles for things this app doesn't actually do (no unit
// conversion, single hardcoded kg throughout). A light theme specifically
// was cut here on 2026-09-16 as not worth the readability-audit cost; the
// color-scheme picker added 2026-09-18 sidesteps that by offering a second
// *dark* scheme (Strong's blue-on-navy vs. a dark greyish-purple "Stronger"
// scheme) rather than a light one.

function openSettingsScreen() {
  showScreenRaw("screen-settings");
  pushNavLayer(() => showScreen("profile"));
  document.getElementById("settings-sound-toggle").checked = soundEnabled();
  document.getElementById("settings-haptics-toggle").checked = hapticsEnabled();
  document.getElementById("settings-template-prompt-toggle").checked = templateDiffPromptEnabled();
  updateUnfinishedSetsValueLabel();
  updateThemeValueLabel();
}

function updateThemeValueLabel() {
  const labels = { strong: "Strong", stronger: "Stronger" };
  document.getElementById("settings-theme-value").textContent = labels[colorTheme()];
}

function updateUnfinishedSetsValueLabel() {
  const labels = { ask: "Ask every time", discard: "Always discard", complete: "Always complete" };
  document.getElementById("settings-unfinished-value").textContent = labels[unfinishedSetsPolicy()];
}

document.getElementById("profile-settings-btn").addEventListener("click", openSettingsScreen);
document.getElementById("settings-back").addEventListener("click", closeTopNavLayer);

// ---------- account details / bodyweight (2026-09-17, Function Expansion
// Plan item 1.6) -- the Profile avatar row's chevron previously did
// nothing ("Account details (not built yet)"). Bodyweight is the one thing
// worth surfacing here now: it's what unlocks a real load number for
// bodyweight/assisted exercises, which currently have none. ----------

function openAccountScreen() {
  showScreenRaw("screen-account");
  pushNavLayer(() => showScreen("profile"));
  loadAccountScreen();
}

async function loadAccountScreen() {
  const latestEl = document.getElementById("account-latest-weight");
  const listEl = document.getElementById("account-weight-list");
  latestEl.textContent = "Loading…";
  listEl.innerHTML = skeletonHtml(3);
  try {
    const data = await apiGet("/api/bodyweight?limit=30");
    const entries = data.entries;
    latestEl.textContent = entries.length
      ? `Latest: ${entries[0].weight_kg} kg (${relativeDate(entries[0].logged_at)})`
      : "No weight logged yet.";
    listEl.innerHTML = entries.length
      ? entries.map((e) => `
          <div class="exercise-row">
            <span>${escapeHtml(e.logged_at)}</span>
            <span>${e.weight_kg} kg${e.source === "yazio" ? " <span class=\"meta\">(Yazio)</span>" : ""}</span>
          </div>`).join("")
      : "<div class='meta'>Nothing yet -- log one manually or import from Yazio.</div>";
  } catch (err) {
    latestEl.textContent = "";
    listEl.innerHTML = "<div class='meta'>Can't load bodyweight right now (offline?).</div>";
  }
}

document.getElementById("profile-account-btn").addEventListener("click", openAccountScreen);
document.getElementById("account-back").addEventListener("click", closeTopNavLayer);

document.getElementById("account-log-weight-row").addEventListener("click", () => {
  const today = fmtDateOnly(new Date());
  openModal(`
    <h3>Log weight</h3>
    <input id="account-weight-date" type="date" class="exercise-note-input" value="${today}">
    <input id="account-weight-kg" type="number" step="0.1" inputmode="decimal" class="exercise-note-input" placeholder="Weight (kg)">
    <div class="modal-actions">
      <button id="account-weight-save" class="btn-primary">Save</button>
    </div>
  `);
  modalContent.classList.add("size-compact"); // UI Polish Pass 2026-09-18
  const kgInput = modalContent.querySelector("#account-weight-kg");
  kgInput.focus();
  modalContent.querySelector("#account-weight-save").addEventListener("click", async () => {
    const date = modalContent.querySelector("#account-weight-date").value;
    const weightKg = parseFloat(kgInput.value);
    if (!date || !Number.isFinite(weightKg)) {
      alert("Enter a date and a weight.");
      return;
    }
    try {
      await apiPost("/api/bodyweight", { date, weight_kg: weightKg });
    } catch (err) {
      alert("Couldn't save (offline?). Try again once you have signal.");
      return;
    }
    closeTopNavLayer();
    loadAccountScreen();
  });
});

document.getElementById("account-import-yazio-row").addEventListener("click", async () => {
  const row = document.getElementById("account-import-yazio-row");
  const originalHtml = row.innerHTML;
  row.innerHTML = "<div class='settings-row-text'><span>Importing…</span></div>";
  try {
    await apiPost("/api/bodyweight/import-yazio", {});
    await loadAccountScreen();
  } catch (err) {
    alert("Couldn't import from Yazio (offline, or no export found yet).");
  } finally {
    row.innerHTML = originalHtml;
  }
});

document.getElementById("settings-sound-toggle").addEventListener("change", (e) => {
  localStorage.setItem("soundEnabled", e.target.checked ? "true" : "false");
});
document.getElementById("settings-haptics-toggle").addEventListener("change", (e) => {
  localStorage.setItem("hapticsEnabled", e.target.checked ? "true" : "false");
});
document.getElementById("settings-template-prompt-toggle").addEventListener("change", (e) => {
  localStorage.setItem("templateDiffPromptEnabled", e.target.checked ? "true" : "false");
});

document.getElementById("settings-theme-row").addEventListener("click", () => {
  const current = colorTheme();
  const options = [
    { value: "strong", label: "Strong" },
    { value: "stronger", label: "Stronger" },
  ];
  openModal(`
    <h3>Color scheme</h3>
    ${options.map((o) => `<div class="exercise-row" data-value="${o.value}">${o.label}${o.value === current ? " &#10003;" : ""}</div>`).join("")}
  `);
  modalContent.classList.add("size-comfortable"); // UI Polish Pass 2026-09-18
  modalContent.querySelectorAll("[data-value]").forEach((row) => {
    row.addEventListener("click", () => {
      applyColorTheme(row.dataset.value);
      updateThemeValueLabel();
      closeTopNavLayer();
    });
  });
});

document.getElementById("settings-unfinished-row").addEventListener("click", () => {
  const current = unfinishedSetsPolicy();
  const options = [
    { value: "ask", label: "Ask every time" },
    { value: "discard", label: "Always discard" },
    { value: "complete", label: "Always complete" },
  ];
  openModal(`
    <h3>Handle incomplete sets</h3>
    ${options.map((o) => `<div class="exercise-row" data-value="${o.value}">${o.label}${o.value === current ? " &#10003;" : ""}</div>`).join("")}
  `);
  modalContent.classList.add("size-comfortable"); // UI Polish Pass 2026-09-18
  // closeTopNavLayer(), not closeModal() directly -- nothing else opens
  // right after this closes, so the general "explicit close" rule applies
  // (see the delete-workout fix earlier today for what goes wrong when a
  // closeModal() has no history.back() to pair with).
  modalContent.querySelectorAll("[data-value]").forEach((row) => {
    row.addEventListener("click", () => {
      localStorage.setItem("unfinishedSetsPolicy", row.dataset.value);
      updateUnfinishedSetsValueLabel();
      closeTopNavLayer();
    });
  });
});
