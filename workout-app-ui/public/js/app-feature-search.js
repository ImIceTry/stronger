// ---------- search box on the Workout Screen features page ----------
// The features page lists every switch in six groups plus the radial menu,
// which is a long scroll when you know the name of the one you want. This
// adds a filter box above it, behind its own switch (settingsSearch).
//
// renderWorkoutFeaturesScreen rebuilds the whole list with innerHTML after
// every toggle, so the filter is reapplied from a MutationObserver instead of
// being threaded into that renderer: the box itself lives outside the list
// and keeps its text across redraws.

(function () {
  const screen = document.getElementById("screen-workout-features");
  const body = document.getElementById("workout-features-body");
  if (!screen || !body) return;

  const wrap = document.createElement("div");
  wrap.className = "feature-search";
  wrap.innerHTML = `<input id="feature-search-input" class="input-name feature-search-input" type="search"
      placeholder="Search features" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div class="meta feature-search-empty hidden">No feature matches.</div>`;
  body.parentNode.insertBefore(wrap, body);
  const input = wrap.querySelector("input");
  const empty = wrap.querySelector(".feature-search-empty");

  const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

  function applyFilter() {
    const on = featureEnabled("settingsSearch");
    wrap.classList.toggle("hidden", !on);
    const q = on ? norm(input.value) : "";
    const searching = q !== "";
    body.classList.toggle("feature-searching", searching);
    let anyMatch = false;
    // Each group is a section title followed by its .pf-group of rows. A
    // query that matches the group's own title keeps the whole group.
    // (The radial section has an intro line between the two.)
    body.querySelectorAll(".settings-section-title").forEach((title) => {
      const between = [];
      let group = title.nextElementSibling;
      while (group && !group.classList.contains("pf-group") && !group.classList.contains("settings-section-title")) {
        between.push(group);
        group = group.nextElementSibling;
      }
      if (!group || !group.classList.contains("pf-group")) return;
      between.forEach((el) => el.classList.toggle("hidden", searching));
      const titleHit = searching && norm(title.textContent).includes(q);
      let groupHit = false;
      group.querySelectorAll(".settings-row").forEach((row) => {
        const hit = !searching || titleHit || norm(row.textContent).includes(q);
        row.classList.toggle("hidden", !hit);
        if (hit) groupHit = true;
      });
      title.classList.toggle("hidden", searching && !groupHit);
      group.classList.toggle("hidden", searching && !groupHit);
      if (groupHit) anyMatch = true;
    });
    empty.classList.toggle("hidden", !searching || anyMatch);
  }

  input.addEventListener("input", applyFilter);
  new MutationObserver(applyFilter).observe(body, { childList: true });
  // A fresh visit starts with the full list, not last visit's query.
  const entry = document.getElementById("settings-workout-features-row");
  if (entry) entry.addEventListener("click", () => { input.value = ""; applyFilter(); });
  applyFilter();
})();
