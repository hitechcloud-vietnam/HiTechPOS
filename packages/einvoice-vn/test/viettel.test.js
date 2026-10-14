'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInvoice, createViettelProvider, transactionIdFor, withIssueGuard } = require('../src');
const { NOW, sampleInput, fakeTransport } = require('./fixtures');

const CONFIG = { username: '0100109106', password: 'secret', environment: 'production', templateCode: '1/001' };
const API = 'https://api-vinvoice.viettel.vn/services/einvoiceapplication/api/InvoiceAPI';
const invoice = (o) => buildInvoice(sampleInput(o), { now: () => NOW });
const LOGIN = { json: { access_token: 'tok-1', token_type: 'bearer', expires_in: 3600 } };
const CREATED = { json: { errorCode: null, description: null, result: { supplierTaxCode: '0100109106', invoiceNo: 'C26MAA42', transactionID: 'vt-1', reservationCode: 'ABCD1234', codeOfTax: 'M1-26-XYZ' } } };

function viettel(handler, extra = {}) {
  const fake = fakeTransport(handler);
  let clock = NOW;
  const provider = createViettelProvider({ ...CONFIG, ...extra }, { transport: fake.transport, now: () => clock });
  return { ...fake, provider, tick: (ms) => { clock += ms; } };
}

test('issue: login, then createInvoice with the mapped payload', async () => {
  const { provider, calls } = viettel((c) => (c.url.endsWith('/auth/login') ? LOGIN : CREATED));
  const inv = invoice();
  const out = await provider.issue(inv);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api-vinvoice.viettel.vn/auth/login');
  assert.deepEqual(calls[0].body, { username: '0100109106', password: 'secret' });
  assert.equal(calls[0].redirect, 'error');

  const c = calls[1];
  assert.equal(c.url, `${API}/InvoiceWS/createInvoice/0100109106`);
  assert.equal(c.method, 'POST');
  assert.equal(c.headers.Authorization, 'Bearer tok-1');
  assert.equal(c.headers['Content-Type'], 'application/json');
  const g = c.body.generalInvoiceInfo;
  assert.equal(g.invoiceType, '1');
  assert.equal(g.templateCode, '1/001');
  assert.equal(g.invoiceSeries, 'C26MAA');
  assert.equal(g.currencyCode, 'VND');
  assert.equal(g.invoiceIssuedDate, Date.parse('2026-10-14T04:30:00Z'));
  assert.equal(g.transactionUuid, transactionIdFor('HTP-ORD-000123'));
  assert.equal(c.body.buyerInfo.buyerName, 'Khách lẻ không lấy hoá đơn');
  assert.equal(c.body.buyerInfo.buyerNotGetInvoice, '1');
  assert.equal(c.body.sellerInfo.sellerTaxCode, '0100109106');
  assert.deepEqual(c.body.payments, [{ paymentMethod: 'TM/CK', paymentMethodName: 'TM/CK' }]);
  assert.equal(c.body.itemInfo.length, 5);
  assert.deepEqual(c.body.itemInfo[1], {
    lineNumber: 2, selection: 1, itemCode: 'BN01', itemName: 'Bánh mì', unitName: 'cái', unitPrice: 25000, quantity: 2,
    itemTotalAmountWithoutTax: 50000, itemDiscount: 5000, itemTotalAmountAfterDiscount: 45000, taxPercentage: 10, taxAmount: 4500,
  });
  assert.equal(c.body.itemInfo[3].selection, 3);
  assert.equal(c.body.itemInfo[4].selection, 2);
  assert.deepEqual(c.body.summarizeInfo, {
    sumOfTotalLineAmountWithoutTax: 144999, totalAmountWithoutTax: 135000, totalTaxAmount: 11700, totalAmountWithTax: 146700,
    totalAmountWithTaxInWords: 'Một trăm bốn mươi sáu nghìn bảy trăm đồng', discountAmount: 9999,
  });
  assert.deepEqual(c.body.taxBreakdowns, [
    { taxPercentage: 8, taxableAmount: 90000, taxAmount: 7200 },
    { taxPercentage: 10, taxableAmount: 45000, taxAmount: 4500 },
  ]);

  assert.equal(out.provider, 'viettel');
  assert.equal(out.refId, 'HTP-ORD-000123');
  assert.equal(out.providerInvoiceId, 'C26MAA42');
  assert.equal(out.invoiceNo, '42');
  assert.equal(out.series, 'C26MAA');
  assert.equal(out.lookupCode, 'ABCD1234');
  assert.equal(out.taxAuthorityCode, 'M1-26-XYZ');
  assert.equal(out.status, 'issued');
});

