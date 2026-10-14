'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createNotifier } = require('../src/notify');
const { createTenantService } = require('../src/tenants');
const { MESSAGES } = require('../src/app');
const { createAdminConsoleRouter, computeRevenue, searchTenants, actorOf } = require('../src/admin-console');
const { getPlan } = require('../src/plans');

const ADMIN_KEY = 'admin-secret-key';
const NOW = new Date('2026-10-14T05:00:00.000Z');
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

/* Mirrors app.js: the admin rate limit and X-Admin-Key check sit in front of
   the router, and the error handler shows MESSAGES[code] or err.message. */
async function setup(t, { setLimits } = {}) {
  const store = createMemoryStore();
  const limitsCalls = [];
  store.shopBridge = { setLimits: setLimits || (async (tenant, limits) => { limitsCalls.push({ subdomain: tenant.subdomain, limits }); }) };
  const config = loadConfig({ STORE: 'memory', ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'https://app.hitechpos.vn' });
  const mail = [];
  const logs = [];
  const logger = { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
  const now = () => NOW;
  const tenants = createTenantService({ store, config, installer: null, now, logger });
  const notifier = createNotifier({ store, config, now, logger, transport: { sendMail: async (m) => { mail.push(m); } }, hostsOf: (x) => tenants.hostsOf(x) });

  const app = express();
  app.use(express.json());
  const adminKey = (req, _res, next) => {
    const key = req.headers['x-admin-key'];
    if (!config.adminKey || typeof key !== 'string' || key.length !== config.adminKey.length ||
        !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.adminKey))) return next(Object.assign(new Error('unauthorized'), { code: 'unauthorized', status: 401 }));
    next();
  };
  app.use('/api/admin', adminKey, createAdminConsoleRouter({ store, config, billing: null, notifier, tenants, shopBridge: store.shopBridge, now, logger }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    const code = status >= 500 && !err.code ? 'internal_error' : err.code || 'error';
    const own = err.message && err.message !== code ? err.message : null;
    res.status(status).json({ error: code, message: MESSAGES[code] || own || code });
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  /* Fixture shops. */
  const plan = (id) => { const p = getPlan(id); return { id: p.id, limits: p.limits, features: p.features }; };
  const owner = async (email, name) => (await store.accounts.insert({ email, name, phone: '0912345678', passwordHash: 'x', createdAt: iso(NOW - 90 * DAY) }))._id;
  const shop = async (doc) => store.tenants.insert({
    tenantDb: `hitech_t_${doc.subdomain}`, hosts: [], provisioned: true, suspended: false, status: 'active', industry: 'khac',
    secrets: { JWT_SECRET: 'v1:aa:bb:cc' }, ...doc,
  });
  const photue = await shop({
    subdomain: 'photue', businessName: 'Phở Tuệ', ownerAccountId: await owner('tue@photue.vn', 'Tuệ'), plan: plan('trial'),
    subscription: { status: 'trialing', currentPeriodEnd: iso(NOW.getTime() + 5 * DAY) }, createdAt: '2026-10-01T03:00:00.000Z',
    einvoiceSettings: { provider: 'viettel', environment: 'sandbox', autoIssue: true, connection: { username: 'u', password: 'v1:sealed:pw:x' } },
    customDomains: [{ domain: 'pos.photue.vn', token: 'tok', addedAt: '2026-10-02T00:00:00.000Z', verifiedAt: '2026-10-02T01:00:00.000Z' }],
    notices: { welcome: '2026-10-01T03:00:01.000Z' },
  });
  const cafe = await shop({
    subdomain: 'cafe-sua', businessName: 'Cà phê Sữa Đá', ownerAccountId: await owner('chu@cafe.vn', 'Lan'), plan: plan('basic'),
    subscription: { status: 'active', currentPeriodEnd: iso(NOW.getTime() + 20 * DAY), lastPaymentOrderCode: 1002 }, createdAt: '2026-08-10T03:00:00.000Z',
  });
  const old = await shop({
    subdomain: 'tiemcu', businessName: 'Tiệm Cũ', ownerAccountId: await owner('cu@tiem.vn', 'Cũ'), plan: plan('pro'),
    suspended: true, suspendedReason: 'subscription_expired',
    subscription: { status: 'expired', currentPeriodEnd: '2026-09-01T00:00:00.000Z', lastPaymentOrderCode: 1001 }, createdAt: '2026-06-05T03:00:00.000Z',
  });
  const broken = await shop({
    subdomain: 'loi-cai', businessName: 'Lỗi Cài', ownerAccountId: await owner('loi@x.vn', 'L'), plan: plan('trial'), status: 'install_failed',
    suspended: true, suspendedReason: 'install_failed', subscription: { status: 'trialing', currentPeriodEnd: iso(NOW.getTime() + 10 * DAY) }, createdAt: '2026-10-10T03:00:00.000Z',
  });
  const quote = (planId, months, net) => ({ planId, months, net, total: net });
  const pay = (orderCode, reference, amount, paidAt, provider, q, status = 'paid') => store.payments.insert({
    orderCode, provider, amount, currency: 'VND', purpose: 'subscription', reference: String(reference), status, events: [],
    metadata: { tenantId: String(reference), quote: q }, createdAt: paidAt, updatedAt: paidAt, ...(status === 'paid' ? { paidAt } : {}),
  });
  await pay(1001, old._id, 399000, '2026-08-01T02:00:00.000Z', 'payos', quote('pro', 1, 399000));
  await pay(1002, cafe._id, 537300, '2026-09-20T18:30:00.000Z', 'pay2s', quote('basic', 3, 537300)); // 21 Sep in VN time
  await pay(1003, cafe._id, 199000, '2026-10-02T02:00:00.000Z', 'payos', quote('basic', 1, 199000), 'review');
  await store.payments.insert({ orderCode: 1004, provider: 'vietqr', amount: 85000, currency: 'VND', purpose: 'sale', reference: String(photue._id), status: 'paid', paidAt: '2026-10-03T02:00:00.000Z', events: [], metadata: { saleRef: 'HD-1' }, createdAt: '2026-10-03T02:00:00.000Z' });

  return { store, call, mail, logs, limitsCalls, ids: { photue: photue._id, cafe: cafe._id, old: old._id, broken: broken._id } };
}

test('admin console: requires the admin key like the other admin routes', async (t) => {
  const { call } = await setup(t);
  const res = await call('GET', '/api/admin/tenants/search', undefined, { 'x-admin-key': 'wrong-secret-key' });
  assert.equal(res.status, 401);
});

test('admin console: search filters, pagination, no secrets', async (t) => {
  const { call } = await setup(t);
  const all = (await call('GET', '/api/admin/tenants/search')).json;
  assert.equal(all.total, 4);
  assert.deepEqual(all.items.map((i) => i.subdomain), ['loi-cai', 'photue', 'cafe-sua', 'tiemcu'], 'newest first');
  assert.deepEqual(all.counts, { all: 4, trialing: 1, active: 1, expired: 1, suspended: 2, install_failed: 1 });
  assert.ok(!JSON.stringify(all).includes('v1:'), 'sealed secrets never leave the server');
  assert.ok(all.plans.some((p) => p.id === 'pro'));

  const q = async (qs) => (await call('GET', `/api/admin/tenants/search?${qs}`)).json.items.map((i) => i.subdomain);
  assert.deepEqual(await q('q=pho tue'), ['photue'], 'business name without diacritics');
  assert.deepEqual(await q('q=CAFE'), ['cafe-sua'], 'subdomain, case-insensitive');
  assert.deepEqual(await q('q=cu%40tiem.vn'), ['tiemcu'], 'owner email');
  assert.deepEqual(await q('status=trialing'), ['photue']);
  assert.deepEqual(await q('status=active'), ['cafe-sua']);
  assert.deepEqual(await q('status=expired'), ['tiemcu']);
  assert.deepEqual(await q('status=suspended'), ['loi-cai', 'tiemcu']);
  assert.deepEqual(await q('plan=basic'), ['cafe-sua']);
  assert.deepEqual(await q('from=2026-08-01&to=2026-10-01'), ['photue', 'cafe-sua'], 'created range is inclusive, VN days');
  assert.deepEqual(await q('to=2026-09-30'), ['cafe-sua', 'tiemcu']);
  assert.deepEqual(await q('sort=name'), ['cafe-sua', 'loi-cai', 'photue', 'tiemcu']);

  const page2 = (await call('GET', '/api/admin/tenants/search?limit=3&page=2')).json;
  assert.deepEqual([page2.page, page2.pages, page2.total, page2.items.length], [2, 2, 4, 1]);
  assert.equal(page2.items[0].subdomain, 'tiemcu');
  const row = page2.items[0];
  assert.deepEqual([row.state, row.plan, row.ownerEmail, row.url], ['suspended', 'pro', 'cu@tiem.vn', 'https://tiemcu.hitechpos.vn']);
});

test('admin console: detail has payments, domains, e-invoice presence, notices, never secrets', async (t) => {
  const { call, ids } = await setup(t);
  assert.equal((await call('GET', '/api/admin/tenants/nope')).status, 404);
  const d = (await call('GET', `/api/admin/tenants/${ids.photue}`)).json;
  const text = JSON.stringify(d);
  assert.ok(!text.includes('v1:'), 'no sealed secrets');
  assert.ok(!text.includes('"tok"'), 'no domain verification token');
  assert.deepEqual(d.einvoice, { configured: true, provider: 'viettel', environment: 'sandbox', autoIssue: true });
  assert.deepEqual(d.customDomains, [{ domain: 'pos.photue.vn', verified: true, verifiedAt: '2026-10-02T01:00:00.000Z', addedAt: '2026-10-02T00:00:00.000Z' }]);
  assert.deepEqual(d.notices, [{ key: 'welcome', at: '2026-10-01T03:00:01.000Z' }]);
  assert.equal(d.owner.email, 'tue@photue.vn');
  assert.ok(d.tenant.urls.some((u) => new URL(u).host === 'photue.hitechpos.vn'));
  assert.equal(d.payments.length, 0, 'sale payments are not subscription payments');

  const c = (await call('GET', `/api/admin/tenants/${ids.cafe}`)).json;
  assert.deepEqual(c.payments.map((p) => [p.orderCode, p.status, p.amount, p.planId]), [[1003, 'review', 199000, 'basic'], [1002, 'paid', 537300, 'basic']]);
  assert.deepEqual(c.einvoice, { configured: false });
});

test('admin console: suspend and resume toggle the flag the shard reads, with audit', async (t) => {
  const { call, store, ids } = await setup(t);
  const actor = { 'x-admin-actor': encodeURIComponent('Nguyễn Văn Hỗ Trợ') };
  const missing = await call('POST', `/api/admin/tenants/${ids.photue}/actions/suspend`, {});
  assert.equal(missing.status, 422);
  assert.equal(missing.json.error, 'reason_required');
  assert.match(missing.json.message, /lý do/);
  assert.equal((await store.tenants.findById(ids.photue)).suspended, false, 'nothing changed');

  const s = await call('POST', `/api/admin/tenants/${ids.photue}/actions/suspend`, { reason: 'Nợ phí, khách yêu cầu khoá' }, actor);
  assert.equal(s.status, 200);
  let t1 = await store.tenants.findById(ids.photue);
  assert.deepEqual([t1.suspended, t1.suspendedReason], [true, 'Nợ phí, khách yêu cầu khoá']);
  assert.equal(s.json.audit.actor, 'Nguyễn Văn Hỗ Trợ');
  assert.equal(s.json.audit.action, 'suspend');
  assert.equal(s.json.audit.at, NOW.toISOString());
  assert.deepEqual([s.json.audit.before.suspended, s.json.audit.after.suspended], [false, true]);
  assert.equal((await call('POST', `/api/admin/tenants/${ids.photue}/actions/suspend`, { reason: 'lần nữa' })).status, 409);

  /* A typed reason never takes a system meaning. */
  const sys = await call('POST', `/api/admin/tenants/${ids.cafe}/actions/suspend`, { reason: 'subscription_expired' });
  assert.equal(sys.json.tenant.suspendedReason, 'manual: subscription_expired');

  const r = await call('POST', `/api/admin/tenants/${ids.photue}/actions/resume`, { reason: 'Đã thanh toán đủ' });
  assert.equal(r.status, 200);
  t1 = await store.tenants.findById(ids.photue);
  assert.deepEqual([t1.suspended, t1.suspendedReason], [false, null]);
  assert.equal(r.json.audit.actor, 'admin', 'no actor header');
  assert.equal(r.json.willResuspend, false);
  assert.equal((await call('POST', `/api/admin/tenants/${ids.photue}/actions/resume`, { reason: 'lần nữa' })).status, 409);

  /* Resuming a shop whose period lapsed warns that the expiry job re-suspends it. */
  const exp = await call('POST', `/api/admin/tenants/${ids.old}/actions/resume`, { reason: 'Cho xem dữ liệu' });
  assert.equal(exp.json.willResuspend, true);

  /* A failed install needs an explicit confirmation. */
  const b = await call('POST', `/api/admin/tenants/${ids.broken}/actions/resume`, { reason: 'Đã cài lại' });
  assert.equal(b.status, 409);
  assert.equal((await call('POST', `/api/admin/tenants/${ids.broken}/actions/resume`, { reason: 'Đã cài lại', force: true })).status, 200);

  const log = (await call('GET', `/api/admin/audit?tenantId=${ids.photue}`)).json;
  assert.deepEqual(log.items.map((e) => e.action), ['resume', 'suspend'], 'newest first, rejected attempts not logged');
  assert.equal(log.items[1].reason, 'Nợ phí, khách yêu cầu khoá');
});

test('admin console: extend period by N days', async (t) => {
  const { call, store, ids } = await setup(t);
  assert.equal((await call('POST', `/api/admin/tenants/${ids.photue}/actions/extend`, { days: 7 })).status, 422, 'reason required');
  assert.equal((await call('POST', `/api/admin/tenants/${ids.photue}/actions/extend`, { days: 0, reason: 'bù lỗi' })).json.error, 'days_invalid');
  assert.equal((await call('POST', `/api/admin/tenants/${ids.photue}/actions/extend`, { days: 1.5, reason: 'bù lỗi' })).json.error, 'days_invalid');

  /* Trial still running: from its current end. */
  const r = await call('POST', `/api/admin/tenants/${ids.photue}/actions/extend`, { days: 7, reason: 'Bù 7 ngày do sự cố' });
  assert.equal(r.status, 200);
  const p = await store.tenants.findById(ids.photue);
  assert.deepEqual(p.subscription, { status: 'trialing', currentPeriodEnd: iso(NOW.getTime() + 12 * DAY) });
  assert.deepEqual(r.json.audit.details, { days: 7 });
  assert.equal(r.json.audit.before.subscription.currentPeriodEnd, iso(NOW.getTime() + 5 * DAY));
  assert.equal(r.json.audit.after.subscription.currentPeriodEnd, iso(NOW.getTime() + 12 * DAY));

  /* Expired and suspended by the expiry job: from now, active again, unsuspended. */
  await call('POST', `/api/admin/tenants/${ids.old}/actions/extend`, { days: 30, reason: 'Khách chuyển khoản ngoài hệ thống' });
  const o = await store.tenants.findById(ids.old);
  assert.deepEqual([o.subscription.status, o.subscription.currentPeriodEnd, o.subscription.lastPaymentOrderCode, o.suspended, o.suspendedReason],
    ['active', iso(NOW.getTime() + 30 * DAY), 1001, false, null]);

  /* A manual suspension survives an extension. */
  await call('POST', `/api/admin/tenants/${ids.cafe}/actions/suspend`, { reason: 'Vi phạm điều khoản' });
  await call('POST', `/api/admin/tenants/${ids.cafe}/actions/extend`, { days: 10, reason: 'Bù ngày' });
  const c = await store.tenants.findById(ids.cafe);
  assert.deepEqual([c.suspended, c.suspendedReason, c.subscription.currentPeriodEnd], [true, 'Vi phạm điều khoản', iso(NOW.getTime() + 30 * DAY)]);
});

test('admin console: change plan writes the plan record and calls setLimits', async (t) => {
  const { call, store, ids, limitsCalls } = await setup(t);
  assert.equal((await call('POST', `/api/admin/tenants/${ids.cafe}/actions/change-plan`, { plan: 'pro' })).status, 422, 'reason required');
  const unknown = await call('POST', `/api/admin/tenants/${ids.cafe}/actions/change-plan`, { plan: 'gold', reason: 'nâng cấp' });
  assert.deepEqual([unknown.status, unknown.json.message], [404, 'Gói cước không tồn tại.']);
  assert.equal((await call('POST', `/api/admin/tenants/${ids.cafe}/actions/change-plan`, { plan: 'basic', reason: 'giữ nguyên' })).status, 409);
  assert.equal(limitsCalls.length, 0);

  const r = await call('POST', `/api/admin/tenants/${ids.cafe}/actions/change-plan`, { plan: 'pro', reason: 'Nâng cấp theo hợp đồng' });
  assert.equal(r.status, 200);
  assert.equal(r.json.limitsSynced, true);
  const pro = getPlan('pro');
  const c = await store.tenants.findById(ids.cafe);
  assert.deepEqual(c.plan, { id: 'pro', limits: { ...pro.limits }, features: [...pro.features] });
  assert.equal(c.subscription.status, 'active', 'subscription untouched');
  assert.deepEqual(limitsCalls, [{ subdomain: 'cafe-sua', limits: { ...pro.limits } }]);
  assert.deepEqual(r.json.audit.details, { from: 'basic', to: 'pro', limitsSynced: true });
  assert.deepEqual([r.json.audit.before.plan, r.json.audit.after.plan], ['basic', 'pro']);
});

test('admin console: plan change survives a shop database failure, logs no request data', async (t) => {
  const { call, store, ids, logs } = await setup(t, { setLimits: async () => { throw new Error('shop db down'); } });
  const r = await call('POST', `/api/admin/tenants/${ids.cafe}/actions/change-plan`, { plan: 'enterprise', reason: 'Nâng cấp\nINJECTED' });
  assert.equal(r.status, 200);
  assert.equal(r.json.limitsSynced, false);
  assert.equal((await store.tenants.findById(ids.cafe)).plan.id, 'enterprise');
  assert.deepEqual(logs, ['[admin-console] plan limits not written to the shop database']);
});

test('admin console: resend welcome and reset password email the owner', async (t) => {
  const { call, store, ids, mail } = await setup(t);
  const w = await call('POST', `/api/admin/tenants/${ids.photue}/actions/resend-welcome`, {});
  assert.equal(w.status, 200);
  assert.equal(w.json.result, 'sent');
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'tue@photue.vn');
  assert.match(mail[0].subject, /Chào mừng Phở Tuệ/);
  const p = await store.tenants.findById(ids.photue);
  assert.ok(p.notices[`welcome:resend:${NOW.toISOString()}`], 'notice recorded');
  assert.equal(w.json.audit.action, 'resend-welcome');

  const r = await call('POST', `/api/admin/tenants/${ids.photue}/actions/reset-password`, { reason: 'Chủ quán quên mật khẩu' });
  assert.equal(r.status, 200);
  assert.equal(mail.length, 2);
  assert.equal(mail[1].to, 'tue@photue.vn');
  const token = decodeURIComponent(mail[1].text.match(/reset\?token=([^\s]+)/)[1]);
  assert.ok(!JSON.stringify(r.json).includes(token), 'token is only in the email');
  const account = await store.accounts.findByEmail('tue@photue.vn');
  assert.equal(account.resetTokenHash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.equal(account.resetExpiresAt, iso(NOW.getTime() + 3600000));
  assert.deepEqual([r.json.audit.action, r.json.audit.reason, r.json.audit.details], ['reset-password', 'Chủ quán quên mật khẩu', { result: 'sent' }]);

  /* A shop without an owner account. */
  const orphan = await store.tenants.insert({ subdomain: 'mocoi', businessName: 'Mồ Côi', plan: { id: 'trial' }, subscription: { status: 'trialing', currentPeriodEnd: iso(NOW.getTime()) }, createdAt: NOW.toISOString() });
  assert.equal((await call('POST', `/api/admin/tenants/${orphan._id}/actions/reset-password`, {})).status, 409);
  assert.equal((await call('POST', `/api/admin/tenants/${orphan._id}/actions/bogus`, {})).status, 404);
});

test('admin console: internal notes and the audit log', async (t) => {
  const { call, ids } = await setup(t);
  assert.equal((await call('POST', `/api/admin/tenants/${ids.cafe}/notes`, { text: '  ' })).status, 422);
  const n = await call('POST', `/api/admin/tenants/${ids.cafe}/notes`, { text: 'Gọi lại chủ quán thứ Hai' }, { 'x-admin-actor': 'lan@hitechcloud.vn' });
  assert.equal(n.status, 201);
  assert.deepEqual([n.json.action, n.json.note, n.json.actor, n.json.subdomain], ['note', 'Gọi lại chủ quán thứ Hai', 'lan@hitechcloud.vn', 'cafe-sua']);
  await call('POST', `/api/admin/tenants/${ids.photue}/actions/extend`, { days: 3, reason: 'Bù ngày' });
  await call('POST', `/api/admin/tenants/${ids.photue}/notes`, { text: 'Đã gia hạn' });

  const detail = (await call('GET', `/api/admin/tenants/${ids.cafe}`)).json;
  assert.deepEqual(detail.notes.map((e) => e.note), ['Gọi lại chủ quán thứ Hai']);

  const all = (await call('GET', '/api/admin/audit')).json;
  assert.deepEqual([all.total, all.items.map((e) => e.action)], [3, ['note', 'extend', 'note']]);
  const notes = (await call('GET', '/api/admin/audit?action=note&limit=1&page=2')).json;
  assert.deepEqual([notes.total, notes.pages, notes.items[0].note], [2, 2, 'Gọi lại chủ quán thứ Hai']);
  assert.equal((await call('GET', '/api/admin/audit?actor=lan@hitechcloud.vn')).json.total, 1);
  assert.equal((await call('GET', '/api/admin/audit?action=drop')).status, 422);
});

test('admin console: actor header is sanitised', () => {
  const h = (v) => actorOf({ headers: { 'x-admin-actor': v } });
  assert.equal(h(undefined), 'admin');
  assert.equal(h('ops@hitechcloud.vn'), 'ops@hitechcloud.vn');
  assert.equal(h(encodeURIComponent('Trần Thị Bé')), 'Trần Thị Bé');
  assert.equal(h('a\nb'), 'admin');
  assert.equal(h('<script>'), 'admin');
  assert.equal(h('%E0%A4%A'), 'admin');
  assert.equal(h('x'.repeat(65)), 'admin');
});

test('admin console: revenue endpoint over the fixtures', async (t) => {
  const { call, ids } = await setup(t);
  await call('POST', `/api/admin/tenants/${ids.photue}/actions/suspend`, { reason: 'Gian lận' });
  const r = (await call('GET', '/api/admin/revenue?months=4')).json;
  assert.deepEqual(r.months, ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(r.byMonth.map((m) => [m.month, m.total, m.count]), [['2026-07', 0, 0], ['2026-08', 399000, 1], ['2026-09', 537300, 1], ['2026-10', 0, 0]]);
  assert.deepEqual([r.total, r.count], [936300, 2]);
  assert.deepEqual(r.byPlan, { pro: { total: 399000, count: 1 }, basic: { total: 537300, count: 1 } });
  assert.deepEqual(r.byProvider, { payos: { total: 399000, count: 1 }, pay2s: { total: 537300, count: 1 } });
  /* cafe pays 537 300 for 3 months -> 179 100/month; list price 199 000. */
  assert.deepEqual(r.mrr, { estimate: 179100, listPrice: 199000, activeSubscriptions: 1 });
  assert.deepEqual([r.conversion.trials, r.conversion.converted, r.conversion.rate], [3, 2, 0.6667]);
  assert.deepEqual(r.conversion.cohorts.map((c) => [c.month, c.signups, c.converted]), [['2026-07', 0, 0], ['2026-08', 1, 1], ['2026-09', 0, 0], ['2026-10', 1, 0]]);
  assert.deepEqual(r.churn.find((c) => c.month === '2026-09'), { month: '2026-09', expiredPaid: 1, expiredTrial: 0, suspended: 0 });
  assert.deepEqual(r.churn.find((c) => c.month === '2026-10'), { month: '2026-10', expiredPaid: 0, expiredTrial: 0, suspended: 1 });
  assert.equal(r.suspendedUndated, 0);
  for (const v of [r.total, r.mrr.estimate, ...r.byMonth.map((m) => m.total)]) assert.ok(Number.isSafeInteger(v), 'integer VND');
});

test('computeRevenue: month boundaries in Vietnam time, VAT-free net for MRR, churn split', () => {
  const now = new Date('2026-03-31T18:00:00.000Z'); // 1 Apr 01:00 in VN
  const tenants = [
    { _id: 'a', status: 'active', createdAt: '2026-02-28T17:30:00.000Z', plan: { id: 'pro' }, subscription: { status: 'active', currentPeriodEnd: '2026-12-01T00:00:00.000Z', lastPaymentOrderCode: 2 } },
    { _id: 'b', status: 'active', createdAt: '2026-03-10T00:00:00.000Z', plan: { id: 'trial' }, subscription: { status: 'expired', currentPeriodEnd: '2026-03-24T00:00:00.000Z' }, suspended: true, suspendedReason: 'subscription_expired' },
    { _id: 'c', status: 'active', createdAt: '2026-01-10T00:00:00.000Z', plan: { id: 'basic' }, subscription: { status: 'active', currentPeriodEnd: '2026-05-01T00:00:00.000Z' } },
    { _id: 'd', status: 'active', createdAt: '2026-01-11T00:00:00.000Z', plan: { id: 'basic' }, subscription: { status: 'active', currentPeriodEnd: '2026-05-01T00:00:00.000Z' }, suspended: true, suspendedReason: 'Nợ phí' },
  ];
  const payments = [
    { orderCode: 1, reference: 'a', purpose: 'subscription', status: 'paid', provider: 'payos', amount: 399000, paidAt: '2026-02-28T17:30:00.000Z', metadata: { quote: { planId: 'pro', months: 1, net: 399000 } } },
    { orderCode: 2, reference: 'a', purpose: 'subscription', status: 'paid', provider: 'payos', amount: 4213440, paidAt: '2026-03-31T17:00:00.000Z', metadata: { quote: { planId: 'pro', months: 12, net: 3830400 } } },
    { orderCode: 3, reference: 'c', purpose: 'subscription', status: 'review', provider: 'pay2s', amount: 199000, paidAt: '2026-03-01T00:00:00.000Z', metadata: { quote: { planId: 'basic', months: 1 } } },
    { orderCode: 4, reference: 'c', purpose: 'sale', status: 'paid', provider: 'pay2s', amount: 50000, paidAt: '2026-03-01T00:00:00.000Z' },
  ];
  const r = computeRevenue({ tenants, payments, suspendAudit: [], now, months: 3 });
  assert.deepEqual(r.months, ['2026-02', '2026-03', '2026-04']);
  /* 28 Feb 17:30Z is 1 Mar in VN; 31 Mar 17:00Z is 1 Apr in VN. */
  assert.deepEqual(r.byMonth.map((m) => [m.month, m.total]), [['2026-02', 0], ['2026-03', 399000], ['2026-04', 4213440]]);
  assert.deepEqual(r.byMonth[2].byPlan, { pro: 4213440 });
  /* a: 3 830 400 / 12 = 319 200; c: no payment -> list 199 000; d suspended. */
  assert.deepEqual(r.mrr, { estimate: 319200 + 199000, listPrice: 399000 + 199000, activeSubscriptions: 2 });
  assert.deepEqual([r.conversion.trials, r.conversion.converted], [4, 1]);
  assert.deepEqual(r.conversion.cohorts.map((c) => [c.month, c.signups, c.converted]), [['2026-02', 0, 0], ['2026-03', 2, 1], ['2026-04', 0, 0]]);
  assert.deepEqual(r.churn[1], { month: '2026-03', expiredPaid: 0, expiredTrial: 1, suspended: 0 });
  assert.equal(r.suspendedUndated, 1, 'manual suspension without an audit entry');
  const empty = computeRevenue({ tenants: [], payments: [], now, months: 1 });
  assert.deepEqual([empty.total, empty.mrr.estimate, empty.conversion.rate], [0, 0, 0]);
});

test('searchTenants: unknown status and paging bounds are tolerated', () => {
  const rows = [{ _id: '1', subdomain: 'a', businessName: 'A', createdAt: '2026-01-01T00:00:00.000Z', subscription: { status: 'trialing' } }];
  const r = searchTenants(rows, new Map(), { status: 'nonsense', page: '99', limit: '0' }, NOW);
  assert.deepEqual([r.total, r.page, r.limit, r.items.length], [1, 1, 1, 1]);
});
