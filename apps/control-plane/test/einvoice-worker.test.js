'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInvoice } = require('@hitechpos/einvoice-vn');
const { createMemoryStore } = require('../src/store/memory');
const { createEInvoiceService } = require('../src/einvoices');
const { createEInvoiceWorker, mapPosnicSale, saleSkipReason } = require('../src/einvoice-worker');
const FIXTURE = require('./fixtures/posnic-sales.json');

/* Real sale documents captured from a live shop (see fixture _comment). */
const byNo = (no) => structuredClone(FIXTURE.sales.find((s) => s.sales_id === no));
const UNPAID = 'S-OKHF-000002'; // payment_status Unpaid (unpaid toggle)
const TRANSFER_B2B = 'S-OKHF-000005'; // Chuyển khoản, buyer with MST, 10% bill discount, 8% + 10%
const MIXED = 'S-OKHF-000007'; // Cash + Chuyển khoản, 10% line discount
const HELD = 'S-OKHF-000008'; // sale_process Hold (stored as Paid!)
const KOT_OPEN = 'S-OKHF-000009'; // open table order, Unpaid
const RETURNED = 'S-OKHF-000003'; // cash sale with a partial return
const EXCLUSIVE = 'S-OKHF-000011'; // VAT-exclusive item, taxed charge, amount bill discount, Card
const ctx = (sale) => ({ taxes: FIXTURE.grouptax, units: FIXTURE.unit, customer: FIXTURE.customers.find((c) => c._id === sale.customer_id) || null });

const SELLER = { taxCode: '0100109106', name: 'Công ty TNHH Hoá Đơn', address: '1 Tràng Tiền, Hà Nội' };
const SALE_DAY = new Date('2026-10-14T09:00:00Z');
function invoiceOf(input) {
  return buildInvoice({ ...input, invoiceType: 'GTGT', series: '1C26MAA', fromCashRegister: true, seller: SELLER }, { now: () => SALE_DAY.getTime() });
}

/* A cash-only, unreturned variant of the returned sale (same lines as sold). */
function cashSale() {
  const s = byNo(UNPAID);
  return { ...s, _id: '6acf400bf83cf6af70be1aaa', sales_id: 'S-OKHF-000099', payment_status: 'Paid', payment_pending: 0, multi_payment: { Cash: 85800 } };
}

test('mapPosnicSale: mixed VAT, bill discount split per rate, buyer with tax code, transfer', () => {
  const sale = byNo(TRANSFER_B2B);
  const input = mapPosnicSale(sale, ctx(sale));
  assert.equal(input.refId, '6acf4041f83cf6af70be1455');
  assert.equal(input.paymentMethod, 'CK');
  assert.equal(input.pricesIncludeVat, true);
  assert.equal(input.issueDate, sale.date);
  assert.deepEqual(input.buyer, {
    name: 'Trần Thị Mua', companyName: 'Công ty TNHH Thử Nghiệm Hoá Đơn', taxCode: '0101248141',
    address: '12 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội', email: 'ketoan@thunghiem.vn', phone: '0987654321',
  });
  assert.deepEqual(input.lines, [
    { code: '3', name: 'Bạc xỉu', unit: 'Ly', quantity: 3, unitPrice: 32000, vatRate: 8 },
    { code: '9', name: 'Bia Sài Gòn lon', unit: 'cái', quantity: 2, unitPrice: 20000, vatRate: 10 },
    { kind: 'discount', name: 'Chiết khấu thương mại (thuế suất 8%)', amount: 9600, vatRate: 8 },
    { kind: 'discount', name: 'Chiết khấu thương mại (thuế suất 10%)', amount: 4000, vatRate: 10 },
  ]);
  const inv = invoiceOf(input);
  assert.equal(inv.totals.gross, sale.sales_total);
  assert.deepEqual(inv.totals.groups.map((g) => [g.vatRate, g.gross]), [[8, 86400], [10, 36000]]);
});

