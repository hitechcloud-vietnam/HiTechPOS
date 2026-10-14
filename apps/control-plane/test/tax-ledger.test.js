'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const presets = require('@hitechpos/industry-presets');
const FIXTURE = require('./fixtures/posnic-sales.json');
const { TAX_TABLE, INDUSTRY_DEFAULTS, GROUP_IDS, NOTICE } = require('../src/tax-ledger-config');
const {
  parsePeriod, vnDayKey, allocate, taxOn, createGroupResolver, saleEntries, summarize, buildLedger, salesQuery, ledgerFromShopDb,
} = require('../src/tax-ledger');
const { toCsv, toHtml, csvCell } = require('../src/tax-ledger-export');
const { createTaxLedgerRouter } = require('../src/tax-ledger-router');
const { createMemoryStore } = require('../src/store/memory');

/* Fixture sales (captured from a live shop, see its _comment), 2026-10-14 ~15:40 VN time. */
const byNo = (no) => structuredClone(FIXTURE.sales.find((s) => s.sales_id === no));
const NOW = new Date('2026-10-20T03:00:00Z');
const CAT_CAFE = '6acf3f95519b247b1a297480'; // "Cà phê"
const CAT_TOPPING = '6acf3f95519b247b1a297485';
const ITEM_BIA = '6acf3fba519b247b1a2974a4';

function ledgerOf(sales, { period = '2026-10', industry = 'cafe-tra-sua', settings, items = [], detail, now = NOW } = {}) {
  const resolver = createGroupResolver({ industry, settings, items });
  const entries = [];
  const excluded = [];
  for (const s of sales) {
    const r = saleEntries(s, resolver);
    if (r.excluded) excluded.push({ reason: r.excluded, at: r.at });
    entries.push(...r.entries);
  }
  return buildLedger({ entries, excluded, period: parsePeriod(period), now, shop: { name: 'Cà phê Hoá Đơn', taxCode: '0100109106' }, detail });
}

/* A minimal paid sale. */
function sale(id, at, total, lines, extra = {}) {
  return {
    _id: id, sales_id: `S-${id}`, sale_process: 'Add', payment_status: 'Paid', date: at, sales_total: total,
    items: lines.map(([amount, category_name = '', category_id = '', item_id = '']) => ({ item_id, category_id, category_name, total_amount: amount, item_quantity: 1 })),
    charges: [], ...extra,
  };
}

/* ------------------------------------------------------------- periods */

