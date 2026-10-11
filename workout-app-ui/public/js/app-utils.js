// ---------- helpers ----------

function pad(n) { return String(n).padStart(2, "0"); }

// Renders a running timer/stopwatch value (workout elapsed time, rest
// countdown) -- H:MM:SS once it clears an hour instead of just letting the
// minutes side run past 59 (e.g. "94:12" for a real 90+ minute session).
function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// Same idea for a finished workout's total duration in History (e.g. "94
// min" reading a lot less clearly than "1h 34m" for a real long session).
function formatWorkoutDurationLabel(totalSeconds) {
  const totalMin = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}

// -- sound + haptics (2026-09-12, ImIceTry's own ask) --

// One shared AudioContext, created lazily on first real user gesture (a
// bare `new AudioContext()` at load time starts "suspended" on every
// mobile browser until a genuine tap/click resumes it -- creating it
// inside the very first click handler that needs it satisfies that
// automatically, no separate "unlock audio" tap required).
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    sharedAudioCtx = new AC();
  }
  if (sharedAudioCtx.state === "suspended") sharedAudioCtx.resume();
  return sharedAudioCtx;
}

// A short synthesized click/tick, not a bundled audio file -- an
// oscillator blip is plenty for a UI click and skips having to source,
// license, and ship an actual sound asset. freq/duration let call sites
// use a slightly different pitch for different meanings (e.g. the confirm
// tone vs a plain tap) without needing a second asset either.
function playTone(freq, durationMs, volume) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.value = volume ?? 0.08;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  const dur = (durationMs || 60) / 1000;
  // Quick fade-out instead of a hard stop -- an oscillator cut off mid-wave
  // clicks/pops audibly, a fade avoids that.
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.start(now);
  osc.stop(now + dur);
}

// localStorage-backed, default on -- now wired to a real Settings screen
// (2026-09-16, see screen-settings) after sitting unused since 2026-09-12.
function soundEnabled() { return localStorage.getItem("soundEnabled") !== "false"; }
function hapticsEnabled() { return localStorage.getItem("hapticsEnabled") !== "false"; }

// "ask" (default) / "discard" / "complete" -- lets Finish skip
// askUnfinishedSetsChoice entirely and just apply the stored choice, for
// anyone who always wants the same answer instead of being asked every
// workout (2026-09-16, modeled on Strong's own "Handle incomplete sets"
// setting).
function unfinishedSetsPolicy() { return localStorage.getItem("unfinishedSetsPolicy") || "ask"; }

// Default on (ask every time, today's just-built behavior) -- off means
// Finish never shows the template-diff dialog and just leaves the
// template as-is, no matter what changed (2026-09-16, modeled on Strong's
// "Show Update Template" setting).
function templateDiffPromptEnabled() { return localStorage.getItem("templateDiffPromptEnabled") !== "false"; }

// "strong" (default, matches Strong's own blue-on-navy) / "stronger" (dark
// greyish-purple, 2026-09-18). The actual flash-free application at page
// load lives in index.html's own inline head script, which can't call this
// (runs before this file loads) and duplicates THEME_COLORS/the
// data-theme-setting logic in plain JS for that reason -- keep both in sync
// if either changes. applyColorTheme is for a live in-session switch from
// Settings, where a flash doesn't matter since the page is already open.
const THEME_COLORS = { strong: "#1a212c", stronger: "#1e1c24" };
function colorTheme() { return localStorage.getItem("colorTheme") || "strong"; }
function applyColorTheme(theme) {
  localStorage.setItem("colorTheme", theme);
  document.documentElement.dataset.theme = theme;
  const meta = document.getElementById("theme-color-meta");
  if (meta) meta.content = THEME_COLORS[theme] || THEME_COLORS.strong;
}

