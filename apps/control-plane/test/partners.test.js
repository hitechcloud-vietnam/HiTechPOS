'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createJournal, createProviderRegistry } = require('@hitechpos/payment-core');
const { createPayOSProvider } = require('@hitechpos/payment-payos');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { quote } = require('../src/plans');
const { createApp } = require('../src/app');
const { signToken } = require('../src/tokens');
const {
  createPartnerService, createPartnersRouter, referralCodeFromRequest, applyPartnerDiscount,
  commissionAmount, percentToBps, csvCell, normalizeCode,
} = require('../src/partners');

const silent = { warn() {}, error() {}, info() {} };

function setup() {
  const store = createMemoryStore();
  const config = loadConfig({ STORE: 'memory', ADMIN_API_KEY: 'admin-secret-key', PUBLIC_URL: 'https://app.hitechpos.vn/' });
  const clock = { t: new Date('2026-10-14T03:00:00Z').getTime() };
  const now = () => new Date(clock.t);
  const partners = createPartnerService({ store, config, now });
  const journal = createJournal({ store: store.payments, now });
  let seq = 0;
  async function tenant(businessName = 'Phở Tuệ') {
    seq++;
    return store.tenants.insert({ subdomain: `shop${seq}`, businessName, status: 'active', suspended: false, plan: { id: 'trial' }, subscription: { status: 'trialing' }, tenantDb: `hitech_t_shop${seq}`, secrets: { JWT_SECRET: 'v1:x' }, createdAt: now().toISOString() });
  }
  /* What billing.checkout + a verified paid callback + activate do, with the
     partner hooks where the proposed billing.js patch calls them. */
  let order = 1000;
  async function pay(t, planId, months, { hook = true } = {}) {
    clock.t += 3600000;
    const current = await store.tenants.findById(t._id);
    const q = await partners.adjustQuote({ tenant: current, quote: quote(planId, months) });
    const orderCode = ++order;
    await journal.open({ orderCode, provider: 'payos', amount: q.total, purpose: 'subscription', reference: String(t._id), metadata: { tenantId: String(t._id), quote: q } });
    const r = await journal.apply({ provider: 'payos', orderCode, status: 'paid', amount: q.total, eventKey: `e${orderCode}` });
    await store.tenants.update(t._id, { plan: { id: planId }, subscription: { status: 'active', lastPaymentOrderCode: orderCode } });
    if (hook) await partners.onPaid(r.payment);
    return { payment: r.payment, quote: q };
  }
  async function partner(input = {}) {
    return (await partners.createPartner({ name: 'Đại lý Minh An', email: 'minhan@daily.vn', phone: '0987654321', commission: { percent: 15, recurring: true, firstMonths: 12 }, ...input })).partner;
  }
  return { store, config, clock, now, partners, journal, tenant, pay, partner };
}

test('pure math: percentages as basis points, floors, partner discount on the quote', () => {
  assert.equal(percentToBps(12.5), 1250);
  assert.equal(percentToBps('7.5'), 750);
  assert.equal(percentToBps(0), 0);
  assert.equal(percentToBps(100), 10000);
  assert.equal(percentToBps(12.345), null, 'more than two decimals');
  assert.equal(percentToBps(101), null);
  assert.equal(percentToBps(-1), null);
  assert.equal(percentToBps(100, { exclusiveMax: true }), null);
  assert.equal(percentToBps('abc'), null);
  assert.equal(commissionAmount(1051864, 1500), 157779, '157 779.6 floors');
  assert.equal(commissionAmount(199000, 3333), 66326, '66 326.7 floors');
  assert.throws(() => commissionAmount(1.5, 100), /commission_input_invalid/);

  /* pro 3 months: 1 197 000 - 5% (59 850) = 1 137 150; 7.5% partner = 85 286.25 -> 85 286 */
  const q = quote('pro', 3, { vatRate: 8 });
  const adj = applyPartnerDiscount(q, 750, { id: 'p1', code: 'MINHAN' });
  assert.notEqual(adj, q);
  assert.equal(q.net, 1137150, 'input quote not mutated');
  assert.deepEqual([adj.partnerDiscount, adj.net, adj.vat, adj.total, adj.partnerDiscountPercent], [85286, 1051864, 84149, 1136013, 7.5]);
  assert.deepEqual([adj.subtotal, adj.discount, adj.months], [q.subtotal, q.discount, 3]);
  assert.ok(Number.isSafeInteger(adj.total));
  /* KCT: no VAT */
  const kct = applyPartnerDiscount(quote('basic', 1), 1000);
  assert.deepEqual([kct.partnerDiscount, kct.net, kct.vat, kct.total], [19900, 179100, 0, 179100]);
  assert.equal(applyPartnerDiscount(q, 0), q, 'zero discount returns the same quote');

  assert.equal(normalizeCode(' minhan '), 'MINHAN');
  assert.equal(normalizeCode(['MINHAN']), null);
  assert.equal(normalizeCode('MIN-HAN'), null);
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('-5'), "'-5");
  assert.equal(csvCell(-5), '-5');
});

