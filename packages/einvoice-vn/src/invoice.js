'use strict';

const {
  computeInvoiceTotals, isValidVATRate, VAT_RATE_LABELS, numberToVietnameseWords,
  isValidTaxCode, isValidCCCD, normalizeVNPhone,
} = require('@hitechpos/vn-locale');
const { EInvoiceError } = require('./errors');
const { vnParts } = require('./transport');

/*
 * Canonical HiTechPOS e-invoice (hoá đơn điện tử) model.
 *
 * Legal frame: Nghị định 123/2020/NĐ-CP as amended by Nghị định 70/2025/NĐ-CP,
 * Thông tư 78/2021/TT-BTC as amended by Thông tư 32/2025/TT-BTC.
 *
 * Symbols (TT78 art. 4):
 *   templateCode ("ký hiệu mẫu số"): 1 digit. 1 = hoá đơn GTGT, 2 = hoá đơn bán hàng
 *     (3-6: tài sản công, dự trữ quốc gia, tem/vé, PXK - not supported here).
 *   series ("ký hiệu hoá đơn"): 6 chars, e.g. C25MAA
 *     [0]   C = có mã của cơ quan thuế, K = không có mã
 *     [1-2] last two digits of the year the invoice is issued
 *     [3]   type letter; M = hoá đơn khởi tạo từ máy tính tiền, T = registered with CQT, ...
 *     [4-5] two letters chosen by the seller.
 *   The pair is commonly written together: "1C25MAA".
 *
 * Money is integer VND. Rounding is half away from zero with integer
 * arithmetic, VAT is computed on each rate group's subtotal (as printed on the
 * invoice) and then allocated to lines so line sums always equal group totals.
 */

const INVOICE_TYPES = Object.freeze({ GTGT: 'GTGT', BANHANG: 'BANHANG' });
const TEMPLATE_CODES = Object.freeze({ GTGT: '1', BANHANG: '2' });
const PAYMENT_METHODS = Object.freeze(['TM', 'CK', 'TM/CK']);
const LINE_KINDS = Object.freeze(['goods', 'promotion', 'discount', 'note']);
const ANONYMOUS_BUYER_NAME = 'Khách lẻ không lấy hoá đơn';
const SERIES_RE = /^([CK])(\d{2})([A-Z])([A-Z]{2})$/;
const REF_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function divRound(a, b) {
  const q = Math.floor((2 * Math.abs(a) + b) / (2 * b));
  return a < 0 ? -q : q;
}

function roundHalfAway(x) {
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return r === 0 ? 0 : r;
}

/* quantity * unitPrice in integer VND; toPrecision strips binary noise (0.1*3). */
function lineAmount(quantity, unitPrice) {
  return roundHalfAway(Number((quantity * unitPrice).toPrecision(15)));
}

