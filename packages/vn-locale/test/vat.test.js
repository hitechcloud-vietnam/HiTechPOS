'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VAT_RATES, isValidVATRate, computeVAT, computeInvoiceTotals } = require('../src');

test('VAT rate constants', () => {
  assert.deepEqual(Object.values(VAT_RATES), [0, 5, 8, 10, 'KCT', 'KKKNT']);
  assert.ok(isValidVATRate(8));
  assert.ok(isValidVATRate('KCT'));
  assert.ok(!isValidVATRate(7));
  assert.ok(!isValidVATRate('10'));
});

test('computeVAT exclusive', () => {
  assert.deepEqual(computeVAT({ amount: 100000, rate: 10 }), { net: 100000, vat: 10000, gross: 110000, rate: 10 });
  assert.deepEqual(computeVAT({ amount: 12345, rate: 8 }), { net: 12345, vat: 988, gross: 13333, rate: 8 }); // 987.6
  assert.equal(computeVAT({ amount: 150, rate: 5 }).vat, 8); // 7.5 -> 8 (half away from zero)
  assert.equal(computeVAT({ amount: -150, rate: 5 }).vat, -8);
  assert.deepEqual(computeVAT({ amount: 50000, rate: 'KCT' }), { net: 50000, vat: 0, gross: 50000, rate: 'KCT' });
  assert.equal(computeVAT({ amount: 50000, rate: 0 }).vat, 0);
});

test('computeVAT inclusive', () => {
  assert.deepEqual(computeVAT({ amount: 110000, rate: 10, inclusive: true }), { net: 100000, vat: 10000, gross: 110000, rate: 10 });
  const r = computeVAT({ amount: 99999, rate: 8, inclusive: true });
  assert.equal(r.net, 92592); // 92591.67
  assert.equal(r.net + r.vat, 99999);
  assert.equal(computeVAT({ amount: 45000, rate: 'KKKNT', inclusive: true }).vat, 0);
});

test('computeVAT rejects bad input', () => {
  assert.throws(() => computeVAT({ amount: 100, rate: 7 }), RangeError);
  assert.throws(() => computeVAT({ amount: NaN, rate: 10 }), TypeError);
});

test('computeInvoiceTotals groups by rate', () => {
  const t = computeInvoiceTotals([
    { amount: 100000, rate: 10 },
    { quantity: 3, unitPrice: 15000, rate: 8 },
    { amount: 33333, rate: 10 },
    { amount: 20000, rate: 'KCT' },
    { amount: 5000, rate: 0 },
  ]);
  assert.deepEqual(t.groups.map((g) => [g.rate, g.net, g.vat, g.gross, g.label]), [
    [0, 5000, 0, 5000, '0%'],
    [8, 45000, 3600, 48600, '8%'],
    [10, 133333, 13333, 146666, '10%'],
    ['KCT', 20000, 0, 20000, 'Không chịu thuế'],
  ]);
  assert.equal(t.net, 203333);
  assert.equal(t.vat, 16933);
  assert.equal(t.gross, 220266);
  const inc = computeInvoiceTotals([{ amount: 110000, rate: 10 }], { inclusive: true });
  assert.equal(inc.net, 100000);
  assert.throws(() => computeInvoiceTotals([{ amount: 1, rate: 3 }]), RangeError);
  assert.deepEqual(computeInvoiceTotals([]), { groups: [], net: 0, vat: 0, gross: 0 });
});
