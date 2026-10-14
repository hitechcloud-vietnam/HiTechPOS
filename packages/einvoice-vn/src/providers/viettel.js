'use strict';

const { fail, notSupported } = require('../errors');
const { EINVOICE_STATUS, refIdOf } = require('../provider');
const {
  createHttp, createTokenCache, withToken, transactionIdFor, baseUrlFrom, requireString, jwtExpiryMs,
} = require('../transport');

/*
 * Viettel S-Invoice (SInvoice / vInvoice) adapter.
 *
 * Source of the endpoints, auth flow and payload shape: the unofficial MIT SDK
 * `viettel-s-invoice` 1.0.10 (lib/viettel-s-invoice.js, lib/interfaces/viettel-s-invoice.d.ts,
 * lib/constants/index.js). Items marked UNVERIFIED are not in that SDK and come
 * from general knowledge of Viettel's API document; confirm them against the
 * official document before production use (see README, "Cần xác minh").
 *
 *   POST {base}/auth/login                                   {username, password} -> {access_token, expires_in}
 *   POST {api}/InvoiceAPI/InvoiceWS/createInvoice/{taxCode}   create + publish
 *   POST {api}/InvoiceAPI/InvoiceWS/searchInvoiceByTransactionUuid   form: supplierTaxCode, transactionUuid
 *   POST {api}/InvoiceAPI/InvoiceUtilsWS/getInvoiceRepresentationFile {supplierTaxCode, invoiceNo, templateCode, fileType}
 *   POST {api}/InvoiceAPI/InvoiceUtilsWS/getInvoiceTemplates  {taxCode, invoiceType}
 *   where {api} = {base}/services/einvoiceapplication/api
 */
const VIETTEL_BASE_URLS = Object.freeze({
  production: 'https://api-vinvoice.viettel.vn', // SDK lib/constants API_ENDPOINT
  sandbox: 'https://demo-sinvoice.viettel.vn', // UNVERIFIED: not in the SDK; ask Viettel for the test host
});

/* UNVERIFIED: TT78 invoice type codes (1 = GTGT, 2 = bán hàng). */
const INVOICE_TYPE = { GTGT: '1', BANHANG: '2' };
/* UNVERIFIED: -1 = không chịu thuế (KCT), -2 = không kê khai, tính nộp (KKKNT); same convention as Mắt Bão/payOS. */
const TAX_PERCENTAGE = { KCT: -1, KKKNT: -2 };
/* UNVERIFIED: selection 1 = hàng hoá, 2 = ghi chú, 3 = chiết khấu thương mại. */
const SELECTION = { goods: 1, promotion: 1, note: 2, discount: 3 };

function taxPercentage(rate) {
  if (rate === null || rate === undefined) return undefined;
  return typeof rate === 'number' ? rate : TAX_PERCENTAGE[rate];
}

function drop(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k];
  return o;
}

/* Canonical invoice (buildInvoice) -> Viettel createInvoice body. */
function toViettelInvoice(invoice, { templateCode, now = Date.now } = {}) {
  const b = invoice.buyer;
  const s = invoice.seller;
  const t = invoice.totals;
  return {
    generalInvoiceInfo: drop({
      invoiceType: INVOICE_TYPE[invoice.invoiceType],
      templateCode: templateCode || invoice.templateCode,
      invoiceSeries: invoice.series,
      currencyCode: invoice.currency,
      exchangeRate: invoice.exchangeRate,
      adjustmentType: '1', // UNVERIFIED: 1 = original invoice
      paymentStatus: true,
      cusGetInvoiceRight: true,
      invoiceIssuedDate: new Date(invoice.issueDate).getTime(),
      transactionUuid: transactionIdFor(invoice.refId),
      invoiceNote: invoice.note,
    }),
    buyerInfo: drop({
      buyerName: b.name || (b.companyName ? undefined : b.displayName),
      buyerLegalName: b.companyName,
      buyerTaxCode: b.taxCode,
      buyerAddressLine: b.address || '',
      buyerPhoneNumber: b.phone,
      buyerEmail: b.email,
      buyerCode: b.code,
      buyerIdNo: b.citizenId, // UNVERIFIED field name (seen only in the SDK's invoice list type)
      buyerNotGetInvoice: b.anonymous ? '1' : undefined, // UNVERIFIED value semantics
    }),
    sellerInfo: drop({
      sellerLegalName: s.name,
      sellerTaxCode: s.taxCode,
      sellerAddressLine: s.address,
      sellerPhoneNumber: s.phone,
      sellerEmail: s.email,
      sellerBankName: s.bankName,
      sellerBankAccount: s.bankAccount,
    }),
    payments: [{ paymentMethod: invoice.paymentMethod, paymentMethodName: invoice.paymentMethod }],
    deliveryInfo: {},
    itemInfo: invoice.lines.map((l) => (l.kind === 'note'
      ? drop({ lineNumber: l.lineNo, selection: SELECTION.note, itemName: l.name })
      : drop({
        lineNumber: l.lineNo,
        selection: SELECTION[l.kind],
        itemCode: l.code,
        itemName: l.name,
        unitName: l.unit,
        unitPrice: l.unitPriceNet,
        quantity: l.quantity,
        itemTotalAmountWithoutTax: l.amountNet,
        itemDiscount: l.discountNet,
        itemTotalAmountAfterDiscount: l.netAmount,
        taxPercentage: taxPercentage(l.vatRate),
        taxAmount: invoice.invoiceType === 'GTGT' ? l.vatAmount : undefined,
        itemNote: l.kind === 'promotion' ? 'Hàng khuyến mại không thu tiền' : undefined, // UNVERIFIED field
      }))),
    discountItemInfo: [],
    summarizeInfo: drop({
      sumOfTotalLineAmountWithoutTax: t.saleAmount,
      totalAmountWithoutTax: t.net,
      totalTaxAmount: t.vat,
      totalAmountWithTax: t.gross,
      totalAmountWithTaxInWords: t.amountInWords,
      discountAmount: t.tradeDiscount || undefined, // UNVERIFIED field
    }),
    taxBreakdowns: t.groups.map((g) => ({ taxPercentage: taxPercentage(g.vatRate), taxableAmount: g.net, taxAmount: g.vat })),
  };
}

