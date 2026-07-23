/* Weather page: fetches /api/weather, renders forecast, and degrades
   gracefully on errors, empty data, and offline/stale conditions. */

const ADM4_RE = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/;
const DEFAULT_ADM4 = "31.71.03.1001";
const LAST_ADM4_KEY = "idb-weather-last-adm4";
const CACHE_PREFIX = "idb-weather-cache-";
const CLIENT_CACHE_MS = 10 * 60 * 1000;

function mountIcons() {
  const map = {
    "icon-coffee": "coffee",
    "icon-palette": "palette",
    "icon-close": "close",
    "icon-cloud": "cloudSun",
    "icon-search": "search",
    "icon-refresh": "refresh",
    "icon-refresh-2": "refresh",
    "icon-external": "externalLink",
    "icon-alert": "alertTriangle",
    "icon-wifioff": "wifiOff",
    "icon-empty": "inbox",
  };
  for (const [id, name] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon(name);
  }
}

function weatherIconFor(descEn) {
  const d = (descEn || "").toLowerCase();
  if (d.includes("thunder")) return "storm";
  if (d.includes("rain") || d.includes("drizzle") || d.includes("shower")) return "rain";
  if (d.includes("fog") || d.includes("haze") || d.includes("smoke") || d.includes("mist")) return "fog";
  if (d.includes("cloud")) return d.includes("clear") || d.includes("partly") ? "cloudSun" : "cloud";
  return "cloudSun";
}

function readCache(adm4) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + adm4);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(adm4, payload) {
  try {
    localStorage.setItem(CACHE_PREFIX + adm4, JSON.stringify({ payload, ts: Date.now() }));
  } catch {
    /* storage full/unavailable - non-fatal, just skip client cache */
  }
}

function flattenForecast(data) {
  // data.cuaca is an array of day-groups, each an array of hourly entries.
  const entries = [];
  for (const group of data || []) {
    if (Array.isArray(group)) entries.push(...group);
  }
  entries.sort((a, b) => new Date(a.local_datetime) - new Date(b.local_datetime));
  return entries;
}

function groupByDay(entries) {
  const groups = new Map();
  for (const e of entries) {
    const day = (e.local_datetime || "").slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(e);
  }
  return groups;
}

