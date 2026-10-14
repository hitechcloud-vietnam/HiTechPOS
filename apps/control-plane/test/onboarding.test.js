'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const presets = require('@hitechpos/industry-presets');
const { createOnboarding, KCT_TAX_NAME, internalBarcode, pickCategory } = require('../src/onboarding');
const { createTenantService } = require('../src/tenants');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');

/*
 * A fake Posnic shop: just the endpoints onboarding uses, with the response
 * shapes the real controllers produce, seeded with what upstream's installer
 * leaves behind (services/install.service.js).
 */
function fakePosnic({ failOn = new Set() } = {}) {
  let seq = 0;
  const id = () => `id${String(++seq).padStart(4, '0')}`;
  const state = {
    taxes: [
      { tax_id: id(), tax_name: '0% Tax', tax_value: 0, tax_group: 'no' },
      { tax_id: id(), tax_name: '5% Tax', tax_value: 5, tax_group: 'no' },
      { tax_id: id(), tax_name: '10% Tax', tax_value: 10, tax_group: 'no' },
    ],
    payments: [{ payment_id: id(), payment_value: 'Cash', enabled: true }, { payment_id: id(), payment_value: 'Card', enabled: true }],
    units: [{ unit_id: id(), unit_name: 'Quantity', unit_value: 'qty' }],
    categories: [],
    items: [],
    branch: { time_zone: 'Asia/Ho_Chi_Minh', currency_type: '₫', currency_text: 'Vietnam Dong / VND or ₫', client_dateformat: 'dd/mm/yyyy', country_id: 'VN', state: '' },
    preferences: { footer_print: 'Thank you for shopping...!', roundOff: false, default_tax: null },
    features: {},
  };
  const calls = [];
  const ok = (data) => ({ status: 200, body: { type: 'success', message: 'ok', data } });
  const err = (status, message) => ({ status, body: { type: 'error', message, data: null } });
  const page = (list) => ok({ list, total: list.length, current_page: 1, total_pages: 1 });

  function handle(method, path, body, headers) {
    const route = `${method} ${path.split('?')[0]}`;
    if (route === 'POST /api/users/verify') {
      if (body.username !== 'owner@photue.vn' || body.password !== 'matkhau123') return err(404, 'incorrect');
      return ok({ jwt_token: 'tok', branchId: 'b1' });
    }
    if (headers.authorization !== 'Bearer tok') return err(401, 'You are not logged in');
    if (failOn.has(route)) return err(500, 'boom');
    switch (route) {
      case 'GET /api/branches/getOneStore': return ok(state.branch);
      case 'PUT /api/settings/starterLocale': Object.assign(state.branch, { time_zone: body.time_zone, currency_type: body.currencyText, currency_text: body.currency_setting, client_dateformat: body.storedate }); return ok({});
      case 'GET /api/settings/getTaxAll': return ok(state.taxes);
      case 'POST /api/settings/addTax':
        if (body.tax_name.length < 3 || body.tax_name.length > 20) return err(400, 'Validation failed');
        if (state.taxes.some((t) => t.tax_name === body.tax_name)) return err(404, 'This tax details already exist in our system');
        state.taxes.push({ tax_id: id(), tax_name: body.tax_name, tax_value: parseFloat(body.tax_value), tax_group: 'no' });
        return ok('x');
      case 'POST /api/settings/editTax': {
        const t = state.taxes.find((x) => x.tax_id === body.tax_id);
        Object.assign(t, { tax_name: body.tax_name, tax_value: parseFloat(body.tax_value) });
        return ok('1');
      }
      case 'GET /api/settings/getPaymentAll': return ok(state.payments);
      case 'POST /api/settings/addPaymentData':
        if ([...body.payment_value].length > 12) return err(400, 'Validation failed');
        if (state.payments.some((p) => p.payment_value === body.payment_value)) return err(404, 'exists');
        state.payments.push({ payment_id: id(), payment_value: body.payment_value, enabled: true });
        return ok('x');
      case 'GET /api/settings/getUnitAll': return ok(state.units);
      case 'POST /api/settings/addUnit':
        if (body.unit_value.length > 6 || body.unit_name.length > 20) return err(400, 'Data Not Valid');
        state.units.push({ unit_id: id(), unit_name: body.unit_name, unit_value: body.unit_value });
        return ok('x');
      case 'POST /api/settings/editUnit': Object.assign(state.units.find((u) => u.unit_id === body.unit_id), { unit_name: body.unit_name, unit_value: body.unit_value }); return ok(1);
      case 'GET /api/categories': return page(state.categories);
      // The real create route refuses non-ASCII names; onboarding must not use it.
      case 'POST /api/categories': return /^[a-zA-Z0-9\s\-_&()]+$/.test(body.name) ? ok({}) : err(400, 'Validation failed');
      case 'POST /api/categories/categoriesImport': {
        const fresh = body.categories.filter((c) => !state.categories.some((x) => x.name === c.name));
        if (!fresh.length) return err(400, 'All categories are already imported');
        for (const c of fresh) state.categories.push({ _id: id(), name: c.name, sort_order: c.sort_order });
        return ok(fresh.map((c) => ({ name: c.name, status: 'Imported' })));
      }
      case 'GET /api/items': return page(state.items);
      case 'POST /api/items': { const it = { _id: id(), ...body }; state.items.push(it); return ok(it); }
      case 'GET /api/settings/group/preferences': return ok({ group: 'preferences', values: state.preferences });
      case 'PUT /api/settings/group/preferences': Object.assign(state.preferences, body); return ok({ written: Object.keys(body) });
      case 'PUT /api/settings/group/features': Object.assign(state.features, body); return ok({ written: Object.keys(body) });
      default: return err(404, `no route ${route}`);
    }
  }

  async function transport(url, init = {}) {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const headers = init.headers || {};
    assert.equal(headers['x-hitech-shop'], 'photue.hitechpos.vn');
    const writes = init.method !== 'GET';
    if (writes) calls.push({ route: `${init.method} ${u.pathname}`, body });
    const r = handle(init.method || 'GET', u.pathname + u.search, body || {}, headers);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }
  return { transport, state, calls };
}

