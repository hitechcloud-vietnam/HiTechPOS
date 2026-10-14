'use strict';

/*
 * Money outside the till: the sale view panel, sales-return and purchase
 * printouts, reports, the customer-facing display and the mailed receipt.
 *
 * A shop in Vietnam (VND, no minor unit) saw "₫ 110,000.00" on every one of
 * these, because each called `.number(x, 2)` / `x.toFixed(2)` directly. With
 * money-format.js loaded they write whole dong in the shop's grouping
 * ("110.000"); without it - and for a two-decimal currency - they behave as
 * before. Display only: nothing here changes what is stored.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const JS = 'frontend/static/script/js/';

/* One method out of an object-literal module, as the other view tests do. */
function method(file, name, next) {
    const src = read(JS + file);
    const start = src.indexOf('    ' + name + ': function');
    const end = src.indexOf('\n    ' + next + ':', start);
    assert.ok(start > -1 && end > start, name + ' found in ' + file);
    return src.slice(start, end).trim().replace(/,$/, '');
}

function page(html, settings = {}, { withMoney = true } = {}) {
    const dom = new JSDOM('<!doctype html><html lang="vi"><body>' + html + '</body></html>',
        { url: 'http://localhost/', runScripts: 'outside-only' });
    const win = dom.window;
    const $ = require('jquery')(win);
    win.$ = win.jQuery = $;
    win.eval(read(JS + 'jquery.number.min.js'));
    const store = { currencySign: '₫', countryid: 'VN', currency_setting: 'Vietnam Dong / VND or ₫', ...settings };
    win.PosnicPro = {
        local: { get: (key) => (key in store ? store[key] : '') },
        i18n: { t: (_key, fallback) => fallback }
    };
    if (withMoney) win.eval(read(JS + 'core/money-format.js'));
    return { dom, win, $, P: win.PosnicPro };
}

test('show() renumbers report figures but never a cell the till reads back', () => {
    const { $, P, dom } = page('<span class="number" id="r">1250000</span>' +
        '<div id="RoundOff"><span>+</span><span class="number">0.40</span></div>');
    P.money.show($('span.number'));
    assert.equal($('#r').text(), '1.250.000');
    // tender-receipt.js reads #RoundOff as data: its text stays machine text.
    assert.equal($('#RoundOff .number').text(), '0.40');
    dom.window.close();
});

test('put() writes a figure from a number or its text, and survives a later .number(true, 2)', () => {
    const { $, P, dom } = page('<b id="a"></b><b id="b"></b>');
    P.money.put($('#a'), 110000);
    P.money.put($('#b'), '101,430.98');
    assert.equal($('#a').text(), '110.000');
    assert.equal($('#b').text(), '101.431');
    $('#a, #b').number(true, 2);
    assert.equal($('#a').text(), '110.000');
    P.money.put($('#a'), 500);
    assert.equal($('#a').text(), '500');
    dom.window.close();
});

test('an Indian rupee shop keeps two decimals', () => {
    const { $, P, dom } = page('<span class="number">1234.5</span><b id="t"></b>',
        { currencySign: '₹', countryid: 'IN', currency_setting: 'India Rupee / INR or ₹' });
    P.money.show($('span.number'));
    P.money.put($('#t'), 99);
    assert.equal($('span.number').text(), '1,234.50');
    assert.equal($('#t').text(), '99.00');
    dom.window.close();
});

/* ------------------------------------------------------------ sale view */

