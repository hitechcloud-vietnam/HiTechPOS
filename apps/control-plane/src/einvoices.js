'use strict';

const { buildInvoice, createProvider, createMockProvider, withIssueGuard, EINVOICE_STATUS } = require('@hitechpos/einvoice-vn');
const { isValidTaxCode } = require('@hitechpos/vn-locale');
const { fail } = require('@hitechpos/payment-core');
const { seal, open } = require('./secrets');

/*
 * Vietnamese e-invoices (hoá đơn điện tử) for a shop's sales, issued through
 * the shop's own contract with Viettel S-Invoice, MISA meInvoice or Mắt Bão.
 *
 * Settings live on the tenant (`einvoiceSettings`), with the provider
 * password sealed like every other shop secret. The idempotency guard of
 * @hitechpos/einvoice-vn is backed by store.einvoices, so a sale gets at most
 * one invoice across retries, restarts and several control-plane processes;
 * an unknown outcome blocks re-issue until reconcile() asks the provider.
 */
const PROVIDERS = {
  viettel: { fields: ['username', 'password'], optional: ['supplierTaxCode', 'lookupUrlTemplate'] },
  misa: { fields: ['appId', 'taxCode', 'username', 'password'], optional: ['lookupUrlTemplate'] },
  matbao: { fields: ['taxCode', 'username', 'password'], optional: ['lookupUrlTemplate'] },
  mock: { fields: [], optional: [] },
};
const SECRET_FIELDS = ['password'];

