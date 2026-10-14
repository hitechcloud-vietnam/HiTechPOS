'use strict';

/*
 * HiTechPOS: the bill a Vietnamese shop prints.
 *
 * Two paths put a sale on paper. The receipt designer (core/receipt-designer.js)
 * prints every sale and the tender preview; the shop's legacy thermal template
 * (branch.thermal_body_print, filled by sales_view.js renderSaleDocument) still
 * prints returns and anything without the designer. Both must read as a
 * Vietnamese bill - HOÁ ĐƠN BÁN HÀNG, MST, Tên hàng | SL | Đơn giá | T.Tiền,
 * VAT per rate, "Bằng chữ", change - and neither may change a non-Vietnamese
 * shop's receipt.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const core = read('frontend/static/script/js/core/PosnicPro.js');
const stockThermal = read('api/src/json/print_standard_html.txt');
const viThermal = read('api/src/json/print_standard_html_vi.txt');
const vnBill = require('../api/src/helpers/vn-bill');

const VN_BRANCH = {
    branch_name: 'Quán Phố Tuệ', printing_address: '12 Hàng Bạc, Hoàn Kiếm, Hà Nội',
    store_telephone: '0901234567', store_email: '', branch_gstin_number: '0101234567',
    country: 'Vietnam', country_id: 'VN', currency_value: [{ currency_text: 'VND', currency_sign: '₫' }],
    footer_print: 'Thank you for shopping...!', print_logoimg: false, customer_print: false,
    print_type: 'standard', print_width: '80', table_options: true
};
const VN_SALE = {
    ...VN_BRANCH,
    sales_id: 'HD000123', receipt_date: '10/14/2026 03:30 pm', receipt_date_order: 'mdy',
    user_name: 'Lan', table_number: '5', payment_status: 'Paid', payment_mode: 'Cash',
    multi_payment: '[{"method":"Cash","amount":200000}]',
    items: [
        { item_name: 'Cà phê sữa đá', item_price: 25000, item_quantity: 2, item_unit: 'ly', tax: 8, tax_type: 'exclusive',
            tax_name: 'Thuế GTGT 8%', tax_fields: [], total_amount: 54000, item_discount: 0, item_discount_percentage: 0, igst_tax: 0, cgst_tax: 0 },
        { item_name: 'Bánh mì', item_price: 30000, item_quantity: 1, item_unit: 'cái', tax: 10, tax_type: 'exclusive',
            tax_name: 'Thuế GTGT 10%', tax_fields: [], total_amount: 33000, item_discount: 0, item_discount_percentage: 0, igst_tax: 0, cgst_tax: 0 },
        { item_name: 'Nước suối', item_price: 10000, item_quantity: 1, item_unit: 'chai', tax: 0, tax_type: 'exclusive',
            tax_name: 'KCT-Không chịu thuế', tax_fields: [], total_amount: 10000, item_discount: 0, item_discount_percentage: 0, igst_tax: 0, cgst_tax: 0 }
    ],
    items_return: [], items_subtotal: 90000, discount: 0, tax: 7000, sale_extra_discount: 0, round_off: 0,
    items_total: 97000, charges: []
};

function window(settings) {
    const dom = new JSDOM('<!doctype html><div class="print-modal-body"></div>', { url: 'http://localhost/', runScripts: 'outside-only' });
    const w = dom.window;
    const $ = require('jquery')(w);
    w.$ = w.jQuery = $;
    w.eval(read('frontend/static/script/js/jquery.number.min.js'));
    w.PosnicPro = {
        escapeHtml: (v) => $('<i>').text(v).html(),
        local: { get: (key) => settings[key] || '', set: () => {} },
        i18n: { t: (_key, text) => text },
        BRAND_URL: 'https://hitechpos.vn',
        sales: { SaleAction: 'add', charges: [] }, measuredUnits: ['kg', 'g'], baseUrl: 'http://localhost/'
    };
    w.eval(read('frontend/static/script/js/core/money-format.js'));
    w.eval(read('api/src/helpers/sale-payment-summary.js'));
    w.eval(read('api/src/helpers/receipt-design.js'));
    w.eval(read('src/receipt-page-layout.js'));
    return { dom, w, $ };
}

function designer(settings) {
    const env = window(settings);
    env.w.eval(read('api/src/helpers/vn-bill.js'));
    env.w.eval(read('frontend/static/script/js/core/receipt-designer.js'));
    env.engine = env.w.PosnicPro.receiptDesigner;
    // Words as a reader sees them: no stylesheet, and cells/spans apart.
    env.text = (html) => env.$('<div>').html(html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/></g, '> <'))
        .text().replace(/\s+/g, ' ');
    return env;
}

const VN_SETTINGS = { currencySign: '₫', countryid: 'VN', currency_setting: 'Vietnam Dong / VND or ₫' };

test('designer: a paid Vietnamese sale prints a Vietnamese bill on the roll', () => {
    const { dom, engine, text, $ } = designer(VN_SETTINGS);
    const sale = { ...VN_SALE, receipt_designs: engine.defaults(VN_SALE) };
    const html = engine.render(sale, '80', false);
    const t = text(html);
    assert.match(t, /HOÁ ĐƠN BÁN HÀNG/);
    assert.match(t, /Số: HD000123/);
    assert.match(t, /Ngày: 14\/10\/2026 15:30/, 'dd/mm/yyyy HH:mm in the shop clock');
    assert.match(t, /Thu ngân: Lan/);
    assert.match(t, /Bàn: 5/);
    assert.match(t, /ĐT: 0901234567/);
    assert.match(t, /MST: 0101234567/);
    assert.doesNotMatch(t, /GSTIN|Tax ID|Receipt|Subtotal|Grand Total/);

    const heads = $('<div>').html(html).find('.rd-block-items th').map((_i, th) => $(th).text()).get();
    assert.deepEqual(heads, ['Tên hàng', 'SL', 'Đơn giá', 'T.Tiền'], 'quantity before unit price');
    const first = $('<div>').html(html).find('.rd-block-items tbody tr').first().find('td').map((_i, td) => $(td).text()).get();
    assert.deepEqual(first, ['Cà phê sữa đá', '2', '25.000', '54.000']);

    assert.match(t, /Tạm tính ₫ 90\.000/);
    assert.match(t, /Thuế GTGT 8% ₫ 4\.000/);
    assert.match(t, /Thuế GTGT 10% ₫ 3\.000/);
    assert.match(t, /Không chịu thuế \(KCT\) ₫ 0/);
    assert.match(t, /Tổng cộng ₫ 97\.000/);
    assert.match(t, /Bằng chữ: Chín mươi bảy nghìn đồng chẵn\./);
    assert.match(t, /Tiền mặt ₫ 200\.000/);
    assert.match(t, /Tiền thừa trả khách ₫ 103\.000/);
    assert.match(t, /Cảm ơn quý khách và hẹn gặp lại!/, 'the installer English footer is replaced');
    assert.doesNotMatch(t, /Thank you for shopping/);
    dom.window.close();
});

test('designer: before payment it is a PHIẾU TẠM TÍNH, without tenders', () => {
    const { dom, engine, text } = designer(VN_SETTINGS);
    const sale = { ...VN_SALE, sales_id: '', receipt_designs: engine.defaults(VN_SALE) };
    const t = text(engine.render(sale, '58', true));
    assert.match(t, /PHIẾU TẠM TÍNH/);
    assert.doesNotMatch(t, /HOÁ ĐƠN BÁN HÀNG|Tiền mặt|Tiền thừa/);
    assert.match(t, /Bằng chữ: Chín mươi bảy nghìn đồng chẵn\./);
    dom.window.close();
});

test('designer: the A4 invoice is Vietnamese too, and never reads the amount in rupees', () => {
    const { dom, engine, text } = designer(VN_SETTINGS);
    const sale = { ...VN_SALE, receipt_designs: engine.defaults(VN_SALE) };
    const t = text(engine.render(sale, 'a4', false));
    assert.match(t, /HOÁ ĐƠN BÁN HÀNG/);
    assert.match(t, /Tên hàng.*SL.*Đơn giá.*Thành tiền/);
    assert.match(t, /Bằng chữ: Chín mươi bảy nghìn đồng chẵn\./);
    assert.doesNotMatch(t, /Rupee|Amount in words/);
    dom.window.close();
});

test('designer: a shop that saved its own design keeps its blocks, in Vietnamese', () => {
    const { dom, engine, text } = designer(VN_SETTINGS);
    const design = engine.defaults(VN_SALE);
    design.layouts['80'].blocks = design.layouts['80'].blocks.filter((b) => b.type !== 'text');
    design.layouts['80'].blocks.push(engine.block('text', { text: 'Wifi: photue2026' }));
    const t = text(engine.render({ ...VN_SALE, receipt_designs: design }, '80', false));
    assert.match(t, /Wifi: photue2026/);
    assert.doesNotMatch(t, /Cảm ơn quý khách/);
    assert.match(t, /HOÁ ĐƠN BÁN HÀNG/);
    dom.window.close();
});

test('designer: other shops print exactly what they printed before', () => {
    const india = { ...VN_SALE, country: 'India', country_id: 'IN', currency_value: [{ currency_text: 'INR', currency_sign: '₹' }] };
    const settings = { currencySign: 'Rs.', countryid: 'IN' };
    const withHelper = designer(settings);
    const without = window(settings);
    without.w.eval(read('frontend/static/script/js/core/receipt-designer.js'));
    const strip = (html) => html.replace(/data-block-id="[^"]*"/g, '');
    const design = without.w.PosnicPro.receiptDesigner.defaults(india);
    const a = withHelper.engine.render({ ...india, receipt_designs: design }, '80', false);
    const b = without.w.PosnicPro.receiptDesigner.render({ ...india, receipt_designs: design }, '80', false);
    assert.equal(strip(a), strip(b));
    assert.doesNotMatch(withHelper.text(a), /HOÁ ĐƠN|Bằng chữ|Tạm tính/);
    withHelper.dom.window.close();
    without.dom.window.close();
});

/* ------------------------------------------------- the legacy template --- */