function saleView(withMoney) {
    const html = '<div id="sales_view"></div><table id="viewsale_edit_print_view"><tbody></tbody></table>' +
        '<div id="sale_view_payment_mode"></div><span id="total_amount_view"></span><span id="subtotal_amount_view"></span>' +
        '<span id="sale_view_tax"></span><table><tbody><tr id="round_off_view"></tr><tr id="extra_discount_view"></tr></tbody></table>' +
        '<div id="viewsale_return_print_view"></div><span id="return_total_amount_view"></span><span id="return_subtotal_amount_view"></span>' +
        '<div id="RoundOff"><span class="number">0.40</span></div>';
    const s = page(html, {}, { withMoney });
    s.$.fn.modal = function () { return this; };
    s.win.PosnicSalePayments = { rows: () => [{ method: 'Tiền mặt', amount: 110000 }] };
    Object.assign(s.P, {
        convertDate: (d) => d, formatQuantity: (q) => String(q), nestedTaxCalculation: () => [],
        timeZone: () => 'Asia/Ho_Chi_Minh'
    });
    s.win.eval('PosnicPro.sales = { view: {' + method('modules/js/sales_view.js', 'viewSaleData', 'showSalesEditPage') + '} };');
    s.P.sales.view.renderOrderEvidence = () => {};
    s.P.sales.view.viewSaleData({ data: {
        items: [{ item_name: 'Phở bò', item_price: 55000, item_quantity: 2, tax: 0, tax_type: 'exclusive',
            item_discount: 5000, item_discount_percentage: 0, igst_tax: 0, cgst_tax: 0, total_amount: 105000, tax_fields: [] }],
        items_return: [], items_total: 110000, items_subtotal: 101430.98, tax: 8569.02, discount: 0,
        round_off: 0.4, sale_extra_discount: 0, sale_process: 'Add', payment_status: 'Paid', date: '14/10/2026'
    } }, 'id');
    return s;
}

test('the sale view panel shows whole dong, grouped', () => {
    const { $, dom } = saleView(true);
    assert.equal($('#total_amount_view').text(), '110.000');
    assert.equal($('#subtotal_amount_view').text(), '101.431');
    assert.equal($('#sale_view_tax').text(), '8.569');
    assert.match($('#sale_view_payment_mode').text(), /₫ 110\.000/);
    const row = $('#viewsale_edit_print_view tbody').text();
    assert.match(row, /55\.000/);
    assert.match(row, /₫ 5\.000/); // the line discount, in money
    assert.doesNotMatch(row + $('#sales_view').text(), /110,000\.00|\.00\b/);
    // The till's round-off cell is left as data.
    assert.equal($('#RoundOff .number').text(), '0.40');
    dom.window.close();
});

test('without money-format the sale view panel is what it always was', () => {
    const { $, dom } = saleView(false);
    assert.equal($('#total_amount_view').text(), '110,000.00');
    assert.match($('#sale_view_payment_mode').text(), /₫ 110000\.00/);
    dom.window.close();
});

/* ------------------------------------------------------ sales return print */

test('a sales-return receipt prints whole dong and tells the ESC/POS reader how', () => {
    const html = '<div class="print-modal-body"><div id="receipt_wrapper">' +
        '<div class="print-invoice-table-content"></div><div class="tax_print_hide"></div>' +
        '<div class="row"><div class="invoice-footer-value">Sub Total</div><div class="invoice-footer-value print-subtotal"></div></div>' +
        '<div class="row"><div class="invoice-footer-value">Grand Total</div><div class="invoice-footer-value"><span class="print-total"></span></div></div>' +
        '<div class="print-payment-balance"></div><div id="extra_disc_standard_print"></div><div id="roundoff_standard_print"></div>' +
        '</div></div><div class="print-modal-a4-body"></div>';
    const { $, P, win, dom } = page(html);
    const printed = [];
    Object.assign(P, {
        printBarcode() {}, nestedTaxCalculation: () => [], toggleVisibility() {}, removeDuplicates: (a) => a,
        textOverflowPrintEllipsis: (t) => t, formatQuantity: (q) => String(q), printView: (h) => printed.push(h),
        get: (_params, done) => done({ type: 'success', data: {
            custom_data: { sales_id: 'S1', return_id: 'R1', date: '14/10/2026', gst: 'disable', sale_process: 'FullReturn' },
            return_data: [{ item_name: 'Phở bò', item_price: 55000, item_quantity: 2, item_tax: 0, item_tax_type: 'exclusive',
                item_discount: 0, item_discount_percentage: 0, item_return_discount: 0, item_igst_tax: 0, item_cgst_tax: 0,
                item_tax_fields: [], item_total_amount: 110000, roundOff: 0, extraDiscount: 5000, itemsTotalAmount: 105000 }]
        } })
    });
    win.eval('PosnicPro.sales = { view: {' + method('modules/js/sales_view.js', 'returnPrintSales', 'whatsappSale') + '} };');
    P.sales.view._isA4 = () => false;
    P.sales.view.returnPrintSales('id');
    assert.equal(printed.length, 1);
    assert.match(printed[0], /110\.000/);
    assert.match(printed[0], /-5\.000/);
    assert.doesNotMatch(printed[0], /110,000\.00|105000\.00/);
    const total = $('.print-total');
    assert.equal(total.text().trim(), '₫ 105.000');
    assert.equal(total.attr('data-currency-digits'), '0');
    assert.equal(total.attr('data-currency-group'), '.');
    win.eval(read(JS + 'core/receipt-data.js'));
    assert.equal(P.receiptData(printed[0]).total, 105000);
    dom.window.close();
});

