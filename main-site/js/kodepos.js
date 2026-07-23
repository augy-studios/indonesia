/* Postal Code Lookup: fetches /api/kodepos, renders results. */

const LAST_Q_KEY = "idb-kodepos-last-q";
const CACHE_PREFIX = "idb-kodepos-cache-";
const CLIENT_CACHE_MS = 30 * 60 * 1000;

function mountIcons() {
  const map = {
    "icon-coffee": "coffee",
    "icon-palette": "palette",
    "icon-close": "close",
    "icon-mail": "mail",
    "icon-search": "search",
    "icon-alert": "alertTriangle",
    "icon-refresh": "refresh",
    "icon-empty": "inbox",
  };
  for (const [id, name] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon(name);
  }
}

function readCache(q) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + q.toLowerCase());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > CLIENT_CACHE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(q, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + q.toLowerCase(), JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* non-fatal */
  }
}

function setError(show, text) {
  document.getElementById("error-banner").classList.toggle("show", show);
  if (text) document.getElementById("error-text").textContent = text;
}

function renderResults(rows) {
  const list = document.getElementById("result-list");
  const empty = document.getElementById("empty-state");

  if (!rows || rows.length === 0) {
    list.innerHTML = "";
    empty.classList.add("show");
    return;
  }

  empty.classList.remove("show");
  list.innerHTML = rows
    .map(
      (r) => `
      <div class="result-row glass">
        <span class="code-badge">${r.code ?? "--"}</span>
        <div class="info">
          <div class="place">${[r.village, r.district].filter(Boolean).join(", ")}</div>
          <div class="meta">
            <span>${icon("mapPin")} ${[r.regency, r.province].filter(Boolean).join(", ")}</span>
            ${r.timezone ? `<span>${icon("clock")} ${r.timezone}</span>` : ""}
            ${Number.isFinite(r.latitude) && Number.isFinite(r.longitude) ? `<span>${icon("layers")} ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}</span>` : ""}
          </div>
        </div>
      </div>
    `
    )
    .join("");
}

async function search(q, { silent } = {}) {
  if (!q) return;

  localStorage.setItem(LAST_Q_KEY, q);
  document.getElementById("q-input").value = q;
  setError(false);

  const cached = readCache(q);
  if (cached) {
    renderResults(cached);
    if (silent) return;
  }

  if (!cached) document.getElementById("skeleton").style.display = "flex";

  try {
    const res = await fetch(`/api/kodepos?q=${encodeURIComponent(q)}`, { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body || body.success === false) {
      throw new Error((typeof body?.error === "string" ? body.error : null) || `Request failed (${res.status})`);
    }

    writeCache(q, body.data);
    renderResults(body.data);
  } catch (err) {
    if (!cached) {
      setError(true, err.message || "Couldn't search postal codes.");
      renderResults([]);
    }
  } finally {
    document.getElementById("skeleton").style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  mountIcons();

  document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    search(document.getElementById("q-input").value.trim());
  });

  document.getElementById("retry-btn").addEventListener("click", () => {
    search(document.getElementById("q-input").value.trim());
  });

  const last = localStorage.getItem(LAST_Q_KEY);
  if (last) search(last, { silent: true });
  else document.getElementById("empty-state").classList.add("show");
});
