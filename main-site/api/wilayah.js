// Serverless proxy for the Emsifa "API Wilayah Indonesia" community API.
// Administrative data barely changes, so we cache aggressively; still
// guard against downtime, bad params and malformed/empty responses.

const BASE = "https://www.emsifa.com/api-wilayah-indonesia/api";

const LEVELS = {
  provinces: { path: () => "provinces.json", needsParent: false },
  regencies: { path: (id) => `regencies/${id}.json`, needsParent: true },
  districts: { path: (id) => `districts/${id}.json`, needsParent: true },
  villages: { path: (id) => `villages/${id}.json`, needsParent: true },
};

const ID_RE = /^\d{2,10}$/;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 40;

const cache = new Map(); // key -> { body, expiresAt }
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

  const level = typeof req.query.level === "string" ? req.query.level : "";
  const parent = typeof req.query.parent === "string" ? req.query.parent.trim() : "";

  const def = LEVELS[level];
  if (!def) {
    res.statusCode = 400;
    res.end(JSON.stringify({ success: false, error: "Invalid level. Use provinces, regencies, districts or villages." }));
    return;
  }
  if (def.needsParent && !ID_RE.test(parent)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ success: false, error: "A valid numeric parent id is required for this level." }));
    return;
  }

  const key = `${level}:${parent}`;

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "60");
    res.statusCode = 429;
    res.end(JSON.stringify({ success: false, error: "Too many requests. Please try again in a minute." }));
    return;
  }

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.setHeader("X-Cache", "HIT");
    res.statusCode = 200;
    res.end(cached.body);
    return;
  }

  try {
    const url = `${BASE}/${def.path(parent)}`;
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

    if (!Array.isArray(json)) {
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

    const body = JSON.stringify({ success: true, fetchedAt: new Date().toISOString(), level, parent: parent || null, data: json });
    cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
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
    res.end(JSON.stringify({ success: false, error: timedOut ? "Timed out reaching the wilayah API." : "Could not reach the wilayah API." }));
  }
};
