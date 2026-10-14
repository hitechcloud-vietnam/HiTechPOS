'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const presets = require('../src/index.js');
const {
  FEATURE_KEYS,
  FEATURE_CATALOG,
  POSNIC_BUSINESS_TYPES,
  VAT_RATES,
  PAYMENT_METHODS,
  PLANS,
  APPS,
  PRESET_IDS,
} = presets;

const REQUIRED_IDS = [
  'tap-hoa-minimart', 'cafe-tra-sua', 'nha-hang-quan-an', 'karaoke-bida', 'thoi-trang', 'nha-thuoc',
  'dien-thoai-dien-may', 'spa-salon', 'vat-lieu-xay-dung', 'me-va-be', 'my-pham', 'tiem-banh',
  'sach-van-phong-pham', 'nong-san-thuc-pham', 'khac',
];

// Upstream allowed list, copied from api/src/middleware/install.validation.js.
const UPSTREAM_BUSINESS_TYPES = ['icecream', 'cafe', 'bakery', 'supermarket', 'kirana', 'grocery', 'textile', 'electrical', 'hardware'];

const all = () => PRESET_IDS.map((id) => presets.getPreset(id));

function ean13Valid(code) {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

test('covers every required vertical with unique ids', () => {
  assert.equal(new Set(PRESET_IDS).size, PRESET_IDS.length);
  for (const id of REQUIRED_IDS) assert.ok(presets.hasPreset(id), id);
  const listed = presets.listPresets().map((p) => p.id);
  assert.deepEqual(listed, PRESET_IDS);
});

test('every preset file in src/presets is registered', () => {
  const files = fs.readdirSync(path.join(__dirname, '..', 'src', 'presets')).map((f) => f.replace(/\.js$/, ''));
  assert.deepEqual(files.sort(), PRESET_IDS.slice().sort());
});

test('posnicBusinessType is an allowed upstream value', () => {
  assert.deepEqual(POSNIC_BUSINESS_TYPES.slice().sort(), UPSTREAM_BUSINESS_TYPES.slice().sort());
  for (const p of all()) assert.ok(UPSTREAM_BUSINESS_TYPES.includes(p.posnicBusinessType), p.id);
});

test('feature maps use exactly the canonical FEATURE_KEYS', () => {
  assert.equal(new Set(FEATURE_KEYS).size, FEATURE_KEYS.length);
  for (const p of all()) {
    assert.deepEqual(Object.keys(p.features), FEATURE_KEYS, p.id);
    for (const key of FEATURE_KEYS) {
      const f = p.features[key];
      assert.deepEqual(Object.keys(f).sort(), ['enabled', 'hitechExtension', 'posnic']);
      assert.equal(typeof f.enabled, 'boolean');
      assert.equal(f.posnic, FEATURE_CATALOG[key].posnic);
      assert.equal(f.hitechExtension, FEATURE_CATALOG[key].hitechExtension);
    }
  }
});

test('catalog is internally consistent', () => {
  for (const key of FEATURE_KEYS) {
    const c = FEATURE_CATALOG[key];
    assert.ok(c.label, key);
    if (c.support === 'native') {
      assert.equal(c.hitechExtension, false, key);
      assert.ok(c.posnic, `${key} native needs posnic`);
    } else {
      assert.equal(c.hitechExtension, true, key);
    }
    if (c.support === 'extension') assert.equal(c.posnic, null, key);
    if (c.support === 'partial') assert.ok(c.posnic, key);
  }
});

test('sample items have realistic positive integer VND prices and allowed VAT', () => {
  for (const p of all()) {
    assert.ok(p.sampleItems.length >= 5 && p.sampleItems.length <= 10, p.id);
    const units = new Set(p.units.map((u) => u.code));
    for (const item of p.sampleItems) {
      assert.ok(Number.isInteger(item.price) && item.price > 0, item.name);
      assert.ok(item.price >= 1000 && item.price % 100 === 0, `${item.name} price looks unrealistic`);
      assert.ok(VAT_RATES.includes(item.vatRate), item.name);
      assert.ok(units.has(item.unit), `${p.id}: ${item.name} unit`);
      if (item.barcode !== undefined) assert.ok(ean13Valid(item.barcode), `${item.name} barcode`);
    }
    assert.ok(VAT_RATES.includes(p.vatDefault), p.id);
  }
});

test('unit conversions point at units of the same preset', () => {
  for (const p of all()) {
    const codes = new Set(p.units.map((u) => u.code));
    for (const u of p.units) {
      for (const c of u.conversions || []) {
        assert.ok(codes.has(c.unit), `${p.id}:${u.code}->${c.unit}`);
        assert.ok(Number.isInteger(c.factor) && c.factor > 1);
      }
    }
  }
});

test('receipt, payments, plan and apps use allowed values', () => {
  for (const p of all()) {
    assert.ok(['k80', 'k58'].includes(p.receipt.template));
    assert.equal(typeof p.receipt.showVatBreakdown, 'boolean');
    assert.match(p.receipt.footer, /cảm ơn/i);
    assert.ok(p.payments.every((m) => PAYMENT_METHODS.includes(m)), p.id);
    assert.ok(p.payments.includes('cash') && p.payments.includes('vietqr'), p.id);
    assert.ok(PLANS.includes(p.recommendedPlan));
    assert.ok(p.recommendedApps.every((a) => APPS.includes(a)));
    assert.ok(p.recommendedApps.includes('pos-web'));
  }
});

test('vertical-specific capabilities are switched on', () => {
  const on = (id, key) => presets.getPreset(id).features[key].enabled;
  assert.ok(on('tap-hoa-minimart', 'weighing') && on('tap-hoa-minimart', 'unitConversion') && on('tap-hoa-minimart', 'debtLedger'));
  assert.ok(on('cafe-tra-sua', 'modifiers') && on('cafe-tra-sua', 'cupLabels') && on('cafe-tra-sua', 'tables'));
  assert.ok(on('nha-hang-quan-an', 'kds') && on('nha-hang-quan-an', 'captainApp') && on('nha-hang-quan-an', 'mergeSplitTables'));
  assert.ok(on('karaoke-bida', 'hourlyBilling'));
  assert.ok(on('thoi-trang', 'variants') && on('thoi-trang', 'returns'));
  assert.ok(on('nha-thuoc', 'fefo') && on('nha-thuoc', 'prescriptions') && on('nha-thuoc', 'nationalPharmacyLink'));
  assert.ok(on('dien-thoai-dien-may', 'serialImei') && on('dien-thoai-dien-may', 'warranty') && on('dien-thoai-dien-may', 'installments'));
  assert.ok(on('spa-salon', 'appointments') && on('spa-salon', 'commissions') && on('spa-salon', 'servicePackages'));
  assert.ok(on('tiem-banh', 'recipes') && on('tiem-banh', 'preorders'));
  assert.ok(on('nong-san-thuc-pham', 'weighing') && on('nong-san-thuc-pham', 'wastage'));
  assert.equal(on('khac', 'tables'), false);
});

test('Vietnamese strings carry diacritics', () => {
  for (const p of all()) {
    assert.match(`${p.name} ${p.description}`, /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i, p.id);
  }
});

test('getPreset throws on unknown id and returns deep-frozen objects', () => {
  assert.throws(() => presets.getPreset('khong-ton-tai'), /Unknown industry preset/);
  assert.throws(() => presets.getPreset(undefined), /Unknown industry preset/);
  const p = presets.getPreset('cafe-tra-sua');
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.features));
  assert.ok(Object.isFrozen(p.features.modifiers));
  assert.ok(Object.isFrozen(p.sampleItems));
  assert.ok(Object.isFrozen(p.sampleItems[0]));
  assert.ok(Object.isFrozen(p.units[0]));
  assert.ok(Object.isFrozen(p.receipt));
  assert.throws(() => { 'use strict'; p.features.modifiers.enabled = false; }, TypeError);
  assert.throws(() => { 'use strict'; p.sampleItems.push({}); }, TypeError);
  assert.ok(Object.isFrozen(FEATURE_KEYS));
  assert.ok(Object.isFrozen(FEATURE_CATALOG.tables));
});

