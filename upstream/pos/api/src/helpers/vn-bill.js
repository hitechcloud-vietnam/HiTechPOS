/* Vietnamese bill helpers. Loaded in the dashboard and required by the API. */
/* global window */
/*
 * HiTechPOS: what a Vietnamese shop's bill needs that Posnic's Indian-first
 * receipt did not have - the total read out in words ("Bằng chữ"), VAT shown
 * per rate (0/5/8/10%, KCT) instead of one "Tax" line or CGST/SGST halves,
 * dates as dd/mm/yyyy HH:mm, and Vietnamese labels.
 *
 * Pure functions only: no DOM, no database. The receipt designer, the legacy
 * thermal template, the server's bill payload and the tests all call the same
 * code, so the words on the paper cannot differ between paths.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PosnicVnBill = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

  /*
   * One group of three digits (0..999).
   * `full` - the group follows a larger one, so its hundreds are spoken even
   * when zero ("một nghìn KHÔNG TRĂM linh một") and a lone unit takes "linh".
   */
  function readGroup(n, full, o) {
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;
    const out = [];
    if (h > 0 || full) out.push(DIGITS[h], 'trăm');
    if (t === 0) {
      if (u > 0) {
        if (out.length) out.push(o.zeroTens);
        out.push(DIGITS[u]);
      }
    } else if (t === 1) {
      out.push('mười');
      if (u === 5) out.push('lăm');
      else if (u > 0) out.push(DIGITS[u]);
    } else {
      out.push(DIGITS[t], 'mươi');
      if (u === 1) out.push('mốt');
      else if (u === 4) out.push(o.useTu ? 'tư' : 'bốn');
      else if (u === 5) out.push('lăm');
      else if (u > 0) out.push(DIGITS[u]);
    }
    return out;
  }

  /* 0 < n < 1e9 as triệu / nghìn / units. */
  function readBelowBillion(n, full, o) {
    const scales = ['triệu', o.thousand, ''];
    const groups = [Math.floor(n / 1e6), Math.floor((n % 1e6) / 1e3), n % 1e3];
    const out = [];
    groups.forEach(function (g, i) {
      if (g === 0) return;
      out.push.apply(out, readGroup(g, full || out.length > 0, o));
      if (scales[i]) out.push(scales[i]);
    });
    return out;
  }

  /*
   * Any length of digits. "tỷ" repeats every nine digits, so 10^12 is
   * "một nghìn tỷ" and 10^15 "một triệu tỷ" - how amounts are read aloud.
   * Works on a digit string so a BigInt beyond 2^53 reads correctly too.
   */
  function readDigits(digits, full, o) {
    if (digits.length <= 9) return readBelowBillion(Number(digits), full, o);
    const high = digits.slice(0, -9).replace(/^0+/, '');
    const low = Number(digits.slice(-9));
    const out = high ? readDigits(high, full, o).concat('tỷ') : [];
    if (low > 0) out.push.apply(out, readBelowBillion(low, full || out.length > 0, o));
    return out;
  }

  function options(opts) {
    opts = opts || {};
    const o = {
      zeroTens: opts.zeroTens == null ? 'linh' : opts.zeroTens,
      useTu: opts.useTu == null ? true : !!opts.useTu,
      thousand: opts.thousand == null ? 'nghìn' : opts.thousand,
    };
    if (o.zeroTens !== 'linh' && o.zeroTens !== 'lẻ')
      throw new RangeError('zeroTens must be "linh" or "lẻ"');
    if (o.thousand !== 'nghìn' && o.thousand !== 'ngàn')
      throw new RangeError('thousand must be "nghìn" or "ngàn"');
    return o;
  }

  /* A whole number as a digit string and a sign, or a RangeError. */
  function integerDigits(n) {
    if (typeof n === 'bigint') return { negative: n < 0n, digits: (n < 0n ? -n : n).toString() };
    if (typeof n === 'string' && /^\s*-?\d+\s*$/.test(n)) {
      const t = n.trim();
      const digits = t.replace(/^-/, '').replace(/^0+(?=\d)/, '');
      return { negative: t.charAt(0) === '-' && digits !== '0', digits: digits };
    }
    if (typeof n !== 'number' || !Number.isSafeInteger(n))
      throw new RangeError('A whole number is required');
    return { negative: n < 0, digits: String(Math.abs(n)) };
  }

  /**
   * A whole number in Vietnamese words, lower case, no currency.
   *   120000 -> "một trăm hai mươi nghìn"
   *   105    -> "một trăm linh năm"
   *   24     -> "hai mươi tư"
   * @param {number|bigint|string} n whole number (safe integer, BigInt or digits)
   * @param {{zeroTens?: 'linh'|'lẻ', useTu?: boolean, thousand?: 'nghìn'|'ngàn'}} [opts]
   */
  function numberToWords(n, opts) {
    const o = options(opts);
    const parsed = integerDigits(n);
    const words = /^0+$/.test(parsed.digits) ? ['không'] : readDigits(parsed.digits, false, o);
    if (parsed.negative) words.unshift('âm');
    return words.join(' ');
  }

  /**
   * "Bằng chữ" for a VND amount: rounded to whole đồng, capitalised, with
   * "đồng chẵn." - Vietnamese money has no minor unit to read out.
   *   120000 -> "Một trăm hai mươi nghìn đồng chẵn."
   *   0      -> "Không đồng."
   * @param {number|bigint|string} amount
   * @param {{currency?: string, even?: boolean, period?: boolean}} [opts]
   */
  function amountInWords(amount, opts) {
    opts = opts || {};
    let value = amount;
    if (typeof value === 'string' && !/^\s*-?\d+\s*$/.test(value)) value = Number(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RangeError('A finite amount is required');
      value = Math.round(value);
      if (Object.is(value, -0)) value = 0;
    }
    const text = numberToWords(value, opts);
    const zero = text === 'không';
    const currency = opts.currency == null ? 'đồng' : opts.currency;
    const even = opts.even !== false && !zero ? ' chẵn' : '';
    const out = text + (currency ? ' ' + currency : '') + (currency ? even : '');
    return out.charAt(0).toUpperCase() + out.slice(1) + (opts.period === false ? '' : '.');
  }

  /* ------------------------------------------------------------ the shop */

  const VN_COUNTRY = /^(vn|vnm|viet\s*nam|vietnam|việt\s*nam)$/i;

  function currencyOf(data) {
    const value = data && data.currency_value;
    const first = Array.isArray(value) ? value[0] : null;
    return String(
      (first && (first.currency_text || first.currency_sign)) ||
        (data && (data.currency_code || data.currency_text || data.currency)) ||
        ''
    );
  }

  /**
   * Is this a Vietnamese shop? The outlet's country decides; its currency is
   * the fallback (a till only knows the currency it was signed in with).
   * `hint` carries what the browser has: { country, currency }.
   */
  function isVietnamese(data, hint) {
    data = data || {};
    hint = hint || {};
    const countries = [
      data.country_id,
      data.countryid,
      data.branch_country,
      data.country,
      hint.country,
    ];
    for (const c of countries) {
      const v = String(c == null ? '' : c).trim();
      if (!v) continue;
      return VN_COUNTRY.test(v);
    }
    const currency = currencyOf(data) || String(hint.currency || '');
    return /\bVND\b|₫/.test(currency);
  }

  /* ------------------------------------------------------------ the date */

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /**
   * dd/mm/yyyy HH:mm.
   *
   * The sale API sends a shop-local "10/14/2026 03:30 pm" (month first, with
   * receipt_date_order 'mdy'), the till's own preview "14/10/2026 3:30 PM";
   * both are re-read as written - no timezone shift. A Date or an ISO string
   * is shown in the shop's zone, Asia/Ho_Chi_Minh unless told otherwise.
   * Anything unrecognised is returned unchanged rather than guessed at.
   */
  function billDateTime(value, opts) {
    opts = opts || {};
    if (value == null || value === '') return '';
    const text = typeof value === 'string' ? value.trim() : '';
    const m =
      text &&
      text.match(
        /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?)?$/i
      );
    if (m) {
      let day = Number(m[1]);
      let month = Number(m[2]);
      if (opts.order === 'mdy' || (opts.order !== 'dmy' && month > 12 && day <= 12)) {
        const swap = day;
        day = month;
        month = swap;
      }
      const date = pad(day) + '/' + pad(month) + '/' + m[3];
      if (m[4] == null) return date;
      let hour = Number(m[4]);
      if (m[6]) hour = (hour % 12) + (/^p/i.test(m[6]) ? 12 : 0);
      return date + ' ' + pad(hour) + ':' + m[5];
    }
    const d =
      value instanceof Date
        ? value
        : typeof value === 'number' || /^\d{4}-\d{2}-\d{2}/.test(text)
          ? new Date(value)
          : null;
    if (!d || Number.isNaN(d.getTime())) return String(value);
    try {
      const parts = {};
      new Intl.DateTimeFormat('en-GB', {
        timeZone: opts.timeZone || 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(d)
        .forEach(function (p) {
          parts[p.type] = p.value;
        });
      return (
        parts.day + '/' + parts.month + '/' + parts.year + ' ' + parts.hour + ':' + parts.minute
      );
    } catch (e) {
      return String(value);
    }
  }

  /* ------------------------------------------------------------- the VAT */

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function billable(line) {
    return (
      line &&
      !line.return &&
      !line.cancelled &&
      !['cancelled', 'canceled'].includes(String(line.status || '').toLowerCase()) &&
      num(
        line.item_quantity != null
          ? line.item_quantity
          : line.quantity != null
            ? line.quantity
            : line.qty
      ) > 0
    );
  }

  /**
   * The VAT rate a line was sold at: a percentage, or 'KCT' (không chịu thuế).
   * KCT is a tax the shop names, not a number - HiTechPOS onboarding creates
   * "KCT-Không chịu thuế" at 0% beside "Thuế GTGT 0%", and only the name tells
   * them apart.
   */
  function vatRate(line) {
    line = line || {};
    const names = [line.tax_name].concat(
      Array.isArray(line.tax_fields) ? line.tax_fields.map((f) => f && f.tax_name) : []
    );
    if (names.some((n) => /(^|[^a-z])kct([^a-z]|$)|không\s+chịu\s+thuế/i.test(String(n || ''))))
      return 'KCT';
    let rate = num(line.tax);
    if (!rate && Array.isArray(line.tax_fields))
      rate = line.tax_fields.reduce((s, f) => s + num(f && f.tax_value), 0);
    return Math.round(rate * 100) / 100;
  }

  function vatLabel(rate) {
    return rate === 'KCT'
      ? 'Không chịu thuế (KCT)'
      : 'Thuế GTGT ' + String(rate).replace('.', ',') + '%';
  }

  /*
   * Largest-remainder split of `total` minor units across `weights`, so the
   * per-rate rows always add up to exactly the tax the sale recorded.
   */
  function apportion(total, weights) {
    const sum = weights.reduce((s, w) => s + w, 0);
    if (!(sum > 0)) return weights.map(() => 0);
    const raw = weights.map((w) => (total * w) / sum);
    const out = raw.map((r) => Math.floor(r));
    let left = total - out.reduce((s, v) => s + v, 0);
    const order = raw
      .map((r, i) => ({ i: i, frac: r - Math.floor(r) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
    return out;
  }

  /**
   * VAT grouped by rate, as a Vietnamese invoice states it.
   *
   * Each line's amount (total_amount) is what the guest pays for it, tax
   * included - Posnic stores it that way for inclusive and exclusive items
   * alike - so a line's VAT is amount x r / (100 + r). The sale's recorded tax
   * is then shared out over the taxed groups in proportion, so the rows add up
   * to the "Tax" the sale saved, to the đồng.
   *
   * Nothing is returned when the sale carries no tax: a shop that does not
   * charge VAT gets no VAT section at all. When it does, 0% and KCT groups are
   * listed too, so the bill says which goods were not taxed.
   *
   * @param {Array} lines sale items
   * @param {number} totalTax the sale's recorded tax
   * @param {{digits?: number}} [opts] currency minor digits (VND: 0)
   * @returns {Array<{rate:number|'KCT', label:string, base:number, amount:number}>}
   */
  function vatGroups(lines, totalTax, opts) {
    opts = opts || {};
    const digits = Number.isInteger(opts.digits) ? opts.digits : 0;
    const factor = Math.pow(10, digits);
    const tax = num(totalTax);
    if (!(tax > 0)) return [];
    const groups = new Map();
    (Array.isArray(lines) ? lines : []).filter(billable).forEach(function (line) {
      const rate = vatRate(line);
      const gross = num(
        line.total_amount != null
          ? line.total_amount
          : line.line_total != null
            ? line.line_total
            : line.amount
      );
      const g = groups.get(rate) || { rate: rate, gross: 0, estimate: 0 };
      g.gross += gross;
      if (typeof rate === 'number' && rate > 0) g.estimate += (gross * rate) / (100 + rate);
      groups.set(rate, g);
    });
    const list = Array.from(groups.values()).sort(function (a, b) {
      if (a.rate === 'KCT') return 1;
      if (b.rate === 'KCT') return -1;
      return a.rate - b.rate;
    });
    const taxed = list.filter((g) => g.estimate > 0);
    const taxMinor = Math.round(tax * factor);
    if (!taxed.length) {
      // Tax with no rated line to put it on (a taxed charge, an old sale):
      // still one honest row rather than none.
      return [{ rate: null, label: 'Thuế GTGT', base: 0, amount: taxMinor / factor }];
    }
    const shares = apportion(
      taxMinor,
      taxed.map((g) => g.estimate)
    );
    taxed.forEach(function (g, i) {
      g.amount = shares[i] / factor;
    });
    return list.map(function (g) {
      const amount = g.amount || 0;
      return {
        rate: g.rate,
        label: vatLabel(g.rate),
        base: Math.round((g.gross - amount) * factor) / factor,
        amount: amount,
      };
    });
  }

  /* ---------------------------------------------------------- the labels */

  const LABELS = Object.freeze({
    title: 'HOÁ ĐƠN BÁN HÀNG',
    provisionalTitle: 'PHIẾU TẠM TÍNH',
    returnTitle: 'PHIẾU TRẢ HÀNG',
    number: 'Số',
    date: 'Ngày',
    cashier: 'Thu ngân',
    table: 'Bàn',
    customer: 'Khách hàng',
    phone: 'ĐT',
    taxCode: 'MST',
    item: 'Tên hàng',
    qty: 'SL',
    price: 'Đơn giá',
    amount: 'Thành tiền',
    amountShort: 'T.Tiền',
    subtotal: 'Tạm tính',
    discount: 'Chiết khấu',
    extraDiscount: 'Chiết khấu thêm',
    roundOff: 'Làm tròn',
    total: 'Tổng cộng',
    inWords: 'Bằng chữ',
    paid: 'Đã thanh toán',
    due: 'Còn lại',
    change: 'Tiền thừa trả khách',
    totalQty: 'Tổng SL',
    thanks: 'Cảm ơn quý khách và hẹn gặp lại!',
  });

  /* The tender names Posnic keys on ("Cash", "Card") read in Vietnamese. */
  const TENDERS = Object.freeze({
    cash: 'Tiền mặt',
    card: 'Thẻ',
    upi: 'UPI',
    qrpay: 'QR chuyển khoản',
    'bank transfer': 'Chuyển khoản',
    credit: 'Ghi nợ',
  });

  function paymentLabel(method) {
    const key = String(method || '').trim();
    return TENDERS[key.toLowerCase()] || key;
  }

  /**
   * The money after the total: each tender, and the change handed back when
   * the tenders exceed the total. `rows` are { method, amount }.
   */
  function paymentLines(rows, total, opts) {
    opts = opts || {};
    const digits = Number.isInteger(opts.digits) ? opts.digits : 0;
    const factor = Math.pow(10, digits);
    const list = (Array.isArray(rows) ? rows : [])
      .filter((r) => r && num(r.amount) > 0)
      .map((r) => ({ label: paymentLabel(r.method), amount: num(r.amount) }));
    const paid = list.reduce((s, r) => s + Math.round(r.amount * factor), 0);
    const change = paid - Math.round(num(total) * factor);
    if (list.length && change > 0)
      list.push({ label: LABELS.change, amount: change / factor, change: true });
    return list;
  }

  return {
    numberToWords: numberToWords,
    amountInWords: amountInWords,
    isVietnamese: isVietnamese,
    billDateTime: billDateTime,
    vatRate: vatRate,
    vatLabel: vatLabel,
    vatGroups: vatGroups,
    paymentLabel: paymentLabel,
    paymentLines: paymentLines,
    LABELS: LABELS,
  };
});
