'use strict';

const { requestJson, fail, trimTrailingSlashes } = require('@hitechpos/payment-core');
const { CREATE_PAYMENT_FIELDS, REDIRECT_FIELDS, IPN_FIELDS, sign, verify } = require('./signature');

const BASE_URLS = { sandbox: 'https://sandbox-payment.pay2s.vn', production: 'https://payment.pay2s.vn' };

function required(value, name) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim()) {
    fail('pay2s_configuration_invalid', 422, { message: `${name} is required` });
  }
  return String(value).trim();
}

function absoluteUrl(value, name) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
  } catch { /* fall through */ }
  return fail('pay2s_request_invalid', 422, { message: `${name} must be an absolute URL` });
}

function paymentUrlOf(response) {
  return response && (response.payUrl || response.paymentUrl || response.payment_url || response.checkoutUrl) || null;
}

function createPay2SClient(config, { transport = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const environment = config && config.environment;
  if (!BASE_URLS[environment]) fail('pay2s_configuration_invalid', 422, { message: 'environment must be sandbox or production' });
  const accessKey = required(config.accessKey, 'accessKey');
  const partnerCode = required(config.partnerCode, 'partnerCode');
  const secretKey = required(config.secretKey, 'secretKey');
  const baseUrl = trimTrailingSlashes(config.baseUrl || BASE_URLS[environment]);

  /* Every callback must name this merchant before its signature is even
     considered; a valid signature for another partner is still not ours. */
  function bound(payload) {
    if (!payload || typeof payload !== 'object') fail('pay2s_callback_invalid', 400);
    if (String(payload.partnerCode) !== partnerCode) fail('pay2s_callback_partner_mismatch', 401);
    if (payload.accessKey !== undefined && String(payload.accessKey) !== accessKey) fail('pay2s_callback_partner_mismatch', 401);
    return { ...payload, accessKey, extraData: payload.extraData ?? '', responseTime: payload.responseTime ?? '' };
  }

  return Object.freeze({
    environment,
    baseUrl,
    async createPayment(input) {
      const req = {
        accessKey, partnerCode,
        partnerName: input.partnerName || config.partnerName || undefined,
        requestId: required(input.requestId ?? input.orderId, 'requestId'),
        orderId: required(input.orderId, 'orderId'),
        amount: input.amount,
        orderInfo: input.orderInfo,
        orderType: input.orderType || 'pay2s',
        requestType: input.requestType || 'pay2s',
        redirectUrl: absoluteUrl(input.redirectUrl, 'redirectUrl'),
        ipnUrl: absoluteUrl(input.ipnUrl, 'ipnUrl'),
        bankAccounts: Array.isArray(input.bankAccounts) ? input.bankAccounts : [],
        extraData: input.extraData || '',
      };
      if (!Number.isSafeInteger(req.amount) || req.amount <= 0) fail('pay2s_amount_invalid', 422);
      if (!/^[A-Za-z0-9]{10,32}$/.test(String(req.orderInfo || ''))) fail('pay2s_order_info_invalid', 422, { message: 'orderInfo must be 10-32 ASCII letters/digits' });
      req.signature = sign(CREATE_PAYMENT_FIELDS, req, secretKey);
      const res = await requestJson(transport, `${baseUrl}/v1/gateway/api/create`, { method: 'POST', body: req, timeoutMs, prefix: 'pay2s' });
      if (!res || (res.resultCode !== undefined && Number(res.resultCode) !== 0)) {
        fail('pay2s_rejected', 502, { message: res && res.message ? `Pay2S: ${res.message}` : 'Pay2S rejected the request', details: { resultCode: res && res.resultCode } });
      }
      if (!paymentUrlOf(res)) fail('pay2s_response_invalid', 502);
      return { ...res, paymentUrl: paymentUrlOf(res) };
    },
    /* Server-to-server notification (JSON body). */
    verifyIpn(body) {
      const raw = typeof body === 'string' || Buffer.isBuffer(body) ? JSON.parse(String(body)) : body;
      const payload = bound(raw);
      if (!verify(IPN_FIELDS, payload, secretKey)) fail('pay2s_callback_signature_invalid', 401);
      return payload;
    },
    /* Browser redirect back to redirectUrl (query string). Informational only:
       the IPN, not the redirect, settles a payment. */
    verifyRedirect(query) {
      const payload = bound(Object.fromEntries(new URLSearchParams(query)));
      if (!verify(REDIRECT_FIELDS, payload, secretKey)) fail('pay2s_callback_signature_invalid', 401);
      return payload;
    },
  });
}

module.exports = { createPay2SClient, paymentUrlOf, BASE_URLS };
