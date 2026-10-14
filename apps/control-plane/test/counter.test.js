'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createProviderRegistry, createJournal } = require('@hitechpos/payment-core');
const { dataSignature } = require('@hitechpos/payment-payos');
const { decodeVietQR } = require('@hitechpos/vietqr');

const SHOP_KEY = 'shop-checksum';

async function boot() {
  const payosCalls = [];
  const transport = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : {};
    payosCalls.push({ url, body, headers: init.headers });
    const data = { bin: '970422', accountNumber: '0001', accountName: 'QUAN PHO TUE', amount: body.amount, description: body.description,
      orderCode: body.orderCode, currency: 'VND', paymentLinkId: `pl${body.orderCode}`, status: 'PENDING', checkoutUrl: `https://pay.payos.vn/web/pl${body.orderCode}`, qrCode: '00020101021238' };
    return new Response(JSON.stringify({ code: '00', desc: 'success', data, signature: dataSignature(data, SHOP_KEY) }));
  };
  const config = loadConfig({ STORE: 'memory', ADMIN_API_KEY: 'admin-key', PUBLIC_URL: 'https://app.hitechpos.vn' });
  const store = createMemoryStore();
  const { app } = createApp({ store, config, providers: createProviderRegistry(), installer: { async install() {} },
    logger: { warn() {}, error() {} }, counterOptions: { payos: { transport } } });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null), text: res.headers.get('content-type') };
  };
  const signup = async (subdomain) => {
    const r = await call('POST', '/api/signup', { subdomain, businessName: `Quán ${subdomain}`, industry: 'nha-hang-quan-an', ownerName: 'Chủ', email: `${subdomain}@shop.vn`, phone: '0987654321', password: 'matkhau123' });
    assert.equal(r.status, 201);
    return { token: { authorization: `Bearer ${r.json.token}` }, id: r.json.tenant.id };
  };
  return { call, server, store, signup, payosCalls };
}

test('VietQR at the counter: settings, API key, idempotent QR, manual confirm, customer display', async (t) => {
  const { call, server, signup } = await boot();
  t.after(() => server.close());
  const shop = await signup('photue');

  assert.equal((await call('PUT', '/api/shop/payment-settings', { vietqr: { bank: 'MB', accountNumber: '0912 345 678', accountName: 'Phở Tuệ' } }, shop.token)).json.vietqr.bin, '970422');
  assert.equal((await call('PUT', '/api/shop/payment-settings', { vietqr: { bank: 'XYZ', accountNumber: '1' } }, shop.token)).json.error, 'bank_invalid');

  const key = (await call('POST', '/api/shop/api-keys', { label: 'Quầy 1' }, shop.token)).json;
  assert.match(key.key, /^htp_live_/);
  assert.ok(!JSON.stringify((await call('GET', '/api/shop/api-keys', undefined, shop.token)).json).includes(key.key));
  const posAuth = { authorization: `Bearer ${key.key}` };

  assert.equal((await call('POST', '/pos/v1/payments', { saleRef: 'S1', amount: 85000 }, { authorization: 'Bearer htp_live_wrong' })).status, 401);
  const p1 = await call('POST', '/pos/v1/payments', { saleRef: 'S-0001', amount: 85000, method: 'vietqr' }, posAuth);
  assert.equal(p1.status, 201, JSON.stringify(p1.json));
  const qr = decodeVietQR(p1.json.qrPayload);
  assert.equal(qr.crcValid, true);
  assert.equal(qr.bin, '970422');
  assert.equal(qr.accountNumber, '0912345678');
  assert.equal(Number(qr.amount), 85000);
  assert.ok(String(qr.addInfo || qr.purpose || '').startsWith(String(p1.json.orderCode)), JSON.stringify(qr));

  /* Retry from the POS returns the same QR, a changed amount replaces it. */
  assert.equal((await call('POST', '/pos/v1/payments', { saleRef: 'S-0001', amount: 85000 }, posAuth)).json.orderCode, p1.json.orderCode);
  const p2 = (await call('POST', '/pos/v1/payments', { saleRef: 'S-0001', amount: 90000 }, posAuth)).json;
  assert.notEqual(p2.orderCode, p1.json.orderCode);
  assert.equal((await call('GET', `/pos/v1/payments/${p1.json.orderCode}`, undefined, posAuth)).json.status, 'cancelled');

  const pub = (await call('GET', `/api/public/pay/${shop.id}/${p2.orderCode}`)).json;
  assert.equal(pub.amount, 90000);
  assert.equal(pub.status, 'pending');
  assert.equal(pub.saleRef, undefined);
  assert.match((await call('GET', `/pay/${shop.id}/${p2.orderCode}`)).text, /text\/html/);

  const confirmed = (await call('POST', `/pos/v1/payments/${p2.orderCode}/confirm`, { by: 'thu ngân A' }, posAuth)).json;
  assert.equal(confirmed.status, 'paid');
  assert.equal((await call('POST', '/pos/v1/payments', { saleRef: 'S-0001', amount: 1000 }, posAuth)).json.error, 'sale_already_paid');

  /* Another shop's key cannot see this payment. */
  const other = await signup('quanbun');
  const otherKey = (await call('POST', '/api/shop/api-keys', {}, other.token)).json.key;
  assert.equal((await call('GET', `/pos/v1/payments/${p2.orderCode}`, undefined, { authorization: `Bearer ${otherKey}` })).status, 404);

  /* Revoked keys stop working. */
  await call('DELETE', `/api/shop/api-keys/${key.id}`, undefined, shop.token);
  assert.equal((await call('GET', `/pos/v1/payments/${p2.orderCode}`, undefined, posAuth)).status, 401);
});

