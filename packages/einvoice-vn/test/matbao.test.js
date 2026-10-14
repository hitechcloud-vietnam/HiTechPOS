'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInvoice, createMatBaoProvider, transactionIdFor } = require('../src');
const { NOW, sampleInput, fakeTransport } = require('./fixtures');

const CONFIG = { taxCode: '0302712571-999', username: 'admin', password: 'secret' };
const BASE = 'https://demo-api-hddt.matbao.in:11443';
const LOGIN = { json: { Success: true, Data: 'mb-token', ErrorCode: '200', Message: 'Thành công' } };
const CREATED = { json: { Success: true, ErrorCode: '200', Data: [{ MaSoHDon: 'INV-9', SHDon: 42, KHMSHDon: '1', KHHDon: 'C26MAA', MaTraCuu: 'X', MCCQT: 'M1-26', TThaiHDon: 4 }] } };
const invoice = (o) => buildInvoice(sampleInput(o), { now: () => NOW });

function matbao(handler, extra = {}) {
  const fake = fakeTransport(handler);
  let clock = NOW;
  const provider = createMatBaoProvider({ ...CONFIG, ...extra }, { transport: fake.transport, now: () => clock });
  return { ...fake, provider, tick: (ms) => { clock += ms; } };
}

test('issue: login with MST/TDNhap/MKhau, then create-invoice with an array body', async () => {
  const { provider, calls } = matbao((c) => (c.url.endsWith('/api/auth/login') ? LOGIN : CREATED));
  const out = await provider.issue(invoice({ buyer: { companyName: 'Công ty CP ABC', taxCode: '0101243150', address: 'Hà Nội', citizenId: '001090012345' } }));

  assert.equal(calls[0].url, `${BASE}/api/auth/login`);
  assert.deepEqual(calls[0].body, { MST: '0302712571-999', TDNhap: 'admin', MKhau: 'secret' });
  const c = calls[1];
  assert.equal(c.url, `${BASE}/api/invoice/create-invoice`);
  assert.equal(c.headers.Authorization, 'Bearer mb-token');
  assert.ok(Array.isArray(c.body) && c.body.length === 1);
  const d = c.body[0];
  assert.equal(d.KHMSHDon, '1');
  assert.equal(d.KHHDon, 'C26MAA');
  assert.equal(d.NLap, '2026-10-14T04:30:00.000Z');
  assert.equal(d.DVTTe, '704');
  assert.equal(d.TGia, 1);
  assert.equal(d.HTTToan, 'TM/CK');
  assert.equal(d.MTChieu, transactionIdFor('HTP-ORD-000123'));
  assert.equal(d.KTraMTChieuTrung, 1);
  assert.equal(d.TCHDon, 0);
  assert.equal(d.LoaiHDon, 1);
  assert.equal(d.NMua_Ten, 'Công ty CP ABC');
  assert.equal(d.NMua_MST, '0101243150');
  assert.equal(d.NMua_CCCDan, '001090012345');
  assert.deepEqual(d.DSHHDVu.map((l) => l.TChat), [1, 1, 2, 3, 4]);
  assert.deepEqual(d.DSHHDVu[1], {
    TChat: 1, STT: 2, MHHDVu: 'BN01', THHDVu: 'Bánh mì', DVTinh: 'cái', SLuong: 2, DGia: 25000, ThTienChuaCK: 50000,
    TLCKhau: 10, STCKhau: 5000, ThTien: 45000, TSuat: 10, TThue: 4500, TgTien: 49500,
  });
  assert.equal(d.DSHHDVu[3].ThTien, 9999);
  assert.equal(d.TgThTien, 135000);
  assert.equal(d.TgTThue, 11700);
  assert.equal(d.TTCKTMai, 9999);
  assert.equal(d.TgTTTBSo, 146700);
  assert.equal(d.TgTTTBChu, 'Một trăm bốn mươi sáu nghìn bảy trăm đồng');

  assert.equal(out.providerInvoiceId, 'INV-9');
  assert.equal(out.invoiceNo, '42');
  assert.equal(out.taxAuthorityCode, 'M1-26');
  assert.equal(out.status, 'issued');
});

test('KCT and KKKNT map to -1 and -2', async () => {
  const { provider, calls } = matbao((c) => (c.url.endsWith('/api/auth/login') ? LOGIN : CREATED));
  await provider.issue(invoice({ lines: [
    { name: 'A', unit: 'c', quantity: 1, unitPrice: 1000, vatRate: 'KCT' },
    { name: 'B', unit: 'c', quantity: 1, unitPrice: 1000, vatRate: 'KKKNT' },
  ] }));
  assert.deepEqual(calls[1].body[0].DSHHDVu.map((l) => l.TSuat), [-1, -2]);
});

