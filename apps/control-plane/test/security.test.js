'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createProviderRegistry } = require('@hitechpos/payment-core');

test('login is rate limited per client and pages carry security headers', async (t) => {
  const config = { ...loadConfig({ STORE: 'memory' }), rateLimits: { login: 3 } };
  const { app } = createApp({ store: createMemoryStore(), config, providers: createProviderRegistry(), installer: { async install() {} }, logger: { warn() {}, error() {} } });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = () => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"x@y.vn","password":"nope"}' });
  for (let i = 0; i < 3; i++) assert.equal((await login()).status, 401);
  const blocked = await login();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.match((await blocked.json()).message, /quá nhanh/);

  const page = await fetch(`${base}/healthz`);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('one busy client on loopback does not use up the per-IP limit of shop tills, webhooks or the TLS ask', async (t) => {
  const config = { ...loadConfig({ STORE: 'memory' }), rateLimits: { global: 3, pos: 2 } };
  const { app } = createApp({ store: createMemoryStore(), config, providers: createProviderRegistry(), installer: { async install() {} }, logger: { warn() {}, error() {}, info() {} } });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const pos = (key) => fetch(`${base}/pos/v1/payments/1`, { headers: { authorization: `Bearer htp_live_${key}` } });
  /* Shop A hammers the POS API: only its own key's bucket runs out. */
  for (let i = 0; i < 2; i++) assert.equal((await pos('aaaa')).status, 401);
  assert.equal((await pos('aaaa')).status, 429);
  assert.equal((await pos('bbbb')).status, 401, 'shop B still gets through');
  /* The per-IP bucket (3) is not spent by those calls. */
  for (let i = 0; i < 3; i++) assert.notEqual((await fetch(`${base}/healthz`)).status, 429);
  assert.equal((await fetch(`${base}/healthz`)).status, 429);
  assert.notEqual((await fetch(`${base}/internal/tls-ask?domain=x.hitechpos.vn`)).status, 429);
  assert.notEqual((await fetch(`${base}/webhooks/payos`, { method: 'POST', body: '{}' })).status, 429);
});

test('a rejected signup leaves no account behind, and reserved names are refused', async (t) => {
  const store = createMemoryStore();
  const { app } = createApp({ store, config: loadConfig({ STORE: 'memory' }), providers: createProviderRegistry(), installer: { async install() {} }, logger: { warn() {}, error() {}, info() {} } });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const signup = (patch) => fetch(`${base}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subdomain: 'quanmoi', businessName: 'Quán Mới', industry: 'cafe-tra-sua', ownerName: 'Chủ', email: 'chu@quanmoi.vn', phone: '0912345678', password: 'matkhau123', ...patch }) });
  assert.equal((await signup({ businessName: 'Q' })).status, 422);
  const bad = await signup({ industry: 'khong-co' });
  assert.equal(bad.status, 422);
  assert.equal((await bad.json()).error, 'industry_invalid');
  assert.equal(await store.accounts.findByEmail('chu@quanmoi.vn'), null);
  for (const sub of ['thanhtoan', 'vietcombank', 'payos', 'autodiscover']) {
    const r = await signup({ subdomain: sub });
    assert.equal(r.status, 422, sub);
    assert.equal((await r.json()).error, 'subdomain_reserved', sub);
  }
  assert.equal((await signup({})).status, 201, 'the corrected signup goes through');
});