test('KCT/KKKNT map to -1/-2 and a C-series invoice without a CQT code is pending', async () => {
  const { provider, calls } = viettel((c) => (c.url.endsWith('/auth/login') ? LOGIN
    : { json: { errorCode: null, result: { invoiceNo: 'C26MAA7', reservationCode: 'R' } } }));
  const out = await provider.issue(invoice({ lines: [
    { name: 'Sách', unit: 'cuốn', quantity: 1, unitPrice: 50000, vatRate: 'KCT' },
    { name: 'Phí', unit: 'lần', quantity: 1, unitPrice: 1000, vatRate: 'KKKNT' },
  ] }));
  assert.deepEqual(calls[1].body.itemInfo.map((i) => i.taxPercentage), [-1, -2]);
  assert.equal(out.status, 'pending');
});

test('token is cached until shortly before expiry', async () => {
  const { provider, calls, tick } = viettel((c) => (c.url.endsWith('/auth/login') ? LOGIN : { json: { result: [] } }));
  await provider.getStatus('A');
  await provider.getStatus('B');
  assert.equal(calls.filter((c) => c.url.endsWith('/auth/login')).length, 1);
  tick(3600 * 1000 - 30 * 1000); // inside the 60 s refresh skew
  await provider.getStatus('C');
  assert.equal(calls.filter((c) => c.url.endsWith('/auth/login')).length, 2);
});

test('read calls re-login once after a 401', async () => {
  let n = 0;
  const { provider, calls } = viettel((c) => {
    if (c.url.endsWith('/auth/login')) { n += 1; return { json: { access_token: `tok-${n}`, expires_in: 3600 } }; }
    if (c.headers.Authorization === 'Bearer tok-1') return { status: 401, json: { message: 'expired' } };
    return { json: { result: [{ invoiceNo: 'C26MAA42', reservationCode: 'R1', issueDate: Date.parse('2026-10-14T04:31:00Z'), status: 'Đã phát hành' }] } };
  });
  const st = await provider.getStatus({ refId: 'HTP-ORD-000123' });
  assert.equal(st.status, 'issued');
  assert.equal(st.invoiceNo, '42');
  assert.equal(st.series, 'C26MAA');
  assert.equal(st.issuedAt, '2026-10-14T04:31:00.000Z');
  const search = calls.filter((c) => c.url.endsWith('/searchInvoiceByTransactionUuid'));
  assert.equal(search.length, 2);
  assert.equal(search[1].headers['Content-Type'], 'application/x-www-form-urlencoded;charset=UTF-8');
  assert.equal(search[1].rawBody, `supplierTaxCode=0100109106&transactionUuid=${transactionIdFor('HTP-ORD-000123')}`);
});

test('issue is never retried: a 401 on create surfaces, the next call logs in again', async () => {
  let n = 0;
  const { provider, calls } = viettel((c) => {
    if (c.url.endsWith('/auth/login')) { n += 1; return { json: { access_token: `tok-${n}`, expires_in: 3600 } }; }
    if (c.url.includes('/createInvoice/') && n === 1) return { status: 401, json: {} };
    return CREATED;
  });
  await assert.rejects(provider.issue(invoice()), { code: 'einvoice_credentials_rejected' });
  assert.equal(calls.filter((c) => c.url.includes('/createInvoice/')).length, 1);
  await provider.issue(invoice());
  assert.equal(calls.filter((c) => c.url.endsWith('/auth/login')).length, 2);
});

test('timeouts and 5xx on create are an unknown outcome, never retried', async () => {
  for (const failure of ['network', 500, 'garbage']) {
    const { provider, calls } = viettel((c) => {
      if (c.url.endsWith('/auth/login')) return LOGIN;
      if (failure === 'network') throw new TypeError('fetch failed');
      if (failure === 'garbage') return { text: '<html>gateway</html>' };
      return { status: failure, json: {} };
    });
    await assert.rejects(provider.issue(invoice()), (err) => {
      assert.equal(err.code, 'einvoice_outcome_unknown');
      assert.equal(err.status, 502);
      return true;
    });
    assert.equal(calls.filter((c) => c.url.includes('/createInvoice/')).length, 1);
  }
});

