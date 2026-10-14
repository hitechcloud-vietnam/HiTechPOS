'use strict';

const { hmacSha256Hex, safeEqual } = require('@hitechpos/payment-core');

/*
 * Pay2S signs a fixed, ordered field list joined as key=value&... with
 * HMAC-SHA256 (hex) using the merchant secret key. `bankAccounts` is signed
 * as the literal "bankAccounts=Array" (a PHP serialisation artefact the
 * gateway expects). Callbacks carry the signature as `m2signature`.
 *
 * Field lists follow docs.pay2s.vn as implemented by the pay2s-node SDK;
 * confirm against the account's contract before going live.
 */
const CREATE_PAYMENT_FIELDS = ['accessKey', 'amount', 'bankAccounts', 'ipnUrl', 'orderId', 'orderInfo', 'partnerCode', 'redirectUrl', 'requestId', 'requestType'];
const REDIRECT_FIELDS = ['accessKey', 'amount', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode'];
const IPN_FIELDS = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'];

function canonicalize(fields, payload) {
  return fields
    .map((field) => {
      if (field === 'bankAccounts') return 'bankAccounts=Array';
      const value = payload[field];
      return `${field}=${value === undefined || value === null ? '' : String(value)}`;
    })
    .join('&');
}

function sign(fields, payload, secretKey) {
  return hmacSha256Hex(secretKey, canonicalize(fields, payload));
}

function verify(fields, payload, secretKey) {
  return typeof payload.m2signature === 'string' && safeEqual(sign(fields, payload, secretKey), payload.m2signature);
}

module.exports = { CREATE_PAYMENT_FIELDS, REDIRECT_FIELDS, IPN_FIELDS, canonicalize, sign, verify };
