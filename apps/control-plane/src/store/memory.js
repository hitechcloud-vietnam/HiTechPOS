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
      async list(query = {}, { limit = 0 } = {}) {
        const rows = [...tenants.values()].filter((t) => matches(t, query)).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        return (limit > 0 ? rows.slice(0, limit) : rows).map(clone);
      },
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
      async findOne(query) { return clone([...accounts.values()].find((a) => matches(a, query)) || null); },
      async update(id, patch) {
        const row = accounts.get(String(id));
        if (!row) return null;
        Object.assign(row, clone(patch));
        return clone(row);
      },
      async remove(id) { return accounts.delete(String(id)); },
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
    /* HiTechPOS Cloud sign-in requests of the owner app (business-cloud.js),
       keyed by sha256 of the opaque request. Conditional update: `expected`
       fields must still match, which is what makes every step single use.
       Expiry is always checked by the caller; rows that expired before a new
       one was created are dropped (the caller's clock, like Mongo's TTL). */
    businessRequests: (() => {
      const rows = new Map();
      return {
        async insert(doc) {
          for (const [k, r] of rows) if (r.expiresAt < doc.createdAt) rows.delete(k);
          if (rows.has(doc._id)) {
            const e = new Error('duplicate');
            e.code = 'duplicate';
            throw e;
          }
          rows.set(doc._id, clone(doc));
          return clone(doc);
        },
        async findById(id) { return clone(rows.get(String(id)) || null); },
        async update(id, expected, patch) {
          const row = rows.get(String(id));
          if (!row || !matches(row, expected)) return null;
          Object.assign(row, clone(patch));
          return clone(row);
        },
      };
    })(),
    /* Operator console (admin-console.js): audit log of admin actions, plus
       uncapped reads of tenants and owner contacts for search and revenue. */
    adminConsole: (() => {
      const audit = [];
      let auditSeq = 0;
      return {
        async insertAudit(entry) {
          const row = { ...clone(entry), _id: `au${++auditSeq}` };
          audit.push(row);
          return clone(row);
        },
        /* Newest first; equality filter. Returns { total, items }. */
        async listAudit(query = {}, { skip = 0, limit = 50 } = {}) {
          const rows = audit.filter((r) => matches(r, query)).reverse();
          return { total: rows.length, items: rows.slice(skip, skip + limit).map(clone) };
        },
        async listTenants() {
          return [...tenants.values()].map(({ secrets, ...t }) => clone(t)).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        },
        async listAccounts() {
          return [...accounts.values()].map((a) => ({ _id: a._id, email: a.email, name: a.name, phone: a.phone }));
        },
      };
    })(),
    /* Partner / referral program (partners.js): partners (unique code and
       email), one attribution per tenant, and the commission ledger keyed
       "C<orderCode>"/"R<orderCode>" with a status-guarded update. */
    ...(() => {
      const partners = new Map();
      const attributions = new Map();
      const commissions = new Map();
      const duplicate = (field) => Object.assign(new Error('duplicate'), { code: 'duplicate', field });
      const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
      const clash = (doc, selfId) => {
        for (const p of partners.values()) {
          if (p._id === selfId) continue;
          if (doc.code !== undefined && p.code === doc.code) return duplicate('code');
          if (doc.email !== undefined && p.email === doc.email) return duplicate('email');
        }
        return null;
      };
      return {
        partners: {
          async insert(doc) {
            const e = clash(doc);
            if (e) throw e;
            const row = { ...clone(doc), _id: `p${++seq}` };
            partners.set(row._id, row);
            return clone(row);
          },
          async findById(id) { return clone(partners.get(String(id)) || null); },
          async findOne(query) { return clone([...partners.values()].find((p) => matches(p, query)) || null); },
          async update(id, patch) {
            const row = partners.get(String(id));
            if (!row) return null;
            const e = clash(patch, row._id);
            if (e) throw e;
            Object.assign(row, clone(patch));
            return clone(row);
          },
          async list(query = {}) { return [...partners.values()].filter((p) => matches(p, query)).sort(byCreated).reverse().map(clone); },
        },
        partnerAttributions: {
          async insert(doc) {
            if (attributions.has(doc.tenantId)) throw duplicate('tenantId');
            attributions.set(doc.tenantId, clone(doc));
            return clone(doc);
          },
          async findByTenant(tenantId) { return clone(attributions.get(String(tenantId)) || null); },
          async list(query = {}) { return [...attributions.values()].filter((a) => matches(a, query)).map(clone); },
        },
        partnerCommissions: {
          async insert(doc) {
            if (commissions.has(doc.key)) throw duplicate('key');
            commissions.set(doc.key, clone(doc));
            return clone(doc);
          },
          async get(key) { return clone(commissions.get(String(key)) || null); },
          async update(key, patch, expectedStatus) {
            const row = commissions.get(String(key));
            if (!row || row.status !== expectedStatus) return null;
            Object.assign(row, clone(patch));
            return clone(row);
          },
          /* oldest first */
          async list(query = {}) { return [...commissions.values()].filter((c) => matches(c, query)).sort(byCreated).map(clone); },
        },
      };
    })(),
    async close() {},
  };
}

module.exports = { createMemoryStore };