test('error codes: 305/304 duplicate, 300 draft-created rejected, 401 credentials (no retry)', async () => {
  for (const [code, expected] of [['305', 'einvoice_duplicate'], ['304', 'einvoice_duplicate'], ['300', 'einvoice_rejected'], ['308', 'einvoice_rejected'], ['401', 'einvoice_credentials_rejected']]) {
    const { provider, calls } = matbao((c) => (c.url.endsWith('/api/auth/login') ? LOGIN : { json: { Success: false, ErrorCode: code, Message: 'x' } }));
    await assert.rejects(provider.issue(invoice()), (err) => {
      assert.equal(err.code, expected, code);
      if (code === '300') assert.equal(err.details.draftCreated, true);
      return true;
    });
    assert.equal(calls.filter((c) => c.url.endsWith('/create-invoice')).length, 1);
    assert.equal(calls.filter((c) => c.url.endsWith('/api/auth/login')).length, 1);
  }
});

test('unknown outcome on 5xx / missing invoice id', async () => {
  const a = matbao((c) => (c.url.endsWith('/api/auth/login') ? LOGIN : { status: 502, text: 'Bad gateway' }));
  await assert.rejects(a.provider.issue(invoice()), { code: 'einvoice_outcome_unknown' });
  const b = matbao((c) => (c.url.endsWith('/api/auth/login') ? LOGIN : { json: { Success: true, Data: null } }));
  await assert.rejects(b.provider.issue(invoice()), { code: 'einvoice_outcome_unknown' });
});

test('getStatus by refId searches the date range and matches MTChieu; re-logs in once on 401', async () => {
  let logins = 0;
  const { provider, calls } = matbao((c) => {
    if (c.url.endsWith('/api/auth/login')) { logins += 1; return { json: { Success: true, Data: `t${logins}` } }; }
    if (c.headers.Authorization === 'Bearer t1') return { status: 401, json: {} };
    return { json: { Success: true, Data: [
      { MaSoHDon: 'OTHER', MTChieu: 'nope', TThaiHDon: 4 },
      { MaSoHDon: 'INV-9', MTChieu: transactionIdFor('HTP-ORD-000123'), SHDon: 42, KHHDon: 'C26MAA', TThaiHDon: 5, NLap: '2026-10-14T04:30:00Z' },
    ] } };
  });
  const st = await provider.getStatus('HTP-ORD-000123', { issueDate: '2026-10-14T04:30:00Z' });
  assert.equal(st.providerInvoiceId, 'INV-9');
  assert.equal(st.status, 'pending'); // 5 = CQT chưa phản hồi
  assert.equal(st.issuedAt, '2026-10-14T04:30:00.000Z');
  assert.equal(logins, 2);
  const detail = calls.filter((c) => c.url.endsWith('/invoice-detail'));
  assert.equal(detail.length, 2);
  assert.deepEqual(detail[1].body, { TNLap: '2026-10-13', DNLap: '2026-10-15', LoaiHDon: -1, TThaiHDon: -1 });
});

test('getStatus not_found', async () => {
  const { provider } = matbao((c) => (c.url.endsWith('/api/auth/login') ? LOGIN : { json: { Success: false, ErrorCode: '201' } }));
  assert.equal((await provider.getStatus({ refId: 'nope' })).status, 'not_found');
  const empty = matbao((c) => (c.url.endsWith('/api/auth/login') ? LOGIN : { json: { Success: true, Data: [] } }));
  assert.equal((await empty.provider.getStatus({ providerInvoiceId: 'INV-1' })).status, 'not_found');
});

test('getPdf and cancel', async () => {
  const { provider, calls } = matbao((c) => {
    if (c.url.endsWith('/api/auth/login')) return LOGIN;
    if (c.url.endsWith('/download-invoice')) return { json: { Success: true, Data: { Pdf: Buffer.from('%PDF').toString('base64') } } };
    return { json: { Success: true, Data: null } };
  });
  const pdf = await provider.getPdf({ providerInvoiceId: 'INV-9', lookupCode: 'LC1' });
  assert.equal(pdf.pdf.toString(), '%PDF');
  assert.deepEqual(calls[1].body, { MaTraCuu: 'LC1', MaSoHDon: 'INV-9' });
  await assert.rejects(provider.cancel({ providerInvoiceId: 'INV-9' }, ''), { code: 'einvoice_invalid' });
  const out = await provider.cancel({ providerInvoiceId: 'INV-9' }, 'Khách trả hàng');
  assert.equal(out.status, 'cancelled');
  assert.deepEqual(calls[2].body, { MaSoHDon: 'INV-9' });
  assert.equal(calls[2].url, `${BASE}/api/invoice/cancel-invoice`);
  await assert.rejects(provider.replace(), { code: 'einvoice_not_supported' });
});

test('production base URL and templates', async () => {
  const { provider, calls } = matbao((c) => (c.url.endsWith('/api/auth/login') ? LOGIN : { json: { Success: true, Data: [{ KHMSHDon: '1', KHHDon: 'C26MAA', SLuong: 100, CLai: 58 }] } }), { environment: 'production' });
  const t = await provider.getTemplates(2026);
  assert.equal(t[0].CLai, 58);
  assert.equal(calls[1].url, 'https://api-hddt.matbao.in:11443/api/invoice/templates?year=2026');
  assert.equal(calls[1].method, 'GET');
});
