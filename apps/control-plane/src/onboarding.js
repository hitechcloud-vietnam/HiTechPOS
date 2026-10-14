'use strict';

const presets = require('@hitechpos/industry-presets');
const { searchNormalize, CURRENCY_SYMBOL, CURRENCY_CODE, DEFAULT_TIME_ZONE } = require('@hitechpos/vn-locale');
const { nodeHttpTransport } = require('./http-transport');

/*
 * Post-install onboarding: makes a freshly installed Posnic shop Vietnamese
 * and ready for its industry.
 *
 * Everything goes through Posnic's own REST API, signed in as the shop owner,
 * so Posnic's validation, branch/licence scoping, audit fields and sync stamps
 * apply exactly as if the owner had clicked through Settings. The one
 * exception (receipt titles) has no endpoint upstream and is an optional,
 * injected writer - see createMongoBranchPatcher below.
 *
 * Every step:
 *  - is idempotent: it reads current state first and only creates/renames what
 *    is missing, so a re-run never duplicates a tax, tender, unit, category or
 *    item;
 *  - is independent: a failing step is recorded and the next one still runs.
 *
 * run() never throws for a step failure; it returns
 *   { login, locale, taxes, payments, units, categories, items, receipt,
 *     modules, receiptTitles }  each 'ok' | 'skipped' | 'failed: <reason>'.
 *
 * Upstream endpoints used (upstream/pos/api/src/routes/...):
 *   POST /api/users/verify                    users.routes.js (legacyVerifyLogin -> jwt_token)
 *   GET  /api/branches/getOneStore            branches.routes.js
 *   PUT  /api/settings/starterLocale          settings.routes.js (setting.model updateStarterLocale)
 *   GET  /api/settings/getTaxAll              settings.routes.js
 *   POST /api/settings/addTax | editTax       settings.routes.js (validateTax: name 3-20 chars)
 *   GET  /api/settings/getPaymentAll          settings.routes.js
 *   POST /api/settings/addPaymentData         settings.routes.js (validatePayment: 1-12 chars)
 *   GET  /api/settings/getUnitAll             settings.routes.js
 *   POST /api/settings/addUnit | editUnit     settings.routes.js (name 1-20, value 1-6 chars)
 *   GET  /api/categories, POST /api/categories/categoriesImport   categories.routes.js
 *   GET  /api/items, POST /api/items          items.routes.js (item.repository upsertItem)
 *   PUT  /api/settings/group/preferences      settings-groups.routes.js (services/settings-groups.js)
 *   PUT  /api/settings/group/features         settings-groups.routes.js
 */

/* Posnic's tax name limit is 20 characters (constants/settings.constants.js
   TAX_NAME.MAX), so the KCT label is the compact form. It must differ from
   the 0% name: both are rate 0 and the name is the only thing telling a
   cashier (and the e-invoice mapping later) which one applies. */
const KCT_TAX_NAME = 'KCT-Không chịu thuế';
const taxNameFor = (rate) => (rate === 'KCT' ? KCT_TAX_NAME : `Thuế GTGT ${rate}%`);
const VN_TAXES = [0, 5, 8, 10, 'KCT'];
/* What upstream's installer writes (services/install.service.js): "0% Tax",
   "5% Tax", "10% Tax". These are renamed in place, never duplicated. */
const INSTALLER_TAX_NAME = /^\s*\d+(?:\.\d+)?\s*%\s*tax\s*$/i;

/*
 * Tenders. "Cash" and "Card" are deliberately NOT renamed.
 *
 * In Posnic the tender's name is also its protocol key: the till renders a
 * built-in Cash button and looks it up by the literal 'Cash'
 * (frontend/.../sales.js paymentMethodEnabled('Cash')), the register tally
 * sums payment_mode === 'Cash' (services/register.service.js,
 * repositories/register.repository.js), and the Captain app maps names to
 * methods through services/payment-methods.js canonical() which only knows
 * cash/card/upi. Renaming them to "Tiền mặt"/"Thẻ" would silently drop cash
 * from the drawer count and from Captain. The till already shows Cash as
 * "Tiền mặt" through its vi.json pack (lang_cash_title).
 *
 * New tenders are plain manual methods; names fit the 12-character limit.
 * payos/pay2s need gateway credentials and are configured separately; 'debt'
 * is Posnic's credit module (module_credit_enable), not a tender row.
 */
