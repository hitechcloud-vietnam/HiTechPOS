'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createProviderRegistry } = require('@hitechpos/payment-core');
const { createPayOSProvider, dataSignature } = require('@hitechpos/payment-payos');

const KEY = 'checksum';
let clock = new Date('2026-10-14T03:00:00Z');

function payosTransport(created) {
  return async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : {};
    const data = { bin: '970422', accountNumber: '0001', accountName: 'HITECHCLOUD', amount: body.amount, description: body.description,
      orderCode: body.orderCode, currency: 'VND', paymentLinkId: `pl${body.orderCode}`, status: 'PENDING', checkoutUrl: `https://pay.payos.vn/web/pl${body.orderCode}`, qrCode: '0002' };
    created.push(body);
    return new Response(JSON.stringify({ code: '00', desc: 'success', data, signature: dataSignature(data, KEY) }));
  };
}

async function boot({ installer } = {}) {
  const created = [];
  const installs = [];
  const config = { ...loadConfig({ STORE: 'memory', ADMIN_API_KEY: 'admin-key', PUBLIC_URL: 'https://app.hitechpos.vn' }) };
  const providers = createProviderRegistry([createPayOSProvider({ clientId: 'c', apiKey: 'a', checksumKey: KEY }, { transport: payosTransport(created) })]);
  const store = createMemoryStore();
  const { app, billing } = createApp({
    store, config, providers, now: () => clock, logger: { warn() {}, error() {} },
    installer: installer || { async install(args) { installs.push(args); } },
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { call, server, store, created, installs, billing };
}

const SIGNUP = { subdomain: 'photue', businessName: 'Cà phê Phở Tuệ', industry: 'cafe-tra-sua', ownerName: 'Chủ quán', email: 'Owner@PhoTue.vn', phone: '+84 912 345 678', password: 'matkhau123' };

test('signup -> pay with payOS -> subscription active', async (t) => {
  const { call, server, store, created, installs } = await boot();
  t.after(() => server.close());

  assert.equal((await call('GET', '/api/subdomains/photue')).json.available, true);
  const signup = await call('POST', '/api/signup', SIGNUP);
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal(signup.json.tenant.status, 'active');
  assert.equal(signup.json.tenant.subscription.status, 'trialing');
  assert.deepEqual(signup.json.tenant.urls, ['https://photue.hitechpos.vn']);
  assert.equal(installs[0].industry.businessType, 'cafe');
  assert.equal(installs[0].owner.email, 'owner@photue.vn');

  const row = await store.tenants.findOne({ subdomain: 'photue' });
  assert.equal(row.tenantDb, 'hitech_t_photue');
  assert.match(row.secrets.JWT_SECRET, /^v1:/);
  assert.equal(row.provisioned, true);

  assert.equal((await call('GET', '/api/subdomains/photue')).json.reason, 'taken');
  assert.equal((await call('POST', '/api/signup', { ...SIGNUP, email: 'x@y.vn' })).status, 409);

  const auth = { authorization: `Bearer ${signup.json.token}` };
  const checkout = await call('POST', '/api/billing/checkout', { plan: 'pro', months: 12, provider: 'payos' }, auth);
  assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
  assert.equal(checkout.json.quote.total, 3830400);
  assert.equal(created[0].amount, 3830400);
  assert.match(checkout.json.checkoutUrl, /^https:\/\/pay\.payos\.vn/);

  const data = { orderCode: checkout.json.orderCode, amount: 3830400, description: created[0].description, accountNumber: '0001', reference: 'FT26287001',
    transactionDateTime: '2026-10-14 10:05:00', currency: 'VND', paymentLinkId: `pl${checkout.json.orderCode}`, code: '00', desc: 'Thành công' };
  const forged = await call('POST', '/webhooks/payos', { code: '00', desc: 'ok', success: true, data, signature: 'f'.repeat(64) });
  assert.equal(forged.status, 401);
  const hook = await call('POST', '/webhooks/payos', { code: '00', desc: 'ok', success: true, data, signature: dataSignature(data, KEY) });
  assert.equal(hook.status, 200);
  assert.equal(hook.json.status, 'paid');

  const me = await call('GET', '/api/me', undefined, auth);
  assert.equal(me.json.tenant.plan.id, 'pro');
  assert.equal(me.json.tenant.subscription.status, 'active');
  assert.equal(me.json.tenant.subscription.currentPeriodEnd, '2027-10-14T03:00:00.000Z');
  assert.equal(me.json.payments[0].status, 'paid');

  /* Retry of the same callback must not extend the period again. */
  await call('POST', '/webhooks/payos', { code: '00', desc: 'ok', success: true, data, signature: dataSignature(data, KEY) });
  assert.equal((await call('GET', '/api/me', undefined, auth)).json.tenant.subscription.currentPeriodEnd, '2027-10-14T03:00:00.000Z');

  /* payOS confirm-webhook test payload for an unknown order is acknowledged. */
  const probe = { ...data, orderCode: 123 };
  assert.equal((await call('POST', '/webhooks/payos', { data: probe, signature: dataSignature(probe, KEY) })).json.ignored, 'unknown_order');
});

test('validation messages are Vietnamese', async (t) => {
  const { call, server } = await boot();
  t.after(() => server.close());
  const bad = await call('POST', '/api/signup', { ...SIGNUP, phone: '0123' });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.message, 'Số điện thoại di động không hợp lệ.');
  assert.equal((await call('POST', '/api/signup', { ...SIGNUP, subdomain: 'admin' })).json.error, 'subdomain_reserved');
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/admin/tenants', undefined, { 'x-admin-key': 'nope-nope' })).status, 401);
});

test('failed install suspends the shop; expiry job suspends after grace', async (t) => {
  const { call, server, store, billing } = await boot({ installer: { async install() { throw Object.assign(new Error('x'), { code: 'installer_http_500' }); } } });
  t.after(() => server.close());
  const res = await call('POST', '/api/signup', SIGNUP);
  assert.equal(res.status, 502);
  const failed = await store.tenants.findOne({ subdomain: 'photue' });
  assert.equal(failed.status, 'install_failed');
  assert.equal(failed.suspended, true);

  await store.tenants.update(failed._id, { suspended: false, suspendedReason: null, status: 'active' });
  clock = new Date('2026-11-05T00:00:00Z'); // trial (14d) + grace (7d) passed
  assert.deepEqual(await billing.enforceExpiry(), ['photue']);
  const list = await call('GET', '/api/admin/tenants', undefined, { 'x-admin-key': 'admin-key' });
  assert.equal(list.json[0].suspendedReason, 'subscription_expired');
  clock = new Date('2026-10-14T03:00:00Z');
});