function legacy(settings, withVn) {
    const env = window(settings);
    const { w } = env;
    for (const key of ['isMeasuredUnit', 'formatQuantity', 'removeDuplicates', 'textOverflowPrintEllipsis', 'nestedTaxCalculation', 'toggleVisibility']) {
        const start = core.indexOf('    ' + key + ': function');
        const end = core.indexOf('\n    },', start);
        w.eval('PosnicPro.' + key + ' = ' + core.slice(core.indexOf('function', start), end + 6) + ';');
    }
    const view = read('frontend/static/script/js/modules/js/sales_view.js');
    w.eval(view.slice(0, view.indexOf('\n};') + 3));
    if (withVn) {
        w.eval(read('api/src/helpers/vn-bill.js'));
        w.eval(read('frontend/static/script/js/core/vn-bill-print.js'));
    }
    env.render = (template, data, kot) => {
        const root = env.$('<div>').html('<div class="print-modal-body">' + template + '</div>');
        w.PosnicPro.sales.view.renderSaleDocument(data, 'sale', !!kot, root, '80');
        return root;
    };
    return env;
}

test('legacy template: the Vietnamese one is finished as a Vietnamese bill', () => {
    const { dom, render, $ } = legacy(VN_SETTINGS, true);
    const root = render(viThermal, VN_SALE);
    const t = root.text().replace(/\s+/g, ' ');
    assert.match(t, /HOÁ ĐƠN BÁN HÀNG/);
    assert.match(t, /Số: HD000123/);
    assert.match(t, /Ngày: 14\/10\/2026 15:30/);
    assert.match(t, /Thu ngân: Lan/);
    assert.match(t, /MST: 0101234567/);
    assert.deepEqual(root.find('.vn-items-head strong').map((_i, s) => $(s).text()).get(), ['Tên hàng', 'SL', 'Đơn giá', 'T.Tiền']);
    const row = root.find('.receipt-row-item-holder').first();
    assert.equal(row.find('.invoice-content-heading').text(), 'Cà phê sữa đá');
    assert.equal(row.find('.item-price').text(), '25.000');
    assert.equal(row.find('.item-total').text(), '50.000', 'before tax, as the subtotal is');
    assert.deepEqual(root.find('.vn-vat-row').map((_i, r) => $(r).find('.invoice-footer-value').map((_j, c) => $(c).text().replace(/\u00a0/g, ' ').trim()).get().join(' ')).get(),
        ['Thuế GTGT 8% ₫ 4.000', 'Thuế GTGT 10% ₫ 3.000', 'Không chịu thuế (KCT) ₫ 0']);
    assert.match(t, /Bằng chữ: Chín mươi bảy nghìn đồng chẵn\./);
    assert.match(root.find('.print-invoice-payment-mode').text(), /Tiền mặt/);
    assert.deepEqual(root.find('.vn-change-row .invoice-footer-value').map((_i, c) => $(c).text().replace(/\u00a0/g, ' ')).get(),
        ['Tiền thừa trả khách', '₫ 103.000']);
    assert.equal(root.find('.print-payment-heading').length, 0, 'the row already says Thanh toán');
    dom.window.close();
});

