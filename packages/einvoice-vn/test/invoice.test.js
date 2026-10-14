'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInvoice, ANONYMOUS_BUYER_NAME } = require('../src');
const { NOW, sampleInput } = require('./fixtures');

const build = (o) => buildInvoice(sampleInput(o), { now: () => NOW });

function invalid(input, field) {
  assert.throws(() => buildInvoice(input, { now: () => NOW }), (err) => {
    assert.equal(err.code, 'einvoice_invalid');
    assert.equal(err.status, 422);
    assert.ok(err.details.errors.some((e) => e.field === field), `expected error on ${field}, got ${JSON.stringify(err.details.errors)}`);
    return true;
  });
}

test('mixed VAT rates, line discount, commercial discount, promotion and note', () => {
  const inv = build();
  assert.equal(inv.templateCode, '1');
  assert.equal(inv.series, 'C26MAA');
  assert.equal(inv.symbol, '1C26MAA');
  assert.equal(inv.withTaxAuthorityCode, true);
  assert.equal(inv.currency, 'VND');
  assert.equal(inv.exchangeRate, 1);
  const [coffee, bread, promo, disc, note] = inv.lines;
  // 3 x 33,333 = 99,999; VAT 8% on the line = 7,999.92 -> 8,000
  assert.deepEqual([coffee.amount, coffee.netAmount, coffee.vatAmount], [99999, 99999, 8000]);
  // 2 x 25,000 - 5,000 = 45,000; VAT 10% = 4,500
  assert.deepEqual([bread.amountNet, bread.discountNet, bread.netAmount, bread.vatAmount, bread.totalAmount], [50000, 5000, 45000, 4500, 49500]);
  assert.deepEqual([promo.netAmount, promo.vatAmount, promo.totalAmount], [0, 0, 0]);
  // commercial discount 9,999 in the 8% group; VAT 799.92 -> 800
  assert.deepEqual([disc.netAmount, disc.vatAmount], [9999, 800]);
  assert.equal(note.netAmount, undefined);

  const t = inv.totals;
  assert.deepEqual(t.groups, [
    // group 8%: 99,999 - 9,999 = 90,000; VAT = 7,200 computed on the group, lines 8,000 - 800 agree
    { vatRate: 8, label: '8%', net: 90000, vat: 7200, gross: 97200 },
    { vatRate: 10, label: '10%', net: 45000, vat: 4500, gross: 49500 },
  ]);
  assert.equal(t.saleAmount, 144999);
  assert.equal(t.lineDiscount, 5000);
  assert.equal(t.tradeDiscount, 9999);
  assert.equal(t.net, 135000);
  assert.equal(t.vat, 11700);
  assert.equal(t.gross, 146700);
  assert.equal(t.saleAmount - t.tradeDiscount, t.net);
  assert.equal(t.amountInWords, 'Một trăm bốn mươi sáu nghìn bảy trăm đồng');
  assert.ok(Object.isFrozen(inv) && Object.isFrozen(inv.lines[0]));
});

test('group VAT is computed on the group subtotal and line VAT is re-allocated to match', () => {
  // two lines of 1,005 at 5%: each 50.25 -> 50, group 2,010 * 5% = 100.5 -> 101; diff 1 goes to the first largest line
  const inv = build({
    lines: [
      { name: 'A', unit: 'cái', quantity: 1, unitPrice: 1005, vatRate: 5 },
      { name: 'B', unit: 'cái', quantity: 1, unitPrice: 1005, vatRate: 5 },
    ],
  });
  assert.deepEqual(inv.lines.map((l) => l.vatAmount), [51, 50]);
  assert.equal(inv.totals.vat, 101);
  assert.equal(inv.totals.gross, 2111);
});

test('VAT-inclusive retail prices: net extracted per group, lines sum exactly', () => {
  const inv = build({
    pricesIncludeVat: true,
    lines: [
      { name: 'Trà sữa', unit: 'ly', quantity: 3, unitPrice: 35000, vatRate: 8 },
      { name: 'Nước suối', unit: 'chai', quantity: 1, unitPrice: 10000, vatRate: 'KCT' },
    ],
  });
  const [tea, water] = inv.lines;
  // 105,000 incl. 8% -> net round(97,222.2) = 97,222, VAT 7,778
  assert.deepEqual([tea.netAmount, tea.vatAmount, tea.totalAmount], [97222, 7778, 105000]);
  assert.equal(tea.unitPriceNet, 32407.33);
  assert.deepEqual([water.netAmount, water.vatAmount], [10000, 0]);
  assert.equal(inv.totals.gross, 115000);
  assert.equal(inv.totals.vat, 7778);
  assert.deepEqual(inv.totals.groups.map((g) => g.label), ['8%', 'Không chịu thuế']);
});

test('fractional quantities round half away from zero to integer VND', () => {
  const inv = build({ lines: [{ name: 'Thịt bò', unit: 'kg', quantity: 0.35, unitPrice: 285000, vatRate: 'KKKNT' }] });
  assert.equal(inv.lines[0].amount, 99750);
  assert.equal(inv.totals.vat, 0);
  assert.equal(inv.totals.groups[0].label, 'Không kê khai, tính nộp thuế');
  assert.equal(build({ lines: [{ name: 'x', unit: 'kg', quantity: 0.1, unitPrice: 15 }] , invoiceType: 'BANHANG', series: '2C26MAA' }).lines[0].amount, 2);
});

