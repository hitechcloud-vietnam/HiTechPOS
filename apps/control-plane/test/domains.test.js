'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createProviderRegistry } = require('@hitechpos/payment-core');
const { PLANS } = require('../src/plans');

test('custom domain: plan gate, TXT verification, shard hosts, TLS ask', async (t) => {
  const txt = new Map();
  const store = createMemoryStore();
  const { app } = createApp({ store, config: loadConfig({ STORE: 'memory' }), providers: createProviderRegistry(), installer: { async install() {} }, logger: { warn() {}, error() {}, info() {} },
    resolveTxt: async (name) => { if (!txt.has(name)) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); return [[txt.get(name)]]; } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const s = (await call('POST', '/api/signup', { subdomain: 'abc', businessName: 'ABC', industry: 'khac', ownerName: 'T', email: 't@abc.vn', phone: '0912345678', password: 'matkhau123' })).json;
  const A = { authorization: `Bearer ${s.token}` };

  assert.equal((await call('POST', '/api/shop/domains', { domain: 'pos.abc.vn' }, A)).json.error, 'plan_feature_missing');
  const ent = PLANS.find((p) => p.id === 'enterprise');
  await store.tenants.update(s.tenant.id, { plan: { id: ent.id, limits: ent.limits, features: ent.features } });

  assert.equal((await call('POST', '/api/shop/domains', { domain: 'x.hitechpos.vn' }, A)).json.error, 'domain_reserved');
  assert.equal((await call('POST', '/api/shop/domains', { domain: 'not a domain' }, A)).json.error, 'domain_invalid');
  const added = await call('POST', '/api/shop/domains', { domain: 'POS.abc.vn.' }, A);
  assert.equal(added.status, 201);
  const [entry] = added.json;
  assert.equal(entry.domain, 'pos.abc.vn');
  assert.deepEqual(entry.dns.map((d) => d.type), ['TXT', 'CNAME']);
  assert.equal(entry.dns[1].value, 'abc.hitechpos.vn');

  assert.equal((await fetch(`${base}/internal/tls-ask?domain=pos.abc.vn`)).status, 404);
  assert.equal((await call('POST', '/api/shop/domains/pos.abc.vn/verify', {}, A)).json.error, 'domain_unverified');
  txt.set('_hitechpos.pos.abc.vn', entry.dns[0].value);
  assert.equal((await call('POST', '/api/shop/domains/pos.abc.vn/verify', {}, A)).json[0].verified, true);
  assert.ok((await store.tenants.findById(s.tenant.id)).hosts.includes('pos.abc.vn'));
  assert.ok((await call('GET', '/api/me', undefined, A)).json.tenant.urls.some((u) => new URL(u).hostname === 'pos.abc.vn'));

  assert.equal((await fetch(`${base}/internal/tls-ask?domain=pos.abc.vn`)).status, 200);
  assert.equal((await fetch(`${base}/internal/tls-ask?domain=abc.hitechpos.vn`)).status, 200);
  assert.equal((await fetch(`${base}/internal/tls-ask?domain=nobody.hitechpos.vn`)).status, 404);
  assert.equal((await fetch(`${base}/internal/tls-ask?domain=pos.abc.vn`, { headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 403);

  await call('DELETE', '/api/shop/domains/pos.abc.vn', undefined, A);
  assert.equal((await fetch(`${base}/internal/tls-ask?domain=pos.abc.vn`)).status, 404);
});
