'use strict';
/*
 * HiTechPOS counter payments for the sales screen's QR tile.
 *
 * HiTechPOS (https://github.com/hitechcloud-vietnam/HiTechPOS) runs this API
 * as a multi-tenant shard. A shop that configures VietQR / payOS / Pay2S in
 * the HiTechPOS console gets `payment_gateway.provider = 'hitechpos'` on its
 * branch, and the existing QR flow (generateQrCode -> poll getQrStatus ->
 * captured) is answered by the HiTechPOS payment service instead of
 * Razorpay. The sales screen is unchanged.
 *
 *   HITECH_PAY_URL      internal base URL of the HiTechPOS control plane
 *   HITECH_POS_KEY      per-shop API key, read from the tenant scope
 *                       (sealed into the shop's secrets by the control plane)
 *
 * Ids handed to the browser are "htp_<orderCode>" so getQrStatus can tell
 * them apart from Razorpay QR ids without a lookup.
 */
const http = require('http');
const https = require('https');
const { currentSecret } = require('../db/tenant-context');

const PREFIX = 'htp_';

function baseUrl() {
  const url = String(process.env.HITECH_PAY_URL || '').replace(/\/+$/, '');
  if (!url) throw new Error('HITECH_PAY_URL is not configured');
  return url;
}

function apiKey() {
  const key = currentSecret('HITECH_POS_KEY', process.env.HITECH_POS_KEY || null);
  if (!key) throw new Error('HiTechPOS payments are not connected for this shop');
  return key;
}

/* node:http rather than fetch: internal hosts may use ports fetch refuses. */
function request(method, path, body) {
  const target = new URL(baseUrl() + path);
  const lib = target.protocol === 'https:' ? https : http;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = lib.request(
      target,
      {
        method,
        timeout: 15000,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey()}`,
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
          } catch {
            /* fall through with null */
          }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
          reject(new Error((json && json.message) || `HiTechPOS payments answered ${res.statusCode}`));
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('HiTechPOS payments timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function isHitechConfig(paymentGatewayConfig) {
  return !!paymentGatewayConfig && paymentGatewayConfig.provider === 'hitechpos';
}

function isHitechId(id) {
  return typeof id === 'string' && id.startsWith(PREFIX);
}

/* VND has no minor unit; the screen may send "85000.00". */
function toVnd(amount) {
  const value = Math.round(Number(String(amount).replace(/,/g, '')));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid amount');
  return value;
}

async function generate(amount, { method } = {}) {
  /* The sale does not exist yet when the QR is shown, so the reference is
     unique per QR; qrSalePayementUpdate links the sale afterwards. */
  const saleRef = `posnic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const payment = await request('POST', '/pos/v1/payments', {
    saleRef,
    amount: toVnd(amount),
    ...(method ? { method } : {}),
  });
  return {
    status: true,
    data: { id: PREFIX + payment.orderCode, image_url: payment.qrImageUrl, checkout_url: payment.checkoutUrl || null, display_url: payment.displayUrl || null },
    message: 'QR Code Generate successfully',
  };
}

/* Shaped for the sales screen poller: captured + closed completes the sale,
   closed alone falls back to Cash. */
async function status(id) {
  const payment = await request('GET', `/pos/v1/payments/${encodeURIComponent(id.slice(PREFIX.length))}`);
  const paid = payment.status === 'paid';
  const closed = paid || ['cancelled', 'expired', 'failed'].includes(payment.status);
  return {
    status: true,
    data: {
      id,
      transactionId: id,
      payment: paid ? 'captured' : payment.status,
      qr_code: closed ? 'closed' : 'active',
      payment_status: paid ? 'captured' : payment.status,
      qr_status: closed ? 'closed' : 'active',
      items: [{ status: paid ? 'captured' : payment.status, amount: payment.amount }],
    },
    message: 'QR status retrieved successfully',
  };
}

async function confirm(id, { by } = {}) {
  const payment = await request('POST', `/pos/v1/payments/${encodeURIComponent(id.slice(PREFIX.length))}/confirm`, { by });
  return { status: true, data: { id, status: payment.status }, message: 'Payment confirmed' };
}

async function close(id) {
  await request('POST', `/pos/v1/payments/${encodeURIComponent(id.slice(PREFIX.length))}/cancel`, {});
  return { status: true, data: { id }, message: 'QR closed' };
}

module.exports = { isHitechConfig, isHitechId, generate, status, confirm, close, toVnd, PREFIX };
