// ---------- home screen (moved from app.js, 2026-09-17) ----------

// ---------- home screen ----------

// Every template is a real, persistent `templates` row (2026-09-16, see
// renderHomeScreen's own comment on why the old "virtual" auto-derivation
// was removed) -- ensureTemplateId's null-id fallback is now unreachable
// from here, kept only as a defensive no-op in case some other path still
// builds a template object before it's saved. A template's own
// `source_workout_id` still points at whichever workout's sets define what
// the card/preview actually show.
async function renderHomeScreen() {
  const list = document.getElementById("repeat-list");
  const countLabel = document.getElementById("repeat-count-label");
  const archivedSection = document.getElementById("archived-templates-section");
  const archivedList = document.getElementById("archived-templates-list");
  const isListMode = templateViewMode === "list";
  list.classList.toggle("list-mode", isListMode);
  archivedList.classList.toggle("list-mode", isListMode);
  list.innerHTML = skeletonHtml();
  renderNextUpCard();
  try {
    const [workoutsData, templatesData, foldersData] = await Promise.all([
      apiGet("/api/workouts"),
      apiGet("/api/templates?archived=1"),
      apiGet("/api/template-folders"),
    ]);
    const workoutById = new Map(workoutsData.workouts.map((w) => [w.id, w]));

    // Templates used to also include a "virtual" entry per distinct workout
    // name seen in the most recent 40 workouts (no real row, just whichever
    // session was most recently logged under that name) -- removed
    // 2026-09-16 (ImIceTry's ask: templates should be fixed, only changing
    // when he explicitly changes them). That derivation meant a template
    // could silently appear, disappear, or repoint itself just from logging
    // workouts, with zero explicit action -- e.g. "Legs" vanished from the
    // Home screen the moment enough newer workouts pushed its last real
    // session (2026-07-14) outside the 40-workout window, purely as a side
    // effect of unrelated activity. Every template is a real, persistent row
    // now (materialized once here as a one-time backfill for whatever was
    // showing virtually at the time -- see git history / the daily log for
    // 2026-09-16 -- going forward new ones only come from an explicit
    // action: "+ New Template", Duplicate, or a scratch template).
    const templates = [];
    templatesData.templates.forEach((t) => {
      const sourceWorkout = workoutById.get(t.source_workout_id);
      // last_logged_at (2026-09-22, ImIceTry's ask) tracks "last time this
      // template was used at all," independent of source_workout_id/the
      // preview content -- takes priority whenever set. Falls back to the
      // source workout's own date (pre-existing templates that predate this
      // column, or one that's only ever been exact-match-synced, never
      // "kept as is") and finally t.updated_at, same as before.
      const started_at = t.last_logged_at || (sourceWorkout ? sourceWorkout.started_at : t.updated_at);
      templates.push({
        id: t.id,
        name: t.name,
        source_workout_id: t.source_workout_id,
        started_at,
        archived: !!t.archived,
        folder_id: t.folder_id,
      });
    });
    templates.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

    const active = templates.filter((t) => !t.archived);
    const archived = templates.filter((t) => t.archived);
    const ungrouped = active.filter((t) => t.folder_id == null);

    countLabel.textContent = `My Templates (${active.length})`;
    list.innerHTML = "";
    if (ungrouped.length === 0) {
      list.innerHTML = active.length === 0 ? "<div class='meta'>No active templates.</div>" : "";
    } else {
      ungrouped.forEach((tpl) => list.appendChild(buildTemplateCard(tpl)));
    }

    // Folders (2026-09-10) -- one expandable group per folder that actually
    // has an active template in it, same visual pattern as the Archived
    // section below, built fresh each render since the folder list itself
    // is small and this keeps it in sync with real assignments with no
    // separate diffing logic.
    const foldersContainer = document.getElementById("template-folders-container");
    foldersContainer.innerHTML = "";
    foldersData.folders.forEach((folder) => {
      const inFolder = active.filter((t) => t.folder_id === folder.id);
      if (inFolder.length === 0) return;
      const section = document.createElement("div");
      section.className = "archived-templates";
      section.dataset.folderId = folder.id;
      section.innerHTML = `
        <button class="archived-templates-toggle">
          <span>${escapeHtml(folder.name)} (${inFolder.length})</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron-icon"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="list template-grid${isListMode ? " list-mode" : ""} hidden"></div>
      `;
      const grid = section.querySelector(".template-grid");
      inFolder.forEach((tpl) => grid.appendChild(buildTemplateCard(tpl)));
      section.querySelector(".archived-templates-toggle").addEventListener("click", () => {
        grid.classList.toggle("hidden");
        section.querySelector(".archived-templates-toggle").classList.toggle("expanded");
      });
      foldersContainer.appendChild(section);
    });

    if (archived.length === 0) {
      archivedSection.classList.add("hidden");
    } else {
      archivedSection.classList.remove("hidden");
      document.getElementById("archived-templates-label").textContent = `Archived templates (${archived.length})`;
      archivedList.innerHTML = "";
      archived.forEach((tpl) => archivedList.appendChild(buildTemplateCard(tpl)));
    }
  } catch (err) {
    countLabel.textContent = "My Templates";
    list.innerHTML = "<div class='meta'>Can't load history right now (offline?).</div>";
  }
}