/* Viettel's invoiceNo is the series followed by the number, e.g. "C26MAA12". */
function splitInvoiceNo(full, series) {
  const s = String(full || '');
  if (series && s.startsWith(series)) return s.slice(series.length);
  const m = /^[CK]\d{2}[A-Z]{3}(\d+)$/.exec(s);
  return m ? m[1] : s;
}

function rejected(body, provider = 'viettel') {
  const code = body && body.errorCode;
  const desc = body && typeof body.description === 'string' ? body.description : '';
  const duplicate = /trùng|duplicate|exist|đã tồn tại/i.test(desc) || /DUPLICATE|EXIST/i.test(String(code || '')); // UNVERIFIED codes
  return fail(duplicate ? 'einvoice_duplicate' : 'einvoice_rejected', duplicate ? 409 : 502, {
    message: duplicate ? 'Viettel: transactionUuid đã được dùng, cần đối soát bằng getStatus' : `Viettel từ chối hoá đơn${code ? ` (mã ${code})` : ''}`,
    details: { provider, providerCode: code, providerMessage: desc },
  });
}

function hasError(body) {
  return body && body.errorCode !== undefined && body.errorCode !== null && body.errorCode !== '' && body.errorCode !== 0 && body.errorCode !== '0';
}

function createViettelProvider(config = {}, { transport = globalThis.fetch, now = Date.now, timeoutMs = 60000 } = {}) {
  const provider = 'viettel';
  const username = requireString(config.username, 'username', provider);
  const password = requireString(config.password, 'password', provider);
  /* The SDK uses the login username as supplierTaxCode in every path/body. */
  const supplierTaxCode = config.supplierTaxCode ? requireString(config.supplierTaxCode, 'supplierTaxCode', provider) : username;
  const baseUrl = baseUrlFrom(config, VIETTEL_BASE_URLS, provider);
  const api = `${baseUrl}/services/einvoiceapplication/api/InvoiceAPI`;
  const http = createHttp({ provider, transport, timeoutMs });

  const tokens = createTokenCache({
    now,
    async login() {
      const body = await http(`${baseUrl}/auth/login`, { body: { username, password } });
      if (!body || typeof body.access_token !== 'string') fail('einvoice_credentials_rejected', 502, { message: 'Viettel: đăng nhập thất bại', details: { provider } });
      const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : null;
      const expiresAt = ttl ? now() + ttl : (jwtExpiryMs(body.access_token) || now() + 10 * 60 * 1000);
      return { token: body.access_token, expiresAt };
    },
  });
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const lookupUrl = (code) => (config.lookupUrlTemplate && code ? config.lookupUrlTemplate.replace('{code}', encodeURIComponent(code)) : undefined);

  function result(invoiceLike, r, extra = {}) {
    const series = invoiceLike.series;
    const codeOfTax = r.codeOfTax || r.taxAuthorityCode || null;
    return {
      provider,
      refId: invoiceLike.refId,
      transactionId: invoiceLike.transactionId,
      providerInvoiceId: r.invoiceNo,
      invoiceNo: splitInvoiceNo(r.invoiceNo, series),
      templateCode: invoiceLike.templateCode,
      providerTemplateCode: invoiceLike.providerTemplateCode,
      series,
      lookupCode: r.reservationCode || undefined,
      lookupUrl: lookupUrl(r.reservationCode),
      taxAuthorityCode: codeOfTax,
      issuedAt: new Date(now()).toISOString(),
      status: EINVOICE_STATUS.ISSUED,
      ...extra,
    };
  }

  async function searchByTransactionUuid(transactionUuid) {
    const form = new URLSearchParams({ supplierTaxCode, transactionUuid }).toString();
    return withToken(tokens, (token) => http(`${api}/InvoiceWS/searchInvoiceByTransactionUuid`, {
      headers: { ...auth(token), 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form,
    }), { retryOn401: true });
  }

  const self = {
    id: provider,
    toPayload: (invoice) => toViettelInvoice(invoice, { templateCode: config.templateCode }),
    async issue(invoice) {
      if (!invoice || !invoice.totals) fail('einvoice_invalid', 422, { message: 'Cần hoá đơn đã chuẩn hoá bằng buildInvoice()' });
      const payload = toViettelInvoice(invoice, { templateCode: config.templateCode });
      const transactionId = payload.generalInvoiceInfo.transactionUuid;
      /* Mutation: no re-login-and-retry on 401, no retry on anything. */
      const body = await withToken(tokens, (token) => http(`${api}/InvoiceWS/createInvoice/${encodeURIComponent(supplierTaxCode)}`, {
        headers: auth(token), body: payload, mutation: true,
      }));
      if (hasError(body)) rejected(body);
      if (!body || !body.result || !body.result.invoiceNo) {
        fail('einvoice_outcome_unknown', 502, { message: 'Viettel: phản hồi thiếu số hoá đơn, cần đối soát bằng getStatus', details: { provider, refId: invoice.refId } });
      }
      const pending = invoice.withTaxAuthorityCode && !body.result.codeOfTax;
      return result({ ...invoice, transactionId, providerTemplateCode: payload.generalInvoiceInfo.templateCode }, body.result, {
        status: pending ? EINVOICE_STATUS.PENDING : EINVOICE_STATUS.ISSUED,
        raw: body.result,
      });
    },
    /* ref: refId string | { refId } | { transactionId }. Viettel looks up by transactionUuid only. */
    async getStatus(ref, options = {}) {
      const refId = refIdOf(ref);
      const transactionId = (ref && ref.transactionId) || (refId ? transactionIdFor(refId) : null);
      if (!transactionId) fail('einvoice_invalid', 422, { message: 'Cần refId hoặc transactionId' });
      const body = await searchByTransactionUuid(transactionId);
      const list = body && Array.isArray(body.result) ? body.result : [];
      if (!list.length) return { provider, refId: refId || null, transactionId, status: EINVOICE_STATUS.NOT_FOUND, raw: body };
      const r = list[0];
      const status = /hủy|huỷ|xoá bỏ|xóa bỏ|cancel/i.test(String(r.status || '')) ? EINVOICE_STATUS.CANCELLED : EINVOICE_STATUS.ISSUED; // UNVERIFIED status values
      const series = options.series || (/^([CK]\d{2}[A-Z]{3})/.exec(String(r.invoiceNo)) || [])[1];
      return {
        ...result({ refId: refId || null, transactionId, series, templateCode: options.templateCode }, r, { status, raw: r }),
        issuedAt: r.issueDate ? new Date(r.issueDate).toISOString() : null,
      };
    },
    /*
     * ref: { providerInvoiceId (Viettel invoiceNo, e.g. C26MAA12), providerTemplateCode? } or a refId.
     * Returns { pdf: Buffer, fileName }.
     */
    async getPdf(ref, options = {}) {
      let invoiceNo = ref && ref.providerInvoiceId;
      if (!invoiceNo) {
        const st = await self.getStatus(ref, options);
        if (st.status === EINVOICE_STATUS.NOT_FOUND) fail('einvoice_not_found', 404, { message: 'Không tìm thấy hoá đơn' });
        invoiceNo = st.providerInvoiceId;
      }
      const templateCode = (ref && ref.providerTemplateCode) || options.templateCode || config.templateCode;
      if (!templateCode) fail('einvoice_invalid', 422, { message: 'Viettel cần templateCode để tải bản thể hiện' });
      const body = await withToken(tokens, (token) => http(`${api}/InvoiceUtilsWS/getInvoiceRepresentationFile`, {
        headers: auth(token), body: { supplierTaxCode, invoiceNo, templateCode, fileType: 'PDF' },
      }), { retryOn401: true });
      /* errorCode is typed `number` for this call in the SDK and its success value is unknown: trust the file. */
      if (!body || typeof body.fileToBytes !== 'string' || !body.fileToBytes) {
        fail('einvoice_unavailable', 502, { message: 'Viettel: không tải được bản PDF', details: { provider, providerCode: body && body.errorCode } });
      }
      return { pdf: Buffer.from(body.fileToBytes, 'base64'), fileName: body.fileName };
    },
    /* Registered templates/series for this tax code (GTGT by default). */
    async getTemplates(invoiceType = 'GTGT') {
      const body = await withToken(tokens, (token) => http(`${api}/InvoiceUtilsWS/getInvoiceTemplates`, {
        headers: auth(token), body: { taxCode: supplierTaxCode, invoiceType: INVOICE_TYPE[invoiceType] || invoiceType },
      }), { retryOn401: true });
      return (body && body.template) || [];
    },
    /* Not in the SDK: cancel/replace/adjust endpoints are unverified, so they are not guessed. */
    cancel: async () => notSupported(provider, 'cancel'),
    replace: async () => notSupported(provider, 'replace'),
    adjust: async () => notSupported(provider, 'adjust'),
  };
  return Object.freeze(self);
}

module.exports = { createViettelProvider, toViettelInvoice, VIETTEL_BASE_URLS, splitInvoiceNo };