const TENDER_NAMES = Object.freeze({
  cash: 'Cash',
  card: 'Card',
  vietqr: 'Chuyển khoản',
  momo: 'Ví MoMo',
  zalopay: 'ZaloPay',
});
const SKIPPED_TENDERS = new Set(['payos', 'pay2s', 'debt']);

const INSTALLER_FOOTER = 'Thank you for shopping...!';
const SERVICE_UNITS = { gio: 'hour', phut: 'fixed', lan: 'fixed', buoi: 'fixed' };

const STEPS = ['locale', 'taxes', 'payments', 'units', 'categories', 'items', 'receipt', 'modules', 'receiptTitles'];

function createOnboarding({ transport = nodeHttpTransport, shardUrl, shopHeader = 'x-hitech-shop', baseDomain = 'hitechpos.vn', timeoutMs = 30000, branchPatcher = null, logger = console } = {}) {
  if (!shardUrl) throw new Error('createOnboarding: shardUrl is required');
  const base = shardUrl.replace(/\/+$/, '');

  async function run({ tenant, owner, preset }) {
    const p = typeof preset === 'object' && preset ? preset : presets.getPreset(preset || tenant.industry || presets.DEFAULT_PRESET_ID);
    const report = { preset: p.id };
    const shop = `${tenant.subdomain}.${baseDomain}`;
    let token = null;

    async function api(method, path, body) {
      const res = await transport(`${base}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'content-type': 'application/json',
          [shopHeader]: shop,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.type === 'error' || json.success === false || json.status === 'error') {
        const detail = json && (json.message || (json.data && json.data.rejected && `rejected ${json.data.rejected}`));
        const e = new Error(`${method} ${path.split('?')[0]} -> ${res.status}${detail ? ` ${String(detail).slice(0, 120)}` : ''}`);
        e.status = res.status;
        throw e;
      }
      return json.data;
    }

    let branchId = null;
    try {
      const data = await api('POST', '/api/users/verify', { username: owner.email, password: owner.password });
      token = data && data.jwt_token;
      branchId = data && data.branchId;
      if (!token) throw new Error('login returned no token');
      report.login = 'ok';
    } catch (e) {
      report.login = `failed: ${e.message}`;
      for (const s of STEPS) report[s] = 'failed: login';
      return report;
    }

    const ctx = { api, preset: p, tenant, branchId };
    for (const name of STEPS) {
      try {
        report[name] = (await STEP_IMPL[name](ctx)) || 'ok';
      } catch (e) {
        report[name] = `failed: ${String(e.message || e).slice(0, 200)}`;
        logger.warn?.(`[onboarding] ${tenant.subdomain} ${name}: ${e.message}`);
      }
    }
    return report;
  }

  const STEP_IMPL = {
    /* The installer already sets VND/Asia/Ho_Chi_Minh from register_country;
       this re-asserts it (through the same starter-locale endpoint the first-
       run wizard uses) only when something drifted. Currency precision in
       Posnic follows the ISO code found in currency_text (utils/currency.js
       policy(): 'VND' -> 0 decimals), so 'VND' must stay in that text. */
    async locale({ api }) {
      const b = await api('GET', '/api/branches/getOneStore');
      const good = b && b.time_zone === DEFAULT_TIME_ZONE && b.currency_type === CURRENCY_SYMBOL
        && /\bVND\b/.test(String(b.currency_text || '')) && b.client_dateformat === 'dd/mm/yyyy';
      if (good) return 'ok';
      await api('PUT', '/api/settings/starterLocale', {
        setting_country: 'Vietnam',
        country_id: (b && b.country_id) || 'VN',
        setting_state: (b && b.state) || '',
        currencyText: CURRENCY_SYMBOL,
        currencyTextname: CURRENCY_CODE,
        currency_setting: `Vietnam Dong / ${CURRENCY_CODE} or ${CURRENCY_SYMBOL}`,
        time_zone: DEFAULT_TIME_ZONE,
        storedate: 'dd/mm/yyyy',
        serverdate: 'd/m/Y',
        dateText: '01/01/2018 -- dd/mm/yyyy',
      });
      return 'ok';
    },

    async taxes({ api }) {
      const list = (await api('GET', '/api/settings/getTaxAll?tax_group=no')) || [];
      const claimed = new Set();
      for (const rate of VN_TAXES) {
        const name = taxNameFor(rate);
        const have = list.find((t) => t.tax_name === name);
        if (have) { claimed.add(have.tax_id); continue; }
        const english = rate === 'KCT' ? null : list.find((t) => !claimed.has(t.tax_id) && Number(t.tax_value) === rate && INSTALLER_TAX_NAME.test(t.tax_name));
        const value = String(rate === 'KCT' ? 0 : rate);
        if (english) {
          await api('POST', '/api/settings/editTax', { tax_id: english.tax_id, tax_name: name, tax_value: value });
          claimed.add(english.tax_id);
        } else {
          await api('POST', '/api/settings/addTax', { tax_name: name, tax_value: value });
        }
      }
      return 'ok';
    },

    async payments({ api, preset }) {
      const rows = (await api('GET', '/api/settings/getPaymentAll')) || [];
      const have = new Set(rows.map((r) => String(r.payment_value).trim().toLowerCase()));
      for (const method of preset.payments) {
        if (SKIPPED_TENDERS.has(method)) continue;
        const name = TENDER_NAMES[method];
        if (!name || have.has(name.toLowerCase())) continue;
        await api('POST', '/api/settings/addPaymentData', { payment_value: name });
        have.add(name.toLowerCase());
      }
      return 'ok';
    },

    /* Unit 'qty' is Posnic's fallback unit for any item saved without one
       (item.repository upsertItem: unit || 'qty'), so only its label is
       translated; the value stays. Preset units use their code as value
       (<= 6 chars, Posnic's limit). Conversions (1 thùng = 24 lon) are per
       item in Posnic (purchase_unit + conversion_factor) and are not seeded. */
    async units({ api, preset }) {
      const units = (await api('GET', '/api/settings/getUnitAll')) || [];
      const qty = units.find((u) => u.unit_value === 'qty' && u.unit_name === 'Quantity');
      if (qty) await api('POST', '/api/settings/editUnit', { unit_id: qty.unit_id, unit_name: 'Số lượng', unit_value: 'qty' });
      const values = new Set(units.map((u) => u.unit_value));
      for (const u of preset.units) {
        if (values.has(u.code)) continue;
        await api('POST', '/api/settings/addUnit', { unit_name: u.name, unit_value: u.code });
        values.add(u.code);
      }
      return 'ok';
    },

    /* Through Posnic's category import (the Settings CSV import), not
       POST /api/categories: the create validator only accepts
       /^[a-zA-Z0-9\s\-_&()]+$/ (constants/categories.constants.js
       VALIDATION_PATTERNS.NAME), which refuses every Vietnamese letter -
       "Cà phê" is "invalid characters". The import path runs the same
       service with per-name de-duplication (category.service bulkImport) and
       no ASCII-only rule. */
    async categories({ api, preset }) {
      const existing = await listAll(api, '/api/categories');
      const names = new Set(existing.map((c) => searchNormalize(c.name)));
      const missing = preset.categories
        .map((name, i) => ({ name, discount_amount: '0', discount_percentage: '0', sort_order: i + 1 }))
        .filter((c) => !names.has(searchNormalize(c.name)));
      if (missing.length) await api('POST', '/api/categories/categoriesImport', { categories: missing });
      return 'ok';
    },

    async items({ api, preset }) {
      const [existing, taxes, units, categories] = await Promise.all([
        listAll(api, '/api/items'),
        api('GET', '/api/settings/getTaxAll?tax_group=no'),
        api('GET', '/api/settings/getUnitAll'),
        listAll(api, '/api/categories'),
      ]);
      const have = new Set(existing.map((i) => searchNormalize(i.name)));
      const presetIndex = presets.PRESET_IDS.indexOf(preset.id);
      const failures = [];
      for (const [idx, item] of preset.sampleItems.entries()) {
        if (have.has(searchNormalize(item.name))) continue;
        try {
          const tax = findTax(taxes || [], item.vatRate);
          if (!tax) throw new Error(`no tax for ${item.vatRate}`);
          const unit = (units || []).find((u) => u.unit_value === item.unit);
          const category = pickCategory(item, categories);
          const serviceUnit = SERVICE_UNITS[item.unit];
          await api('POST', '/api/items', {
            name: item.name,
            barcode_id: item.barcode || internalBarcode(presetIndex, idx),
            selling_price: String(item.price),
            mrp_price: String(item.price),
            company_price: '0',
            available_quantity: '0',
            unit: unit ? unit.unit_value : 'qty',
            unit_id: unit ? unit.unit_id : '',
            category_id: category ? String(category._id) : '',
            category_name: category ? category.name : '',
            // Vietnamese shelf prices include VAT.
            tax_method: 'default',
            tax_id: tax.tax_id,
            tax_name: tax.tax_name,
            tax: Number(tax.tax_value) || 0,
            tax_type: 'inclusive',
            inventory: false,
            item_kind: serviceUnit ? 'service' : 'product',
            ...(serviceUnit ? { service_unit: serviceUnit } : {}),
          });
          have.add(searchNormalize(item.name));
        } catch (e) {
          failures.push(`${item.name}: ${e.message}`);
        }
      }
      if (failures.length) throw new Error(`${failures.length}/${preset.sampleItems.length} items: ${failures[0]}`);
      return 'ok';
    },

    /* Receipt footer, whole-đồng rounding and the default tax for new items.
       A footer the owner already changed is left alone; only the installer's
       English default (or an empty one) is replaced. */
    async receipt({ api, preset }) {
      const [prefs, taxes] = await Promise.all([
        api('GET', '/api/settings/group/preferences'),
        api('GET', '/api/settings/getTaxAll?tax_group=no'),
      ]);
      const values = (prefs && prefs.values) || {};
      const patch = { roundOff: true };
      const footer = String(values.footer_print || '').trim();
      if (!footer || footer === INSTALLER_FOOTER) patch.footer_print = preset.receipt.footer;
      const tax = findTax(taxes || [], preset.vatDefault);
      if (tax) patch.default_tax = tax.tax_id;
      await api('PUT', '/api/settings/group/preferences', patch);
      return tax ? 'ok' : 'failed: default tax not found';
    },

    /* Posnic reads an absent module_* key as ON, so every switch is written.
       module_channels_enable is the parent switch the Settings screen derives
       from its children (frontend settings.js); it is derived the same way. */
    async modules({ api, preset }) {
      const s = presets.posnicModuleSettings(preset.id);
      const channels = Boolean(s.module_online_ordering_enable || s.module_captain_enable || s.module_delivery_partners_enable);
      await api('PUT', '/api/settings/group/features', { ...s, module_channels_enable: channels });
      return 'ok';
    },

    async receiptTitles({ tenant, branchId }) {
      if (!branchPatcher) return 'skipped';
      await branchPatcher.patchReceiptTitles({ tenant, branchId });
      return 'ok';
    },
  };

  return { run };
}

async function listAll(api, path) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const data = await api('GET', `${path}?limit=100&page=${page}`);
    const list = (data && data.list) || [];
    out.push(...list);
    if (!list.length || page >= Number(data.total_pages || 1)) break;
  }
  return out;
}

function findTax(taxes, rate) {
  const byName = taxes.find((t) => t.tax_name === taxNameFor(rate));
  if (byName) return byName;
  if (rate === 'KCT') return null;
  return taxes.find((t) => Number(t.tax_value) === rate && t.tax_name !== KCT_TAX_NAME) || null;
}

/* Sample items carry no category in the preset, so one is inferred from shared
   words ("Cà phê sữa đá" -> "Cà phê"); an explicit item.category wins.
   Matching keeps the diacritics - "có" (has) is not "cồn" and "quả" is not
   "qua" - and ignores filler words. Ties go to the earlier category; no
   overlap leaves the item uncategorised, which Posnic allows. */
const CATEGORY_STOPWORDS = new Set(['có', 'và', 'ăn', 'liền', 'các', 'loại', 'đồ', 'nước', 'bánh', 'điện', 'quả']);
const words = (s) => String(s).normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !CATEGORY_STOPWORDS.has(w));
function pickCategory(item, categories) {
  if (item.category) return categories.find((c) => searchNormalize(c.name) === searchNormalize(item.category)) || null;
  const own = new Set(words(item.name));
  let best = null;
  let bestScore = 0;
  for (const c of categories) {
    const score = words(c.name).filter((w) => own.has(w)).length;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

/* Deterministic in-store EAN-13 for sample items the preset gives no barcode.
   Prefix 29 (GS1 restricted circulation, in-store) keeps them apart from the
   preset's own 20-prefixed codes and from manufacturer GTINs. */
function internalBarcode(presetIndex, itemIndex) {
  const body = `29${String(Math.max(presetIndex, 0)).padStart(3, '0')}${String(itemIndex + 1).padStart(7, '0')}`;
  const sum = body.split('').reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

/*
 * RAW DB WRITE, justified: Posnic has no endpoint that writes
 * branches.print_controls (searched routes/ and controllers/: it is written
 * only by the installer, services/install.service.js), yet its four titles are
 * printed on every receipt in English ("SALES RECEIPT"). This writer touches
 * only those four keys, only while they still hold the installer's English
 * text (an owner's own wording is never overwritten), and stamps
 * updated_date because the sync gateway only ships branch rows whose
 * updated_date moved (see setting.model.js "STAMP IT, OR THE TILL NEVER
 * LEARNS").
 *
 * "Phiếu" rather than "Hóa đơn": a hóa đơn is the legal (e-)invoice, which this
 * till receipt is not.
 */
const RECEIPT_TITLES = Object.freeze({
  sale_title: ['SALES RECEIPT', 'PHIẾU THANH TOÁN'],
  sale_return_title: ['SALES RETURN RECEIPT', 'PHIẾU TRẢ HÀNG'],
  receiving_title: ['PURCHASE INVOICE', 'PHIẾU NHẬP HÀNG'],
  receiving_return_title: ['PURCHASE RETURN INVOICE', 'PHIẾU TRẢ HÀNG NHẬP'],
});
const TITLE_STYLE = 'font-size: 14px !important;font-weight: 900;';

function createMongoBranchPatcher({ client }) {
  return {
    async patchReceiptTitles({ tenant, branchId }) {
      const { ObjectId } = require('mongodb');
      const branches = client.db(tenant.tenantDb).collection('branches');
      const filter = branchId && ObjectId.isValid(branchId) ? { _id: new ObjectId(branchId) } : {};
      const branch = await branches.findOne(filter, { projection: { print_controls: 1 } });
      if (!branch) throw new Error('branch not found');
      const current = branch.print_controls || {};
      const set = {};
      for (const [key, [english, vietnamese]] of Object.entries(RECEIPT_TITLES)) {
        const text = String(current[key] || '').replace(/<[^>]*>/g, '').trim();
        if (text === '' || text === english) set[`print_controls.${key}`] = `<span style="${TITLE_STYLE}">${vietnamese}</span>`;
      }
      if (!Object.keys(set).length) return { written: 0 };
      set.updated_date = new Date();
      await branches.updateOne({ _id: branch._id }, { $set: set });
      return { written: Object.keys(set).length - 1 };
    },
  };
}

module.exports = { createOnboarding, createMongoBranchPatcher, taxNameFor, internalBarcode, pickCategory, KCT_TAX_NAME, TENDER_NAMES, RECEIPT_TITLES };
