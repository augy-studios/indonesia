/* Quran: fetches /api/quran, renders the surah list and per-surah detail,
   plus per-ayat tafsir/copy/share and a full-surah sequential audio player
   with a per-verse seek bar. */

const LIST_CACHE_KEY = "idb-quran-list";
const DETAIL_CACHE_PREFIX = "idb-quran-detail-";
const TAFSIR_CACHE_PREFIX = "idb-quran-tafsir-";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let surahList = [];
let currentSurah = null; // { nomor, namaLatin, ayat, ... } for the open detail view

/* ---------- shared audio engine ----------
   A single <audio> element is reused by both "play one ayat" buttons and
   the "play full surah" sequence, so the two modes never fight each other. */

let currentAudio = null;
let currentAudioBtn = null; // the ayat-card play button currently showing "pause"
let sequence = null; // { ayat, index } while sequential (full-surah) playback is active

function ayatAudioUrl(a) {
  return a?.audio?.["05"] || a?.audio?.["01"] || "";
}

function setBtnPlaying(btn, playing) {
  if (!btn) return;
  btn.innerHTML = icon(playing ? "pause" : "play");
  btn.closest(".ayat-card")?.classList.toggle("playing", playing);
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentAudioBtn) {
    setBtnPlaying(currentAudioBtn, false);
    currentAudioBtn = null;
  }
  sequence = null;
  updateFullPlayerUI();
}

function playSingleAyat(btn, url) {
  if (currentAudioBtn === btn && currentAudio) {
    stopAudio();
    return;
  }
  stopAudio();
  if (!url) return;
  currentAudio = new Audio(url);
  currentAudioBtn = btn;
  setBtnPlaying(btn, true);
  currentAudio.play().catch(() => {});
  currentAudio.onended = () => stopAudio();
}

function playSequenceFrom(index) {
  if (!sequence) return;
  const item = sequence.ayat[index];

  if (!item) {
    stopAudio();
    return;
  }

  sequence.index = index;
  const url = ayatAudioUrl(item);

  if (currentAudio) currentAudio.onended = null;
  if (currentAudioBtn) setBtnPlaying(currentAudioBtn, false);

  currentAudioBtn = document.querySelector(`.ayat-icon-btn.play[data-nomor-ayat="${item.nomorAyat}"]`);
  updateFullPlayerUI();

  if (!url) {
    // No recitation for this ayat - skip ahead rather than stalling.
    playSequenceFrom(index + 1);
    return;
  }

  setBtnPlaying(currentAudioBtn, true);
  currentAudio = new Audio(url);
  currentAudio.play().catch(() => {});
  currentAudio.onended = () => {
    if (sequence && sequence.index === index) playSequenceFrom(index + 1);
  };
}

function startSequence(ayat, fromIndex) {
  stopAudio();
  sequence = { ayat, index: fromIndex };
  playSequenceFrom(fromIndex);
}

function toggleSequencePlayPause() {
  if (sequence && currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    updateFullPlayerUI();
    return;
  }
  if (sequence && currentAudio && currentAudio.paused) {
    currentAudio.play().catch(() => {});
    updateFullPlayerUI();
    return;
  }
  if (currentSurah?.ayat?.length) {
    startSequence(currentSurah.ayat, 0);
  }
}

function updateFullPlayerUI() {
  const playBtn = document.getElementById("full-play-btn");
  const label = document.getElementById("full-play-label");
  const seekLabel = document.getElementById("seek-label");
  const track = document.getElementById("seek-track");
  if (!playBtn || !track) return;

  const playing = !!(sequence && currentAudio && !currentAudio.paused);
  const iconEl = playBtn.querySelector(".icon");
  if (iconEl) iconEl.outerHTML = icon(playing ? "pause" : "play");

  const total = currentSurah?.ayat?.length || 0;
  if (sequence) {
    label.textContent = playing ? "Pause" : "Resume";
    seekLabel.textContent = `Ayat ${sequence.index + 1} of ${total}`;
  } else {
    label.textContent = "Play Full Surah";
    seekLabel.textContent = total ? `${total} ayat` : "";
  }

  track.querySelectorAll(".seek-seg").forEach((seg, i) => {
    seg.classList.toggle("current", !!sequence && i === sequence.index);
    seg.classList.toggle("played", !!sequence && i < sequence.index);
  });
}

