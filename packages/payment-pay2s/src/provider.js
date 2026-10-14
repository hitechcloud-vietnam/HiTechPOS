'use strict';

const { PAYMENT_STATUS, transferDescription, fail } = require('@hitechpos/payment-core');
const { createPay2SClient } = require('./client');

/*
 * Adapts Pay2S to the @hitechpos/payment-core provider contract.
 * The journal's orderCode (a safe integer) is sent as Pay2S orderId; the
 * transfer content (orderInfo) must be 10-32 alphanumerics, so it is derived
 * from the description and padded with the order code when too short.
 */
function orderInfoFor(intent) {
  const base = transferDescription(intent.description, { allowSpaces: false, max: 32 });
  const withCode = (base + String(intent.orderCode)).slice(0, 32);
  return withCode.length >= 10 ? withCode : withCode.padEnd(10, '0');
}

function toIso(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(/^\d+$/.test(String(value)) ? Number(value) : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function createPay2SProvider(config, options) {
  const client = createPay2SClient(config, options);
  return Object.freeze({
    id: 'pay2s',
    client,
    async createCheckout(intent) {
      if (!intent.ipnUrl) fail('pay2s_request_invalid', 422, { message: 'ipnUrl is required for Pay2S' });
      const res = await client.createPayment({
        orderId: String(intent.orderCode),
        requestId: String(intent.orderCode),
        amount: intent.amount,
        orderInfo: orderInfoFor(intent),
        redirectUrl: intent.returnUrl,
        ipnUrl: intent.ipnUrl,
        bankAccounts: intent.bankAccounts || [],
      });
      return { providerRef: res.requestId ? String(res.requestId) : String(intent.orderCode), checkoutUrl: res.paymentUrl, qrCode: res.qrCode || res.qrUrl || null };
    },
    /* resultCode 0 is a completed payment; any other code is a failure. */
    async verifyCallback({ body }) {
      const p = client.verifyIpn(body);
      const paid = Number(p.resultCode) === 0;
      return {
        provider: 'pay2s',
        orderCode: Number(p.orderId),
        providerRef: String(p.requestId),
        status: paid ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.FAILED,
        amount: Number(p.amount),
        transactionId: p.transId ? String(p.transId) : null,
        paidAt: paid ? toIso(p.responseTime) : null,
        eventKey: `pay2s:${p.partnerCode}:${p.orderId}:${p.requestId}:${p.transId || p.resultCode}`,
        raw: p,
      };
    },
  });
}

module.exports = { createPay2SProvider, orderInfoFor };