test('mapPosnicSale: line discount on an inclusive item, KCT by tax name, cash', () => {
  const sale = cashSale();
  const input = mapPosnicSale(sale, ctx(sale));
  assert.equal(input.paymentMethod, 'TM');
  assert.deepEqual(input.buyer, {});
  /* Posnic discounts the NET price of an inclusive item: 20000 - 2000 net -> 17800 gross. */
  assert.deepEqual(input.lines.find((l) => l.name === 'Bia Sài Gòn lon'), { code: '9', name: 'Bia Sài Gòn lon', unit: 'cái', quantity: 1, unitPrice: 20000, vatRate: 10, discount: 2200 });
  assert.equal(input.lines.find((l) => l.name === 'Rau má tươi').vatRate, 'KCT');
  const inv = invoiceOf(input);
  assert.equal(inv.totals.gross, 85800);
  assert.deepEqual(inv.totals.groups.map((g) => [g.vatRate, g.gross]), [[8, 54806], [10, 16820], ['KCT', 14174]]);
  /* 5000 bill discount split 3194 / 980 / 826 over 58000 / 17800 / 15000. */
  assert.equal(inv.totals.lineDiscount, 2200);
});

test('mapPosnicSale: mixed tender, percent line discount', () => {
  const sale = byNo(MIXED);
  const input = mapPosnicSale(sale, ctx(sale));
  assert.equal(input.paymentMethod, 'TM/CK');
  assert.deepEqual(input.lines[2], { code: '7', name: 'Topping trân châu trắng', unit: 'Phần', quantity: 2, unitPrice: 8000, vatRate: 8, discount: 1600 });
  assert.equal(invoiceOf(input).totals.gross, 114400);
});

test('mapPosnicSale: VAT-exclusive item, taxed charge, amount bill discount, card', () => {
  const sale = byNo(EXCLUSIVE);
  const input = mapPosnicSale(sale, ctx(sale));
  assert.equal(input.paymentMethod, 'CK');
  assert.deepEqual(input.lines, [
    { code: '11', name: 'Bánh mì chả lụa', unit: 'Cái', quantity: 3, unitPrice: 33000, vatRate: 10, discount: 3300 },
    { code: '2', name: 'Cà phê đen đá', unit: 'Ly', quantity: 1, unitPrice: 25000, vatRate: 8 },
    { name: 'Phí giao hàng', unit: 'lần', quantity: 1, unitPrice: 10800, vatRate: 8 },
    { kind: 'discount', name: 'Chiết khấu thương mại (thuế suất 10%)', amount: 2643, vatRate: 10 },
    { kind: 'discount', name: 'Chiết khấu thương mại (thuế suất 8%)', amount: 690, vatRate: 8 },
  ]);
  assert.equal(invoiceOf(input).totals.gross, 128167);
});

test('mapPosnicSale: payment methods from multi_payment or payment_mode', () => {
  const base = cashSale();
  const pm = (patch) => mapPosnicSale({ ...base, ...patch }, ctx(base)).paymentMethod;
  assert.equal(pm({ multi_payment: { Cash: 85800 } }), 'TM');
  assert.equal(pm({ multi_payment: { 'Chuyển khoản': 85800 } }), 'CK');
  assert.equal(pm({ multi_payment: { 'Ví MoMo': 85800 } }), 'CK');
  assert.equal(pm({ multi_payment: { Cash: 40000, Card: 45800 } }), 'TM/CK');
  assert.equal(pm({ multi_payment: { Cash: 0, Card: 85800 } }), 'CK'); // zero tender ignored
  assert.equal(pm({ multi_payment: {}, payment_mode: 'Tiền mặt' }), 'TM');
  assert.equal(pm({ multi_payment: [], payment_mode: 'Cash, ZaloPay' }), 'TM/CK');
  assert.equal(pm({ multi_payment: [{ mode: 'ZaloPay', amount: 85800 }] }), 'CK');
});