document.getElementById("archived-templates-toggle").addEventListener("click", () => {
  document.getElementById("archived-templates-list").classList.toggle("hidden");
  document.getElementById("archived-templates-toggle").classList.toggle("expanded");
});

document.getElementById("btn-add-template").addEventListener("click", () => startTemplateBuilder());

// Folder icon header button (2026-09-10) -- was unwired entirely ("that
// button doesn't do anything"). Per-template folder assignment already
// lives in each template's own "Move to Folder" menu entry; this is the
// lighter "see what folders exist / create one ahead of time" list, jumping
// straight to that folder's own section on Home when it already has
// templates in it.
document.getElementById("btn-template-folders").addEventListener("click", async () => {
  let folders = [];
  try {
    const data = await apiGet("/api/template-folders");
    folders = data.folders;
  } catch (err) {
    alert("Can't load folders right now (offline?).");
    return;
  }
  const rows = folders.map((f) =>
    `<div class="exercise-row folder-list-row" data-folder-jump="${f.id}">
      <span class="folder-list-name">${escapeHtml(f.name)}</span>
      <button class="folder-list-delete" data-folder-delete="${f.id}" aria-label="Delete folder">✕</button>
    </div>`
  ).join("");
  openModal(`
    ${rows || "<div class='meta'>No folders yet.</div>"}
    <div class="exercise-row" data-action="new-folder">+ New Folder...</div>
  `);
  modalContent.classList.add("size-comfortable"); // UI Polish Pass 2026-09-18
  modalContent.querySelectorAll("[data-folder-jump]").forEach((row) => {
    row.addEventListener("click", () => {
      closeTopNavLayer();
      const section = document.querySelector(`#template-folders-container [data-folder-id="${row.dataset.folderJump}"]`);
      if (!section) return; // an empty folder has no section to jump to yet
      section.querySelector(".template-grid").classList.remove("hidden");
      section.querySelector(".archived-templates-toggle").classList.add("expanded");
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  modalContent.querySelectorAll("[data-folder-delete]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation(); // don't also trigger the row's own jump-to-folder click
      const folderId = btn.dataset.folderDelete;
      const folderName = btn.closest(".folder-list-row").querySelector(".folder-list-name").textContent;
      if (!(await showConfirmDialog(`Delete "${folderName}"? Templates inside it move back to No Folder -- they aren't deleted.`, { confirmLabel: "Delete", danger: true }))) return;
      try {
        await apiDelete(`/api/template-folders/${folderId}`);
        closeTopNavLayer();
        await renderHomeScreen();
      } catch (err) {
        alert("Couldn't delete this folder (offline?). Try again once you have signal.");
      }
    });
  });
  modalContent.querySelector('[data-action="new-folder"]').addEventListener("click", () => {
    openModal(`
      <h3>New folder</h3>
      <input id="new-folder-input" type="text" class="exercise-note-input" placeholder="Folder name" maxlength="100">
      <div class="modal-actions">
        <button id="new-folder-save" class="btn-primary">Save</button>
      </div>
    `);
    modalContent.classList.add("size-compact"); // UI Polish Pass 2026-09-18
    const input = modalContent.querySelector("#new-folder-input");
    input.focus();
    modalContent.querySelector("#new-folder-save").addEventListener("click", async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        await apiPost("/api/template-folders", { name });
      } catch (err) {
        alert("Couldn't create this folder (offline?). Try again once you have signal.");
        return;
      }
      closeTopNavLayer();
    });
  });
});

