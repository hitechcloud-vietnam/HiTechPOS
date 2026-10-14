'use strict';

const { hmacSha256Hex, safeEqual } = require('@hitechpos/payment-core');

/*
 * payOS signatures, matching the official @payos/node SDK (v2):
 *
 *  - payment request: HMAC-SHA256 over exactly
 *      amount=..&cancelUrl=..&description=..&orderCode=..&returnUrl=..
 *    (fixed order, raw values, no URL encoding);
 *  - response bodies and webhooks: HMAC-SHA256 over the `data` object with
 *    keys sorted ascending, joined as key=value&..., where null/undefined
 *    become the empty string and arrays are JSON with each element's keys
 *    sorted.
 */
function paymentRequestSignature({ amount, cancelUrl, description, orderCode, returnUrl }, checksumKey) {
  return hmacSha256Hex(
    checksumKey,
    `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`
  );
}

function sortKeys(object) {
  return Object.keys(object).sort().reduce((acc, key) => {
    acc[key] = object[key];
    return acc;
  }, {});
}

function canonicalData(data) {
  const sorted = sortKeys(data);
  return Object.keys(sorted)
    .filter((key) => sorted[key] !== undefined)
    .map((key) => {
      let value = sorted[key];
      if (Array.isArray(value)) value = JSON.stringify(value.map((v) => (v && typeof v === 'object' ? sortKeys(v) : v)));
      if ([null, undefined, 'undefined', 'null'].includes(value)) value = '';
      return `${key}=${value}`;
    })
    .join('&');
}

function dataSignature(data, checksumKey) {
  return hmacSha256Hex(checksumKey, canonicalData(data));
}

function verifyDataSignature(data, signature, checksumKey) {
  if (!data || typeof data !== 'object') return false;
  return safeEqual(dataSignature(data, checksumKey), signature);
}

module.exports = { paymentRequestSignature, canonicalData, dataSignature, verifyDataSignature };
