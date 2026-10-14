'use strict';
/*
 * Time billing for karaoke rooms / billiard tables, against a real mongod:
 * the clock starts on a table with no order, drinks are added the ordinary
 * way, "Tính giờ" turns the time into order lines priced by the table's
 * rates (with an evening band), and none of it reaches the kitchen printer.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const BaseModel = require('../../../src/models/base.model');
const repo = require('../../../src/repositories/sale.repository');
const service = require('../../../src/services/table-time-billing');
const tableDetails = require('../../../src/utils/table-details');
const { runWithRequestContext } = require('../../../src/utils/request-context');
jest.mock('../../../src/helpers/kot-notify', () => ({ notifyKotReady: jest.fn() }));
jest.mock('../../../src/helpers/order-attention', () => ({
  notifyOrderAttention: jest.fn(),
  notifyOrderResolved: jest.fn(),
}));

let server, db, branch, license, user, hour, beer, table, plainTable;
let number = 0;
const vn = (hhmm) => new Date(`2026-10-14T${hhmm}:00+07:00`);
const settings = {
  item_id: '',
  rate: 120000,
  block_minutes: 15,
  min_blocks: 1,
  bands: [{ start: '18:00', end: '24:00', rate: 150000, label: 'Buổi tối' }],
};

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('time-billing'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
beforeEach(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await db.dropDatabase();
  branch = new ObjectId();
  license = new ObjectId();
  user = { _id: new ObjectId(), name: 'Thu ngân', usertype: 'owner' };
  hour = new ObjectId();
  beer = new ObjectId();
  table = new ObjectId();
  plainTable = new ObjectId();
  jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  jest.spyOn(repo, 'generateSalesIdForBranch').mockImplementation(async () => `TB-${++number}`);
  await db.collection('branches').insertOne({
    _id: branch,
    license,
    name: 'Karaoke Hoa Mai',
    table_options: true,
    table_order_limit: 1,
    currency_code: 'VND',
    online_ordering: { store_id: 'KARAOKE1', mode: 'order' },
  });
  await db.collection('items').insertMany([
    {
      _id: hour,
      branch_id: branch,
      license,
      name: 'Giờ hát',
      selling_price: 0,
      open_price: true,
      tax: 0,
      tax_type: 'exclusive',
    },
    {
      _id: beer,
      branch_id: branch,
      license,
      name: 'Bia Sài Gòn',
      selling_price: 20000,
      tax: 0,
      tax_type: 'exclusive',
    },
  ]);
  await db.collection('tableorder').insertMany([
    {
      _id: table,
      branch_id: branch,
      license,
      tableorder_value: 'VIP1',
      tableorder_key: 'VIP1',
      time_billing: { ...settings, item_id: String(hour) },
    },
    { _id: plainTable, branch_id: branch, license, tableorder_value: 'B2', tableorder_key: 'B2' },
  ]);
});

const req = (body) => ({
  user,
  body,
  db,
  tenantContext: { branchId: branch, licenseId: license },
  headers: {},
  ip: '127.0.0.1',
  get: () => 'jest',
});
const at = (hhmm) =>
  jest.useFakeTimers({
    now: vn(hhmm),
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'hrtime',
      'performance',
    ],
  });
const call = (body) =>
  runWithRequestContext({ loggedUser: String(user._id), license, currentBranch: branch }, () =>
    service.handle(req(body))
  );
const inContext = (fn) =>
  runWithRequestContext({ loggedUser: String(user._id), license, currentBranch: branch }, fn);
const sale = (id) => db.collection('sales').findOne({ _id: new ObjectId(id) });
const kitchenLines = (s) => (s.changes || []).flatMap((c) => c.items || []);
const timeLines = (s) => s.items.filter((l) => l.time_billing_line === true);

test('start on an empty room opens an order with the minimum charge and no kitchen ticket', async () => {
  at('16:05');
  const { sale_id } = await call({
    action: 'start',
    table_id: String(table),
    request_id: 'req-start-0001',
    guests: 4,
  });
  const s = await sale(sale_id);
  expect(s).toMatchObject({ table_number: 'VIP1', sale_process: 'KOT', person_count: 4 });
  expect(s.time_billing).toMatchObject({
    version: 1,
    table_label: 'VIP1',
    item_name: 'Giờ hát',
    rate: 120000,
    ended_at: null,
  });
  expect(new Date(s.time_billing.started_at).toISOString()).toBe(vn('16:05').toISOString());
  expect(timeLines(s)).toEqual([
    expect.objectContaining({
      line_id: 'tb-base',
      item_name: 'Giờ hát VIP1 · 16:05-16:20 · 15 phút',
      item_quantity: 0.25,
    }),
  ]);
  expect(s.sales_total).toBe(30000);
  expect(kitchenLines(s)).toEqual([]);
  // A retried start is the same start.
  expect(
    await call({ action: 'start', table_id: String(table), request_id: 'req-start-0001' })
  ).toEqual({ sale_id });
  await expect(
    call({ action: 'start', table_id: String(table), request_id: 'req-start-0002' })
  ).rejects.toMatchObject({ status: 409 });
  expect(await db.collection('sales').countDocuments()).toBe(1);
});

test('Tính giờ prices the session by the evening band, alongside the drinks, and pays like any order', async () => {
  at('16:05');
  const { sale_id } = await call({
    action: 'start',
    table_id: String(table),
    request_id: 'req-start-0003',
  });
  // Drinks are added the ordinary way; the time line rides along unchanged.
  let s = await sale(sale_id);
  const added = await inContext(() =>
    repo.updateOrderModel(
      sale_id,
      [
        ...s.items.map(service.editLine),
        { product_id: String(beer), line_id: 'beer-1', quantity: 3, price: 20000 },
      ],
      0,
      'modified',
      'amount',
      0,
      '',
      null,
      null,
      null
    )
  );
  expect(added.status).toBe(true);
  s = await sale(sale_id);
  expect(kitchenLines(s).map((l) => [l.item_name, l.process])).toEqual([['Bia Sài Gòn', 'add']]);

  at('18:40');
  const stopped = await call({ action: 'stop', sale_id, lang: 'vi' });
  // 2 h 35 min -> 11 blocks = 2 h 45 min: 16:05-18:00 base (115 min), 18:00-18:50 evening (50 min)
  expect(stopped.amount).toBe(230000 + 125000);
  s = await sale(sale_id);
  expect(timeLines(s).map((l) => [l.line_id, l.item_name, l.item_quantity, l.total])).toEqual([
    ['tb-base', 'Giờ hát VIP1 · 16:05-18:00 · 1 giờ 55 phút', 115 / 60, 230000],
    ['tb-b0', 'Giờ hát VIP1 · 18:00-18:40 · 50 phút (Buổi tối)', 50 / 60, 125000],
  ]);
  expect(s.sales_total).toBe(355000 + 60000);
  expect(Number.isInteger(s.sales_total)).toBe(true);
  expect(new Date(s.time_billing.ended_at).toISOString()).toBe(vn('18:40').toISOString());
  // Still only the beer in the kitchen's records.
  expect(kitchenLines(s).map((l) => l.item_name)).toEqual(['Bia Sài Gòn']);

  // Stopping twice changes nothing; resume continues the same session.
  at('18:55');
  await call({ action: 'stop', sale_id });
  expect((await sale(sale_id)).sales_total).toBe(415000);
  await call({ action: 'resume', sale_id });
  expect((await sale(sale_id)).time_billing.ended_at).toBeNull();
  at('19:10');
  await call({ action: 'stop', sale_id });
  s = await sale(sale_id);
  // 3 h 05 min -> 13 blocks: base 115 min, evening 80 min = 230000 + 200000
  expect(timeLines(s).map((l) => l.total)).toEqual([230000, 200000]);
  expect(s.sales_total).toBe(430000 + 60000);
});

test('start on an order that already has drinks adds the time to it', async () => {
  at('20:00');
  const created = await runWithRequestContext(
    { loggedUser: String(user._id), license, currentBranch: branch },
    () =>
      repo.createOnlineOrder(
        {
          branch: String(branch),
          kiosk_table_no: 'VIP1',
          kiosk_table_id: String(table),
          person_count: 2,
          items: [{ item_id: String(beer), item_quantity: 1, item_price: 20000 }],
        },
        { staffOrder: true }
      )
  );
  expect(created.status).toBe(true);
  const { sale_id } = await call({ action: 'start', sale_id: created.data.sale_id });
  expect(sale_id).toBe(created.data.sale_id);
  const s = await sale(sale_id);
  expect(timeLines(s)).toEqual([expect.objectContaining({ line_id: 'tb-b0', total: 37500 })]);
  expect(s.sales_total).toBe(57500);
  expect(kitchenLines(s).map((l) => l.item_name)).toEqual(['Bia Sài Gòn']);
});

test('cancel removes a mistaken time charge but keeps the drinks', async () => {
  at('16:00');
  const { sale_id } = await call({ action: 'start', table_id: String(table) });
  await expect(call({ action: 'cancel', sale_id })).rejects.toThrow(/Cancel order/);
  let s = await sale(sale_id);
  await inContext(() =>
    repo.updateOrderModel(
      sale_id,
      [
        ...s.items.map(service.editLine),
        { product_id: String(beer), line_id: 'beer-1', quantity: 1, price: 20000 },
      ],
      0,
      'modified',
      'amount',
      0,
      '',
      null,
      null,
      null
    )
  );
  await call({ action: 'cancel', sale_id });
  s = await sale(sale_id);
  expect(s.items.map((l) => l.item_name)).toEqual(['Bia Sài Gòn']);
  expect(s.time_billing).toBeNull();
  expect(s.sales_total).toBe(20000);
  expect(kitchenLines(s).every((l) => !String(l.line_id || '').startsWith('tb-'))).toBe(true);
});

test('a fixed-price item still bills at the table rates, with its own tax', async () => {
  // As onboarding seeds it: "Giờ hát phòng VIP" at 300.000 đ, VAT 10 % included.
  await db
    .collection('items')
    .updateOne(
      { _id: hour },
      { $set: { open_price: false, selling_price: 300000, tax: 10, tax_type: 'inclusive' } }
    );
  at('17:30');
  const { sale_id } = await call({ action: 'start', table_id: String(table) });
  at('18:30');
  await call({ action: 'stop', sale_id });
  const s = await sale(sale_id);
  // 17:30-18:00 at 120.000/h, 18:00-18:30 at 150.000/h: 60.000 + 75.000, tax inside.
  expect(timeLines(s).map((l) => l.total)).toEqual([60000, 75000]);
  expect(s.sales_total).toBe(135000);
  expect(s.tax).toBeGreaterThan(0);
  // A client cannot use the same item at a made-up price on an ordinary edit.
  const forged = await inContext(() =>
    repo.updateOrderModel(
      sale_id,
      [
        ...s.items.map(service.editLine),
        { product_id: String(hour), line_id: 'tb-b9', quantity: 5, price: 1000 },
      ],
      0,
      'modified',
      'amount',
      0,
      '',
      null,
      null,
      null
    )
  );
  expect(forged).toMatchObject({ status: false, data: { state: 'item_price_mismatch' } });
});

test('refusals: no settings, unknown action, no permission', async () => {
  at('12:00');
  await expect(call({ action: 'start', table_id: String(plainTable) })).rejects.toThrow(
    /not set up/
  );
  await expect(call({ action: 'pause', table_id: String(table) })).rejects.toThrow(/Choose start/);
  user = { _id: new ObjectId(), usertype: 'cashier', access: { sales: { write: false } } };
  await expect(call({ action: 'start', table_id: String(table) })).rejects.toMatchObject({
    status: 403,
  });
  expect(await db.collection('sales').countDocuments()).toBe(0);
});

test('table settings: saved normalized, shown on the floor view, item must exist', async () => {
  expect(
    tableDetails.update({ time_billing: JSON.stringify({ ...settings, item_id: String(hour) }) })
  ).toEqual({
    time_billing: expect.objectContaining({ rate: 120000, block_minutes: 15, grace_minutes: 0 }),
  });
  expect(tableDetails.update({ time_billing: '' })).toEqual({ time_billing: null });
  expect(
    tableDetails.view({ time_billing: { ...settings, item_id: String(hour) } }).time_billing
  ).toMatchObject({ rate: 120000 });
  expect(tableDetails.view({})).not.toHaveProperty('time_billing');
  const items = db.collection('items');
  await expect(
    service.checkItem(items, license, { ...settings, item_id: String(hour) })
  ).resolves.toMatchObject({ rate: 120000 });
  await expect(
    service.checkItem(items, license, { ...settings, item_id: String(beer) })
  ).resolves.toMatchObject({ rate: 120000 });
  await expect(
    service.checkItem(items, license, { ...settings, item_id: 'b'.repeat(24) })
  ).rejects.toThrow(/Choose the item/);
  await expect(service.checkItem(items, license, '')).resolves.toBeNull();
});
