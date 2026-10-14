'use strict';

const { assertFinite, roundHalfAway } = require('./currency');

/**
 * Vietnam VAT (thuế GTGT) rates.
 * - 0, 5, 10: Luật Thuế GTGT.
 * - 8: reduced rate (giảm 2% từ 10%) under the Quốc hội resolutions on VAT reduction
 *   (Nghị quyết 43/2022/QH15, 101/2023/QH15, 142/2024/QH15, 174/2024/QH15, 204/2025/QH15...).
 *   Check the currently effective resolution and goods scope before applying.
 * - 'KCT': không chịu thuế GTGT (not subject to VAT).
 * - 'KKKNT': không kê khai, tính nộp thuế GTGT (not declared/paid).
 */
const VAT_RATES = Object.freeze({
  ZERO: 0,
  FIVE: 5,
  EIGHT: 8,
  TEN: 10,
  KCT: 'KCT',
  KKKNT: 'KKKNT',
});

const VAT_RATE_LABELS = Object.freeze({
  0: '0%',
  5: '5%',
  8: '8%',
  10: '10%',
  KCT: 'Không chịu thuế',
  KKKNT: 'Không kê khai, tính nộp thuế',
});

const NUMERIC = [0, 5, 8, 10];

function isValidVATRate(rate) {
  return NUMERIC.includes(rate) || rate === 'KCT' || rate === 'KKKNT';
}

/** Percentage for computation: special codes carry no VAT. */
function ratePercent(rate) {
  if (!isValidVATRate(rate)) throw new RangeError(`Thuế suất GTGT không hợp lệ: ${rate}`);
  return typeof rate === 'number' ? rate : 0;
}

/** Integer division a/b rounded half away from zero (a, b integers, b > 0). */
function divRound(a, b) {
  const q = Math.floor((2 * Math.abs(a) + b) / (2 * b));
  return a < 0 ? -q : q;
}

/**
 * Compute VAT in integer VND.
 * exclusive: net = amount, vat = round(net * r / 100)
 * inclusive: gross = amount, net = round(gross * 100 / (100 + r)), vat = gross - net
 * Rounding is half away from zero using integer arithmetic (deterministic).
 * @returns {{net:number, vat:number, gross:number, rate:(number|string)}}
 */
function computeVAT({ amount, rate, inclusive = false }) {
  assertFinite(amount);
  const r = ratePercent(rate);
  const a = roundHalfAway(amount);
  if (inclusive) {
    const net = divRound(a * 100, 100 + r);
    return { net, vat: a - net, gross: a, rate };
  }
  const vat = divRound(a * r, 100);
  return { net: a, vat, gross: a + vat, rate };
}

/**
 * Invoice totals grouped by VAT rate (VAT is computed on each rate group's subtotal,
 * as printed on Vietnamese e-invoices).
 * Each line: { amount } or { quantity, unitPrice }, plus { rate }.
 * @param {Array<{amount?:number, quantity?:number, unitPrice?:number, rate:(number|string)}>} lines
 * @param {{inclusive?: boolean}} [opts] line amounts already include VAT
 */
function computeInvoiceTotals(lines, { inclusive = false } = {}) {
  if (!Array.isArray(lines)) throw new TypeError('lines phải là mảng');
  const sums = new Map();
  for (const line of lines) {
    const amt = line.amount ?? (line.quantity ?? 1) * line.unitPrice;
    assertFinite(amt, 'line amount');
    ratePercent(line.rate);
    sums.set(line.rate, (sums.get(line.rate) ?? 0) + roundHalfAway(amt));
  }
  const order = [...NUMERIC, 'KCT', 'KKKNT'];
  const groups = [...sums.entries()]
    .sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]))
    .map(([rate, amount]) => ({ ...computeVAT({ amount, rate, inclusive }), label: VAT_RATE_LABELS[rate] }));
  const total = (k) => groups.reduce((s, g) => s + g[k], 0);
  return { groups, net: total('net'), vat: total('vat'), gross: total('gross') };
}

module.exports = { VAT_RATES, VAT_RATE_LABELS, isValidVATRate, computeVAT, computeInvoiceTotals };
