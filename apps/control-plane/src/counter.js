'use strict';

const crypto = require('node:crypto');
const { createJournal, generateOrderCode, fail, PAYMENT_STATUS: S, transferDescription } = require('@hitechpos/payment-core');
const { createPayOSProvider } = require('@hitechpos/payment-payos');
const { createPay2SProvider } = require('@hitechpos/payment-pay2s');
const { buildVietQR } = require('@hitechpos/vietqr');
const { findBank } = require('@hitechpos/vn-locale');
const { seal, open } = require('./secrets');

/*
 * Payments at the counter, for a shop's own customers.
 *
 * Unlike subscriptions, the money here belongs to the shop: every shop
 * configures its own payOS / Pay2S merchant credentials or its own bank
 * account, and HiTechPOS never holds the funds. Credentials are sealed with
 * the same envelope as the shop's Posnic secrets.
 *
 * Methods:
 *   vietqr - dynamic VietQR for the shop's bank account. No provider sees the
 *            transfer, so the cashier confirms receipt by hand (or a bank
 *            notification integration does it later). Works with no gateway.
 *   payos  - payOS payment link/QR; settled by the shop-specific webhook.
 *   pay2s  - Pay2S checkout; settled by the shop-specific IPN.
 *
 * The POS authenticates with a shop API key (htp_live_...), stored hashed.
 */