test('legacy template: a kitchen/table bill before payment is a PHIẾU TẠM TÍNH', () => {
    const { dom, render } = legacy(VN_SETTINGS, true);
    const root = render(viThermal, VN_SALE, true);
    assert.match(root.find('.print-title').text(), /PHIẾU TẠM TÍNH/);
    assert.equal(root.find('.vn-change-row').length, 0);
    dom.window.close();
});

test('legacy template: the stock template prints exactly as before', () => {
    const settings = { currencySign: 'Rs.', countryid: 'IN' };
    const data = { ...VN_SALE, country: 'India', country_id: 'IN', currency_value: [{ currency_text: 'INR' }] };
    const a = legacy(settings, true);
    const b = legacy(settings, false);
    assert.equal(a.render(stockThermal, data).html(), b.render(stockThermal, data).html());
    a.dom.window.close();
    b.dom.window.close();
});

/* ------------------------------------------------------- the seeding ---- */

test('the Vietnamese template is what a Vietnamese shop is seeded with, and the till loads its finish', () => {
    const templates = require('../api/src/helpers/print-templates');
    assert.equal(templates.thermalTemplateFor({ register_country: 'Vietnam', register_countryid: 'VN' }).replace(/\r\n/g, '\n'), viThermal);
    const map = JSON.parse(read('frontend/pages_css_js_map.json'));
    const js = map.dashboard.js;
    const at = (f) => js.indexOf(f);
    assert.ok(at('../api/src/helpers/vn-bill.js') > at('static/script/js/modules/js/sales_view.js'));
    assert.ok(at('static/script/js/core/vn-bill-print.js') > at('../api/src/helpers/vn-bill.js'));
    assert.ok(at('static/script/js/core/receipt-designer.js') > at('../api/src/helpers/vn-bill.js'));
    assert.equal(typeof vnBill.amountInWords, 'function');
});
