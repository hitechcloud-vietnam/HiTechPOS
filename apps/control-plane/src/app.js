'use strict';

const path = require('node:path');
const express = require('express');
const presets = require('@hitechpos/industry-presets');
const { isValidVNPhone, normalizeVNPhone, isValidTaxCode } = require('@hitechpos/vn-locale');
const { publicCatalogue, quote } = require('./plans');
const { createTenantService } = require('./tenants');
const { createBillingService } = require('./billing');
const { hashPassword, verifyPassword } = require('./passwords');
const { signToken, verifyToken } = require('./tokens');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Error codes map to Vietnamese messages for the signup/billing UI. */
const MESSAGES = {
  subdomain_invalid: 'Tên miền cửa hàng chỉ gồm chữ thường, số, dấu gạch ngang (3–30 ký tự).',
  subdomain_reserved: 'Tên miền này đã được hệ thống giữ chỗ.',
  subdomain_taken: 'Tên miền này đã có cửa hàng sử dụng.',
  business_name_invalid: 'Vui lòng nhập tên cửa hàng.',
  email_invalid: 'Email không hợp lệ.',
  email_taken: 'Email này đã được đăng ký.',
  phone_invalid: 'Số điện thoại di động không hợp lệ.',
  tax_code_invalid: 'Mã số thuế không hợp lệ.',
  password_weak: 'Mật khẩu cần ít nhất 8 ký tự.',
  credentials_invalid: 'Email hoặc mật khẩu không đúng.',
  unauthorized: 'Vui lòng đăng nhập.',
  plan_not_found: 'Gói cước không tồn tại.',
  plan_not_purchasable: 'Gói này không thể thanh toán.',
  billing_cycle_invalid: 'Chu kỳ thanh toán không hợp lệ.',
  tenant_install_failed: 'Khởi tạo cửa hàng thất bại, bộ phận kỹ thuật đã được thông báo.',
};

