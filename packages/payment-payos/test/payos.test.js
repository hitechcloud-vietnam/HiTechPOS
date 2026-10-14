'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentRequestSignature, dataSignature, createPayOSClient, createPayOSProvider } = require('../src');
const { createJournal } = require('@hitechpos/payment-core');

const KEY = 'test-checksum-key';
const CONFIG = { clientId: 'cid', apiKey: 'akey', checksumKey: KEY };
const WEBHOOK_DATA = {
  orderCode: 123, amount: 3000, description: 'VQRIO123', accountNumber: '12345678',
  reference: 'TF230204212323', transactionDateTime: '2023-02-04 18:25:00', currency: 'VND',
  paymentLinkId: '124c33293c43417ab7879e14c8d9eb18', code: '00', desc: 'Thành công',
  counterAccountBankId: '', counterAccountBankName: '', counterAccountName: '', counterAccountNumber: '',
  virtualAccountName: '', virtualAccountNumber: null,
};

/* Vectors produced with the official @payos/node 2.0.5 NodeCryptoProvider. */
test('signatures match the official SDK', () => {
  assert.equal(paymentRequestSignature({
    amount: 199000, cancelUrl: 'https://app.hitechpos.vn/billing/cancel', description: 'HTP 1760428800123',
    orderCode: 1760428800123, returnUrl: 'https://app.hitechpos.vn/billing/return',
  }, KEY), 'bbcd7c270ffbeeb8eb66d0688a63b62a046ae8ed27625a8c6d0591da6d72c9f0');
  assert.equal(dataSignature(WEBHOOK_DATA, KEY), '15cd38e52473536ad13caec70a9d5fd6446d63812d84e3ab2af193feb5dded64');
});

function fakePayOS(handler) {
  const calls = [];
  const transport = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const { status = 200, json } = await handler(url, init, calls[calls.length - 1]);
    return new Response(JSON.stringify(json), { status });
  };
  return { transport, calls };
}

function signed(data) {
  return { code: '00', desc: 'success', data, signature: dataSignature(data, KEY) };
}

const INTENT = {
  orderCode: 1760428800123, amount: 199000, description: 'Gói Cơ bản – tháng 10',
  returnUrl: 'https://app.hitechpos.vn/r', cancelUrl: 'https://app.hitechpos.vn/c',
};

test('createCheckout signs the request and verifies the response', async () => {
  const { transport, calls } = fakePayOS((url, init, call) => ({
    json: signed({ bin: '970422', accountNumber: '113366668888', accountName: 'CONG TY', amount: call.body.amount,
      description: call.body.description, orderCode: call.body.orderCode, currency: 'VND', paymentLinkId: 'pl_1',
      status: 'PENDING', checkoutUrl: 'https://pay.payos.vn/web/pl_1', qrCode: '000201...' }),
  }));
  const provider = createPayOSProvider(CONFIG, { transport });
  const out = await provider.createCheckout(INTENT);
  assert.equal(out.checkoutUrl, 'https://pay.payos.vn/web/pl_1');
  const sent = calls[0];
  assert.equal(sent.url, 'https://api-merchant.payos.vn/v2/payment-requests');
  assert.equal(sent.init.headers['x-client-id'], 'cid');
  assert.equal(sent.init.headers['x-api-key'], 'akey');
  assert.equal(sent.body.description, 'Goi Co ban thang 10');
  assert.equal(sent.body.signature, paymentRequestSignature(sent.body, KEY));
});

test('a response with a forged signature is rejected', async () => {
  const { transport } = fakePayOS(() => ({ json: { code: '00', desc: 'ok', data: { checkoutUrl: 'https://evil' }, signature: 'deadbeef' } }));
  const client = createPayOSClient(CONFIG, { transport });
  await assert.rejects(client.createPaymentLink(INTENT), { code: 'payos_response_signature_invalid' });
});

test('payOS error codes surface as payos_rejected', async () => {
  const { transport } = fakePayOS(() => ({ json: { code: '231', desc: 'Đơn thanh toán đã tồn tại', data: null } }));
  const client = createPayOSClient(CONFIG, { transport });
  await assert.rejects(client.createPaymentLink(INTENT), { code: 'payos_rejected' });
});

test('input validation happens before any network call', async () => {
  const { transport, calls } = fakePayOS(() => ({ json: {} }));
  const client = createPayOSClient(CONFIG, { transport });
  await assert.rejects(client.createPaymentLink({ ...INTENT, amount: 10.5 }), { code: 'payos_amount_invalid' });
  await assert.rejects(client.createPaymentLink({ ...INTENT, returnUrl: '/relative' }), { code: 'payos_request_invalid' });
  assert.equal(calls.length, 0);
  assert.throws(() => createPayOSClient({ clientId: 'x' }), { code: 'payos_configuration_invalid' });
});

test('webhook: verified event settles the journal; forged one is refused', async () => {
  const provider = createPayOSProvider(CONFIG, { transport: async () => { throw new Error('no network'); } });
  const body = JSON.stringify({ code: '00', desc: 'success', success: true, data: WEBHOOK_DATA, signature: dataSignature(WEBHOOK_DATA, KEY) });
  const event = await provider.verifyCallback({ body });
  assert.equal(event.status, 'paid');
  assert.equal(event.paidAt, '2023-02-04T11:25:00.000Z');

  const journal = createJournal();
  await journal.open({ orderCode: 123, provider: 'payos', amount: 3000 });
  assert.equal((await journal.apply(event)).payment.status, 'paid');

  const forged = JSON.stringify({ data: { ...WEBHOOK_DATA, amount: 3000000 }, signature: dataSignature(WEBHOOK_DATA, KEY) });
  await assert.rejects(provider.verifyCallback({ body: forged }), { code: 'payos_webhook_signature_invalid' });
});
