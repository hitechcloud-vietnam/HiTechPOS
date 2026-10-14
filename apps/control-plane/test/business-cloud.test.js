'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createBusinessCloudRouter } = require('../src/business-cloud');
const { authorizationRow, eligibleOwner } = require('../src/business-handoff');
const { createMemoryStore } = require('../src/store/memory');
const { hashPassword } = require('../src/passwords');
const { signToken } = require('../src/tokens');

const CLOUD = 'https://app.hitechpos.vn';
const PASSWORD = 'matkhau-chu-quan-1';
const SESSION_SECRET = 'test-session-secret';
const b64 = (buf) => buf.toString('base64url');
const sha256hex = (v) => crypto.createHash('sha256').update(v).digest('hex');

function pkce() {
  const verifier = b64(crypto.randomBytes(32));
  return { verifier, challenge: b64(crypto.createHash('sha256').update(verifier).digest()) };
}

/* Stand-in for store.shopBridge (store/mongo.js): records hand-over rows
   instead of writing a shop database. */
function fakeShopLink() {
  const rows = [];
  const users = new Map();
  return {
    rows,
    users,
    async businessOwner(tenant, { email }) {
      const u = users.get(tenant.subdomain);
      return u && u.email === email && eligibleOwner(u, Date.now()) ? { userId: u._id } : null;
    },
    async insertBusinessAuthorization(tenant, { userId, ...fields }) {
      const u = users.get(tenant.subdomain);
      if (!u || u._id !== userId || !eligibleOwner(u, Date.now())) return false;
      rows.push({ tenant: tenant.subdomain, row: authorizationRow(u, fields) });
      return true;
    },
  };
}

async function boot({ rateLimits, corsOrigins, shopLink } = {}) {
  let clock = new Date('2026-10-14T03:00:00Z');
  const store = createMemoryStore();
  const link = shopLink === undefined ? fakeShopLink() : shopLink;
  const config = {
    publicUrl: CLOUD,
    sessionSecret: SESSION_SECRET,
    shopBaseDomains: ['hitechpos.vn'],
    rateLimits: rateLimits || {},
    businessCloud: corsOrigins ? { corsOrigins } : undefined,
  };
  const errors = [];
  const app = express();
  app.use('/api/business/v1', createBusinessCloudRouter({ store, config, now: () => clock, shopLink: link, logger: { error: (m) => errors.push(m) } }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/business/v1`;

  const account = await store.accounts.insert({ email: 'chu@photue.vn', name: 'Chủ quán', passwordHash: hashPassword(PASSWORD), createdAt: clock.toISOString() });
  async function addShop(subdomain, extra = {}) {
    const t = await store.tenants.insert({ subdomain, tenantDb: `hitech_t_${subdomain}`, provisioned: true, suspended: false, status: 'active', businessName: `Quán ${subdomain}`, ownerAccountId: String(account._id), ...extra });
    if (link) link.users.set(subdomain, { _id: crypto.randomBytes(12).toString('hex'), email: 'chu@photue.vn', usertype: 'super_admin', activate: true, license: `lic-${subdomain}`, authVersion: 2 });
    return t;
  }

  const raw = (method, p, { body, headers = {} } = {}) => fetch(base + p, {
    method, redirect: 'manual',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const call = async (method, p, opts) => {
    const res = await raw(method, p, opts);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text, headers: res.headers };
  };

  /* Phone side */
  async function start(extra = {}) {
    const p = pkce();
    const r = await call('POST', '/requests', { body: { codeChallenge: p.challenge, deviceName: 'HiTechPOS Business', ...extra } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return { ...p, request: r.json.request, response: r };
  }
  const poll = (request, verifier) => call('POST', '/token', { body: { request, codeVerifier: verifier } });

  /* Browser side */
  async function openPage(request) {
    const r = await call('GET', `/authorize?request=${request}`);
    const csrf = (r.text.match(/<meta name="hb-csrf" content="([^"]*)">/) || [])[1];
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    return { ...r, csrf, cookie };
  }
  function browser(request, page) {
    const post = (p, body, headers = {}) => call('POST', `/authorize/${p}`, {
      body: { request, csrf: page.csrf, ...body },
      headers: { origin: CLOUD, cookie: page.cookie, ...headers },
    });
    return {
      login: (email = 'chu@photue.vn', password = PASSWORD) => post('login', { email, password }),
      session: (token) => post('session', {}, { authorization: `Bearer ${token}` }),
      decide: (decision, shopId) => post('decision', { decision, shopId }),
      post,
    };
  }
  async function approve(request, shopId) {
    const page = await openPage(request);
    const b = browser(request, page);
    const login = await b.login();
    assert.equal(login.status, 200, JSON.stringify(login.json));
    const decided = await b.decide('allow', shopId || login.json.shops[0].id);
    assert.equal(decided.status, 200, JSON.stringify(decided.json));
    return { page, login, decided };
  }

  return {
    store, link, account, addShop, call, raw, start, poll, openPage, browser, approve, errors,
    tick: (ms) => { clock = new Date(clock.getTime() + ms); },
    now: () => clock,
    close: () => server.close(),
  };
}

test('discovery is exactly the strict cloud document', async (t) => {
  const c = await boot();
  t.after(c.close);
  for (const q of ['', '?items=1&insights=1&approvals=1']) {
    const r = await c.call('GET', `/discovery${q}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^application\/json/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(r.json, {
      product: 'posnic-business',
      apiVersion: 1,
      issuer: CLOUD,
      authorization: 'business-cloud-pkce-v1',
      audience: 'posnic-business',
      reporting: 'unavailable',
    });
    assert.deepEqual(Object.keys(r.json), ['product', 'apiVersion', 'issuer', 'authorization', 'audience', 'reporting']);
  }
  const missing = await c.call('GET', '/sessions');
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { error: { code: 'not_found' } });
});

