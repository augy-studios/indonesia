/* Wilayah Indonesia: cascading province -> regency -> district -> village
   picker backed by /api/wilayah (proxying the Emsifa community API). */

const CACHE_PREFIX = "idb-wilayah-cache-";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function mountIcons() {
  const map = {
    "icon-coffee": "coffee",
    "icon-palette": "palette",
    "icon-close": "close",
    "icon-layers": "layers",
    "icon-p1": "mapPin",
    "icon-p2": "mapPin",
    "icon-p3": "mapPin",
    "icon-p4": "mapPin",
    "icon-alert": "alertTriangle",
    "icon-refresh": "refresh",
    "icon-empty": "inbox",
  };
  for (const [id, name] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon(name);
  }
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
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
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* non-fatal */
  }
}

function setError(show, text) {
  document.getElementById("error-banner").classList.toggle("show", show);
  if (text) document.getElementById("error-text").textContent = text;
}

async function fetchLevel(level, parent) {
  const key = `${level}:${parent || ""}`;
  const cached = readCache(key);
  if (cached) return cached;

  const url = parent ? `/api/wilayah?level=${level}&parent=${encodeURIComponent(parent)}` : `/api/wilayah?level=${level}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);

  if (!res.ok || !body || body.success === false) {
    throw new Error((typeof body?.error === "string" ? body.error : null) || `Request failed (${res.status})`);
  }

  writeCache(key, body.data);
  return body.data;
}

function fillSelect(select, items, placeholder) {
  select.innerHTML = `<option value="">${placeholder}</option>` + items.map((i) => `<option value="${i.id}">${i.name}</option>`).join("");
  select.disabled = items.length === 0;
}

function resetSelect(select, placeholder) {
  select.innerHTML = `<option value="">${placeholder}</option>`;
  select.disabled = true;
}

function formatAdm4(villageId) {
  if (!/^\d{10}$/.test(villageId)) return null;
  return `${villageId.slice(0, 2)}.${villageId.slice(2, 4)}.${villageId.slice(4, 6)}.${villageId.slice(6, 10)}`;
}

function renderResult() {
  const province = document.getElementById("sel-province");
  const regency = document.getElementById("sel-regency");
  const district = document.getElementById("sel-district");
  const village = document.getElementById("sel-village");
  const card = document.getElementById("result-card");

  if (!village.value) {
    card.classList.remove("show");
    return;
  }

  const path = [province, regency, district, village]
    .map((s) => s.options[s.selectedIndex]?.text)
    .filter(Boolean)
    .join(" / ");

  const adm4 = formatAdm4(village.value);

  card.innerHTML = `
    <div class="result-title">${icon("mapPin")} ${path}</div>
    <div class="code-row">
      <span class="code-box">${village.value}</span>
      ${adm4 ? `<button type="button" class="btn" id="copy-btn">${icon("copy")} Copy adm4 code</button>
      <a class="btn" href="/weather?adm4=${adm4}">${icon("cloudSun")} Use in Weather</a>` : ""}
    </div>
    <p class="code-hint">Village id from the Emsifa dataset${adm4 ? `; formatted as a dotted adm4 code (${adm4}) for use with BMKG's weather API.` : "."}</p>
    ${adm4 ? `<p class="code-hint">${icon("alertTriangle")} BMKG's forecast coverage doesn't include every desa/kelurahan - this code may not have a published forecast.</p>` : ""}
  `;
  card.classList.add("show");

  const copyBtn = document.getElementById("copy-btn");
  if (copyBtn && adm4) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(adm4);
        copyBtn.innerHTML = `${icon("check")} Copied`;
        setTimeout(() => (copyBtn.innerHTML = `${icon("copy")} Copy adm4 code`), 1500);
      } catch {
        /* clipboard unavailable - user can still select the code box manually */
      }
    });
  }
}

async function onProvinceChange() {
  const province = document.getElementById("sel-province");
  const regency = document.getElementById("sel-regency");
  const district = document.getElementById("sel-district");
  const village = document.getElementById("sel-village");

  resetSelect(regency, "Select a province first");
  resetSelect(district, "Select a regency first");
  resetSelect(village, "Select a district first");
  document.getElementById("result-card").classList.remove("show");

  if (!province.value) return;

  try {
    const data = await fetchLevel("regencies", province.value);
    fillSelect(regency, data.map((d) => ({ id: d.id, name: d.name })), "Select a kabupaten/kota");
  } catch (err) {
    setError(true, err.message || "Couldn't load regencies.");
  }
}

async function onRegencyChange() {
  const regency = document.getElementById("sel-regency");
  const district = document.getElementById("sel-district");
  const village = document.getElementById("sel-village");

  resetSelect(district, "Select a regency first");
  resetSelect(village, "Select a district first");
  document.getElementById("result-card").classList.remove("show");

  if (!regency.value) return;

  try {
    const data = await fetchLevel("districts", regency.value);
    fillSelect(district, data.map((d) => ({ id: d.id, name: d.name })), "Select a kecamatan");
  } catch (err) {
    setError(true, err.message || "Couldn't load districts.");
  }
}

async function onDistrictChange() {
  const district = document.getElementById("sel-district");
  const village = document.getElementById("sel-village");

  resetSelect(village, "Select a district first");
  document.getElementById("result-card").classList.remove("show");

  if (!district.value) return;

  try {
    const data = await fetchLevel("villages", district.value);
    fillSelect(village, data.map((d) => ({ id: d.id, name: d.name })), "Select a kelurahan/desa");
    document.getElementById("empty-state").classList.toggle("show", data.length === 0);
  } catch (err) {
    setError(true, err.message || "Couldn't load villages.");
  }
}

async function loadProvinces() {
  setError(false);
  const province = document.getElementById("sel-province");
  const spinner = document.getElementById("province-spinner");
  spinner.style.display = "inline-block";
  try {
    const data = await fetchLevel("provinces");
    fillSelect(province, data.map((d) => ({ id: d.id, name: d.name })), "Select a provinsi");
  } catch (err) {
    setError(true, err.message || "Couldn't load provinces.");
    resetSelect(province, "Failed to load");
  } finally {
    spinner.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  mountIcons();
  loadProvinces();

  document.getElementById("sel-province").addEventListener("change", onProvinceChange);
  document.getElementById("sel-regency").addEventListener("change", onRegencyChange);
  document.getElementById("sel-district").addEventListener("change", onDistrictChange);
  document.getElementById("sel-village").addEventListener("change", renderResult);
  document.getElementById("retry-btn").addEventListener("click", loadProvinces);
});
