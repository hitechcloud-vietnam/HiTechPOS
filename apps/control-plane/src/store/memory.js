'use strict';

const { createMemoryStore: createPaymentStore } = require('@hitechpos/payment-core');

/*
 * In-memory repositories with the same contract as store/mongo.js. Used by
 * tests and `npm run dev`; never in production, because a restart forgets
 * every shop.
 */
function createMemoryStore() {
  const tenants = new Map();
  const accounts = new Map();
  let seq = 0;
  const clone = (v) => (v == null ? v : structuredClone(v));
  /* Equality, or membership when the stored field is an array (Mongo semantics). */
  const matches = (doc, query) => Object.entries(query).every(([k, v]) => (Array.isArray(doc[k]) ? doc[k].includes(v) : doc[k] === v));

  return {
    kind: 'memory',
    tenants: {
      async insert(doc) {
        for (const t of tenants.values()) {
          if (t.subdomain === doc.subdomain) {
            const e = new Error('subdomain taken');
            e.code = 'duplicate';
            throw e;
          }
        }
        const row = { ...clone(doc), _id: doc._id || `t${++seq}` };
        tenants.set(row._id, row);
        return clone(row);
      },
      async findById(id) { return clone(tenants.get(String(id)) || null); },
      async findOne(query) { return clone([...tenants.values()].find((t) => matches(t, query)) || null); },
      async update(id, patch) {
        const row = tenants.get(String(id));
        if (!row) return null;
        Object.assign(row, clone(patch));
        return clone(row);
      },
      async list(query = {}) { return [...tenants.values()].filter((t) => matches(t, query)).map(clone); },
    },
    accounts: {
      async insert(doc) {
        if ([...accounts.values()].some((a) => a.email === doc.email)) {
          const e = new Error('email taken');
          e.code = 'duplicate';
          throw e;
        }
        const row = { ...clone(doc), _id: `a${++seq}` };
        accounts.set(row._id, row);
        return clone(row);
      },
      async findByEmail(email) { return clone([...accounts.values()].find((a) => a.email === email) || null); },
      async findById(id) { return clone(accounts.get(String(id)) || null); },
    },
    payments: createPaymentStore(),
    /* E-invoice idempotency guard rows, keyed "<tenantId>:<refId>". */
    einvoices: (() => {
      const rows = new Map();
      return {
        async get(key) { return clone(rows.get(key) || null); },
        async set(key, value) { rows.set(key, clone(value)); },
        async delete(key) { rows.delete(key); },
        async list(query = {}) {
          return [...rows.values()].filter((r) => matches(r, query)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map(clone);
        },
      };
    })(),
    async close() {},
  };
}

module.exports = { createMemoryStore };