test("payOS at the counter uses the shop's own keys and webhook", async (t) => {
  const { call, server, signup, payosCalls } = await boot();
  t.after(() => server.close());
  const shop = await signup('photue');
  const settings = (await call('PUT', '/api/shop/payment-settings', { payos: { clientId: 'shop-client', apiKey: 'shop-api-key', checksumKey: SHOP_KEY } }, shop.token)).json;
  assert.ok(!JSON.stringify(settings).includes('shop-api-key'));
  assert.ok(!JSON.stringify(settings).includes(SHOP_KEY));
  assert.deepEqual(settings.methods, ['payos']);

  const key = (await call('POST', '/api/shop/api-keys', {}, shop.token)).json.key;
  const pay = (await call('POST', '/pos/v1/payments', { saleRef: 'HD-77', amount: 120000, method: 'payos' }, { authorization: `Bearer ${key}` })).json;
  assert.equal(payosCalls[0].headers['x-client-id'], 'shop-client');
  assert.equal(payosCalls[0].body.amount, 120000);
  assert.match(pay.checkoutUrl, /pay\.payos\.vn/);

  const data = { orderCode: pay.orderCode, amount: 120000, description: 'x', accountNumber: '0001', reference: 'FT1', transactionDateTime: '2026-10-14 12:00:00',
    currency: 'VND', paymentLinkId: `pl${pay.orderCode}`, code: '00', desc: 'Thành công' };
  const wrongShop = await signup('khac');
  assert.equal((await call('POST', `/webhooks/shop/${wrongShop.id}/payos`, { data, signature: dataSignature(data, SHOP_KEY) })).status, 422);
  assert.equal((await call('POST', `/webhooks/shop/${shop.id}/payos`, { data, signature: dataSignature(data, 'attacker') })).status, 401);
  const ok = await call('POST', `/webhooks/shop/${shop.id}/payos`, { code: '00', data, signature: dataSignature(data, SHOP_KEY) });
  assert.equal(ok.json.status, 'paid');
  assert.equal((await call('GET', `/api/public/pay/${shop.id}/${pay.orderCode}`)).json.status, 'paid');
  assert.equal((await call('GET', '/api/shop/payments', undefined, shop.token)).json[0].status, 'paid');
});

