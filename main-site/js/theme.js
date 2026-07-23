/* Theme picker: persists choice in localStorage, applies data-theme on <html>. */

const THEMES = [
  { id: "classic", name: "Classic", color: "#ccffcc" },
  { id: "notgreen-1", name: "Not Green 1", color: "#ffcccc" },
  { id: "notgreen-2", name: "Not Green 2", color: "#ccccff" },
  { id: "notgreen-3", name: "Not Green 3", color: "#ffffcc" },
  { id: "notgreen-4", name: "Not Green 4", color: "#ffccff" },
  { id: "notgreen-5", name: "Not Green 5", color: "#ccffff" },
  { id: "lightest-green", name: "Really Really Light Green", color: "#ffffff" },
];

const THEME_KEY = "idb-theme";

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function setStoredTheme(id) {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    /* storage unavailable (private mode etc.) - theme just won't persist */
  }
}

function applyTheme(id) {
  const valid = THEMES.some((t) => t.id === id) ? id : "classic";
  document.documentElement.setAttribute("data-theme", valid);
  document.querySelectorAll(".theme-option").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.theme === valid));
  });
}

/* Apply immediately (before paint-ish) so there's no flash of wrong theme. */
applyTheme(getStoredTheme());

function initThemePicker() {
  const openBtn = document.getElementById("theme-toggle");
  const overlay = document.getElementById("theme-modal");
  const closeBtn = document.getElementById("theme-modal-close");
  const grid = document.getElementById("theme-grid");
  if (!openBtn || !overlay || !grid) return;

  grid.innerHTML = THEMES.map(
    (t) => `
    <button type="button" class="theme-option" data-theme="${t.id}" aria-pressed="false">
      <span class="swatch" style="background:${t.color}"></span>
      <span>${t.name}</span>
    </button>`
  ).join("");

  applyTheme(getStoredTheme());

  function open() {
    overlay.hidden = false;
    const active = grid.querySelector('[aria-pressed="true"]');
    (active || closeBtn).focus();
  }

  function close() {
    overlay.hidden = true;
    openBtn.focus();
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) close();
  });

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".theme-option");
    if (!btn) return;
    const id = btn.dataset.theme;
    applyTheme(id);
    setStoredTheme(id);
    close();
  });
}

document.addEventListener("DOMContentLoaded", initThemePicker);