function renderFullPlayer(ayat) {
  const panel = document.getElementById("full-player");
  const track = document.getElementById("seek-track");
  if (!ayat.length) {
    panel.style.display = "none";
    return;
  }

  track.innerHTML = ayat
    .map((a) => `<div class="seek-seg" data-index="${a.nomorAyat - 1}" title="Ayat ${a.nomorAyat}"></div>`)
    .join("");

  track.querySelectorAll(".seek-seg").forEach((seg) => {
    seg.addEventListener("click", () => startSequence(currentSurah.ayat, Number(seg.dataset.index)));
  });

  panel.style.display = "flex";
  updateFullPlayerUI();
}

/* ---------- tafsir ---------- */

function readTafsirCache(nomorSurah) {
  try {
    const raw = localStorage.getItem(TAFSIR_CACHE_PREFIX + nomorSurah);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeTafsirCache(nomorSurah, data) {
  try {
    localStorage.setItem(TAFSIR_CACHE_PREFIX + nomorSurah, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* non-fatal */
  }
}

async function getTafsir(nomorSurah) {
  const cached = readTafsirCache(nomorSurah);
  if (cached) return cached;

  const res = await fetch(`/api/quran?nomor=${nomorSurah}&tafsir=1`, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);

  if (!res.ok || !body || body.success === false) {
    throw new Error((typeof body?.error === "string" ? body.error : null) || `Request failed (${res.status})`);
  }

  writeTafsirCache(nomorSurah, body.data.tafsir);
  return body.data.tafsir;
}

async function toggleTafsir(btn, ayatCard, nomorAyat) {
  const existing = ayatCard.querySelector(".tafsir-panel");
  if (existing) {
    existing.remove();
    btn.classList.remove("active");
    return;
  }

  btn.classList.add("active");
  const panel = document.createElement("div");
  panel.className = "tafsir-panel";
  panel.textContent = "Loading tafsir…";
  ayatCard.appendChild(panel);

  try {
    const tafsir = await getTafsir(currentSurah.nomor);
    const entry = tafsir.find((t) => Number(t.ayat) === Number(nomorAyat));
    panel.textContent = entry?.teks || "No tafsir available for this ayat.";
  } catch (err) {
    panel.textContent = err.message || "Couldn't load tafsir.";
  }
}

/* ---------- copy / share ---------- */

function ayatPlainText(a) {
  const parts = [a.teksArab, a.teksLatin, a.teksIndonesia].filter(Boolean);
  const ref = currentSurah ? `${currentSurah.namaLatin} ${a.nomorAyat}` : `Ayat ${a.nomorAyat}`;
  return `${ref}\n\n${parts.join("\n\n")}`;
}

async function copyAyat(btn, a) {
  try {
    await navigator.clipboard.writeText(ayatPlainText(a));
    const original = btn.innerHTML;
    btn.innerHTML = icon("check");
    setTimeout(() => (btn.innerHTML = original), 1500);
  } catch {
    /* clipboard unavailable - nothing more we can do here */
  }
}

async function shareAyat(btn, a) {
  const url = new URL(location.href);
  url.searchParams.set("nomor", currentSurah.nomor);
  url.searchParams.set("ayat", a.nomorAyat);

  const shareData = {
    title: `${currentSurah.namaLatin} ${a.nomorAyat}`,
    text: a.teksIndonesia || ayatPlainText(a),
    url: url.toString(),
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch {
      /* user cancelled the share sheet - not an error */
    }
    return;
  }

  // No Web Share API (desktop browsers, non-HTTPS) - fall back to copying
  // the link so the user still has something to paste.
  try {
    await navigator.clipboard.writeText(`${shareData.text}\n\n${shareData.url}`);
    const original = btn.innerHTML;
    btn.innerHTML = icon("check");
    setTimeout(() => (btn.innerHTML = original), 1500);
  } catch {
    /* clipboard unavailable too - silently give up */
  }
}

/* ---------- rendering ---------- */

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
    "icon-play-full": "play",
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

function renderDetail(data) {
  currentSurah = data;

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
  renderFullPlayer(ayat);

  if (ayat.length === 0) {
    list.innerHTML = `<div class="empty-state show">${icon("inbox")}<p>No ayat data available for this surah.</p></div>`;
    return;
  }

  list.innerHTML = ayat
    .map(
      (a) => `
      <div class="ayat-card glass" data-nomor-ayat="${a.nomorAyat}">
        <div class="ayat-top">
          <span class="ayat-num">${a.nomorAyat}</span>
          <div class="ayat-actions">
            <button type="button" class="ayat-icon-btn play" data-nomor-ayat="${a.nomorAyat}" data-audio="${ayatAudioUrl(a)}" aria-label="Play recitation">${icon("play")}</button>
            <button type="button" class="ayat-icon-btn tafsir" aria-label="View tafsir">${icon("fileText")}</button>
            <button type="button" class="ayat-icon-btn copy" aria-label="Copy verse">${icon("copy")}</button>
            <button type="button" class="ayat-icon-btn share" aria-label="Share verse">${icon("share")}</button>
          </div>
        </div>
        <div class="ayat-arab">${a.teksArab || ""}</div>
        ${a.teksLatin ? `<div class="ayat-latin">${a.teksLatin}</div>` : ""}
        ${a.teksIndonesia ? `<div class="ayat-idn">${a.teksIndonesia}</div>` : ""}
      </div>
    `
    )
    .join("");

  list.querySelectorAll(".ayat-card").forEach((card) => {
    const nomorAyat = Number(card.dataset.nomorAyat);
    const a = ayat.find((x) => x.nomorAyat === nomorAyat);
    if (!a) return;

    card.querySelector(".ayat-icon-btn.play").addEventListener("click", (e) => {
      playSingleAyat(e.currentTarget, ayatAudioUrl(a));
    });
    card.querySelector(".ayat-icon-btn.tafsir").addEventListener("click", (e) => {
      toggleTafsir(e.currentTarget, card, nomorAyat);
    });
    card.querySelector(".ayat-icon-btn.copy").addEventListener("click", (e) => {
      copyAyat(e.currentTarget, a);
    });
    card.querySelector(".ayat-icon-btn.share").addEventListener("click", (e) => {
      shareAyat(e.currentTarget, a);
    });
  });
}

async function openSurah(nomor) {
  stopAudio();
  currentSurah = null;
  document.getElementById("list-view").style.display = "none";
  document.getElementById("detail-view").classList.add("show");
  document.getElementById("surah-header").innerHTML = "";
  document.getElementById("ayat-list").innerHTML = "";
  document.getElementById("full-player").style.display = "none";
  setError(false);

  const url = new URL(location.href);
  url.searchParams.set("nomor", nomor);
  url.searchParams.delete("ayat");
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
  currentSurah = null;
  document.getElementById("detail-view").classList.remove("show");
  document.getElementById("list-view").style.display = "block";
  const url = new URL(location.href);
  url.searchParams.delete("nomor");
  url.searchParams.delete("ayat");
  history.replaceState(null, "", url);
}

document.addEventListener("DOMContentLoaded", () => {
  mountIcons();
  loadList();

  document.getElementById("surah-search").addEventListener("input", (e) => renderSurahGrid(e.target.value));
  document.getElementById("back-btn").addEventListener("click", backToList);
  document.getElementById("full-play-btn").addEventListener("click", toggleSequencePlayPause);
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
