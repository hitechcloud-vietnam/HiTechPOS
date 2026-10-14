/*
 * HiTechPOS: the Vietnamese thermal template (api/src/json/print_standard_html_vi.txt)
 * finished after sales_view.js has filled it.
 *
 * Posnic fills a receipt template by class name (renderSaleDocument). That
 * fills the shop, the date and the totals, but it writes the document title
 * in English, three item columns, one "Tax" figure and no total in words. A
 * Vietnamese bill needs HOÁ ĐƠN BÁN HÀNG, Tên hàng | SL | Đơn giá | T.Tiền,
 * VAT per rate and "Bằng chữ". This runs straight after renderSaleDocument
 * and only touches a template that carries data-vn-bill, so every other
 * template - the stock one, a shop's own - prints exactly as before.
 *
 * The pure parts (words, VAT groups, dates) live in api/src/helpers/vn-bill.js.
 */
(function () {
    'use strict';
    var vn = window.PosnicVnBill;
    if (!vn || !window.PosnicPro) return;

    function esc(value) { return $('<i>').text(value == null ? '' : String(value)).html(); }
    function num(value) { var n = Number(value); return Number.isFinite(n) ? n : 0; }
    function digits() { return PosnicPro.money ? PosnicPro.money.digits() : 0; }
    function figure(value) {
        return PosnicPro.money ? PosnicPro.money.number(num(value), digits()) : num(value).toFixed(digits());
    }
    function money(value) {
        var sign = PosnicPro.local.get('currencySign') || '';
        return (sign ? esc(sign) + '&nbsp;' : '') + esc(figure(value));
    }
    function footerRow(cls, label, value) {
        return '<div class="row ' + cls + '"><div class="col-md-8 col-sm-8 col-xs-6"><div class="invoice-footer-value">' + esc(label) +
            '</div></div><div class="col-md-4 col-sm-4 col-xs-6"><div class="invoice-footer-value invoice-payment text-right">' + value + '</div></div></div>';
    }

    /* The lines as printed: name, quantity, unit price and amount, before tax. */
    function lines(data, name) {
        if (name === 'sale' && Array.isArray(data.receipt_line_rows) && data.receipt_line_rows.length) {
            return data.receipt_line_rows.map(function (l) {
                return { name: l.name, qty: l.qty, unit: l.unit, price: num(l.rate), amount: num(l.amount) };
            });
        }
        var source = name === 'sale' ? (data.items || []) : [];
        if (name !== 'sale') {
            (data.items_return || []).forEach(function (r) {
                var values = r && r.returnArray && r.returnArray.returnValue;
                if (values) $.each(values, function (_k, v) { source.push(v); });
            });
        }
        return source.filter(function (it) { return it && (it.item_name || it.name); }).map(function (it) {
            var rate = num(it.tax);
            var price = it.tax_type === 'exclusive' || !rate ? num(it.item_price) : num(it.item_price) / (1 + rate / 100);
            var qty = num(it.item_quantity);
            return {
                name: PosnicPro.printItemName ? PosnicPro.printItemName(it, 'receipt') : (it.item_name || it.name),
                qty: PosnicPro.formatQuantity ? PosnicPro.formatQuantity(qty, it.item_unit) : String(qty),
                unit: it.item_unit, price: price, amount: price * qty
            };
        });
    }

    function itemRows(list) {
        var max = PosnicPro.local.get('printing_max_char');
        return list.map(function (l) {
            var title = PosnicPro.textOverflowPrintEllipsis ? PosnicPro.textOverflowPrintEllipsis(l.name, max, true) : l.name;
            return '<div class="row receipt-row-item-holder" style="margin-top:6px;">' +
                '<div class="col-md-4 col-sm-4 col-xs-4"><div class="invoice-content invoice-con"><div class="invoice-content-heading">' + esc(title) + '</div></div></div>' +
                '<div class="col-md-2 col-sm-2 col-xs-2 gift_receipt_element"><div class="invoice-content item-qty text-left">' + esc(l.qty) + '</div></div>' +
                '<div class="col-md-3 col-sm-3 col-xs-3 gift_receipt_element"><div class="invoice-content item-price text-right">' + esc(figure(l.price)) + '</div></div>' +
                '<div class="col-md-3 col-sm-3 col-xs-3 gift_receipt_element"><div class="invoice-content item-total pull-right">' + esc(figure(l.amount)) + '</div></div></div>';
        }).join('');
    }

    var HEAD = '<div class="col-md-4 col-sm-4 col-xs-4"><div class="invoice-head text-left item-name"><strong>' + esc(vn.LABELS.item) + '</strong></div></div>' +
        '<div class="col-md-2 col-sm-2 col-xs-2"><div class="invoice-head text-left item-qty"><strong>' + esc(vn.LABELS.qty) + '</strong></div></div>' +
        '<div class="col-md-3 col-sm-3 col-xs-3"><div class="invoice-head text-right item-price"><strong>' + esc(vn.LABELS.price) + '</strong></div></div>' +
        '<div class="col-md-3 col-sm-3 col-xs-3"><div class="invoice-head pull-right item-total gift_receipt_element"><strong>' + esc(vn.LABELS.amountShort) + '</strong></div></div>';

    var ORDER_TYPES = { 'dine-in': 'Tại chỗ', 'dine in': 'Tại chỗ', takeaway: 'Mang về', 'take away': 'Mang về', delivery: 'Giao hàng' };

    /**
     * Finish a Vietnamese template already filled by renderSaleDocument.
     * @param scope jQuery element holding the rendered template
     */
    function decorate(scope, data, name, isKotPrint) {
        var $bill = scope.find('[data-vn-bill]');
        if (!$bill.length || !data) return false;
        var L = vn.LABELS;
        var sale = name === 'sale';

        if (sale) {
            var paidReceipt = !isKotPrint && !!data.sales_id;
            $bill.find('.print-title').html('<span style="font-weight:900; letter-spacing:1px;">' +
                esc(paidReceipt ? L.title : L.provisionalTitle) + '</span>');
        }
        $bill.find('.print_view_id').each(function () { $(this).text($(this).text().replace(/^#/, '')); });
        $bill.find('.print_date').each(function () {
            $(this).text(vn.billDateTime($(this).text(), { order: data.receipt_date_order }));
        });
        var cashier = [data.user_name, data.created_by_name, data.created_by].filter(function (v) {
            return v != null && String(v).trim() !== '';
        })[0];
        if (cashier) {
            $bill.find('.vn-cashier').text(String(cashier).trim());
            $bill.find('.vn-cashier-row').show();
        }
        $bill.find('.print-table-number-row').each(function () {
            var table = $(this).find('.print-table-number').text();
            $(this).html('<strong>' + esc(L.table) + ': ' + esc(table) + '</strong>');
        });
        $bill.find('.print-order-type').each(function () {
            var t = $(this).text();
            $(this).text(ORDER_TYPES[String(t).trim().toLowerCase()] || t);
        });

        // Four columns: Tên hàng | SL | Đơn giá | T.Tiền.
        var list = lines(data, name);
        if (list.length) {
            $bill.find('.vn-items-head').html(HEAD);
            $bill.find('.print-invoice-table-content').html(itemRows(list));
        }

        // VAT per rate, in place of Posnic's single tax block.
        var groups = [];
        if (sale) {
            groups = data.transferred_bill && Array.isArray(data.receipt_tax_rows)
                ? data.receipt_tax_rows : vn.vatGroups(data.items, data.tax, { digits: digits() });
        }
        var $vat = $bill.find('.vn-vat-rows').empty().hide();
        if (groups.length) {
            $vat.html(groups.map(function (g) { return footerRow('vn-vat-row', g.label, money(g.amount)); }).join('')).show();
            $bill.find('.tax_detail_print_hideShow, .tax-print-hideshow').hide();
        }

        // Posnic's own extra rows carry English labels.
        $bill.find('lang.lang_extra_disc_2').text(L.extraDiscount);
        $bill.find('lang.lang_round_off_3').text(L.roundOff);
        $bill.find('.print-payment-heading').remove();

        // Bằng chữ.
        var total = sale ? num(data.items_total) : (data.items_return || []).reduce(function (s, r) {
            return s + num(r && r.returnArray && r.returnArray.itemsTotalAmount);
        }, 0);
        try {
            $bill.find('.vn-amount-in-words').text(vn.amountInWords(total));
            $bill.find('.vn-words-row').show();
        } catch (e) { $bill.find('.vn-words-row').hide(); }

        // Tenders in Vietnamese, and the change handed back.
        $bill.find('.print-invoice-payment-mode .payment-method').each(function () {
            $(this).text(vn.paymentLabel($(this).text()));
        });
        $bill.find('.vn-change-row').remove();
        if (sale && !isKotPrint && window.PosnicSalePayments) {
            var change = vn.paymentLines(PosnicSalePayments.rows(data), data.items_total, { digits: digits() })
                .filter(function (l) { return l.change; })[0];
            if (change) {
                $bill.find('.print-invoice-payment-mode').closest('.row')
                    .after(footerRow('vn-change-row', change.label, money(change.amount)));
            }
        }

        var $footer = $bill.find('.footer-content');
        if (/^\s*(Thank you for shopping\.*!?)?\s*$/.test($footer.text())) $footer.text(L.thanks);
        return true;
    }

    PosnicPro.vnBill = { decorate: decorate, lines: lines };

    /* Run after every renderSaleDocument, on whichever document it filled. */
    function install() {
        var view = PosnicPro.sales && PosnicPro.sales.view;
        if (!view || typeof view.renderSaleDocument !== 'function' || view.renderSaleDocument.vnBill) return !!view;
        var original = view.renderSaleDocument;
        var wrapped = function (data, name, isKotHistoryPrint, root) {
            var result = original.apply(this, arguments);
            try {
                decorate(root || $('.print-modal-body'), data, name, !!isKotHistoryPrint);
            } catch (e) {
                // A Vietnamese finish must never stop a receipt from printing.
                if (window.console) console.warn('[vn-bill]', e && e.message);
            }
            return result;
        };
        wrapped.vnBill = true;
        view.renderSaleDocument = wrapped;
        return true;
    }
    if (!install()) $(install);
}());
