/* Earthquake & Tsunami Watch: fetches /api/quake, renders the latest felt
   quake plus a recent M5+ list, with error/empty/stale handling. */

const CACHE_KEY = "idb-quake-cache";
const CLIENT_CACHE_MS = 3 * 60 * 1000;

function mountIcons() {
  const map = {
    "icon-coffee": "coffee",
    "icon-palette": "palette",
    "icon-close": "close",
    "icon-activity": "activity",
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

function magSeverity(magStr) {
  const m = parseFloat(magStr);
  if (Number.isNaN(m)) return "ok";
  if (m >= 6) return "busy";
  if (m >= 5) return "warn";
  return "ok";
}

function isTsunamiRisk(potensi) {
  if (!potensi) return false;
  return !potensi.toLowerCase().includes("tidak berpotensi");
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ payload, ts: Date.now() }));
  } catch {
    /* non-fatal */
  }
}

function setBanner(id, show) {
  document.getElementById(id).classList.toggle("show", show);
}

function setLoading(loading) {
  document.getElementById("skeleton").style.display = loading ? "flex" : "none";
}

function renderLatest(quake) {
  const card = document.getElementById("latest-card");
  if (!quake) {
    card.classList.remove("show");
    return;
  }

  const sev = magSeverity(quake.Magnitude);
  const risk = isTsunamiRisk(quake.Potensi);

  card.innerHTML = `
    <div class="latest-top">
      <div class="mag-badge ${sev}">
        <span class="mag">${quake.Magnitude ?? "--"}</span>
        <span class="mag-label">MAGNITUDE</span>
      </div>
      <div class="latest-region">
        <h2>${quake.Wilayah || "Unknown location"}</h2>
        <div class="meta">
          <span>${icon("clock")} ${quake.Jam || ""}, ${quake.Tanggal || ""}</span>
          <span>${icon("layers")} Depth ${quake.Kedalaman || "--"}</span>
          <span>${icon("mapPin")} ${quake.Coordinates || ""}</span>
        </div>
      </div>
      <span class="tsunami-tag ${risk ? "busy" : "ok"}">
        ${icon(risk ? "waves" : "check")} ${risk ? "Tsunami potential" : "No tsunami risk"}
      </span>
    </div>
    ${quake.Dirasakan ? `<p class="latest-desc">${icon("alertTriangle")} Felt: ${quake.Dirasakan}</p>` : ""}
  `;
  card.classList.add("show");
}

function timeAgo(dateTimeIso) {
  const then = new Date(dateTimeIso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

function renderRecent(list) {
  const container = document.getElementById("quake-list");
  const title = document.getElementById("recent-title");

  if (!Array.isArray(list) || list.length === 0) {
    container.innerHTML = "";
    title.style.display = "none";
    return;
  }

  title.style.display = "block";
  container.innerHTML = list
    .map((q) => {
      const sev = magSeverity(q.Magnitude);
      const risk = isTsunamiRisk(q.Potensi);
      return `
        <div class="quake-row glass">
          <div class="mag-badge ${sev}"><span class="mag">${q.Magnitude ?? "--"}</span></div>
          <div class="info">
            <div class="region">${q.Wilayah || "Unknown location"}</div>
            <div class="meta">
              <span>${icon("clock")} ${timeAgo(q.DateTime)}</span>
              <span>${icon("layers")} ${q.Kedalaman || "--"}</span>
              ${risk ? `<span>${icon("waves")} Tsunami potential</span>` : ""}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

async function loadQuakes({ silent } = {}) {
  setBanner("error-banner", false);
  setBanner("stale-banner", false);

  const cached = readCache();
  const cacheFresh = cached && Date.now() - cached.ts < CLIENT_CACHE_MS;

  if (cached && (silent || cacheFresh)) {
    render(cached.payload);
    setLoading(false);
    if (cacheFresh) return;
  }

  if (!cached) setLoading(true);

  try {
    const res = await fetch("/api/quake", { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body || body.success === false) {
      throw new Error((typeof body?.error === "string" ? body.error : null) || `Request failed (${res.status})`);
    }

    writeCache(body);
    render(body);
  } catch (err) {
    if (cached) {
      render(cached.payload);
      setBanner("stale-banner", true);
    } else {
      setBanner("error-banner", true);
      document.getElementById("error-text").textContent = err.message || "Couldn't load earthquake data.";
      document.getElementById("empty-state").classList.add("show");
    }
  } finally {
    setLoading(false);
  }
}

function render(body) {
  const hasLatest = !!body.latest;
  const hasRecent = Array.isArray(body.recent) && body.recent.length > 0;

  document.getElementById("empty-state").classList.toggle("show", !hasLatest && !hasRecent);

  renderLatest(body.latest);
  renderRecent(body.recent);

  const updated = document.getElementById("updated-line");
  if (body.fetchedAt) {
    const d = new Date(body.fetchedAt);
    updated.innerHTML = `${icon("clock")} Updated ${d.toLocaleTimeString()}`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  mountIcons();

  document.getElementById("retry-btn").addEventListener("click", () => loadQuakes());
  document.getElementById("refresh-btn").addEventListener("click", () => {
    localStorage.removeItem(CACHE_KEY);
    loadQuakes();
  });

  loadQuakes({ silent: true });
});
