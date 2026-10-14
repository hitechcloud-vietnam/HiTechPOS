'use strict';

const { fail, notSupported } = require('../errors');
const { EINVOICE_STATUS, refIdOf } = require('../provider');
const {
  createHttp, createTokenCache, withToken, transactionIdFor, baseUrlFrom, requireString, jwtExpiryMs,
  unauthorizedError, vnDate, parseMaybeJson,
} = require('../transport');

/*
 * MISA meInvoice adapter ("API tích hợp" / integration API, doc.meinvoice.vn/itg).
 *
 * The official document was not reachable from the build environment and no
 * SDK exists on npm. Endpoints and field names below were cross-checked across
 * three independent open-source integrations that cite doc.meinvoice.vn/itg:
 *   - ahc0403-commits/globospossystem  supabase/functions/_shared/meinvoice.ts (cash-register, SignType 5)
 *   - congtydetmaygiausang-eng/mimin-erp apps/web/src/lib/meinvoice.ts
 *   - apexspace9-a11y/tkpro             lightbill/server/src/MisaEInvoiceService.php
 *   - thanhdat-89/hocvien               Website/quan-ly-hv/reporting/MEINVOICE-RESEARCH.md (endpoint table)
 * Everything is therefore "community-verified", not vendor-verified; fields
 * marked UNVERIFIED appear in at most one source or come from general
 * knowledge. See README, "Cần xác minh với tài liệu gốc".
 *
 *   POST {base}/api/integration/auth/token     {appid, taxcode, username, password} -> {Success, Data: "<token>"}
 *   POST {base}/api/integration/invoice        {SignType, InvoiceData: [..], PublishInvoiceData: null}
 *   POST {base}/api/integration/invoice/status?invoiceWithCode=&invoiceCalcu=&inputType=2   body: [RefID]
 *   POST {base}/api/integration/invoice/Download?invoiceWithCode=&invoiceCalcu=&downloadDataType=pdf  body: [TransactionID]
 *   GET  {base}/api/integration/invoice/templates?invoiceWithCode=&ticket=false&year=
 */
const MISA_BASE_URLS = Object.freeze({
  sandbox: 'https://testapi.meinvoice.vn',
  production: 'https://api.meinvoice.vn',
});

/*
 * SignType (from the research note + globospossystem):
 *   1 USB token / file certificate (signed client-side - not usable from a server)
 *   2 HSM, synchronous: MISA creates, signs, publishes, sends to CQT
 *   3 HSM, asynchronous (queued; poll getStatus)
 *   5 hoá đơn khởi tạo từ máy tính tiền, no digital signature
 */
const SIGN_TYPES = Object.freeze({ HSM: 2, HSM_ASYNC: 3, CASH_REGISTER: 5 });
/* UNVERIFIED: ItemType 1 hàng hoá, 2 khuyến mại, 3 chiết khấu thương mại, 4 ghi chú (mimin-erp comments 2 = "phí"). */
const ITEM_TYPE = { goods: 1, promotion: 2, discount: 3, note: 4 };
const AUTH_ERRORS = /^(UnAuthorize|Unauthorized|InvalidToken|TokenExpired|ExpiredToken)$/i; // UnAuthorize per research note

function vatRateName(rate) {
  if (rate === null || rate === undefined) return undefined;
  return typeof rate === 'number' ? `${rate}%` : rate; // 'KCT' | 'KKKNT' (tkpro)
}

function invoiceName(invoice) {
  const base = invoice.invoiceType === 'GTGT' ? 'Hóa đơn giá trị gia tăng' : 'Hóa đơn bán hàng';
  return invoice.fromCashRegister ? `${base} khởi tạo từ máy tính tiền` : base; // UNVERIFIED wording
}

function drop(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k];
  return o;
}

