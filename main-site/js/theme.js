/* Theme system: 7 brand colour swatches + light/dark mode.
   Default is always light + classic (#ccffcc), regardless of OS preference.
   Once the user picks something, it is persisted.

   Plain script, not an ES module: this project loads scripts without
   type="module", so the spec's exports are published as globals instead. */

var APP_KEY = "idb";

var COLOR_THEMES = [
  { id: "classic", label: "Classic", hex: "#ccffcc" },
  { id: "not-green-1", label: "Not green 1", hex: "#ffcccc" },
  { id: "not-green-2", label: "Not green 2", hex: "#ccccff" },
  { id: "not-green-3", label: "Not green 3", hex: "#ffffcc" },
  { id: "not-green-4", label: "Not green 4", hex: "#ffccff" },
  { id: "not-green-5", label: "Not green 5", hex: "#ccffff" },
  { id: "really-light-green", label: "Really really light green", hex: "#ffffff" },
];

var STORAGE_KEY_COLOR = APP_KEY + ".colorTheme";
var STORAGE_KEY_MODE = APP_KEY + ".mode";

/* Pre-rename key, and the swatch ids it used. */
var LEGACY_KEY = "idb-theme";
var LEGACY_IDS = {
  classic: "classic",
  "notgreen-1": "not-green-1",
  "notgreen-2": "not-green-2",
  "notgreen-3": "not-green-3",
  "notgreen-4": "not-green-4",
  "notgreen-5": "not-green-5",
  "lightest-green": "really-light-green",
};

function readStore(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode etc.), theme just won't persist */
  }
}

/* One-time move from idb-theme to the namespaced keys. */
function migrateLegacyTheme() {
  if (readStore(STORAGE_KEY_COLOR)) return;
  var old = readStore(LEGACY_KEY);
  if (!old) return;
  if (LEGACY_IDS[old]) writeStore(STORAGE_KEY_COLOR, LEGACY_IDS[old]);
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* nothing to do */
  }
}

function hexToRgb(hex) {
  var n = parseInt(hex.replace("#", ""), 16);
  return ((n >> 16) & 255) + ", " + ((n >> 8) & 255) + ", " + (n & 255);
}

function getStoredColorTheme() {
  return readStore(STORAGE_KEY_COLOR) || "classic";
}

function getStoredMode() {
  return readStore(STORAGE_KEY_MODE) || "light";
}

function applyColorTheme(id) {
  var theme = COLOR_THEMES.filter(function (t) {
    return t.id === id;
  })[0] || COLOR_THEMES[0];
  document.documentElement.setAttribute("data-color-theme", theme.id);
  document.documentElement.style.setProperty("--brand", theme.hex);
  document.documentElement.style.setProperty("--brand-rgb", hexToRgb(theme.hex));
  writeStore(STORAGE_KEY_COLOR, theme.id);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme.hex);
  return theme;
}

function applyMode(mode) {
  var resolved = mode === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-mode", resolved);
  writeStore(STORAGE_KEY_MODE, resolved);
  return resolved;
}

function initTheme() {
  migrateLegacyTheme();
  applyColorTheme(getStoredColorTheme());
  applyMode(getStoredMode());
}

/* ---------- modal wiring ---------- */
/* The spec puts this in app.js. This project has eight per-page scripts and
   no app.js, so it lives here, next to the state it drives. */

function buildThemeModal() {
  var grid = document.getElementById("swatchGrid");
  if (!grid) return;

  grid.innerHTML = COLOR_THEMES.map(function (t) {
    return (
      '<button class="swatch" type="button" data-theme-id="' + t.id +
      '" style="--swatch-color:' + t.hex + '" aria-pressed="false" aria-label="' + t.label + '">' +
      '<span class="swatch-dot"></span>' +
      '<span class="swatch-label">' + t.label + "</span>" +
      "</button>"
    );
  }).join("");

  syncThemeModalState();

  grid.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-theme-id]");
    if (!btn) return;
    applyColorTheme(btn.dataset.themeId);
    syncThemeModalState();
  });

  var toggle = document.getElementById("modeToggle");
  if (toggle) {
    toggle.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-mode]");
      if (!btn) return;
      applyMode(btn.dataset.mode);
      syncThemeModalState();
    });
  }
}

function syncThemeModalState() {
  var activeTheme = getStoredColorTheme();
  var activeMode = getStoredMode();

  document.querySelectorAll("#swatchGrid .swatch").forEach(function (el) {
    var on = el.dataset.themeId === activeTheme;
    el.classList.toggle("active", on);
    el.setAttribute("aria-pressed", String(on));
  });

  document.querySelectorAll("#modeToggle .mode-btn").forEach(function (el) {
    var on = el.dataset.mode === activeMode;
    el.classList.toggle("active", on);
    el.setAttribute("aria-pressed", String(on));
  });

  updateThemeButtonIcon();
}

function updateThemeButtonIcon() {
  var btn = document.getElementById("themeBtn");
  if (!btn) return;
  var span = btn.querySelector("[data-icon]");
  if (!span) return;
  span.setAttribute("data-icon", getStoredMode() === "dark" ? "moon" : "sun");
  hydrateIcons(btn);
}

function wireModals() {
  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  document.querySelectorAll(".modal-backdrop").forEach(function (backdrop) {
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });

  var openBtn = document.getElementById("themeBtn");
  if (openBtn) {
    openBtn.addEventListener("click", function () {
      openModal("themeModal");
      var active = document.querySelector("#swatchGrid .swatch.active");
      if (active) active.focus();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var open = document.querySelector(".modal-backdrop:not(.hidden)");
    if (!open) return;
    closeModal(open.id);
    if (openBtn) openBtn.focus();
  });
}

/* Apply before paint so there is no flash of the wrong theme. */
initTheme();

document.addEventListener("DOMContentLoaded", function () {
  hydrateIcons();
  buildThemeModal();
  wireModals();
});

window.COLOR_THEMES = COLOR_THEMES;
window.applyColorTheme = applyColorTheme;
window.applyMode = applyMode;
window.getStoredColorTheme = getStoredColorTheme;
window.getStoredMode = getStoredMode;
window.initTheme = initTheme;
