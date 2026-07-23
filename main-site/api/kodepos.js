// Serverless proxy for the "KodePos Indonesia" community postal-code API.
// Adds: query validation, timeout, shape checks, short in-memory caching
// and a per-IP rate limit.

const BASE = "https://kodepos.vercel.app/search";
const QUERY_RE = /^[a-zA-Z0-9 .'-]{2,80}$/;

const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;

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

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!QUERY_RE.test(q)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ success: false, error: "Enter a postal code or place name to search." }));
    return;
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "60");
    res.statusCode = 429;
    res.end(JSON.stringify({ success: false, error: "Too many requests. Please try again in a minute." }));
    return;
  }

  const key = q.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    res.setHeader("X-Cache", "HIT");
    res.statusCode = 200;
    res.end(cached.body);
    return;
  }

  try {
    const upstream = await fetchWithTimeout(`${BASE}?q=${encodeURIComponent(q)}`, FETCH_TIMEOUT_MS);

    if (!upstream.ok) {
      if (cached) {
        res.setHeader("X-Cache", "STALE");
        res.statusCode = 200;
        res.end(cached.body);
        return;
      }
      res.statusCode = 502;
      res.end(JSON.stringify({ success: false, error: `Upstream responded with status ${upstream.status}.` }));
      return;
    }

    let json;
    try {
      json = await upstream.json();
    } catch {
      json = null;
    }

    const rows = Array.isArray(json?.data) ? json.data : null;
    if (!rows) {
      if (cached) {
        res.setHeader("X-Cache", "STALE");
        res.statusCode = 200;
        res.end(cached.body);
        return;
      }
      res.statusCode = 502;
      res.end(JSON.stringify({ success: false, error: "Upstream returned an unexpected response shape." }));
      return;
    }

    const body = JSON.stringify({ success: true, fetchedAt: new Date().toISOString(), query: q, data: rows });
    cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });

    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
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
    res.end(JSON.stringify({ success: false, error: timedOut ? "Timed out reaching the postal code API." : "Could not reach the postal code API." }));
  }
};
