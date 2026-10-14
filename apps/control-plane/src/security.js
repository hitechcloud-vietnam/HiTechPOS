'use strict';

const crypto = require('node:crypto');
const { rateLimit: expressRateLimit } = require('express-rate-limit');

/*
 * Rate limits for the public control plane (express-rate-limit, in-memory
 * per process). Exceeding a limit becomes a 429 error carrying the Vietnamese
 * message of the error handler, with standard RateLimit-* and Retry-After
 * headers.
 */
function rateLimit({ windowMs, max, key, skip, code = 'rate_limited' }) {
  return expressRateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(key ? { keyGenerator: key } : {}),
    ...(skip ? { skip } : {}),
    handler: (req, res, next) => next(Object.assign(new Error(code), { code, status: 429 })),
  });
}

/* Callers that are not one client per IP: every shop's till reaches
   /pos/v1 through the shard on loopback, providers send all shops'
   webhooks from a few IPs, and Caddy asks about certificates from
   loopback. They have their own keyed limits or authentication; counting
   them in the per-IP bucket would let one busy (or hostile) shop starve
   all the others. */
const SHARED_CALLER_PATHS = /^\/(?:pos\/v1\/|webhooks\/|internal\/tls-ask(?:$|\?))/;
function sharedCaller(req) {
  return SHARED_CALLER_PATHS.test(req.originalUrl || req.url || '');
}

/* Rate-limit key for a bearer credential: a digest, so neither the key nor
   a suffix of it sits in the limiter's memory, and distinct keys never
   collide on a shared suffix. */
function credentialKey(req) {
  const auth = req.headers.authorization;
  return auth ? `k:${crypto.createHash('sha256').update(String(auth)).digest('base64url')}` : `ip:${req.ip}`;
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

module.exports = { rateLimit, securityHeaders, sharedCaller, credentialKey };
