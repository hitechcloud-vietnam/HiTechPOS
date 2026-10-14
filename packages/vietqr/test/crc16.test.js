'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crc16, crc16Hex } = require('../src');

test('CRC-16/CCITT-FALSE check vectors', () => {
  assert.equal(crc16('123456789'), 0x29b1);
  assert.equal(crc16(''), 0xffff);
  assert.equal(crc16('A'), 0xb915);
  assert.equal(crc16(Buffer.from('123456789')), 0x29b1);
  assert.equal(crc16Hex('123456789'), '29B1');
  assert.match(crc16Hex('x'), /^[0-9A-F]{4}$/);
});