test('attribution: set once, unknown/inactive codes and self-referral ignored', async () => {
  const { store, partners, tenant, partner } = setup();
  const p = await partner({ code: 'MINHAN' });
  const other = await partner({ code: 'BINHAN', email: 'binhan@daily.vn', phone: null });
  const owner = { email: 'chu@photue.vn', phone: '0912345678' };

  const a = await tenant();
  const row = await partners.attribute(a, { referralCode: ' minhan ', owner });
  assert.equal(row.partnerId, p.id);
  assert.equal((await store.tenants.findById(a._id)).referral.code, 'MINHAN');

  /* never changes afterwards: neither with the stale nor the fresh tenant */
  assert.equal(await partners.attribute(a, { referralCode: 'BINHAN', owner }), null);
  assert.equal(await partners.attribute(await store.tenants.findById(a._id), { referralCode: 'BINHAN', owner }), null);
  assert.equal((await store.tenants.findById(a._id)).referral.partnerId, p.id);
  assert.equal((await store.partnerAttributions.list({ partnerId: other.id })).length, 0);

  const b = await tenant();
  assert.equal(await partners.attribute(b, { referralCode: 'KHONGCO', owner }), null, 'unknown code');
  assert.equal(await partners.attribute(b, { referralCode: '<script>', owner }), null, 'malformed code');
  assert.equal(await partners.attribute(b, { referralCode: { $ne: null }, owner }), null, 'non-string code');
  assert.equal(await partners.attribute(b, { owner }), null, 'no code');
  assert.equal(await partners.attribute(b, { referralCode: 'MINHAN', owner: { email: 'MinhAn@DaiLy.vn', phone: '0912000000' } }), null, 'self by email');
  assert.equal(await partners.attribute(b, { referralCode: 'MINHAN', owner: { email: 'x@y.vn', phone: '+84 987 654 321' } }), null, 'self by phone');
  await partners.updatePartner(p.id, { status: 'suspended' });
  assert.equal(await partners.attribute(b, { referralCode: 'MINHAN', owner }), null, 'inactive partner');
  assert.equal((await store.tenants.findById(b._id)).referral, undefined);

  /* concurrent attempts: exactly one wins */
  await partners.updatePartner(p.id, { status: 'active' });
  const c = await tenant();
  const results = await Promise.all([partners.attribute(c, { referralCode: 'MINHAN', owner }), partners.attribute(c, { referralCode: 'BINHAN', owner })]);
  assert.equal(results.filter(Boolean).length, 1);
});

test('quote hook: unchanged without a partner, partner discount only on the first paid period', async () => {
  const { partners, tenant, partner, pay } = setup();
  const plain = await tenant();
  const q = quote('pro', 3);
  assert.equal(await partners.adjustQuote({ tenant: plain, quote: q }), q, 'no attribution: same object');
  assert.equal(await partners.adjustQuote({ tenant: null, quote: q }), q);

  await partner({ code: 'NODISC' });
  const t1 = await tenant();
  await partners.attribute(t1, { referralCode: 'NODISC', owner: { email: 'a@b.vn' } });
  assert.equal(await partners.adjustQuote({ tenant: t1, quote: q }), q, 'partner without customer discount');

  await partner({ code: 'GIAM10', email: 'giam@daily.vn', phone: null, customerDiscount: { percent: 7.5 } });
  const t2 = await tenant();
  await partners.attribute(t2, { referralCode: 'GIAM10', owner: { email: 'a@b.vn' } });
  const adj = await partners.adjustQuote({ tenant: t2, quote: q });
  assert.deepEqual([adj.partnerDiscount, adj.net, adj.total, adj.partner.code], [85286, 1051864, 1051864, 'GIAM10']);
  const first = await pay(t2, 'pro', 3);
  assert.equal(first.payment.amount, 1051864);
  const second = await partners.adjustQuote({ tenant: t2, quote: q });
  assert.equal(second, q, 'second period: no partner discount');
});

