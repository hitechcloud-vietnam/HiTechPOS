'use strict';

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, xorout 0) over UTF-8 bytes. */
function crc16(input) {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** 4-char uppercase hex CRC. */
function crc16Hex(input) {
  return crc16(input).toString(16).toUpperCase().padStart(4, '0');
}

module.exports = { crc16, crc16Hex };