// Templates header "···" menu (2026-09-10) -- reuses the existing archived
// section (built 2026-09-09) rather than a second implementation; this menu
// entry just reveals/scrolls to it. Grid/list view toggle lives here too.
document.getElementById("btn-templates-menu").addEventListener("click", () => {
  const section = document.getElementById("archived-templates-section");
  const hasArchived = !section.classList.contains("hidden");
  const otherMode = templateViewMode === "list" ? "grid" : "list";
  openModal(`
    <div class="exercise-row" data-action="show-archived">Show Archived Templates</div>
    <div class="exercise-row" data-action="toggle-view">View as ${otherMode === "list" ? "List" : "Grid"}</div>
  `);
  const row = modalContent.querySelector('[data-action="show-archived"]');
  if (!hasArchived) {
    row.classList.add("disabled");
    row.title = "No archived templates yet";
  } else {
    row.addEventListener("click", () => {
      closeTopNavLayer();
      document.getElementById("archived-templates-list").classList.remove("hidden");
      document.getElementById("archived-templates-toggle").classList.add("expanded");
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  modalContent.querySelector('[data-action="toggle-view"]').addEventListener("click", () => {
    templateViewMode = otherMode;
    localStorage.setItem("templateViewMode", templateViewMode);
    closeTopNavLayer();
    renderHomeScreen();
  });
});

function buildTemplateCard(tpl) {
  const item = document.createElement("div");
  item.className = "list-item template-card";
  item.innerHTML = `
    <div class="template-card-header">
      <span class="title">${escapeHtml(tpl.name)}</span>
      <button class="icon-btn template-card-menu-btn" title="More">&#8943;</button>
    </div>
    <div class="template-preview">${skeletonHtml(2)}</div>
    <div class="template-footer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
      <span>${escapeHtml(relativeDate(tpl.started_at))}</span>
    </div>
  `;
  item.addEventListener("click", () => openTemplatePreview(tpl));
  item.querySelector(".template-card-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openTemplateOptionsMenu(tpl, "grid");
  });

  // Preview text loads in the background per card so the grid itself
  // renders immediately -- only a handful of distinct names, so this is
  // a few detail fetches, not the N+1-over-everything cost that would
  // come from doing this for every individual past session. A scratch
  // template (2026-09-10, no source_workout_id) has no logged sets to count
  // -- just list its exercises, no "N x" counts to show.
  const previewFetch = tpl.source_workout_id != null
    ? apiGet(`/api/workouts/${tpl.source_workout_id}`).then((detail) => {
        const counts = [];
        const seen = new Set();
        detail.sets.forEach((s) => {
          if (seen.has(s.exercise_name)) return;
          seen.add(s.exercise_name);
          const n = detail.sets.filter((s2) => s2.exercise_name === s.exercise_name).length;
          counts.push(`${n} x ${s.exercise_name}`);
        });
        return counts.join(", ");
      })
    : apiGet(`/api/templates/${tpl.id}/exercises`).then((data) => data.exercises.join(", "));
  previewFetch.then((text) => {
    const previewEl = item.querySelector(".template-preview");
    if (previewEl) previewEl.textContent = text;
  }).catch(() => {
    const previewEl = item.querySelector(".template-preview");
    if (previewEl) previewEl.textContent = "";
  });
  return item;
}

// Materializes a virtual template (id === null) into a real `templates` row
// the first time it's actually acted on, so rename/archive/duplicate/delete
// always have a real id to persist against. Idempotent server-side, so a
// double-call (e.g. the menu firing twice) just returns the same row.
async function ensureTemplateId(tpl) {
  if (tpl.id != null) return tpl.id;
  const row = await apiPost("/api/templates", { name: tpl.name, source_workout_id: tpl.source_workout_id });
  tpl.id = row.id;
  tpl.archived = !!row.archived;
  return row.id;
}

// Shared options menu for a template, reachable both from its card's corner
// button on the Home grid and from the same three-dot button once already
// inside its full-screen preview -- same actions, same behavior, either way
// in. `context` is "grid" or "preview", only used to decide whether the
// preview screen itself needs closing after an action that invalidates it
// (edit navigates away entirely; delete removes the thing being previewed).
function openTemplateOptionsMenu(tpl, context) {
  const isScratch = tpl.source_workout_id == null;
  // UI Polish Pass 2026-09-18, item 3 -- migrated to the side panel;
  // "Edit"/"Rename" share the same pencil icon (both are "change this
  // template's content/name" actions -- their labels already disambiguate,
  // a second near-identical pencil variant wouldn't add real clarity at
  // 20px, per the plan's own "minimal" guidance).
  openSidePanel(tpl.name, `
    <div class="side-panel-row" data-action="edit"><svg class="side-panel-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS.note}</svg><span class="side-panel-row-label">Edit</span></div>
    <div class="side-panel-row" data-action="rename"><svg class="side-panel-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS.note}</svg><span class="side-panel-row-label">Rename</span></div>
    <div class="side-panel-row" data-action="folder"><svg class="side-panel-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS.folder}</svg><span class="side-panel-row-label">Move to Folder</span></div>
    <div class="side-panel-row" data-action="duplicate"><svg class="side-panel-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS.duplicate}</svg><span class="side-panel-row-label">Duplicate</span></div>
    <div class="side-panel-row" data-action="share"><svg class="side-panel-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS.share}</svg><span class="side-panel-row-label">Share</span></div>
    <div class="side-panel-row" data-action="archive"><svg class="side-panel-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS.archive}</svg><span class="side-panel-row-label">${tpl.archived ? "Unarchive" : "Archive"}</span></div>
    <div class="side-panel-row template-row-danger" data-action="delete"><svg class="side-panel-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${EXERCISE_MENU_ICONS.remove}</svg><span class="side-panel-row-label">Delete</span></div>
  `);

  sidePanel.querySelector('[data-action="edit"]').addEventListener("click", async () => {
    closeTopNavLayer();
    if (isScratch) {
      // Editing a scratch template's own exercise list (as opposed to a
      // real logged workout, which startEditingWorkout already handles)
      // isn't built yet -- Duplicate + Delete cover "change it" for now.
      alert("Editing a scratch template's exercise list isn't built yet -- duplicate it and delete the old one for now.");
      return;
    }
    try {
      const detail = await apiGet(`/api/workouts/${tpl.source_workout_id}`);
      if (context === "preview") closeTemplatePreview();
      startEditingWorkout(detail);
    } catch (err) {
      alert("Can't edit this template right now (offline?).");
    }
  });

  sidePanel.querySelector('[data-action="rename"]').addEventListener("click", () => {
    openRenameTemplateModal(tpl);
  });

  sidePanel.querySelector('[data-action="folder"]').addEventListener("click", () => {
    openTemplateFolderPicker(tpl);
  });

  sidePanel.querySelector('[data-action="duplicate"]').addEventListener("click", async () => {
    closeTopNavLayer();
    try {
      await ensureTemplateId(tpl);
      await apiPost(`/api/templates/${tpl.id}/duplicate`, null);
      await renderHomeScreen();
    } catch (err) {
      alert("Couldn't duplicate this template (offline?). Try again once you have signal.");
    }
  });

  sidePanel.querySelector('[data-action="share"]').addEventListener("click", () => {
    closeTopNavLayer();
    shareTemplate(tpl);
  });

  sidePanel.querySelector('[data-action="archive"]').addEventListener("click", async () => {
    closeTopNavLayer();
    const nextArchived = !tpl.archived;
    try {
      await ensureTemplateId(tpl);
      await apiPost(`/api/templates/${tpl.id}/archive`, { archived: nextArchived });
      tpl.archived = nextArchived;
      await renderHomeScreen();
    } catch (err) {
      alert("Couldn't update this template (offline?). Try again once you have signal.");
    }
  });

  sidePanel.querySelector('[data-action="delete"]').addEventListener("click", async () => {
    // Explicit reassurance in the confirm copy itself, not just a code
    // comment -- deleting a template must never read as "delete my workout
    // history" to ImIceTry, since this only removes the template shortcut.
    if (!(await showConfirmDialog(`Delete "${tpl.name}"? This only removes it from your templates -- the logged workout it's based on stays exactly as it is.`, { confirmLabel: "Delete", danger: true }))) return;
    closeTopNavLayer();
    try {
      await ensureTemplateId(tpl);
      await apiDelete(`/api/templates/${tpl.id}`);
      if (context === "preview") closeTemplatePreview();
      await renderHomeScreen();
    } catch (err) {
      alert("Couldn't delete this template (offline?). Try again once you have signal.");
    }
  });
}

function openRenameTemplateModal(tpl) {
  openModal(`
    <h3>Rename template</h3>
    <input id="template-rename-input" type="text" class="exercise-note-input" value="${escapeHtml(tpl.name)}" maxlength="200">
    <div class="modal-actions">
      <button id="template-rename-save" class="btn-primary">Save</button>
    </div>
  `);
  modalContent.classList.add("size-compact"); // UI Polish Pass 2026-09-18
  const input = modalContent.querySelector("#template-rename-input");
  input.focus();
  input.select();
  modalContent.querySelector("#template-rename-save").addEventListener("click", async () => {
    const newName = input.value.trim();
    if (!newName) return;
    try {
      await ensureTemplateId(tpl);
      const row = await apiPut(`/api/templates/${tpl.id}`, { name: newName });
      tpl.name = row.name;
    } catch (err) {
      alert("Couldn't rename this template (offline?). Try again once you have signal.");
      return;
    }
    closeTopNavLayer();
    const previewScreen = document.getElementById("template-preview-screen");
    if (!previewScreen.classList.contains("hidden")) {
      document.getElementById("template-preview-title").textContent = tpl.name;
    }
    await renderHomeScreen();
  });
}

// Folders (2026-09-10) -- simple named groups, a template belongs to at
// most one. "New Folder" creates and assigns in the same step rather than
// a separate folder-management screen, since the only place you'd ever
// want a folder to exist is right when you're about to put something in it.
async function openTemplateFolderPicker(tpl) {
  let folders = [];
  try {
    const data = await apiGet("/api/template-folders");
    folders = data.folders;
  } catch (err) {
    alert("Can't load folders right now (offline?).");
    return;
  }
  const rows = folders.map((f) =>
    `<div class="exercise-row" data-folder-id="${f.id}">${escapeHtml(f.name)}${tpl.folder_id === f.id ? " ✓" : ""}</div>`
  ).join("");
  openModal(`
    ${tpl.folder_id != null ? `<div class="exercise-row" data-folder-id="">No Folder</div>` : ""}
    ${rows}
    <div class="exercise-row" data-action="new-folder">+ New Folder...</div>
  `);
  modalContent.classList.add("size-comfortable"); // UI Polish Pass 2026-09-18
  const assign = async (folderId) => {
    try {
      await ensureTemplateId(tpl);
      const row = await apiPut(`/api/templates/${tpl.id}/folder`, { folder_id: folderId });
      tpl.folder_id = row.folder_id;
    } catch (err) {
      alert("Couldn't move this template (offline?). Try again once you have signal.");
      return;
    }
    closeTopNavLayer();
    await renderHomeScreen();
  };
  modalContent.querySelectorAll("[data-folder-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const raw = row.dataset.folderId;
      assign(raw === "" ? null : parseInt(raw, 10));
    });
  });
  modalContent.querySelector('[data-action="new-folder"]').addEventListener("click", () => {
    openModal(`
      <h3>New folder</h3>
      <input id="new-folder-input" type="text" class="exercise-note-input" placeholder="Folder name" maxlength="100">
      <div class="modal-actions">
        <button id="new-folder-save" class="btn-primary">Save</button>
      </div>
    `);
    modalContent.classList.add("size-compact"); // UI Polish Pass 2026-09-18
    const input = modalContent.querySelector("#new-folder-input");
    input.focus();
    modalContent.querySelector("#new-folder-save").addEventListener("click", async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        const folder = await apiPost("/api/template-folders", { name });
        await assign(folder.id);
      } catch (err) {
        alert("Couldn't create this folder (offline?). Try again once you have signal.");
      }
    });
  });
}