test('commission: idempotent per orderCode, first-N-months, floor rounding, non-recurring', async () => {
  const { store, partners, tenant, partner, pay, journal } = setup();
  const p = await partner({ code: 'MINHAN', customerDiscount: { percent: 7.5 } });
  const t = await tenant();
  await partners.attribute(t, { referralCode: 'MINHAN', owner: { email: 'chu@shop.vn' } });

  const { payment } = await pay(t, 'pro', 3);
  const c1 = await store.partnerCommissions.get(`C${payment.orderCode}`);
  /* base 1 051 864 (net after both discounts) x 15% = 157 779.6 -> 157 779 */
  assert.deepEqual([c1.base, c1.amount, c1.status, c1.eligibleMonths, c1.kind, c1.partnerId], [1051864, 157779, 'pending', 3, 'commission', p.id]);

  /* webhook replay / admin accept racing the callback: still one entry */
  const replays = await Promise.all([partners.onPaid(payment), partners.onPaid(payment), partners.onPaid({ ...payment })]);
  assert.ok(replays.every((r) => r.key === c1.key && r.amount === c1.amount));
  const dup = await journal.apply({ provider: 'payos', orderCode: payment.orderCode, status: 'paid', amount: payment.amount, eventKey: `e${payment.orderCode}` });
  assert.equal(dup.ignored, 'duplicate');
  assert.equal((await store.partnerCommissions.list({ tenantId: String(t._id) })).length, 1);

  /* 12 months more, but only 9 of the first 12 remain: base floored pro rata.
     basic 12: 2 388 000 - 20% = 1 910 400; x 9/12 = 1 432 800; x 15% = 214 920 */
  const second = await pay(t, 'basic', 12);
  const c2 = await store.partnerCommissions.get(`C${second.payment.orderCode}`);
  assert.deepEqual([c2.eligibleMonths, c2.base, c2.amount], [9, 1432800, 214920]);
  /* first 12 months used up */
  const third = await pay(t, 'basic', 1);
  assert.equal(await store.partnerCommissions.get(`C${third.payment.orderCode}`), null);

  /* non-recurring: first paid payment only */
  await partner({ code: 'MOTLAN', email: 'motlan@daily.vn', phone: null, commission: { percent: 33.33, recurring: false } });
  const u = await tenant();
  await partners.attribute(u, { referralCode: 'MOTLAN', owner: { email: 'x@shop.vn' } });
  const u1 = await pay(u, 'basic', 1);
  assert.equal((await store.partnerCommissions.get(`C${u1.payment.orderCode}`)).amount, 66326, '199 000 x 33.33% = 66 326.67 -> 66 326');
  const u2 = await pay(u, 'basic', 1);
  assert.equal(await store.partnerCommissions.get(`C${u2.payment.orderCode}`), null);

  /* no partner, other purposes, unpaid: nothing */
  const plain = await tenant();
  const pp = await pay(plain, 'basic', 1);
  assert.equal(await store.partnerCommissions.get(`C${pp.payment.orderCode}`), null);
  assert.equal(await partners.onPaid({ ...payment, purpose: 'sale' }), null);
  assert.equal(await partners.onPaid({ ...payment, status: 'review' }), null);
});

