'use strict';

const SYMBOL = '₫';
const CODE = 'VND';

function assertFinite(amount, name = 'amount') {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new TypeError(`${name} phải là số hữu hạn`);
  }
}

/** Round half away from zero to an integer (avoids -0). */
function roundHalfAway(x) {
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return r === 0 ? 0 : r;
}

/** Group integer digits with "." : 1250000 -> "1.250.000". */
function groupDigits(int) {
  const s = String(Math.abs(int));
  return (int < 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Format an amount as VND: "1.250.000 ₫".
 * @param {number} amount
 * @param {{symbol?: boolean, style?: 'symbol'|'code'}} [opts]
 */
function formatVND(amount, { symbol = true, style = 'symbol' } = {}) {
  assertFinite(amount);
  const body = groupDigits(roundHalfAway(amount));
  if (!symbol) return body;
  return `${body} ${style === 'code' ? CODE : SYMBOL}`;
}

/**
 * Cash rounding to a step (1, 100, 500, 1000...).
 * @param {number} amount
 * @param {number} [step=1]
 * @param {'nearest'|'up'|'down'} [mode='nearest']
 */
function roundVND(amount, step = 1, mode = 'nearest') {
  assertFinite(amount);
  if (!Number.isInteger(step) || step <= 0) throw new RangeError('step phải là số nguyên dương');
  const q = amount / step;
  let r;
  if (mode === 'up') r = Math.ceil(q);
  else if (mode === 'down') r = Math.floor(q);
  else if (mode === 'nearest') r = roundHalfAway(q);
  else throw new RangeError(`mode không hợp lệ: ${mode}`);
  const v = r * step;
  return v === 0 ? 0 : v;
}

/**
 * Parse a VND string: "1.250.000đ", "1,250,000 VND", "-50.000 ₫" -> integer.
 * A trailing separator followed by 1-2 digits is treated as a decimal part and rounded.
 * Returns NaN when the input cannot be parsed.
 */
function parseVND(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? roundHalfAway(input) : NaN;
  if (typeof input !== 'string') return NaN;
  let s = input.trim().replace(/(vnđ|vnd|đồng|đ|₫)/gi, '').replace(/[\s ]/g, '');
  let sign = 1;
  if (/^[-−]/.test(s)) { sign = -1; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d[\d.,]*$/.test(s) || /[.,]{2}|[.,]$/.test(s)) return NaN;
  let decimal = '';
  const m = s.match(/^(.*)[.,](\d{1,2})$/);
  if (m && /[.,]/.test(s)) { s = m[1]; decimal = m[2]; }
  if (/[.,]/.test(s) && !/^\d{1,3}([.,]\d{3})+$/.test(s)) return NaN;
  const n = Number(s.replace(/[.,]/g, '') + (decimal ? `.${decimal}` : ''));
  return Number.isFinite(n) ? sign * roundHalfAway(n) || 0 : NaN;
}

module.exports = { formatVND, parseVND, roundVND, roundHalfAway, groupDigits, assertFinite, CURRENCY_SYMBOL: SYMBOL, CURRENCY_CODE: CODE };
