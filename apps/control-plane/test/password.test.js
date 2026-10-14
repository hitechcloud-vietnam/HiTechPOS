'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createProviderRegistry } = require('@hitechpos/payment-core');

test('forgot / reset / change password; old sessions are revoked', async (t) => {
  let clock = new Date('2026-10-14T03:00:00Z');
  const sent = [];
  const mailTransport = { sendMail: async (m) => { sent.push(m); } };
  const config = loadConfig({ STORE: 'memory', PUBLIC_URL: 'https://app.hitechpos.vn' });
  const { app } = createApp({ store: createMemoryStore(), config, now: () => clock, mailTransport, providers: createProviderRegistry(), installer: { async install() {} }, logger: { warn() {}, error() {}, info() {} } });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const s = (await call('POST', '/api/signup', { subdomain: 'photue', businessName: 'Phở Tuệ', industry: 'khac', ownerName: 'T', email: 'chu@photue.vn', phone: '0912345678', password: 'matkhau123' })).json;
  const oldSession = { authorization: `Bearer ${s.token}` };

  /* Unknown email: same answer, nothing sent. */
  const unknown = await call('POST', '/api/auth/forgot', { email: 'ai@khac.vn' });
  assert.equal(unknown.status, 200);
  const before = sent.length;
  assert.equal((await call('POST', '/api/auth/forgot', { email: 'CHU@photue.vn' })).status, 200);
  assert.equal(sent.length, before + 1);
  const token = /token=([^"&\s]+)/.exec(sent[sent.length - 1].html)[1];

  clock = new Date('2026-10-14T03:10:00Z');
  assert.equal((await call('POST', '/api/auth/reset', { token: 'sai', password: 'matkhaumoi1' })).json.error, 'reset_token_invalid');
  assert.equal((await call('POST', '/api/auth/reset', { token: decodeURIComponent(token), password: 'matkhaumoi1' })).status, 200);
  assert.equal((await call('POST', '/api/auth/reset', { token: decodeURIComponent(token), password: 'matkhaumoi2' })).json.error, 'reset_token_invalid', 'single use');
  assert.equal((await call('GET', '/api/me', undefined, oldSession)).status, 401, 'sessions before the reset are revoked');
  assert.equal((await call('POST', '/api/auth/login', { email: 'chu@photue.vn', password: 'matkhau123' })).status, 401);
  const login = (await call('POST', '/api/auth/login', { email: 'chu@photue.vn', password: 'matkhaumoi1' })).json;
  const session = { authorization: `Bearer ${login.token}` };
  assert.equal((await call('GET', '/api/me', undefined, session)).status, 200);

  clock = new Date('2026-10-14T03:20:00Z');
  /* A reset link still outstanding when the password is changed dies with it. */
  await call('POST', '/api/auth/forgot', { email: 'chu@photue.vn' });
  const pending = decodeURIComponent(/token=([^"&\s]+)/.exec(sent[sent.length - 1].html)[1]);
  assert.equal((await call('POST', '/api/me/password', { currentPassword: 'sai', newPassword: 'abcdefgh1' }, session)).status, 401);
  const changed = (await call('POST', '/api/me/password', { currentPassword: 'matkhaumoi1', newPassword: 'abcdefgh1' }, session)).json;
  assert.equal((await call('GET', '/api/me', undefined, session)).status, 401);
  assert.equal((await call('GET', '/api/me', undefined, { authorization: `Bearer ${changed.token}` })).status, 200);
  assert.equal((await call('POST', '/api/auth/reset', { token: pending, password: 'chiemquyen1' })).json.error, 'reset_token_invalid');

  /* Expired reset link. */
  await call('POST', '/api/auth/forgot', { email: 'chu@photue.vn' });
  const t2 = /token=([^"&\s]+)/.exec(sent[sent.length - 1].html)[1];
  clock = new Date('2026-10-14T05:00:00Z');
  assert.equal((await call('POST', '/api/auth/reset', { token: decodeURIComponent(t2), password: 'xyzxyzxyz' })).json.error, 'reset_token_invalid');
});