/* ------------------------------------------------------------ purchase print */

test('a purchase printout reads back as 250000, not 250', () => {
    const { $, P, win, dom } = page('<div class="print-modal-body"><div id="receipt_wrapper" class="import-standard-print"></div></div>' +
        '<div class="print-modal-a4-body"><div class="import-print"></div></div>',
        { branch_id_set: 'b1', receiving_title: 'Phiếu nhập', printing_size: 'receipt_medium' });
    const item = { item_name: 'Gạo', item_quantity: 2, item_unit: 'bao', item_price: 125000, total_amount: 250000, item_total_amount: 250000,
        tax: 0, item_tax: 0, tax_type: 'exclusive', item_tax_type: 'exclusive', tax_fields: [], item_tax_fields: [], igst_tax: 0, cgst_tax: 0,
        item_igst_tax: 0, item_cgst_tax: 0, item_discount: 0, item_discount_percentage: 0 };
    const data = { receiving_id: 'PUR-7', items_subtotal: 250000, items_total: 250000, tax: 0, return_tax: 0, items: [item],
        items_return: [], receipt_barcode: false, supplier_name: 'Nhà cung cấp', created_date: '14/10/2026' };
    const calls = [];
    Object.assign(P, {
        receivings: {}, roundoff: false, resolvePrintType: () => 'standard', alert() {}, printBarcode() {},
        textOverflowPrintEllipsis: (t) => t, formatQuantity: (q) => String(q), nestedTaxCalculation: () => [], toggleVisibility() {},
        printView: (...args) => calls.push(args),
        get: (url, done) => {
            if (typeof url === 'object' && url.url === 'branches/getOneStore') {
                return done({ type: 'success', data: { branch_name: 'Kho', print_standard_html: read('api/src/json/print_standard_html.txt'),
                    print_a4html: read('api/src/json/print_a4html.txt') } });
            }
            done({ type: 'success', data });
        }
    });
    win.eval(read(JS + 'modules/js/receiving_view.js'));
    P.receivings.view.printReceivings('id', 'receiving');
    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /250\.000/);
    assert.doesNotMatch(calls[0][0], /250,000\.00|250000\.00/);
    win.eval(read(JS + 'core/receipt-data.js'));
    const receipt = P.receiptData(calls[0][0]);
    assert.equal(receipt.total, 250000);
    assert.equal(receipt.items[0].amount, 250000);
    assert.equal($('.print-total').attr('data-currency-group'), '.');
    dom.window.close();
});

/* ------------------------------------------------------------------ reports */

test('the sales summary report shows whole dong', () => {
    const ids = ['discounts', 'profit', 'refund', 'companyprice', 'excltaxval', 'incltaxval', 'netsale', 'netsaletax', 'dinein_total', 'takeaway_total'];
    const { $, P, win, dom } = page('<input class="sale_branch_value" value="b1"><input class="view_sale_report_daterange" value="a-b">' +
        ids.map((id) => '<div class="card"><span id="sale_summary_' + id + '"></span></div>').join(''));
    P.get = (_params, done) => done({ type: 'success', data: {
        discounts: 5000, gross_profit: 1250000.4, refunds: 0, cogs: 300000, sales_exclude_tax: 1000000, sales_include_tax: 1080000,
        net_sales: 1080000, net_sales_tax: 80000, order_type_summary: [{ dine_type: 'Take away', total_sales: 25000, sale_count: 1 }]
    } });
    const src = read(JS + 'modules/js/report_sales.js');
    const start = src.indexOf('PosnicPro.salesummaryreport = {');
    win.eval(src.slice(start, src.indexOf('\n};', start) + 3));
    P.salesummaryreport.summaryreportTable();
    assert.equal($('#sale_summary_profit').text(), '1.250.000');
    assert.equal($('#sale_summary_incltaxval').text(), '1.080.000');
    assert.equal($('#sale_summary_takeaway_total').text(), '25.000');
    dom.window.close();
});

