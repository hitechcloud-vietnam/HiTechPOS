'use strict';

const { fail, notSupported } = require('../errors');
const { EINVOICE_STATUS, refIdOf } = require('../provider');
const {
  createHttp, createTokenCache, withToken, transactionIdFor, baseUrlFrom, requireString, jwtExpiryMs,
  unauthorizedError, vnDate,
} = require('../transport');

/*
 * Mắt Bão e-invoice ("API Proxy HĐĐT") adapter.
 *
 * Source: @redonvn/matbao-invoice-sdk 1.0.2 (dist/services/matbao-invoice.service.js,
 * dist/types/index.d.ts, dist/constants.js, README). Its constants cite the
 * vendor document's appendix for error codes. `matbao-partner-sdk` is a
 * different (HMAC-signed partner/certificate) API and is not used here.
 * Fields marked UNVERIFIED are not in that SDK.
 *
 *   POST {base}/api/auth/login                {MST, TDNhap, MKhau} -> {Success, Data: "<token>"}
 *   POST {base}/api/invoice/create-invoice    [InvoiceRequest]  (LoaiHDon 1 = create + publish)
 *   POST {base}/api/invoice/invoice-detail    {TNLap, DNLap, MaSoHDon?, KHHDon?, LoaiHDon?, TThaiHDon?}
 *   POST {base}/api/invoice/download-invoice  {MaTraCuu, MaSoHDon}
 *   POST {base}/api/invoice/cancel-invoice    {MaSoHDon}
 *   GET  {base}/api/invoice/templates?year=
 *   Every response: { Success, Data, ErrorCode, Message }
 */
const MATBAO_BASE_URLS = Object.freeze({
  sandbox: 'https://demo-api-hddt.matbao.in:11443',
  production: 'https://api-hddt.matbao.in:11443',
});

/* SDK constants ItemType */
const TCHAT = { goods: 1, promotion: 2, discount: 3, note: 4 };
/* SDK constants TaxRate: -1 KCT, -2 KKKNT (the SDK's own comments are ambiguous - verify). */
const TSUAT = { KCT: -1, KKKNT: -2 };
/* SDK constants InvoiceStatus (TThaiHDon / webhook MaTTHDon) */
const STATUS = {
  1: EINVOICE_STATUS.DRAFT,
  2: EINVOICE_STATUS.REJECTED, // lỗi ký
  3: EINVOICE_STATUS.PENDING, // chưa gửi CQT
  4: EINVOICE_STATUS.ISSUED, // đã cấp mã / tiếp nhận
  5: EINVOICE_STATUS.PENDING, // CQT chưa phản hồi
  6: EINVOICE_STATUS.REJECTED, // không đủ điều kiện cấp mã
  7: EINVOICE_STATUS.ISSUED, // 7-9: issued, with a mẫu 04 notice in some state
  8: EINVOICE_STATUS.ISSUED,
  9: EINVOICE_STATUS.ISSUED,
};
/* SDK constants ErrorCode */
const ERR = { DRAFT_CREATED: '300', DUPLICATE_LOOKUP: '304', DUPLICATE_REF: '305', INVALID_ACCOUNT: '401', TOKEN_FAILED: '402' };
const DAY = 24 * 3600 * 1000;

function tsuat(rate) {
  if (rate === null || rate === undefined) return undefined;
  return typeof rate === 'number' ? rate : TSUAT[rate];
}

function drop(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
}

/* Our lookup code: the refId-derived transaction id without dashes (UNVERIFIED max length). */
function lookupCodeFor(refId) {
  return transactionIdFor(refId).replace(/-/g, '').toUpperCase();
}