/* Canonical invoice -> one element of InvoiceData. VND only, so *OC (original currency) == base fields. */
function toMisaInvoiceData(invoice, { sendEmail = true } = {}) {
  const b = invoice.buyer;
  const t = invoice.totals;
  const gtgt = invoice.invoiceType === 'GTGT';
  const goods = invoice.lines.filter((l) => l.kind === 'goods');
  const lineDiscount = goods.reduce((a, l) => a + l.discountNet, 0);
  const both = (name, value) => ({ [`${name}OC`]: value, [name]: value });
  const email = sendEmail && b.email ? b.email : undefined;
  return drop({
    RefID: transactionIdFor(invoice.refId),
    InvSeries: invoice.symbol, // e.g. "1C26MAA" - UNVERIFIED whether MISA wants the 7-char symbol or 6-char series
    InvoiceName: invoiceName(invoice),
    InvDate: vnDate(invoice.issueDate),
    CurrencyCode: invoice.currency,
    ExchangeRate: invoice.exchangeRate,
    PaymentMethodName: invoice.paymentMethod,
    IsInvoiceCalculatingMachine: invoice.fromCashRegister,
    BuyerLegalName: b.companyName || (b.name ? undefined : b.displayName),
    BuyerFullName: b.name,
    BuyerTaxCode: b.taxCode,
    BuyerAddress: b.address,
    BuyerCode: b.code,
    BuyerPhoneNumber: b.phone,
    BuyerEmail: b.email,
    AccountObjectIdentificationNumber: b.citizenId, // UNVERIFIED (globospossystem only)
    ContactName: b.name || b.companyName,
    IsSendEmail: Boolean(email),
    ReceiverName: email ? b.name || b.displayName : undefined,
    ReceiverEmail: email,
    DiscountRate: 0,
    ...both('TotalSaleAmount', t.saleAmount),
    ...both('TotalDiscountAmount', lineDiscount),
    ...both('TotalAmountWithoutVAT', t.net),
    ...both('TotalVATAmount', t.vat),
    ...both('TotalAmount', t.gross),
    TotalAmountInWords: t.amountInWords,
    Note: invoice.note, // UNVERIFIED field
    OriginalInvoiceDetail: invoice.lines.map((l, i) => (l.kind === 'note'
      ? { ItemType: ITEM_TYPE.note, LineNumber: l.lineNo, SortOrder: i + 1, ItemName: l.name }
      : drop({
        ItemType: ITEM_TYPE[l.kind],
        LineNumber: l.lineNo,
        SortOrder: i + 1,
        ItemCode: l.code,
        ItemName: l.name,
        UnitName: l.unit,
        Quantity: l.quantity,
        UnitPrice: l.unitPriceNet,
        DiscountRate: l.discountNet && l.amountNet ? Math.round((l.discountNet * 10000) / l.amountNet) / 100 : 0,
        ...both('DiscountAmount', l.discountNet),
        ...both('Amount', l.amountNet),
        ...both('AmountWithoutVAT', l.netAmount),
        VATRateName: gtgt ? vatRateName(l.vatRate) : undefined,
        ...(gtgt ? both('VATAmount', l.vatAmount) : {}),
        AmountAfterTax: l.totalAmount, // globospossystem only
      }))),
    TaxRateInfo: t.groups.map((g) => ({
      VATRateName: vatRateName(g.vatRate), ...both('AmountWithoutVAT', g.net), ...both('VATAmount', g.vat),
    })),
    OptionUserDefined: {
      MainCurrency: 'VND',
      AmountDecimalDigits: '0',
      AmountOCDecimalDigits: '0',
      UnitPriceOCDecimalDigits: invoice.pricesIncludeVat ? '2' : '0',
      UnitPriceDecimalDigits: invoice.pricesIncludeVat ? '2' : '0',
      QuantityDecimalDigits: '3',
      CoefficientDecimalDigits: '0',
    },
  });
}

function firstResult(body) {
  if (!body || typeof body !== 'object') return null;
  for (const key of ['publishInvoiceResult', 'PublishInvoiceResult', 'createInvoiceResult', 'CreateInvoiceResult', 'Data', 'data']) {
    const v = parseMaybeJson(body[key]);
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v[0];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  }
  return null;
}

function successOf(body) {
  if (!body || typeof body !== 'object') return false;
  return body.Success !== undefined ? body.Success === true : body.success === true;
}

function errorCodeOf(body) {
  return body && (body.ErrorCode || body.errorCode || '');
}

