/* Directory / search homepage */

const PAGES = [
  {
    title: "Weather Forecast",
    desc: "Village-level weather forecasts across Indonesia, straight from BMKG.",
    href: "/weather",
    icon: "cloudSun",
    tags: "weather cuaca forecast bmkg rain temperature hujan",
  },
  {
    title: "Earthquake & Tsunami Watch",
    desc: "Latest quakes and tsunami potential from BMKG's real-time seismic feed.",
    href: "/quake",
    icon: "activity",
    tags: "earthquake gempa tsunami seismic bmkg magnitude",
  },
  {
    title: "Crypto Ticker (IDR)",
    desc: "Live rupiah-denominated crypto prices, from Indodax's public ticker.",
    href: "/crypto",
    icon: "coin",
    tags: "crypto bitcoin btc eth indodax price idr ticker",
  },
  {
    title: "Wilayah Indonesia",
    desc: "Browse provinces down to villages, with official area codes.",
    href: "/emsifa",
    icon: "layers",
    tags: "wilayah region province regency district village kode",
  },
  {
    title: "Postal Code Lookup",
    desc: "Find a kode pos by kelurahan, kecamatan, or city name.",
    href: "/kodepos",
    icon: "mail",
    tags: "postal code pos kodepos zip address",
  },
  {
    title: "Public Holidays",
    desc: "Indonesia's national holidays and joint leave days (cuti bersama).",
    href: "/holidays",
    icon: "calendar",
    tags: "holiday libur cuti bersama calendar",
  },
  {
    title: "Quran",
    desc: "All 114 surah with Indonesian translation, transliteration and audio.",
    href: "/quran",
    icon: "book",
    tags: "quran koran surah ayat islam tafsir equran",
  },
];

function mountHeaderIcons() {
  const map = {
    "icon-coffee": "coffee",
    "icon-palette": "palette",
    "icon-search": "search",
    "icon-inbox": "inbox",
    "icon-close": "close",
  };
  for (const [id, name] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon(name);
  }
}

function cardMarkup(page) {
  return `
    <a class="page-card glass" href="${page.href}" data-tags="${page.title.toLowerCase()} ${page.tags}">
      <div class="card-icon">${icon(page.icon)}</div>
      <h3>${page.title}</h3>
      <p>${page.desc}</p>
      <div class="card-foot">${icon("arrowRight")}</div>
    </a>
  `;
}

function renderGrid(filter) {
  const grid = document.getElementById("page-grid");
  const noResults = document.getElementById("no-results");
  const q = (filter || "").trim().toLowerCase();

  const visible = PAGES.filter((p) => !q || `${p.title} ${p.tags}`.toLowerCase().includes(q));

  grid.innerHTML = visible.map(cardMarkup).join("");
  noResults.classList.toggle("show", visible.length === 0);
}

document.addEventListener("DOMContentLoaded", () => {
  mountHeaderIcons();
  renderGrid("");

  const input = document.getElementById("page-search");
  input.addEventListener("input", () => renderGrid(input.value));
});
