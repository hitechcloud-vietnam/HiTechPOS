'use strict';

const path = require('node:path');
const express = require('express');
const qrcode = require('qrcode-generator');
const presets = require('@hitechpos/industry-presets');
const { isValidVNPhone, normalizeVNPhone, isValidTaxCode, BANKS } = require('@hitechpos/vn-locale');
const { publicCatalogue, quote } = require('./plans');
const { createTenantService } = require('./tenants');
const { createBillingService } = require('./billing');
const { createPartnerService, createPartnersRouter, referralCodeFromRequest } = require('./partners');
const { createCounterService } = require('./counter');
const { createEInvoiceService } = require('./einvoices');
const { createNotifier } = require('./notify');
const { createDomainService } = require('./domains');
const { rateLimit, securityHeaders, sharedCaller, credentialKey } = require('./security');
const { isEmail } = require('@hitechpos/payment-core');
const { hashPassword, verifyPassword } = require('./passwords');
const { signToken, verifyToken } = require('./tokens');
const { createOps } = require('./ops');
const { createAdminConsoleRouter } = require('./admin-console');
const { createTaxLedgerRouter } = require('./tax-ledger-router');
const { createBusinessCloudRouter } = require('./business-cloud');


/* Error codes map to Vietnamese messages for the signup/billing UI. */
const MESSAGES = {
  subdomain_invalid: 'Tên miền cửa hàng chỉ gồm chữ thường, số, dấu gạch ngang (3–30 ký tự).',
  subdomain_reserved: 'Tên miền này đã được hệ thống giữ chỗ.',
  subdomain_taken: 'Tên miền này đã có cửa hàng sử dụng.',
  business_name_invalid: 'Vui lòng nhập tên cửa hàng.',
  industry_invalid: 'Ngành nghề không hợp lệ, vui lòng chọn lại.',
  einvoice_lookup_url_invalid: 'Đường dẫn tra cứu phải bắt đầu bằng https://.',
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
  bank_invalid: 'Ngân hàng không hợp lệ.',
  einvoice_provider_invalid: 'Nhà cung cấp hoá đơn điện tử không hợp lệ.',
  einvoice_connection_incomplete: 'Thông tin kết nối hoá đơn điện tử chưa đầy đủ.',
  einvoice_seller_incomplete: 'Cần đủ tên và địa chỉ đơn vị bán.',
  einvoice_not_configured: 'Cửa hàng chưa cấu hình hoá đơn điện tử.',
  einvoice_not_found: 'Chưa có hoá đơn điện tử cho đơn hàng này.',
  einvoice_issue_in_progress: 'Hoá đơn của đơn hàng này đang được phát hành.',
  einvoice_outcome_unknown: 'Lần phát hành trước chưa rõ kết quả, cần đối soát trước khi phát hành lại.',
  einvoice_credentials_rejected: 'Nhà cung cấp hoá đơn từ chối thông tin đăng nhập.',
  einvoice_not_supported: 'Nhà cung cấp chưa hỗ trợ thao tác này.',
  bank_feed_token_weak: 'Mã bảo mật webhook ngân hàng cần ít nhất 16 ký tự.',
  bank_account_invalid: 'Số tài khoản không hợp lệ.',
  payment_method_not_configured: 'Phương thức thanh toán này chưa được cấu hình cho cửa hàng.',
  payment_method_invalid: 'Phương thức thanh toán không hợp lệ.',
  payment_amount_invalid: 'Số tiền không hợp lệ.',
  sale_ref_invalid: 'Mã hoá đơn không hợp lệ.',
  sale_already_paid: 'Hoá đơn này đã được thanh toán.',
  payment_not_in_review: 'Giao dịch không ở trạng thái cần đối soát.',
  rate_limited: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.',
  domain_invalid: 'Tên miền không hợp lệ.',
  domain_reserved: 'Không dùng được tên miền của HiTechPOS.',
  domain_taken: 'Tên miền này đang được cửa hàng khác sử dụng.',
  domain_limit: 'Mỗi cửa hàng dùng tối đa 5 tên miền riêng.',
  domain_not_found: 'Chưa thêm tên miền này.',
  domain_unverified: 'Chưa thấy bản ghi TXT xác minh. Bản ghi DNS có thể mất vài phút đến vài giờ để có hiệu lực.',
  plan_feature_missing: 'Tính năng này cần gói cao hơn.',
  export_unavailable: 'Chức năng xuất dữ liệu chưa sẵn sàng trên máy chủ này.',
  reset_token_invalid: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
  payment_not_found: 'Không tìm thấy giao dịch.',
  manual_confirm_not_allowed: 'Chỉ xác nhận thủ công được với VietQR chuyển khoản trực tiếp.',
  payos_configuration_invalid: 'Thông tin kết nối payOS chưa đầy đủ.',
  pay2s_configuration_invalid: 'Thông tin kết nối Pay2S chưa đầy đủ.',
};