/* Canonical invoice -> one InvoiceRequest (the endpoint takes an array). */
function toMatBaoInvoice(invoice, { currencyCode = '704' } = {}) {
  const b = invoice.buyer;
  const t = invoice.totals;
  const gtgt = invoice.invoiceType === 'GTGT';
  return drop({
    KHMSHDon: invoice.templateCode,
    KHHDon: invoice.series,
    NLap: invoice.issueDate, // SDK README example sends an ISO-8601 string
    DVTTe: currencyCode, // SDK README example uses "704" (ISO 4217 numeric for VND)
    TGia: invoice.exchangeRate,
    HTTToan: invoice.paymentMethod,
    MaTraCuu: lookupCodeFor(invoice.refId),
    MTChieu: transactionIdFor(invoice.refId),
    KTraMTChieuTrung: 1, // provider rejects a reused MTChieu (error 305) -> server-side idempotency
    KTraMaTraCuuTrung: 1,
    GChu: invoice.note || '',
    TCHDon: 0, // hoá đơn mới
    NMua_Ten: b.companyName || b.name || b.displayName,
    NMua_HVTNMHang: b.name,
    NMua_MST: b.taxCode,
    NMua_DChi: b.address,
    NMua_MKHang: b.code,
    NMua_SDThoai: b.phone,
    NMua_DCTDTu: b.email,
    NMua_CCCDan: b.citizenId,
    DSHHDVu: invoice.lines.map((l) => (l.kind === 'note'
      ? { TChat: TCHAT.note, STT: l.lineNo, MHHDVu: '', THHDVu: l.name, DVTinh: '', SLuong: 0, DGia: 0, ThTienChuaCK: 0, TLCKhau: 0, STCKhau: 0, ThTien: 0, TSuat: 0, TThue: 0, TgTien: 0 }
      : drop({
        TChat: TCHAT[l.kind],
        STT: l.lineNo,
        MHHDVu: l.code || '',
        THHDVu: l.name,
        DVTinh: l.unit || '',
        SLuong: l.quantity,
        DGia: l.unitPriceNet,
        ThTienChuaCK: l.amountNet,
        TLCKhau: l.discountNet && l.amountNet ? Math.round((l.discountNet * 10000) / l.amountNet) / 100 : 0,
        STCKhau: l.discountNet,
        ThTien: l.netAmount,
        TSuat: gtgt ? tsuat(l.vatRate) : undefined, // UNVERIFIED: what hoá đơn bán hàng expects here
        TThue: l.vatAmount,
        TgTien: l.totalAmount,
      }))),
    TgThTien: t.net, // UNVERIFIED: after commercial discount (as TgTCThue in the NĐ123 XML)
    TgTThue: t.vat,
    TTCKTMai: t.tradeDiscount,
    TGTKhac: 0,
    TgTTTBSo: t.gross,
    TgTTTBChu: t.amountInWords,
    LoaiHDon: 1, // tạo và phát hành
  });
}

function code(body) {
  return body && body.ErrorCode !== undefined && body.ErrorCode !== null ? String(body.ErrorCode) : '';
}

/* Response field names for created/listed invoices are UNVERIFIED; webhook names are used as fallbacks. */
function pick(d, ...keys) {
  for (const k of keys) if (d && d[k] !== undefined && d[k] !== null && d[k] !== '') return d[k];
  return undefined;
}

