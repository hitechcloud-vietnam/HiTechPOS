'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInvoice, createMockProvider, createEInvoiceRegistry, withIssueGuard, assertProvider, createProvider,
  transactionIdFor, EInvoiceError, EINVOICE_STATUS,
} = require('../src');
const { NOW, sampleInput } = require('./fixtures');

const invoice = (o) => buildInvoice(sampleInput(o), { now: () => NOW });

test('mock assigns sequential numbers per template + series and is idempotent per refId', async () => {
  const mock = createMockProvider({ now: () => NOW });
  const a = await mock.issue(invoice({ refId: 'A' }));
  const b = await mock.issue(invoice({ refId: 'B' }));
  const c = await mock.issue(invoice({ refId: 'C', series: '1C26MAB' }));
  const again = await mock.issue(invoice({ refId: 'A' }));
  assert.deepEqual([a.invoiceNo, b.invoiceNo, c.invoiceNo], ['1', '2', '1']);
  assert.equal(again.providerInvoiceId, a.providerInvoiceId);
  assert.equal(a.status, EINVOICE_STATUS.ISSUED);
  assert.equal(a.transactionId, transactionIdFor('A'));
  assert.equal((await mock.getStatus('B')).invoiceNo, '2');
  assert.equal((await mock.getStatus({ providerInvoiceId: c.providerInvoiceId })).series, 'C26MAB');
  assert.equal((await mock.getStatus('Z')).status, 'not_found');
  assert.match((await mock.getPdf('A')).pdf.toString(), /^%PDF/);
  assert.equal((await mock.cancel('A', 'Sai thông tin')).status, 'cancelled');
});

test('issue guard: same refId twice -> provider called once', async () => {
  const mock = createMockProvider();
  const guarded = withIssueGuard(mock);
  const first = await guarded.issue(invoice());
  const second = await guarded.issue(invoice());
  assert.deepEqual(first, second);
  assert.equal(mock.calls.issue, 1);
});

test('issue guard: concurrent issue of the same refId is refused', async () => {
  let release;
  const slow = { id: 'slow', issue: () => new Promise((r) => { release = r; }), getStatus: async () => ({ status: 'not_found' }) };
  const guarded = withIssueGuard(slow);
  const p = guarded.issue(invoice());
  await new Promise((r) => setImmediate(r));
  await assert.rejects(guarded.issue(invoice()), { code: 'einvoice_issue_in_progress', status: 409 });
  release({ status: 'issued' });
  assert.deepEqual(await p, { status: 'issued' });
});

test('issue guard: unknown outcome blocks re-issue until reconciled (provider committed)', async () => {
  const mock = createMockProvider();
  const guarded = withIssueGuard(mock);
  mock.failNextIssue('unknown');
  await assert.rejects(guarded.issue(invoice()), { code: 'einvoice_outcome_unknown' });
  await assert.rejects(guarded.issue(invoice()), { code: 'einvoice_outcome_unknown', status: 409 });
  assert.equal(mock.calls.issue, 1); // never retried automatically
  const found = await guarded.reconcile('HTP-ORD-000123');
  assert.equal(found.status, 'issued');
  const after = await guarded.issue(invoice());
  assert.equal(after.invoiceNo, found.invoiceNo);
  assert.equal(mock.calls.issue, 1);
  assert.equal(mock.invoices().length, 1);
});

test('issue guard: unknown outcome, provider never received it -> reconcile frees the refId', async () => {
  const mock = createMockProvider();
  const guarded = withIssueGuard(mock);
  mock.failNextIssue('lost');
  await assert.rejects(guarded.issue(invoice()), { code: 'einvoice_outcome_unknown' });
  assert.equal((await guarded.reconcile('HTP-ORD-000123')).status, 'not_found');
  const out = await guarded.issue(invoice());
  assert.equal(out.invoiceNo, '1');
  assert.equal(mock.calls.issue, 2);
});

test('issue guard: a rejection does not block a corrected re-issue', async () => {
  const mock = createMockProvider();
  const guarded = withIssueGuard(mock);
  mock.failNextIssue('rejected');
  await assert.rejects(guarded.issue(invoice()), { code: 'einvoice_rejected' });
  assert.equal((await guarded.issue(invoice())).status, 'issued');
});

test('issue guard works with an async durable store', async () => {
  const data = new Map();
  const store = { get: async (k) => data.get(k), set: async (k, v) => { data.set(k, v); }, delete: async (k) => { data.delete(k); } };
  const mock = createMockProvider();
  await withIssueGuard(mock, { store }).issue(invoice());
  // a new process (new guard, same store) does not issue again
  await withIssueGuard(mock, { store }).issue(invoice());
  assert.equal(mock.calls.issue, 1);
  assert.equal(data.get('HTP-ORD-000123').state, 'done');
});

test('registry and contract', () => {
  const reg = createEInvoiceRegistry([createMockProvider()]);
  assert.deepEqual(reg.list(), ['mock']);
  assert.equal(reg.get('mock').id, 'mock');
  assert.throws(() => reg.get('nope'), /not configured/);
  assert.throws(() => reg.register(createMockProvider()), /already registered/);
  assert.throws(() => assertProvider({ id: 'x', issue() {} }), /getStatus/);
  const v = createProvider('viettel', { username: 'u', password: 'p' }, { transport: fetch });
  assert.equal(v.id, 'viettel');
  assert.throws(() => createProvider('vnpt', {}), /not supported/);
});

test('transactionIdFor is deterministic and keeps UUID refIds', () => {
  const id = transactionIdFor('HTP-ORD-000123');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(transactionIdFor('HTP-ORD-000123'), id);
  assert.notEqual(transactionIdFor('HTP-ORD-000124'), id);
  assert.equal(transactionIdFor('7A9F9E2A-D28F-4BEF-A9D0-D91607453F70'), '7a9f9e2a-d28f-4bef-a9d0-d91607453f70');
});

test('EInvoiceError carries code and status', () => {
  const e = new EInvoiceError('einvoice_rejected', { status: 502, details: { provider: 'x' } });
  assert.equal(e.code, 'einvoice_rejected');
  assert.equal(e.status, 502);
  assert.equal(e.name, 'EInvoiceError');
});
