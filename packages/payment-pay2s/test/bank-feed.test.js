'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBankFeed } = require('../src');

const BODY = JSON.stringify({ transactions: [
  { id: 991, gateway: 'MBBank', transactionDate: '2026-10-14 15:20:01', transactionNumber: 'FT26287', accountNumber: '0912345678', content: '1791966752534703 photue HD 0001', transferType: 'IN', transferAmount: 85000 },
  { id: 992, gateway: 'MBBank', accountNumber: '0912345678', content: 'rut tien', transferType: 'OUT', transferAmount: '200,000' },
  { id: 993, content: 'bad', transferType: 'IN', transferAmount: 'abc' },
] });

test('bank feed: bearer token and normalisation', () => {
  const txs = parseBankFeed(BODY, { authorization: 'Bearer shop-token', token: 'shop-token' });
  assert.equal(txs.length, 2);
  assert.deepEqual(txs[0], { id: '991', bank: 'MBBank', accountNumber: '0912345678', virtualAccount: null, content: '1791966752534703 photue HD 0001', direction: 'in', amount: 85000, at: '2026-10-14 15:20:01' });
  assert.equal(txs[1].direction, 'out');
  assert.equal(txs[1].amount, 200000);
  assert.throws(() => parseBankFeed(BODY, { authorization: 'Bearer nope', token: 'shop-token' }), { code: 'pay2s_bank_feed_unauthorized' });
  assert.throws(() => parseBankFeed(BODY, { authorization: 'Bearer x', token: '' }), { code: 'pay2s_bank_feed_not_configured' });
  assert.throws(() => parseBankFeed('{"x":1}', { authorization: 'Bearer t', token: 't' }), { code: 'pay2s_bank_feed_invalid' });
});
