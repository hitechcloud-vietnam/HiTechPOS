'use strict';

const { crc16Hex } = require('./crc16');
const { tlv, parseEMV, verifyCRC, findTag } = require('./emv');

const NAPAS_GUID = 'A000000727';
const SERVICE = Object.freeze({ ACCOUNT: 'QRIBFTTA', CARD: 'QRIBFTTC' });
const ADD_INFO_MAX = 25;

/**
 * Sanitize transfer content for field 62/08: strip Vietnamese diacritics (incl. đ/Đ),
 * keep only [A-Za-z0-9 ], collapse spaces, cut to 25 characters. Many banking apps
 * reject or mangle non-ASCII/special characters, and 25 chars is a commonly used safe
 * limit (EMVCo itself allows up to 25 for "Purpose of Transaction").
 */
function sanitizeAddInfo(text, maxLength = ADD_INFO_MAX) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, maxLength).trim();
}

/**
 * Build a VietQR (NAPAS 247) EMVCo payload string.
 * @param {object} p
 * @param {string} p.bin            6-digit NAPAS BIN of the beneficiary bank
 * @param {string} p.accountNumber  account number (QRIBFTTA) or card number (QRIBFTTC)
 * @param {number} [p.amount]       integer VND > 0
 * @param {string} [p.addInfo]      transfer content (sanitized, max 25 chars)
 * @param {'QRIBFTTA'|'QRIBFTTC'} [p.service='QRIBFTTA']
 * @param {boolean} [p.dynamic]     point of initiation; defaults to true when amount is set
 */
function buildVietQR({ bin, accountNumber, amount, addInfo, service = SERVICE.ACCOUNT, dynamic } = {}) {
  const b = String(bin ?? '');
  if (!/^\d{6}$/.test(b)) throw new RangeError('BIN ngân hàng phải gồm 6 chữ số');
  const acc = String(accountNumber ?? '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9]{1,19}$/.test(acc)) throw new RangeError('Số tài khoản/số thẻ không hợp lệ (1-19 ký tự chữ/số)');
  if (service !== SERVICE.ACCOUNT && service !== SERVICE.CARD) throw new RangeError(`Mã dịch vụ không hợp lệ: ${service}`);
  const hasAmount = amount !== undefined && amount !== null;
  if (hasAmount && (!Number.isSafeInteger(amount) || amount <= 0 || String(amount).length > 13)) {
    throw new RangeError('Số tiền phải là số nguyên dương (VND, tối đa 13 chữ số)');
  }
  const isDynamic = dynamic ?? hasAmount;

  const merchant = tlv('00', NAPAS_GUID) + tlv('01', tlv('00', b) + tlv('01', acc)) + tlv('02', service);
  let s = tlv('00', '01') + tlv('01', isDynamic ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
  if (hasAmount) s += tlv('54', String(amount));
  s += tlv('58', 'VN');
  const info = sanitizeAddInfo(addInfo);
  if (info) s += tlv('62', tlv('08', info));
  s += '6304';
  return s + crc16Hex(s);
}

/** Decode a VietQR payload into a flat object (throws on malformed TLV). */
function decodeVietQR(payload) {
  const tree = parseEMV(payload);
  const v = (...path) => findTag(tree, ...path)?.value;
  const amount = v('54');
  return {
    version: v('00'),
    dynamic: v('01') === '12',
    guid: v('38', '00'),
    bin: v('38', '01', '00'),
    accountNumber: v('38', '01', '01'),
    service: v('38', '02'),
    currency: v('53'),
    amount: amount === undefined ? undefined : Number(amount),
    country: v('58'),
    addInfo: v('62', '08'),
    crcValid: verifyCRC(payload),
  };
}

/**
 * Public image URL from the img.vietqr.io quick-link service (requires internet on the client):
 * https://img.vietqr.io/image/<BIN>-<ACCOUNT>-<template>.png?amount=&addInfo=&accountName=
 * Templates: 'compact2' (default), 'compact', 'qr_only', 'print'.
 */
function vietQrImageUrl({ bin, accountNumber, amount, addInfo, accountName, template = 'compact2' } = {}) {
  if (!/^\d{6}$/.test(String(bin ?? ''))) throw new RangeError('BIN ngân hàng phải gồm 6 chữ số');
  const acc = String(accountNumber ?? '').replace(/\s/g, '');
  if (!acc) throw new RangeError('Thiếu số tài khoản');
  const q = [];
  if (amount !== undefined && amount !== null) q.push(`amount=${encodeURIComponent(String(amount))}`);
  if (addInfo) q.push(`addInfo=${encodeURIComponent(addInfo)}`);
  if (accountName) q.push(`accountName=${encodeURIComponent(accountName)}`);
  const path = [bin, acc, template].map((x) => encodeURIComponent(String(x))).join('-');
  return `https://img.vietqr.io/image/${path}.png${q.length ? `?${q.join('&')}` : ''}`;
}

module.exports = { NAPAS_GUID, SERVICE, ADD_INFO_MAX, sanitizeAddInfo, buildVietQR, decodeVietQR, vietQrImageUrl };