function playClickSound() {
  if (soundEnabled()) playTone(600, 40, 0.05);
}
function playConfirmSound() {
  if (soundEnabled()) playTone(880, 90, 0.07);
}
// Rest timer finishing (2026-09-16, ImIceTry's ask -- "a bell sound rings" at
// 0) -- two sine partials (fundamental + a higher, quieter inharmonic
// overtone) rather than playTone's single oscillator, plus a much longer
// decay (700ms vs. the 40-90ms UI blips above), since a single short sine
// alone just reads as another click, not a chime.
function playBellSound() {
  if (!soundEnabled()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  [[880, 0.09], [2100, 0.045]].forEach(([freq, volume]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc.start(now);
    osc.stop(now + 0.7);
  });
}
function hapticTap() {
  if (hapticsEnabled() && navigator.vibrate) navigator.vibrate(8);
}
function hapticConfirm() {
  if (hapticsEnabled() && navigator.vibrate) navigator.vibrate([12, 30, 12]);
}

// Delegated at the document level (2026-09-12) rather than wired onto every
// individual button -- this app builds huge swaths of its UI via innerHTML
// template strings rebuilt on every render (see renderExerciseCard etc.),
// so attaching a per-element listener to "every button" would mean
// re-wiring constantly as those nodes get destroyed and recreated. A
// single capture-phase listener on real <button> presses reaches all of
// them, existing or future, with no extra wiring anywhere else. Confirm
// actions (the checkmark) get the slightly more emphatic confirm
// tone/pattern instead of the plain click, detected via the same class the
// rendering code already uses to mark that button.
document.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest("button");
  if (!btn || btn.disabled) return;
  if (btn.classList.contains("confirm-btn") && !btn.classList.contains("confirmed")) {
    playConfirmSound();
    hapticConfirm();
  } else {
    playClickSound();
    hapticTap();
  }
});

// MM:SS digit-entry for the numpad's 'time' unit_type field (Dead Hang
// etc., Phase 3.2). No reference screenshot covers this specific case --
// per the plan's own instruction for exactly this situation, this is a
// judgment call, documented rather than silently assumed: cash-register-
// style entry, the same convention phone/POS keypads use for time/currency
// -- each typed digit shifts the 4-digit buffer left, the rightmost 2
// digits are always seconds, the next 2 are minutes.
function mmssBufferToSeconds(buffer) {
  const padded = (buffer || "").padStart(4, "0").slice(-4);
  const minutes = parseInt(padded.slice(0, 2), 10);
  const seconds = parseInt(padded.slice(2), 10);
  return minutes * 60 + seconds;
}

function secondsToMmssBuffer(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return String(minutes).padStart(2, "0") + String(seconds).padStart(2, "0");
}

function formatMmssBuffer(buffer) {
  if (!buffer) return "0:00";
  const padded = buffer.padStart(4, "0").slice(-4);
  const minutes = parseInt(padded.slice(0, 2), 10);
  const seconds = padded.slice(2);
  return `${minutes}:${seconds}`;
}

// Inverse of formatMmssBuffer -- parses what's actually on screen (e.g. a
// prefilled "0:45" the user never touched via the numpad) back to seconds,
// so the confirm checkmark reads the same displayed value the numpad-field
// div shows, not a separate stale source of truth.
function parseMmssDisplay(text) {
  if (!text || text === "-") return null;
  const parts = text.split(":");
  if (parts.length !== 2) return null;
  const minutes = parseInt(parts[0], 10) || 0;
  const seconds = parseInt(parts[1], 10) || 0;
  return minutes * 60 + seconds;
}

function fmtDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function fmtDateOnly(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function relativeDate(dateStr) {
  const then = new Date(dateStr.replace(" ", "T"));
  const days = Math.floor((new Date(fmtDateOnly(new Date())).getTime() - new Date(fmtDateOnly(then)).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return `${days} days ago`;
  // UI Polish Pass (2026-09-18) -- was dateStr.slice(0, 10), the raw
  // "2026-09-02" ISO string; ImIceTry's ask was a short readable date like
  // "Sep 18, 2026" for anything old enough to fall past the "N days ago"
  // window above.
  return `${MONTH_NAMES_SHORT[then.getMonth()]} ${then.getDate()}, ${then.getFullYear()}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

// Shared loading placeholder (Phase 5.6) -- replaces every plain "Loading..."
// text instance across the app with the same shimmering skeleton, instead of
// each screen inventing its own. `lines` lets a small single-value area
// (e.g. the template preview) ask for fewer bars than a full list.
function skeletonHtml(lines = 3) {
  return `<div class="skeleton">${'<div class="skeleton-line"></div>'.repeat(lines)}</div>`;
}
