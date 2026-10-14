'use strict';

/*
 * Industry presets for HiTechPOS signup/onboarding.
 *
 * Each vertical lives in src/presets/<id>.js as a plain object whose
 * `features` is a list of enabled keys; this module expands it into the full
 * canonical feature map, validates everything once at load time and deep
 * freezes the result so callers can never mutate shared preset data.
 */

const { FEATURE_KEYS, FEATURE_CATALOG, buildFeatures } = require('./features');

// Values accepted by upstream POST /api/install/add
// (api/src/middleware/install.validation.js). The empty string is also
// accepted upstream but means "unspecified", so presets must not use it.
const POSNIC_BUSINESS_TYPES = Object.freeze([
  'icecream', 'cafe', 'bakery', 'supermarket', 'kirana', 'grocery', 'textile', 'electrical', 'hardware',
]);
// Vietnamese VAT rates; 'KCT' = không chịu thuế (VAT-exempt).
const VAT_RATES = Object.freeze([0, 5, 8, 10, 'KCT']);
const PAYMENT_METHODS = Object.freeze(['cash', 'vietqr', 'payos', 'pay2s', 'card', 'momo', 'zalopay', 'debt']);
const PLANS = Object.freeze(['free', 'basic', 'pro', 'enterprise']);
const APPS = Object.freeze(['pos-web', 'mobile-pos', 'captain', 'business', 'kds']);
const RECEIPT_TEMPLATES = Object.freeze(['k80', 'k58']);

// Display order on the signup screen.
const PRESET_ORDER = Object.freeze([
  'tap-hoa-minimart',
  'cafe-tra-sua',
  'nha-hang-quan-an',
  'karaoke-bida',
  'thoi-trang',
  'nha-thuoc',
  'dien-thoai-dien-may',
  'spa-salon',
  'vat-lieu-xay-dung',
  'me-va-be',
  'my-pham',
  'tiem-banh',
  'sach-van-phong-pham',
  'nong-san-thuc-pham',
  'khac',
]);

const DEFAULT_PRESET_ID = 'khac';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function fail(id, msg) {
  throw new Error(`industry-presets: preset "${id}" ${msg}`);
}

function validate(p) {
  const id = p.id;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id || '')) fail(id, 'has an invalid id');
  for (const field of ['name', 'description', 'icon']) {
    if (typeof p[field] !== 'string' || !p[field].trim()) fail(id, `is missing ${field}`);
  }
  if (!POSNIC_BUSINESS_TYPES.includes(p.posnicBusinessType)) fail(id, `has unknown posnicBusinessType ${p.posnicBusinessType}`);

  const unitCodes = new Set();
  for (const u of p.units) {
    if (!u.code || !u.name) fail(id, 'has a unit without code/name');
    if (unitCodes.has(u.code)) fail(id, `repeats unit ${u.code}`);
    unitCodes.add(u.code);
  }
  for (const u of p.units) {
    for (const c of u.conversions || []) {
      if (!unitCodes.has(c.unit) || c.unit === u.code) fail(id, `unit ${u.code} converts to unknown unit ${c.unit}`);
      if (!Number.isInteger(c.factor) || c.factor < 2) fail(id, `unit ${u.code} has bad factor`);
    }
  }

  if (!Array.isArray(p.categories) || p.categories.length === 0) fail(id, 'has no categories');
  if (p.sampleItems.length < 5 || p.sampleItems.length > 10) fail(id, 'must have 5-10 sample items');
  for (const item of p.sampleItems) {
    if (!item.name) fail(id, 'has a sample item without name');
    if (!unitCodes.has(item.unit)) fail(id, `item "${item.name}" uses unknown unit ${item.unit}`);
    if (!Number.isSafeInteger(item.price) || item.price <= 0) fail(id, `item "${item.name}" has bad price`);
    if (!VAT_RATES.includes(item.vatRate)) fail(id, `item "${item.name}" has bad vatRate`);
    if (!p.categories.includes(item.category)) fail(id, `item "${item.name}" has unknown category ${item.category}`);
  }

  validateTables(p);

  if (!RECEIPT_TEMPLATES.includes(p.receipt.template)) fail(id, 'has bad receipt template');
  if (typeof p.receipt.showVatBreakdown !== 'boolean' || !p.receipt.footer) fail(id, 'has bad receipt');
  if (!p.payments.length || p.payments.some((m) => !PAYMENT_METHODS.includes(m))) fail(id, 'has bad payments');
  if (p.payments.includes('debt') && !p.features.debtLedger.enabled) fail(id, "offers 'debt' payment without debtLedger");
  if (!VAT_RATES.includes(p.vatDefault)) fail(id, 'has bad vatDefault');
  if (!PLANS.includes(p.recommendedPlan)) fail(id, 'has bad recommendedPlan');
  if (!p.recommendedApps.length || p.recommendedApps.some((a) => !APPS.includes(a))) fail(id, 'has bad recommendedApps');
  if (p.recommendedApps.includes('captain') && !p.features.captainApp.enabled) fail(id, 'recommends captain without captainApp');
  if (p.recommendedApps.includes('kds') && !p.features.kds.enabled) fail(id, 'recommends kds without kds feature');
}

// Same limits as Posnic's time billing (upstream/pos/api/src/utils/time-billing.js).
const MAX_HOURLY_RATE = 1000000;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

