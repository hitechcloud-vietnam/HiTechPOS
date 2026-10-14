'use strict';

const express = require('express');
const { TAX_TABLE, GROUP_IDS, NOTICE } = require('./tax-ledger-config');
const { parsePeriod, ledgerFromShopDb, createGroupResolver, categoryKey, httpError, fold } = require('./tax-ledger');
const { toCsv, toHtml } = require('./tax-ledger-export');

/*
 * Owner endpoints of the revenue book / tax summary ("Sổ sách & báo cáo thuế").
 *
 * The router sits behind app.js's owner `auth` middleware, which verifies the
 * session JWT and sets req.account = { sub, tenantId }. The shop is ALWAYS
 * req.account.tenantId: no route takes a tenant from the URL, query or body,
 * so an owner can only ever read and change their own shop. Mounted without
 * auth it answers 401 to everything.
 *
 *   GET  /                 ?period=2026-10|2026-Q4|2026 [&detail=day|sale]  -> ledger JSON
 *   GET  /export.csv       same query [&sep=semicolon]                      -> CSV (UTF-8 BOM)
 *   GET  /export.html      same query                                       -> printable A4 page
 *   GET  /settings                                                          -> group mapping
 *   PUT  /settings         { defaultGroup?, chargeGroup?, categoryGroups?: [{ key, name?, group }] }
 *
 * The shop database comes from `tenantDb(tenant)` when given, else from
 * store.shopBridge.shopDb(tenant) (store/mongo.js). Without either (memory
 * store) the ledger endpoints answer 501.
 */

const MAX_CATEGORY_ROWS = 1000;
const STATUS_ERRORS = {
  unauthorized: 'Vui lòng đăng nhập.',
  tenant_not_found: 'Không tìm thấy cửa hàng.',
  tax_ledger_unavailable: 'Sổ sách chưa sẵn sàng trên máy chủ này.',
  shop_not_ready: 'Cửa hàng chưa khởi tạo xong dữ liệu bán hàng.',
  tax_settings_invalid: 'Cấu hình nhóm ngành nghề không hợp lệ.',
};
const fail = (code, status) => { throw httpError(code, status, STATUS_ERRORS[code]); };

/* ASCII-only file name for content-disposition. */
const safeName = (s) => String(s || '').replace(/[^A-Za-z0-9_.-]/g, '-').replace(/-+/g, '-').slice(0, 80);

function groupsView() {
  return GROUP_IDS.map((id) => {
    const g = TAX_TABLE.groups[id];
    return { id, column: g.column, label: g.label, gtgtRateBp: g.gtgtBp, tncnRateBp: g.tncnBp };
  });
}

function validGroup(v) {
  return v === undefined || v === null || v === '' || GROUP_IDS.includes(v);
}

