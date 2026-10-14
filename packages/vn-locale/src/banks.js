'use strict';

const { searchNormalize } = require('./text');

/**
 * Vietnamese banks and payment institutions with their NAPAS BIN (VietQR
 * field 38/01/00). Data mirrors the VietQR list (api.vietqr.io/v2/banks) as
 * packaged by vietnam-qr-pay 1.5.1 (MIT). `aliases` keeps the shorter names
 * shops commonly type ("MB", "LPBank"). Refresh with scripts in docs when
 * VietQR publishes changes.
 */
const BANKS = Object.freeze(require('./banks.json').map((b) => Object.freeze({ ...b, aliases: Object.freeze(b.aliases || []) })));

const key = (s) => searchNormalize(s).replace(/[^a-z0-9]/g, '');
const INDEX = new Map();
for (const b of BANKS) {
  for (const name of [b.shortName, b.code, ...b.aliases]) {
    const k = key(name);
    if (k && !INDEX.has(k)) INDEX.set(k, b);
  }
}

/**
 * Find a bank by BIN ("970436"), short name, VietQR code ("VCB") or alias,
 * case/diacritic/space-insensitive. Returns undefined when not found.
 */
function findBank(query) {
  if (query == null) return undefined;
  const q = String(query).trim();
  if (/^\d{6}$/.test(q)) return BANKS.find((b) => b.bin === q);
  const k = key(q);
  return k ? INDEX.get(k) : undefined;
}

module.exports = { BANKS, findBank };
