/*
 * Money as the till shows it.
 *
 * Two separate faults met on a till in Vietnam, and both live here now.
 *
 * 1. THE NUMBER PLUGIN SPOKE THE BROWSER'S LANGUAGE.
 *
 *    `$('#sales_new_subtotal').number(v, 2)` leaves the separators to the
 *    plugin, and the plugin takes them from `new Number(1000).toLocaleString()`
 *    - the browser's own locale. Every reader in the till strips commas and
 *    parses (see tests/formatted-money-reads.test.js), which holds only while
 *    the browser is English. A Vietnamese, German or Indonesian browser wrote
 *    "101.430,98", the reader made it "101.43098", and the sale summary in
 *    the tender card printed a subtotal of 101.43 under a total of 110,000.
 *    The plugin's defaults are pinned below to the separators every reader
 *    expects, whatever language the browser speaks.
 *
 * 2. EVERY AMOUNT HAD TWO DECIMALS AND NO GROUPING.
 *
 *    The dong, the yen and the won have no minor unit, and "25000.00" is not
 *    how a price is written anywhere that uses them. `PosnicPro.money` knows
 *    the shop's currency precision (ISO 4217, through Intl) and the shop's
 *    digit grouping (from its country, falling back to the page language),
 *    and formats with both. The symbol stays in front, where every Posnic
 *    template already puts it.
 *
 * Much of the till keeps money IN the page - a cell's text is read back as the
 * line's price - so those cells must keep machine text ("22727.27"). For them
 * the formatted figure is painted over the text with CSS (data-pp-money and
 * ::after) and the text itself is never touched. Plain displays - tiles,
 * buttons, receipts - are simply written formatted.
 */