test('provider errors map to rejected or duplicate', async () => {
  const { provider } = viettel((c) => (c.url.endsWith('/auth/login') ? LOGIN
    : { json: { errorCode: 'TEMPLATE_NOT_FOUND', description: 'Mẫu hoá đơn không tồn tại' } }));
  await assert.rejects(provider.issue(invoice()), (err) => {
    assert.equal(err.code, 'einvoice_rejected');
    assert.equal(err.details.providerCode, 'TEMPLATE_NOT_FOUND');
    assert.doesNotMatch(err.message, /không tồn tại/); // provider text stays in details
    return true;
  });
  const dup = viettel((c) => (c.url.endsWith('/auth/login') ? LOGIN
    : { json: { errorCode: 'ERR', description: 'transactionUuid đã tồn tại' } }));
  await assert.rejects(dup.provider.issue(invoice()), { code: 'einvoice_duplicate', status: 409 });
  const bad = viettel(() => ({ status: 401, json: {} }));
  await assert.rejects(bad.provider.issue(invoice()), { code: 'einvoice_credentials_rejected' });
});

test('getStatus returns not_found when Viettel has no invoice for the transaction', async () => {
  const { provider } = viettel((c) => (c.url.endsWith('/auth/login') ? LOGIN : { json: { errorCode: null, result: null } }));
  const st = await provider.getStatus('HTP-ORD-404');
  assert.equal(st.status, 'not_found');
  assert.equal(st.transactionId, transactionIdFor('HTP-ORD-404'));
});

test('getPdf decodes fileToBytes', async () => {
  const { provider, calls } = viettel((c) => (c.url.endsWith('/auth/login') ? LOGIN
    : { json: { errorCode: 200, fileToBytes: Buffer.from('%PDF-1.4').toString('base64'), fileName: 'C26MAA42.pdf' } }));
  const out = await provider.getPdf({ providerInvoiceId: 'C26MAA42' });
  assert.equal(out.pdf.toString(), '%PDF-1.4');
  assert.equal(out.fileName, 'C26MAA42.pdf');
  assert.equal(calls[1].url, `${API}/InvoiceUtilsWS/getInvoiceRepresentationFile`);
  assert.deepEqual(calls[1].body, { supplierTaxCode: '0100109106', invoiceNo: 'C26MAA42', templateCode: '1/001', fileType: 'PDF' });
  const empty = viettel((c) => (c.url.endsWith('/auth/login') ? LOGIN : { json: { errorCode: 500, description: 'x' } }));
  await assert.rejects(empty.provider.getPdf({ providerInvoiceId: 'C26MAA42' }), { code: 'einvoice_unavailable' });
});

test('unverified mutations are not guessed', async () => {
  const { provider } = viettel(() => LOGIN);
  await assert.rejects(provider.cancel({ providerInvoiceId: 'x' }, 'sai'), { code: 'einvoice_not_supported', status: 501 });
  await assert.rejects(provider.replace(), { code: 'einvoice_not_supported' });
  await assert.rejects(provider.adjust(), { code: 'einvoice_not_supported' });
});

test('configuration is validated', () => {
  assert.throws(() => createViettelProvider({ password: 'x' }, { transport: fetch }), { code: 'einvoice_configuration_invalid' });
  assert.throws(() => createViettelProvider({ ...CONFIG, baseUrl: 'ftp://x' }, { transport: fetch }), { code: 'einvoice_configuration_invalid' });
  const p = createViettelProvider({ ...CONFIG, environment: 'sandbox' }, { transport: fetch });
  assert.equal(p.id, 'viettel');
});

test('with the issue guard the same refId reaches Viettel once', async () => {
  const { provider, calls } = viettel((c) => (c.url.endsWith('/auth/login') ? LOGIN : CREATED));
  const guarded = withIssueGuard(provider);
  const a = await guarded.issue(invoice());
  const b = await guarded.issue(invoice());
  assert.deepEqual(a, b);
  assert.equal(calls.filter((c) => c.url.includes('/createInvoice/')).length, 1);
});