test('parsePeriod: month, quarter and year boundaries in Vietnam time (UTC+7)', () => {
  const m = parsePeriod('2026-10');
  assert.equal(m.type, 'month');
  assert.equal(m.from.toISOString(), '2026-09-30T17:00:00.000Z');
  assert.equal(m.to.toISOString(), '2026-10-31T17:00:00.000Z');
  assert.equal(m.label, 'Tháng 10/2026');
  assert.equal(m.fromDay, '2026-10-01');
  assert.equal(m.toDay, '2026-10-31');

  const q = parsePeriod('2026-q4');
  assert.equal(q.key, '2026-Q4');
  assert.equal(q.label, 'Quý IV/2026');
  assert.equal(q.from.toISOString(), '2026-09-30T17:00:00.000Z');
  assert.equal(q.to.toISOString(), '2026-12-31T17:00:00.000Z');

  const y = parsePeriod('2026');
  assert.equal(y.from.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(y.to.toISOString(), '2026-12-31T17:00:00.000Z');
  assert.equal(y.toDay, '2026-12-31');

  assert.equal(parsePeriod('2024-02').toDay, '2024-02-29');
  for (const bad of ['', '2026-13', '2026-00', '2026-Q5', '26-10', '1999', 'abc', '2026-10-01', ['2026', '2025']]) {
    assert.throws(() => parsePeriod(bad), (e) => e.code === 'tax_period_invalid' && e.status === 422, String(bad));
  }
});

test('a sale belongs to the Vietnamese calendar day, not the UTC one', () => {
  assert.equal(vnDayKey(new Date('2026-09-30T16:59:59.999Z')), '2026-09-30');
  assert.equal(vnDayKey(new Date('2026-09-30T17:00:00.000Z')), '2026-10-01');
  const late = sale('a1', '2026-09-30T16:59:59.999Z', 10000, [[10000]]); // 23:59:59 30/09 VN
  const early = sale('a2', '2026-09-30T17:00:00.000Z', 20000, [[20000]]); // 00:00 01/10 VN
  const newYear = sale('a3', '2025-12-31T17:30:00.000Z', 5000, [[5000]]); // 00:30 01/01/2026 VN

  const oct = ledgerOf([late, early, newYear]);
  assert.equal(oct.book.totals.total, 20000);
  assert.equal(oct.book.rows[0].postedOn, '2026-10-01');
  const sep = ledgerOf([late, early, newYear], { period: '2026-09' });
  assert.equal(sep.book.totals.total, 10000);
  const q1 = ledgerOf([late, early, newYear], { period: '2026-Q1' });
  assert.equal(q1.book.totals.total, 5000);
  assert.equal(q1.book.rows[0].postedOn, '2026-01-01');
  assert.equal(ledgerOf([newYear], { period: '2025' }).book.totals.total, 0);
});

/* ------------------------------------------------------- fixture sales */

test('fixture: only completed sales count; a partial return is a negative entry on its own day', () => {
  const l = ledgerOf(FIXTURE.sales);
  // Paid: 000005 122400, 000007 114400, 000003 85800 (returned 29000 later), 000011 128167.
  // Not counted: 000002 Unpaid, 000009 open KOT Unpaid, 000008 Hold (stored as Paid).
  assert.equal(l.book.counts.sales, 4);
  assert.equal(l.book.counts.returns, 1);
  assert.deepEqual(l.book.counts.skipped, { not_paid: 2, held: 1 });
  assert.equal(l.book.totals.total, 122400 + 114400 + 85800 + 128167 - 29000);
  assert.equal(l.notice, NOTICE);
  assert.equal(l.summary.notice, 'Số liệu tham khảo – cần kế toán xác nhận');

  assert.equal(l.book.rows.length, 2);
  const [sales, returns] = l.book.rows;
  assert.equal(sales.kind, 'sale');
  assert.equal(sales.postedOn, '2026-10-14');
  assert.equal(sales.total, 450767);
  assert.match(sales.description, /Doanh thu bán hàng ngày 14\/10\/2026 \(4 đơn\)/);
  assert.equal(sales.docNo, 'S-OKHF-000003 … S-OKHF-000011');
  assert.equal(returns.kind, 'return');
  assert.equal(returns.total, -29000);
  assert.equal(returns.docNo, 'RFS1014202608423276');
  assert.match(returns.description, /S-OKHF-000003/);
  // a cafe: every line defaults to group 3 (dịch vụ ăn uống)
  assert.equal(l.book.totals.amounts.sx_vt, 421767);
  for (const r of l.book.rows) assert.equal(r.total, GROUP_IDS.reduce((a, g) => a + r.amounts[g], 0));

  const perSale = ledgerOf(FIXTURE.sales, { detail: 'sale' });
  assert.equal(perSale.book.rows.length, 5);
  assert.equal(perSale.book.totals.total, l.book.totals.total);
});

test('grouping: owner overrides by category id and for uncategorised lines; split sums to the sale exactly', () => {
  const settings = { categoryGroups: [{ key: 'none', group: 'phan_phoi' }] };
  const l = ledgerOf([byNo('S-OKHF-000003')], { settings, detail: 'sale' });
  const [s, r] = l.book.rows;
  // lines as sold (business_item_origin): cà phê 58000 (Cà phê -> preset default group 3),
  // bia 17800 + rau má 15000 (no category -> owner: group 1); sales_total 85800.
  // exact 54806.17 / 30993.83 -> largest remainder gives the spare 1 đ to group 1.
  assert.deepEqual(s.amounts, { phan_phoi: 30994, dich_vu: 0, sx_vt: 54806, khac: 0 });
  assert.equal(s.total, 85800);
  // the return is the cà phê line only
  assert.deepEqual(r.amounts, { phan_phoi: 0, dich_vu: 0, sx_vt: -29000, khac: 0 });

  const byId = ledgerOf([byNo('S-OKHF-000007')], { settings: { categoryGroups: [{ key: CAT_TOPPING, group: 'khac' }] } });
  // matcha 55000 + trà đào 45000 (group 3), topping 14400 (owner: group 4)
  assert.equal(byId.book.totals.amounts.khac, 14400);
  assert.equal(byId.book.totals.amounts.sx_vt, 100000);

  const byName = ledgerOf([byNo('S-OKHF-000007')], { settings: { categoryGroups: [{ key: 'xyz', name: 'TOPPING', group: 'dich_vu' }] } });
  assert.equal(byName.book.totals.amounts.dich_vu, 14400);
});

test('grouping: preset category rules, the items collection, service items, charges and the default group', () => {
  // spa: services by default, but its "Sản phẩm bán lẻ" category is distribution
  const spa = ledgerOf([sale('s1', '2026-10-05T03:00:00Z', 300000, [[200000, 'Massage & body'], [100000, 'Sản phẩm bán lẻ']])], { industry: 'spa-salon' });
  assert.deepEqual(spa.book.totals.amounts, { phan_phoi: 100000, dich_vu: 200000, sx_vt: 0, khac: 0 });

  // unknown industry -> fallback preset 'khac' (distribution)
  const unknown = ledgerOf([sale('u1', '2026-10-05T03:00:00Z', 1000, [[1000]])], { industry: 'khong-co' });
  assert.equal(unknown.book.totals.amounts.phan_phoi, 1000);

  // a line without category is completed from the items collection
  const items = [{ _id: ITEM_BIA, category_id: 'cat-bia', category_name: 'Bia' }, { _id: 'svc1', item_kind: 'service' }];
  const withItems = ledgerOf([sale('i1', '2026-10-05T03:00:00Z', 30000, [[20000, '', '', ITEM_BIA], [10000, '', '', 'svc1']])],
    { items, settings: { categoryGroups: [{ key: 'cat-bia', group: 'phan_phoi' }] } });
  assert.deepEqual(withItems.book.totals.amounts, { phan_phoi: 20000, dich_vu: 10000, sx_vt: 0, khac: 0 });

  // charges (phí giao hàng 10000 + VAT 800) go to chargeGroup; the owner's default group wins over the preset
  const charged = ledgerOf([byNo('S-OKHF-000011')], { settings: { defaultGroup: 'phan_phoi', chargeGroup: 'dich_vu', categoryGroups: [{ key: CAT_CAFE, group: 'sx_vt' }] } });
  const a = charged.book.totals.amounts;
  assert.equal(a.phan_phoi + a.dich_vu + a.sx_vt + a.khac, 128167);
  // weights: bánh mì 95700 (default -> 1), charge 10800 (-> 2), cà phê 25000 (-> 3); total 131500
  // exact 93274.39 / 10526.26 / 24366.35 -> floors sum to 128166, the spare 1 đ goes to the largest remainder
  assert.deepEqual(a, { phan_phoi: 93275, dich_vu: 10526, sx_vt: 24366, khac: 0 });

  // a sale whose lines have no positive amount goes wholly to the default group
  const zero = ledgerOf([sale('z1', '2026-10-05T03:00:00Z', 5000, [[0]])]);
  assert.equal(zero.book.totals.amounts.sx_vt, 5000);
});

test('returns: a return in a later month changes that month only; negative group revenue taxes as 0', () => {
  const s = sale('r1', '2026-09-30T10:00:00Z', 100000, [[100000, 'Cà phê', CAT_CAFE]], {
    sale_process: 'Return',
    items: [],
    items_return: [{ returnArray: { returnId: 'RFS-1', returnDate: new Date('2026-10-02T02:00:00Z'), itemsTotalAmount: 100000,
      returnValue: [{ item_id: 'x', category_id: CAT_CAFE, category_name: 'Cà phê', total_amount: 100000, item_quantity: 1 }] } }],
  });
  const sep = ledgerOf([s], { period: '2026-09' });
  assert.equal(sep.book.totals.total, 100000);
  const oct = ledgerOf([s]);
  assert.equal(oct.book.rows.length, 1);
  assert.equal(oct.book.rows[0].total, -100000);
  assert.equal(oct.summary.groups.find((g) => g.id === 'sx_vt').revenue, -100000);
  assert.equal(oct.summary.totals.gtgt, 0);
  assert.equal(oct.summary.totals.tncn, 0);
  assert.equal(oct.summary.warnings.length, 1);
  assert.equal(ledgerOf([s], { period: '2026-Q4' }).book.totals.total, -100000);
  assert.equal(ledgerOf([s], { period: '2026' }).book.totals.total, 0);

  // a return without itemsTotalAmount: lines minus the return's extra discount
  const s2 = sale('r2', '2026-10-01T03:00:00Z', 50000, [[50000]], {
    items_return: [{ returnArray: { returnId: 'RFS-2', returnDate: '2026-10-03T03:00:00Z', extraDiscount: 1000, returnValue: [{ total_amount: 20000 }] } }],
  });
  assert.equal(ledgerOf([s2]).book.totals.total, 50000 - 19000);

  // returns of a sale that does not count (held / unpaid) are ignored too
  assert.equal(ledgerOf([{ ...s2, payment_status: 'Unpaid' }]).book.rows.length, 0);
});

test('sale status: credit sales count with a warning, open KOT and cancelled sales do not', () => {
  const credit = sale('c1', '2026-10-05T03:00:00Z', 70000, [[70000]], { payment_status: 'Partialy Paid' });
  const kot = sale('c2', '2026-10-05T03:00:00Z', 50000, [[50000]], { payment_status: 'Partialy Paid', sale_process: 'KOT' });
  const cancelled = sale('c3', '2026-10-05T03:00:00Z', 50000, [[50000]], { customer_cancelled_at: '2026-10-05T04:00:00Z' });
  const pending = sale('c4', '2026-10-05T03:00:00Z', 50000, [[50000]], { order_state: 'pending' });
  const l = ledgerOf([credit, kot, cancelled, pending]);
  assert.equal(l.book.totals.total, 70000);
  assert.match(l.book.rows[0].note, /1 đơn bán chịu/);
  assert.ok(l.summary.warnings.some((w) => /bán chịu/.test(w)));
  assert.deepEqual(l.book.counts.skipped, { not_paid: 1, cancelled: 1, order_not_accepted: 1 });
});

/* ------------------------------------------------------------ rounding */

test('allocate: largest remainder, exact sum, ties to the first, negative totals', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.deepEqual(allocate(10, [0, 3, 0, 1]), [0, 8, 0, 2]);
  assert.deepEqual(allocate(1, [0, 0, 5]), [0, 0, 1]);
  assert.equal(allocate(10, [0, 0]), null);
  assert.throws(() => allocate(1.5, [1]));
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 300; i += 1) {
    const total = Math.floor(rnd() * 5e7) - 1e7;
    const weights = Array.from({ length: 4 }, () => (rnd() < 0.3 ? 0 : rnd() * 1e6));
    const parts = allocate(total, weights);
    if (!parts) continue;
    assert.equal(parts.reduce((a, p) => a + p, 0), total);
    parts.forEach((p, k) => { assert.ok(Number.isInteger(p)); if (!weights[k]) assert.equal(p, 0); });
  }
});