function createEInvoiceService({ store, config, now = () => new Date(), providerOptions = {}, logger = console }) {
  const providerCache = new Map();

  async function tenantOrFail(tenantId) {
    const tenant = await store.tenants.findById(tenantId);
    if (!tenant) fail('tenant_not_found', 404);
    return tenant;
  }

  function describe(s) {
    if (!s) return null;
    const connection = { ...(s.connection || {}) };
    for (const f of SECRET_FIELDS) if (connection[f]) connection[f] = '••••••••';
    return { provider: s.provider, environment: s.environment, connection, seller: s.seller, invoiceType: s.invoiceType,
      series: s.series, fromCashRegister: s.fromCashRegister, autoIssue: s.autoIssue, updatedAt: s.updatedAt };
  }

  async function getSettings(tenantId) {
    return describe((await tenantOrFail(tenantId)).einvoiceSettings);
  }

  async function updateSettings(tenantId, input) {
    const tenant = await tenantOrFail(tenantId);
    if (input === null) {
      await store.tenants.update(tenant._id, { einvoiceSettings: null });
      providerCache.delete(String(tenant._id));
      return null;
    }
    const spec = PROVIDERS[input.provider];
    if (!spec) fail('einvoice_provider_invalid', 422);
    const environment = input.environment === 'production' ? 'production' : 'sandbox';
    const previous = (tenant.einvoiceSettings && tenant.einvoiceSettings.provider === input.provider && tenant.einvoiceSettings.connection) || {};
    const connection = {};
    for (const f of [...spec.fields, ...spec.optional]) {
      let v = input.connection && input.connection[f];
      /* An unchanged secret comes back masked from the console; keep it. */
      if (SECRET_FIELDS.includes(f) && (!v || /^•+$/.test(v))) {
        if (previous[f]) { connection[f] = previous[f]; continue; }
      }
      if (v === undefined || v === null || v === '') {
        if (spec.fields.includes(f)) fail('einvoice_connection_incomplete', 422, { details: { field: f } });
        continue;
      }
      v = String(v).trim();
      connection[f] = SECRET_FIELDS.includes(f) ? seal(v, config.tenantSecretKey) : v;
    }
    const seller = input.seller || {};
    if (!isValidTaxCode(seller.taxCode, { allowBranch: true })) fail('tax_code_invalid', 422);
    if (!String(seller.name || '').trim() || !String(seller.address || '').trim()) fail('einvoice_seller_incomplete', 422);
    const settings = {
      provider: input.provider, environment, connection,
      seller: { taxCode: seller.taxCode.trim(), name: seller.name.trim(), address: seller.address.trim(), phone: seller.phone || undefined, email: seller.email || undefined },
      invoiceType: input.invoiceType === 'BANHANG' ? 'BANHANG' : 'GTGT',
      series: String(input.series || '').trim().toUpperCase(),
      fromCashRegister: input.fromCashRegister !== false,
      autoIssue: !!input.autoIssue,
      updatedAt: now().toISOString(),
    };
    /* Validates series/template against the invoice type up front, so a bad
       setting fails here rather than at the first sale. */
    buildInvoice({ refId: 'settings-check', invoiceType: settings.invoiceType, series: settings.series, fromCashRegister: settings.fromCashRegister,
      issueDate: now(), paymentMethod: 'TM', seller: settings.seller, buyer: {}, lines: [{ name: 'Kiểm tra', unit: 'cái', quantity: 1, unitPrice: 1000, vatRate: 8 }] }, { now });
    await store.tenants.update(tenant._id, { einvoiceSettings: settings });
    providerCache.delete(String(tenant._id));
    return describe(settings);
  }

  function providerFor(tenant) {
    const s = tenant.einvoiceSettings;
    if (!s) fail('einvoice_not_configured', 422);
    const key = String(tenant._id);
    const cached = providerCache.get(key);
    if (cached && cached.updatedAt === s.updatedAt) return cached.provider;
    let base;
    if (s.provider === 'mock') {
      base = createMockProvider({ now });
    } else {
      const conn = { ...s.connection, environment: s.environment };
      for (const f of SECRET_FIELDS) if (conn[f]) conn[f] = open(conn[f], config.tenantSecretKey);
      base = createProvider(s.provider, conn, providerOptions[s.provider]);
    }
    const guardKey = (refId) => `${key}:${refId}`;
    const provider = withIssueGuard(base, {
      store: {
        get: (refId) => store.einvoices.get(guardKey(refId)),
        set: (refId, value) => store.einvoices.set(guardKey(refId), { ...value, tenantId: key, refId, provider: s.provider, updatedAt: now().toISOString() }),
        delete: (refId) => store.einvoices.delete(guardKey(refId)),
      },
    });
    providerCache.set(key, { updatedAt: s.updatedAt, provider });
    return provider;
  }

  /*
   * Issue the invoice for one sale. `sale` carries the lines as sold
   * ({ name, unit, quantity, unitPrice, vatRate, code?, kind? }), whether
   * prices include VAT, how it was paid and the buyer (empty = khách lẻ).
   */
  async function issue(tenant, sale) {
    const s = tenant.einvoiceSettings;
    if (!s) fail('einvoice_not_configured', 422);
    if (typeof sale.refId !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(sale.refId)) fail('sale_ref_invalid', 422);
    const invoice = buildInvoice({
      refId: sale.refId,
      invoiceType: s.invoiceType,
      fromCashRegister: s.fromCashRegister,
      series: s.series,
      issueDate: sale.issueDate ? new Date(sale.issueDate) : now(),
      paymentMethod: sale.paymentMethod || 'TM',
      pricesIncludeVat: sale.pricesIncludeVat !== false,
      seller: s.seller,
      buyer: sale.buyer || {},
      lines: sale.lines,
    }, { now });
    const result = await providerFor(tenant).issue(invoice);
    return { ...result, totals: invoice.totals };
  }

  async function get(tenant, refId) {
    const row = await store.einvoices.get(`${tenant._id}:${refId}`);
    if (!row) fail('einvoice_not_found', 404);
    return { refId, state: row.state, provider: row.provider, ...(row.result || {}) };
  }

  async function reconcile(tenant, refId) {
    return providerFor(tenant).reconcile(refId);
  }

  async function pdf(tenant, refId) {
    const provider = providerFor(tenant);
    if (typeof provider.getPdf !== 'function') fail('einvoice_not_supported', 501);
    return provider.getPdf({ refId });
  }

  async function list(tenantId) {
    return (await store.einvoices.list({ tenantId: String(tenantId) })).map(({ result, ...row }) => ({ ...row, ...(result || {}) }));
  }

  return { PROVIDERS, getSettings, updateSettings, issue, get, reconcile, pdf, list, EINVOICE_STATUS };
}

module.exports = { createEInvoiceService };