function createMisaProvider(config = {}, { transport = globalThis.fetch, now = Date.now, timeoutMs = 60000 } = {}) {
  const provider = 'misa';
  const appId = requireString(config.appId, 'appId', provider);
  const taxCode = requireString(config.taxCode, 'taxCode', provider);
  const username = requireString(config.username, 'username', provider);
  const password = requireString(config.password, 'password', provider);
  const baseUrl = baseUrlFrom(config, MISA_BASE_URLS, provider);
  const api = `${baseUrl}/api/integration`;
  const http = createHttp({ provider, transport, timeoutMs });
  const tokenTtlMs = config.tokenTtlMs || 12 * 3600 * 1000; // UNVERIFIED lifetime; JWT exp wins when present

  const tokens = createTokenCache({
    now,
    async login() {
      const body = await http(`${api}/auth/token`, { body: { appid: appId, taxcode: taxCode, username, password } });
      const token = body && (typeof body.Data === 'string' ? body.Data : typeof body.data === 'string' ? body.data : null);
      if (!successOf(body) || !token) {
        fail('einvoice_credentials_rejected', 502, { message: 'MISA meInvoice: đăng nhập thất bại', details: { provider, providerCode: errorCodeOf(body) } });
      }
      return { token, expiresAt: jwtExpiryMs(token) || now() + tokenTtlMs };
    },
  });
  /* CompanyTaxCode header: mimin-erp only - UNVERIFIED, harmless if ignored. */
  const headers = (token) => ({ Authorization: `Bearer ${token}`, CompanyTaxCode: taxCode });
  const lookupUrl = (code) => (config.lookupUrlTemplate && code ? config.lookupUrlTemplate.replace('{code}', encodeURIComponent(code)) : undefined);

  /* Read call with a body-level "UnAuthorize" also counted as 401. */
  async function read(path, body, method = 'POST') {
    return withToken(tokens, async (token) => {
      const res = await http(`${api}${path}`, { method, headers: headers(token), body });
      if (!successOf(res) && AUTH_ERRORS.test(String(errorCodeOf(res)))) throw unauthorizedError(provider, { providerCode: errorCodeOf(res) });
      return res;
    }, { retryOn401: true });
  }

  function query(opts, extra) {
    const p = new URLSearchParams({
      invoiceWithCode: String(opts.withTaxAuthorityCode ?? config.withTaxAuthorityCode ?? true),
      invoiceCalcu: String(opts.fromCashRegister ?? config.fromCashRegister ?? false),
      ...extra,
    });
    return p.toString();
  }

  function mapResult(r, base) {
    const code = r.InvCode || r.invCode || null;
    return {
      provider,
      refId: base.refId,
      transactionId: base.transactionId,
      providerInvoiceId: r.TransactionID || r.transactionID || null,
      invoiceNo: r.InvNo != null ? String(r.InvNo) : null,
      templateCode: base.templateCode,
      series: base.series,
      lookupCode: r.TransactionID || r.transactionID || undefined, // MISA "mã tra cứu" is the TransactionID
      lookupUrl: lookupUrl(r.TransactionID || r.transactionID),
      taxAuthorityCode: code,
      issuedAt: new Date(now()).toISOString(),
      status: base.withTaxAuthorityCode && !code ? EINVOICE_STATUS.PENDING : EINVOICE_STATUS.ISSUED,
      raw: r,
    };
  }

  const self = {
    id: provider,
    toPayload(invoice) {
      const signType = config.signType || (invoice.fromCashRegister ? SIGN_TYPES.CASH_REGISTER : SIGN_TYPES.HSM);
      return { SignType: signType, InvoiceData: [toMisaInvoiceData(invoice, { sendEmail: config.sendEmail !== false })], PublishInvoiceData: null };
    },
    async issue(invoice) {
      if (!invoice || !invoice.totals) fail('einvoice_invalid', 422, { message: 'Cần hoá đơn đã chuẩn hoá bằng buildInvoice()' });
      const payload = self.toPayload(invoice);
      if (payload.SignType === SIGN_TYPES.CASH_REGISTER && !invoice.fromCashRegister) {
        fail('einvoice_configuration_invalid', 422, { message: 'SignType 5 chỉ dùng cho hoá đơn khởi tạo từ máy tính tiền' });
      }
      const transactionId = payload.InvoiceData[0].RefID;
      /* Mutation: no retry; a body-level UnAuthorize drops the token but is not retried. */
      const body = await withToken(tokens, async (token) => {
        const res = await http(`${api}/invoice`, { headers: headers(token), body: payload, mutation: true });
        if (!successOf(res) && AUTH_ERRORS.test(String(errorCodeOf(res)))) throw unauthorizedError(provider, { providerCode: errorCodeOf(res) });
        return res;
      });
      const r = firstResult(body);
      const rawItemCode = r && (r.ErrorCode || r.errorCode);
      const itemCode = rawItemCode && String(rawItemCode) !== '0' ? rawItemCode : ''; // mimin-erp treats "0" as success
      const code = itemCode || errorCodeOf(body);
      if (!successOf(body) || itemCode) {
        const duplicate = /duplicate|trùng|exist/i.test(String(code)); // UNVERIFIED code names
        fail(duplicate ? 'einvoice_duplicate' : 'einvoice_rejected', duplicate ? 409 : 502, {
          message: duplicate ? 'MISA: RefID đã tồn tại, cần đối soát bằng getStatus' : `MISA meInvoice từ chối hoá đơn${code ? ` (${code})` : ''}`,
          details: { provider, providerCode: code, providerMessage: (r && (r.DescriptionErrorCode || r.Description)) || body.descriptionErrorCode || body.DescriptionErrorCode },
        });
      }
      if (!r || !(r.TransactionID || r.transactionID)) {
        fail('einvoice_outcome_unknown', 502, { message: 'MISA: phản hồi thiếu TransactionID, cần đối soát bằng getStatus', details: { provider, refId: invoice.refId } });
      }
      return mapResult(r, { ...invoice, transactionId });
    },
    /*
     * ref: refId | { refId } | { providerInvoiceId (TransactionID) }.
     * options: { withTaxAuthorityCode, fromCashRegister, series, templateCode } - MISA needs the
     * first two as query flags (defaults from config).
     */
    async getStatus(ref, options = {}) {
      const refId = refIdOf(ref);
      const byTransaction = ref && ref.providerInvoiceId;
      const key = byTransaction || (refId ? transactionIdFor(refId) : null);
      if (!key) fail('einvoice_invalid', 422, { message: 'Cần refId hoặc providerInvoiceId' });
      const body = await read(`/invoice/status?${query(options, { inputType: byTransaction ? '1' : '2' })}`, [key]);
      const list = parseMaybeJson(body && (body.Data !== undefined ? body.Data : body.data));
      const r = Array.isArray(list) ? list[0] : list && typeof list === 'object' ? list : null;
      const base = {
        refId: refId || null, transactionId: byTransaction ? null : key, templateCode: options.templateCode, series: options.series,
        withTaxAuthorityCode: options.withTaxAuthorityCode ?? config.withTaxAuthorityCode ?? true,
      };
      if (!r || !(r.TransactionID || r.transactionID || r.InvNo)) return { provider, ...base, status: EINVOICE_STATUS.NOT_FOUND, raw: body };
      const out = mapResult(r, base);
      if (r.IsDeleted || r.DeletedStatus || /cancel|delete/i.test(String(r.InvoiceStatus || ''))) out.status = EINVOICE_STATUS.CANCELLED; // UNVERIFIED
      if (!r.InvNo) out.status = EINVOICE_STATUS.PENDING;
      out.issuedAt = r.InvDate ? new Date(r.InvDate).toISOString() : null;
      return out;
    },
    /* ref: { providerInvoiceId (TransactionID) } or a refId (resolved via getStatus). */
    async getPdf(ref, options = {}) {
      let transactionId = ref && ref.providerInvoiceId;
      if (!transactionId) {
        const st = await self.getStatus(ref, options);
        if (st.status === EINVOICE_STATUS.NOT_FOUND) fail('einvoice_not_found', 404, { message: 'Không tìm thấy hoá đơn' });
        transactionId = st.providerInvoiceId;
      }
      const body = await read(`/invoice/Download?${query(options, { downloadDataType: 'pdf' })}`, [transactionId]);
      const r = firstResult(body);
      const data = r && (r.Data || r.data);
      if (!successOf(body) || typeof data !== 'string') { // UNVERIFIED response shape
        fail('einvoice_unavailable', 502, { message: 'MISA: không tải được bản PDF', details: { provider, providerCode: errorCodeOf(body) } });
      }
      return { pdf: Buffer.from(data, 'base64'), fileName: `${transactionId}.pdf` };
    },
    async getTemplates({ year = new Date(now()).getUTCFullYear(), withTaxAuthorityCode = true } = {}) {
      const q = new URLSearchParams({ invoiceWithCode: String(withTaxAuthorityCode), ticket: 'false', year: String(year) });
      const body = await read(`/invoice/templates?${q}`, undefined, 'GET');
      const data = parseMaybeJson(body && (body.Data !== undefined ? body.Data : body.data));
      return Array.isArray(data) ? data : [];
    },
    /* /invoice/cancel exists in the doc index but its body is unverified; not guessed for a mutation. */
    cancel: async () => notSupported(provider, 'cancel'),
    replace: async () => notSupported(provider, 'replace'),
    adjust: async () => notSupported(provider, 'adjust'),
  };
  return Object.freeze(self);
}

module.exports = { createMisaProvider, toMisaInvoiceData, MISA_BASE_URLS, SIGN_TYPES };