test('Pay2S bank feed settles VietQR payments by order code', async (t) => {
  const { call, server, signup } = await boot();
  t.after(() => server.close());
  const shop = await signup('photue');
  const token = 'bank-feed-token-0123456789';
  const s = (await call('PUT', '/api/shop/payment-settings', { vietqr: { bank: '970422', accountNumber: '0912345678', accountName: 'Pho Tue' }, bankFeed: { token } }, shop.token)).json;
  assert.deepEqual(s.bankFeed, { provider: 'pay2s', token: '••••••••' });
  assert.match(s.webhooks.bankFeed, new RegExp(`/webhooks/shop/${shop.id}/bank-feed$`));
  const key = (await call('POST', '/api/shop/api-keys', {}, shop.token)).json.key;
  const pos = { authorization: `Bearer ${key}` };
  const a = (await call('POST', '/pos/v1/payments', { saleRef: 'A', amount: 85000 }, pos)).json;
  const b = (await call('POST', '/pos/v1/payments', { saleRef: 'B', amount: 50000 }, pos)).json;

  const feed = (transactions, auth = `Bearer ${token}`) => call('POST', `/webhooks/shop/${shop.id}/bank-feed`, { transactions }, { authorization: auth });
  assert.equal((await feed([], 'Bearer wrong')).status, 401);
  const r = await feed([
    { id: 1, accountNumber: '0912345678', content: `MBVCB.123.${a.orderCode} photue A`, transferType: 'IN', transferAmount: 85000 },
    { id: 2, accountNumber: '0912345678', content: `${b.orderCode}`, transferType: 'IN', transferAmount: 5000 },
    { id: 3, accountNumber: '0912345678', content: `${a.orderCode}`, transferType: 'OUT', transferAmount: 85000 },
    { id: 4, accountNumber: '9999999999', content: `${b.orderCode}`, transferType: 'IN', transferAmount: 50000 },
  ]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.matched.map((m) => [m.orderCode, m.status]), [[a.orderCode, 'paid'], [b.orderCode, 'review']]);
  assert.equal((await call('GET', `/pos/v1/payments/${a.orderCode}`, undefined, pos)).json.status, 'paid');
  /* Same bank transaction delivered twice is applied once. */
  const again = await feed([{ id: 1, accountNumber: '0912345678', content: `${a.orderCode}`, transferType: 'IN', transferAmount: 85000 }]);
  assert.equal(again.json.matched[0].ignored, 'duplicate');
});

test("a shop's own webhook cannot settle its subscription payment", async (t) => {
  const { call, server, store, signup } = await boot();
  t.after(() => server.close());
  const shop = await signup('tuthanhtoan');
  await call('PUT', '/api/shop/payment-settings', { payos: { clientId: 'c', apiKey: 'k', checksumKey: SHOP_KEY } }, shop.token);
  /* A pending subscription checkout of this shop, as billing.checkout opens it. */
  const orderCode = 1791966752534999;
  await createJournal({ store: store.payments }).open({ orderCode, provider: 'payos', amount: 8990000, purpose: 'subscription', reference: shop.id, metadata: {} });
  for (const amount of [8990000, 8990001]) {
    const data = { orderCode, amount, description: 'x', accountNumber: '0001', reference: 'FT-FAKE', transactionDateTime: '2026-10-14 12:00:00',
      currency: 'VND', paymentLinkId: 'plx', code: '00', desc: 'Thành công' };
    const r = await call('POST', `/webhooks/shop/${shop.id}/payos`, { code: '00', data, signature: dataSignature(data, SHOP_KEY) });
    assert.equal(r.status, 200);
    assert.equal(r.json.ignored, 'unknown_order');
  }
  const row = await store.payments.findByOrderCode(orderCode);
  assert.equal(row.status, 'pending');
  assert.equal(row.events.length, 0);
});