/* Log only values from fixed vocabularies, never request text: an error
   code matching our own snake_case codes, a provider from the known set. */
const logCode = (e) => (e && typeof e.code === 'string' && /^[a-z0-9_]{1,64}$/.test(e.code) ? e.code : 'invalid');
const logProvider = (p) => (['payos', 'pay2s', 'bank-feed'].includes(p) ? p : 'unknown');

function httpError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function createApp({ store, config, providers, installer, onboarding, now = () => new Date(), logger = console, counterOptions = {}, einvoiceOptions = {}, mailTransport, resolveTxt, ops: opsOptions = {}, tenantDb = null }) {
  const partners = createPartnerService({ store, config, now });
  const tenants = createTenantService({ store, config, installer, onboarding, now, attribute: partners.attribute });
  const domains = createDomainService({ store, config, now, ...(resolveTxt ? { resolveTxt } : {}) });
  const einvoices = createEInvoiceService({ store, config, now, providerOptions: einvoiceOptions, logger });
  const counter = createCounterService({ store, config, now, providerOptions: counterOptions, shopBridge: store.shopBridge || null, logger });
  const notifier = createNotifier({ store, config, now, logger, transport: mailTransport, hostsOf: (t) => tenants.hostsOf(t) });
  const billing = createBillingService({ store, providers, config, now, notifier, adjustQuote: partners.adjustQuote, onPaid: partners.onPaid });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  /* readiness, Prometheus metrics, admin ops summary (src/ops.js) */
  const ops = createOps({ store, config, now, ...opsOptions });
  app.use(ops.httpMetrics);
  app.use(securityHeaders);
  const limits = config.rateLimits || {};
  /* Every route has a ceiling per client; sign-in, signup, admin and the
     POS API have their own, tighter or keyed, limits on top. */
  app.use(rateLimit({ windowMs: 60000, max: limits.global ?? 600, skip: sharedCaller }));
  /* Providers' callbacks for every shop come from a few IPs: a separate,
     wider per-IP ceiling; each one is still signature-checked. */
  app.use('/webhooks', rateLimit({ windowMs: 60000, max: limits.webhooks ?? 6000 }));
  const loginLimit = rateLimit({ windowMs: 15 * 60000, max: limits.login ?? 20 });
  const signupLimit = rateLimit({ windowMs: 60 * 60000, max: limits.signup ?? 10 });
  const posLimit = rateLimit({ windowMs: 60000, max: limits.pos ?? 300, key: credentialKey });
  const adminLimit = rateLimit({ windowMs: 15 * 60000, max: limits.admin ?? 300 });

  /* Webhooks need the exact bytes the provider signed; mounted before the
     JSON parser. A verified callback is always acknowledged with 200 so the
     provider stops retrying; a forged one gets 401. */
  app.post('/webhooks/:provider', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
    if (!providers.has(req.params.provider)) return res.status(404).json({ success: false });
    try {
      const result = await billing.handleCallback(req.params.provider, { body: req.body.toString('utf8'), headers: req.headers });
      res.json({ success: true, ...result });
    } catch (e) {
      logger.warn(`[webhook:${logProvider(req.params.provider)}] rejected: ${logCode(e)}`);
      res.status(e.status && e.status < 500 ? e.status : 400).json({ success: false, code: e.code || 'invalid' });
    }
  });

  /* A shop's own payOS/Pay2S account calls back here; verified with that
     shop's keys, so one shop can never settle another shop's payment. */
  app.post('/webhooks/shop/:tenantId/bank-feed', express.raw({ type: '*/*', limit: '512kb' }), async (req, res) => {
    try {
      res.json({ success: true, ...(await counter.handleBankFeed(req.params.tenantId, { body: req.body.toString('utf8'), headers: req.headers })) });
    } catch (e) {
      logger.warn(`[webhook:shop:bank-feed] rejected: ${logCode(e)}`);
      res.status(e.status && e.status < 500 ? e.status : 400).json({ success: false, code: e.code || 'invalid' });
    }
  });
  app.post('/webhooks/shop/:tenantId/:method', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
    try {
      const result = await counter.handleCallback(req.params.tenantId, req.params.method, { body: req.body.toString('utf8'), headers: req.headers });
      res.json({ success: true, ...result });
    } catch (e) {
      logger.warn(`[webhook:shop:${logProvider(req.params.method)}] rejected: ${logCode(e)}`);
      res.status(e.status && e.status < 500 ? e.status : 400).json({ success: false, code: e.code || 'invalid' });
    }
  });

  /* "Continue with HiTechPOS Cloud" for the owner app (src/business-cloud.js);
     its own JSON parser and strict error shape, so mounted before ours. */
  app.use('/api/business/v1', createBusinessCloudRouter({ store, config, now, logger }));
  app.use(express.json({ limit: '64kb' }));

  /* A password change or reset invalidates every session issued before it. */
  const auth = async (req, _res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const claims = verifyToken(token, config.sessionSecret, { now: now().getTime() });
    if (!claims) return next(httpError('unauthorized', 401));
    const account = await store.accounts.findById(claims.sub);
    if (!account) return next(httpError('unauthorized', 401));
    if (account.passwordChangedAt && claims.iat * 1000 < new Date(account.passwordChangedAt).getTime() - 1000) return next(httpError('unauthorized', 401));
    req.account = claims;
    next();
  };
  const admin = (req, res, next) => adminLimit(req, res, (e) => (e ? next(e) : adminKey(req, res, next)));
  const adminKey = (req, _res, next) => {
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
  ops.mount(app, { admin });
  app.get('/api/plans', (_req, res) => res.json({ ...publicCatalogue(), paymentProviders: providers.list() }));
  app.get('/api/plans/:id/quote', (req, res) => res.json(quote(req.params.id, Number(req.query.months || 1), { vatRate: config.saasVatRate })));
  app.get('/api/industries', (_req, res) => res.json(presets.listPresets()));
  app.get('/api/banks', (_req, res) => res.json(BANKS.map(({ bin, code, shortName, name }) => ({ bin, code, shortName, name }))));
  /* AGPL-3.0 section 13: every user can reach the source of what is running. */
  app.get('/source', (_req, res) => res.redirect(302, config.sourceUrl));
  app.get('/api/industries/:id', (req, res) => {
    if (!presets.hasPreset(req.params.id)) throw httpError('industry_not_found', 404);
    res.json(presets.getPreset(req.params.id));
  });
  app.get('/api/subdomains/:name', async (req, res) => res.json(await tenants.availability(req.params.name)));

  /* Owner signup creates the control-plane account and the shop together.
     The password is hashed here for the control plane and handed once, over
     the internal channel, to the Posnic installer for the shop's admin user. */
  app.post('/api/signup', signupLimit, async (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!isEmail(email)) throw httpError('email_invalid', 422);
    if (!isValidVNPhone(b.phone)) throw httpError('phone_invalid', 422);
    if (b.taxCode && !isValidTaxCode(b.taxCode, { allowBranch: true, allowPersonal12: true })) throw httpError('tax_code_invalid', 422);
    if (typeof b.password !== 'string' || b.password.length < 8) throw httpError('password_weak', 422);
    const avail = await tenants.availability(b.subdomain);
    if (!avail.available) throw httpError(`subdomain_${avail.reason}`, avail.reason === 'taken' ? 409 : 422);
    tenants.validate(b);
    let account;
    try {
      account = await store.accounts.insert({ email, name: String(b.ownerName || '').trim(), phone: normalizeVNPhone(b.phone), passwordHash: hashPassword(b.password), createdAt: now().toISOString() });
    } catch (e) {
      if (e.code === 'duplicate') throw httpError('email_taken', 409);
      throw e;
    }
    let tenant;
    try {
      tenant = await tenants.signup(
        { subdomain: b.subdomain, businessName: b.businessName, industry: b.industry, taxCode: b.taxCode, province: b.province, referralCode: referralCodeFromRequest(req),
          owner: { email, name: account.name, phone: account.phone, password: b.password } },
        { ownerAccountId: String(account._id) }
      );
    } catch (e) {
      /* No shop row was written (e.g. the subdomain was taken in between):
         drop the account too, so the owner can simply try again. */
      if (!(await store.tenants.findOne({ ownerAccountId: String(account._id) }))) await store.accounts.remove(account._id).catch(() => {});
      throw e;
    }
    const token = signToken({ sub: String(account._id), tenantId: String(tenant._id) }, config.sessionSecret, { now: now().getTime() });
    await notifier.send(tenant, 'welcome', 'welcome').catch((e) => logger.warn(`[notify] welcome: ${e.message}`));
    res.status(201).json({ token, tenant: view(tenant) });
  });

  app.post('/api/auth/login', loginLimit, async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const account = await store.accounts.findByEmail(email);
    if (!account || !verifyPassword((req.body || {}).password, account.passwordHash)) throw httpError('credentials_invalid', 401);
    const tenant = await store.tenants.findOne({ ownerAccountId: String(account._id) });
    res.json({ token: signToken({ sub: String(account._id), tenantId: tenant ? String(tenant._id) : null }, config.sessionSecret, { now: now().getTime() }) });
  });

  /*
   * Password reset: always answers 200 so the endpoint does not reveal which
   * emails have accounts. The emailed token is stored only as a SHA-256 hash,
   * is single-use and expires after an hour.
   */
  const crypto = require('node:crypto');
  const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
  app.post('/api/auth/forgot', loginLimit, async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const account = isEmail(email) ? await store.accounts.findByEmail(email) : null;
    if (account) {
      const token = crypto.randomBytes(32).toString('base64url');
      await store.accounts.update(account._id, { resetTokenHash: sha256(token), resetExpiresAt: new Date(now().getTime() + 3600000).toISOString() });
      await notifier.sendTo(account.email, 'passwordReset', { token }).catch(() => {});
    }
    res.json({ ok: true, message: 'Nếu email đã đăng ký, hướng dẫn đặt lại mật khẩu đã được gửi.' });
  });
  app.post('/api/auth/reset', loginLimit, async (req, res) => {
    const { token, password } = req.body || {};
    if (typeof password !== 'string' || password.length < 8) throw httpError('password_weak', 422);
    const account = typeof token === 'string' && token ? await store.accounts.findOne({ resetTokenHash: sha256(token) }) : null;
    if (!account || !account.resetExpiresAt || new Date(account.resetExpiresAt).getTime() < now().getTime()) throw httpError('reset_token_invalid', 400);
    await store.accounts.update(account._id, { passwordHash: hashPassword(password), resetTokenHash: null, resetExpiresAt: null, passwordChangedAt: now().toISOString() });
    res.json({ ok: true });
  });
  app.post('/api/me/password', auth, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const account = await store.accounts.findById(req.account.sub);
    if (!account || !verifyPassword(currentPassword, account.passwordHash)) throw httpError('credentials_invalid', 401);
    if (typeof newPassword !== 'string' || newPassword.length < 8) throw httpError('password_weak', 422);
    const changedAt = now().toISOString();
    await store.accounts.update(account._id, { passwordHash: hashPassword(newPassword), passwordChangedAt: changedAt, resetTokenHash: null, resetExpiresAt: null });
    const token = signToken({ sub: String(account._id), tenantId: req.account.tenantId }, config.sessionSecret, { now: now().getTime() + 1000 });
    res.json({ ok: true, token });
  });

  app.get('/api/me', auth, async (req, res) => {
    const tenant = req.account.tenantId ? await store.tenants.findById(req.account.tenantId) : null;
    const payments = tenant ? (await store.payments.list({ reference: String(tenant._id), purpose: 'subscription' })).map(({ events, metadata, ...p }) => ({ ...p, quote: metadata && metadata.quote })) : [];
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

  /* ---- counter payments: owner settings ---- */
  /* ---- custom domains (domains.js) ---- */
  app.get('/api/shop/domains', auth, async (req, res) => res.json(await domains.list(req.account.tenantId)));
  app.post('/api/shop/domains', auth, async (req, res) => res.status(201).json(await domains.add(req.account.tenantId, (req.body || {}).domain)));
  app.post('/api/shop/domains/:domain/verify', auth, async (req, res) => res.json(await domains.verify(req.account.tenantId, req.params.domain)));
  app.delete('/api/shop/domains/:domain', auth, async (req, res) => res.json(await domains.remove(req.account.tenantId, req.params.domain)));
  /* Caddy on_demand_tls "ask" (deploy/Caddyfile). Answered only to the
     local proxy itself: a direct, non-forwarded loopback request. */
  app.get('/internal/tls-ask', async (req, res) => {
    const remote = req.socket.remoteAddress || '';
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) && !req.headers['x-forwarded-for'];
    if (!local) return res.status(403).end();
    res.status((await domains.allowed(req.query.domain)) ? 200 : 404).end();
  });

  /* Sổ sách & báo cáo thuế: S1-HKD revenue book and tax summary of the
     owner's own shop (src/tax-ledger*.js). */
  app.use('/api/shop/tax-ledger', auth, createTaxLedgerRouter({ store, tenantDb, now }));

  /* Data portability / self-held backup: the whole shop database as
     gzipped NDJSON (store/mongo.js exportShop). */
  app.get('/api/shop/export', auth, async (req, res) => {
    if (!store.shopBridge || !store.shopBridge.exportShop) throw httpError('export_unavailable', 501);
    const tenant = await store.tenants.findById(req.account.tenantId);
    if (!tenant) throw httpError('tenant_not_found', 404);
    const zlib = require('node:zlib');
    const { Readable } = require('node:stream');
    const { pipeline } = require('node:stream/promises');
    const day = now().toISOString().slice(0, 10);
    res.set({ 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="hitechpos-${tenant.subdomain}-${day}.ndjson.gz"`, 'cache-control': 'no-store' });
    const lines = Readable.from((async function* () {
      for await (const row of store.shopBridge.exportShop(tenant)) yield JSON.stringify(row) + '\n';
    })());
    await pipeline(lines, zlib.createGzip(), res);
    logger.info?.(`[export] shop ${String(tenant._id)}`);
  });
  app.get('/api/shop/payment-settings', auth, async (req, res) => res.json(await counter.getSettings(req.account.tenantId)));
  app.put('/api/shop/payment-settings', auth, async (req, res) => res.json(await counter.updateSettings(req.account.tenantId, req.body || {})));
  app.get('/api/shop/api-keys', auth, async (req, res) => res.json(await counter.listApiKeys(req.account.tenantId)));
  app.post('/api/shop/api-keys', auth, async (req, res) => res.status(201).json(await counter.createApiKey(req.account.tenantId, req.body || {})));
  app.delete('/api/shop/api-keys/:id', auth, async (req, res) => {
    await counter.revokeApiKey(req.account.tenantId, req.params.id);
    res.status(204).end();
  });
  app.get('/api/shop/payments', auth, async (req, res) => {
    const rows = await store.payments.list({ reference: String(req.account.tenantId), purpose: 'sale' });
    res.json(rows.slice(0, 100).map(({ events, ...p }) => p));
  });

  /* ---- counter payments: POS devices (shop API key) ---- */
  app.use('/pos/v1', posLimit);
  const pos = async (req, _res, next) => {
    const tenant = await counter.authenticate(req.headers.authorization);
    if (!tenant) return next(httpError('unauthorized', 401));
    req.tenant = tenant;
    next();
  };
  app.post('/pos/v1/payments', pos, async (req, res) => res.status(201).json(await counter.createPayment(req.tenant, req.body || {})));
  app.get('/pos/v1/payments/:orderCode', pos, async (req, res) => res.json(await counter.getPayment(req.tenant, req.params.orderCode)));
  app.post('/pos/v1/payments/:orderCode/confirm', pos, async (req, res) => res.json(await counter.confirmManually(req.tenant, req.params.orderCode, req.body || {})));
  app.post('/pos/v1/payments/:orderCode/cancel', pos, async (req, res) => res.json(await counter.cancel(req.tenant, req.params.orderCode)));

  /* ---- e-invoices (hoá đơn điện tử) ---- */
  app.get('/api/shop/einvoice-settings', auth, async (req, res) => res.json(await einvoices.getSettings(req.account.tenantId)));
  app.put('/api/shop/einvoice-settings', auth, async (req, res) => res.json(await einvoices.updateSettings(req.account.tenantId, req.body && req.body.provider ? req.body : null)));
  /* Sales the auto-issue worker could not invoice (einvoice-worker.js). */
  app.get('/api/shop/einvoice-errors', auth, async (req, res) => {
    const t = await store.tenants.findById(req.account.tenantId);
    res.json(((t && t.einvoiceErrors) || []).slice().reverse());
  });
  app.get('/api/shop/einvoices', auth, async (req, res) => res.json(await einvoices.list(req.account.tenantId)));
  const ownerTenant = async (req) => store.tenants.findById(req.account.tenantId);
  app.post('/api/shop/einvoices/:refId/reconcile', auth, async (req, res) => res.json(await einvoices.reconcile(await ownerTenant(req), req.params.refId)));
  const sendPdf = async (tenant, refId, res) => {
    const { pdf, fileName } = await einvoices.pdf(tenant, refId);
    res.type('application/pdf').set('content-disposition', `inline; filename="${String(fileName || refId).replace(/[^A-Za-z0-9_.-]/g, '_')}"`).send(pdf);
  };
  app.get('/api/shop/einvoices/:refId/pdf', auth, async (req, res) => sendPdf(await ownerTenant(req), req.params.refId, res));
  app.post('/pos/v1/einvoices', pos, async (req, res) => res.status(201).json(await einvoices.issue(req.tenant, req.body || {})));
  app.get('/pos/v1/einvoices/:refId', pos, async (req, res) => res.json(await einvoices.get(req.tenant, req.params.refId)));
  app.post('/pos/v1/einvoices/:refId/reconcile', pos, async (req, res) => res.json(await einvoices.reconcile(req.tenant, req.params.refId)));
  app.get('/pos/v1/einvoices/:refId/pdf', pos, async (req, res) => sendPdf(req.tenant, req.params.refId, res));

  /* ---- customer-facing display ---- */
  app.get('/api/public/pay/:tenantId/:orderCode', async (req, res) => {
    res.set('cache-control', 'no-store');
    res.json(await counter.publicView(req.params.tenantId, req.params.orderCode));
  });
  app.get('/api/public/pay/:tenantId/:orderCode/qr.svg', async (req, res) => {
    const view = await counter.publicView(req.params.tenantId, req.params.orderCode);
    if (!view.qrPayload) throw httpError('payment_not_found', 404);
    const qr = qrcode(0, 'M');
    qr.addData(view.qrPayload);
    qr.make();
    res.set('cache-control', 'private, max-age=900').type('image/svg+xml').send(qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }));
  });
  app.get('/pay/:tenantId/:orderCode', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'pay.html')));

  /* Staff view: adds what support needs (install/onboarding outcome, which
     payment and e-invoice integrations are on) and never any secret. */
  const adminView = (t) => t && {
    ...view(t),
    tenantDb: t.tenantDb,
    installError: t.installError || null,
    onboarding: t.onboarding || null,
    paymentMethods: ['vietqr', 'payos', 'pay2s'].filter((m) => t.paymentSettings && t.paymentSettings[m]),
    bankFeed: !!(t.paymentSettings && t.paymentSettings.bankFeed),
    einvoice: t.einvoiceSettings ? { provider: t.einvoiceSettings.provider, environment: t.einvoiceSettings.environment, autoIssue: !!t.einvoiceSettings.autoIssue } : null,
  };
  app.get('/api/admin/tenants', admin, async (_req, res) => res.json((await store.tenants.list({}, { limit: 500 })).map(adminView)));
  app.get('/api/admin/stats', admin, async (_req, res) => {
    const all = await store.tenants.list();
    const count = (f) => all.filter(f).length;
    const plans = require('./plans');
    const mrr = all
      .filter((t) => t.subscription && t.subscription.status === 'active' && !t.suspended)
      .reduce((sum, t) => sum + ((plans.PLANS.find((p) => p.id === t.plan.id) || {}).monthlyPrice || 0), 0);
    res.json({
      tenants: all.length,
      active: count((t) => t.status === 'active' && !t.suspended),
      trialing: count((t) => t.subscription && t.subscription.status === 'trialing' && !t.suspended),
      paying: count((t) => t.subscription && t.subscription.status === 'active'),
      suspended: count((t) => t.suspended),
      installFailed: count((t) => t.status === 'install_failed'),
      mrr,
      byIndustry: all.reduce((acc, t) => ({ ...acc, [t.industry]: (acc[t.industry] || 0) + 1 }), {}),
    });
  });
  app.get('/api/admin/payments', admin, async (req, res) => {
    const query = {};
    if (req.query.status) query.status = String(req.query.status);
    if (req.query.purpose) query.purpose = String(req.query.purpose);
    const rows = await store.payments.list(query);
    res.json(rows.slice(0, 200).map(({ events, ...p }) => ({ ...p, events: (events || []).slice(-5) })));
  });
  /* A payment held in review (amount mismatch) is accepted as paid by staff
     after checking the bank statement; a subscription is then activated. */
  app.post('/api/admin/payments/:orderCode/accept', admin, async (req, res) => {
    const p = await billing.journal.get(Number(req.params.orderCode));
    if (!p) throw httpError('payment_not_found', 404);
    if (p.status !== 'review') throw httpError('payment_not_in_review', 409);
    const note = String((req.body || {}).note || '').slice(0, 200);
    const r = await billing.journal.apply({ provider: p.provider, orderCode: p.orderCode, status: 'paid', amount: p.amount, eventKey: `admin-accept:${p.orderCode}`, transactionId: note ? `admin:${note}` : 'admin' });
    if (r.changed && r.payment.purpose === 'subscription') await billing.activate(r.payment);
    res.json({ orderCode: r.payment.orderCode, status: r.payment.status });
  });
  app.post('/api/admin/tenants/:id/suspend', admin, async (req, res) => res.json(adminView(await tenants.setSuspended(req.params.id, true, (req.body || {}).reason))));
  app.post('/api/admin/tenants/:id/resume', admin, async (req, res) => res.json(adminView(await tenants.setSuspended(req.params.id, false))));
  app.post('/api/admin/jobs/reminders', admin, async (_req, res) => res.json({ sent: await ops.trackJob('reminders', () => notifier.runReminders()) }));
  app.post('/api/admin/jobs/enforce-expiry', admin, async (_req, res) => res.json({ suspended: await ops.trackJob('expiry', () => billing.enforceExpiry()) }));
  /* partner / referral program: /r/:code, /api/partners/*, /api/admin/partners/* (src/partners.js) */
  app.use(createPartnersRouter({ partners, admin, config, logger }));

  /* Operator console API (src/admin-console.js): search, detail, audited actions, revenue. */
  app.use('/api/admin', admin, createAdminConsoleRouter({ store, config, billing, notifier, tenants, shopBridge: store.shopBridge || null, now, logger }));

  app.get('/vendor/qrcode.js', (_req, res) => res.type('js').sendFile(require.resolve('qrcode-generator/qrcode.js')));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) logger.error('[control-plane]', err);
    const code = status >= 500 && !err.code ? 'internal_error' : err.code || 'error';
    const own = err.message && err.message !== code ? err.message : null;
    const message = MESSAGES[code] || (status >= 500 ? 'Lỗi hệ thống, vui lòng thử lại.' : own || code);
    /* Validation details (e.g. einvoice_invalid field list) help the POS show
       what to fix; never sent for server errors. */
    const details = status < 500 && err.details && err.details.errors ? { errors: err.details.errors } : undefined;
    res.status(status).json({ error: code, message, ...(details ? { details } : {}) });
  });

  return { app, tenants, billing, counter, notifier, einvoices, ops, partners };
}

module.exports = { createApp, MESSAGES };
