'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createProviderRegistry } = require('@hitechpos/payment-core');
const { createPayOSProvider, dataSignature } = require('@hitechpos/payment-payos');

test('owner emails: welcome, trial reminders once, payment, suspension', async (t) => {
  let clock = new Date('2026-10-14T03:00:00Z');
  const sent = [];
  const mail = nodemailer.createTransport({ jsonTransport: true });
  const mailTransport = { sendMail: async (m) => { sent.push(m); return mail.sendMail(m); } };
  const KEY = 'k';
  const transport = async (url, init) => {
    const b = JSON.parse(init.body);
    const data = { bin: '1', accountNumber: '1', accountName: 'X', amount: b.amount, description: b.description, orderCode: b.orderCode, currency: 'VND', paymentLinkId: 'pl', status: 'PENDING', checkoutUrl: 'https://pay.payos.vn/x', qrCode: 'q' };
    return new Response(JSON.stringify({ code: '00', desc: 'ok', data, signature: dataSignature(data, KEY) }));
  };
  const config = loadConfig({ STORE: 'memory', ADMIN_API_KEY: 'admin-secret-key', PUBLIC_URL: 'https://app.hitechpos.vn' });
  const store = createMemoryStore();
  const { app, notifier, billing } = createApp({ store, config, now: () => clock, mailTransport, logger: { warn() {}, error() {}, info() {} }, installer: { async install() {} },
    providers: createProviderRegistry([createPayOSProvider({ clientId: 'c', apiKey: 'a', checksumKey: KEY }, { transport })]) });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => (await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) })).json();

  const s = await call('POST', '/api/signup', { subdomain: 'photue', businessName: 'Phở Tuệ <b>', industry: 'khac', ownerName: 'T', email: 'chu@photue.vn', phone: '0912345678', password: 'matkhau123' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'chu@photue.vn');
  assert.match(sent[0].subject, /Chào mừng/);
  assert.match(sent[0].html, /Phở Tuệ &lt;b&gt;/);
  assert.match(sent[0].html, /https:\/\/photue\.hitechpos\.vn/);

  clock = new Date('2026-10-25T03:00:00Z'); // 3 days before the 14-day trial ends
  assert.equal((await notifier.runReminders())[0].threshold, 3);
  assert.deepEqual(await notifier.runReminders(), []);
  clock = new Date('2026-10-27T05:00:00Z');
  assert.equal((await notifier.runReminders())[0].threshold, 1);
  assert.equal(sent.filter((m) => /dùng thử/.test(m.subject)).length, 2);

  /* the signup token (7 days) has expired by now */
  const login = await call('POST', '/api/auth/login', { email: 'chu@photue.vn', password: 'matkhau123' });
  const owner = { authorization: `Bearer ${login.token}` };
  const co = await call('POST', '/api/billing/checkout', { plan: 'basic', months: 1, provider: 'payos' }, owner);
  assert.ok(co.quote, JSON.stringify(co));
  const data = { orderCode: co.orderCode, amount: co.quote.total, description: 'x', accountNumber: '1', reference: 'FT', transactionDateTime: '2026-10-27 12:00:00', currency: 'VND', paymentLinkId: 'pl', code: '00', desc: 'ok' };
  await call('POST', '/webhooks/payos', { data, signature: dataSignature(data, KEY) });
  await call('POST', '/webhooks/payos', { data, signature: dataSignature(data, KEY) });
  assert.equal(sent.filter((m) => /đã nhận thanh toán/.test(m.subject)).length, 1);

  clock = new Date('2027-01-01T00:00:00Z');
  assert.deepEqual(await billing.enforceExpiry(), ['photue']);
  assert.match(sent[sent.length - 1].subject, /tạm ngưng/);
});
