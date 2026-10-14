'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVNPhone, isValidVNPhone, isValidTaxCode, taxCodeCheckDigit, isValidCCCD } = require('../src');

test('phone normalization', () => {
  assert.equal(normalizeVNPhone('0912 345 678'), '0912345678');
  assert.equal(normalizeVNPhone('+84 912.345.678'), '0912345678');
  assert.equal(normalizeVNPhone('84912345678'), '0912345678');
  assert.equal(normalizeVNPhone('0084-912-345-678'), '0912345678');
  assert.equal(normalizeVNPhone('(+84) 0912345678'), '0912345678');
  for (const ok of ['0321234567', '0398765432', '0521234567', '0561234567', '0701234567', '0791234567', '0811234567', '0891234567', '0901234567', '0991234567']) {
    assert.ok(isValidVNPhone(ok), ok);
  }
  for (const bad of ['0311234567', '0511234567', '0711234567', '0801234567', '0241234567', '091234567', '09123456789', '', null, 'abc', '+1 912345678']) {
    assert.ok(!isValidVNPhone(bad), String(bad));
  }
});

test('tax code checksum (real company MSTs)', () => {
  // Vietcombank, FPT, Viettel
  for (const mst of ['0100112437', '0101248141', '0100109106']) assert.ok(isValidTaxCode(mst), mst);
  assert.equal(taxCodeCheckDigit('010011243'), 7);
  assert.ok(!isValidTaxCode('0100112436'));
  assert.ok(!isValidTaxCode('0100112438'));
  // base whose weighted sum ≡ 0 (mod 11) can never be valid: 000000000 -> sum 0
  assert.equal(taxCodeCheckDigit('000000000'), null);
  assert.ok(!isValidTaxCode('0000000000'));
  assert.throws(() => taxCodeCheckDigit('123'), TypeError);
});

test('tax code formats', () => {
  assert.ok(isValidTaxCode('0100112437-001'));
  assert.ok(isValidTaxCode(' 0100112437-012 '));
  assert.ok(!isValidTaxCode('0100112437-000'));
  assert.ok(!isValidTaxCode('0100112437-01'));
  assert.ok(!isValidTaxCode('0100112436-001'));
  assert.ok(!isValidTaxCode('0100112437-001', { allowBranch: false }));
  assert.ok(isValidTaxCode('001090012345'));
  assert.ok(!isValidTaxCode('001090012345', { allowPersonal12: false }));
  for (const bad of ['', null, '01001124', '01001124370', 'abcdefghij', '0100112437001']) assert.ok(!isValidTaxCode(bad), String(bad));
});

test('CCCD', () => {
  assert.ok(isValidCCCD('001090012345'));
  assert.ok(!isValidCCCD('00109001234'));
  assert.ok(!isValidCCCD('00109001234a'));
  assert.ok(!isValidCCCD(null));
});