test('reconcile replays lost hooks once; amounts stay integers', async () => {
  const { store, partners, tenant, partner, pay } = setup();
  await partner({ code: 'MINHAN', commission: { percent: 12.5, recurring: true } });
  const t = await tenant();
  await partners.attribute(t, { referralCode: 'MINHAN', owner: { email: 'c@s.vn' } });
  await pay(t, 'basic', 3, { hook: false });
  await pay(t, 'pro', 1, { hook: false });
  assert.deepEqual(await partners.reconcile(), { scanned: 2, created: 2 });
  assert.deepEqual(await partners.reconcile(), { scanned: 2, created: 0 });
  const rows = await store.partnerCommissions.list({});
  /* basic 3: 597 000 - 5% = 567 150 x 12.5% = 70 893.75 -> 70 893; pro 1: 399 000 -> 49 875 */
  assert.deepEqual(rows.map((r) => r.amount).sort((a, b) => a - b), [49875, 70893]);
  assert.ok(rows.every((r) => Number.isSafeInteger(r.amount) && Number.isSafeInteger(r.base)));
});

test('ledger: pending -> approved -> paid, reversals for refunds', async () => {
  const { store, partners, tenant, partner, pay } = setup();
  const p = await partner({ code: 'MINHAN', commission: { percent: 10, recurring: true } });
  const t = await tenant();
  await partners.attribute(t, { referralCode: 'MINHAN', owner: { email: 'c@s.vn' } });
  const a = (await pay(t, 'basic', 1)).payment.orderCode;
  const b = (await pay(t, 'basic', 1)).payment.orderCode;

  await assert.rejects(partners.markPaid(`C${a}`), { code: 'commission_transition_invalid', status: 409 });
  assert.equal((await partners.approve(a)).status, 'approved', 'plain orderCode is accepted');
  assert.equal((await partners.approve(`C${a}`)).status, 'approved', 'idempotent');
  const paid = await partners.markPaid(`c${a}`, { payoutRef: 'UNC 0001' });
  assert.deepEqual([paid.status, paid.payoutRef, typeof paid.paidAt], ['paid', 'UNC 0001', 'string']);
  await assert.rejects(partners.approve(`C${a}`), { code: 'commission_transition_invalid' });
  await assert.rejects(partners.approve('C999999'), { code: 'commission_not_found', status: 404 });
  await assert.rejects(partners.approve('../x'), { code: 'commission_not_found' });

  /* refund of an unpaid commission: reversed, nothing owed */
  const r1 = await partners.reverse(b, { reason: 'hoàn tiền' });
  assert.deepEqual([r1.commission.status, r1.reversal], ['reversed', null]);
  await assert.rejects(partners.approve(`C${b}`), { code: 'commission_transition_invalid' });

  /* refund after payout: a negative entry, idempotent */
  const r2 = await partners.reverse(a, { reason: 'hoàn tiền' });
  assert.deepEqual([r2.reversal.key, r2.reversal.amount, r2.reversal.status, r2.reversal.kind], [`R${a}`, -19900, 'pending', 'reversal']);
  assert.equal(r2.commission.status, 'paid');
  assert.equal(r2.commission.reversedBy, `R${a}`);
  const r3 = await partners.reverse(a);
  assert.equal(r3.reversal.key, `R${a}`);
  assert.equal((await store.partnerCommissions.list({ orderCode: a })).length, 2);
  await assert.rejects(partners.reverse(`R${a}`), { code: 'commission_not_found' });
  await partners.approve(`R${a}`);
  await partners.markPaid(`R${a}`, { payoutRef: 'trừ kỳ sau' });

  const { totals } = await partners.partnerCommissions(p.id);
  assert.deepEqual(totals, { pending: 0, approved: 0, paid: 0, reversed: 19900 });

  /* a refunded payment no longer uses up the first months */
  await partners.updatePartner(p.id, { commission: { percent: 10, recurring: false } });
  const c = (await pay(t, 'basic', 1)).payment.orderCode;
  assert.equal((await store.partnerCommissions.get(`C${c}`)).amount, 19900, 'both earlier payments were refunded: this is the first');
  const d = (await pay(t, 'basic', 1)).payment.orderCode;
  assert.equal(await store.partnerCommissions.get(`C${d}`), null, 'not recurring');
});

/* Same check as app.js's X-Admin-Key middleware. */
function adminKeyGuard(config) {
  return (req, _res, next) => {
    const key = req.headers['x-admin-key'];
    if (typeof key !== 'string' || key.length !== config.adminKey.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.adminKey))) {
      return next(Object.assign(new Error('unauthorized'), { code: 'unauthorized', status: 401 }));
    }
    next();
  };
}