;(function (global) {
    'use strict';

    var $ = global.jQuery;

    /* --------------------------------------------------- 1. the plugin */
    if ($ && typeof $.number === 'function' && !$.number.__posnicPinned) {
        var original = $.number;
        $.number = function (value, decimals, decPoint, thousandsSep) {
            return original.call(this, value, decimals,
                decPoint === undefined ? '.' : decPoint,
                thousandsSep === undefined ? ',' : thousandsSep);
        };
        $.number.__posnicPinned = true;
        /* `$('span.number').number(true, 2)` re-reads every figure on the page.
           One renumber() already wrote in the shop's grouping is left alone. */
        var originalFn = $.fn.number;
        $.fn.number = function (flag) {
            if (flag === true) {
                var done = this.filter(function () {
                    return this.getAttribute && this.getAttribute('data-pp-shown') !== null &&
                        this.getAttribute('data-pp-shown') === this.textContent;
                });
                if (done.length) {
                    originalFn.apply(this.not(done), arguments);
                    return this;
                }
            }
            return originalFn.apply(this, arguments);
        };
    }

    /* ------------------------------------------------- 2. the currency */

    /*
     * Symbols that name one currency only. The shop's setting usually carries
     * the ISO code ("Vietnam Dong / VND or ₫"); a session that only kept the
     * symbol still needs to know the dong has no decimals.
     */
    var SYMBOL_CODES = {
        '₫': 'VND', 'đ': 'VND', 'VNĐ': 'VND', '₩': 'KRW', '₹': 'INR', 'Rp': 'IDR', '₱': 'PHP',
        '฿': 'THB', '₦': 'NGN', '₭': 'LAK', '៛': 'KHR', '₲': 'PYG', '€': 'EUR', '£': 'GBP',
        'RM': 'MYR', '৳': 'BDT', 'S$': 'SGD', 'HK$': 'HKD', 'A$': 'AUD', 'CA$': 'CAD',
        'NZ$': 'NZD', 'US$': 'USD', 'R$': 'BRL', '₺': 'TRY', '₪': 'ILS', '₴': 'UAH', '₽': 'RUB',
        'zł': 'PLN', 'Kč': 'CZK', 'Ft': 'HUF', 'KSh': 'KES', 'USh': 'UGX', 'TSh': 'TZS',
        'GH₵': 'GHS', 'د.ك': 'KWD', 'د.ب': 'BHD', 'ر.ع.': 'OMR', 'د.ا': 'JOD', 'د.إ': 'AED',
        'ر.س': 'SAR', 'ر.ق': 'QAR', 'FCFA': 'XAF', 'CFA': 'XOF'
    };

    function local(key) {
        try {
            if (global.PosnicPro && global.PosnicPro.local) return global.PosnicPro.local.get(key) || '';
            return (global.localStorage && global.localStorage.getItem(key)) || '';
        } catch (e) { return ''; }
    }

    function supported(code) {
        try { new Intl.NumberFormat('en', { style: 'currency', currency: code }); return true; } catch (e) { return false; }
    }

    function codeFrom(text) {
        var found = String(text || '').match(/\b[A-Z]{3}\b/g) || [];
        for (var i = 0; i < found.length; i++) { if (supported(found[i])) return found[i]; }
        return '';
    }

    function code() {
        var sign = String(local('currencySign') || '').trim();
        return codeFrom(local('currency_setting')) || codeFrom(local('currency_code')) ||
            (SYMBOL_CODES[sign] || '') || codeFrom(sign);
    }

    /* ISO 4217 minor units: VND, JPY, KRW 0; KWD, BHD 3; most others 2. */
    function digitsFor(iso) {
        if (!iso) return 2;
        try {
            return new Intl.NumberFormat('en', { style: 'currency', currency: iso }).resolvedOptions().maximumFractionDigits;
        } catch (e) { return 2; }
    }

    function digits() { return digitsFor(code()); }

    /*
     * Digit grouping follows the shop, not the cashier's browser: a shop in
     * Vietnam writes 25.000 whichever language its staff read the menus in.
     * The country gives the locale; the page language is the fallback.
     */
    var sepCache = {};
    function separatorsFor(locale) {
        var key = locale || '';
        if (sepCache[key]) return sepCache[key];
        var out = { group: ',', decimal: '.' };
        try {
            var parts = new Intl.NumberFormat(locale ? [locale, 'en'] : 'en', { useGrouping: true, minimumFractionDigits: 1 })
                .formatToParts(1234567.5);
            parts.forEach(function (p) {
                if (p.type === 'group') out.group = /\s/.test(p.value) ? ' ' : p.value;
                if (p.type === 'decimal') out.decimal = p.value;
            });
        } catch (e) { /* keep the defaults */ }
        if (out.group === out.decimal) out.group = out.decimal === '.' ? ',' : '.';
        sepCache[key] = out;
        return out;
    }

    function shopLocale() {
        var region = String(local('countryid') || '').trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(region) && global.Intl && Intl.Locale) {
            try { return new Intl.Locale('und', { region: region }).maximize().baseName; } catch (e) { /* fall through */ }
        }
        var lang = (global.document && global.document.documentElement && global.document.documentElement.lang) ||
            local('language_code') || '';
        return /^[a-z]{2,3}([-_][A-Za-z0-9]+)*$/.test(lang) ? lang.replace(/_/g, '-') : '';
    }

    function separators() { return separatorsFor(shopLocale()); }

    function round(value, places) {
        var d = places == null ? digits() : places;
        var n = Number(value);
        if (!isFinite(n)) return 0;
        // Exponent arithmetic, so 1.005 rounds to 1.01 rather than to 1.00.
        var r = Number(Math.round(Number(Math.abs(n) + 'e' + d)) + 'e-' + d) * (n < 0 ? -1 : 1);
        return r === 0 ? 0 : r;
    }

    /* "1234567.5" -> "1.234.567,50" with the given separators. */
    function group(fixed, seps) {
        var negative = fixed.charAt(0) === '-';
        var body = negative ? fixed.slice(1) : fixed;
        var parts = body.split('.');
        var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, seps.group);
        return (negative ? '-' : '') + whole + (parts[1] ? seps.decimal + parts[1] : '');
    }

    function number(value, places) {
        var d = places == null ? digits() : places;
        return group(round(value, d).toFixed(d), separators());
    }

    function format(value, places) {
        var sign = String(local('currencySign') || '').trim();
        return (sign ? sign + ' ' : '') + number(value, places);
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    /* For an input the cashier edits: precision, no grouping. */
    function fixed(value, places) {
        var d = places == null ? digits() : places;
        return round(value, d).toFixed(d);
    }

    /*
     * A number back out of text that may have been formatted in any of the
     * usual ways - "1,234.50", "1.234,50", "1234.5", "₫ 25.000".
     *
     * With separators given, the text is read as written with exactly those.
     * Without, the machine form wins whenever it is possible: a lone dot is a
     * decimal point, a lone comma before three digits is a thousands mark, and
     * when both appear the last one is the decimal point. That is what makes
     * "101.430,98" read as 101430.98 instead of 101.43.
     */
    function parse(input, seps) {
        if (typeof input === 'number') return isFinite(input) ? input : null;
        var text = String(input == null ? '' : input);
        var firstDigit = text.search(/\d/);
        if (firstDigit < 0) return null;
        var negative = /[-−]/.test(text.slice(0, firstDigit));
        var t;
        if (seps && seps.group !== undefined && seps.decimal !== undefined) {
            t = text.replace(/[\s  ]/g, '');
            if (seps.group && seps.group.trim()) t = t.split(seps.group).join('');
            t = t.split(seps.decimal).join('.').replace(/[^\d.]/g, '');
        } else {
            t = text.replace(/[^\d.,]/g, '');
            var dot = t.lastIndexOf('.');
            var comma = t.lastIndexOf(',');
            if (dot > -1 && comma > -1) {
                var dec = dot > comma ? '.' : ',';
                t = t.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
            } else if (comma > -1) {
                var commas = t.split(',').length - 1;
                t = commas === 1 && !/^\d{3}$/.test(t.slice(comma + 1)) ? t.replace(',', '.') : t.replace(/,/g, '');
            } else if (dot > -1 && t.split('.').length > 2) {
                t = t.replace(/\./g, '');
            }
        }
        var n = parseFloat(t);
        if (!isFinite(n)) return null;
        return negative ? -n : n;
    }

    /*
     * The figures on a printed document, as text, with the separators the
     * reader of that document (receipt-data.js, the ESC/POS printer) is told
     * about through data attributes on the total.
     */
    function renumber($elements, places) {
        if (!$elements || !$elements.each) return;
        $elements.each(function () {
            var el = this;
            // Already written by this function: read the stored value, never
            // the grouped text ("135.000" must not come back as 135).
            var value = el.getAttribute('data-pp-shown') === el.textContent
                ? Number(el.getAttribute('data-pp-value')) : parse(el.textContent);
            if (value === null || !isFinite(value)) return;
            var shown = number(value, places);
            el.textContent = shown;
            el.setAttribute('data-pp-value', String(round(value, places == null ? digits() : places)));
            el.setAttribute('data-pp-shown', shown);
        });
    }

    /*
     * Figures on a report, a view panel or a printout that nothing reads back
     * - the places that used to call `$('span.number').number(true, 2)`.
     * Those selectors reach the whole page, so a cell the till keeps data in
     * (PAINTED below, or anything inside one) is left alone: the painter
     * shows it, and its text stays machine text.
     */
    function show($elements, places) {
        if (!$elements || !$elements.filter) return $elements;
        renumber($elements.filter(function () {
            return !(this.closest && this.closest(PAINTED));
        }), places);
        return $elements;
    }

    /* One display-only element: write the figure, remember the value. */
    function put($element, value, places) {
        if (!$element || !$element.each) return $element;
        // Callers hand over what .number(value, 2) took: a number or its text.
        var n = typeof value === 'number' ? value : parse(value);
        if (n === null || !isFinite(n)) n = 0;
        $element.each(function () {
            this.removeAttribute('data-pp-shown');
            this.textContent = String(n);
        });
        renumber($element, places);
        return $element;
    }

    /*
     * A printout's total tells the ESC/POS reader (receipt-data.js) how its
     * figures are written, so "135.000" is read back as 135000, not 135.
     */
    function markPrint($total, places) {
        if (!$total || !$total.attr) return $total;
        var seps = separators();
        return $total.attr({
            'data-currency-digits': places == null ? digits() : places,
            'data-currency-group': seps.group,
            'data-currency-decimal': seps.decimal
        });
    }

    /* ------------------------------------------- 3. figures kept in the page */

    /*
     * Cells whose TEXT is data. Dozens of reads in sales.js take
     * `$('#addSalesLineItemPrice_' + id).text()` as the price, so their text
     * must stay "22727.27". What the cashier sees is drawn over it.
     */
    var PAINTED = [
        '#sales_new_subtotal', '#discount_sale_amount', '#tax', '#sales_new_grand_total',
        '#sales_new_balance_amount', '#refund_grand_total', '.tax-sales-line-total',
        '#tendered_subtotal', '#tendered_discount', '#tendered_tax', '.tendered_total',
        '#tendered_payment', '#tendered_balance', '#return_balance_amount',
        '#RoundOff .number',
        '[id^="addSalesLineItemPrice_"]', '[id^="addSalesLineTotal_"]'
    ].join(',');

    /* Only when it changes what is on screen: an English rupee till keeps its
       text exactly as it was, and nothing is drawn over it. */
    function differs() {
        var seps = separators();
        return digits() !== 2 || seps.decimal !== '.';
    }

    function paint(el) {
        if (!el || el.nodeType !== 1 || el.children.length) return;
        var text = el.textContent;
        if (el.__ppMoneyText === text && el.__ppMoneyKey === paintKey) return;
        el.__ppMoneyText = text;
        el.__ppMoneyKey = paintKey;
        var value = /\d/.test(text) ? parse(text) : null;
        if (value === null || !paintOn) {
            if (el.hasAttribute('data-pp-money')) el.removeAttribute('data-pp-money');
            return;
        }
        if (!el.style.getPropertyValue('--pp-money-size')) {
            var size = global.getComputedStyle ? global.getComputedStyle(el).fontSize : '';
            if (size && size !== '0px') el.style.setProperty('--pp-money-size', size);
        }
        el.setAttribute('data-pp-money', number(value));
        // A screen reader reads the figure that is shown, not the stored one.
        el.setAttribute('aria-label', number(value));
    }

    var paintOn = false;
    var paintKey = '';
    function repaintAll() {
        var doc = global.document;
        if (!doc || !doc.querySelectorAll) return;
        paintOn = differs();
        paintKey = code() + '|' + JSON.stringify(separators());
        var list = doc.querySelectorAll(PAINTED);
        for (var i = 0; i < list.length; i++) paint(list[i]);
    }

    function installPainter() {
        var doc = global.document;
        if (!doc || !global.MutationObserver || installPainter.done) return;
        installPainter.done = true;
        var style = doc.createElement('style');
        style.id = 'pp-money-style';
        style.textContent =
            '[data-pp-money]{font-size:0!important;letter-spacing:0!important;}' +
            '[data-pp-money]::after{content:attr(data-pp-money);font-size:var(--pp-money-size,14px);}';
        (doc.head || doc.documentElement).appendChild(style);
        var pending = [];
        var scheduled = false;
        var flush = function () {
            scheduled = false;
            var batch = pending; pending = [];
            for (var i = 0; i < batch.length; i++) paint(batch[i]);
        };
        var queue = function (el) {
            pending.push(el);
            if (!scheduled) { scheduled = true; (global.queueMicrotask || setTimeout)(flush); }
        };
        new global.MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                var target = r.target.nodeType === 1 ? r.target : r.target.parentElement;
                if (target && target.closest) {
                    var hit = target.closest(PAINTED);
                    if (hit) queue(hit);
                }
                for (var j = 0; j < r.addedNodes.length; j++) {
                    var node = r.addedNodes[j];
                    if (node.nodeType !== 1) continue;
                    if (node.matches && node.matches(PAINTED)) queue(node);
                    if (node.querySelectorAll) {
                        var inner = node.querySelectorAll(PAINTED);
                        for (var k = 0; k < inner.length; k++) queue(inner[k]);
                    }
                }
            }
        }).observe(doc.documentElement, { childList: true, characterData: true, subtree: true });
        repaintAll();
        // Settings or another tab changed the currency or the country.
        if (global.addEventListener) {
            global.addEventListener('storage', function () { sepCache = {}; repaintAll(); });
        }
    }

    var api = {
        code: code,
        digits: digits,
        digitsFor: digitsFor,
        separators: separators,
        separatorsFor: separatorsFor,
        round: round,
        number: number,
        format: format,
        html: function (value, places) { return escapeHtml(format(value, places)); },
        fixed: fixed,
        parse: parse,
        group: group,
        renumber: renumber,
        show: show,
        put: put,
        markPrint: markPrint,
        repaint: repaintAll,
        PAINTED: PAINTED
    };

    if (typeof module === 'object' && module.exports) module.exports = api;
    if (global.PosnicPro) {
        global.PosnicPro.money = api;
    }
    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', installPainter);
        } else {
            installPainter();
        }
    }
}(typeof window !== 'undefined' ? window : globalThis));
