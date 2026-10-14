'use strict';

/*
 * Money in a shop whose currency has no minor unit, or whose browser does not
 * speak English.
 *
 * Reported from a till in Vietnam (VND, Vietnamese browser): product tiles read
 * "₫ 25000.00", and the tender card's sale summary printed "Sub Total ₫ 101.43"
 * and "Tax Total ₫ 8.57" under "Grand Total ₫ 110,000.00". The jQuery Number
 * plugin took its separators from the browser locale and wrote "101.430,98";
 * the reader stripped commas and parsed 101.43098.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

/* A page whose browser formats numbers the Vietnamese way. */
function page(settings = {}, { vietnameseBrowser = true, withMoney = true } = {}) {
    const dom = new JSDOM('<!doctype html><html lang="vi"><body></body></html>',
        { url: 'http://localhost/', runScripts: 'outside-only' });
    const win = dom.window;
    if (vietnameseBrowser) {
        win.eval(`(function () {
            var original = Number.prototype.toLocaleString;
            Number.prototype.toLocaleString = function (locale, options) {
                return original.call(this, locale || 'vi-VN', options);
            };
        }());`);
    }
    const $ = require('jquery')(win);
    win.$ = win.jQuery = $;
    win.eval(read('frontend/static/script/js/jquery.number.min.js'));
    const store = { currencySign: '₫', countryid: 'VN', ...settings };
    win.PosnicPro = { local: { get: (key) => (key in store ? store[key] : '') } };
    if (withMoney) win.eval(read('frontend/static/script/js/core/money-format.js'));
    return { win, $, money: win.PosnicPro.money };
}

test('the unpinned plugin really does write the browser locale (the bug)', () => {
    const { $ } = page({}, { withMoney: false });
    assert.equal($('<span>').number(101430.98, 2).text(), '101.430,98');
});

test('with money-format loaded .number() writes the separators every reader strips', () => {
    const { $ } = page();
    const span = $('<span>').number(101430.98, 2);
    assert.equal(span.text(), '101,430.98');
    // The reader every till path uses.
    assert.equal(parseFloat(span.text().replace(/,/g, '')), 101430.98);
});

test('a figure written in any common form parses to the right value', () => {
    const { money } = page();
    assert.equal(money.parse('101.430,98'), 101430.98);
    assert.equal(money.parse('8.569,02'), 8569.02);
    assert.equal(money.parse('1,240.00'), 1240);
    assert.equal(money.parse('22727.27'), 22727.27);
    assert.equal(money.parse('₫ 110,000.00'), 110000);
    assert.equal(money.parse('-12,5'), -12.5);
    assert.equal(money.parse('1.234.567'), 1234567);
    assert.equal(money.parse('₫ 25.000', { group: '.', decimal: ',' }), 25000);
    assert.equal(money.parse(''), null);
});

test('VND has no decimals and is grouped the Vietnamese way', () => {
    const { money } = page();
    assert.equal(money.code(), 'VND');
    assert.equal(money.digits(), 0);
    assert.deepEqual({ ...money.separators() }, { group: '.', decimal: ',' });
    assert.equal(money.number(25000), '25.000');
    assert.equal(money.number(22727.27), '22.727');
    assert.equal(money.format(500000), '₫ 500.000');
    assert.equal(money.fixed(135000), '135000');
    assert.equal(money.number(-0.4), '0');
});

test('the ISO code in the currency setting decides the precision', () => {
    const cases = [['Japan Yen / JPY or ¥', 0], ['Korea Won / KRW or ₩', 0],
        ['Kuwait Dinar / KWD', 3], ['India Rupee / INR or ₹', 2]];
    for (const [text, digits] of cases) {
        const { money } = page({ currency_setting: text, currencySign: '?' });
        assert.equal(money.digits(), digits, text);
    }
});

test('an English rupee till is left exactly as it was', () => {
    const { money, win } = page({ currencySign: '₹', countryid: 'IN' }, { vietnameseBrowser: false });
    assert.equal(money.digits(), 2);
    assert.equal(money.number(1234.5), '1,234.50');
    const cell = win.document.createElement('td');
    cell.id = 'addSalesLineTotal_1';
    cell.textContent = '1234.50';
    win.document.body.appendChild(cell);
    money.repaint();
    assert.equal(cell.getAttribute('data-pp-money'), null);
});

