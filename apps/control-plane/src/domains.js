'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { fail } = require('@hitechpos/payment-core');

/*
 * Custom domains (plan feature 'custom-domain').
 *
 *   1. the owner adds pos.example.vn -> a verification token is issued;
 *   2. they publish TXT _hitechpos.pos.example.vn = "hitechpos-verify=<token>"
 *      and a CNAME pos.example.vn -> <subdomain>.<base domain>;
 *   3. verify() reads the TXT record; once it matches, the domain joins
 *      tenant.hosts, which the shard serves (upstream shop-hosts.js), and
 *      Caddy's on-demand TLS may issue a certificate for it (allowed()).
 *
 * The TXT check is what stops anyone pointing a hostname at us and
 * claiming another shop's address or getting certificates issued.
 */
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function createDomainService({ store, config, resolveTxt = (name) => dns.resolveTxt(name), now = () => new Date() }) {
  const baseDomains = config.shopBaseDomains;

  function normalize(value) {
    const d = String(value || '').trim().toLowerCase().replace(/\.$/, '');
    if (!DOMAIN.test(d)) fail('domain_invalid', 422);
    if (baseDomains.some((b) => d === b || d.endsWith(`.${b}`))) fail('domain_reserved', 422);
    return d;
  }

  async function tenantWithFeature(tenantId) {
    const tenant = await store.tenants.findById(tenantId);
    if (!tenant) fail('tenant_not_found', 404);
    if (!(tenant.plan && tenant.plan.features || []).includes('custom-domain')) fail('plan_feature_missing', 402);
    return tenant;
  }

  function describe(tenant) {
    const target = `${tenant.subdomain}.${baseDomains[0]}`;
    return (tenant.customDomains || []).map((d) => ({
      domain: d.domain, verified: !!d.verifiedAt, verifiedAt: d.verifiedAt || null, addedAt: d.addedAt,
      dns: [
        { type: 'TXT', name: `_hitechpos.${d.domain}`, value: `hitechpos-verify=${d.token}` },
        { type: 'CNAME', name: d.domain, value: target },
      ],
    }));
  }

  async function list(tenantId) {
    const tenant = await store.tenants.findById(tenantId);
    if (!tenant) fail('tenant_not_found', 404);
    return describe(tenant);
  }

  async function add(tenantId, value) {
    const tenant = await tenantWithFeature(tenantId);
    const domain = normalize(value);
    const owner = await store.tenants.findOne({ hosts: domain });
    if (owner && String(owner._id) !== String(tenant._id)) fail('domain_taken', 409);
    const existing = tenant.customDomains || [];
    if (existing.some((d) => d.domain === domain)) return describe(tenant);
    if (existing.length >= 5) fail('domain_limit', 422);
    const entry = { domain, token: crypto.randomBytes(16).toString('hex'), addedAt: now().toISOString(), verifiedAt: null };
    return describe(await store.tenants.update(tenant._id, { customDomains: [...existing, entry] }));
  }

  async function verify(tenantId, value) {
    const tenant = await tenantWithFeature(tenantId);
    const domain = normalize(value);
    const entry = (tenant.customDomains || []).find((d) => d.domain === domain);
    if (!entry) fail('domain_not_found', 404);
    let records = [];
    try {
      records = (await resolveTxt(`_hitechpos.${domain}`)).map((chunks) => chunks.join(''));
    } catch {
      records = [];
    }
    if (!records.includes(`hitechpos-verify=${entry.token}`)) fail('domain_unverified', 422);
    const other = await store.tenants.findOne({ hosts: domain });
    if (other && String(other._id) !== String(tenant._id)) fail('domain_taken', 409);
    const customDomains = tenant.customDomains.map((d) => (d.domain === domain ? { ...d, verifiedAt: now().toISOString() } : d));
    const hosts = [...new Set([...(tenant.hosts || []), domain])];
    return describe(await store.tenants.update(tenant._id, { customDomains, hosts }));
  }

  async function remove(tenantId, value) {
    const tenant = await store.tenants.findById(tenantId);
    if (!tenant) fail('tenant_not_found', 404);
    const domain = String(value || '').trim().toLowerCase();
    return describe(await store.tenants.update(tenant._id, {
      customDomains: (tenant.customDomains || []).filter((d) => d.domain !== domain),
      hosts: (tenant.hosts || []).filter((h) => h !== domain),
    }));
  }

  /* Caddy on_demand_tls "ask": a certificate only for shop subdomains and
     verified custom domains of shops that are not suspended. */
  async function allowed(value) {
    const domain = String(value || '').trim().toLowerCase();
    for (const base of baseDomains) {
      if (domain.endsWith(`.${base}`)) {
        const sub = domain.slice(0, -(base.length + 1));
        const t = await store.tenants.findOne({ subdomain: sub });
        return !!t && !t.suspended;
      }
    }
    const t = await store.tenants.findOne({ hosts: domain });
    return !!t && !t.suspended;
  }

  return { list, add, verify, remove, allowed };
}

module.exports = { createDomainService };