test('hoá đơn bán hàng: no VAT, template 2', () => {
  const inv = build({
    invoiceType: 'BANHANG', series: '2C26MAB',
    lines: [{ name: 'Phở bò', unit: 'bát', quantity: 2, unitPrice: 50000 }, { name: 'Giảm giá', kind: 'discount', amount: 10000 }],
  });
  assert.equal(inv.templateCode, '2');
  assert.deepEqual(inv.totals.groups, []);
  assert.equal(inv.totals.vat, 0);
  assert.equal(inv.totals.gross, 90000);
  assert.equal(inv.totals.amountInWords, 'Chín mươi nghìn đồng');
  invalid(sampleInput({ invoiceType: 'BANHANG', series: '2C26MAB' }), 'lines[0].vatRate');
});

test('anonymous retail buyer and identified business buyer', () => {
  const anon = build();
  assert.equal(anon.buyer.anonymous, true);
  assert.equal(anon.buyer.displayName, ANONYMOUS_BUYER_NAME);
  const biz = build({ buyer: { companyName: 'Công ty CP ABC', taxCode: '0101243150', address: 'Q. Cầu Giấy, Hà Nội', email: 'ketoan@abc.vn', phone: '+84 912 345 678' } });
  assert.equal(biz.buyer.anonymous, false);
  assert.equal(biz.buyer.displayName, 'Công ty CP ABC');
  assert.equal(biz.buyer.phone, '0912345678');
  const person = build({ buyer: { name: 'Nguyễn Văn A', citizenId: '001090012345' } });
  assert.equal(person.buyer.anonymous, false);
});

test('validation errors are collected with Vietnamese messages', () => {
  invalid(sampleInput({ refId: '' }), 'refId');
  invalid(sampleInput({ lines: [] }), 'lines');
  invalid(sampleInput({ lines: [{ name: 'note', kind: 'note' }] }), 'lines');
  invalid(sampleInput({ seller: { taxCode: '0100109107', name: 'x', address: 'y' } }), 'seller.taxCode');
  invalid(sampleInput({ buyer: { taxCode: '0101243150' } }), 'buyer.companyName');
  invalid(sampleInput({ buyer: { taxCode: '0101243150', companyName: 'X' } }), 'buyer.address');
  invalid(sampleInput({ buyer: { taxCode: '123' , companyName: 'X', address: 'Y' } }), 'buyer.taxCode');
  invalid(sampleInput({ buyer: { email: 'not-an-email' } }), 'buyer.email');
  invalid(sampleInput({ buyer: { citizenId: '1234' } }), 'buyer.citizenId');
  invalid(sampleInput({ currency: 'USD' }), 'currency');
  invalid(sampleInput({ paymentMethod: 'MOMO' }), 'paymentMethod');
  invalid(sampleInput({ series: '1K26MAA' }), 'series'); // cash register invoices carry a CQT code
  invalid(sampleInput({ series: '1C26TAA' }), 'series'); // ... and the letter M
  invalid(sampleInput({ fromCashRegister: false }), 'fromCashRegister');
  invalid(sampleInput({ series: '1C25MAA' }), 'series'); // year in the symbol must match the issue date
  invalid(sampleInput({ series: '2C26MAA' }), 'templateCode');
  invalid(sampleInput({ issueDate: '2026-10-15T05:00:00Z' }), 'issueDate');
  invalid(sampleInput({ lines: [{ name: 'x', unit: 'c', quantity: 0, unitPrice: 1, vatRate: 10 }] }), 'lines[0].quantity');
  invalid(sampleInput({ lines: [{ name: 'x', unit: 'c', quantity: 1, unitPrice: 1, vatRate: 7 }] }), 'lines[0].vatRate');
  invalid(sampleInput({ lines: [{ name: 'x', unit: 'c', quantity: 1, unitPrice: 100, discount: 101, vatRate: 10 }] }), 'lines[0].discount');
  invalid(sampleInput({ lines: [{ name: 'x', unit: 'c', quantity: 1, unitPrice: 100, vatRate: 10 }, { name: 'ck', kind: 'discount', amount: 200, vatRate: 10 }] }), 'lines');
  invalid(sampleInput({ lines: [{ name: 'x', unit: 'c', quantity: 1, unitPrice: 100, vatRate: 10 }, { name: 'ck', kind: 'discount', amount: 10.5, vatRate: 10 }] }), 'lines[1].amount');
  try { buildInvoice(sampleInput({ currency: 'USD' }), { now: () => NOW }); } catch (err) {
    assert.match(err.message, /Hiện chỉ hỗ trợ hoá đơn bằng VND/);
  }
});

test('series may be given as 7-char symbol or template + series', () => {
  const a = build({ series: 'C26MAA', templateCode: '1' });
  assert.equal(a.symbol, '1C26MAA');
  const b = build({ series: 'c26maa' });
  assert.equal(b.symbol, '1C26MAA');
  const k = build({ fromCashRegister: false, series: '1K26TAA' });
  assert.equal(k.withTaxAuthorityCode, false);
});

test('series year follows Vietnam time, not UTC', () => {
  // 2025-12-31T18:00Z is 01:00 on 1 Jan 2026 in Vietnam
  const inv = buildInvoice(sampleInput({ issueDate: '2025-12-31T18:00:00Z' }), { now: () => NOW });
  assert.equal(inv.series, 'C26MAA');
});