const tenant = { _id: 't1', subdomain: 'photue', tenantDb: 'hitech_t_photue', industry: 'cafe-tra-sua' };
const owner = { email: 'owner@photue.vn', password: 'matkhau123' };
const quiet = { warn() {}, error() {} };
const make = (fake, extra = {}) => createOnboarding({ transport: fake.transport, shardUrl: 'http://shard:6000/', shopHeader: 'x-hitech-shop', baseDomain: 'hitechpos.vn', logger: quiet, ...extra });

test('onboarding makes a fresh cafe shop Vietnamese through the Posnic API', async () => {
  const fake = fakePosnic();
  const report = await make(fake).run({ tenant, owner, preset: 'cafe-tra-sua' });
  assert.deepEqual(report, {
    preset: 'cafe-tra-sua', login: 'ok', locale: 'ok', taxes: 'ok', payments: 'ok', units: 'ok', categories: 'ok',
    items: 'ok', receipt: 'ok', modules: 'ok', receiptTitles: 'skipped',
  });
  const s = fake.state;

  // Installer taxes renamed in place (same ids), 8% and KCT added: 5 in all.
  assert.deepEqual(s.taxes.map((t) => [t.tax_name, t.tax_value]), [
    ['Thuế GTGT 0%', 0], ['Thuế GTGT 5%', 5], ['Thuế GTGT 10%', 10], ['Thuế GTGT 8%', 8], [KCT_TAX_NAME, 0],
  ]);
  assert.ok(fake.calls.some((c) => c.route === 'POST /api/settings/editTax' && c.body.tax_id === 'id0001' && c.body.tax_name === 'Thuế GTGT 0%'));
  assert.ok(KCT_TAX_NAME.length <= 20);

  // Cash/Card stay (protocol keys); manual tenders added; gateways skipped.
  assert.deepEqual(s.payments.map((p) => p.payment_value), ['Cash', 'Card', 'Chuyển khoản', 'Ví MoMo', 'ZaloPay']);

  const preset = presets.getPreset('cafe-tra-sua');
  assert.deepEqual(s.units.map((u) => u.unit_value), ['qty', ...preset.units.map((u) => u.code)]);
  assert.equal(s.units[0].unit_name, 'Số lượng');
  assert.deepEqual(s.categories.map((c) => c.name), preset.categories);

  assert.equal(s.items.length, preset.sampleItems.length);
  const cfs = s.items.find((i) => i.name === 'Cà phê sữa đá');
  const tax8 = s.taxes.find((t) => t.tax_name === 'Thuế GTGT 8%');
  assert.equal(cfs.selling_price, '29000');
  assert.equal(cfs.tax_id, tax8.tax_id);
  assert.equal(cfs.tax, 8);
  assert.equal(cfs.tax_type, 'inclusive');
  assert.equal(cfs.unit, 'ly');
  assert.equal(cfs.unit_id, s.units.find((u) => u.unit_value === 'ly').unit_id);
  assert.equal(cfs.category_name, 'Cà phê');
  assert.match(cfs.barcode_id, /^29\d{11}$/);

  assert.equal(s.preferences.footer_print, preset.receipt.footer);
  assert.equal(s.preferences.roundOff, true);
  assert.equal(s.preferences.default_tax, tax8.tax_id);
  assert.deepEqual(s.features, { ...presets.posnicModuleSettings('cafe-tra-sua'), module_channels_enable: true });
  // Locale already right: nothing written.
  assert.ok(!fake.calls.some((c) => c.route === 'PUT /api/settings/starterLocale'));
});