test('taxOn: exact integer arithmetic, half up to 1 đ, reductions', () => {
  assert.equal(taxOn(150, 100), 2); // 1.5 -> 2
  assert.equal(taxOn(149, 100), 1); // 1.49 -> 1
  assert.equal(taxOn(100, 50), 1); // 0.5 -> 1
  assert.equal(taxOn(99, 50), 0); // 0.495 -> 0
  assert.equal(taxOn(12345, 50), 62); // 61.725
  assert.equal(taxOn(0, 500), 0);
  assert.equal(taxOn(-1000, 500), 0);
  assert.equal(taxOn(9007199254740991, 150), 135107988821115); // 135107988821114.865, no float loss
  assert.equal(taxOn(1000000, 100, 20), 8000); // 1% reduced by 20% = 0.8%
  assert.equal(taxOn(1250, 300, 20), 30); // 1250 * 2.4% = 30
});

test('summary: tax is rounded per group and the total is the sum of rounded group taxes', () => {
  const period = parsePeriod('2026-10');
  const s = summarize({ revenue: { phan_phoi: 150, dich_vu: 0, sx_vt: 0, khac: 25 }, yearRevenue: 600000000, period, now: NOW });
  const g = Object.fromEntries(s.groups.map((x) => [x.id, x]));
  assert.equal(g.phan_phoi.gtgt, 2); // 1% of 150 = 1.5
  assert.equal(g.khac.gtgt, 1); // 2% of 25 = 0.5
  assert.equal(s.totals.gtgt, 3); // not round(2.0) = 2
  assert.equal(g.phan_phoi.tncn, 1); // 0.5% of 150 = 0.75
  assert.equal(g.khac.tncn, 0); // 1% of 25 = 0.25
  assert.equal(s.totals.tax, 4);
  assert.equal(s.notice, NOTICE);
});

