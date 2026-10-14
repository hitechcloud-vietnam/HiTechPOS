'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

function hmacSha256Hex(key, message) {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

/* Constant-time comparison of two hex/ASCII signatures. Different lengths are
   a mismatch, never an exception. */
function safeEqual(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;
  const a = Buffer.from(expected.trim().toLowerCase(), 'utf8');
  const b = Buffer.from(provided.trim().toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = { hmacSha256Hex, safeEqual };
