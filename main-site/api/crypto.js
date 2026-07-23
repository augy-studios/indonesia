// Serverless proxy for Indodax's public ticker API.
// Adds: pair validation, timeout, shape checks, short-lived in-memory
// caching (prices move fast, but we still don't want to hammer upstream on
// every page view) and a per-IP rate limit.

const INDODAX_URL = "https://indodax.com/api/ticker";
const PAIR_RE = /^[a-z0-9]{2,15}idr$/;

const CACHE_TTL_MS = 20 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;

const cache = new Map(); // pair -> { body, expiresAt }
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

function isValidShape(json) {
  return json && typeof json === "object" && json.ticker && typeof json.ticker === "object" && "last" in json.ticker;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const pair = typeof req.query.pair === "string" ? req.query.pair.trim().toLowerCase() : "";

  if (!PAIR_RE.test(pair)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ success: false, error: "Invalid or missing pair (expected something like btcidr)." }));
    return;
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "60");
    res.statusCode = 429;
    res.end(JSON.stringify({ success: false, error: "Too many requests. Please try again in a minute." }));
    return;
  }

  const cached = cache.get(pair);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
    res.setHeader("X-Cache", "HIT");
    res.statusCode = 200;
    res.end(cached.body);
    return;
  }

  try {
    const upstream = await fetchWithTimeout(`${INDODAX_URL}/${encodeURIComponent(pair)}`, FETCH_TIMEOUT_MS);

    if (!upstream.ok) {
      if (cached) {
        res.setHeader("X-Cache", "STALE");
        res.statusCode = 200;
        res.end(cached.body);
        return;
      }
      const status = upstream.status === 404 ? 404 : 502;
      res.statusCode = status;
      res.end(
        JSON.stringify({
          success: false,
          error: status === 404 ? "Unknown trading pair." : `Indodax responded with status ${upstream.status}.`,
        })
      );
      return;
    }

    let json;
    try {
      json = await upstream.json();
    } catch {
      if (cached) {
        res.setHeader("X-Cache", "STALE");
        res.statusCode = 200;
        res.end(cached.body);
        return;
      }
      res.statusCode = 502;
      res.end(JSON.stringify({ success: false, error: "Indodax returned a malformed response." }));
      return;
    }

    if (!isValidShape(json)) {
      if (cached) {
        res.setHeader("X-Cache", "STALE");
        res.statusCode = 200;
        res.end(cached.body);
        return;
      }
      res.statusCode = 502;
      res.end(JSON.stringify({ success: false, error: "Indodax returned an unexpected or empty response shape." }));
      return;
    }

    const body = JSON.stringify({ success: true, fetchedAt: new Date().toISOString(), pair, ticker: json.ticker });
    cache.set(pair, { body, expiresAt: Date.now() + CACHE_TTL_MS });

    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
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
    res.end(
      JSON.stringify({
        success: false,
        error: timedOut ? "Timed out reaching Indodax." : "Could not reach Indodax.",
      })
    );
  }
};