test('summary: annual threshold status and payable amounts', () => {
  const big = sale('t1', '2026-03-01T03:00:00Z', TAX_TABLE.annualThreshold + 1, [[1]]);
  const oct = sale('t2', '2026-10-05T03:00:00Z', 10000000, [[1]]);
  const exceeded = ledgerOf([big, oct]);
  assert.equal(exceeded.summary.threshold.status, 'exceeded');
  assert.equal(exceeded.summary.threshold.yearRevenue, TAX_TABLE.annualThreshold + 1 + 10000000);
  // cafe -> group 3: 3% GTGT, 1.5% TNCN of 10.000.000
  assert.deepEqual(exceeded.summary.payable, { gtgt: 300000, tncn: 150000, total: 450000 });

  const below = ledgerOf([oct]);
  assert.equal(below.summary.threshold.status, 'not_exceeded_yet');
  assert.equal(below.summary.totals.gtgt, 300000); // shown as "nếu vượt ngưỡng"
  assert.deepEqual(below.summary.payable, { gtgt: 0, tncn: 0, total: 0 });

  const yearOver = ledgerOf([oct], { now: new Date('2027-02-01T00:00:00Z') });
  assert.equal(yearOver.summary.threshold.status, 'not_exceeded');
  assert.match(yearOver.summary.threshold.text, /không phải nộp/);

  // sales after "now" do not count towards the year's revenue
  const future = sale('t3', '2026-11-05T03:00:00Z', TAX_TABLE.annualThreshold, [[1]]);
  assert.equal(ledgerOf([oct, future]).summary.threshold.status, 'not_exceeded_yet');
});

