'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInvoice, createMisaProvider, transactionIdFor } = require('../src');
const { NOW, sampleInput, fakeTransport, jwt } = require('./fixtures');

const CONFIG = { appId: 'app-123', taxCode: '0100109106', username: 'api@shop.vn', password: 'secret' };
const BASE = 'https://testapi.meinvoice.vn/api/integration';
const TOKEN = jwt(Math.floor(NOW / 1000) + 3600);
const LOGIN = { json: { Success: true, Data: TOKEN, ErrorCode: null } };
const invoice = (o) => buildInvoice(sampleInput(o), { now: () => NOW });
const published = (extra = {}) => ({
  json: {
    success: true, errorCode: null, descriptionErrorCode: null,
    publishInvoiceResult: JSON.stringify([{
      RefID: transactionIdFor('HTP-ORD-000123'), TransactionID: 'TRX8K2MN4', InvNo: '00000042', InvSeries: '1C26MAA', InvDate: '2026-10-14', InvCode: 'M1-26-ABC', ErrorCode: '', ...extra,
    }]),
  },
});

function misa(handler, extra = {}) {
  const fake = fakeTransport(handler);
  let clock = NOW;
  const provider = createMisaProvider({ ...CONFIG, ...extra }, { transport: fake.transport, now: () => clock });
  return { ...fake, provider, tick: (ms) => { clock += ms; } };
}

test('issue: token with appid/taxcode/username/password, then publish (SignType 5 for cash register)', async () => {
  const { provider, calls } = misa((c) => (c.url.endsWith('/auth/token') ? LOGIN : published()));
  const out = await provider.issue(invoice({ buyer: { name: 'Trần Thị B', email: 'b@example.com' } }));

  assert.equal(calls[0].url, `${BASE}/auth/token`);
  assert.deepEqual(calls[0].body, { appid: 'app-123', taxcode: '0100109106', username: 'api@shop.vn', password: 'secret' });

  const c = calls[1];
  assert.equal(c.url, `${BASE}/invoice`);
  assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(c.headers.CompanyTaxCode, '0100109106');
  assert.equal(c.body.SignType, 5);
  assert.equal(c.body.PublishInvoiceData, null);
  const d = c.body.InvoiceData[0];
  assert.equal(d.RefID, transactionIdFor('HTP-ORD-000123'));
  assert.equal(d.InvSeries, '1C26MAA');
  assert.equal(d.InvDate, '2026-10-14');
  assert.equal(d.InvoiceName, 'Hóa đơn giá trị gia tăng khởi tạo từ máy tính tiền');
  assert.equal(d.IsInvoiceCalculatingMachine, true);
  assert.equal(d.CurrencyCode, 'VND');
  assert.equal(d.ExchangeRate, 1);
  assert.equal(d.PaymentMethodName, 'TM/CK');
  assert.equal(d.BuyerFullName, 'Trần Thị B');
  assert.equal(d.IsSendEmail, true);
  assert.equal(d.ReceiverEmail, 'b@example.com');
  assert.equal(d.TotalSaleAmountOC, 144999);
  assert.equal(d.TotalDiscountAmount, 5000);
  assert.equal(d.TotalAmountWithoutVAT, 135000);
  assert.equal(d.TotalVATAmountOC, 11700);
  assert.equal(d.TotalAmount, 146700);
  assert.equal(d.TotalAmountInWords, 'Một trăm bốn mươi sáu nghìn bảy trăm đồng');
  assert.deepEqual(d.OriginalInvoiceDetail.map((l) => l.ItemType), [1, 1, 2, 3, 4]);
  assert.deepEqual(d.OriginalInvoiceDetail[1], {
    ItemType: 1, LineNumber: 2, SortOrder: 2, ItemCode: 'BN01', ItemName: 'Bánh mì', UnitName: 'cái', Quantity: 2, UnitPrice: 25000,
    DiscountRate: 10, DiscountAmountOC: 5000, DiscountAmount: 5000, AmountOC: 50000, Amount: 50000,
    AmountWithoutVATOC: 45000, AmountWithoutVAT: 45000, VATRateName: '10%', VATAmountOC: 4500, VATAmount: 4500, AmountAfterTax: 49500,
  });
  assert.deepEqual(d.TaxRateInfo, [
    { VATRateName: '8%', AmountWithoutVATOC: 90000, AmountWithoutVAT: 90000, VATAmountOC: 7200, VATAmount: 7200 },
    { VATRateName: '10%', AmountWithoutVATOC: 45000, AmountWithoutVAT: 45000, VATAmountOC: 4500, VATAmount: 4500 },
  ]);
  assert.equal(d.OptionUserDefined.AmountDecimalDigits, '0');

  assert.equal(out.provider, 'misa');
  assert.equal(out.providerInvoiceId, 'TRX8K2MN4');
  assert.equal(out.lookupCode, 'TRX8K2MN4');
  assert.equal(out.invoiceNo, '00000042');
  assert.equal(out.taxAuthorityCode, 'M1-26-ABC');
  assert.equal(out.status, 'issued');
});