function createTaxLedgerRouter({ store, tenantDb, now = () => new Date() } = {}) {
  if (!store || !store.tenants) throw new TypeError('createTaxLedgerRouter needs store');
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('cache-control', 'no-store');
    if (!req.account || !req.account.tenantId) return next(httpError('unauthorized', 401, STATUS_ERRORS.unauthorized));
    next();
  });

  async function tenantOf(req) {
    const tenant = await store.tenants.findById(req.account.tenantId);
    if (!tenant) fail('tenant_not_found', 404);
    return tenant;
  }

  async function dbOf(tenant) {
    const bridge = store.shopBridge;
    const open = tenantDb || (bridge && typeof bridge.shopDb === 'function' ? (t) => bridge.shopDb(t) : null);
    if (!open) fail('tax_ledger_unavailable', 501);
    if (!tenant.tenantDb || tenant.provisioned === false) fail('shop_not_ready', 409);
    return open(tenant);
  }

  async function ledgerFor(req) {
    const period = parsePeriod(req.query.period);
    const tenant = await tenantOf(req);
    const db = await dbOf(tenant);
    const ledger = await ledgerFromShopDb({ db, tenant, period, now: now(), detail: req.query.detail === 'sale' ? 'sale' : 'day' });
    return { tenant, ledger };
  }

  const fileBase = (tenant, ledger) => safeName(`so-doanh-thu-S1-HKD-${tenant.subdomain || 'shop'}-${ledger.period.key}`);

  router.get('/', async (req, res) => {
    const { ledger } = await ledgerFor(req);
    res.json(ledger);
  });

  router.get('/export.csv', async (req, res) => {
    const { tenant, ledger } = await ledgerFor(req);
    const separator = req.query.sep === 'semicolon' ? ';' : ',';
    res.set('content-disposition', `attachment; filename="${fileBase(tenant, ledger)}.csv"`);
    res.type('text/csv; charset=utf-8').send(toCsv(ledger, { separator }));
  });

  router.get('/export.html', async (req, res) => {
    const { tenant, ledger } = await ledgerFor(req);
    res.set('content-disposition', `attachment; filename="${fileBase(tenant, ledger)}.html"`);
    res.type('text/html; charset=utf-8').send(toHtml(ledger));
  });

  /* Categories of the shop (Posnic `categories`, plus any category only seen
     on items) with the group each one currently maps to. */
  async function settingsView(tenant) {
    const settings = tenant.taxLedgerSettings || {};
    let categories = [];
    let items = [];
    let dataAvailable = true;
    try {
      const db = await dbOf(tenant);
      [categories, items] = await Promise.all([
        db.collection('categories').find({}, { projection: { _id: 1, name: 1 } }).toArray(),
        db.collection('items').find({}, { projection: { _id: 1, category_id: 1, category_name: 1, item_kind: 1 } }).toArray(),
      ]);
    } catch (e) {
      if (!e || !['tax_ledger_unavailable', 'shop_not_ready'].includes(e.code)) throw e;
      dataAvailable = false;
    }
    const resolver = createGroupResolver({ industry: tenant.industry, settings, items });
    const seen = new Map();
    const add = (id, name) => {
      const key = categoryKey(id, name);
      if (key === 'none' || seen.has(key)) return;
      /* the same category may appear once by id and once by name */
      if (!String(id || '').trim() && [...seen.values()].some((c) => fold(c.name) === fold(name))) return;
      seen.set(key, { key, name: String(name || '').trim() });
    };
    for (const c of categories) add(c._id && (c._id.toHexString ? c._id.toHexString() : String(c._id)), c.name);
    for (const it of items) if (it.category_id || it.category_name) add(it.category_id, it.category_name);
    for (const row of Array.isArray(settings.categoryGroups) ? settings.categoryGroups : []) if (row && row.key !== 'none' && !seen.has(row.key)) seen.set(row.key, { key: row.key, name: row.name || row.key });
    const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    list.push({ key: 'none', name: 'Chưa phân loại' });
    return {
      notice: NOTICE,
      dataAvailable,
      industry: tenant.industry || null,
      presetGroup: resolver.presetGroup,
      defaultGroup: GROUP_IDS.includes(settings.defaultGroup) ? settings.defaultGroup : null,
      chargeGroup: GROUP_IDS.includes(settings.chargeGroup) ? settings.chargeGroup : null,
      effectiveDefaultGroup: resolver.defaultGroup,
      effectiveChargeGroup: resolver.chargeGroup,
      groups: groupsView(),
      threshold: TAX_TABLE.annualThreshold,
      tableVersion: TAX_TABLE.version,
      categories: list.map((c) => {
        const d = resolver.describeCategory(c.key, c.name);
        return { ...c, group: d.group, source: d.source, presetGroup: resolver.presetCategory(c.name) };
      }),
      updatedAt: settings.updatedAt || null,
    };
  }

  router.get('/settings', async (req, res) => {
    res.json(await settingsView(await tenantOf(req)));
  });

  router.put('/settings', async (req, res) => {
    const tenant = await tenantOf(req);
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (!validGroup(b.defaultGroup) || !validGroup(b.chargeGroup)) fail('tax_settings_invalid', 422);
    const rows = b.categoryGroups === undefined ? ((tenant.taxLedgerSettings || {}).categoryGroups || []) : b.categoryGroups;
    if (!Array.isArray(rows) || rows.length > MAX_CATEGORY_ROWS) fail('tax_settings_invalid', 422);
    const byKey = new Map();
    for (const r of rows) {
      if (!r || typeof r !== 'object' || typeof r.key !== 'string') fail('tax_settings_invalid', 422);
      const key = r.key.trim();
      if (!key || key.length > 200 || !validGroup(r.group)) fail('tax_settings_invalid', 422);
      if (r.name !== undefined && r.name !== null && (typeof r.name !== 'string' || r.name.length > 200)) fail('tax_settings_invalid', 422);
      if (!r.group) { byKey.delete(key); continue; } // back to the default
      /* 'none' (no category) has no name to match on */
      byKey.set(key, { key, ...(r.name && key !== 'none' ? { name: r.name.trim() } : {}), group: r.group });
    }
    const pick = (v, prev) => (v === undefined ? prev || null : v || null);
    const prev = tenant.taxLedgerSettings || {};
    const settings = {
      defaultGroup: pick(b.defaultGroup, prev.defaultGroup),
      chargeGroup: pick(b.chargeGroup, prev.chargeGroup),
      categoryGroups: [...byKey.values()],
      updatedAt: now().toISOString(),
    };
    const saved = await store.tenants.update(tenant._id, { taxLedgerSettings: settings });
    res.json(await settingsView(saved || { ...tenant, taxLedgerSettings: settings }));
  });

  return router;
}

module.exports = { createTaxLedgerRouter };