test('a payment report with no saved precision uses the shop currency', () => {
    const { $, P, win, dom } = page('<input class="payment_branch_value" value="b"><input class="view_payment_report_daterange" value="a-b">' +
        '<table id="salePaymentType"><tbody></tbody></table>');
    P.get = (_params, done) => done({ type: 'success', data: { payment: [{ sales_payment_mode: 'Tiền mặt', sales_payment: 1250000, sales_count: 3 }] } });
    win.eval('PosnicPro.paymentreport = {' + method('modules/js/report_payment.js', 'paymentSaleReportView', 'paymentTableTabClick') + '};');
    P.paymentreport.paymentSaleReportView();
    assert.equal($('#salePaymentType .number').first().text(), '1.250.000');
    dom.window.close();
});

/* --------------------------------------------- customer-facing display, mail */

test('the customer display shows the cart totals in whole dong', async () => {
    const { $, P, win, dom } = page('<span class="sales_subtotal"></span><span class="sales_total"></span><span class="tax_value"></span>' +
        '<span class="discount_value"></span><span class="extra_discount_value"></span><div class="extra_discount_row"></div>' +
        '<div id="list_linelitem_parent"><div id="list_linelitem"></div></div>');
    const rows = { 1: { customer: [] }, 2: { branch: [] }, 3: { tender: [{ subtotal: '101430.98', total: '110000.00', tax: '8569.02', discount: '0.00' }] } };
    win.db = {
        customerDisplay: {
            get: (id) => Promise.resolve(rows[id]),
            where: () => ({ equals: () => ({ toArray: (cb) => cb([{ items: [{ name: 'Phở bò', qty: 2, price: 55000, discount: 0, tax: 0, total: 110000 }] }]) }) })
        }
    };
    const src = read(JS + 'modules/js/customer_view.js');
    win.eval(src.slice(0, src.indexOf('\n$(document).ready')));
    P.customerview.customer_display_update();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal($('.sales_total').text(), '110.000');
    assert.equal($('.sales_subtotal').text(), '101.431');
    assert.match($('#list_linelitem').text(), /₫ 55\.000/);
    assert.match($('#list_linelitem').text(), /₫ 110\.000/);
    dom.window.close();
});

test('the mailed receipt formats money the way the server says the shop does', () => {
    const html = ['subtotal', 'total', 'Credits', 'BalanceDue', 'discount', 'tax', 'roundoff'].map((k) => '<span class="customer_' + k + '_view"></span>').join('') +
        '<table id="customer_item_list"><tbody></tbody></table>';
    // A customer's browser: no shop settings at all.
    const { $, P, win, dom } = page(html, { currencySign: '', countryid: '', currency_setting: '' });
    Object.assign(P, {
        getAllUrlParams: () => ({ id: 'x' }), printBarcode() {}, nestedTaxCalculation: () => [], removeDuplicates: (a) => a,
        get: (_params, done) => done({ type: 'success', data: {
            branch_currency: '₫', branch_currency_digits: 0, branch_currency_group: '.', branch_currency_decimal: ',',
            sales_sub_total: 101430.98, total_amount: 110000, partial_balance: 0, payment_pending: 0, discount: 0, tax: 8569.02,
            round_off: 0, total_items: 1, items: [{ item_name: 'Phở bò', item_price: 55000, item_quantity: 2, tax: 0, tax_type: 'exclusive', item_discount: 0, item_discount_percentage: 0, tax_fields: [], igst_tax: 0, cgst_tax: 0 }]
        } })
    });
    const src = read(JS + 'modules/js/customer_mail.js');
    win.eval(src.slice(0, src.indexOf('\n};') + 3));
    P.customermail.customerMailPrint();
    assert.equal($('.customer_total_view').text(), '₫ 110.000');
    assert.equal($('.customer_subtotal_view').text(), '₫ 101.431');
    assert.match($('#customer_item_list').text(), /110\.000/);
    dom.window.close();
});
