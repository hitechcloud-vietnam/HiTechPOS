'use strict';

const { requestJson, fail, trimTrailingSlashes } = require('@hitechpos/payment-core');
const { paymentRequestSignature, verifyDataSignature } = require('./signature');

const BASE_URL = 'https://api-merchant.payos.vn';
const TAX_PERCENTAGES = [-2, -1, 0, 5, 10];

function credential(value, name) {
  if (typeof value !== 'string' || !value.trim()) fail('payos_configuration_invalid', 422, { message: `${name} is required` });
  return value.trim();
}

function absoluteUrl(value, name) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
  } catch { /* fall through */ }
  return fail('payos_request_invalid', 422, { message: `${name} must be an absolute URL` });
}

/*
 * Validation mirrors what payOS rejects, so a bad request fails here with a
 * clear code instead of round-tripping to the provider.
 */
function normalizeCreateRequest(input) {
  const req = { ...input };
  if (!Number.isSafeInteger(req.orderCode) || req.orderCode <= 0) fail('payos_order_code_invalid', 422);
  if (!Number.isSafeInteger(req.amount) || req.amount <= 0) fail('payos_amount_invalid', 422);
  if (typeof req.description !== 'string' || !req.description.trim()) fail('payos_description_invalid', 422);
  req.returnUrl = absoluteUrl(req.returnUrl, 'returnUrl');
  req.cancelUrl = absoluteUrl(req.cancelUrl, 'cancelUrl');
  if (req.expiredAt !== undefined && (!Number.isSafeInteger(req.expiredAt) || req.expiredAt <= 0)) fail('payos_request_invalid', 422, { message: 'expiredAt must be a unix timestamp in seconds' });
  for (const item of req.items || []) {
    if (!item || typeof item.name !== 'string' || !Number.isSafeInteger(item.quantity) || !Number.isSafeInteger(item.price)) fail('payos_items_invalid', 422);
    if (item.taxPercentage !== undefined && !TAX_PERCENTAGES.includes(item.taxPercentage)) fail('payos_items_invalid', 422);
  }
  delete req.signature;
  return req;
}

function createPayOSClient(config, { transport = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const clientId = credential(config && config.clientId, 'clientId');
  const apiKey = credential(config.apiKey, 'apiKey');
  const checksumKey = credential(config.checksumKey, 'checksumKey');
  const baseUrl = trimTrailingSlashes(config.baseUrl || BASE_URL);
  const headers = { 'x-client-id': clientId, 'x-api-key': apiKey, ...(config.partnerCode ? { 'x-partner-code': config.partnerCode } : {}) };

  async function call(method, path, body, { verify = true } = {}) {
    const json = await requestJson(transport, baseUrl + path, { method, headers, body, timeoutMs, prefix: 'payos' });
    if (!json || json.code !== '00' || !json.data) {
      fail('payos_rejected', 502, { message: json && json.desc ? `payOS: ${json.desc}` : 'payOS rejected the request', details: { code: json && json.code } });
    }
    /* A response we cannot verify is treated as not received: acting on an
       unsigned checkout URL would send a customer to wherever it points. */
    if (verify && !verifyDataSignature(json.data, json.signature, checksumKey)) fail('payos_response_signature_invalid', 502);
    return json.data;
  }

  return Object.freeze({
    baseUrl,
    async createPaymentLink(input) {
      const req = normalizeCreateRequest(input);
      req.signature = paymentRequestSignature(req, checksumKey);
      return call('POST', '/v2/payment-requests', req);
    },
    getPaymentLink: (idOrOrderCode) => call('GET', `/v2/payment-requests/${encodeURIComponent(idOrOrderCode)}`),
    cancelPaymentLink: (idOrOrderCode, cancellationReason) =>
      call('POST', `/v2/payment-requests/${encodeURIComponent(idOrOrderCode)}/cancel`, cancellationReason ? { cancellationReason } : undefined),
    /* payOS calls the URL with a test payload before accepting it, so the
       webhook route must already be deployed and answer 2xx. */
    confirmWebhook: (webhookUrl) => call('POST', '/confirm-webhook', { webhookUrl: absoluteUrl(webhookUrl, 'webhookUrl') }, { verify: false }),
    verifyWebhook(body) {
      const payload = typeof body === 'string' || Buffer.isBuffer(body) ? JSON.parse(String(body)) : body;
      if (!payload || !payload.data || typeof payload.signature !== 'string') fail('payos_webhook_invalid', 400);
      if (!verifyDataSignature(payload.data, payload.signature, checksumKey)) fail('payos_webhook_signature_invalid', 401);
      return payload;
    },
  });
}

module.exports = { createPayOSClient, normalizeCreateRequest, BASE_URL };
