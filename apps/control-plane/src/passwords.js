'use strict';

const crypto = require('node:crypto');

/* scrypt, built in; parameters are stored with the hash so they can be raised later. */
const N = 16384, R = 8, P = 1, LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, n, r, p, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = { hashPassword, verifyPassword };