const METHODS = ['vietqr', 'payos', 'pay2s'];
const KEY_PREFIX = 'htp_live_';

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function mask(value) {
  const s = String(value || '');
  return s.length <= 4 ? '••••' : `${'•'.repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
}

function createCounterService({ store, config, now = () => new Date(), providerOptions = {}, shopBridge = null, logger = console }) {
  const journal = createJournal({ store: store.payments, now });
  const providerCache = new Map();

  async function tenantOrFail(tenantId) {
    const tenant = await store.tenants.findById(tenantId);
    if (!tenant) fail('tenant_not_found', 404);
    return tenant;
  }

  /* ---- shop settings (owner) ---- */

  function validateVietQR(input) {
    const bank = findBank(input.bin || input.bank);
    if (!bank) fail('bank_invalid', 422);
    const accountNumber = String(input.accountNumber || '').replace(/\s+/g, '');
    if (!/^[0-9A-Za-z]{4,19}$/.test(accountNumber)) fail('bank_account_invalid', 422);
    const accountName = transferDescription(input.accountName || '', { max: 50 }).toUpperCase();
    return { bin: bank.bin, bankName: bank.shortName, accountNumber, accountName };
  }

  async function updateSettings(tenantId, input = {}) {
    const tenant = await tenantOrFail(tenantId);
    const current = tenant.paymentSettings || {};
    const next = { ...current };
    const key = config.tenantSecretKey;
    if (input.vietqr !== undefined) next.vietqr = input.vietqr ? validateVietQR(input.vietqr) : null;
    if (input.payos !== undefined) {
      if (input.payos) {
        const { clientId, apiKey, checksumKey } = input.payos;
        if (![clientId, apiKey, checksumKey].every((v) => typeof v === 'string' && v.trim())) fail('payos_configuration_invalid', 422);
        next.payos = { clientId: clientId.trim(), apiKey: seal(apiKey.trim(), key), checksumKey: seal(checksumKey.trim(), key) };
      } else next.payos = null;
    }
    if (input.pay2s !== undefined) {
      if (input.pay2s) {
        const { accessKey, partnerCode, secretKey, environment = 'production' } = input.pay2s;
        if (![accessKey, partnerCode, secretKey].every((v) => typeof v === 'string' && v.trim())) fail('pay2s_configuration_invalid', 422);
        if (!['sandbox', 'production'].includes(environment)) fail('pay2s_configuration_invalid', 422);
        next.pay2s = { accessKey: accessKey.trim(), partnerCode: partnerCode.trim(), environment, secretKey: seal(secretKey.trim(), key) };
      } else next.pay2s = null;
    }
    if (input.defaultMethod !== undefined) {
      if (input.defaultMethod && !METHODS.includes(input.defaultMethod)) fail('payment_method_invalid', 422);
      next.defaultMethod = input.defaultMethod || null;
    }
    if (next.defaultMethod && !next[next.defaultMethod]) next.defaultMethod = null;
    next.updatedAt = now().toISOString();
    providerCache.delete(String(tenant._id));
    const patch = { paymentSettings: next };
    const enabled = METHODS.some((m) => next[m]);
    /* The Posnic sales screen reaches this service with a per-shop key the
       shard reads from the shop's sealed secrets (HITECH_POS_KEY). */
    const hasInternalKey = (tenant.apiKeys || []).some((k) => k.internal && !k.revokedAt) && tenant.secrets && tenant.secrets.HITECH_POS_KEY;
    if (enabled && !hasInternalKey) {
      const internal = newKey('Posnic – màn hình bán hàng', true);
      patch.secrets = { ...(tenant.secrets || {}), HITECH_POS_KEY: seal(internal.secret, key) };
      patch.apiKeys = [...(tenant.apiKeys || []), internal.entry];
      patch.apiKeyHashes = patch.apiKeys.filter((k) => !k.revokedAt).map((k) => k.hash);
    }
    await store.tenants.update(tenant._id, patch);
    if (shopBridge) {
      /* Turns the QR tile on the Posnic sales screen on or off. A failure is
         reported but does not undo the saved settings. */
      try {
        await shopBridge.setQrGateway(tenant, { enabled, method: defaultMethodOf(next) });
      } catch (e) {
        logger.warn(`[counter] could not update the POS QR switch for ${tenant.subdomain}: ${e.message}`);
      }
    }
    return describeSettings(next);
  }

  /* Never returns a secret, only enough to recognise which one is set. */
  function describeSettings(s = {}) {
    return {
      vietqr: s.vietqr || null,
      payos: s.payos ? { clientId: s.payos.clientId, apiKey: '••••••••', checksumKey: '••••••••' } : null,
      pay2s: s.pay2s ? { accessKey: mask(s.pay2s.accessKey), partnerCode: s.pay2s.partnerCode, environment: s.pay2s.environment, secretKey: '••••••••' } : null,
      methods: METHODS.filter((m) => s[m]),
      defaultMethod: defaultMethodOf(s),
      webhooks: {
        payos: `${config.publicUrl}/webhooks/shop/{tenantId}/payos`,
        pay2s: `${config.publicUrl}/webhooks/shop/{tenantId}/pay2s`,
      },
    };
  }

  async function getSettings(tenantId) {
    const tenant = await tenantOrFail(tenantId);
    const out = describeSettings(tenant.paymentSettings);
    for (const k of Object.keys(out.webhooks)) out.webhooks[k] = out.webhooks[k].replace('{tenantId}', String(tenant._id));
    return out;
  }

  /* payOS and Pay2S confirm by themselves; plain VietQR needs the cashier. */
  function defaultMethodOf(settings) {
    return settings.defaultMethod || ['payos', 'pay2s', 'vietqr'].find((m) => settings[m]) || null;
  }

  function newKey(label, internal = false) {
    const secret = KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
    const entry = { id: crypto.randomBytes(6).toString('hex'), label: String(label).slice(0, 60), hash: hashKey(secret), last4: secret.slice(-4), createdAt: now().toISOString(), revokedAt: null, internal };
    return { secret, entry };
  }

  /* ---- API keys for POS devices ---- */

  async function createApiKey(tenantId, { label = 'POS' } = {}) {
    const tenant = await tenantOrFail(tenantId);
    const { secret, entry } = newKey(label);
    const keys = [...(tenant.apiKeys || []), entry];
    await store.tenants.update(tenant._id, { apiKeys: keys, apiKeyHashes: keys.filter((k) => !k.revokedAt).map((k) => k.hash) });
    return { id: entry.id, label: entry.label, key: secret };
  }

  async function revokeApiKey(tenantId, keyId) {
    const tenant = await tenantOrFail(tenantId);
    const keys = (tenant.apiKeys || []).map((k) => (k.id === keyId && !k.revokedAt ? { ...k, revokedAt: now().toISOString() } : k));
    await store.tenants.update(tenant._id, { apiKeys: keys, apiKeyHashes: keys.filter((k) => !k.revokedAt).map((k) => k.hash) });
  }

  async function listApiKeys(tenantId) {
    const tenant = await tenantOrFail(tenantId);
    return (tenant.apiKeys || []).map(({ hash, ...k }) => k);
  }

  /* Resolves a POS bearer key to its shop; suspended shops cannot take payments. */
  async function authenticate(bearer) {
    const key = String(bearer || '').replace(/^Bearer\s+/i, '');
    if (!key.startsWith(KEY_PREFIX)) return null;
    const tenant = await store.tenants.findOne({ apiKeyHashes: hashKey(key) });
    if (!tenant || tenant.suspended) return null;
    return tenant;
  }

  /* ---- providers per shop ---- */

  function providerFor(tenant, method) {
    const s = tenant.paymentSettings || {};
    const cacheKey = String(tenant._id);
    const cached = providerCache.get(cacheKey);
    if (cached && cached.updatedAt === s.updatedAt && cached[method]) return cached[method];
    const entry = cached && cached.updatedAt === s.updatedAt ? cached : { updatedAt: s.updatedAt };
    const key = config.tenantSecretKey;
    if (method === 'payos') {
      if (!s.payos) fail('payment_method_not_configured', 422);
      entry.payos = createPayOSProvider({ clientId: s.payos.clientId, apiKey: open(s.payos.apiKey, key), checksumKey: open(s.payos.checksumKey, key) }, providerOptions.payos);
    } else if (method === 'pay2s') {
      if (!s.pay2s) fail('payment_method_not_configured', 422);
      entry.pay2s = createPay2SProvider({ environment: s.pay2s.environment, accessKey: s.pay2s.accessKey, partnerCode: s.pay2s.partnerCode, secretKey: open(s.pay2s.secretKey, key) }, providerOptions.pay2s);
    } else fail('payment_method_invalid', 422);
    providerCache.set(cacheKey, entry);
    return entry[method];
  }

  /* ---- payments ---- */

  function view(p) {
    return {
      orderCode: p.orderCode, method: p.provider, status: p.status, amount: p.amount, saleRef: p.metadata && p.metadata.saleRef,
      description: p.metadata && p.metadata.description, checkoutUrl: p.checkoutUrl || null, qrPayload: p.qrCode || null,
      bank: (p.metadata && p.metadata.bank) || null, paidAt: p.paidAt || null, createdAt: p.createdAt, expiresAt: p.expiresAt || null,
      qrImageUrl: p.qrCode ? `${config.publicUrl}/api/public/pay/${p.reference}/${p.orderCode}/qr.svg` : null,
      displayUrl: `${config.publicUrl}/pay/${p.reference}/${p.orderCode}`,
    };
  }

  /*
   * Creates (or returns the still-open) payment for a sale. The POS retries
   * on flaky Wi-Fi, so the same saleRef and amount must not produce a second
   * QR the customer could also pay.
   */
  async function createPayment(tenant, { saleRef, amount, method, description }) {
    method = method || defaultMethodOf(tenant.paymentSettings || {}) || 'vietqr';
    if (!METHODS.includes(method)) fail('payment_method_invalid', 422);
    if (typeof saleRef !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(saleRef)) fail('sale_ref_invalid', 422);
    if (!Number.isSafeInteger(amount) || amount <= 0) fail('payment_amount_invalid', 422);
    const reference = String(tenant._id);
    const active = (await store.payments.list({ reference, 'metadata.saleRef': saleRef }))
      .find((p) => [S.PENDING, S.PAID, S.REVIEW].includes(p.status));
    if (active) {
      if (active.amount !== amount || active.provider !== method) {
        if (active.status !== S.PENDING) fail('sale_already_paid', 409);
        await journal.apply({ provider: active.provider, orderCode: active.orderCode, status: S.CANCELLED, eventKey: `superseded:${active.orderCode}` });
      } else return view(active);
    }

    const orderCode = generateOrderCode(now().getTime());
    const text = transferDescription(description || `${tenant.subdomain} ${saleRef}`, { max: 25 });
    let bank = null;
    if (method === 'vietqr') {
      const v = tenant.paymentSettings && tenant.paymentSettings.vietqr;
      if (!v) fail('payment_method_not_configured', 422);
      bank = { bin: v.bin, bankName: v.bankName, accountNumber: v.accountNumber, accountName: v.accountName };
    }
    /* For VietQR the order code leads the transfer content, so a bank
       statement line can be matched back to this payment even when the bank
       truncates the rest. */
    const addInfo = method === 'vietqr' ? transferDescription(`${orderCode} ${text}`, { max: 25 }) : null;
    await journal.open({ orderCode, provider: method, amount, purpose: 'sale', reference, metadata: { saleRef, description: text, transferContent: addInfo, bank } });

    if (method === 'vietqr') {
      const qrPayload = buildVietQR({ bin: bank.bin, accountNumber: bank.accountNumber, amount, addInfo });
      await journal.attachCheckout(orderCode, { providerRef: String(orderCode), qrCode: qrPayload, expiresAt: null });
    } else {
      const provider = providerFor(tenant, method);
      const base = `${config.publicUrl}/pay/${reference}/${orderCode}`;
      const info = await provider.createCheckout({
        orderCode, amount, description: text, returnUrl: `${base}?result=return`, cancelUrl: `${base}?result=cancel`,
        ipnUrl: `${config.publicUrl}/webhooks/shop/${reference}/${method}`,
        expiresAt: new Date(now().getTime() + 15 * 60000).toISOString(),
      });
      await journal.attachCheckout(orderCode, info);
    }
    return view(await journal.get(orderCode));
  }

  async function paymentOf(tenant, orderCode) {
    const p = await journal.get(Number(orderCode));
    if (!p || p.reference !== String(tenant._id) || p.purpose !== 'sale') fail('payment_not_found', 404);
    return p;
  }

  async function getPayment(tenant, orderCode) {
    return view(await paymentOf(tenant, orderCode));
  }

  /* Cashier saw the money arrive (VietQR without a bank feed). */
  async function confirmManually(tenant, orderCode, { by } = {}) {
    const p = await paymentOf(tenant, orderCode);
    if (p.provider !== 'vietqr') fail('manual_confirm_not_allowed', 409);
    const r = await journal.apply({ provider: 'vietqr', orderCode: p.orderCode, status: S.PAID, amount: p.amount, eventKey: `manual:${p.orderCode}`, transactionId: by ? `manual:${String(by).slice(0, 40)}` : 'manual' });
    return view(r.payment);
  }

  async function cancel(tenant, orderCode) {
    const p = await paymentOf(tenant, orderCode);
    if (p.status !== S.PENDING) return view(p);
    if (p.provider === 'payos') {
      await providerFor(tenant, 'payos').cancel(p.orderCode, 'Huy tai quay').catch(() => {});
    }
    const r = await journal.apply({ provider: p.provider, orderCode: p.orderCode, status: S.CANCELLED, eventKey: `cancel:${p.orderCode}` });
    return view(r.payment);
  }

  async function handleCallback(tenantId, method, request) {
    const tenant = await tenantOrFail(tenantId);
    const event = await providerFor(tenant, method).verifyCallback(request);
    const existing = await journal.get(event.orderCode);
    if (!existing || existing.reference !== String(tenant._id)) return { acknowledged: true, ignored: 'unknown_order' };
    const r = await journal.apply(event);
    return { acknowledged: true, status: r.payment.status, ignored: r.ignored };
  }

  /* Public, unauthenticated view for the customer-facing display: amount,
     QR and status only - no sale reference, no shop internals. */
  async function publicView(tenantId, orderCode) {
    const p = await journal.get(Number(orderCode));
    if (!p || p.reference !== String(tenantId) || p.purpose !== 'sale') fail('payment_not_found', 404);
    const tenant = await tenantOrFail(tenantId);
    return { shop: tenant.businessName, orderCode: p.orderCode, amount: p.amount, status: p.status, method: p.provider,
      qrPayload: p.qrCode || null, checkoutUrl: p.checkoutUrl || null, bank: (p.metadata && p.metadata.bank) || null,
      description: (p.metadata && (p.metadata.transferContent || p.metadata.description)) || null };
  }

  return { METHODS, updateSettings, getSettings, createApiKey, revokeApiKey, listApiKeys, authenticate, createPayment, getPayment, confirmManually, cancel, handleCallback, publicView, journal };
}

module.exports = { createCounterService, hashKey, KEY_PREFIX };
