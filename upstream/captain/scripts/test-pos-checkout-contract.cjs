'use strict';
// Run against a disposable mongod, never a shop database:
// POS_API_ROOT=<pos checkout>/api node scripts/test-pos-checkout-contract.cjs <browser payload.json>
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
if (!process.env.POS_API_ROOT || !process.argv[2]) throw new Error('POS_API_ROOT and browser payload file are required');
process.env.NODE_ENV = 'test';
const api = createRequire(path.resolve(process.env.POS_API_ROOT, 'package.json'));
const { MongoMemoryServer } = api('mongodb-memory-server');
const mongoose = api('mongoose');
const {ObjectId} = api('mongodb');
(async () => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('captain_checkout_contract');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const db = mongoose.connection.db;
    const Base = api('./src/models/base.model');
    Base.getDb = async () => db;
    const repo = api('./src/repositories/sale.repository');
    const pricing = api('./src/services/pricing-authority');
    const source = fs.readFileSync(path.join(__dirname, '../indexedDB.js'),'utf8');
    const context = require('node:vm').createContext({});
    require('node:vm').runInContext(source.slice(source.indexOf('function askedOn('),source.indexOf('async function updateCart()')),context);
    for (const [product,line,extras,expected] of [
      [{selling_price:100},{selling_price:100,modifiers:[{price_delta:20}]},20,120],
      [{selling_price:0,open_price:true},{askedPrice:850,modifiers:[{price_delta:20}]},20,870],
      [{selling_price:60,item_status:'instant'},{instant:true,price:60,subtotal:0},0,60],
    ]) {
      const resolved = pricing.resolve({product:{_id:new ObjectId(),tax:5,tax_type:'exclusive',...product},submitted:context.submittedUnitPrice(line),extras});
      assert.equal(resolved.selling_price,expected,'Client and server must add modifiers exactly once');
    }
    const tables = api('./src/services/captain-tables');
    const branch = new ObjectId(), license = new ObjectId(), table = new ObjectId(), user = new ObjectId();
    Base.license = license;
    Base.currentBranch = branch;
    Base.loggedUser = String(user);
    let sequence = 0;
    repo.generateSalesIdForBranch = async () => `CONTRACT-${++sequence}`;
    await db.collection('branches').insertOne({_id:branch,license,branch_name:'Disposable QA',table_options:true,table_order_limit:1,online_ordering:{store_id:'QA',mode:'order'}});
    await db.collection('tableorder').insertOne({_id:table,license,branch_id:branch,tableorder_value:'4'});
    const products = [
      ['mutton',400,5,'exclusive',0], ['paratha',45,5,'exclusive',0],
      ['water',30,5,'inclusive',0], ['discounted',100,5,'exclusive',10],
    ].map(([alias,selling_price,tax,tax_type,discount_amount]) => ({_id:new ObjectId(),alias,branch_id:branch,license,name:alias,selling_price,tax,tax_type,discount_amount}));
    await db.collection('items').insertMany(products);
    const captured = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    const body = {...captured,branch:String(branch),kiosk_table_no:'4',kiosk_table_id:String(table),dine_type:'Dine-in',items:captured.items.map(line => ({...line,item_id:String(products.find(p=>p.alias===line.item_id)._id)}))};
    const wrong = structuredClone(body);
    wrong.items.find(i=>i.item_name==='Kashmiri Mutton Rogan Josh').item_price = 420;
    const rejected = await repo.createOnlineOrder(wrong,{staffOrder:true});
    assert.equal(rejected.status,false);
    assert.match(rejected.message,/price changed/);
    assert.equal(await db.collection('sales').countDocuments(),0);
    const accepted = await repo.createOnlineOrder(body,{staffOrder:true});
    assert.equal(accepted.status,true,accepted.message);
    const order = await db.collection('sales').findOne({idempotency_key:body.idempotencyKey});
    assert.equal(order.sale_process,'KOT');
    assert.equal(order.table_number,'4');
    assert.equal(order.sales_total,639);
    const mutton = order.items.find(i=>i.name==='mutton');
    assert.equal(mutton.unit_price,400);
    assert.equal(mutton.total,420);
    assert.equal(order.items.find(i=>i.name==='paratha').total,94.5);
    assert.equal(order.items.find(i=>i.name==='water').total,30);
    const floor = await tables.list({db,user:{_id:user,usertype:'owner'},tenantContext:{branchId:branch,licenseId:license}});
    assert.equal(floor.tables[0].status,'occupied');
    assert.equal(floor.tables[0].orders.length,1);
    const kitchen = await repo.multiKitchenPrintModel(String(branch),{tillId:'qa-only'});
    assert.ok(kitchen.data.some(row=>String(row._id)===String(order._id)), 'Accepted order must reach the kitchen queue');
    await repo.createOnlineOrder(body,{staffOrder:true});
    assert.equal(await db.collection('sales').countDocuments(),1,'Retry must not duplicate');
    console.log(JSON.stringify({passed:true,total:order.sales_total,table:floor.tables[0].status,kitchenOrders:kitchen.data.length,duplicateCount:0}));
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
