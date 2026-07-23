// Serverless proxy for BMKG's public earthquake (TEWS) feed.
// Combines the "latest felt quake" and "recent M5+ quakes" feeds, with
// timeout, shape validation, in-memory caching and a per-IP rate limit -
// the feed updates continuously, so caching is short-lived.

const AUTOGEMPA_URL = "https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json";
const TERKINI_URL = "https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json";

const CACHE_TTL_MS = 3 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;

let cache = null; // { body, expiresAt }
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

async function fetchJsonWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Upstream status ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "60");
    res.statusCode = 429;
    res.end(JSON.stringify({ success: false, error: "Too many requests. Please try again in a minute." }));
    return;
  }

  if (cache && cache.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    res.setHeader("X-Cache", "HIT");
    res.statusCode = 200;
    res.end(cache.body);
    return;
  }

  try {
    const [autoRaw, terkiniRaw] = await Promise.all([
      fetchJsonWithTimeout(AUTOGEMPA_URL, FETCH_TIMEOUT_MS),
      fetchJsonWithTimeout(TERKINI_URL, FETCH_TIMEOUT_MS),
    ]);

    const latest = autoRaw?.Infogempa?.gempa;
    const recentRaw = terkiniRaw?.Infogempa?.gempa;
    const recent = Array.isArray(recentRaw) ? recentRaw : recentRaw ? [recentRaw] : [];

    if (!latest && recent.length === 0) {
      if (cache) {
        res.setHeader("X-Cache", "STALE");
        res.statusCode = 200;
        res.end(cache.body);
        return;
      }
      res.statusCode = 502;
      res.end(JSON.stringify({ success: false, error: "BMKG returned an unexpected or empty response shape." }));
      return;
    }

    const body = JSON.stringify({
      success: true,
      fetchedAt: new Date().toISOString(),
      latest: latest || null,
      recent,
    });

    cache = { body, expiresAt: Date.now() + CACHE_TTL_MS };

    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    res.setHeader("X-Cache", "MISS");
    res.statusCode = 200;
    res.end(body);
  } catch (err) {
    if (cache) {
      res.setHeader("X-Cache", "STALE");
      res.statusCode = 200;
      res.end(cache.body);
      return;
    }
    const timedOut = err && err.name === "AbortError";
    res.statusCode = 504;
    res.end(
      JSON.stringify({
        success: false,
        error: timedOut ? "Timed out reaching BMKG." : "Could not reach BMKG.",
      })
    );
  }
};