function str(value) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim().replace(/\s+/g, ' ');
  return s ? s : undefined;
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function compact(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/*
 * Validates and normalises an invoice input; throws EInvoiceError
 * 'einvoice_invalid' (422) listing every problem in details.errors
 * as { field, message } with Vietnamese messages.
 */
function buildInvoice(input, { now = Date.now } = {}) {
  const errors = [];
  const err = (field, message) => { errors.push({ field, message }); };
  const src = input && typeof input === 'object' ? input : {};

  /* identity */
  const refId = str(src.refId);
  if (!refId || !REF_ID_RE.test(refId)) err('refId', 'refId (mã đơn hàng HiTechPOS) bắt buộc, tối đa 64 ký tự [A-Za-z0-9._:-]');

  const invoiceType = src.invoiceType === undefined ? 'GTGT' : src.invoiceType;
  if (!INVOICE_TYPES[invoiceType]) err('invoiceType', 'Loại hoá đơn phải là GTGT hoặc BANHANG');
  const isGTGT = invoiceType === 'GTGT';
  const fromCashRegister = src.fromCashRegister === true;

  /* symbols */
  let templateCode = str(src.templateCode);
  let series = str(src.series);
  if (series) series = series.toUpperCase();
  if (series && /^\d[CK]/.test(series) && series.length === 7) {
    if (templateCode && templateCode !== series[0]) err('templateCode', 'Ký hiệu mẫu số không khớp với ký hiệu hoá đơn');
    templateCode = series[0];
    series = series.slice(1);
  }
  if (!templateCode && INVOICE_TYPES[invoiceType]) templateCode = TEMPLATE_CODES[invoiceType];
  if (INVOICE_TYPES[invoiceType] && templateCode !== TEMPLATE_CODES[invoiceType]) {
    err('templateCode', `Ký hiệu mẫu số của hoá đơn ${invoiceType} phải là ${TEMPLATE_CODES[invoiceType]}`);
  }
  const m = series ? SERIES_RE.exec(series) : null;
  if (!m) err('series', 'Ký hiệu hoá đơn phải gồm 6 ký tự, ví dụ C25MAA');
  if (m && fromCashRegister && (m[1] !== 'C' || m[3] !== 'M')) {
    err('series', 'Hoá đơn khởi tạo từ máy tính tiền phải có ký hiệu dạng C..M.. (có mã, chữ M ở vị trí thứ 4)');
  }
  if (m && !fromCashRegister && m[3] === 'M') err('fromCashRegister', 'Ký hiệu chữ M dành cho hoá đơn khởi tạo từ máy tính tiền');

  /* date: thời điểm lập hoá đơn */
  let issueDate;
  const d = src.issueDate === undefined ? null : new Date(src.issueDate);
  if (!d || Number.isNaN(d.getTime())) {
    err('issueDate', 'Ngày lập hoá đơn bắt buộc và phải hợp lệ');
  } else {
    issueDate = d.toISOString();
    if (d.getTime() > now() + FUTURE_TOLERANCE_MS) err('issueDate', 'Ngày lập hoá đơn không được ở tương lai');
    if (m && vnParts(issueDate).year.slice(2) !== m[2]) err('series', 'Hai số năm trong ký hiệu hoá đơn phải trùng năm lập hoá đơn');
  }

  const currency = src.currency === undefined ? 'VND' : src.currency;
  if (currency !== 'VND') err('currency', 'Hiện chỉ hỗ trợ hoá đơn bằng VND');
  const exchangeRate = src.exchangeRate === undefined ? 1 : src.exchangeRate;
  if (exchangeRate !== 1) err('exchangeRate', 'Tỷ giá với VND phải là 1');
  const paymentMethod = src.paymentMethod === undefined ? 'TM/CK' : src.paymentMethod;
  if (!PAYMENT_METHODS.includes(paymentMethod)) err('paymentMethod', 'Hình thức thanh toán phải là TM, CK hoặc TM/CK');
  const pricesIncludeVat = src.pricesIncludeVat === true;
  if (pricesIncludeVat && !isGTGT) err('pricesIncludeVat', 'Hoá đơn bán hàng không tách thuế GTGT');

  /* seller */
  const s = src.seller && typeof src.seller === 'object' ? src.seller : {};
  const seller = compact({
    taxCode: str(s.taxCode), name: str(s.name), address: str(s.address), phone: str(s.phone),
    email: str(s.email), bankAccount: str(s.bankAccount), bankName: str(s.bankName),
  });
  if (!isValidTaxCode(seller.taxCode)) err('seller.taxCode', 'Mã số thuế người bán không hợp lệ');
  if (!seller.name) err('seller.name', 'Tên người bán bắt buộc');
  if (!seller.address) err('seller.address', 'Địa chỉ người bán bắt buộc');

  /* buyer (may be an anonymous retail customer) */
  const b = src.buyer && typeof src.buyer === 'object' ? src.buyer : {};
  const buyer = compact({
    name: str(b.name), companyName: str(b.companyName), taxCode: str(b.taxCode), address: str(b.address),
    email: str(b.email), phone: str(b.phone), citizenId: str(b.citizenId), code: str(b.code),
  });
  if (buyer.taxCode !== undefined) {
    if (!isValidTaxCode(buyer.taxCode)) err('buyer.taxCode', 'Mã số thuế người mua không hợp lệ');
    if (!buyer.companyName && !buyer.name) err('buyer.companyName', 'Có MST người mua thì phải ghi tên đơn vị/người mua');
    if (!buyer.address) err('buyer.address', 'Có MST người mua thì phải ghi địa chỉ');
  }
  if (buyer.email !== undefined && !EMAIL_RE.test(buyer.email)) err('buyer.email', 'Email người mua không hợp lệ');
  if (buyer.phone !== undefined) {
    const p = normalizeVNPhone(buyer.phone);
    if (!p) err('buyer.phone', 'Số điện thoại người mua không hợp lệ');
    else buyer.phone = p;
  }
  if (buyer.citizenId !== undefined && !isValidCCCD(buyer.citizenId)) err('buyer.citizenId', 'Số CCCD/định danh người mua phải gồm 12 chữ số');
  buyer.anonymous = !buyer.name && !buyer.companyName && !buyer.taxCode && !buyer.citizenId;
  buyer.displayName = buyer.companyName || buyer.name || ANONYMOUS_BUYER_NAME;

  /* lines */
  const rawLines = Array.isArray(src.lines) ? src.lines : [];
  const lines = [];
  const seenNo = new Set();
  rawLines.forEach((raw, i) => {
    const f = (k) => `lines[${i}].${k}`;
    const r = raw && typeof raw === 'object' ? raw : {};
    const kind = r.kind === undefined ? 'goods' : r.kind;
    if (!LINE_KINDS.includes(kind)) { err(f('kind'), 'Loại dòng phải là goods, promotion, discount hoặc note'); return; }
    const lineNo = r.lineNo === undefined ? i + 1 : r.lineNo;
    if (!Number.isSafeInteger(lineNo) || lineNo <= 0 || seenNo.has(lineNo)) err(f('lineNo'), 'Số thứ tự dòng phải là số nguyên dương, không trùng');
    seenNo.add(lineNo);
    const name = str(r.name);
    if (!name) err(f('name'), 'Tên hàng hoá, dịch vụ bắt buộc');
    const line = compact({ lineNo, kind, code: str(r.code), name, unit: str(r.unit) });
    if (kind === 'note') { lines.push(line); return; }

    let quantity = r.quantity === undefined && kind === 'discount' ? 1 : r.quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) { err(f('quantity'), 'Số lượng phải lớn hơn 0'); quantity = 0; }
    let unitPrice = r.unitPrice === undefined && kind === 'promotion' ? 0 : r.unitPrice;
    if (kind === 'discount' && unitPrice === undefined && r.amount !== undefined) unitPrice = r.amount / quantity;
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) { err(f('unitPrice'), 'Đơn giá phải là số không âm'); unitPrice = 0; }
    if (kind === 'discount' && r.amount !== undefined && (!Number.isSafeInteger(r.amount) || r.amount <= 0)) {
      err(f('amount'), 'Số tiền chiết khấu thương mại phải là số nguyên VND dương');
    }
    const amount = kind === 'discount' && Number.isSafeInteger(r.amount) ? r.amount : lineAmount(quantity, unitPrice);
    const discount = r.discount === undefined ? 0 : r.discount;
    if (kind !== 'goods' && discount !== 0) err(f('discount'), 'Chỉ dòng hàng hoá mới có chiết khấu dòng');
    if (!Number.isSafeInteger(discount) || discount < 0 || discount > amount) err(f('discount'), 'Chiết khấu dòng phải là số nguyên VND, không vượt thành tiền');

    let vatRate = r.vatRate === undefined ? null : r.vatRate;
    if (isGTGT) {
      if (!isValidVATRate(vatRate)) { err(f('vatRate'), 'Thuế suất phải là 0, 5, 8, 10, KCT hoặc KKKNT'); vatRate = 0; }
    } else if (vatRate !== null) {
      err(f('vatRate'), 'Hoá đơn bán hàng không ghi thuế suất GTGT');
    }
    Object.assign(line, { quantity, unitPrice, amount, discount, vatRate });
    lines.push(line);
  });
  if (!lines.some((l) => l.kind === 'goods' || l.kind === 'promotion')) err('lines', 'Hoá đơn phải có ít nhất một dòng hàng hoá, dịch vụ');

  if (errors.length) {
    throw new EInvoiceError('einvoice_invalid', {
      status: 422, message: `Hoá đơn không hợp lệ: ${errors.map((e) => e.message).join('; ')}`, details: { errors },
    });
  }

  lines.sort((a, b2) => a.lineNo - b2.lineNo);
  const totals = computeTotals(lines, { isGTGT, pricesIncludeVat });

  const invoice = compact({
    refId, invoiceType, fromCashRegister, templateCode, series, symbol: templateCode + series,
    withTaxAuthorityCode: series[0] === 'C', issueDate, currency, exchangeRate, paymentMethod, pricesIncludeVat,
    note: str(src.note), seller, buyer, lines, totals,
  });
  return deepFreeze(invoice);
}