/* -------------------------------------------------------------- config */

test('config: one rates table, integer basis points, every preset mapped, unverified markers present', () => {
  for (const id of GROUP_IDS) {
    const g = TAX_TABLE.groups[id];
    assert.ok(Number.isInteger(g.gtgtBp) && Number.isInteger(g.tncnBp), id);
  }
  assert.deepEqual(GROUP_IDS.map((id) => TAX_TABLE.groups[id].column), [1, 2, 3, 4]);
  for (const id of presets.PRESET_IDS) {
    const d = INDUSTRY_DEFAULTS[id];
    assert.ok(d && GROUP_IDS.includes(d.group), `preset ${id} has a default group`);
    const cats = presets.getPreset(id).categories;
    for (const [name, group] of Object.entries(d.categories || {})) {
      assert.ok(cats.includes(name), `${id}: category "${name}" exists in the preset`);
      assert.ok(GROUP_IDS.includes(group));
    }
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'tax-ledger-config.js'), 'utf8');
  assert.ok((src.match(/UNVERIFIED: cần kế toán xác nhận/g) || []).length >= 12);
});

/* -------------------------------------------------------------- exports */

test('CSV: UTF-8 BOM, CRLF, Vietnamese headers, escaping and formula guard', () => {
  const l = ledgerOf(FIXTURE.sales);
  l.shop.name = 'Quán "Ba", Hà Nội';
  l.shop.address = '=HYPERLINK("http://x")';
  const csv = toCsv(l);
  const bytes = Buffer.from(csv, 'utf8');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(csv), 'every line ends with CRLF');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[2], '"Hộ, cá nhân kinh doanh","Quán ""Ba"", Hà Nội"');
  assert.equal(lines[4], `Địa chỉ,"'=HYPERLINK(""http://x"")"`);
  assert.ok(csv.includes('"Ngày, tháng ghi sổ",Số hiệu chứng từ,"Ngày, tháng chứng từ",Diễn giải,"(1) Phân phối, cung cấp hàng hoá"'));
  assert.ok(csv.includes(NOTICE));
  assert.ok(lines.some((x) => x.startsWith('14/10/2026,RFS1014202608423276,14/10/2026,') && x.includes(',-29000,')), 'negative numbers stay numbers');
  assert.ok(lines.some((x) => x.startsWith(',,,Tổng cộng,0,0,421767,0,421767')));

  const semi = toCsv(l, { separator: ';' });
  assert.ok(semi.includes('Ngày, tháng ghi sổ;Số hiệu chứng từ;'));
  assert.ok(semi.includes('Hộ, cá nhân kinh doanh;"Quán ""Ba"", Hà Nội"'), 'with ; a comma needs no quotes');

  assert.equal(csvCell(' x', ','), '" x"');
  assert.equal(csvCell('a\nb', ','), '"a\nb"');
  assert.equal(csvCell('@sum', ','), "'@sum");
  assert.equal(csvCell(-5, ','), '-5');
  assert.equal(csvCell(null, ','), '');
});