async function http() {
  const env = setup();
  const { store, config, partners } = env;
  const providers = createProviderRegistry([createPayOSProvider({ clientId: 'c', apiKey: 'a', checksumKey: 'k' }, { transport: async () => new Response('{}') })]);
  const { app } = createApp({ store, config, providers, logger: silent, installer: { async install() {} } });
  const outer = express();
  outer.use(createPartnersRouter({ partners, admin: adminKeyGuard(config), config, logger: silent }));
  outer.use(app);
  const server = outer.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, headers: res.headers };
  };
  return { ...env, server, call };
}

test('HTTP: admin API behind X-Admin-Key, partner portal, role separation, CSV', async (t) => {
  const { store, config, partners, server, call, tenant, pay } = await http();
  t.after(() => server.close());
  const A = { 'x-admin-key': 'admin-secret-key' };
  const newPartner = { name: 'Cộng tác viên Lan', email: 'lan@ctv.vn', phone: '0987654321', type: 'cong_tac_vien', code: 'lan2026', commission: { percent: 20, recurring: true, firstMonths: 6 }, customerDiscount: { percent: 10 } };

  assert.equal((await call('POST', '/api/admin/partners', newPartner)).status, 401);
  assert.equal((await call('POST', '/api/admin/partners', newPartner, { 'x-admin-key': 'admin-secret-kez' })).status, 401);
  assert.equal((await call('GET', '/api/admin/partners/commissions.csv', undefined, { 'x-admin-key': 'x' })).status, 401);
  const noRule = await call('POST', '/api/admin/partners', { ...newPartner, commission: undefined }, A);
  assert.deepEqual([noRule.status, noRule.json.error], [422, 'commission_percent_invalid'], 'no default commission rate');
  assert.equal((await call('POST', '/api/admin/partners', { ...newPartner, customerDiscount: { percent: 100 } }, A)).json.error, 'discount_percent_invalid');
  const created = await call('POST', '/api/admin/partners', newPartner, A);
  assert.equal(created.status, 201);
  assert.equal(created.json.partner.code, 'LAN2026');
  assert.equal(created.json.partner.referralUrl, 'https://app.hitechpos.vn/r/LAN2026');
  assert.ok(created.json.initialPassword && created.json.initialPassword.length >= 8);
  assert.ok(!created.text.includes('scrypt$'), 'no password hash');
  assert.equal((await call('POST', '/api/admin/partners', { ...newPartner, email: 'khac@ctv.vn' }, A)).json.error, 'partner_code_taken');
  assert.equal((await call('POST', '/api/admin/partners', { ...newPartner, code: undefined }, A)).json.error, 'partner_email_taken');
  const pid = created.json.partner.id;

  /* partner sign-in */
  assert.equal((await call('POST', '/api/partners/auth/login', { email: 'lan@ctv.vn', password: 'sai-mat-khau' })).status, 401);
  assert.equal((await call('POST', '/api/partners/auth/login', { email: 'khong@co.vn', password: 'x' })).json.error, 'credentials_invalid');
  const login = await call('POST', '/api/partners/auth/login', { email: 'LAN@ctv.vn', password: created.json.initialPassword });
  assert.equal(login.status, 200);
  const P = { authorization: `Bearer ${login.json.token}` };
  const me = await call('GET', '/api/partners/me', undefined, P);
  assert.deepEqual([me.json.partner.code, me.json.partner.commission.percent, me.json.partner.customerDiscount.percent], ['LAN2026', 20, 10]);
  assert.equal(me.headers.get('cache-control'), 'no-store');

  /* owner signs up through the real app; attribution through the service as the tenants.js patch would */
  const signup = await call('POST', '/api/signup', { subdomain: 'photue', businessName: '=HYPERLINK("http://x")', industry: 'nha-hang-quan-an', ownerName: 'T', email: 't@p.vn', phone: '0912345678', password: 'matkhau123' });
  assert.equal(signup.status, 201);
  const O = { authorization: `Bearer ${signup.json.token}` };
  const shop = await store.tenants.findById(signup.json.tenant.id);
  await partners.attribute(shop, { referralCode: 'LAN2026', owner: { email: 't@p.vn', phone: '0912345678' } });

  /* role separation */
  assert.equal((await call('GET', '/api/me', undefined, P)).status, 401, 'partner token is not an owner session');
  assert.equal((await call('POST', '/api/billing/checkout', { plan: 'basic', months: 1 }, P)).status, 401);
  assert.equal((await call('GET', '/api/partners/me', undefined, O)).status, 401, 'owner token is not a partner session');
  assert.equal((await call('GET', '/api/admin/partners', undefined, P)).status, 401, 'partner token is not an admin key');
  assert.equal((await call('GET', '/api/admin/tenants', undefined, P)).status, 401);
  const forged = signToken({ sub: pid, role: 'partner', aud: 'hitechpos:partner' }, config.sessionSecret);
  assert.equal((await call('GET', '/api/partners/me', undefined, { authorization: `Bearer ${forged}` })).status, 401, 'session-secret token with partner claims');
  const wrongAud = signToken({ sub: pid, role: 'partner', aud: 'other' }, crypto.createHmac('sha256', config.sessionSecret).update('hitechpos/partner-session/v1').digest('hex'));
  assert.equal((await call('GET', '/api/partners/me', undefined, { authorization: `Bearer ${wrongAud}` })).status, 401);

  /* shops: business name, plan, status only */
  const shops = (await call('GET', '/api/partners/me/shops', undefined, P)).json;
  assert.equal(shops.length, 1);
  assert.deepEqual(Object.keys(shops[0]).sort(), ['attributedAt', 'businessName', 'currentPeriodEnd', 'plan', 'status']);
  assert.deepEqual([shops[0].plan, shops[0].status], ['trial', 'trialing']);

  /* a payment, then the ledger over HTTP */
  const { payment } = await pay(shop, 'basic', 1);
  assert.equal(payment.amount, 179100, 'first period with the 10% partner discount');
  const comm = (await call('GET', '/api/partners/me/commissions', undefined, P)).json;
  assert.deepEqual([comm.items.length, comm.items[0].amount, comm.totals.pending], [1, 35820, 35820]);
  assert.ok(!JSON.stringify(comm).includes('tenantId'));
  assert.equal((await call('POST', `/api/admin/partners/commissions/C${payment.orderCode}/approve`, {}, P)).status, 401);
  assert.equal((await call('POST', `/api/admin/partners/commissions/C${payment.orderCode}/pay`, {}, A)).json.error, 'commission_transition_invalid');
  assert.equal((await call('POST', `/api/admin/partners/commissions/C${payment.orderCode}/approve`, {}, A)).json.status, 'approved');
  const paidOut = await call('POST', `/api/admin/partners/commissions/${payment.orderCode}/pay`, { payoutRef: 'UNC-01' }, A);
  assert.deepEqual([paidOut.json.status, paidOut.json.payoutRef], ['paid', 'UNC-01']);
  const rev = await call('POST', `/api/admin/partners/commissions/${payment.orderCode}/reverse`, { reason: 'Khách hoàn tiền' }, A);
  assert.equal(rev.json.reversal.amount, -35820);
  assert.equal((await call('GET', '/api/admin/partners/commissions?status=pending', undefined, A)).json.length, 1);
  const list = (await call('GET', '/api/admin/partners', undefined, A)).json;
  assert.deepEqual([list[0].shops, list[0].totals.paid, list[0].totals.pending], [1, 35820, -35820]);
  assert.equal((await call('GET', `/api/admin/partners/${pid}`, undefined, A)).json.shops.length, 1);
  assert.equal((await call('GET', '/api/admin/partners/nope', undefined, A)).json.error, 'partner_not_found');
  assert.deepEqual((await call('POST', '/api/admin/partners/jobs/reconcile', {}, A)).json, { scanned: 1, created: 0 });

  /* CSV */
  const csv = await call('GET', '/api/admin/partners/commissions.csv', undefined, A);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="hoa-hong-doi-tac-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.ok(csv.text.startsWith('﻿key,orderCode,kind,partnerCode,partnerName,businessName,'));
  const lines = csv.text.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines.some((l) => l.startsWith(`R${payment.orderCode},${payment.orderCode},reversal,LAN2026,Cộng tác viên Lan,"'=HYPERLINK(""http://x"")",basic,1,1,-179100,20.00,-35820,pending,`)), lines.join('\n'));
  assert.ok(lines.some((l) => l.includes(',179100,20.00,35820,paid,') && l.includes('UNC-01')));
  const pendingCsv = await call('GET', '/api/admin/partners/commissions.csv?status=paid', undefined, A);
  assert.equal(pendingCsv.text.trim().split('\r\n').length, 2);

  /* admin edits; code is immutable; password change revokes old sessions */
  const patched = await call('PATCH', `/api/admin/partners/${pid}`, { code: 'KHAC', commission: { percent: 12.5 }, status: 'suspended' }, A);
  assert.deepEqual([patched.json.code, patched.json.commission.percent, patched.json.status], ['LAN2026', 12.5, 'suspended']);
  assert.equal((await call('PATCH', `/api/admin/partners/${pid}`, { status: 'boss' }, A)).json.error, 'partner_status_invalid');
  const changed = await call('POST', '/api/partners/me/password', { currentPassword: created.json.initialPassword, newPassword: 'matkhaumoi1' }, P);
  assert.equal(changed.status, 200);
  assert.equal((await call('GET', '/api/partners/me', undefined, P)).status, 401, 'old token revoked');
  assert.equal((await call('GET', '/api/partners/me', undefined, { authorization: `Bearer ${changed.json.token}` })).status, 200);
  await call('PATCH', `/api/admin/partners/${pid}`, { status: 'terminated' }, A);
  assert.equal((await call('GET', '/api/partners/me', undefined, { authorization: `Bearer ${changed.json.token}` })).status, 401, 'terminated');
  assert.equal((await call('POST', '/api/partners/auth/login', { email: 'lan@ctv.vn', password: 'matkhaumoi1' })).status, 401);
});