test('mapPosnicSale: refuses what it cannot represent', () => {
  const s = cashSale();
  const code = (sale, c = ctx(s)) => { try { mapPosnicSale(sale, c); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(code({ ...s, customer_gst_number: '27AAAPA1234A1Z5' }), 'posnic_sale_unmappable'); // Indian GSTIN
  assert.equal(code({ ...s, sales_total: 70000 }), 'posnic_sale_unmappable'); // totals disagree
  const odd = structuredClone(s);
  odd.items[0].tax_fields = [{ tax_id: 'nope', tax_name: 'VAT 7%', tax_value: 7 }];
  odd.items[0].tax_name = 'VAT 7%';
  odd.items[0].tax = 7;
  assert.equal(code(odd), 'posnic_sale_unmappable');
  /* KCT is recognised by name even without the shop's tax list. */
  assert.equal(mapPosnicSale(s, { taxes: [] }).lines[2].vatRate, 'KCT');
  /* Contact details that would fail validation are dropped, not fatal. */
  const b2b = byNo(TRANSFER_B2B);
  assert.deepEqual(Object.keys(mapPosnicSale({ ...b2b, customer_phone: '123', customer_email: 'x' }, { taxes: FIXTURE.grouptax, customer: null }).buyer).sort(), ['address', 'name', 'taxCode']);
});

test('saleSkipReason: real held, unpaid, open KOT and returned sales are not invoiced', () => {
  assert.equal(saleSkipReason(byNo(UNPAID)), 'not_paid');
  assert.equal(saleSkipReason(byNo(HELD)), 'held');
  assert.equal(saleSkipReason(byNo(KOT_OPEN)), 'not_paid');
  assert.equal(saleSkipReason(byNo(RETURNED)), 'returned');
  assert.equal(saleSkipReason(byNo(MIXED)), null);
  assert.equal(saleSkipReason({ ...byNo(MIXED), payment_status: 'Partialy Paid' }), 'not_paid');
  assert.equal(saleSkipReason({ ...byNo(MIXED), order_state: 'pending' }), 'order_not_accepted');
  assert.equal(saleSkipReason({ ...byNo(MIXED), customer_cancelled_at: '2026-10-14T09:00:00Z' }), 'cancelled');
  assert.equal(saleSkipReason({ ...byNo(MIXED), payment_correction_pending: true }), 'payment_correction_pending');
  assert.equal(saleSkipReason({ ...byNo(MIXED), sales_total: 0 }), 'zero_total');
  assert.equal(saleSkipReason(byNo(MIXED), { since: '2026-10-14T08:45:00.000Z' }), 'before_auto_issue');
  /* A paid KOT order is final even if the kitchen is still working on it. */
  assert.equal(saleSkipReason({ ...byNo(KOT_OPEN), payment_status: 'Paid' }), null);
});

/* ---------------- worker ---------------- */

/* Minimal stand-in for a Mongo Db: equality, $gt and $or on the fields the
   worker queries, sort, limit, toArray, findOne. ObjectIds are hex strings,
   which order like ObjectIds. */
function fakeDb(collections) {
  const val = (v) => (v instanceof Date ? v.getTime() : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? Date.parse(v) : v === undefined || v === null ? v : String(v));
  const match = (doc, q) => Object.entries(q).every(([k, cond]) => {
    if (k === '$or') return cond.some((sub) => match(doc, sub));
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && '$gt' in cond) return val(doc[k]) > val(cond.$gt);
    return val(doc[k]) === val(cond);
  });
  const calls = { find: 0 };
  return {
    calls,
    collection(name) {
      const rows = () => collections[name] || [];
      return {
        find(q = {}) {
          calls.find += 1;
          let out = rows().filter((d) => match(d, q));
          const cur = {
            sort(spec) {
              const keys = Object.entries(spec);
              out = out.slice().sort((a, b) => {
                for (const [k, dir] of keys) { const x = val(a[k]); const y = val(b[k]); if (x !== y) return (x < y ? -1 : 1) * dir; }
                return 0;
              });
              return cur;
            },
            limit(n) { out = out.slice(0, n); return cur; },
            async toArray() { return structuredClone(out); },
          };
          return cur;
        },
        async findOne(q) { return structuredClone(rows().find((d) => match(d, q)) || null); },
      };
    },
  };
}

const ENABLED_AT = '2026-10-14T08:40:00.000Z';
const SERIES = '1C26MAA';

async function setup({ sales = FIXTURE.sales, clock = SALE_DAY, ...opts } = {}) {
  let t = clock.getTime();
  const now = () => new Date(t);
  const store = createMemoryStore();
  const config = { tenantSecretKey: Buffer.alloc(32, 7).toString('base64') };
  const einvoices = createEInvoiceService({ store, config, now, logger: { warn() {}, error() {} } });
  const tenant = await store.tenants.insert({ subdomain: 'hdcafe', tenantDb: 'hitech_t_hdcafe', provisioned: true, suspended: false, status: 'active' });
  await store.tenants.update(tenant._id, {
    einvoiceSettings: {
      provider: 'mock', environment: 'sandbox', connection: {}, seller: SELLER, invoiceType: 'GTGT', series: SERIES,
      fromCashRegister: true, autoIssue: true, updatedAt: ENABLED_AT,
    },
  });
  const data = { sales: structuredClone(sales), grouptax: FIXTURE.grouptax, unit: FIXTURE.unit, customers: FIXTURE.customers };
  const db = fakeDb(data);
  const logs = [];
  const worker = createEInvoiceWorker({ store, einvoices, tenantDb: () => db, now, logger: { warn: (m) => logs.push(m), error: (m) => logs.push(m) }, toObjectId: (x) => x, ...opts });
  const reload = () => store.tenants.findById(tenant._id);
  return { store, einvoices, worker, data, db, tenantId: tenant._id, reload, tick: (ms) => { t += ms; }, logs };
}

test('worker issues each final sale once, skips the rest, and advances the checkpoint', async () => {
  const { worker, store, tenantId, reload, data } = await setup();
  const [r] = await worker.runOnce();
  assert.equal(r.issued, 3, JSON.stringify(r));
  assert.deepEqual(r.skipped, { not_paid: 2, held: 1, returned: 1 });
  assert.equal(r.failed, 0);

  const rows = await store.einvoices.list({ tenantId: String(tenantId) });
  const totals = Object.fromEntries(rows.map((row) => [row.refId, row.result.total]));
  assert.deepEqual(totals, { '6acf4041f83cf6af70be1455': 122400, '6acf404bf83cf6af70be145a': 114400, '6acf410ff83cf6af70be146a': 128167 });

  const t = await reload();
  const last = data.sales[data.sales.length - 1];
  assert.deepEqual({ ...t.einvoiceCursor, updatedAt: undefined }, { since: ENABLED_AT, lastDate: last.updated_date, lastId: last._id, updatedAt: undefined });
  /* The return of an unissued sale is reported for a person to handle. */
  assert.deepEqual(t.einvoiceErrors.map((e) => [e.refId, e.code, e.final]), [['6acf402bf83cf6af70be144e', 'sale_returned_before_issue', true]]);

  /* Second run: nothing new after the checkpoint, nothing re-issued. */
  const [again] = await worker.runOnce();
  assert.equal(again.scanned, 0);
  assert.equal((await store.einvoices.list({ tenantId: String(tenantId) })).length, 3);
});

test('a sale settled later is picked up by its updated_date; edits never re-issue', async () => {
  const { worker, store, tenantId, data } = await setup();
  await worker.runOnce();
  const kot = data.sales.find((s) => s.sales_id === KOT_OPEN);
  Object.assign(kot, { payment_status: 'Paid', payment_mode: 'Cash', multi_payment: { Cash: 78000 }, updated_date: '2026-10-14T08:55:00.000Z' });
  const mixed = data.sales.find((s) => s.sales_id === MIXED);
  mixed.updated_date = '2026-10-14T08:56:00.000Z'; // e.g. receipt reprint stamp
  const [r] = await worker.runOnce();
  assert.equal(r.issued, 1);
  assert.equal(r.alreadyIssued, 1);
  const row = await store.einvoices.get(`${tenantId}:${kot._id}`);
  assert.equal(row.result.total, 78000);
  assert.equal((await store.einvoices.list({ tenantId: String(tenantId) })).length, 4);
});

test('never back-issues sales from before auto-issue was enabled', async () => {
  const { worker, store, tenantId } = await setup();
  await store.tenants.update(tenantId, { einvoiceSettings: { ...(await store.tenants.findById(tenantId)).einvoiceSettings, updatedAt: '2026-10-14T08:41:40.000Z' } });
  const [r] = await worker.runOnce();
  /* 000005 (08:41:37) is before; 000007 (08:41:47) and 000011 are after. */
  assert.equal(r.issued, 2);
  assert.equal(await store.einvoices.get(`${tenantId}:6acf4041f83cf6af70be1455`), null);
});

test('disabling auto-issue clears the checkpoint; suspended shops are left alone', async () => {
  const { worker, store, tenantId, reload } = await setup();
  await worker.runOnce();
  const s = (await reload()).einvoiceSettings;
  await store.tenants.update(tenantId, { einvoiceSettings: { ...s, autoIssue: false } });
  assert.deepEqual(await worker.runOnce(), []);
  assert.equal((await reload()).einvoiceCursor, null);
  await store.tenants.update(tenantId, { einvoiceSettings: { ...s, autoIssue: true }, suspended: true });
  assert.deepEqual(await worker.runOnce(), []);
});

test('a sale that cannot be mapped is recorded and does not stop the batch', async () => {
  const sales = structuredClone(FIXTURE.sales);
  sales.find((s) => s.sales_id === TRANSFER_B2B).customer_gst_number = '27AAAPA1234A1Z5';
  const { worker, store, tenantId, reload } = await setup({ sales });
  const [r] = await worker.runOnce();
  assert.equal(r.issued, 2);
  assert.equal(r.failed, 1);
  const t = await reload();
  const err = t.einvoiceErrors.find((e) => e.refId === '6acf4041f83cf6af70be1455');
  assert.equal(err.code, 'posnic_sale_unmappable');
  assert.equal(err.saleNo, TRANSFER_B2B);
  assert.equal(err.final, true);
  assert.match(err.message, /Mã số thuế người mua/);
  /* Definitive: the checkpoint went past it. */
  assert.equal(t.einvoiceCursor.lastId, sales[sales.length - 1]._id);
  assert.equal(await store.einvoices.get(`${tenantId}:6acf4041f83cf6af70be1455`), null);
});

test('a transient provider failure stops the checkpoint and is retried next run', async () => {
  const { worker, store, tenantId, reload, einvoices } = await setup();
  /* Reach the tenant's mock provider through the service cache. */
  const tenant = await reload();
  const original = einvoices.issue;
  let fails = 1;
  einvoices.issue = async (tn, sale) => {
    if (fails > 0) { fails -= 1; const { EInvoiceError } = require('@hitechpos/einvoice-vn'); throw new EInvoiceError('einvoice_unavailable', { status: 502, message: 'mạng lỗi' }); }
    return original(tn, sale);
  };
  const [r1] = await worker.runOnce();
  assert.equal(r1.stopped, 'einvoice_unavailable');
  assert.equal(r1.issued, 0);
  const t1 = await reload();
  /* Stopped before the first final sale (000005), after the skipped unpaid one before it. */
  assert.equal(t1.einvoiceCursor.lastId, '6acf400bf83cf6af70be144a');
  assert.equal(t1.einvoiceErrors[0].code, 'einvoice_unavailable');
  assert.equal(t1.einvoiceErrors[0].final, false);
  const [r2] = await worker.runOnce();
  assert.equal(r2.issued, 3);
  assert.deepEqual((await reload()).einvoiceErrors.map((e) => e.code), ['sale_returned_before_issue']);
  assert.equal((await store.einvoices.list({ tenantId: String(tenant._id) })).length, 3);
});

test('an unknown outcome is never re-sent until reconciled, and other sales still go out', async () => {
  const { worker, store, tenantId, reload, einvoices } = await setup();
  const original = einvoices.issue;
  const sent = [];
  einvoices.issue = async (tn, sale) => {
    sent.push(sale.refId);
    if (sale.refId === '6acf4041f83cf6af70be1455' && sent.filter((x) => x === sale.refId).length === 1) {
      /* Simulate a timeout after the provider committed: the guard keeps an 'unknown' row. */
      await store.einvoices.set(`${tenantId}:${sale.refId}`, { state: 'unknown', at: Date.now(), tenantId: String(tenantId), refId: sale.refId });
      const { EInvoiceError } = require('@hitechpos/einvoice-vn');
      throw new EInvoiceError('einvoice_outcome_unknown', { status: 502, message: 'hết thời gian chờ' });
    }
    return original(tn, sale);
  };
  const [r1] = await worker.runOnce();
  assert.equal(r1.stopped, 'einvoice_outcome_unknown');
  const [r2] = await worker.runOnce();
  assert.equal(r2.blocked, 1);
  assert.equal(r2.issued, 2);
  assert.deepEqual(sent.filter((x) => x === '6acf4041f83cf6af70be1455').length, 1, 'never re-sent');
  const t = await reload();
  assert.equal(t.einvoiceCursor.lastId, '6acf400bf83cf6af70be144a', 'checkpoint waits at the unknown sale');
  assert.ok(t.einvoiceErrors.some((e) => e.code === 'einvoice_outcome_unknown' && !e.final));

  /* The owner reconciles (provider says not found -> guard row dropped); the next run issues it. */
  await store.einvoices.delete(`${tenantId}:6acf4041f83cf6af70be1455`);
  const [r3] = await worker.runOnce();
  assert.equal(r3.issued, 1);
  assert.equal(r3.alreadyIssued, 2);
  const t3 = await reload();
  assert.equal(t3.einvoiceCursor.lastId, '6acf410ff83cf6af70be146a');
  assert.ok(!t3.einvoiceErrors.some((e) => e.code === 'einvoice_outcome_unknown'));
});

test('a provider rejection is retried a bounded number of times, then given up', async () => {
  const sales = FIXTURE.sales.filter((s) => s.sales_id === MIXED || s.sales_id === EXCLUSIVE);
  const { worker, reload, einvoices } = await setup({ sales });
  const original = einvoices.issue;
  einvoices.issue = async (tn, sale) => {
    if (sale.refId === '6acf404bf83cf6af70be145a') { const { EInvoiceError } = require('@hitechpos/einvoice-vn'); throw new EInvoiceError('einvoice_rejected', { status: 502, message: 'từ chối' }); }
    return original(tn, sale);
  };
  for (let i = 1; i <= 4; i += 1) {
    const [r] = await worker.runOnce();
    assert.equal(r.issued, 0, `run ${i}`);
    assert.equal((await reload()).einvoiceErrors[0].attempts, i);
  }
  const [r5] = await worker.runOnce();
  assert.equal(r5.issued, 1);
  const t = await reload();
  assert.equal(t.einvoiceErrors[0].final, true);
  assert.equal(t.einvoiceCursor.lastId, '6acf410ff83cf6af70be146a');
});

test('return after the invoice was issued asks for an adjustment invoice', async () => {
  const { worker, reload, data } = await setup();
  await worker.runOnce();
  const mixed = data.sales.find((s) => s.sales_id === MIXED);
  Object.assign(mixed, { sale_process: 'PartialReturn', items_return: [{ returnArray: {} }], updated_date: '2026-10-14T09:10:00.000Z' });
  const [r] = await worker.runOnce();
  assert.deepEqual(r.skipped, { returned: 1 });
  const e = (await reload()).einvoiceErrors.find((x) => x.refId === mixed._id);
  assert.equal(e.code, 'einvoice_adjustment_needed');
});

test('batch size bounds issue attempts per run; error list is capped at 50', async () => {
  const base = FIXTURE.sales.find((s) => s.sales_id === MIXED);
  const sales = Array.from({ length: 60 }, (_, i) => ({
    ...structuredClone(base),
    _id: `6acf5000f83cf6af70be${String(i).padStart(4, '0')}`,
    sales_id: `S-X-${i}`,
    updated_date: new Date(Date.parse('2026-10-14T08:50:00Z') + i * 1000).toISOString(),
    customer_gst_number: i < 55 ? 'bad' : '',
  }));
  const { worker, reload } = await setup({ sales, batchSize: 3 });
  const [r] = await worker.runOnce();
  /* mapping failures do not count as issue attempts */
  assert.equal(r.failed, 55);
  assert.equal(r.issued, 3);
  assert.equal(r.stopped, 'batch_limit');
  const t = await reload();
  assert.equal(t.einvoiceErrors.length, 50);
  assert.equal(t.einvoiceErrors[49].refId, sales[54]._id);
  assert.equal(t.einvoiceCursor.lastId, sales[57]._id);
  const [r2] = await worker.runOnce();
  assert.equal(r2.issued, 2);
});
