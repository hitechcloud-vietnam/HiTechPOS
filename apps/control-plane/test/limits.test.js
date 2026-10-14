'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createProviderRegistry } = require('@hitechpos/payment-core');
const { createPayOSProvider, dataSignature } = require('@hitechpos/payment-payos');

test('plan limits are written to the shop on signup and on upgrade', async (t) => {
  const written = [];
  const store = createMemoryStore();
  store.shopBridge = { async setLimits(tenant, limits) { written.push([tenant.subdomain, limits]); } };
  const KEY = 'k';
  const transport = async (url, init) => {
    const b = JSON.parse(init.body);
    const data = { bin: '1', accountNumber: '1', accountName: 'X', amount: b.amount, description: b.description, orderCode: b.orderCode, currency: 'VND', paymentLinkId: 'pl', status: 'PENDING', checkoutUrl: 'https://pay.payos.vn/x', qrCode: 'q' };
    return new Response(JSON.stringify({ code: '00', desc: 'ok', data, signature: dataSignature(data, KEY) }));
  };
  const { app } = createApp({ store, config: loadConfig({ STORE: 'memory' }), logger: { warn() {}, error() {}, info() {} }, installer: { async install() {} },
    providers: createProviderRegistry([createPayOSProvider({ clientId: 'c', apiKey: 'a', checksumKey: KEY }, { transport })]) });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => (await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) })).json();
  const s = await call('POST', '/api/signup', { subdomain: 'photue', businessName: 'Phở Tuệ', industry: 'khac', ownerName: 'T', email: 't@p.vn', phone: '0912345678', password: 'matkhau123' });
  assert.deepEqual(written[0], ['photue', { branches: 1, users: 3, devices: 2, products: 500 }]);
  const co = await call('POST', '/api/billing/checkout', { plan: 'pro', months: 1, provider: 'payos' }, { authorization: `Bearer ${s.token}` });
  const data = { orderCode: co.orderCode, amount: co.quote.total, description: 'x', accountNumber: '1', reference: 'FT', transactionDateTime: '2026-10-14 10:00:00', currency: 'VND', paymentLinkId: 'pl', code: '00', desc: 'ok' };
  await call('POST', '/webhooks/payos', { data, signature: dataSignature(data, KEY) });
  assert.deepEqual(written[1], ['photue', { branches: 3, users: 15, devices: 10, products: 50000 }]);
});