test('HTTP: referral link cookie feeds the signup referral code', async (t) => {
  const { server, call } = await http();
  t.after(() => server.close());
  const r = await call('GET', '/r/minhan');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/?ref=MINHAN');
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /^htp_ref=MINHAN;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const bad = await call('GET', '/r/%3Cscript%3E');
  assert.deepEqual([bad.status, bad.headers.get('location'), bad.headers.get('set-cookie')], [302, '/', null]);

  assert.equal(referralCodeFromRequest({ body: {}, query: {}, headers: { cookie: 'a=1; htp_ref=MINHAN; b=2' } }), 'MINHAN');
  assert.equal(referralCodeFromRequest({ body: { referralCode: 'binhan' }, query: {}, headers: { cookie: 'htp_ref=MINHAN' } }), 'BINHAN', 'explicit field wins');
  assert.equal(referralCodeFromRequest({ body: {}, query: { ref: 'qref1' }, headers: {} }), 'QREF1');
  assert.equal(referralCodeFromRequest({ body: { referralCode: 42 }, query: {}, headers: { cookie: 'htp_ref=%E0%A4%A' } }), null);
  assert.equal(referralCodeFromRequest({}), null);
});

test('router uses the admin middleware it is given (app.js passes its own)', async (t) => {
  const { store, config, partners } = setup();
  let seen = 0;
  const admin = (req, _res, next) => {
    seen++;
    const key = req.headers['x-admin-key'];
    if (typeof key !== 'string' || key.length !== config.adminKey.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.adminKey))) {
      return next(Object.assign(new Error('unauthorized'), { code: 'unauthorized', status: 401 }));
    }
    next();
  };
  const app = express().use(createPartnersRouter({ partners, admin, config, logger: silent }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const no = await fetch(`${base}/api/admin/partners`);
  assert.equal(no.status, 401);
  assert.equal((await no.json()).message, 'Vui lòng đăng nhập.');
  const yes = await fetch(`${base}/api/admin/partners`, { headers: { 'x-admin-key': 'admin-secret-key' } });
  assert.equal(yes.status, 200);
  assert.equal(seen, 2);
  assert.equal(store.kind, 'memory');
  /* the portal does not go through the admin middleware */
  assert.equal((await fetch(`${base}/api/partners/me`)).status, 401);
  assert.equal(seen, 2);
});
