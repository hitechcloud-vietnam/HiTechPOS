'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { numberToVietnameseWords: w } = require('../src');

const cases = {
  0: 'Không đồng',
  1: 'Một đồng',
  5: 'Năm đồng',
  10: 'Mười đồng',
  11: 'Mười một đồng',
  14: 'Mười bốn đồng',
  15: 'Mười lăm đồng',
  20: 'Hai mươi đồng',
  21: 'Hai mươi mốt đồng',
  24: 'Hai mươi bốn đồng',
  25: 'Hai mươi lăm đồng',
  100: 'Một trăm đồng',
  101: 'Một trăm linh một đồng',
  105: 'Một trăm linh năm đồng',
  110: 'Một trăm mười đồng',
  115: 'Một trăm mười lăm đồng',
  121: 'Một trăm hai mươi mốt đồng',
  1000: 'Một nghìn đồng',
  1001: 'Một nghìn không trăm linh một đồng',
  1010: 'Một nghìn không trăm mười đồng',
  2021: 'Hai nghìn không trăm hai mươi mốt đồng',
  10005: 'Mười nghìn không trăm linh năm đồng',
  15000: 'Mười lăm nghìn đồng',
  1000000: 'Một triệu đồng',
  1005005: 'Một triệu không trăm linh năm nghìn không trăm linh năm đồng',
  1250000: 'Một triệu hai trăm năm mươi nghìn đồng',
  1000000000: 'Một tỷ đồng',
  1000000005: 'Một tỷ không trăm linh năm đồng',
  2500000000: 'Hai tỷ năm trăm triệu đồng',
  1000000000000: 'Một nghìn tỷ đồng',
  1001000000000: 'Một nghìn không trăm linh một tỷ đồng',
  1234567891234: 'Một nghìn hai trăm ba mươi bốn tỷ năm trăm sáu mươi bảy triệu tám trăm chín mươi mốt nghìn hai trăm ba mươi bốn đồng',
  1000000000000000: 'Một triệu tỷ đồng',
};

test('numberToVietnameseWords — standard cases', () => {
  for (const [n, expected] of Object.entries(cases)) assert.equal(w(Number(n)), expected, n);
});

test('numberToVietnameseWords — options', () => {
  assert.equal(w(105, { zeroTens: 'lẻ' }), 'Một trăm lẻ năm đồng');
  assert.equal(w(24, { useTu: true }), 'Hai mươi tư đồng');
  assert.equal(w(14, { useTu: true }), 'Mười bốn đồng');
  assert.equal(w(1250000, { currency: false }), 'Một triệu hai trăm năm mươi nghìn');
  assert.equal(w(5000, { thousand: 'ngàn', currency: 'đồng chẵn' }), 'Năm ngàn đồng chẵn');
  assert.equal(w(21, { capitalize: false }), 'hai mươi mốt đồng');
  assert.equal(w(-1500), 'Âm một nghìn năm trăm đồng');
  assert.equal(w(10n), 'Mười đồng');
});

test('numberToVietnameseWords — rejects invalid input', () => {
  assert.throws(() => w(1.5), RangeError);
  assert.throws(() => w(NaN), RangeError);
  assert.throws(() => w(2 ** 60), RangeError);
  assert.throws(() => w(1, { zeroTens: 'x' }), RangeError);
});