function httpError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function createApp({ store, config, providers, installer, now = () => new Date(), logger = console }) {
  const tenants = createTenantService({ store, config, installer, now });
  const billing = createBillingService({ store, providers, config, now });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  /* Webhooks need the exact bytes the provider signed; mounted before the
     JSON parser. A verified callback is always acknowledged with 200 so the
     provider stops retrying; a forged one gets 401. */
  app.post('/webhooks/:provider', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
    if (!providers.has(req.params.provider)) return res.status(404).json({ success: false });
    try {
      const result = await billing.handleCallback(req.params.provider, { body: req.body.toString('utf8'), headers: req.headers });
      res.json({ success: true, ...result });
    } catch (e) {
      logger.warn(`[webhook:${req.params.provider}] rejected: ${e.code || e.message}`);
      res.status(e.status && e.status < 500 ? e.status : 400).json({ success: false, code: e.code || 'invalid' });
    }
  });

  app.use(express.json({ limit: '64kb' }));

  const auth = (req, _res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const claims = verifyToken(token, config.sessionSecret, { now: now().getTime() });
    if (!claims) return next(httpError('unauthorized', 401));
    req.account = claims;
    next();
  };
  const admin = (req, _res, next) => {
    const key = req.headers['x-admin-key'];
    if (!config.adminKey || typeof key !== 'string' || key.length !== config.adminKey.length ||
        !require('node:crypto').timingSafeEqual(Buffer.from(key), Buffer.from(config.adminKey))) return next(httpError('unauthorized', 401));
    next();
  };
  const view = (t) => t && {
    id: String(t._id), subdomain: t.subdomain, businessName: t.businessName, industry: t.industry, status: t.status,
    suspended: !!t.suspended, suspendedReason: t.suspendedReason || null, plan: t.plan, subscription: t.subscription,
    urls: tenants.hostsOf(t).map((h) => `https://${h}`), createdAt: t.createdAt,
  };

  app.get('/healthz', (_req, res) => res.json({ ok: true, store: store.kind, providers: providers.list() }));
  app.get('/api/plans', (_req, res) => res.json({ ...publicCatalogue(), paymentProviders: providers.list() }));
  app.get('/api/plans/:id/quote', (req, res) => res.json(quote(req.params.id, Number(req.query.months || 1), { vatRate: config.saasVatRate })));
  app.get('/api/industries', (_req, res) => res.json(presets.listPresets()));
  app.get('/api/industries/:id', (req, res) => {
    if (!presets.hasPreset(req.params.id)) throw httpError('industry_not_found', 404);
    res.json(presets.getPreset(req.params.id));
  });
  app.get('/api/subdomains/:name', async (req, res) => res.json(await tenants.availability(req.params.name)));

  /* Owner signup creates the control-plane account and the shop together.
     The password is hashed here for the control plane and handed once, over
     the internal channel, to the Posnic installer for the shop's admin user. */
  app.post('/api/signup', async (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw httpError('email_invalid', 422);
    if (!isValidVNPhone(b.phone)) throw httpError('phone_invalid', 422);
    if (b.taxCode && !isValidTaxCode(b.taxCode, { allowBranch: true, allowPersonal12: true })) throw httpError('tax_code_invalid', 422);
    if (typeof b.password !== 'string' || b.password.length < 8) throw httpError('password_weak', 422);
    const avail = await tenants.availability(b.subdomain);
    if (!avail.available) throw httpError(`subdomain_${avail.reason}`, avail.reason === 'taken' ? 409 : 422);
    let account;
    try {
      account = await store.accounts.insert({ email, name: String(b.ownerName || '').trim(), phone: normalizeVNPhone(b.phone), passwordHash: hashPassword(b.password), createdAt: now().toISOString() });
    } catch (e) {
      if (e.code === 'duplicate') throw httpError('email_taken', 409);
      throw e;
    }
    const tenant = await tenants.signup(
      { subdomain: b.subdomain, businessName: b.businessName, industry: b.industry, taxCode: b.taxCode, province: b.province,
        owner: { email, name: account.name, phone: account.phone, password: b.password } },
      { ownerAccountId: String(account._id) }
    );
    const token = signToken({ sub: String(account._id), tenantId: String(tenant._id) }, config.sessionSecret, { now: now().getTime() });
    res.status(201).json({ token, tenant: view(tenant) });
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const account = await store.accounts.findByEmail(email);
    if (!account || !verifyPassword((req.body || {}).password, account.passwordHash)) throw httpError('credentials_invalid', 401);
    const tenant = await store.tenants.findOne({ ownerAccountId: String(account._id) });
    res.json({ token: signToken({ sub: String(account._id), tenantId: tenant ? String(tenant._id) : null }, config.sessionSecret, { now: now().getTime() }) });
  });

  app.get('/api/me', auth, async (req, res) => {
    const tenant = req.account.tenantId ? await store.tenants.findById(req.account.tenantId) : null;
    const payments = tenant ? (await store.payments.list({ reference: String(tenant._id) })).map(({ events, metadata, ...p }) => ({ ...p, quote: metadata && metadata.quote })) : [];
    res.json({ tenant: view(tenant), payments });
  });

  app.post('/api/billing/checkout', auth, async (req, res) => {
    const { plan, months, provider } = req.body || {};
    const out = await billing.checkout({ tenantId: req.account.tenantId, planId: plan, months: Number(months || 1), provider: provider || providers.list()[0] });
    res.status(201).json(out);
  });

  app.get('/api/billing/payments/:orderCode', auth, async (req, res) => {
    const p = await billing.journal.get(Number(req.params.orderCode));
    if (!p || p.reference !== req.account.tenantId) throw httpError('payment_not_found', 404);
    res.json({ orderCode: p.orderCode, status: p.status, amount: p.amount, provider: p.provider, checkoutUrl: p.checkoutUrl, paidAt: p.paidAt || null });
  });

  app.get('/api/admin/tenants', admin, async (_req, res) => res.json((await store.tenants.list()).map(view)));
  app.post('/api/admin/tenants/:id/suspend', admin, async (req, res) => res.json(view(await tenants.setSuspended(req.params.id, true, (req.body || {}).reason))));
  app.post('/api/admin/tenants/:id/resume', admin, async (req, res) => res.json(view(await tenants.setSuspended(req.params.id, false))));
  app.post('/api/admin/jobs/enforce-expiry', admin, async (_req, res) => res.json({ suspended: await billing.enforceExpiry() }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) logger.error('[control-plane]', err);
    const code = status >= 500 && !err.code ? 'internal_error' : err.code || 'error';
    res.status(status).json({ error: code, message: MESSAGES[code] || (status >= 500 ? 'Lỗi hệ thống, vui lòng thử lại.' : code) });
  });

  return { app, tenants, billing };
}

module.exports = { createApp, MESSAGES };
