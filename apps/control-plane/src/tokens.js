'use strict';

const crypto = require('node:crypto');

/* Compact HS256 JWT for control-plane sessions; no dependency needed. */
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function signToken(claims, secret, { ttlSeconds = 7 * 24 * 3600, now = Date.now() } = {}) {
  const iat = Math.floor(now / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...claims, iat, exp: iat + ttlSeconds })}`;
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

function verifyToken(token, secret, { now = Date.now() } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let claims;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (header.alg !== 'HS256') return null;
    claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  } catch {
    return null;
  }
  return claims.exp && claims.exp * 1000 > now ? claims : null;
}

module.exports = { signToken, verifyToken };