test('resolveInstallPayload maps to the upstream installer body', () => {
  assert.deepEqual(presets.resolveInstallPayload('tiem-banh'), { businessType: 'bakery', register_demo: false });
  assert.deepEqual(presets.resolveInstallPayload('thoi-trang', { demo: true }), { businessType: 'textile', register_demo: true });
  for (const id of PRESET_IDS) {
    const body = presets.resolveInstallPayload(id);
    assert.ok(UPSTREAM_BUSINESS_TYPES.includes(body.businessType));
    assert.equal(typeof body.register_demo, 'boolean');
  }
  assert.throws(() => presets.resolveInstallPayload('nope'));
});

test('posnicModuleSettings writes explicit booleans for upstream switches', () => {
  const s = presets.posnicModuleSettings('nha-hang-quan-an');
  assert.equal(s.module_captain_enable, true);
  assert.equal(s.custom_charges_enable, true);
  assert.equal(s.hardware_weight_machine_enable, false);
  assert.ok(!('module_einvoice_enable' in s), 'upstream e-invoice switch is India-only');
  assert.equal(presets.posnicModuleSettings('tap-hoa-minimart').module_credit_enable, true);
  for (const v of Object.values(s)) assert.equal(typeof v, 'boolean');
});

test('featureMatrix covers every key and preset', () => {
  const m = presets.featureMatrix();
  assert.deepEqual(m.presets, PRESET_IDS);
  assert.deepEqual(m.rows.map((r) => r.key), FEATURE_KEYS);
  for (const row of m.rows) assert.deepEqual(Object.keys(row.presets), PRESET_IDS);
  // Every feature is used by at least one vertical.
  for (const row of m.rows) assert.ok(Object.values(row.presets).some(Boolean), row.key);
});