function validateTables(p) {
  const id = p.id;
  const tables = p.sampleTables || [];
  if (!Array.isArray(tables)) fail(id, 'has bad sampleTables');
  const labels = new Set();
  for (const t of tables) {
    // Posnic table labels: 1-6 letters/digits (frontend/modals/tableorder.html).
    if (!/^[A-Za-z0-9]{1,6}$/.test(t.label || '')) fail(id, `has bad table label ${t.label}`);
    if (labels.has(t.label.toUpperCase())) fail(id, `repeats table ${t.label}`);
    labels.add(t.label.toUpperCase());
    if (t.capacity !== undefined && (!Number.isInteger(t.capacity) || t.capacity < 1 || t.capacity > 1000)) fail(id, `table ${t.label} has bad capacity`);
    if (!t.timeBilling) continue;
    const item = p.sampleItems.find((i) => i.name === t.item);
    if (!item) fail(id, `table ${t.label} bills unknown item ${t.item}`);
    if (item.price > MAX_HOURLY_RATE) fail(id, `table ${t.label} rate is above ${MAX_HOURLY_RATE}`);
    const tb = t.timeBilling;
    const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
    if (!int(tb.blockMinutes, 1, 240) || !int(tb.minBlocks, 1, 96) || !int(tb.graceMinutes, 0, tb.blockMinutes - 1)) {
      fail(id, `table ${t.label} has bad time blocks`);
    }
    for (const b of tb.bands || []) {
      if (!CLOCK.test(b.start) || !CLOCK.test(b.end) || b.start === b.end || b.start === '24:00') fail(id, `table ${t.label} has a bad rate band`);
      if (!int(b.rate, 1, MAX_HOURLY_RATE)) fail(id, `table ${t.label} band rate must be whole VND`);
    }
  }
}

function load(id) {
  const raw = require(`./presets/${id}.js`);
  if (raw.id !== id) fail(id, `file declares id "${raw.id}"`);
  const preset = {
    ...raw,
    features: buildFeatures(raw.features),
    settings: raw.settings || {},
    sampleTables: raw.sampleTables || [],
  };
  validate(preset);
  return deepFreeze(preset);
}

const PRESETS = new Map(PRESET_ORDER.map((id) => [id, load(id)]));

function getPreset(id) {
  const preset = PRESETS.get(id);
  if (!preset) throw new Error(`Unknown industry preset: ${String(id)}`);
  return preset;
}

function hasPreset(id) {
  return PRESETS.has(id);
}

/** Summary list for the signup screen (ordered). */
function listPresets() {
  return PRESET_ORDER.map((id) => {
    const p = PRESETS.get(id);
    return Object.freeze({
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      recommendedPlan: p.recommendedPlan,
      highlights: Object.freeze(FEATURE_KEYS.filter((k) => p.features[k].enabled).map((k) => FEATURE_CATALOG[k].label)),
    });
  });
}

/**
 * Body fields for upstream POST /api/install/add.
 *
 * register_demo defaults to false: upstream demo packs (api/utils/demoData.js)
 * are English-named with Indian pricing, so HiTechPOS seeds the Vietnamese
 * sampleItems itself. Pass { demo: true } to request the upstream pack anyway.
 */
function resolveInstallPayload(id, { demo = false } = {}) {
  const p = getPreset(id);
  return { businessType: p.posnicBusinessType, register_demo: demo === true };
}

/**
 * Explicit Posnic branch settings (the `features` settings group) implied by a
 * preset. Upstream reads an absent module_* key as ON, so every gated switch is
 * written explicitly (see scripts/module-defaults-backfill.js upstream).
 */
function posnicModuleSettings(id) {
  const p = getPreset(id);
  const out = {};
  for (const key of FEATURE_KEYS) {
    const setting = FEATURE_CATALOG[key].posnicSetting;
    if (setting) out[setting] = out[setting] === true || p.features[key].enabled;
  }
  return out;
}

/**
 * Bodies for upstream POST /api/setting/addTableOrderData that create a
 * preset's sample rooms/tables with their time billing. `itemIds` maps a
 * sample item name to the id Posnic gave it when the items were seeded; a
 * table whose item is missing is created without time billing.
 */
function sampleTablePayloads(id, itemIds = {}) {
  const p = getPreset(id);
  return (p.sampleTables || []).map((t) => {
    const body = { tableorder_value: t.label };
    if (t.capacity) Object.assign(body, { capacity: t.capacity, max_capacity: t.capacity });
    if (t.area) body.area = t.area;
    const itemId = t.timeBilling && itemIds[t.item];
    if (itemId) {
      const item = p.sampleItems.find((i) => i.name === t.item);
      body.time_billing = JSON.stringify({
        item_id: String(itemId),
        rate: item.price,
        block_minutes: t.timeBilling.blockMinutes,
        min_blocks: t.timeBilling.minBlocks,
        grace_minutes: t.timeBilling.graceMinutes,
        bands: (t.timeBilling.bands || []).map((b) => ({ start: b.start, end: b.end, rate: b.rate, label: b.label || '' })),
      });
    }
    return body;
  });
}

/** Feature x preset matrix for documentation. */
function featureMatrix() {
  return {
    presets: PRESET_ORDER.slice(),
    rows: FEATURE_KEYS.map((key) => {
      const c = FEATURE_CATALOG[key];
      const presets = {};
      for (const id of PRESET_ORDER) presets[id] = PRESETS.get(id).features[key].enabled;
      return {
        key,
        label: c.label,
        support: c.support,
        posnic: c.posnic,
        hitechExtension: c.hitechExtension,
        presets,
      };
    }),
  };
}

module.exports = {
  FEATURE_KEYS,
  FEATURE_CATALOG,
  POSNIC_BUSINESS_TYPES,
  VAT_RATES,
  PAYMENT_METHODS,
  PLANS,
  APPS,
  RECEIPT_TEMPLATES,
  PRESET_IDS: PRESET_ORDER,
  DEFAULT_PRESET_ID,
  listPresets,
  getPreset,
  hasPreset,
  resolveInstallPayload,
  posnicModuleSettings,
  sampleTablePayloads,
  featureMatrix,
};
