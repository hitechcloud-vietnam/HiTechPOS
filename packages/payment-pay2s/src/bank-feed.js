'use strict';

const { safeEqual, fail } = require('@hitechpos/payment-core');

/*
 * Pay2S bank-transaction webhook ("biến động số dư"): Pay2S watches the
 * shop's own bank account and posts every movement as
 *   { transactions: [{ id, gateway, transactionDate, transactionNumber,
 *     accountNumber, vaNumber, content, transferType: 'IN'|'OUT',
 *     transferAmount, checksum }] }
 * authenticated with `Authorization: Bearer <token>` (the token the shop
 * sets on the Pay2S webhook). Field names follow pay2s-node 0.3.0
 * (Pay2sWebhookTransaction); confirm against the account's webhook contract.
 *
 * This lets a plain VietQR transfer to the shop's account settle a counter
 * payment without the cashier confirming it by hand.
 */
function verifyBearer(authorization, token) {
  if (typeof token !== 'string' || !token) fail('pay2s_bank_feed_not_configured', 422);
  const given = String(authorization || '').replace(/^Bearer\s+/i, '');
  if (!given || !safeEqual(token, given)) fail('pay2s_bank_feed_unauthorized', 401);
}

function toAmount(value) {
  const n = Number(String(value ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

function parseBankFeed(body, { authorization, token }) {
  verifyBearer(authorization, token);
  let payload = body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try {
      payload = JSON.parse(String(body));
    } catch {
      fail('pay2s_bank_feed_invalid', 400);
    }
  }
  if (!payload || !Array.isArray(payload.transactions)) fail('pay2s_bank_feed_invalid', 400);
  return payload.transactions
    .filter((t) => t && typeof t === 'object')
    .map((t) => ({
      id: String(t.id ?? t.transactionNumber ?? ''),
      bank: t.gateway || null,
      accountNumber: t.accountNumber ? String(t.accountNumber) : null,
      virtualAccount: t.vaNumber ? String(t.vaNumber) : null,
      content: String(t.content || t.description || ''),
      direction: String(t.transferType || t.type || '').toUpperCase() === 'OUT' ? 'out' : 'in',
      amount: toAmount(t.transferAmount ?? t.amount),
      at: t.transactionDate || t.transaction_date || null,
    }))
    .filter((t) => t.id && Number.isSafeInteger(t.amount) && t.amount > 0);
}

module.exports = { parseBankFeed };
