'use strict';

const { MongoClient, ObjectId } = require('mongodb');
const { fail } = require('@hitechpos/payment-core');
const { eligibleOwner, authorizationRow, OWNER_TYPES } = require('../business-handoff');

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
  const einvoices = db.collection('einvoices');
  const businessRequests = db.collection('business_requests');
  await Promise.all([
    businessRequests.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    tenants.createIndex({ subdomain: 1 }, { unique: true }),
    tenants.createIndex({ hosts: 1 }),
    tenants.createIndex({ apiKeyHashes: 1 }),
    accounts.createIndex({ email: 1 }, { unique: true }),
    accounts.createIndex({ resetTokenHash: 1 }, { sparse: true }),
    payments.createIndex({ orderCode: 1 }, { unique: true }),
    payments.createIndex({ reference: 1, createdAt: -1 }),
    einvoices.createIndex({ tenantId: 1, updatedAt: -1 }),
    payments.createIndex({ reference: 1, 'metadata.saleRef': 1 }),
  ]);

  const businessIndexed = new Set();
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
      /* Every matching shop unless a limit is given: the periodic jobs
         (expiry, reminders, e-invoice worker) must see all of them. */
      list: async (query = {}, { limit = 0 } = {}) => (await tenants.find(query).sort({ createdAt: -1 }).limit(limit).toArray()).map(out),
    },
    accounts: {
      async insert(doc) {
        const res = await accounts.insertOne({ ...doc }).catch(dup);
        return out({ ...doc, _id: res.insertedId });
      },
      findByEmail: async (email) => out(await accounts.findOne({ email })),
      findById: async (v) => (id(v) ? out(await accounts.findOne({ _id: id(v) })) : null),
      findOne: async (query) => out(await accounts.findOne(query)),
      update: async (v, patch) => out(await accounts.findOneAndUpdate({ _id: id(v) }, { $set: patch }, { returnDocument: 'after' })),
      remove: async (v) => (id(v) ? (await accounts.deleteOne({ _id: id(v) })).deletedCount === 1 : false),
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
    /* E-invoice idempotency guard rows; _id is "<tenantId>:<refId>". The
       guard's 'pending' write must not overwrite another process's row, so
       the first pending insert relies on the unique _id. */
    einvoices: {
      get: async (key) => einvoices.findOne({ _id: key }, { projection: { _id: 0 } }),
      async set(key, value) {
        if (value.state === 'pending') {
          try {
            await einvoices.insertOne({ _id: key, ...value });
            return;
          } catch (e) {
            if (e && e.code === 11000) {
              const err = new Error('einvoice_issue_in_progress');
              err.code = 'einvoice_issue_in_progress';
              err.status = 409;
              throw err;
            }
            throw e;
          }
        }
        await einvoices.replaceOne({ _id: key }, { ...value }, { upsert: true });
      },
      delete: async (key) => { await einvoices.deleteOne({ _id: key }); },
      list: async (query = {}) => einvoices.find(query, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(200).toArray(),
    },
    /* HiTechPOS Cloud sign-in requests of the owner app (business-cloud.js);
       _id is sha256 hex of the opaque request, expiresAt a Date (TTL index).
       update() only applies while `expected` still matches. */
    businessRequests: {
      async insert(doc) {
        await businessRequests.insertOne({ ...doc }).catch(dup);
        return { ...doc };
      },
      findById: async (key) => businessRequests.findOne({ _id: String(key) }),
      update: async (key, expected, patch) =>
        businessRequests.findOneAndUpdate({ ...expected, _id: String(key) }, { $set: patch }, { returnDocument: 'after' }),
    },
    /*
     * The one place the control plane writes into a shop's own database:
     * the branch payment_gateway switch that shows the QR tile on the Posnic
     * sales screen (upstream/pos/api/src/services/hitech-pay.js). Razorpay
     * key/secret already stored on the branch are preserved.
     */
    shopBridge: {
      /*
       * Every collection of the shop's database as NDJSON lines
       * {"collection", "doc"} in canonical Extended JSON, so ObjectIds and
       * dates survive a re-import. Login secrets are stripped: they are no
       * use outside this installation and dangerous in a downloaded file.
       */
      async *exportShop(tenant) {
        const { EJSON } = require('mongodb').BSON;
        const db = client.db(tenant.tenantDb);
        const SECRET_KEYS = new Set(['password', 'passwordHash', 'apikey', 'userkey', 'api_key', 'token', 'jwt', 'secret', 'pin', 'pin_hash', 'reset_token']);
        const scrub = (v) => {
          if (Array.isArray(v)) return v.map(scrub);
          if (v && typeof v === 'object' && v.constructor === Object) {
            const out = {};
            for (const [k, val] of Object.entries(v)) if (!SECRET_KEYS.has(k)) out[k] = scrub(val);
            return out;
          }
          return v;
        };
        const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.') && n !== 'sessions').sort();
        yield { type: 'meta', shop: tenant.subdomain, exportedAt: new Date().toISOString(), collections: names };
        for (const name of names) {
          for await (const doc of db.collection(name).find({})) {
            yield { type: 'doc', collection: name, doc: EJSON.serialize(scrub(doc), { relaxed: false }) };
          }
        }
      },
      /* Plan limits read by Posnic (upstream/pos/api/src/helpers/limits.js):
         branches, users, products; null means unlimited and is left out. */
      async setLimits(tenant, limits) {
        const doc = { _id: 'limits', updated_at: new Date() };
        for (const k of ['branches', 'users', 'products']) if (Number.isInteger(limits[k]) && limits[k] > 0) doc[k] = limits[k];
        await client.db(tenant.tenantDb).collection('app_limits').replaceOne({ _id: 'limits' }, doc, { upsert: true });
      },
      async setQrGateway(tenant, { enabled, method }) {
        const branches = client.db(tenant.tenantDb).collection('branches');
        for (const b of await branches.find({}, { projection: { payment_gateway: 1 } }).toArray()) {
          const current = b.payment_gateway && !Array.isArray(b.payment_gateway) ? b.payment_gateway : {};
          await branches.updateOne({ _id: b._id }, { $set: { payment_gateway: { ...current, status: enabled ? 'true' : 'false', provider: 'hitechpos', method: method || null } } });
        }
      },
      /*
       * Owner app hand-over (business-cloud.js, business-handoff.js). The
       * control-plane owner maps to the shop's owner-level user: the one
       * pinned earlier (userId) while it is still eligible, else the oldest
       * owner-level user with the account's email.
       */
      async businessOwner(tenant, { email, userId, now = new Date() }) {
        const users = client.db(tenant.tenantDb).collection('users');
        const nowMs = now.getTime();
        const pinned = userId && ObjectId.isValid(String(userId)) ? await users.findOne({ _id: new ObjectId(String(userId)) }) : null;
        if (pinned && eligibleOwner(pinned, nowMs)) return { userId: String(pinned._id) };
        if (typeof email !== 'string' || !email) return null;
        const candidates = await users.find({ email, usertype: { $in: OWNER_TYPES } }).sort({ _id: 1 }).limit(5).toArray();
        const user = candidates.find((u) => eligibleOwner(u, nowMs));
        return user ? { userId: String(user._id) } : null;
      },
      /* Writes the approved business_authorizations row the shard's
         exchange() accepts. False when the user is no longer eligible. */
      async insertBusinessAuthorization(tenant, { userId, ...fields }) {
        const shopDb = client.db(tenant.tenantDb);
        if (!ObjectId.isValid(String(userId))) return false;
        const user = await shopDb.collection('users').findOne({ _id: new ObjectId(String(userId)) });
        if (!eligibleOwner(user, fields.now.getTime())) return false;
        const rows = shopDb.collection('business_authorizations');
        /* Same TTL index the shard creates (identical spec, so a no-op when
           it exists); the shard checks expiresAt itself either way. */
        if (!businessIndexed.has(tenant.tenantDb)) {
          await rows.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).then(() => businessIndexed.add(tenant.tenantDb), () => {});
        }
        await rows.insertOne(authorizationRow(user, fields));
        return true;
      },
    },
    /* Operator console (admin-console.js): `admin_audit` log of admin
       actions, plus uncapped reads for search and revenue (tenants without
       sealed secrets, owner contacts, paid subscription payments). */
    adminConsole: (() => {
      const audit = db.collection('admin_audit');
      let indexed = null;
      const ensure = () => (indexed ||= Promise.all([
        audit.createIndex({ at: -1 }),
        audit.createIndex({ tenantId: 1, at: -1 }),
        audit.createIndex({ action: 1, at: -1 }),
      ]).catch(() => { indexed = null; }));
      return {
        async insertAudit(entry) {
          await ensure();
          const res = await audit.insertOne({ ...entry });
          return { ...entry, _id: String(res.insertedId) };
        },
        async listAudit(query = {}, { skip = 0, limit = 50 } = {}) {
          await ensure();
          const [total, items] = await Promise.all([
            audit.countDocuments(query),
            audit.find(query).sort({ at: -1, _id: -1 }).skip(skip).limit(limit).toArray(),
          ]);
          return { total, items: items.map(out) };
        },
        listTenants: async () => (await tenants.find({}, { projection: { secrets: 0, 'einvoiceSettings.connection': 0 } }).sort({ createdAt: -1 }).toArray()).map(out),
        listAccounts: async () => (await accounts.find({}, { projection: { email: 1, name: 1, phone: 1 } }).toArray()).map(out),
        listPaidSubscriptions: async () => payments.find({ purpose: 'subscription', status: 'paid' }, { projection: { _id: 0, events: 0 } }).toArray(),
      };
    })(),
    /* Partner / referral program (partners.js). Unique indexes carry the
       guarantees: one partner per code and per email, one attribution per
       tenant, one ledger entry per key ("C<orderCode>"/"R<orderCode>").
       They are created here and awaited before the first use. */
    ...(() => {
      const partners = db.collection('partners');
      const attributions = db.collection('partner_attributions');
      const commissions = db.collection('partner_commissions');
      const ready = Promise.all([
        partners.createIndex({ code: 1 }, { unique: true }),
        partners.createIndex({ email: 1 }, { unique: true }),
        attributions.createIndex({ tenantId: 1 }, { unique: true }),
        attributions.createIndex({ partnerId: 1, attributedAt: -1 }),
        commissions.createIndex({ key: 1 }, { unique: true }),
        commissions.createIndex({ orderCode: 1 }),
        commissions.createIndex({ partnerId: 1, createdAt: 1 }),
        commissions.createIndex({ tenantId: 1, createdAt: 1 }),
        commissions.createIndex({ status: 1, createdAt: 1 }),
      ]);
      ready.catch(() => {}); /* surfaced by the first call that awaits it */
      const dupField = (e) => {
        if (e && e.code === 11000) throw Object.assign(new Error('duplicate'), { code: 'duplicate', field: Object.keys(e.keyPattern || {})[0] || null });
        throw e;
      };
      const noId = { projection: { _id: 0 } };
      return {
        partners: {
          async insert(doc) {
            await ready;
            const res = await partners.insertOne({ ...doc }).catch(dupField);
            return out({ ...doc, _id: res.insertedId });
          },
          findById: async (v) => (id(v) ? out(await partners.findOne({ _id: id(v) })) : null),
          findOne: async (query) => out(await partners.findOne(query)),
          async update(v, patch) {
            await ready;
            return id(v) ? out(await partners.findOneAndUpdate({ _id: id(v) }, { $set: patch }, { returnDocument: 'after' }).catch(dupField)) : null;
          },
          list: async (query = {}) => (await partners.find(query).sort({ createdAt: -1 }).limit(2000).toArray()).map(out),
        },
        partnerAttributions: {
          async insert(doc) {
            await ready;
            await attributions.insertOne({ ...doc }).catch(dupField);
            return { ...doc };
          },
          findByTenant: async (tenantId) => attributions.findOne({ tenantId: String(tenantId) }, noId),
          list: async (query = {}) => attributions.find(query, noId).sort({ attributedAt: -1 }).limit(5000).toArray(),
        },
        partnerCommissions: {
          async insert(doc) {
            await ready;
            await commissions.insertOne({ ...doc }).catch(dupField);
            return { ...doc };
          },
          get: async (key) => commissions.findOne({ key: String(key) }, noId),
          update: async (key, patch, expectedStatus) =>
            commissions.findOneAndUpdate({ key: String(key), status: expectedStatus }, { $set: patch }, { returnDocument: 'after', ...noId }),
          /* oldest first */
          list: async (query = {}) => commissions.find(query, noId).sort({ createdAt: 1, key: 1 }).limit(5000).toArray(),
        },
      };
    })(),
    close: () => client.close(),
  };
}

module.exports = { createMongoStore };
