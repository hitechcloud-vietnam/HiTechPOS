'use strict';

const { crc16Hex } = require('./crc16');

/** Encode one TLV: 2-char id + 2-digit length + value. */
function tlv(id, value) {
  const v = String(value);
  if (!/^\d{2}$/.test(id)) throw new RangeError(`Mã trường không hợp lệ: ${id}`);
  if (v.length > 99) throw new RangeError(`Giá trị trường ${id} dài quá 99 ký tự`);
  return id + String(v.length).padStart(2, '0') + v;
}

// Templates whose value is itself TLV-encoded:
// 26-51 merchant account information, 62 additional data, 64 language template.
// Inside 38 (NAPAS), sub-field 01 (beneficiary organization) is TLV too.
function isTemplate(id, parentId) {
  if (parentId == null) { const n = Number(id); return (n >= 26 && n <= 51) || id === '62' || id === '64'; }
  const p = Number(parentId);
  return p >= 26 && p <= 51 && id === '01';
}

/** Flat TLV parse of a string. Throws on malformed input. */
function parseTLV(str, parentId) {
  const out = [];
  let i = 0;
  while (i < str.length) {
    const id = str.slice(i, i + 2);
    const lenStr = str.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lenStr)) throw new SyntaxError(`TLV sai định dạng tại vị trí ${i}`);
    const len = Number(lenStr);
    const value = str.slice(i + 4, i + 4 + len);
    if (value.length !== len) throw new SyntaxError(`Trường ${id} bị cắt cụt tại vị trí ${i}`);
    const node = { id, length: len, value };
    if (isTemplate(id, parentId)) node.children = parseTLV(value, id);
    out.push(node);
    i += 4 + len;
  }
  return out;
}

/** Parse an EMVCo merchant-presented payload into a TLV tree. */
function parseEMV(payload) {
  if (typeof payload !== 'string') throw new TypeError('payload phải là chuỗi');
  return parseTLV(payload, null);
}

/** Verify the trailing "6304XXXX" CRC (computed over everything up to and including "6304"). */
function verifyCRC(payload) {
  if (typeof payload !== 'string' || payload.length < 8) return false;
  const body = payload.slice(0, -4);
  if (!body.endsWith('6304')) return false;
  return crc16Hex(body) === payload.slice(-4).toUpperCase();
}

/** Look up a node by path, e.g. find(tree, '38', '01', '00'). */
function findTag(tree, ...path) {
  let nodes = tree;
  let node;
  for (const id of path) {
    node = nodes?.find((n) => n.id === id);
    if (!node) return undefined;
    nodes = node.children;
  }
  return node;
}

module.exports = { tlv, parseEMV, verifyCRC, findTag };
