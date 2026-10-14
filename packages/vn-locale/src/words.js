'use strict';

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/**
 * Read a 3-digit group (0..999).
 * `full` = the group is not the most significant one, so "không trăm" / "linh" are spoken.
 */
function readGroup(n, full, o) {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const out = [];
  if (h > 0 || full) out.push(DIGITS[h], 'trăm');
  if (t === 0) {
    if (u > 0) {
      if (out.length) out.push(o.zeroTens);
      out.push(DIGITS[u]);
    }
  } else if (t === 1) {
    out.push('mười');
    if (u === 5) out.push('lăm');
    else if (u > 0) out.push(DIGITS[u]);
  } else {
    out.push(DIGITS[t], 'mươi');
    if (u === 1) out.push('mốt');
    else if (u === 4) out.push(o.useTu ? 'tư' : 'bốn');
    else if (u === 5) out.push('lăm');
    else if (u > 0) out.push(DIGITS[u]);
  }
  return out;
}

/** Read 0 < n < 1e9 as groups of triệu/nghìn/units. */
function readBelowBillion(n, full, o) {
  const scales = ['triệu', o.thousand, ''];
  const groups = [Math.floor(n / 1e6), Math.floor((n % 1e6) / 1e3), n % 1e3];
  const out = [];
  groups.forEach((g, i) => {
    if (g === 0) return;
    out.push(...readGroup(g, full || out.length > 0, o));
    if (scales[i]) out.push(scales[i]);
  });
  return out;
}

/** Recursive reading with "tỷ" as the repeating scale (1e12 -> "một nghìn tỷ"). */
function readPositive(n, full, o) {
  if (n < 1e9) return readBelowBillion(n, full, o);
  const high = Math.floor(n / 1e9);
  const low = n % 1e9;
  const out = [...readPositive(high, full, o), 'tỷ'];
  if (low > 0) out.push(...readBelowBillion(low, true, o));
  return out;
}

/**
 * Convert an integer amount to Vietnamese words for "Số tiền bằng chữ".
 * 1250000 -> "Một triệu hai trăm năm mươi nghìn đồng".
 * @param {number|bigint} n safe integer (decimals are rejected)
 * @param {{currency?: boolean|string, zeroTens?: 'linh'|'lẻ', useTu?: boolean,
 *          thousand?: 'nghìn'|'ngàn', capitalize?: boolean}} [opts]
 */
function numberToVietnameseWords(n, opts = {}) {
  const o = {
    currency: opts.currency ?? true,
    zeroTens: opts.zeroTens ?? 'linh',
    useTu: opts.useTu ?? false,
    thousand: opts.thousand ?? 'nghìn',
    capitalize: opts.capitalize ?? true,
  };
  if (typeof n === 'bigint') n = Number(n);
  if (!Number.isSafeInteger(n)) throw new RangeError('Số phải là số nguyên an toàn');
  if (!['linh', 'lẻ'].includes(o.zeroTens)) throw new RangeError('zeroTens phải là "linh" hoặc "lẻ"');
  const words = n === 0 ? ['không'] : readPositive(Math.abs(n), false, o);
  if (n < 0) words.unshift('âm');
  const suffix = o.currency === true ? 'đồng' : o.currency || '';
  if (suffix) words.push(suffix);
  const s = words.join(' ');
  return o.capitalize ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

module.exports = { numberToVietnameseWords };