test('a second run creates nothing new', async () => {
  const fake = fakePosnic();
  const onboarding = make(fake);
  await onboarding.run({ tenant, owner, preset: 'tap-hoa-minimart' });
  const snapshot = JSON.stringify({ ...fake.state, preferences: undefined, features: undefined });
  const before = fake.calls.length;
  const report = await onboarding.run({ tenant, owner, preset: 'tap-hoa-minimart' });
  assert.equal(report.items, 'ok');
  assert.equal(JSON.stringify({ ...fake.state, preferences: undefined, features: undefined }), snapshot);
  const creates = fake.calls.slice(before).filter((c) => !c.route.startsWith('PUT '));
  assert.deepEqual(creates.map((c) => c.route), ['POST /api/users/verify']);
  // Preset barcodes are kept, missing ones get a deterministic in-store code.
  assert.equal(fake.state.items.find((i) => i.name.startsWith('Nước suối')).barcode_id, '2000000000015');
  assert.equal(fake.state.items.find((i) => i.name.startsWith('Bia Sài Gòn')).barcode_id, internalBarcode(0, 2));
});

test('an owner-edited footer is left alone', async () => {
  const fake = fakePosnic();
  fake.state.preferences.footer_print = 'Wifi: photue123';
  await make(fake).run({ tenant, owner, preset: 'cafe-tra-sua' });
  assert.equal(fake.state.preferences.footer_print, 'Wifi: photue123');
});

test('one failing step is reported and the rest still run', async () => {
  const fake = fakePosnic({ failOn: new Set(['POST /api/settings/addTax', 'PUT /api/settings/group/features']) });
  const report = await make(fake).run({ tenant, owner, preset: 'cafe-tra-sua' });
  assert.match(report.taxes, /^failed: POST \/api\/settings\/addTax -> 500 boom/);
  assert.match(report.modules, /^failed: /);
  assert.equal(report.payments, 'ok');
  assert.equal(report.units, 'ok');
  assert.equal(report.categories, 'ok');
  // 8% was never created, so the 8% items cannot be priced with the right tax.
  assert.match(report.items, /^failed: 8\/8 items: .*no tax for 8/);
  assert.equal(fake.state.payments.length, 5);
});

