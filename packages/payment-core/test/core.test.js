'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src');

test('transferDescription strips Vietnamese diacritics and caps length', () => {
  assert.equal(core.transferDescription('Thanh toán đơn #HĐ-0001 Phở Tuệ'), 'Thanh toan don HD 0001 Ph');
  assert.equal(core.transferDescription('Gói Pro tháng 10', { allowSpaces: false, max: 32 }), 'GoiProthang10');
});

test('generateOrderCode is a positive safe integer and varies', () => {
  const codes = new Set(Array.from({ length: 50 }, () => core.generateOrderCode()));
  for (const code of codes) assert.ok(Number.isSafeInteger(code) && code > 0);
  assert.ok(codes.size > 1);
});

test('safeEqual compares case-insensitively and tolerates bad input', () => {
  assert.ok(core.safeEqual('abcd', 'ABCD'));
  assert.ok(!core.safeEqual('abcd', 'abce'));
  assert.ok(!core.safeEqual('abcd', 'abc'));
  assert.ok(!core.safeEqual('abcd', undefined));
});

test('provider registry validates the contract', () => {
  const reg = core.createProviderRegistry();
  assert.throws(() => reg.register({ id: 'x' }), /missing createCheckout/);
  reg.register({ id: 'ok', createCheckout() {}, verifyCallback() {} });
  assert.deepEqual(reg.list(), ['ok']);
  assert.throws(() => reg.get('nope'), /not configured/);
});

test('requestJson never retries and maps failures to codes', async () => {
  let calls = 0;
  const down = async () => { calls++; throw new Error('ECONNRESET'); };
  await assert.rejects(core.requestJson(down, 'https://x.test', { method: 'POST', body: {}, prefix: 'payos' }), { code: 'payos_outcome_unknown' });
  assert.equal(calls, 1);
  const denied = async () => new Response('{"desc":"no"}', { status: 401 });
  await assert.rejects(core.requestJson(denied, 'https://x.test', { prefix: 'payos' }), { code: 'payos_credentials_rejected' });
  const ok = async () => new Response('{"a":1}', { status: 200 });
  assert.deepEqual(await core.requestJson(ok, 'https://x.test'), { a: 1 });
});

test('journal: paid with matching amount', async () => {
  const j = core.createJournal();
  await j.open({ orderCode: 1, provider: 'payos', amount: 199000, purpose: 'subscription' });
  const r = await j.apply({ provider: 'payos', orderCode: 1, status: 'paid', amount: 199000, eventKey: 'e1', transactionId: 'FT1' });
  assert.equal(r.payment.status, 'paid');
  assert.equal(r.changed, true);
  assert.equal(r.payment.transactionId, 'FT1');
});

test('journal: duplicate callbacks are no-ops', async () => {
  const j = core.createJournal();
  await j.open({ orderCode: 2, provider: 'payos', amount: 1000 });
  await j.apply({ provider: 'payos', orderCode: 2, status: 'paid', amount: 1000, eventKey: 'e' });
  const again = await j.apply({ provider: 'payos', orderCode: 2, status: 'paid', amount: 1000, eventKey: 'e' });
  assert.equal(again.ignored, 'duplicate');
  assert.equal(again.payment.events.length, 1);
});

test('journal: short payment goes to review, never paid', async () => {
  const j = core.createJournal();
  await j.open({ orderCode: 3, provider: 'pay2s', amount: 500000 });
  const r = await j.apply({ provider: 'pay2s', orderCode: 3, status: 'paid', amount: 50000, eventKey: 'x' });
  assert.equal(r.payment.status, 'review');
  assert.equal(r.payment.reviewReason, 'amount_mismatch');
});

test('journal: paid is terminal; late cancel is recorded but ignored', async () => {
  const j = core.createJournal();
  await j.open({ orderCode: 4, provider: 'payos', amount: 1000 });
  await j.apply({ provider: 'payos', orderCode: 4, status: 'paid', amount: 1000, eventKey: 'p' });
  const r = await j.apply({ provider: 'payos', orderCode: 4, status: 'cancelled', eventKey: 'c' });
  assert.equal(r.payment.status, 'paid');
  assert.equal(r.ignored, 'transition_not_allowed');
  assert.equal(r.payment.events.length, 2);
});

test('journal: transfer after expiry still settles', async () => {
  const j = core.createJournal();
  await j.open({ orderCode: 5, provider: 'payos', amount: 1000 });
  await j.apply({ provider: 'payos', orderCode: 5, status: 'expired', eventKey: 'x' });
  const r = await j.apply({ provider: 'payos', orderCode: 5, status: 'paid', amount: 1000, eventKey: 'p' });
  assert.equal(r.payment.status, 'paid');
});

test('journal: rejects bad input and cross-provider events', async () => {
  const j = core.createJournal();
  await assert.rejects(j.open({ orderCode: 0, provider: 'payos', amount: 1 }), { code: 'payment_order_code_invalid' });
  await assert.rejects(j.open({ orderCode: 6, provider: 'payos', amount: 1.5 }), { code: 'payment_amount_invalid' });
  await j.open({ orderCode: 6, provider: 'payos', amount: 1 });
  await assert.rejects(j.open({ orderCode: 6, provider: 'payos', amount: 1 }), { code: 'payment_duplicate_order_code' });
  await assert.rejects(j.apply({ provider: 'pay2s', orderCode: 6, status: 'paid', amount: 1 }), { code: 'payment_provider_mismatch' });
  await assert.rejects(j.apply({ provider: 'payos', orderCode: 99, status: 'paid', amount: 1 }), { code: 'payment_not_found' });
});

test('memory store list filters on dotted fields', async () => {
  const j = core.createJournal();
  await j.open({ orderCode: 10, provider: 'payos', amount: 1, reference: 't1', metadata: { saleRef: 'S1' } });
  await j.open({ orderCode: 11, provider: 'payos', amount: 1, reference: 't2', metadata: { saleRef: 'S1' } });
  assert.deepEqual((await j.store.list({ reference: 't1' })).map((p) => p.orderCode), [10]);
  assert.equal((await j.store.list({ 'metadata.saleRef': 'S1' })).length, 2);
  assert.equal((await j.store.list()).length, 2);
});

test('string helpers are linear and strict', () => {
  assert.equal(core.trimTrailingSlashes('https://a.vn///'), 'https://a.vn');
  assert.equal(core.trimTrailingSlashes('/'.repeat(100000) + 'x'), '/'.repeat(100000) + 'x');
  for (const ok of ['a@b.vn', 'ke.toan@cong-ty.com.vn']) assert.ok(core.isEmail(ok), ok);
  for (const bad of ['a@b', '@b.vn', 'a@@b.vn', 'a@.vn', 'a@b.', 'a b@c.vn', 'a@b..vn', 'x'.repeat(250) + '@b.vn', 'a.'.repeat(5000)]) assert.ok(!core.isEmail(bad), bad);
  assert.equal(core.forLog('a\nb\r\nc'), 'a b  c');
  assert.equal(core.stripTags('<<b>b>x</b>'), 'x');
  assert.equal(core.stripTags('<span style="x">PHIẾU</span>'), 'PHIẾU');
});
