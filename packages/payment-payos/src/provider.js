'use strict';

const { PAYMENT_STATUS, transferDescription, fail } = require('@hitechpos/payment-core');
const { createPayOSClient } = require('./client');

const STATUS = {
  PAID: PAYMENT_STATUS.PAID,
  CANCELLED: PAYMENT_STATUS.CANCELLED,
  EXPIRED: PAYMENT_STATUS.EXPIRED,
  FAILED: PAYMENT_STATUS.FAILED,
  PENDING: PAYMENT_STATUS.PENDING,
  PROCESSING: PAYMENT_STATUS.PENDING,
  UNDERPAID: PAYMENT_STATUS.REVIEW,
};

/* payOS reports transaction time as "YYYY-MM-DD HH:mm:ss" in Vietnam time. */
function toIso(dateTime) {
  if (!dateTime) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(String(dateTime));
  return m ? new Date(`${m[1]}T${m[2]}+07:00`).toISOString() : String(dateTime);
}

/* Adapts the payOS client to the @hitechpos/payment-core provider contract. */
function createPayOSProvider(config, options) {
  const client = createPayOSClient(config, options);
  return Object.freeze({
    id: 'payos',
    client,
    async createCheckout(intent) {
      const data = await client.createPaymentLink({
        orderCode: intent.orderCode,
        amount: intent.amount,
        description: transferDescription(intent.description, { max: 25 }),
        returnUrl: intent.returnUrl,
        cancelUrl: intent.cancelUrl,
        ...(intent.expiresAt ? { expiredAt: Math.floor(new Date(intent.expiresAt).getTime() / 1000) } : {}),
        ...(intent.items ? { items: intent.items } : {}),
        ...(intent.buyer ? {
          buyerName: intent.buyer.name, buyerEmail: intent.buyer.email, buyerPhone: intent.buyer.phone,
          buyerCompanyName: intent.buyer.companyName, buyerTaxCode: intent.buyer.taxCode, buyerAddress: intent.buyer.address,
        } : {}),
      });
      if (data.orderCode !== intent.orderCode || data.amount !== intent.amount) fail('payos_payment_mismatch', 502);
      return { providerRef: data.paymentLinkId, checkoutUrl: data.checkoutUrl, qrCode: data.qrCode,
        bank: { bin: data.bin, accountNumber: data.accountNumber, accountName: data.accountName },
        expiresAt: data.expiredAt ? new Date(data.expiredAt * 1000).toISOString() : null };
    },
    /* Webhook: { code, desc, success, data, signature }. Only data.code '00'
       is a completed transfer; anything else is reported as failed. */
    async verifyCallback({ body }) {
      const payload = client.verifyWebhook(body);
      const d = payload.data;
      const paid = d.code === '00';
      return {
        provider: 'payos',
        orderCode: Number(d.orderCode),
        providerRef: d.paymentLinkId || null,
        status: paid ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.FAILED,
        amount: Number(d.amount),
        transactionId: d.reference || null,
        paidAt: paid ? toIso(d.transactionDateTime) : null,
        eventKey: `payos:${d.paymentLinkId || d.orderCode}:${d.reference || d.code}`,
        raw: d,
      };
    },
    async getStatus(ref) {
      const link = await client.getPaymentLink(ref);
      const last = (link.transactions || [])[link.transactions.length - 1];
      return {
        provider: 'payos',
        orderCode: Number(link.orderCode),
        providerRef: link.id,
        status: STATUS[link.status] || PAYMENT_STATUS.PENDING,
        amount: link.amountPaid || 0,
        transactionId: last ? last.reference : null,
        paidAt: last ? toIso(last.transactionDateTime) : null,
        eventKey: `payos:${link.id}:status:${link.status}:${link.amountPaid}`,
      };
    },
    async cancel(ref, reason) {
      await client.cancelPaymentLink(ref, reason);
    },
  });
}

module.exports = { createPayOSProvider, toIso };
