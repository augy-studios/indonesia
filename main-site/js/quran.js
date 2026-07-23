/* Quran: fetches /api/quran, renders the surah list and per-surah detail. */

const LIST_CACHE_KEY = "idb-quran-list";
const DETAIL_CACHE_PREFIX = "idb-quran-detail-";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let surahList = [];
let currentAudio = null;
let currentAudioBtn = null;

function mountIcons() {
  const map = {
    "icon-coffee": "coffee",
    "icon-palette": "palette",
    "icon-close": "close",
    "icon-quran": "book",
    "icon-search": "search",
    "icon-alert": "alertTriangle",
    "icon-refresh": "refresh",
    "icon-empty": "inbox",
    "icon-back": "chevronLeft",
  };
  for (const [id, name] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon(name);
  }
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* non-fatal */
  }
}

function setError(show, text) {
  document.getElementById("error-banner").classList.toggle("show", show);
  if (text) document.getElementById("error-text").textContent = text;
}

function renderSurahGrid(filter) {
  const grid = document.getElementById("surah-grid");
  const empty = document.getElementById("list-empty");
  const q = (filter || "").trim().toLowerCase();

  const visible = surahList.filter(
    (s) => !q || String(s.nomor) === q || (s.namaLatin || "").toLowerCase().includes(q) || (s.arti || "").toLowerCase().includes(q)
  );

  grid.innerHTML = visible
    .map(
      (s) => `
      <button type="button" class="surah-card glass" data-nomor="${s.nomor}">
        <span class="surah-num">${s.nomor}</span>
        <span class="info">
          <span class="name-row">
            <span class="name-latin">${s.namaLatin}</span>
            <span class="name-arab">${s.nama || ""}</span>
          </span>
          <span class="meta">${s.arti || ""} - ${s.jumlahAyat || "?"} ayat - ${s.tempatTurun || ""}</span>
        </span>
      </button>
    `
    )
    .join("");

  empty.classList.toggle("show", visible.length === 0);

  grid.querySelectorAll(".surah-card").forEach((btn) => {
    btn.addEventListener("click", () => openSurah(btn.dataset.nomor));
  });
}

async function loadList() {
  setError(false);
  const cached = readCache(LIST_CACHE_KEY);
  if (cached) {
    surahList = cached;
    renderSurahGrid("");
    document.getElementById("list-skeleton").style.display = "none";
  } else {
    document.getElementById("list-skeleton").style.display = "flex";
  }

  try {
    const res = await fetch("/api/quran", { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body || body.success === false) {
      throw new Error((typeof body?.error === "string" ? body.error : null) || `Request failed (${res.status})`);
    }

    surahList = body.data;
    writeCache(LIST_CACHE_KEY, body.data);
    renderSurahGrid(document.getElementById("surah-search").value);
  } catch (err) {
    if (!cached) {
      setError(true, err.message || "Couldn't load the surah list.");
    }
  } finally {
    document.getElementById("list-skeleton").style.display = "none";
  }
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentAudioBtn) {
    currentAudioBtn.innerHTML = icon("play");
    currentAudioBtn = null;
  }
}

function toggleAyatAudio(btn, url) {
  if (!url) return;
  if (currentAudioBtn === btn) {
    stopAudio();
    return;
  }
  stopAudio();
  currentAudio = new Audio(url);
  currentAudio.play().catch(() => {});
  currentAudio.addEventListener("ended", stopAudio);
  btn.innerHTML = icon("pause");
  currentAudioBtn = btn;
}

function renderDetail(data) {
  const header = document.getElementById("surah-header");
  const list = document.getElementById("ayat-list");

  header.innerHTML = `
    <div class="surah-header glass">
      <div class="name-row">
        <h2>${data.namaLatin} <span style="color:var(--muted); font-weight:normal;">- ${data.arti || ""}</span></h2>
        <span class="name-arab">${data.nama || ""}</span>
      </div>
      <div class="meta">
        <span>${icon("book")} ${data.jumlahAyat || "?"} ayat</span>
        <span>${icon("mapPin")} ${data.tempatTurun || ""}</span>
      </div>
    </div>
  `;

  const ayat = Array.isArray(data.ayat) ? data.ayat : [];

  if (ayat.length === 0) {
    list.innerHTML = `<div class="empty-state show">${icon("inbox")}<p>No ayat data available for this surah.</p></div>`;
    return;
  }

  list.innerHTML = ayat
    .map(
      (a) => `
      <div class="ayat-card glass">
        <div class="ayat-top">
          <span class="ayat-num">${a.nomorAyat}</span>
          <button type="button" class="play-btn" data-audio="${a.audio?.["05"] || a.audio?.["01"] || ""}" aria-label="Play recitation">${icon("play")}</button>
        </div>
        <div class="ayat-arab">${a.teksArab || ""}</div>
        ${a.teksLatin ? `<div class="ayat-latin">${a.teksLatin}</div>` : ""}
        ${a.teksIndonesia ? `<div class="ayat-idn">${a.teksIndonesia}</div>` : ""}
      </div>
    `
    )
    .join("");

  list.querySelectorAll(".play-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleAyatAudio(btn, btn.dataset.audio));
  });
}

async function openSurah(nomor) {
  stopAudio();
  document.getElementById("list-view").style.display = "none";
  document.getElementById("detail-view").classList.add("show");
  document.getElementById("surah-header").innerHTML = "";
  document.getElementById("ayat-list").innerHTML = "";
  setError(false);

  const url = new URL(location.href);
  url.searchParams.set("nomor", nomor);
  history.replaceState(null, "", url);

  const cacheKey = DETAIL_CACHE_PREFIX + nomor;
  const cached = readCache(cacheKey);
  if (cached) {
    renderDetail(cached);
    document.getElementById("detail-skeleton").style.display = "none";
  } else {
    document.getElementById("detail-skeleton").style.display = "flex";
  }

  try {
    const res = await fetch(`/api/quran?nomor=${encodeURIComponent(nomor)}`, { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body || body.success === false) {
      throw new Error((typeof body?.error === "string" ? body.error : null) || `Request failed (${res.status})`);
    }

    writeCache(cacheKey, body.data);
    renderDetail(body.data);
  } catch (err) {
    if (!cached) {
      setError(true, err.message || "Couldn't load this surah.");
    }
  } finally {
    document.getElementById("detail-skeleton").style.display = "none";
  }
}

function backToList() {
  stopAudio();
  document.getElementById("detail-view").classList.remove("show");
  document.getElementById("list-view").style.display = "block";
  const url = new URL(location.href);
  url.searchParams.delete("nomor");
  history.replaceState(null, "", url);
}

document.addEventListener("DOMContentLoaded", () => {
  mountIcons();
  loadList();

  document.getElementById("surah-search").addEventListener("input", (e) => renderSurahGrid(e.target.value));
  document.getElementById("back-btn").addEventListener("click", backToList);
  document.getElementById("retry-btn").addEventListener("click", () => {
    if (document.getElementById("detail-view").classList.contains("show")) {
      const nomor = new URLSearchParams(location.search).get("nomor");
      if (nomor) openSurah(nomor);
    } else {
      loadList();
    }
  });

  const nomor = new URLSearchParams(location.search).get("nomor");
  if (nomor) openSurah(nomor);
});
