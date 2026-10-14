'use strict';
/* HiTechPOS: Vietnamese tax codes and postcodes on customers (docs/UPSTREAM.md). */
const { VALIDATION_PATTERNS } = require('../../../src/constants/customers.constants');

describe('customer tax identifier', () => {
  test.each(['27AAPFU0939F1ZV', '0100109106', '0100109106-001', '001090012345'])('accepts %s', (v) => {
    expect(VALIDATION_PATTERNS.GST_NUMBER.test(v)).toBe(true);
  });
  test.each(['010010910', '0100109106-01', 'ABCDEFGHIJ', '27aapfu0939f1zv', '0100109106 ', ''])('refuses %j', (v) => {
    expect(VALIDATION_PATTERNS.GST_NUMBER.test(v)).toBe(false);
  });
  test('postcodes: Indian PIN and Vietnamese 5-digit codes', () => {
    expect(VALIDATION_PATTERNS.PINCODE.test('560001')).toBe(true);
    expect(VALIDATION_PATTERNS.PINCODE.test('10000')).toBe(true);
    expect(VALIDATION_PATTERNS.PINCODE.test('1000')).toBe(false);
  });
});