test('requests: strict response, exact authorization URL, input validation', async (t) => {
  const c = await boot();
  t.after(c.close);
  const { response, request } = await c.start();
  assert.deepEqual(Object.keys(response.json).sort(), ['authorizationUrl', 'expiresIn', 'interval', 'request']);
  assert.match(request, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(response.json.authorizationUrl, `${CLOUD}/api/business/v1/authorize?request=${request}`);
  assert.equal(response.json.expiresIn, 600);
  assert.equal(response.json.interval, 5);

  const p = pkce();
  for (const body of [
    {},
    { codeChallenge: 'short', deviceName: 'x' },
    { codeChallenge: p.challenge },
    { codeChallenge: p.challenge, deviceName: 'x'.repeat(81) },
    { codeChallenge: p.challenge, deviceName: 'a\nb' },
    { codeChallenge: p.challenge, deviceName: 'ok', stepUp: 'yes' },
  ]) {
    const r = await c.call('POST', '/requests', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.json, { error: { code: 'invalid_request' } });
  }
  const broken = await c.call('POST', '/requests', { body: '{"codeChallenge":' });
  assert.equal(broken.status, 400);
  assert.deepEqual(broken.json, { error: { code: 'invalid_request' } });
});

test('full PKCE happy path hands the phone over to the shop origin exactly once', async (t) => {
  const c = await boot();
  t.after(c.close);
  const shop = await c.addShop('photue');
  const { request, verifier, challenge } = await c.start();

  const pending = await c.poll(request, verifier);
  assert.equal(pending.status, 202);
  assert.deepEqual(pending.json, { error: { code: 'authorization_pending' } });

  const page = await c.openPage(request);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  const csp = page.headers.get('content-security-policy');
  const nonce = csp.match(/script-src 'nonce-([A-Za-z0-9_-]{43})'/)[1];
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.ok(page.text.includes(`<script src="/api/business/v1/assets/business-signin.js" nonce="${nonce}"`));
  assert.ok(page.text.includes(`"matchingCode":"${request.slice(-6).toUpperCase()}"`));
  assert.ok(page.text.includes('"deviceName":"HiTechPOS Business"'));
  assert.match(page.cookie, /^hb_consent=[A-Za-z0-9_-]{43}$/);
  assert.match(page.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Secure/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  const js = await c.call('GET', '/assets/business-signin.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);

  const b = c.browser(request, page);
  const login = await b.login('  CHU@photue.vn ');
  assert.equal(login.status, 200, JSON.stringify(login.json));
  assert.deepEqual(login.json.shops, [{ id: String(shop._id), name: 'Quán photue', host: 'photue.hitechpos.vn', available: true, reason: null }]);
  assert.equal((await c.poll(request, verifier)).status, 202);

  c.tick(3000);
  const decided = await b.decide('allow', String(shop._id));
  assert.deepEqual(decided.json, { status: 'approved', shop: { name: 'Quán photue', host: 'photue.hitechpos.vn' }, appLink: 'vn.hitechpos.business://authorized' });

  c.tick(5000);
  const granted = await c.poll(request, verifier);
  assert.equal(granted.status, 200);
  assert.deepEqual(Object.keys(granted.json), ['handoff']);
  assert.deepEqual(Object.keys(granted.json.handoff).sort(), ['origin', 'request']);
  const { origin, request: handoff } = granted.json.handoff;
  assert.equal(origin, 'https://photue.hitechpos.vn');
  assert.equal(new URL(origin).origin, origin);
  assert.notEqual(origin, CLOUD);
  assert.match(handoff, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(handoff, request);

  /* The row the shop's exchange() redeems: contract section 3.5, key for key. */
  assert.equal(c.link.rows.length, 1);
  const { tenant, row } = c.link.rows[0];
  assert.equal(tenant, 'photue');
  assert.deepEqual(Object.keys(row).sort(), ['_id', 'authVersion', 'authenticatedAt', 'authorization', 'codeChallenge', 'createdAt', 'deviceName', 'expiresAt', 'issuedAt', 'license', 'stepUp', 'status', 'userId'].sort());
  const user = c.link.users.get('photue');
  assert.equal(row._id, sha256hex(handoff));
  assert.equal(row.codeChallenge, challenge);
  assert.equal(row.deviceName, 'HiTechPOS Business');
  assert.equal(row.stepUp, false);
  assert.equal(row.status, 'approved');
  assert.equal(row.authorization, 'cloud-browser');
  assert.equal(row.userId, user._id);
  assert.equal(row.license, 'lic-photue');
  assert.equal(row.authVersion, 2);
  assert.equal(row.authenticatedAt.toISOString(), '2026-10-14T03:00:00.000Z');
  assert.equal(row.issuedAt.getTime(), c.now().getTime());
  assert.ok(row.expiresAt.getTime() - c.now().getTime() <= 10 * 60_000);

  /* Single use: the same request (and verifier) never hands over twice. */
  const again = await c.poll(request, verifier);
  assert.equal(again.status, 410);
  assert.deepEqual(again.json, { error: { code: 'request_expired' } });
  assert.equal(c.link.rows.length, 1);
  const reopened = await c.openPage(request);
  assert.equal(reopened.status, 410);
  assert.equal(reopened.cookie, '');

  /* Owner mapping is pinned on the tenant for the next sign-in. */
  assert.equal((await c.store.tenants.findById(shop._id)).businessOwnerUserId, user._id);
  assert.deepEqual(c.errors, []);
});

test('wrong verifier is refused without burning the request', async (t) => {
  const c = await boot();
  t.after(c.close);
  await c.addShop('photue');
  const { request, verifier } = await c.start();
  const other = pkce();
  assert.equal((await c.poll(request, other.verifier)).status, 410);
  await c.approve(request);
  const wrong = await c.poll(request, other.verifier);
  assert.equal(wrong.status, 410);
  assert.deepEqual(wrong.json, { error: { code: 'request_expired' } });
  assert.equal(c.link.rows.length, 0);
  assert.equal((await c.poll(request, 'not-a-verifier')).status, 400);
  assert.equal((await c.poll(request, verifier)).status, 200);
});

test('code reuse: a handed-over, denied or unknown request never yields a hand-over', async (t) => {
  const c = await boot();
  t.after(c.close);
  await c.addShop('photue');
  const one = await c.start();
  await c.approve(one.request);
  assert.equal((await c.poll(one.request, one.verifier)).status, 200);
  for (let i = 0; i < 3; i++) assert.equal((await c.poll(one.request, one.verifier)).status, 410);

  /* The browser cannot approve it a second time either. */
  const page = await c.openPage(one.request);
  assert.equal(page.status, 410);

  const two = await c.start();
  const p2 = await c.openPage(two.request);
  const b2 = c.browser(two.request, p2);
  assert.equal((await b2.login()).status, 200);
  assert.deepEqual((await b2.decide('deny')).json, { status: 'denied' });
  const denied = await c.poll(two.request, two.verifier);
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.json, { error: { code: 'access_denied' } });
  const late = await b2.decide('allow', (await c.store.tenants.findOne({ subdomain: 'photue' }))._id);
  assert.equal(late.status, 409);
  assert.equal((await c.poll(two.request, two.verifier)).status, 403);

  const unknown = pkce();
  assert.equal((await c.poll(b64(crypto.randomBytes(32)), unknown.verifier)).status, 410);
  assert.equal(c.link.rows.length, 1);
});

test('expiry: requests die after ten minutes on the phone and in the browser', async (t) => {
  const c = await boot();
  t.after(c.close);
  await c.addShop('photue');
  const a = await c.start();
  const page = await c.openPage(a.request);
  c.tick(600_001);
  assert.equal((await c.poll(a.request, a.verifier)).status, 410);
  assert.equal((await c.openPage(a.request)).status, 410);
  const late = await c.browser(a.request, page).login();
  assert.equal(late.status, 410);
  assert.equal(late.json.error.code, 'request_expired');
  assert.match(late.json.error.message, /hết hạn/);

  /* Approved but never collected in time. */
  const b = await c.start();
  await c.approve(b.request);
  c.tick(600_001);
  assert.equal((await c.poll(b.request, b.verifier)).status, 410);
  assert.equal(c.link.rows.length, 0);
});

test('suspended shop: cannot be chosen, and suspension after approval stops the hand-over', async (t) => {
  const c = await boot();
  t.after(c.close);
  const shop = await c.addShop('photue');
  const off = await c.addShop('dongcua', { suspended: true, suspendedReason: 'expired' });

  const a = await c.start();
  const page = await c.openPage(a.request);
  const b = c.browser(a.request, page);
  const login = await b.login();
  const listed = Object.fromEntries(login.json.shops.map((s) => [s.host, s]));
  assert.equal(listed['dongcua.hitechpos.vn'].available, false);
  assert.equal(listed['dongcua.hitechpos.vn'].reason, 'shop_suspended');
  const refused = await b.decide('allow', String(off._id));
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error.code, 'shop_suspended');
  assert.equal((await c.poll(a.request, a.verifier)).status, 202);

  const ok = await b.decide('allow', String(shop._id));
  assert.equal(ok.status, 200);
  await c.store.tenants.update(shop._id, { suspended: true, suspendedReason: 'manual' });
  const r = await c.poll(a.request, a.verifier);
  assert.equal(r.status, 403);
  assert.deepEqual(r.json, { error: { code: 'access_denied' } });
  assert.equal((await c.poll(a.request, a.verifier)).status, 403);
  assert.equal(c.link.rows.length, 0);
});

test('password changed after the approval revokes the code', async (t) => {
  const c = await boot();
  t.after(c.close);
  await c.addShop('photue');
  const a = await c.start();
  await c.approve(a.request);
  c.tick(5000);
  await c.store.accounts.update(c.account._id, { passwordHash: hashPassword('mat-khau-moi-123'), passwordChangedAt: c.now().toISOString() });
  const r = await c.poll(a.request, a.verifier);
  assert.equal(r.status, 403);
  assert.equal(c.link.rows.length, 0);
  assert.equal((await c.poll(a.request, a.verifier)).status, 403);

  /* A sign-in made before the change cannot approve either. */
  const b = await c.start();
  c.tick(5000);
  const page = await c.openPage(b.request);
  const br = c.browser(b.request, page);
  assert.equal((await br.login('chu@photue.vn', 'mat-khau-moi-123')).status, 200);
  c.tick(5000);
  await c.store.accounts.update(c.account._id, { passwordChangedAt: c.now().toISOString() });
  const shop = await c.store.tenants.findOne({ subdomain: 'photue' });
  const stale = await br.decide('allow', String(shop._id));
  assert.equal(stale.status, 401);
  assert.equal(stale.json.error.code, 'sign_in_required');
});

test('account with two shops chooses which shop the phone is handed to', async (t) => {
  const c = await boot();
  t.after(c.close);
  const first = await c.addShop('photue');
  const second = await c.addShop('banhmi');
  const stranger = await c.store.tenants.insert({ subdomain: 'khac', provisioned: true, status: 'active', ownerAccountId: 'someone-else', businessName: 'Khác' });

  const a = await c.start();
  const page = await c.openPage(a.request);
  const b = c.browser(a.request, page);
  const login = await b.login();
  assert.deepEqual(login.json.shops.map((s) => s.id).sort(), [String(first._id), String(second._id)].sort());
  assert.ok(login.json.shops.every((s) => s.available));

  const foreign = await b.decide('allow', String(stranger._id));
  assert.equal(foreign.status, 404);
  assert.equal(foreign.json.error.code, 'shop_not_found');
  assert.equal((await b.decide('allow')).status, 404);

  assert.equal((await b.decide('allow', String(second._id))).status, 200);
  const r = await c.poll(a.request, a.verifier);
  assert.equal(r.json.handoff.origin, 'https://banhmi.hitechpos.vn');
  assert.equal(c.link.rows[0].tenant, 'banhmi');
  assert.equal(c.link.rows[0].row.license, 'lic-banhmi');
});

test('consent page APIs need the page cookie, its CSRF token and the cloud Origin', async (t) => {
  const c = await boot();
  t.after(c.close);
  const shop = await c.addShop('photue');
  const a = await c.start();
  const page = await c.openPage(a.request);
  const b = c.browser(a.request, page);
  const cases = [
    { origin: 'https://evil.example' },
    { cookie: '' },
    { cookie: `hb_consent=${b64(crypto.randomBytes(32))}` },
  ];
  for (const headers of cases) {
    const r = await b.post('login', { email: 'chu@photue.vn', password: PASSWORD }, headers);
    assert.equal(r.status, 403, JSON.stringify(headers));
    assert.equal(r.json.error.code, 'invalid_consent');
    assert.ok(r.json.error.message);
  }
  const form = await c.call('POST', '/authorize/login', { body: `request=${a.request}&csrf=${page.csrf}`, headers: { 'content-type': 'application/x-www-form-urlencoded', origin: CLOUD, cookie: page.cookie } });
  assert.equal(form.status, 403);

  assert.equal((await b.login('chu@photue.vn', 'sai-mat-khau')).status, 401);
  assert.equal((await b.login('nobody@photue.vn', PASSWORD)).status, 401);
  assert.equal((await b.decide('allow', String(shop._id))).status, 401);

  /* Opening the link again (e.g. by whoever else saw it) voids the earlier
     tab and its sign-in. */
  assert.equal((await b.login()).status, 200);
  const page2 = await c.openPage(a.request);
  const stale = await b.decide('allow', String(shop._id));
  assert.equal(stale.status, 403);
  assert.equal(stale.json.error.code, 'invalid_consent');
  const b2 = c.browser(a.request, page2);
  assert.equal((await b2.decide('allow', String(shop._id))).status, 401);
  assert.equal((await b2.login()).status, 200);
  assert.equal((await b2.decide('allow', String(shop._id))).status, 200);
  assert.equal((await c.poll(a.request, a.verifier)).status, 200);

  const bad = await c.call('GET', '/authorize?request=nope');
  assert.equal(bad.status, 400);
  assert.ok(bad.text.includes('"error":"invalid_request"'));
  assert.ok(bad.text.includes('<meta name="hb-csrf" content="">'));
});

test('existing control-plane session signs in, except for step-up which needs the password', async (t) => {
  const c = await boot();
  t.after(c.close);
  const shop = await c.addShop('photue');
  const token = signToken({ sub: String(c.account._id), tenantId: String(shop._id) }, SESSION_SECRET, { now: c.now().getTime() - 60_000 });

  const a = await c.start();
  const b = c.browser(a.request, await c.openPage(a.request));
  assert.equal((await b.session('not-a-token')).status, 401);
  const s = await b.session(token);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.account.email, 'chu@photue.vn');
  assert.equal((await b.decide('allow', String(shop._id))).status, 200);
  assert.equal((await c.poll(a.request, a.verifier)).status, 200);
  assert.equal(c.link.rows[0].row.authenticatedAt.getTime(), Math.floor((c.now().getTime() - 60_000) / 1000) * 1000);

  const up = await c.start({ stepUp: true });
  const page = await c.openPage(up.request);
  assert.ok(page.text.includes('"stepUp":true'));
  const bu = c.browser(up.request, page);
  const refused = await bu.session(token);
  assert.equal(refused.status, 401);
  assert.equal(refused.json.error.code, 'step_up_required');
  c.tick(2000);
  assert.equal((await bu.login()).status, 200);
  assert.equal((await bu.decide('allow', String(shop._id))).status, 200);
  assert.equal((await c.poll(up.request, up.verifier)).status, 200);
  const row = c.link.rows[1].row;
  assert.equal(row.stepUp, true);
  assert.equal(row.authenticatedAt.getTime(), c.now().getTime());
});

test('shop without a matching owner user, and a store without a shop link', async (t) => {
  const c = await boot();
  t.after(c.close);
  const shop = await c.addShop('photue');
  c.link.users.get('photue').email = 'khac@photue.vn';
  const a = await c.start();
  const b = c.browser(a.request, await c.openPage(a.request));
  await b.login();
  const r = await b.decide('allow', String(shop._id));
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'shop_owner_missing');

  /* Owner user disabled between approval and collection. */
  c.link.users.get('photue').email = 'chu@photue.vn';
  assert.equal((await b.decide('allow', String(shop._id))).status, 200);
  c.link.users.get('photue').activate = false;
  assert.equal((await c.poll(a.request, a.verifier)).status, 403);

  const bare = await boot({ shopLink: null });
  t.after(bare.close);
  const s2 = await bare.store.tenants.insert({ subdomain: 'x1', provisioned: true, status: 'active', ownerAccountId: String(bare.account._id) });
  const r2 = await bare.start();
  const b2 = bare.browser(r2.request, await bare.openPage(r2.request));
  await b2.login();
  const unavailable = await b2.decide('allow', String(s2._id));
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.json.error.code, 'shop_link_unavailable');
});