/*
 * Adds per-line net/vat/total to `lines` (in place) and returns totals.
 * Discount lines (chiết khấu thương mại) reduce their rate group; their
 * stored values are positive magnitudes.
 */
function computeTotals(lines, { isGTGT, pricesIncludeVat }) {
  const priced = lines.filter((l) => l.kind === 'goods' || l.kind === 'discount');
  for (const l of lines) {
    if (l.kind === 'promotion') Object.assign(l, { netAmount: 0, vatAmount: 0, totalAmount: 0, amountNet: 0, discountNet: 0, unitPriceNet: l.unitPrice });
  }
  const base = (l) => (l.kind === 'discount' ? -l.amount : l.amount - l.discount);
  /*
   * Net-of-VAT view of the price columns that providers print:
   *   amountNet   = thành tiền before the line discount
   *   discountNet = line discount
   *   unitPriceNet = amountNet / quantity (may carry decimals with VAT-inclusive prices)
   * With VAT-exclusive prices these equal the entered values. With inclusive
   * prices amountNet is extracted from the gross amount and the discount is the
   * difference, so amountNet - discountNet === netAmount exactly.
   */
  const netOfVat = (l, r) => {
    if (!pricesIncludeVat || l.kind !== 'goods') {
      l.amountNet = l.kind === 'discount' ? l.netAmount : l.amount;
      l.discountNet = l.kind === 'discount' ? 0 : l.discount;
      l.unitPriceNet = l.kind === 'discount' ? Math.round((l.amountNet * 100) / l.quantity) / 100 : l.unitPrice;
      return;
    }
    l.amountNet = l.discount === 0 ? l.netAmount : divRound(l.amount * 100, 100 + r);
    l.discountNet = l.amountNet - l.netAmount;
    l.unitPriceNet = Math.round((l.amountNet * 100) / l.quantity) / 100;
  };
  const fail422 = (message) => { throw new EInvoiceError('einvoice_invalid', { status: 422, message, details: { errors: [{ field: 'lines', message }] } }); };

  let groups = [];
  if (isGTGT) {
    const t = computeInvoiceTotals(priced.map((l) => ({ amount: base(l), rate: l.vatRate })), { inclusive: pricesIncludeVat });
    groups = t.groups.map((g) => ({ vatRate: g.rate, label: VAT_RATE_LABELS[g.rate], net: g.net, vat: g.vat, gross: g.gross }));
    for (const g of groups) {
      if (g.net < 0 || g.gross < 0) fail422(`Chiết khấu thương mại vượt quá tiền hàng nhóm thuế suất ${g.label}`);
      const members = priced.filter((l) => l.vatRate === g.vatRate);
      const r = typeof g.vatRate === 'number' ? g.vatRate : 0;
      /* exclusive: line VAT on its own amount; inclusive: line net extracted from gross */
      const parts = members.map((l) => (pricesIncludeVat ? divRound(base(l) * 100, 100 + r) : divRound(base(l) * r, 100)));
      const target = pricesIncludeVat ? g.net : g.vat;
      const diff = target - parts.reduce((a, x) => a + x, 0);
      if (diff !== 0) {
        let k = 0;
        members.forEach((l, i) => { if (base(l) > base(members[k])) k = i; });
        parts[k] += diff;
      }
      members.forEach((l, i) => {
        const bse = base(l);
        const net = pricesIncludeVat ? parts[i] : bse;
        const vat = pricesIncludeVat ? bse - parts[i] : parts[i];
        const sign = l.kind === 'discount' ? -1 : 1;
        l.netAmount = sign * net;
        l.vatAmount = sign * vat;
        l.totalAmount = l.netAmount + l.vatAmount;
        netOfVat(l, r);
      });
    }
  } else {
    for (const l of priced) {
      const sign = l.kind === 'discount' ? -1 : 1;
      l.netAmount = sign * base(l);
      l.vatAmount = 0;
      l.totalAmount = l.netAmount;
      netOfVat(l, 0);
    }
  }

  const sum = (arr, k) => arr.reduce((a, l) => a + l[k], 0);
  const goods = lines.filter((l) => l.kind === 'goods');
  const discounts = lines.filter((l) => l.kind === 'discount');
  const saleAmount = sum(goods, 'netAmount');
  const tradeDiscount = sum(discounts, 'netAmount');
  const net = isGTGT ? groups.reduce((a, g) => a + g.net, 0) : saleAmount - tradeDiscount;
  const vat = isGTGT ? groups.reduce((a, g) => a + g.vat, 0) : 0;
  const gross = net + vat;
  if (net < 0 || gross < 0) fail422('Tổng tiền thanh toán không được âm');
  return {
    saleAmount,
    lineDiscount: sum(goods, 'discount'),
    tradeDiscount,
    tradeDiscountVat: sum(discounts, 'vatAmount'),
    net,
    vat,
    gross,
    groups,
    amountInWords: numberToVietnameseWords(gross),
  };
}

module.exports = {
  INVOICE_TYPES, TEMPLATE_CODES, PAYMENT_METHODS, LINE_KINDS, ANONYMOUS_BUYER_NAME,
  buildInvoice,
};
