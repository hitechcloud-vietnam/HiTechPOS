'use strict';

// Mobile prefixes after the 2018 11->10 digit migration:
// 032-039, 052/055/056/058/059, 070/076-079, 081-089, 090-099.
const MOBILE_RE = /^0(3[2-9]|5[25689]|7[06-9]|8[1-9]|9\d)\d{7}$/;

/**
 * Normalize a Vietnamese phone number to the domestic form "0xxxxxxxxx".
 * Strips spaces, dots, dashes, parentheses; converts +84 / 84 / 0084 prefixes.
 * Returns null when the result is not a valid mobile number.
 */
function normalizeVNPhone(input) {
  if (input == null) return null;
  let s = String(input).trim().replace(/[\s.\-()]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('0084')) s = '0' + s.slice(4);
  else if (/^84\d{9}$/.test(s)) s = '0' + s.slice(2);
  if (s.startsWith('00')) s = s.slice(1); // "+84 0912..." style typo
  return MOBILE_RE.test(s) ? s : null;
}

function isValidVNPhone(input) {
  return normalizeVNPhone(input) !== null;
}

// Mã số thuế (MST) check digit, per the GDT algorithm (Thông tư 105/2020/TT-BTC structure:
// N1N2 province/type, N3-N9 sequence, N10 check digit, optional -N11N12N13 branch).
// sum = Σ d[i] * W[i] for the first 9 digits; check = 10 - (sum mod 11).
// If that yields 10 (sum mod 11 == 0) the base number is never issued -> invalid.
const TAX_WEIGHTS = [31, 29, 23, 19, 17, 13, 7, 5, 3];

/** Expected 10th digit for a 9-digit base, or null if the base can't carry a valid check digit. */
function taxCodeCheckDigit(base9) {
  if (!/^\d{9}$/.test(base9)) throw new TypeError('Cần đúng 9 chữ số');
  const sum = TAX_WEIGHTS.reduce((s, w, i) => s + w * Number(base9[i]), 0);
  const check = 10 - (sum % 11);
  return check === 10 ? null : check;
}

/**
 * Validate a Vietnamese tax code:
 * - "0123456789"     10-digit enterprise/individual code, checksum verified
 * - "0123456789-001" branch/dependent unit (10 digits + "-" + 3 digits 001-999)
 * - 12 digits        personal tax code = CCCD number (since 1/7/2025), format-only
 * @param {string} code
 * @param {{allowBranch?: boolean, allowPersonal12?: boolean}} [opts]
 */
function isValidTaxCode(code, { allowBranch = true, allowPersonal12 = true } = {}) {
  if (code == null) return false;
  const s = String(code).trim().replace(/\s/g, '');
  if (/^\d{12}$/.test(s)) return allowPersonal12;
  const m = s.match(/^(\d{10})(?:-(\d{3}))?$/);
  if (!m) return false;
  if (m[2] !== undefined && (!allowBranch || m[2] === '000')) return false;
  return taxCodeCheckDigit(m[1].slice(0, 9)) === Number(m[1][9]);
}

/** Căn cước công dân / Căn cước: exactly 12 digits (format-only). */
function isValidCCCD(input) {
  return input != null && /^\d{12}$/.test(String(input).trim());
}

module.exports = { normalizeVNPhone, isValidVNPhone, isValidTaxCode, taxCodeCheckDigit, isValidCCCD };