test('a cart cell keeps its machine text and shows the shop figure', async () => {
    const { win } = page();
    const cell = win.document.createElement('td');
    cell.id = 'addSalesLineItemPrice_7';
    cell.textContent = '22727.27';
    win.document.body.appendChild(cell);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(cell.textContent, '22727.27');
    assert.equal(cell.getAttribute('data-pp-money'), '22.727');
    cell.textContent = '78703.70';
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(cell.getAttribute('data-pp-money'), '78.704');
});

test('receipt figures are renumbered once and survive a later .number(true, 2)', () => {
    const { $, money } = page();
    const spans = $('<div><span class="number">101430.98</span><span class="number">110000.00</span></div>').find('span');
    money.renumber(spans, 0);
    assert.deepEqual(spans.map((_, e) => e.textContent).get(), ['101.431', '110.000']);
    money.renumber(spans, 0);
    spans.number(true, 2);
    assert.deepEqual(spans.map((_, e) => e.textContent).get(), ['101.431', '110.000']);
});

test('the tender preview reads a Vietnamese-formatted subtotal as 101430.98, not 101.43', () => {
    for (const withMoney of [false, true]) {
        const { win, $ } = page({}, { withMoney });
        $('body').html('<table id="sales_new_items_table"><tbody></tbody></table>' +
            '<span id="sales_new_subtotal">101.430,98</span><span id="tax">8.569,02</span>' +
            '<span class="tendered_total">110,000.00</span><span id="discount_sale_amount">0,00</span>' +
            '<span id="extraDisc"></span><span id="percentIcon" class="d-none"></span><span id="RoundOff"></span>');
        win.PosnicPro.sales = { charges: [] };
        win.moment = () => ({ format: () => '14/10/2026 9:00 AM' });
        win.eval(read('frontend/static/script/js/core/tender-receipt.js'));
        const data = win.PosnicPro.tenderReceipt.cartData({});
        assert.equal(data.items_subtotal, 101430.98, `subtotal, money-format loaded: ${withMoney}`);
        assert.equal(data.tax, 8569.02);
        assert.equal(data.items_total, 110000);
    }
});

test('the ESC/POS reader takes the receipt at its word about separators', () => {
    const { win } = page();
    win.PosnicPro.BRAND_URL = 'https://www.posnic.com';
    win.eval(read('frontend/static/script/js/core/receipt-data.js'));
    const row = (label, value, cls = '') => '<div class="row"><div class="invoice-footer-value">' + label +
        '</div><div class="invoice-footer-value ' + cls + '">' + value + '</div></div>';
    const html = '<div>' + row('Sub Total', '₫ 101.431') + row('Tax Total', '₫ 8.569') +
        row('Grand Total', '<span class="print-total" data-currency-digits="0" data-currency-group="." data-currency-decimal=",">₫ 110.000</span>') +
        '</div>';
    const sale = win.PosnicPro.receiptData(html);
    assert.equal(sale.total, 110000);
    assert.equal(sale.subTotal, 101431);
    assert.equal(sale.currencyDigits, 0);
    assert.equal(sale.currencyGroup, '.');
    assert.equal(sale.currencyDecimal, ',');
    // An older receipt with no marks still reads "1,234.50" as before.
    const old = win.PosnicPro.receiptData('<div>' + row('Grand Total', 'Rs. 1,234.50') + '</div>');
    assert.equal(old.total, 1234.5);
    assert.equal(old.currencyGroup, undefined);
});

test('the thermal roll prints whole dong, grouped', () => {
    const { renderSale } = require('../src/escpos-receipt');
    const base = { storeName: 'Quan Pho', items: [{ name: 'Pho bo', qty: '1', amount: 110000 }],
        subTotal: 101430.98, taxes: [{ label: 'VAT 8%', amount: 8569.02 }], total: 110000, currency: 'd' };
    const grouped = Buffer.from(renderSale({ ...base, currencyDigits: 0, currencyGroup: '.', currencyDecimal: ',' })).toString('latin1');
    assert.match(grouped, /d110\.000/);
    assert.match(grouped, /d101\.431/);
    assert.doesNotMatch(grouped, /110000\.00/);
    const plain = Buffer.from(renderSale({ ...base, currencyDigits: 2 })).toString('latin1');
    assert.match(plain, /d110000\.00/);
});
