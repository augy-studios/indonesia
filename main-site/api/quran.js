// Serverless proxy for the EQuran.id community Quran API.
// Three shapes: the 114-surah index, a single surah with its ayat, and a
// single surah's tafsir. Content is static, so we cache hard and lean on
// stale data on failure.

const SURAT_BASE = "https://equran.id/api/v2/surat";
const TAFSIR_BASE = "https://equran.id/api/v2/tafsir";
const SURAT_RE = /^([1-9]|[1-9][0-9]|1[01][0-9])$/; // 1-114

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 40;

const cache = new Map();
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const nomor = typeof req.query.nomor === "string" ? req.query.nomor.trim() : "";
  const isList = nomor === "";
  const wantsTafsir = req.query.tafsir === "1";

  if (!isList && !SURAT_RE.test(nomor)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ success: false, error: "Invalid surah number (expected 1-114)." }));
    return;
  }
  if (isList && wantsTafsir) {
    res.statusCode = 400;
    res.end(JSON.stringify({ success: false, error: "A surah number is required for tafsir." }));
    return;
  }

  const key = isList ? "list" : wantsTafsir ? `tafsir:${nomor}` : `surat:${nomor}`;

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "60");
    res.statusCode = 429;
    res.end(JSON.stringify({ success: false, error: "Too many requests. Please try again in a minute." }));
    return;
  }

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=2592000");
    res.setHeader("X-Cache", "HIT");
    res.statusCode = 200;
    res.end(cached.body);
    return;
  }

  try {
    const url = isList ? SURAT_BASE : wantsTafsir ? `${TAFSIR_BASE}/${nomor}` : `${SURAT_BASE}/${nomor}`;
    const upstream = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);

    if (!upstream.ok) {
      if (cached) {
        res.setHeader("X-Cache", "STALE");
        res.statusCode = 200;
        res.end(cached.body);
        return;
      }
      res.statusCode = upstream.status === 404 ? 404 : 502;
      res.end(JSON.stringify({ success: false, error: `Upstream responded with status ${upstream.status}.` }));
      return;
    }

    let json;
    try {
      json = await upstream.json();
    } catch {
      json = null;
    }

    const data = json && typeof json === "object" ? json.data : null;
    const valid = isList
      ? Array.isArray(data) && data.length > 0
      : wantsTafsir
      ? data && typeof data === "object" && Array.isArray(data.tafsir)
      : data && typeof data === "object" && Array.isArray(data.ayat);

    if (!valid) {
      if (cached) {
        res.setHeader("X-Cache", "STALE");
        res.statusCode = 200;
        res.end(cached.body);
        return;
      }
      res.statusCode = 502;
      res.end(JSON.stringify({ success: false, error: "Upstream returned an unexpected or empty response shape." }));
      return;
    }

    const body = JSON.stringify({ success: true, fetchedAt: new Date().toISOString(), data });
    cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });

    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=2592000");
    res.setHeader("X-Cache", "MISS");
    res.statusCode = 200;
    res.end(body);
  } catch (err) {
    if (cached) {
      res.setHeader("X-Cache", "STALE");
      res.statusCode = 200;
      res.end(cached.body);
      return;
    }
    const timedOut = err && err.name === "AbortError";
    res.statusCode = 504;
    res.end(JSON.stringify({ success: false, error: timedOut ? "Timed out reaching the Quran API." : "Could not reach the Quran API." }));
  }
};
