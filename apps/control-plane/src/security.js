'use strict';

const { rateLimit: expressRateLimit } = require('express-rate-limit');

/*
 * Rate limits for the public control plane (express-rate-limit, in-memory
 * per process). Exceeding a limit becomes a 429 error carrying the Vietnamese
 * message of the error handler, with standard RateLimit-* and Retry-After
 * headers.
 */
function rateLimit({ windowMs, max, key, code = 'rate_limited' }) {
  return expressRateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(key ? { keyGenerator: key } : {}),
    /* the key may be an API key or IP; validations about IPv6 subnets do
       not apply to the former */
    validate: { keyGeneratorIpFallback: false },
    handler: (req, res, next) => next(Object.assign(new Error(code), { code, status: 429 })),
  });
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
