'use strict';

/*
 * Small, dependency-free protections for the public control plane.
 *
 * rateLimit: fixed window per key (client IP by default). In-memory, so each
 * process limits on its own - enough to stop password guessing and signup
 * floods from one address; a shared store can replace `hits` later.
 */
function rateLimit({ windowMs, max, key = (req) => req.ip, now = () => Date.now(), code = 'rate_limited' }) {
  const hits = new Map();
  let lastSweep = now();
  return (req, res, next) => {
    const t = now();
    if (t - lastSweep > windowMs) {
      for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
      lastSweep = t;
    }
    const k = key(req);
    let entry = hits.get(k);
    if (!entry || entry.reset <= t) {
      entry = { count: 0, reset: t + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    res.set('ratelimit-limit', String(max));
    res.set('ratelimit-remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      res.set('retry-after', String(Math.ceil((entry.reset - t) / 1000)));
      return next(Object.assign(new Error(code), { code, status: 429 }));
    }
    next();
  };
}

/* Baseline headers. The pages are self-contained (inline script/style, the
   QR library from /vendor), so the CSP allows 'self' and inline only. */
function securityHeaders(req, res, next) {
  res.set({
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cross-origin-opener-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https:",
  });
  if (req.secure) res.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  next();
}

module.exports = { rateLimit, securityHeaders };
