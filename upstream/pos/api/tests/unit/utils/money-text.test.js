'use strict';

/*
 * Money the server writes onto a document (PDF, mailed receipt) speaks the
 * shop's currency: a Vietnamese shop reads "₫ 1.250.000", never
 * "1,250,000.00" and never a dollar sign; other currencies keep their own
 * ISO 4217 precision.
 */
const MoneyText = require('../../../src/utils/money-text');

const vn = { country_id: 'VN', currency: '₫', currency_text: 'Vietnam Dong / VND or ₫' };
const india = { country_id: 'IN', currency: '₹', currency_text: 'India Rupee / INR or ₹' };

test('VND: whole dong, Vietnamese grouping, symbol in front', () => {
  expect(MoneyText.text(1250000, vn)).toBe('₫ 1.250.000');
  expect(MoneyText.number(22727.27, vn)).toBe('22.727');
  expect(MoneyText.number(999.5, vn)).toBe('1.000');
  expect(MoneyText.number(-0.4, vn)).toBe('0');
  expect(MoneyText.number(-135000, vn)).toBe('-135.000');
});

test('a branch with no country still groups the dong the Vietnamese way', () => {
  expect(MoneyText.text(135000, { currency_text: 'Vietnam Dong / VND or ₫', currency: '₫' })).toBe(
    '₫ 135.000'
  );
});

test('other currencies keep their precision and grouping', () => {
  expect(MoneyText.text(1234.5, india)).toBe('₹ 1,234.50');
  expect(MoneyText.text(1234.5, { country_id: 'DE', currency: '€', currency_text: 'Euro / EUR or €' })).toBe(
    '€ 1.234,50'
  );
  expect(MoneyText.number(12.3456, { currency_text: 'Kuwaiti Dinar / KWD' })).toBe('12.346');
  expect(MoneyText.number(1.005, india)).toBe('1.01');
  expect(MoneyText.text(5, {})).toBe('5.00');
});

test('ASCII form for a font without the glyph', () => {
  expect(MoneyText.text(1250000, vn, { ascii: true })).toBe('VND 1.250.000');
  expect(MoneyText.text(80, india, { ascii: true })).toBe('Rs. 80.00');
  expect(MoneyText.text(80, { currency: '$', currency_text: 'USD' }, { ascii: true })).toBe('$ 80.00');
});

test('describe() hands a page without shop settings what it needs', () => {
  expect(MoneyText.describe(vn)).toEqual({
    currencyCode: 'VND',
    currencyDigits: 0,
    currencyGroup: '.',
    currencyDecimal: ',',
  });
  expect(MoneyText.describe({})).toEqual({
    currencyCode: '',
    currencyDigits: 2,
    currencyGroup: ',',
    currencyDecimal: '.',
  });
});