test('HTML: printable A4 page with notice, escaped shop data and totals', () => {
  const l = ledgerOf(FIXTURE.sales);
  l.shop.name = '<script>alert(1)</script>';
  const html = toHtml(l);
  assert.match(html, /@page \{ size: A4 landscape/);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.split(NOTICE).length >= 3, 'notice above the book and the summary');
  assert.ok(html.includes('SỔ CHI TIẾT DOANH THU BÁN HÀNG HÓA, DỊCH VỤ'));
  assert.ok(html.includes('421.767'));
});

/* -------------------------------------------------------------- loading */

function fakeDb({ sales = FIXTURE.sales, items = [], categories = [] } = {}) {
  const queries = [];
  const cursor = (docs) => {
    const arr = structuredClone(docs);
    return { toArray: async () => arr, async *[Symbol.asyncIterator]() { yield* arr; } };
  };
  const data = { sales, items, categories };
  return {
    queries,
    collection: (name) => ({ find: (q, opts) => { queries.push({ name, q, opts }); return cursor(data[name] || []); } }),
  };
}

test('ledgerFromShopDb: reads the whole calendar year (sales and returns) and uses the tenant mapping', async () => {
  const db = fakeDb();
  const tenant = { _id: 't1', industry: 'cafe-tra-sua', businessName: 'Cà phê Hoá Đơn', taxCode: '0100109106', taxLedgerSettings: { categoryGroups: [{ key: 'none', group: 'phan_phoi' }] } };
  const l = await ledgerFromShopDb({ db, tenant, period: parsePeriod('2026-10'), now: NOW });
  const q = db.queries.find((x) => x.name === 'sales');
  const fields = q.q.$or.map((c) => Object.keys(c)[0]);
  assert.ok(fields.includes('items_return.returnArray.returnDate'));
  assert.ok(fields.includes('date'));
  assert.equal(q.q.$or[0][fields[0]].$gte.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(q.q.$or[0][fields[0]].$lt.toISOString(), '2026-12-31T17:00:00.000Z');
  assert.equal(l.shop.name, 'Cà phê Hoá Đơn');
  assert.ok(l.book.totals.amounts.phan_phoi > 0);
  assert.equal(l.book.totals.total, 421767);
  assert.deepEqual(salesQuery(new Date(0), new Date(1)).$or.length, 8);
});

/* --------------------------------------------------------------- router */

async function serve({ withAuth = true, tenantDb, store } = {}) {
  store = store || createMemoryStore();
  const own = await store.tenants.insert({ subdomain: 'hdcafe', businessName: 'Cà phê Hoá Đơn', industry: 'cafe-tra-sua', tenantDb: 'hitech_t_hdcafe', provisioned: true });
  const other = await store.tenants.insert({ subdomain: 'khac', businessName: 'Shop khác', industry: 'tap-hoa-minimart', tenantDb: 'hitech_t_khac', provisioned: true });
  const app = express();
  app.use(express.json());
  /* Stand-in for app.js `auth`: a valid session sets req.account. */
  const auth = (req, _res, next) => {
    if (req.headers.authorization !== 'Bearer owner') return next(Object.assign(new Error('unauthorized'), { code: 'unauthorized', status: 401 }));
    req.account = { sub: 'a1', tenantId: own._id };
    next();
  };
  const router = createTaxLedgerRouter({ store, tenantDb: tenantDb === undefined ? () => fakeDb() : tenantDb, now: () => NOW });
  if (withAuth) app.use('/api/shop/tax-ledger', auth, router);
  else app.use('/api/shop/tax-ledger', router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.code || 'error', message: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/shop/tax-ledger`;
  const call = async (method, p, body, auth = 'Bearer owner') => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, headers: res.headers, bytes, text, json };
  };
  return { server, store, own, other, call };
}

test('router: owner auth required; the shop always comes from the session', async (t) => {
  const { server, call, other, store } = await serve();
  t.after(() => server.close());

  assert.equal((await call('GET', '/?period=2026-10', undefined, null)).status, 401);
  assert.equal((await call('GET', '/?period=2026-10', undefined, 'Bearer forged')).status, 401);
  assert.equal((await call('PUT', '/settings', { defaultGroup: 'khac' }, null)).status, 401);

  const r = await call('GET', `/?period=2026-10&tenantId=${other._id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.shop.name, 'Cà phê Hoá Đơn');
  assert.equal(r.json.book.totals.total, 421767);
  assert.equal(r.json.notice, NOTICE);
  assert.equal(r.headers.get('cache-control'), 'no-store');

  const bad = await call('GET', '/?period=2026-13');
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error, 'tax_period_invalid');

  const csv = await call('GET', '/export.csv?period=2026-Q4&sep=semicolon');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv; charset=utf-8/);
  assert.equal(csv.headers.get('content-disposition'), 'attachment; filename="so-doanh-thu-S1-HKD-hdcafe-2026-Q4.csv"');
  assert.deepEqual([...csv.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(csv.text.includes('Ngày, tháng ghi sổ;'));

  const html = await call('GET', '/export.html?period=2026');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /^text\/html/);
  assert.ok(html.text.includes(NOTICE));

  // settings: PUT changes only the session's shop
  const put = await call('PUT', '/settings', { tenantId: other._id, chargeGroup: 'dich_vu', categoryGroups: [{ key: 'none', name: 'Chưa phân loại', group: 'phan_phoi' }, { key: CAT_TOPPING, group: 'khac' }] });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.categories.find((c) => c.key === 'none').group, 'phan_phoi');
  assert.equal(put.json.categories.find((c) => c.key === 'none').source, 'owner');
  assert.equal(put.json.effectiveChargeGroup, 'dich_vu');
  assert.equal((await store.tenants.findById(other._id)).taxLedgerSettings, undefined);
  const after = await call('GET', '/?period=2026-10');
  assert.ok(after.json.book.totals.amounts.phan_phoi > 0);
  assert.ok(after.json.book.totals.amounts.khac > 0);

  // clearing a row (group null) returns it to the default
  const cleared = await call('PUT', '/settings', { categoryGroups: [{ key: 'none', group: null }] });
  assert.equal(cleared.json.categories.find((c) => c.key === 'none').source, 'default');
  assert.equal(cleared.json.effectiveChargeGroup, 'dich_vu', 'omitted fields keep their value');

  for (const body of [{ defaultGroup: 'x' }, { categoryGroups: 'x' }, { categoryGroups: [{ key: 'a', group: 'thue' }] }, { categoryGroups: [{ group: 'khac' }] }]) {
    const res = await call('PUT', '/settings', body);
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal(res.json.error, 'tax_settings_invalid');
  }
});

test('router: mounted without the auth middleware it refuses everything', async (t) => {
  const { server, call } = await serve({ withAuth: false });
  t.after(() => server.close());
  for (const p of ['/?period=2026-10', '/export.csv?period=2026-10', '/settings']) {
    const r = await call('GET', p);
    assert.equal(r.status, 401, p);
    assert.equal(r.json.error, 'unauthorized');
  }
});

test('router: without a shop database the ledger is 501 and settings still answer', async (t) => {
  const { server, call } = await serve({ tenantDb: null });
  t.after(() => server.close());
  const r = await call('GET', '/?period=2026-10');
  assert.equal(r.status, 501);
  assert.equal(r.json.error, 'tax_ledger_unavailable');
  const s = await call('GET', '/settings');
  assert.equal(s.status, 200);
  assert.equal(s.json.dataAvailable, false);
  assert.equal(s.json.presetGroup, 'sx_vt');
  assert.equal(s.json.notice, NOTICE);
});