function fmtDayLabel(dayStr, index) {
  const d = new Date(dayStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dayStr;
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "Today";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function fmtTime(dtStr) {
  const d = new Date((dtStr || "").replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function renderCurrent(lokasi, entries) {
  const card = document.getElementById("current-card");
  const now = Date.now();
  const current = entries.find((e) => new Date(e.local_datetime) >= now) || entries[0];
  if (!current) {
    card.classList.remove("show");
    return;
  }

  const place = [lokasi?.desa, lokasi?.kecamatan, lokasi?.kotkab].filter(Boolean).join(", ");

  card.innerHTML = `
    <div class="current-top">
      <div class="current-loc">${icon("mapPin")} <span>${place || "Selected area"}</span></div>
    </div>
    <div class="current-main">
      <div class="card-icon">${icon(weatherIconFor(current.weather_desc_en))}</div>
      <div>
        <div class="current-temp">${current.t ?? "--"}&deg;C</div>
        <div class="current-desc">${current.weather_desc || "Unknown"}</div>
      </div>
    </div>
    <div class="stat-row">
      <span class="stat">${icon("droplet")} Humidity <strong>${current.hu ?? "--"}%</strong></span>
      <span class="stat">${icon("wind")} Wind <strong>${current.ws ?? "--"} km/h ${current.wd || ""}</strong></span>
      <span class="stat">${icon("eye")} Visibility <strong>${current.vs_text || "--"}</strong></span>
    </div>
  `;
  card.classList.add("show");
}

function renderDays(entries) {
  const container = document.getElementById("forecast-days");
  container.innerHTML = "";
  const groups = groupByDay(entries);

  let i = 0;
  for (const [day, hours] of groups) {
    const section = document.createElement("section");
    section.className = "day-group";
    section.innerHTML = `
      <h2>${fmtDayLabel(day, i)}</h2>
      <div class="hour-scroll">
        ${hours
          .map(
            (h) => `
          <div class="hour-card glass">
            <span class="time">${fmtTime(h.local_datetime)}</span>
            ${icon(weatherIconFor(h.weather_desc_en))}
            <span class="temp">${h.t ?? "--"}&deg;</span>
            <span class="desc">${h.weather_desc || ""}</span>
          </div>`
          )
          .join("")}
      </div>
    `;
    container.appendChild(section);
    i += 1;
  }
}

function setBanner(id, show, text) {
  const el = document.getElementById(id);
  el.classList.toggle("show", show);
  if (text) {
    const textEl = el.querySelector("span[id$='-text']");
    if (textEl) textEl.textContent = text;
  }
}

function setLoading(loading) {
  document.getElementById("skeleton").style.display = loading ? "flex" : "none";
}

async function loadForecast(adm4, { silent } = {}) {
  if (!ADM4_RE.test(adm4)) {
    setLoading(false);
    setBanner("error-banner", true, "That doesn't look like a valid adm4 code (expected XX.XX.XX.XXXX).");
    return;
  }

  localStorage.setItem(LAST_ADM4_KEY, adm4);
  document.getElementById("adm4-input").value = adm4;
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.adm4 === adm4));
  });

  setBanner("error-banner", false);
  setBanner("stale-banner", false);
  document.getElementById("empty-state").classList.remove("show");
  document.getElementById("current-card").classList.remove("show");
  document.getElementById("forecast-days").innerHTML = "";

  const cached = readCache(adm4);
  const cacheFresh = cached && Date.now() - cached.ts < CLIENT_CACHE_MS;

  if (cached && (silent || cacheFresh)) {
    renderFromPayload(cached.payload);
    if (cacheFresh) return;
  }

  if (!cached) setLoading(true);

  try {
    const res = await fetch(`/api/weather?adm4=${encodeURIComponent(adm4)}`, { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body || body.success === false) {
      throw new Error((typeof body?.error === "string" ? body.error : null) || `Request failed (${res.status})`);
    }

    writeCache(adm4, body);
    renderFromPayload(body);
  } catch (err) {
    if (cached) {
      renderFromPayload(cached.payload);
      setBanner("stale-banner", true);
    } else {
      setBanner("error-banner", true, err.message || "Couldn't load the forecast.");
      document.getElementById("empty-state").classList.add("show");
    }
  } finally {
    setLoading(false);
  }
}

function renderFromPayload(body) {
  const record = Array.isArray(body.data) ? body.data[0] : null;
  const entries = flattenForecast(record?.cuaca);

  if (!record || entries.length === 0) {
    document.getElementById("empty-state").classList.add("show");
    return;
  }

  document.getElementById("empty-state").classList.remove("show");
  renderCurrent(body.lokasi || record.lokasi, entries);
  renderDays(entries);
}

function initPresets() {
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => loadForecast(btn.dataset.adm4));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  mountIcons();
  initPresets();

  document.getElementById("adm4-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const val = document.getElementById("adm4-input").value.trim();
    loadForecast(val || DEFAULT_ADM4);
  });

  document.getElementById("retry-btn").addEventListener("click", () => {
    const val = document.getElementById("adm4-input").value.trim() || DEFAULT_ADM4;
    loadForecast(val);
  });

  document.getElementById("refresh-btn").addEventListener("click", () => {
    const val = document.getElementById("adm4-input").value.trim() || DEFAULT_ADM4;
    localStorage.removeItem(CACHE_PREFIX + val);
    loadForecast(val);
  });

  const fromQuery = new URLSearchParams(location.search).get("adm4");
  const initial = (fromQuery && ADM4_RE.test(fromQuery) ? fromQuery : null) || localStorage.getItem(LAST_ADM4_KEY) || DEFAULT_ADM4;
  loadForecast(initial, { silent: !fromQuery });
});
