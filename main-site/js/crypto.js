/* Crypto Ticker (IDR): fetches /api/crypto, renders Indodax price data. */

const PAIR_RE = /^[a-z0-9]{2,15}idr$/;
const DEFAULT_PAIR = "btcidr";
const LAST_PAIR_KEY = "idb-crypto-last-pair";
const CACHE_PREFIX = "idb-crypto-cache-";
const CLIENT_CACHE_MS = 20 * 1000;

const PRESETS = [
  { pair: "btcidr", label: "BTC" },
  { pair: "ethidr", label: "ETH" },
  { pair: "usdtidr", label: "USDT" },
  { pair: "bnbidr", label: "BNB" },
  { pair: "solidr", label: "SOL" },
  { pair: "xrpidr", label: "XRP" },
  { pair: "dogeidr", label: "DOGE" },
];

function mountIcons() {
  const map = {
    "icon-coffee": "coffee",
    "icon-crypto": "coin",
    "icon-search": "search",
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

function mountPresets() {
  const row = document.getElementById("preset-row");
  row.innerHTML = PRESETS.map(
    (p) => `<button type="button" class="preset-btn" data-pair="${p.pair}" aria-pressed="false">${p.label}</button>`
  ).join("");
  row.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => loadTicker(btn.dataset.pair));
  });
}

function fmtIdr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return "Rp " + n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function readCache(pair) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + pair);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(pair, payload) {
  try {
    localStorage.setItem(CACHE_PREFIX + pair, JSON.stringify({ payload, ts: Date.now() }));
  } catch {
    /* non-fatal */
  }
}

function setBanner(id, show, text) {
  const el = document.getElementById(id);
  el.classList.toggle("show", show);
  if (text) {
    const textEl = document.getElementById("error-text");
    if (textEl && id === "error-banner") textEl.textContent = text;
  }
}

function setLoading(loading) {
  document.getElementById("skeleton").style.display = loading ? "flex" : "none";
}

function renderTicker(pair, t) {
  const card = document.getElementById("ticker-card");
  const label = (PRESETS.find((p) => p.pair === pair) || {}).label || pair.replace(/idr$/, "").toUpperCase();

  card.innerHTML = `
    <div class="ticker-top">
      <div class="ticker-last">${fmtIdr(t.last)}</div>
      <div class="ticker-pair">${label} / IDR</div>
    </div>
    <div class="stat-grid">
      <div class="stat-tile"><div class="label">${icon("trendUp")} 24h High</div><div class="value">${fmtIdr(t.high)}</div></div>
      <div class="stat-tile"><div class="label">${icon("trendDown")} 24h Low</div><div class="value">${fmtIdr(t.low)}</div></div>
      <div class="stat-tile"><div class="label">${icon("tag")} Best Bid</div><div class="value">${fmtIdr(t.buy)}</div></div>
      <div class="stat-tile"><div class="label">${icon("tag")} Best Ask</div><div class="value">${fmtIdr(t.sell)}</div></div>
      <div class="stat-tile"><div class="label">${icon("barChart")} Volume (${label})</div><div class="value">${t["vol_" + pair.replace(/idr$/, "")] ?? "--"}</div></div>
      <div class="stat-tile"><div class="label">${icon("barChart")} Volume (IDR)</div><div class="value">${fmtIdr(t.vol_idr)}</div></div>
    </div>
    <div class="updated-line">${icon("clock")} Server time ${t.server_time ? new Date(t.server_time * 1000).toLocaleTimeString() : "--"}</div>
    <div class="disclaimer">${icon("alertTriangle")} Prices are for information only and are not financial advice.</div>
  `;
  card.classList.add("show");
}

async function loadTicker(pair, { silent } = {}) {
  if (!PAIR_RE.test(pair)) {
    setBanner("error-banner", true, "That doesn't look like a valid pair, e.g. btcidr.");
    return;
  }

  localStorage.setItem(LAST_PAIR_KEY, pair);
  document.getElementById("pair-input").value = pair;
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.pair === pair));
  });

  setBanner("error-banner", false);
  setBanner("stale-banner", false);
  document.getElementById("empty-state").classList.remove("show");
  document.getElementById("ticker-card").classList.remove("show");

  const cached = readCache(pair);
  const cacheFresh = cached && Date.now() - cached.ts < CLIENT_CACHE_MS;

  if (cached && (silent || cacheFresh)) {
    renderTicker(pair, cached.payload.ticker);
    setLoading(false);
    if (cacheFresh) return;
  }

  if (!cached) setLoading(true);

  try {
    const res = await fetch(`/api/crypto?pair=${encodeURIComponent(pair)}`, { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body || body.success === false) {
      throw new Error((typeof body?.error === "string" ? body.error : null) || `Request failed (${res.status})`);
    }

    writeCache(pair, body);
    renderTicker(pair, body.ticker);
  } catch (err) {
    if (cached) {
      renderTicker(pair, cached.payload.ticker);
      setBanner("stale-banner", true);
    } else {
      setBanner("error-banner", true, err.message || "Couldn't load the ticker.");
      document.getElementById("empty-state").classList.add("show");
    }
  } finally {
    setLoading(false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  mountIcons();
  mountPresets();

  document.getElementById("pair-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const val = document.getElementById("pair-input").value.trim().toLowerCase();
    loadTicker(val || DEFAULT_PAIR);
  });

  document.getElementById("retry-btn").addEventListener("click", () => {
    const val = document.getElementById("pair-input").value.trim().toLowerCase() || DEFAULT_PAIR;
    loadTicker(val);
  });

  document.getElementById("refresh-btn").addEventListener("click", () => {
    const val = document.getElementById("pair-input").value.trim().toLowerCase() || DEFAULT_PAIR;
    localStorage.removeItem(CACHE_PREFIX + val);
    loadTicker(val);
  });

  const initial = localStorage.getItem(LAST_PAIR_KEY) || DEFAULT_PAIR;
  loadTicker(initial, { silent: true });
});
