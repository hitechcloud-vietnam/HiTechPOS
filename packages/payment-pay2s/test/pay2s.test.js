'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sign, CREATE_PAYMENT_FIELDS, IPN_FIELDS, createPay2SClient, createPay2SProvider, orderInfoFor } = require('../src');
const { createJournal } = require('@hitechpos/payment-core');

const CONFIG = { environment: 'sandbox', accessKey: 'AK123', partnerCode: 'PC123', secretKey: 'p2s-secret' };
const IPN = {
  accessKey: 'AK123', amount: 199000, extraData: '', message: 'Thanh cong', orderId: '1760428800123',
  orderInfo: 'GoiCoBan1760428800123', orderType: 'pay2s', partnerCode: 'PC123', payType: 'qr',
  requestId: '1760428800123', responseTime: 1760428900000, resultCode: 0, transId: 'FT2510140001',
};

/* Vectors produced with pay2s-node 0.3.0 (createPaymentSignature / IPN canonicalize). */
test('signatures match the reference SDK', () => {
  assert.equal(sign(CREATE_PAYMENT_FIELDS, {
    accessKey: 'AK123', partnerCode: 'PC123', requestId: '1760428800123', amount: 199000, orderId: '1760428800123',
    orderInfo: 'GoiCoBan1760428800123', redirectUrl: 'https://app.hitechpos.vn/r', ipnUrl: 'https://app.hitechpos.vn/ipn',
    requestType: 'pay2s', bankAccounts: [],
  }, 'p2s-secret'), 'eb48cde2415480f943bc6e4805bca09f84aeeac8d3c6cc2767b5cb85ccbcb9e8');
  assert.equal(sign(IPN_FIELDS, IPN, 'p2s-secret'), '81a29d5476c177bec634a408decc4d0c51462d3bb0c979a884cefa65f7a2af14');
});

test('orderInfo is 10-32 alphanumerics', () => {
  assert.equal(orderInfoFor({ description: 'Gói Cơ bản', orderCode: 1760428800123 }), 'GoiCoban1760428800123');
  assert.equal(orderInfoFor({ description: '', orderCode: 12 }), '1200000000');
  assert.ok(orderInfoFor({ description: 'x'.repeat(50), orderCode: 1 }).length <= 32);
});

test('createCheckout posts a signed request to the sandbox', async () => {
  const calls = [];
  const transport = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ resultCode: 0, message: 'Success', requestId: '1760428800123', payUrl: 'https://sandbox-payment.pay2s.vn/pay/abc' }));
  };
  const provider = createPay2SProvider(CONFIG, { transport });
  const out = await provider.createCheckout({ orderCode: 1760428800123, amount: 199000, description: 'Gói Cơ bản',
    returnUrl: 'https://app.hitechpos.vn/r', ipnUrl: 'https://app.hitechpos.vn/ipn' });
  assert.equal(out.checkoutUrl, 'https://sandbox-payment.pay2s.vn/pay/abc');
  assert.equal(calls[0].url, 'https://sandbox-payment.pay2s.vn/v1/gateway/api/create');
  assert.equal(calls[0].body.signature, sign(CREATE_PAYMENT_FIELDS, calls[0].body, 'p2s-secret'));
});

test('Pay2S rejection and bad input', async () => {
  const transport = async () => new Response(JSON.stringify({ resultCode: 21, message: 'Invalid amount' }));
  const client = createPay2SClient(CONFIG, { transport });
  const base = { orderId: '1', amount: 1000, orderInfo: 'ABCDEFGHIJ', redirectUrl: 'https://a.vn/r', ipnUrl: 'https://a.vn/i' };
  await assert.rejects(client.createPayment(base), { code: 'pay2s_rejected' });
  await assert.rejects(client.createPayment({ ...base, orderInfo: 'ngắn' }), { code: 'pay2s_order_info_invalid' });
  assert.throws(() => createPay2SClient({ ...CONFIG, environment: 'prod' }), { code: 'pay2s_configuration_invalid' });
});

test('IPN: verified, bound to merchant, settles journal', async () => {
  const provider = createPay2SProvider(CONFIG, { transport: async () => { throw new Error('offline'); } });
  const body = JSON.stringify({ ...IPN, m2signature: sign(IPN_FIELDS, IPN, 'p2s-secret') });
  const event = await provider.verifyCallback({ body });
  assert.equal(event.status, 'paid');
  assert.equal(event.orderCode, 1760428800123);
  assert.equal(event.paidAt, new Date(1760428900000).toISOString());

  const journal = createJournal();
  await journal.open({ orderCode: 1760428800123, provider: 'pay2s', amount: 199000 });
  assert.equal((await journal.apply(event)).payment.status, 'paid');
  assert.equal((await journal.apply(event)).ignored, 'duplicate');

  const tampered = JSON.stringify({ ...IPN, amount: 1, m2signature: sign(IPN_FIELDS, IPN, 'p2s-secret') });
  await assert.rejects(provider.verifyCallback({ body: tampered }), { code: 'pay2s_callback_signature_invalid' });
  const other = { ...IPN, partnerCode: 'OTHER' };
  await assert.rejects(provider.verifyCallback({ body: { ...other, m2signature: sign(IPN_FIELDS, other, 'p2s-secret') } }), { code: 'pay2s_callback_partner_mismatch' });
});

test('IPN with non-zero resultCode is a failure event', async () => {
  const provider = createPay2SProvider(CONFIG, { transport: async () => { throw new Error('offline'); } });
  const failed = { ...IPN, resultCode: 1006, transId: '' };
  const event = await provider.verifyCallback({ body: { ...failed, m2signature: sign(IPN_FIELDS, failed, 'p2s-secret') } });
  assert.equal(event.status, 'failed');
  assert.equal(event.paidAt, null);
});
