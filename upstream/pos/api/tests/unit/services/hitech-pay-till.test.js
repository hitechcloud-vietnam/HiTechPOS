'use strict';
/*
 * HiTechPOS till fixes around the VietQR tile:
 *  - after a QR sale is saved the screen calls qrSalePayementUpdate, which
 *    had no implementation and answered 500 (an error toast after every
 *    successful QR sale). It now links the htp_ payment to the sale.
 *  - a QR tapped before the shard has loaded the shop's new HITECH_POS_KEY
 *    shows a Vietnamese "try again shortly", not the internal error.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const tenantContext = require('../../../src/db/tenant-context');
const hitechPay = require('../../../src/services/hitech-pay');
const salesService = require('../../../src/services/sale.service');
const BaseModel = require('../../../src/models/base.model');
const { runWithRequestContext } = require('../../../src/utils/request-context');

let server, db;
const license = new ObjectId();
const branch = new ObjectId();
const saleId = new ObjectId();

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('hitech-pay-till'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  await db.collection('sales').insertMany([
    { _id: saleId, license, branch_id: branch, sales_id: 'SID-1', payment_mode: 'Qrpay' },
    { _id: new ObjectId(), license: new ObjectId(), branch_id: branch, sales_id: 'SID-OTHER' },
  ]);
  jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
});
afterEach(() => jest.restoreAllMocks());

const link = (id, sale) =>
  runWithRequestContext({ license, currentBranch: branch }, () =>
    salesService.qrSalePayementUpdateModel(id, sale)
  );

test('the paid QR is linked to the sale and the till gets a success', async () => {
  expect(await link('htp_123456', String(saleId))).toMatchObject({
    status: true,
    data: { sale_id: String(saleId) },
  });
  expect((await db.collection('sales').findOne({ _id: saleId })).hitech_payment_id).toBe(
    'htp_123456'
  );
  // A bill number from an older screen works too.
  expect((await link('htp_777', 'SID-1')).status).toBe(true);
});

test("another shop's sale, a bad id or a non-HiTechPOS QR is not linked", async () => {
  expect((await link('htp_1', 'SID-OTHER')).status).toBe(false);
  expect((await link('htp_1', { $ne: null })).status).toBe(false);
  expect((await link('rzp_1', String(saleId))).status).toBe(false);
  expect((await db.collection('sales').findOne({ _id: saleId })).hitech_payment_id).toBeUndefined();
});

test('a shop whose key has not reached the shard yet is told to retry, in Vietnamese', async () => {
  process.env.HITECH_PAY_URL = 'http://127.0.0.1:9';
  tenantContext.enableMultiTenant();
  try {
    await expect(
      tenantContext.runWithTenant({ db, secrets: {} }, () => hitechPay.generate(85000))
    ).rejects.toThrow('Cửa hàng vừa bật thanh toán QR, vui lòng thử lại sau ít phút.');
  } finally {
    tenantContext.enableMultiTenant(false);
    delete process.env.HITECH_PAY_URL;
  }
});
