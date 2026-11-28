// Guards the status-bar / button-bar insets (Android app since 0.5.5's
// viewport-fit=cover, and iOS). The phone reports them as env() and, in the
// Android app, also as --safe-area-inset-* written by Capacitor. Only
// --top-inset / --bottom-inset in style-base.css read them; everything pinned to
// an edge uses those two, so a new rule can't silently pick up just one source.
// Run: node tests/safe-area.test.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const cssDir = path.join(__dirname, "..", "public", "css");
const css = Object.fromEntries(
  fs.readdirSync(cssDir).filter((f) => f.endsWith(".css"))
    .map((f) => [f, fs.readFileSync(path.join(cssDir, f), "utf8")])
);
const rule = (file, selector) => {
  const src = css[file];
  const i = src.indexOf(selector + " {");
  assert.ok(i >= 0, `${selector} not found in ${file}`);
  return src.slice(i, src.indexOf("}", i));
};

// both insets are defined once, from both sources
const base = css["style-base.css"];
assert.match(base, /--top-inset: max\(env\(safe-area-inset-top, 0px\), var\(--safe-area-inset-top, 0px\)\)/);
assert.match(base, /--bottom-inset: max\(env\(safe-area-inset-bottom, 0px\), var\(--safe-area-inset-bottom, 0px\)\)/);

// nothing else reads env(safe-area-*) directly
for (const [file, src] of Object.entries(css)) {
  const uses = src.split("\n").filter((l) => /env\(safe-area-inset/.test(l) && !/--(top|bottom)-inset:/.test(l));
  assert.deepStrictEqual(uses, [], `${file} reads env(safe-area-inset-*) directly; use var(--top-inset)/var(--bottom-inset)`);
}

// the layers pinned to the top start below the status bar
assert.match(rule("style-base.css", "#topbar"), /top: var\(--top-inset\)/);
assert.match(rule("style-shared-ui.css", ".section-header.page-title"), /top: var\(--top-inset\)/);
assert.match(rule("style-overlay.css", ".active-overlay"), /padding-top: var\(--top-inset\)/);
assert.match(rule("style-modals.css", ".tpl-preview"), /padding-top: var\(--top-inset\)/);

// START WORKOUT on the template preview stays above the button bar
assert.match(rule("style-modals.css", ".tpl-preview-footer"), /padding-bottom: calc\(16px \+ var\(--bottom-inset\)\)/);

// the collapsing title docks where its sticky top really is
const screens = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app-screens.js"), "utf8");
assert.ok(!/TITLE_DOCK_OFFSET = 0/.test(screens), "title dock offset must follow the sticky top, not a fixed 0");

console.log("safe-area: ok");