function createMatBaoProvider(config = {}, { transport = globalThis.fetch, now = Date.now, timeoutMs = 60000 } = {}) {
  const provider = 'matbao';
  const taxCode = requireString(config.taxCode, 'taxCode', provider);
  const username = requireString(config.username, 'username', provider);
  const password = requireString(config.password, 'password', provider);
  const baseUrl = baseUrlFrom(config, MATBAO_BASE_URLS, provider);
  const http = createHttp({ provider, transport, timeoutMs });
  const tokenTtlMs = config.tokenTtlMs || 3600 * 1000; // UNVERIFIED lifetime; JWT exp wins when present
  const lookupUrl = (c) => (config.lookupUrlTemplate && c ? config.lookupUrlTemplate.replace('{code}', encodeURIComponent(c)) : undefined);

  const tokens = createTokenCache({
    now,
    async login() {
      const body = await http(`${baseUrl}/api/auth/login`, { body: { MST: taxCode, TDNhap: username, MKhau: password } });
      if (!body || body.Success !== true || typeof body.Data !== 'string' || !body.Data) {
        fail('einvoice_credentials_rejected', 502, { message: 'Mắt Bão: đăng nhập thất bại', details: { provider, providerCode: code(body) } });
      }
      return { token: body.Data, expiresAt: jwtExpiryMs(body.Data) || now() + tokenTtlMs };
    },
  });

  function call(path, { method = 'POST', body, mutation = false } = {}) {
    return withToken(tokens, async (token) => {
      const res = await http(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body, mutation });
      if (res && res.Success !== true && (code(res) === ERR.INVALID_ACCOUNT || code(res) === ERR.TOKEN_FAILED)) {
        throw unauthorizedError(provider, { providerCode: code(res) });
      }
      return res;
    }, { retryOn401: !mutation });
  }

  function mapInvoice(d, base) {
    const st = Number(pick(d, 'TThaiHDon', 'MaTTHDon', 'TrangThai'));
    const mccqt = pick(d, 'MCCQT', 'MaCQT') || null;
    let status = STATUS[st];
    if (!status) status = base.withTaxAuthorityCode && !mccqt ? EINVOICE_STATUS.PENDING : EINVOICE_STATUS.ISSUED;
    const lookupCode = pick(d, 'MaTraCuu', 'Fkey') || base.lookupCode;
    const no = pick(d, 'SHDon', 'No');
    return {
      provider,
      refId: base.refId,
      transactionId: base.transactionId,
      providerInvoiceId: pick(d, 'MaSoHDon', 'InvID', 'Id') || null,
      invoiceNo: no !== undefined ? String(no) : null,
      templateCode: pick(d, 'KHMSHDon', 'Pattern') || base.templateCode,
      series: pick(d, 'KHHDon', 'Serial') || base.series,
      lookupCode,
      lookupUrl: lookupUrl(lookupCode),
      taxAuthorityCode: mccqt,
      issuedAt: new Date(now()).toISOString(),
      status,
      raw: d,
    };
  }

  const self = {
    id: provider,
    toPayload: (invoice) => [toMatBaoInvoice(invoice, { currencyCode: config.currencyCode })],
    async issue(invoice) {
      if (!invoice || !invoice.totals) fail('einvoice_invalid', 422, { message: 'Cần hoá đơn đã chuẩn hoá bằng buildInvoice()' });
      const payload = self.toPayload(invoice);
      const body = await call('/api/invoice/create-invoice', { body: payload, mutation: true });
      if (!body || body.Success !== true) {
        const c = code(body);
        if (c === ERR.DUPLICATE_REF || c === ERR.DUPLICATE_LOOKUP) {
          fail('einvoice_duplicate', 409, { message: 'Mắt Bão: mã tham chiếu đã tồn tại, cần đối soát bằng getStatus', details: { provider, providerCode: c } });
        }
        fail('einvoice_rejected', 502, {
          message: `Mắt Bão từ chối hoá đơn${c ? ` (mã ${c})` : ''}`,
          details: { provider, providerCode: c, providerMessage: body && body.Message, draftCreated: c === ERR.DRAFT_CREATED },
        });
      }
      const d = Array.isArray(body.Data) ? body.Data[0] : body.Data;
      if (!d || typeof d !== 'object' || !pick(d, 'MaSoHDon', 'InvID', 'Id')) {
        fail('einvoice_outcome_unknown', 502, { message: 'Mắt Bão: phản hồi thiếu mã hoá đơn, cần đối soát bằng getStatus', details: { provider, refId: invoice.refId } });
      }
      return mapInvoice(d, {
        ...invoice, transactionId: payload[0].MTChieu, lookupCode: payload[0].MaTraCuu,
      });
    },
    /*
     * ref: refId | { refId } | { providerInvoiceId (MaSoHDon) }.
     * invoice-detail needs a date range: options.issueDate (±1 day) or options.from/to,
     * default the last 90 days.
     */
    async getStatus(ref, options = {}) {
      const refId = refIdOf(ref);
      const id = ref && ref.providerInvoiceId;
      if (!refId && !id) fail('einvoice_invalid', 422, { message: 'Cần refId hoặc providerInvoiceId' });
      const at = options.issueDate ? new Date(options.issueDate).getTime() : now();
      const from = options.from || vnDate(new Date(options.issueDate ? at - DAY : at - 90 * DAY).toISOString());
      const to = options.to || vnDate(new Date(at + DAY).toISOString());
      const req = drop({ TNLap: from, DNLap: to, MaSoHDon: id, KHHDon: options.series, LoaiHDon: -1, TThaiHDon: -1 });
      const body = await call('/api/invoice/invoice-detail', { body: req });
      const base = {
        refId: refId || null, transactionId: refId ? transactionIdFor(refId) : null,
        lookupCode: refId ? lookupCodeFor(refId) : undefined, templateCode: options.templateCode, series: options.series,
        withTaxAuthorityCode: true,
      };
      if (!body || body.Success !== true) {
        if (code(body) === '201' || code(body) === '301') return { provider, ...base, status: EINVOICE_STATUS.NOT_FOUND };
        fail('einvoice_unavailable', 502, { message: 'Mắt Bão: không tra cứu được hoá đơn', details: { provider, providerCode: code(body) } });
      }
      const list = Array.isArray(body.Data) ? body.Data : body.Data ? [body.Data] : [];
      const d = list.find((x) => (id ? pick(x, 'MaSoHDon', 'InvID') === id : pick(x, 'MTChieu', 'SO') === base.transactionId));
      if (!d) return { provider, ...base, status: EINVOICE_STATUS.NOT_FOUND };
      const out = mapInvoice(d, base);
      const nlap = pick(d, 'NLap', 'ArisingDate');
      out.issuedAt = nlap ? new Date(nlap).toISOString() : null;
      return out;
    },
    /* ref: { providerInvoiceId, lookupCode } or a refId (resolved via getStatus). */
    async getPdf(ref, options = {}) {
      let id = ref && ref.providerInvoiceId;
      let lookup = ref && ref.lookupCode;
      if (!id || !lookup) {
        const st = await self.getStatus(ref, options);
        if (st.status === EINVOICE_STATUS.NOT_FOUND) fail('einvoice_not_found', 404, { message: 'Không tìm thấy hoá đơn' });
        id = st.providerInvoiceId;
        lookup = st.lookupCode;
      }
      const body = await call('/api/invoice/download-invoice', { body: { MaTraCuu: lookup, MaSoHDon: id } });
      const d = body && body.Data;
      const pdf = typeof d === 'string' ? d : pick(d, 'Pdf', 'PDF', 'FilePdf', 'PdfBase64'); // UNVERIFIED response shape
      if (!body || body.Success !== true || typeof pdf !== 'string') {
        fail('einvoice_unavailable', 502, { message: 'Mắt Bão: không tải được bản PDF', details: { provider, providerCode: code(body) } });
      }
      return { pdf: Buffer.from(pdf, 'base64'), fileName: `${id}.pdf` };
    },
    async getTemplates(year = new Date(now()).getUTCFullYear()) {
      const body = await call(`/api/invoice/templates?year=${encodeURIComponent(year)}`, { method: 'GET' });
      return body && body.Success === true && Array.isArray(body.Data) ? body.Data : [];
    },
    /*
     * "Xoá bỏ hoá đơn" (SDK cancelInvoice). Since NĐ 70/2025 an issued invoice
     * with errors is normally adjusted or replaced, not cancelled; the host
     * must decide that cancelling is legally allowed. The provider body carries
     * no reason, the host must keep `reason` itself. Mutation: never retried.
     */
    async cancel(ref, reason) {
      if (!reason || !String(reason).trim()) fail('einvoice_invalid', 422, { message: 'Cần lý do huỷ hoá đơn' });
      const id = ref && ref.providerInvoiceId;
      if (!id) fail('einvoice_invalid', 422, { message: 'Cần providerInvoiceId (MaSoHDon) để huỷ' });
      const body = await call('/api/invoice/cancel-invoice', { body: { MaSoHDon: id }, mutation: true });
      if (!body || body.Success !== true) {
        fail('einvoice_rejected', 502, { message: `Mắt Bão từ chối huỷ hoá đơn (mã ${code(body)})`, details: { provider, providerCode: code(body), providerMessage: body && body.Message } });
      }
      return { provider, providerInvoiceId: id, status: EINVOICE_STATUS.CANCELLED, reason: String(reason).trim() };
    },
    /* TCHDon 1-5 (thay thế / điều chỉnh) exist in the SDK constants, but mapping is not implemented yet. */
    replace: async () => notSupported(provider, 'replace'),
    adjust: async () => notSupported(provider, 'adjust'),
  };
  return Object.freeze(self);
}

module.exports = { createMatBaoProvider, toMatBaoInvoice, MATBAO_BASE_URLS, lookupCodeFor };