test('listPresets returns a lightweight summary', () => {
  const list = presets.listPresets();
  for (const item of list) {
    assert.deepEqual(Object.keys(item).sort(), ['description', 'highlights', 'icon', 'id', 'name', 'recommendedPlan']);
    assert.ok(item.highlights.length > 0);
  }
});

test('karaoke/bida sample rooms and tables bill time the way the till prices it', () => {
  // Contract with the Posnic patch: the settings these payloads write must be
  // accepted by upstream/pos/api/src/utils/time-billing.js (test-only import).
  const timeBilling = require('../../../upstream/pos/api/src/utils/time-billing.js');
  const p = presets.getPreset('karaoke-bida');
  assert.ok(p.sampleTables.length >= 2);
  const ids = Object.fromEntries(p.sampleItems.map((item, i) => [item.name, String(i + 1).padStart(24, '0')]));
  const bodies = presets.sampleTablePayloads('karaoke-bida', ids);
  assert.deepEqual(bodies.map((b) => b.tableorder_value), p.sampleTables.map((t) => t.label));
  for (const body of bodies) {
    assert.match(body.tableorder_value, /^[A-Za-z0-9]{1,6}$/);
    const config = timeBilling.normalizeConfig(body.time_billing);
    assert.ok(config, body.tableorder_value);
    assert.ok(Number.isSafeInteger(config.rate));
  }
  // VIP room from 19:05 Vietnam time at the evening rate (350.000 đ/h), 15-minute
  // blocks with 5 grace minutes: leaving at 20:40 bills 1 h 30 min, at 20:41
  // the started block counts and it bills 1 h 45 min.
  const vip = timeBilling.normalizeConfig(bodies.find((b) => b.tableorder_value === 'VIP1').time_billing);
  assert.equal(timeBilling.quote(vip, '2026-10-14T19:05:00+07:00', '2026-10-14T20:40:00+07:00').amount, 525000);
  const q = timeBilling.quote(vip, '2026-10-14T19:05:00+07:00', '2026-10-14T20:41:00+07:00');
  assert.equal(q.amount, 612500);
  assert.equal(timeBilling.lineName('Giờ hát phòng VIP', 'VIP1', q.lines[0], 'vi'), 'Giờ hát phòng VIP VIP1 · 19:05-20:41 · 1 giờ 45 phút (Buổi tối)');
  // A short game on the billiard table is charged the 30-minute minimum.
  const bida = timeBilling.normalizeConfig(bodies.find((b) => b.tableorder_value === 'BIDA1').time_billing);
  assert.equal(timeBilling.quote(bida, '2026-10-14T14:00:00+07:00', '2026-10-14T14:12:00+07:00').amount, 30000);
  // Without seeded item ids the tables are still created, just not timed.
  assert.ok(presets.sampleTablePayloads('karaoke-bida').every((b) => b.time_billing === undefined));
  assert.deepEqual(presets.sampleTablePayloads('cafe-tra-sua'), []);
});

test('time items are services sold by the hour', () => {
  const p = presets.getPreset('karaoke-bida');
  for (const t of p.sampleTables) {
    const item = p.sampleItems.find((i) => i.name === t.item);
    assert.equal(item.unit, 'gio', t.label);
    assert.ok(Number.isSafeInteger(item.price) && item.price > 0);
  }
  assert.ok(Object.isFrozen(p.sampleTables[0].timeBilling.bands));
});
