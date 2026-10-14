'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createProviderRegistry } = require('@hitechpos/payment-core');

async function boot(einvoiceOptions = {}) {
  const config = loadConfig({ STORE: 'memory', PUBLIC_URL: 'https://app.hitechpos.vn' });
  const store = createMemoryStore();
  const { app } = createApp({ store, config, providers: createProviderRegistry(), installer: { async install() {} }, logger: { warn() {}, error() {} }, einvoiceOptions });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const r = await call('POST', '/api/signup', { subdomain: 'photue', businessName: 'Cà phê Phở Tuệ', industry: 'cafe-tra-sua', ownerName: 'Tuệ', email: 'a@photue.vn', phone: '0912345678', password: 'matkhau123' });
  const owner = { authorization: `Bearer ${r.json.token}` };
  const key = (await call('POST', '/api/shop/api-keys', {}, owner)).json.key;
  return { call, server, store, owner, pos: { authorization: `Bearer ${key}` } };
}

const SELLER = { taxCode: '0100109106', name: 'Công ty TNHH Phở Tuệ', address: '1 Tràng Tiền, Hà Nội' };
const SALE = { refId: 'HD-0001', paymentMethod: 'CK', lines: [
  { name: 'Cà phê sữa đá', unit: 'ly', quantity: 2, unitPrice: 29000, vatRate: 8 },
  { name: 'Bánh mì', unit: 'cái', quantity: 1, unitPrice: 25000, vatRate: 8 },
] };

test('issue an e-invoice once per sale with the mock provider', async (t) => {
  const { call, server, owner, pos } = await boot();
  t.after(() => server.close());
  assert.equal((await call('POST', '/pos/v1/einvoices', SALE, pos)).json.error, 'einvoice_not_configured');
  const s = await call('PUT', '/api/shop/einvoice-settings', { provider: 'mock', seller: SELLER, series: `1C${String(new Date().getFullYear()).slice(2)}MAA`, autoIssue: true }, owner);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const first = await call('POST', '/pos/v1/einvoices', SALE, pos);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.totals.gross, 83000);
  assert.equal(first.json.totals.amountInWords, 'Tám mươi ba nghìn đồng');
  const again = await call('POST', '/pos/v1/einvoices', SALE, pos);
  assert.equal(again.json.invoiceNo, first.json.invoiceNo);
  const second = await call('POST', '/pos/v1/einvoices', { ...SALE, refId: 'HD-0002' }, pos);
  assert.notEqual(second.json.invoiceNo, first.json.invoiceNo);
  assert.equal((await call('GET', '/pos/v1/einvoices/HD-0001', undefined, pos)).json.invoiceNo, first.json.invoiceNo);
  assert.equal((await call('GET', '/api/shop/einvoices', undefined, owner)).json.length, 2);
  const bad = await call('POST', '/pos/v1/einvoices', { refId: 'HD-3', lines: [] }, pos);
  assert.equal(bad.status, 422);
  assert.ok(bad.json.details.errors.length > 0);
});

test('provider settings are validated and secrets masked', async (t) => {
  const { call, server, owner } = await boot();
  t.after(() => server.close());
  const series = `1C${String(new Date().getFullYear()).slice(2)}MAA`;
  assert.equal((await call('PUT', '/api/shop/einvoice-settings', { provider: 'misa', connection: { appId: 'x' }, seller: SELLER, series }, owner)).json.error, 'einvoice_connection_incomplete');
  assert.equal((await call('PUT', '/api/shop/einvoice-settings', { provider: 'viettel', connection: { username: '0100109106', password: 'p' }, seller: { ...SELLER, taxCode: '123' }, series }, owner)).json.error, 'tax_code_invalid');
  const ok = await call('PUT', '/api/shop/einvoice-settings', { provider: 'viettel', connection: { username: '0100109106', password: 'bi-mat-viettel' }, seller: SELLER, series }, owner);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.connection.password, '••••••••');
  /* Saving again with the masked value keeps the stored password. */
  const again = await call('PUT', '/api/shop/einvoice-settings', { provider: 'viettel', environment: 'production', connection: { username: '0100109106', password: '••••••••' }, seller: SELLER, series }, owner);
  assert.equal(again.status, 200);
  assert.ok(!JSON.stringify(again.json).includes('bi-mat-viettel'));
});

test('unknown outcome blocks re-issue until reconciled', async (t) => {
  let creates = 0;
  const transport = async (url) => {
    if (url.includes('/auth/login')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    if (url.includes('createInvoice')) { creates++; return new Response('gateway timeout', { status: 504 }); }
    return new Response(JSON.stringify({ errorCode: null, result: [] }));
  };
  const { call, server, owner, pos } = await boot({ viettel: { transport } });
  t.after(() => server.close());
  const series = `1C${String(new Date().getFullYear()).slice(2)}MAA`;
  await call('PUT', '/api/shop/einvoice-settings', { provider: 'viettel', connection: { username: '0100109106', password: 'pw' }, seller: SELLER, series }, owner);
  const first = await call('POST', '/pos/v1/einvoices', SALE, pos);
  assert.equal(first.json.error, 'einvoice_outcome_unknown', JSON.stringify(first.json));
  const blocked = await call('POST', '/pos/v1/einvoices', SALE, pos);
  assert.equal(blocked.json.error, 'einvoice_outcome_unknown');
  assert.equal(creates, 1);
});

test('lookup URL template must be https and the provider name an own key', async (t) => {
  const { call, server, owner } = await boot();
  t.after(() => server.close());
  const series = `1C${String(new Date().getFullYear()).slice(2)}MAA`;
  const put = (provider, connection) => call('PUT', '/api/shop/einvoice-settings', { provider, connection, seller: SELLER, series }, owner);
  const conn = { username: '0100109106', password: 'p' };
  assert.equal((await put('viettel', { ...conn, lookupUrlTemplate: 'javascript:alert(1)//{code}' })).json.error, 'einvoice_lookup_url_invalid');
  assert.equal((await put('viettel', { ...conn, lookupUrlTemplate: 'http://tracuu.example.vn/?c={code}' })).json.error, 'einvoice_lookup_url_invalid');
  assert.equal((await put('viettel', { ...conn, lookupUrlTemplate: 'https://tracuu.example.vn/?c={code}' })).status, 200);
  for (const provider of ['__proto__', 'constructor', 'toString']) {
    const r = await put(provider, conn);
    assert.equal(r.status, 422, provider);
    assert.equal(r.json.error, 'einvoice_provider_invalid', provider);
  }
});
