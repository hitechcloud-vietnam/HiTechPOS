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
