'use strict';

const { MongoClient, ObjectId } = require('mongodb');
const { fail } = require('@hitechpos/payment-core');

/*
 * Control database. `tenants` is the collection upstream/pos/api/shard.js
 * reads ({ provisioned, subdomain, tenantDb, secrets, suspended, hosts,
 * webDomain, instance }); every other field on a tenant document is ours and
 * ignored by the shard.
 */
async function createMongoStore({ uri, dbName }) {
  const client = new MongoClient(uri, { maxPoolSize: 10 });
  await client.connect();
  const db = client.db(dbName);
  const tenants = db.collection('tenants');
  const accounts = db.collection('accounts');
  const payments = db.collection('payments');
  await Promise.all([
    tenants.createIndex({ subdomain: 1 }, { unique: true }),
    tenants.createIndex({ hosts: 1 }),
    tenants.createIndex({ apiKeyHashes: 1 }),
    accounts.createIndex({ email: 1 }, { unique: true }),
    payments.createIndex({ orderCode: 1 }, { unique: true }),
    payments.createIndex({ reference: 1, createdAt: -1 }),
    payments.createIndex({ reference: 1, 'metadata.saleRef': 1 }),
  ]);

  const id = (v) => (v instanceof ObjectId ? v : ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null);
  const out = (doc) => (doc ? { ...doc, _id: String(doc._id) } : null);
  const dup = (e) => {
    if (e && e.code === 11000) {
      const err = new Error('duplicate');
      err.code = 'duplicate';
      throw err;
    }
    throw e;
  };

  return {
    kind: 'mongo',
    tenants: {
      async insert(doc) {
        const res = await tenants.insertOne({ ...doc }).catch(dup);
        return out({ ...doc, _id: res.insertedId });
      },
      findById: async (v) => (id(v) ? out(await tenants.findOne({ _id: id(v) })) : null),
      findOne: async (query) => out(await tenants.findOne(query)),
      update: async (v, patch) => out(await tenants.findOneAndUpdate({ _id: id(v) }, { $set: patch }, { returnDocument: 'after' })),
      list: async (query = {}) => (await tenants.find(query).sort({ createdAt: -1 }).limit(500).toArray()).map(out),
    },
    accounts: {
      async insert(doc) {
        const res = await accounts.insertOne({ ...doc }).catch(dup);
        return out({ ...doc, _id: res.insertedId });
      },
      findByEmail: async (email) => out(await accounts.findOne({ email })),
      findById: async (v) => (id(v) ? out(await accounts.findOne({ _id: id(v) })) : null),
    },
    /* Payment journal store contract from @hitechpos/payment-core. The status
       guard on update is what makes concurrent callbacks safe. */
    payments: {
      async insert(doc) {
        await payments.insertOne({ ...doc }).catch((e) => (e && e.code === 11000 ? fail('payment_duplicate_order_code', 409) : Promise.reject(e)));
        return { ...doc };
      },
      findByOrderCode: async (orderCode) => {
        const doc = await payments.findOne({ orderCode: Number(orderCode) }, { projection: { _id: 0 } });
        return doc || null;
      },
      update: async (orderCode, patch, expectedStatus) =>
        payments.findOneAndUpdate({ orderCode: Number(orderCode), status: expectedStatus }, { $set: patch }, { returnDocument: 'after', projection: { _id: 0 } }),
      list: async (query = {}) => payments.find(query, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray(),
    },
    close: () => client.close(),
  };
}

module.exports = { createMongoStore };
