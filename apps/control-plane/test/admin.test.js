'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createProviderRegistry } = require('@hitechpos/payment-core');
const { createPayOSProvider, dataSignature } = require('@hitechpos/payment-payos');

test('admin: stats, tenant list without secrets, accept a payment in review', async (t) => {
  const KEY = 'ck';
  const transport = async (url, init) => {
    const b = JSON.parse(init.body);
    const data = { bin: '970422', accountNumber: '1', accountName: 'X', amount: b.amount, description: b.description, orderCode: b.orderCode, currency: 'VND', paymentLinkId: 'pl', status: 'PENDING', checkoutUrl: 'https://pay.payos.vn/x', qrCode: 'q' };
    return new Response(JSON.stringify({ code: '00', desc: 'ok', data, signature: dataSignature(data, KEY) }));
  };
  const config = loadConfig({ STORE: 'memory', ADMIN_API_KEY: 'admin-secret-key', PUBLIC_URL: 'https://app.hitechpos.vn' });
  const { app } = createApp({ store: createMemoryStore(), config, logger: { warn() {}, error() {} }, installer: { async install() {} },
    providers: createProviderRegistry([createPayOSProvider({ clientId: 'c', apiKey: 'a', checksumKey: KEY }, { transport })]) });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const A = { 'x-admin-key': 'admin-secret-key' };
  const s = (await call('POST', '/api/signup', { subdomain: 'photue', businessName: 'Phở Tuệ', industry: 'nha-hang-quan-an', ownerName: 'T', email: 't@p.vn', phone: '0912345678', password: 'matkhau123' })).json;
  const owner = { authorization: `Bearer ${s.token}` };

  assert.equal((await call('GET', '/api/admin/stats')).status, 401);
  const list = (await call('GET', '/api/admin/tenants', undefined, A)).json;
  assert.equal(list[0].subdomain, 'photue');
  assert.ok(!JSON.stringify(list).includes('v1:'), 'sealed secrets must not leave the server');

  const checkout = (await call('POST', '/api/billing/checkout', { plan: 'basic', months: 1, provider: 'payos' }, owner)).json;
  const data = { orderCode: checkout.orderCode, amount: 100000, description: 'x', accountNumber: '1', reference: 'FT', transactionDateTime: '2026-10-14 10:00:00', currency: 'VND', paymentLinkId: 'pl', code: '00', desc: 'ok' };
  await call('POST', '/webhooks/payos', { data, signature: dataSignature(data, KEY) });
  const review = (await call('GET', '/api/admin/payments?status=review', undefined, A)).json;
  assert.equal(review.length, 1);
  assert.equal((await call('GET', '/api/me', undefined, owner)).json.tenant.plan.id, 'trial');

  const accepted = (await call('POST', `/api/admin/payments/${checkout.orderCode}/accept`, { note: 'FT bổ sung' }, A)).json;
  assert.equal(accepted.status, 'paid');
  assert.equal((await call('GET', '/api/me', undefined, owner)).json.tenant.plan.id, 'basic');
  assert.equal((await call('POST', `/api/admin/payments/${checkout.orderCode}/accept`, {}, A)).json.error, 'payment_not_in_review');

  const stats = (await call('GET', '/api/admin/stats', undefined, A)).json;
  assert.deepEqual([stats.tenants, stats.paying, stats.mrr], [1, 1, 199000]);
});