test('non cash-register invoices default to SignType 2 (HSM); anonymous buyer gets the legal placeholder', async () => {
  const { provider, calls } = misa((c) => (c.url.endsWith('/auth/token') ? LOGIN : published({ InvCode: '' })));
  const out = await provider.issue(invoice({ fromCashRegister: false, series: '1C26TAA', lines: [{ name: 'Dịch vụ', unit: 'lần', quantity: 1, unitPrice: 100000, vatRate: 'KCT' }] }));
  const d = calls[1].body.InvoiceData[0];
  assert.equal(calls[1].body.SignType, 2);
  assert.equal(d.IsInvoiceCalculatingMachine, false);
  assert.equal(d.InvoiceName, 'Hóa đơn giá trị gia tăng');
  assert.equal(d.BuyerLegalName, 'Khách lẻ không lấy hoá đơn');
  assert.equal(d.IsSendEmail, false);
  assert.equal(d.OriginalInvoiceDetail[0].VATRateName, 'KCT');
  assert.equal(out.status, 'pending'); // C-series without CQT code yet
});

test('SignType 5 is refused for invoices not from a cash register', async () => {
  const { provider, calls } = misa(() => LOGIN, { signType: 5 });
  await assert.rejects(provider.issue(invoice({ fromCashRegister: false, series: '1C26TAA' })), { code: 'einvoice_configuration_invalid' });
  assert.equal(calls.length, 0);
});

test('rejections, duplicates and unknown outcomes', async () => {
  const rej = misa((c) => (c.url.endsWith('/auth/token') ? LOGIN : { json: { success: false, errorCode: 'InvalidInvSeries', descriptionErrorCode: 'Ký hiệu không hợp lệ' } }));
  await assert.rejects(rej.provider.issue(invoice()), (err) => {
    assert.equal(err.code, 'einvoice_rejected');
    assert.equal(err.details.providerCode, 'InvalidInvSeries');
    return true;
  });
  const item = misa((c) => (c.url.endsWith('/auth/token') ? LOGIN : published({ ErrorCode: 'DuplicateRefID', TransactionID: '' })));
  await assert.rejects(item.provider.issue(invoice()), { code: 'einvoice_duplicate', status: 409 });
  const zero = misa((c) => (c.url.endsWith('/auth/token') ? LOGIN : published({ ErrorCode: '0' })));
  assert.equal((await zero.provider.issue(invoice())).status, 'issued');
  const empty = misa((c) => (c.url.endsWith('/auth/token') ? LOGIN : { json: { success: true } }));
  await assert.rejects(empty.provider.issue(invoice()), { code: 'einvoice_outcome_unknown' });
  const timeout = misa((c) => {
    if (c.url.endsWith('/auth/token')) return LOGIN;
    throw new DOMException('timed out', 'TimeoutError');
  });
  await assert.rejects(timeout.provider.issue(invoice()), { code: 'einvoice_outcome_unknown' });
  assert.equal(timeout.calls.filter((c) => c.url.endsWith('/invoice')).length, 1);
});

test('login failure surfaces as credentials_rejected', async () => {
  const { provider } = misa(() => ({ json: { Success: false, ErrorCode: 'InvalidAppID' } }));
  await assert.rejects(provider.issue(invoice()), (err) => {
    assert.equal(err.code, 'einvoice_credentials_rejected');
    assert.equal(err.details.providerCode, 'InvalidAppID');
    return true;
  });
});

