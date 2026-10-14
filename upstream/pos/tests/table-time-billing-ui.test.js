'use strict';
/*
 * HiTechPOS: time billing for karaoke rooms and billiard tables on the table
 * workspace (kot_v2). The server prices the time; the page shows a running
 * clock and an estimate from the same pure module, and must charge the time
 * up to now before anyone takes payment or prints the bill.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KOT = read('frontend/static/script/js/modules/js/kot_v2.js');

test('the pricing module is bundled before the table workspace that reads it', () => {
  const map = JSON.parse(read('frontend/pages_css_js_map.json'));
  const bundles = Object.values(map).map((page) => page.js || []).filter((js) => js.some((f) => f.endsWith('/kot_v2.js')));
  assert.ok(bundles.length, 'kot_v2.js is not bundled');
  for (const js of bundles) {
    const module = js.indexOf('../api/src/utils/time-billing.js');
    assert.ok(module > -1 && module < js.findIndex((f) => f.endsWith('/kot_v2.js')));
  }
});

test('in the browser the module is a global with the same prices as the server', () => {
  const window = {};
  vm.runInNewContext(read('api/src/utils/time-billing.js'), { globalThis: window, window });
  const tb = window.PosnicTimeBilling;
  assert.ok(tb, 'PosnicTimeBilling is not exposed');
  const config = tb.normalizeConfig({ item_id: 'a'.repeat(24), rate: 120000, block_minutes: 15 });
  const q = tb.quote(config, '2026-10-14T19:05:00+07:00', '2026-10-14T20:40:00+07:00');
  assert.strictEqual(q.amount, 210000);
  assert.strictEqual(tb.formatDuration(q.billed_minutes, 'vi'), '1 giờ 45 phút');
});

test('time is charged before the payment screen and before the bill prints', () => {
  const pay = KOT.slice(KOT.indexOf("else if (a === 'pay')"), KOT.indexOf('CaptainPayments.open(paymentTable(s), branch())'));
  assert.match(pay, /await stopTime\(s\);/);
  const print = KOT.slice(KOT.indexOf("else if (a === 'printBill')"), KOT.indexOf('P.kot.printKOTReceipt(s._id);'));
  assert.match(print, /await stopTime\(s\);/);
  assert.match(KOT, /api\('post', 'sales\/tableTime'/);
  // The till's own payment path asks too.
  const sales = read('frontend/static/script/js/modules/js/sales.js');
  assert.match(sales, /PosnicPro\.sales\.stopTableTime\(id, function \(\) \{ PosnicPro\.sales\.view\.showSalesEditPage\(id\); \}\);/);
  assert.match(sales, /url: 'sales\/tableTime',\s*data: JSON\.stringify\(\{ action: 'stop'/);
});

test('every new label has English, Vietnamese and Dutch text', () => {
  const keys = [...new Set((KOT + read('frontend/modals/tableorder.html') + read('frontend/static/script/js/modules/js/settings.js'))
    .match(/lang_time_[a-z_]+/g))];
  assert.ok(keys.length >= 20);
  for (const file of ['_english', 'vi', 'nl']) {
    const pack = JSON.parse(read(`languages/${file}.json`));
    for (const key of keys) assert.ok(pack[key] && pack[key].trim(), `${file}: ${key}`);
  }
  const vi = JSON.parse(read('languages/vi.json'));
  assert.strictEqual(vi.lang_time_stop, 'Tính giờ');
  assert.strictEqual(vi.lang_time_start, 'Bắt đầu tính giờ');
});

test('the table settings form saves time billing the server accepts, and clears it', (t) => {
  let JSDOM;
  try {
    ({ JSDOM } = require('jsdom'));
    require.resolve('jquery');
  } catch (_) {
    t.skip('jsdom/jquery not installed');
    return;
  }
  const dom = new JSDOM(read('frontend/modals/tableorder.html'));
  const $ = require('jquery')(dom.window);
  $.fn.tooltip = function () { return this; };
  const sent = [];
  const PosnicPro = {
    showAddModal() {}, i18n: { t: (_, fallback) => fallback },
    getFormData: (form) => Object.fromEntries(form.serializeArray().map((x) => [x.name, x.value])),
    get: (params, done) => done({ suggestions: [
      { data: { item_id: 'a'.repeat(24), item_name: 'Giờ hát phòng VIP', item_kind: 'service' } },
      { data: { item_id: 'b'.repeat(24), item_name: 'Bia', item_kind: 'product' } },
    ] }),
    post: (params) => sent.push(JSON.parse(params.data)),
    put: (params) => sent.push(JSON.parse(params.data)),
  };
  const source = read('frontend/static/script/js/modules/js/settings.js');
  new Function('PosnicPro', '$', source.slice(source.indexOf('PosnicPro.tableOrders ='), source.indexOf('PosnicPro.tableorder =')))(PosnicPro, $);
  const tables = PosnicPro.tableOrders;
  tables.allData = [{ tableorder_id: 'v', tableorder_value: 'VIP1', time_billing: {
    item_id: 'a'.repeat(24), rate: 300000, block_minutes: 15, min_blocks: 4, grace_minutes: 5,
    bands: [{ start: '18:00', end: '24:00', rate: 350000, label: 'Buổi tối' }],
  } }];
  $('<button id="setting_tableorder_edit_v">').data('tableordervalue', 'VIP1').appendTo(dom.window.document.body);
  tables.triggerTaxEdit('v');
  // Only services are offered, and the saved one is selected.
  assert.deepEqual($('#table_time_item option').map((_, o) => o.textContent).get().slice(1), ['Giờ hát phòng VIP']);
  assert.strictEqual($('#table_time_item').val(), 'a'.repeat(24));
  assert.strictEqual($('#table_time_enabled').prop('checked'), true);
  assert.strictEqual($('[data-band-field=end]').first().val(), '00:00');
  $('#table_time_grace').val('0');
  tables.editTableOrderField();
  const window = {};
  vm.runInNewContext(read('api/src/utils/time-billing.js'), { globalThis: window, window });
  assert.deepEqual(window.PosnicTimeBilling.normalizeConfig(sent[0].time_billing), {
    item_id: 'a'.repeat(24), rate: 300000, block_minutes: 15, min_blocks: 4, grace_minutes: 0,
    bands: [{ start: '18:00', end: '24:00', rate: 350000, label: 'Buổi tối' }],
  });
  // Band inputs carry no form names, so nothing else leaks into the request.
  assert.ok(!Object.keys(sent[0]).some((k) => /band/.test(k)));
  $('#table_time_enabled').prop('checked', false);
  tables.editTableOrderField();
  assert.strictEqual(sent[1].time_billing, '');
  dom.window.close();
});