test('a failing shop write is retried on the next poll', async (t) => {
  const link = fakeShopLink();
  const insert = link.insertBusinessAuthorization;
  let failNext = true;
  link.insertBusinessAuthorization = async (...args) => {
    if (failNext) {
      failNext = false;
      throw new Error('connection reset');
    }
    return insert(...args);
  };
  const c = await boot({ shopLink: link });
  t.after(c.close);
  await c.addShop('photue');
  const a = await c.start();
  await c.approve(a.request);
  const first = await c.poll(a.request, a.verifier);
  assert.equal(first.status, 503);
  assert.deepEqual(first.json, { error: { code: 'server_unavailable' } });
  assert.equal((await c.poll(a.request, a.verifier)).status, 200);
});

test('rate limits answer JSON 429; CORS only for configured preview origins', async (t) => {
  const c = await boot({ rateLimits: { businessRequests: 2 }, corsOrigins: ['http://localhost:8081'] });
  t.after(c.close);
  const p = pkce();
  const body = { codeChallenge: p.challenge, deviceName: 'HiTechPOS Business' };
  assert.equal((await c.call('POST', '/requests', { body })).status, 200);
  assert.equal((await c.call('POST', '/requests', { body })).status, 200);
  const limited = await c.call('POST', '/requests', { body });
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.json, { error: { code: 'rate_limited' } });

  const pre = await c.raw('OPTIONS', '/token', { headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:8081');
  const disc = await c.call('GET', '/discovery', { headers: { origin: 'http://localhost:8081' } });
  assert.equal(disc.headers.get('access-control-allow-origin'), 'http://localhost:8081');
  const evil = await c.call('GET', '/discovery', { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const pageApi = await c.raw('OPTIONS', '/authorize/login', { headers: { origin: 'http://localhost:8081' } });
  assert.equal(pageApi.headers.get('access-control-allow-origin'), null);
});

test('memory store: conditional update and expiry sweep', async () => {
  const store = createMemoryStore();
  const t0 = new Date('2026-10-14T00:00:00Z');
  await store.businessRequests.insert({ _id: 'a', status: 'pending', createdAt: t0, expiresAt: new Date(t0.getTime() + 1000) });
  assert.equal(await store.businessRequests.update('a', { status: 'approved' }, { status: 'x' }), null);
  assert.equal((await store.businessRequests.update('a', { status: 'pending' }, { status: 'approved' })).status, 'approved');
  await assert.rejects(store.businessRequests.insert({ _id: 'a', createdAt: t0, expiresAt: t0 }), { code: 'duplicate' });
  await store.businessRequests.insert({ _id: 'b', createdAt: new Date(t0.getTime() + 5000), expiresAt: new Date(t0.getTime() + 9000) });
  assert.equal(await store.businessRequests.findById('a'), null);
  assert.ok((await store.businessRequests.findById('b')).expiresAt instanceof Date);
});

test('the sign-in page has no inline script and keeps its template markers', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/business-signin.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  for (const [, attrs, body] of scripts) {
    if (/type="application\/json"/.test(attrs)) continue;
    assert.match(attrs, /\bsrc="\/api\/business\/v1\/assets\//);
    assert.equal(body.trim(), '');
  }
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.match(html, /<html lang="vi">/);
});