async function shareTemplate(tpl) {
  let text = tpl.name;
  try {
    const detail = await apiGet(`/api/workouts/${tpl.source_workout_id}`);
    const order = [];
    const countByName = new Map();
    detail.sets.forEach((s) => {
      if (!countByName.has(s.exercise_name)) order.push(s.exercise_name);
      countByName.set(s.exercise_name, (countByName.get(s.exercise_name) || 0) + 1);
    });
    text = `${tpl.name}\n${order.map((name) => `${countByName.get(name)} x ${name}`).join("\n")}`;
  } catch (err) {
    // offline -- share just the name rather than blocking the share entirely
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: tpl.name, text });
    } catch (err) {
      // user backed out of the native share sheet -- not an error
    }
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied to clipboard.");
      return;
    } catch (err) {
      // fall through to the plain alert below
    }
  }
  alert(text);
}

// Exercise breakdown before committing to a template, instead of starting
// the workout immediately on tap -- the card's own inline preview text is
// just a truncated one-liner, not enough to actually decide from. Shows how
// much of each exercise (set count), not weights/reps -- this is "does this
// routine look right," not a rep-by-rep replay.
async function openTemplatePreview(tpl) {
  document.getElementById("template-preview-title").textContent = tpl.name;
  document.getElementById("template-preview-meta").textContent = `Last performed: ${relativeDate(tpl.started_at)}`;
  const listEl = document.getElementById("template-preview-list");
  listEl.innerHTML = skeletonHtml();
  document.getElementById("template-preview-screen").classList.remove("hidden");
  const top = navLayers[navLayers.length - 1];
  if (!top || top.onClose !== closeTemplatePreview) {
    pushNavLayer(closeTemplatePreview);
  }
  const isScratch = tpl.source_workout_id == null;
  document.getElementById("template-preview-menu-btn").onclick = () => openTemplateOptionsMenu(tpl, "preview");

  try {
    if (!allExercisesCache) {
      const data = await apiGet("/api/exercises/all");
      allExercisesCache = data.exercises;
    }
    const categoryByName = new Map(allExercisesCache.map((e) => [e.name, e.category]));

    // A scratch template (2026-09-10) has no logged sets to derive counts
    // from -- just its own exercise list, one row each, no "N x" count.
    let order, countByName;
    if (isScratch) {
      const data = await apiGet(`/api/templates/${tpl.id}/exercises`);
      order = data.exercises;
      countByName = new Map(order.map((name) => [name, null]));
      document.getElementById("template-preview-start").onclick = () => {
        closeTemplatePreview();
        startWorkout(null, tpl.name, order, { tpl, isScratch: true });
      };
    } else {
      const detail = await apiGet(`/api/workouts/${tpl.source_workout_id}`);
      order = [];
      countByName = new Map();
      detail.sets.forEach((s) => {
        if (!countByName.has(s.exercise_name)) order.push(s.exercise_name);
        countByName.set(s.exercise_name, (countByName.get(s.exercise_name) || 0) + 1);
      });
      document.getElementById("template-preview-start").onclick = () => {
        closeTemplatePreview();
        startWorkout(tpl.source_workout_id, tpl.name, undefined, { tpl, isScratch: false });
      };
    }

    listEl.innerHTML = order
      .map((name) => {
        const category = categoryByName.get(name);
        const count = countByName.get(name);
        return `
          <div class="tpl-preview-row">
            <div class="tpl-preview-row-left">
              <span class="ex-avatar">${escapeHtml(name[0].toUpperCase())}</span>
              <div class="tpl-preview-row-main">
                <div class="title">${count != null ? count + " &times; " : ""}${escapeHtml(name)}</div>
                ${category ? `<div class="tpl-preview-row-category">${escapeHtml(category)}</div>` : ""}
              </div>
            </div>
            <button class="icon-btn" title="Exercise info" data-exercise-name="${escapeHtml(name)}">?</button>
          </div>
        `;
      })
      .join("");
    // Hide in place rather than closeTemplatePreview() (which pops a nav
    // layer + fires history.back()) -- same reasoning as
    // openExerciseDetailFromActiveWorkout: that would race against
    // showExerciseDetail's own pushNavLayer call right after. onClose
    // un-hides it again, leaving its own nav-layer entry untouched.
    listEl.querySelectorAll("[data-exercise-name]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.exerciseName;
        document.getElementById("template-preview-screen").classList.add("hidden");
        showExerciseDetail(name, () => {
          document.getElementById("screen-exercise-detail").classList.add("hidden");
          document.getElementById("template-preview-screen").classList.remove("hidden");
        });
        document.querySelector('.ed-tab[data-ed-tab="about"]').click();
      });
    });
  } catch (err) {
    listEl.innerHTML = "<div class='meta'>Can't load preview right now (offline?).</div>";
  }
}

function closeTemplatePreview() {
  document.getElementById("template-preview-screen").classList.add("hidden");
  const top = navLayers[navLayers.length - 1];
  if (top && top.onClose === closeTemplatePreview) {
    navLayers.pop();
    if (!handlingPopstate) history.back();
  }
}

document.getElementById("template-preview-back").addEventListener("click", closeTopNavLayer);

document.getElementById("btn-new-workout").addEventListener("click", () => startWorkout(null));
