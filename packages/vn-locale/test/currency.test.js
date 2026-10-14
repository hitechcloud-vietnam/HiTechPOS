'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatVND, parseVND, roundVND } = require('../src');

test('formatVND', () => {
  assert.equal(formatVND(1250000), '1.250.000 ₫');
  assert.equal(formatVND(0), '0 ₫');
  assert.equal(formatVND(999), '999 ₫');
  assert.equal(formatVND(1000), '1.000 ₫');
  assert.equal(formatVND(-50000), '-50.000 ₫');
  assert.equal(formatVND(1234.5), '1.235 ₫');
  assert.equal(formatVND(-0.4), '0 ₫');
  assert.equal(formatVND(1250000, { symbol: false }), '1.250.000');
  assert.equal(formatVND(1250000, { style: 'code' }), '1.250.000 VND');
  for (const bad of [NaN, Infinity, -Infinity, '100', null, undefined]) {
    assert.throws(() => formatVND(bad), TypeError);
  }
});

test('roundVND', () => {
  assert.equal(roundVND(12345.6), 12346);
  assert.equal(roundVND(12345, 100), 12300);
  assert.equal(roundVND(12350, 100), 12400);
  assert.equal(roundVND(12250, 500), 12500);
  assert.equal(roundVND(12249, 500), 12000);
  assert.equal(roundVND(12001, 1000, 'up'), 13000);
  assert.equal(roundVND(12999, 1000, 'down'), 12000);
  assert.equal(roundVND(-1500, 1000), -2000);
  assert.throws(() => roundVND(100, 0), RangeError);
  assert.throws(() => roundVND(100, 100, 'x'), RangeError);
  assert.throws(() => roundVND(NaN), TypeError);
});

test('parseVND', () => {
  assert.equal(parseVND('1.250.000đ'), 1250000);
  assert.equal(parseVND('1,250,000 VND'), 1250000);
  assert.equal(parseVND('1.250.000 ₫'), 1250000);
  assert.equal(parseVND('1 250 000 vnđ'), 1250000);
  assert.equal(parseVND('50000'), 50000);
  assert.equal(parseVND('-50.000 đ'), -50000);
  assert.equal(parseVND('1.250.000,50'), 1250001);
  assert.equal(parseVND('1.000'), 1000);
  assert.equal(parseVND(1200.4), 1200);
  for (const bad of ['', 'abc', '1..000', '12.34.5', '1.0000', null, '1.000.', Infinity]) {
    assert.ok(Number.isNaN(parseVND(bad)), String(bad));
  }
});