test('a bad login fails every step without throwing', async () => {
  const fake = fakePosnic();
  const report = await make(fake).run({ tenant, owner: { ...owner, password: 'sai' }, preset: 'khac' });
  assert.match(report.login, /^failed: POST \/api\/users\/verify -> 404/);
  assert.equal(report.items, 'failed: login');
  assert.equal(fake.calls.length, 1);
});

test('receipt titles go through the injected patcher', async () => {
  const fake = fakePosnic();
  const seen = [];
  const report = await make(fake, { branchPatcher: { async patchReceiptTitles(args) { seen.push(args); } } }).run({ tenant, owner, preset: 'khac' });
  assert.equal(report.receiptTitles, 'ok');
  assert.deepEqual(seen, [{ tenant, branchId: 'b1' }]);
});

test('locale drift is repaired through the starter-locale endpoint, keeping the state', async () => {
  const fake = fakePosnic();
  Object.assign(fake.state.branch, { time_zone: 'Asia/Kolkata', currency_type: '₹', state: 'Hà Nội' });
  await make(fake).run({ tenant, owner, preset: 'khac' });
  const call = fake.calls.find((c) => c.route === 'PUT /api/settings/starterLocale');
  assert.equal(call.body.time_zone, 'Asia/Ho_Chi_Minh');
  assert.equal(call.body.currencyTextname, 'VND');
  assert.equal(call.body.setting_state, 'Hà Nội');
});

test('category inference keeps diacritics', () => {
  const cats = ['Bia & nước có cồn', 'Sữa & chế phẩm', 'Đồ uống'].map((name) => ({ name }));
  assert.equal(pickCategory({ name: 'Sữa tươi Vinamilk 180ml có đường' }, cats).name, 'Sữa & chế phẩm');
  assert.equal(pickCategory({ name: 'Bột giặt OMO' }, cats), null);
  assert.equal(pickCategory({ name: 'x', category: 'đồ uống' }, cats).name, 'Đồ uống');
});

test('tenant service stores the onboarding report and never fails signup on it', async () => {
  const config = loadConfig({ STORE: 'memory' });
  const signup = { subdomain: 'photue', businessName: 'Cà phê Phở Tuệ', industry: 'cafe-tra-sua', owner };
  const at = new Date('2026-10-14T03:00:00Z');

  const store = createMemoryStore();
  const svc = createTenantService({ store, config, installer: { async install() {} }, now: () => at,
    onboarding: { async run(args) { assert.equal(args.preset, 'cafe-tra-sua'); assert.equal(args.owner, owner); return { taxes: 'ok', items: 'failed: x' }; } } });
  const t = await svc.signup(signup, { ownerAccountId: 'a1' });
  assert.equal(t.status, 'active');
  assert.deepEqual(t.onboarding, { taxes: 'ok', items: 'failed: x', at: at.toISOString() });

  const store2 = createMemoryStore();
  const svc2 = createTenantService({ store: store2, config, installer: { async install() {} }, now: () => at, logger: quiet,
    onboarding: { async run() { throw new Error('shard down'); } } });
  const t2 = await svc2.signup(signup, { ownerAccountId: 'a1' });
  assert.equal(t2.status, 'active');
  assert.equal(t2.suspended, false);
  assert.equal(t2.onboarding.error, 'failed: shard down');

  // No onboarding injected: unchanged behaviour.
  const t3 = await createTenantService({ store: createMemoryStore(), config, installer: { async install() {} }, now: () => at }).signup(signup, { ownerAccountId: 'a1' });
  assert.equal(t3.onboarding, undefined);
});
