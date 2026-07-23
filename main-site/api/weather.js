// Serverless proxy for BMKG's public weather forecast API.
// Adds: input validation, timeout, response-shape checks, in-memory caching
// (per warm lambda instance) and a lightweight per-IP rate limit, plus
// CDN-level caching via Cache-Control so most requests never reach BMKG.

const BMKG_URL = "https://api.bmkg.go.id/publik/prakiraan-cuaca";
const ADM4_RE = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/;

const CACHE_TTL_MS = 10 * 60 * 1000; // BMKG refreshes forecasts a few times a day
const FETCH_TIMEOUT_MS = 8000;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20; // requests per IP per window

// Module-level state persists across invocations on a warm lambda instance,
// and is naturally reset on cold starts - a pragmatic best-effort limiter
// for a low-traffic public endpoint, not a substitute for edge/WAF limits.
const cache = new Map(); // adm4 -> { body, expiresAt }
const hits = new Map(); // ip -> { count, resetAt }

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
  return (
    json &&
    typeof json === "object" &&
    json.lokasi &&
    Array.isArray(json.data) &&
    json.data.length > 0
  );
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const adm4 = typeof req.query.adm4 === "string" ? req.query.adm4.trim() : "";

  if (!ADM4_RE.test(adm4)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ success: false, error: "Invalid or missing adm4 code." }));
    return;
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    res.setHeader("Retry-After", "60");
    res.statusCode = 429;
    res.end(JSON.stringify({ success: false, error: "Too many requests. Please try again in a minute." }));
    return;
  }

  const cached = cache.get(adm4);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
    res.setHeader("X-Cache", "HIT");
    res.statusCode = 200;
    res.end(cached.body);
    return;
  }

  try {
    const upstream = await fetchWithTimeout(`${BMKG_URL}?adm4=${encodeURIComponent(adm4)}`, FETCH_TIMEOUT_MS);

    if (!upstream.ok) {
      // Serve stale cache rather than failing outright, if we have one.
      if (cached) {
        res.setHeader("X-Cache", "STALE");
        res.statusCode = 200;
        res.end(cached.body);
        return;
      }
      if (upstream.status === 404) {
        // BMKG's village-level coverage doesn't include every desa/kelurahan -
        // a well-formed adm4 code can still legitimately have no forecast.
        res.statusCode = 404;
        res.end(
          JSON.stringify({
            success: false,
            noCoverage: true,
            error: "BMKG doesn't publish a forecast for this adm4 code.",
          })
        );
        return;
      }
      res.statusCode = 502;
      res.end(JSON.stringify({ success: false, error: `BMKG responded with status ${upstream.status}.` }));
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
      res.end(JSON.stringify({ success: false, error: "BMKG returned a malformed response." }));
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
      res.end(JSON.stringify({ success: false, error: "BMKG returned an unexpected or empty response shape." }));
      return;
    }

    const body = JSON.stringify({ success: true, fetchedAt: new Date().toISOString(), ...json });
    cache.set(adm4, { body, expiresAt: Date.now() + CACHE_TTL_MS });

    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
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
        error: timedOut ? "Timed out reaching BMKG." : "Could not reach BMKG.",
      })
    );
  }
};