test('token from the JWT exp is cached; body-level UnAuthorize on a read re-logs in once', async () => {
  let logins = 0;
  const { provider, calls } = misa((c) => {
    if (c.url.endsWith('/auth/token')) { logins += 1; return { json: { Success: true, Data: logins === 1 ? TOKEN : `${TOKEN}2` } }; }
    if (c.headers.Authorization === `Bearer ${TOKEN}` && calls.filter((x) => x.url.includes('/status')).length === 2) {
      return { json: { Success: false, ErrorCode: 'UnAuthorize' } };
    }
    return { json: { Success: true, Data: JSON.stringify([{ RefID: 'x', TransactionID: 'TRX1', InvNo: '42', InvCode: 'M1', InvDate: '2026-10-14T11:30:00' }]) } };
  });
  const st = await provider.getStatus('HTP-ORD-000123', { fromCashRegister: true });
  assert.equal(st.status, 'issued');
  assert.equal(st.providerInvoiceId, 'TRX1');
  const statusCall = calls.find((c) => c.url.includes('/invoice/status'));
  assert.equal(statusCall.url, `${BASE}/invoice/status?invoiceWithCode=true&invoiceCalcu=true&inputType=2`);
  assert.deepEqual(statusCall.body, [transactionIdFor('HTP-ORD-000123')]);
  await provider.getStatus('HTP-ORD-000123'); // second status call answers UnAuthorize -> re-login + repeat
  assert.equal(logins, 2);
  assert.equal(calls.filter((c) => c.url.includes('/status')).length, 3);
});

test('issue does not re-login on a body-level UnAuthorize', async () => {
  const { provider, calls } = misa((c) => (c.url.endsWith('/auth/token') ? LOGIN : { json: { success: false, errorCode: 'UnAuthorize' } }));
  await assert.rejects(provider.issue(invoice()), { code: 'einvoice_credentials_rejected' });
  assert.equal(calls.length, 2);
});

test('getStatus by TransactionID and not_found', async () => {
  const { provider, calls } = misa((c) => (c.url.endsWith('/auth/token') ? LOGIN : { json: { Success: true, Data: '[]' } }));
  const st = await provider.getStatus({ providerInvoiceId: 'TRX1' });
  assert.equal(st.status, 'not_found');
  assert.match(calls[1].url, /inputType=1$/);
  assert.deepEqual(calls[1].body, ['TRX1']);
});

test('getPdf downloads by TransactionID', async () => {
  const { provider, calls } = misa((c) => (c.url.endsWith('/auth/token') ? LOGIN
    : { json: { Success: true, Data: JSON.stringify([{ TransactionID: 'TRX1', Data: Buffer.from('%PDF').toString('base64') }]) } }));
  const out = await provider.getPdf({ providerInvoiceId: 'TRX1' }, { fromCashRegister: true });
  assert.equal(out.pdf.toString(), '%PDF');
  assert.equal(calls[1].url, `${BASE}/invoice/Download?invoiceWithCode=true&invoiceCalcu=true&downloadDataType=pdf`);
  assert.deepEqual(calls[1].body, ['TRX1']);
});

test('templates and environments', async () => {
  const { provider, calls } = misa((c) => (c.url.endsWith('/auth/token') ? LOGIN : { json: { Success: true, Data: JSON.stringify([{ InvSeries: '1C26MAA' }]) } }), { environment: 'production' });
  assert.deepEqual(await provider.getTemplates({ year: 2026 }), [{ InvSeries: '1C26MAA' }]);
  assert.equal(calls[0].url, 'https://api.meinvoice.vn/api/integration/auth/token');
  assert.equal(calls[1].method, 'GET');
  assert.equal(calls[1].url, 'https://api.meinvoice.vn/api/integration/invoice/templates?invoiceWithCode=true&ticket=false&year=2026');
  await assert.rejects(provider.cancel({ providerInvoiceId: 'TRX1' }, 'x'), { code: 'einvoice_not_supported' });
  assert.throws(() => createMisaProvider({ ...CONFIG, appId: '' }, { transport: fetch }), { code: 'einvoice_configuration_invalid' });
});
