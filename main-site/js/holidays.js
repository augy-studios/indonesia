/* Public Holidays: fetches /api/holidays, renders a year's list. */

const CACHE_PREFIX = "idb-holidays-cache-";
const CLIENT_CACHE_MS = 24 * 60 * 60 * 1000;
const MIN_YEAR = 2018;
const MAX_YEAR = new Date().getFullYear() + 2;

let currentYear = new Date().getFullYear();

function mountIcons() {
  const map = {
    "icon-coffee": "coffee",
    "icon-palette": "palette",
    "icon-close": "close",
    "icon-holiday": "calendar",
    "icon-prev": "chevronLeft",
    "icon-next": "chevronRight",
    "icon-refresh": "refresh",
    "icon-refresh-2": "refresh",
    "icon-alert": "alertTriangle",
    "icon-wifioff": "wifiOff",
    "icon-empty": "inbox",
  };
  for (const [id, name] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon(name);
  }
}

function readCache(year) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + year);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(year, payload) {
  try {
    localStorage.setItem(CACHE_PREFIX + year, JSON.stringify({ payload, ts: Date.now() }));
  } catch {
    /* non-fatal */
  }
}

function setBanner(id, show) {
  document.getElementById(id).classList.toggle("show", show);
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function renderList(rows) {
  const list = document.getElementById("holiday-list");
  const empty = document.getElementById("empty-state");

  if (!Array.isArray(rows) || rows.length === 0) {
    list.innerHTML = "";
    empty.classList.add("show");
    return;
  }

  empty.classList.remove("show");

  const sorted = [...rows].sort((a, b) => new Date(a.date) - new Date(b.date));

  list.innerHTML = sorted
    .map((h) => {
      const d = new Date(h.date + "T00:00:00");
      const day = Number.isNaN(d.getTime()) ? "--" : d.getDate();
      const mon = Number.isNaN(d.getTime()) ? "" : MONTHS[d.getMonth()];
      const isNational = h.is_national_holiday !== false;
      return `
        <div class="holiday-row glass">
          <div class="date-badge"><span class="day">${day}</span><span class="mon">${mon}</span></div>
          <div class="info">
            <div class="name">${h.name || "Unnamed holiday"}</div>
            <div class="meta">${h.date || ""}</div>
          </div>
          <span class="type-tag ${isNational ? "national" : "joint"}">${isNational ? "National holiday" : "Cuti bersama"}</span>
        </div>
      `;
    })
    .join("");
}

async function loadYear(year, { silent } = {}) {
  currentYear = year;
  document.getElementById("year-label").textContent = year;
  setBanner("error-banner", false);
  setBanner("stale-banner", false);

  const cached = readCache(year);
  const cacheFresh = cached && Date.now() - cached.ts < CLIENT_CACHE_MS;

  if (cached && (silent || cacheFresh)) {
    renderList(cached.payload.data);
    if (cacheFresh) return;
  }

  if (!cached) document.getElementById("skeleton").style.display = "flex";

  try {
    const res = await fetch(`/api/holidays?year=${year}`, { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body || body.success === false) {
      throw new Error((typeof body?.error === "string" ? body.error : null) || `Request failed (${res.status})`);
    }

    writeCache(year, body);
    renderList(body.data);
  } catch (err) {
    if (cached) {
      renderList(cached.payload.data);
      setBanner("stale-banner", true);
    } else {
      setBanner("error-banner", true);
      document.getElementById("error-text").textContent = err.message || "Couldn't load holidays.";
      renderList([]);
    }
  } finally {
    document.getElementById("skeleton").style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  mountIcons();

  document.getElementById("year-prev").addEventListener("click", () => {
    if (currentYear > MIN_YEAR) loadYear(currentYear - 1);
  });
  document.getElementById("year-next").addEventListener("click", () => {
    if (currentYear < MAX_YEAR) loadYear(currentYear + 1);
  });
  document.getElementById("retry-btn").addEventListener("click", () => loadYear(currentYear));
  document.getElementById("refresh-btn").addEventListener("click", () => {
    localStorage.removeItem(CACHE_PREFIX + currentYear);
    loadYear(currentYear);
  });

  loadYear(currentYear, { silent: true });
});
