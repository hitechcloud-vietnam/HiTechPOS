'use strict';

const crypto = require('node:crypto');
const { fail } = require('@hitechpos/payment-core');
const presets = require('@hitechpos/industry-presets');
const { generateTenantSecrets, sealAll } = require('./secrets');
const { getPlan } = require('./plans');

const RESERVED = new Set([
  'www', 'api', 'app', 'admin', 'administrator', 'root', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets',
  'status', 'docs', 'help', 'support', 'billing', 'pay', 'payment', 'webhook', 'webhooks', 'dashboard',
  'console', 'portal', 'login', 'signup', 'register', 'auth', 'account', 'demo', 'test', 'staging', 'dev',
  'shard', 'control', 'hitech', 'hitechpos', 'hitechcloud', 'posnic',
]);

/* DNS label, lower case, 3-30 chars, no leading/trailing hyphen. It becomes
   both a hostname and part of a database name, so the alphabet is narrow. */
function normalizeSubdomain(value) {
  const sub = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(sub) || sub.includes('--')) return { ok: false, reason: 'invalid' };
  if (RESERVED.has(sub)) return { ok: false, reason: 'reserved' };
  return { ok: true, subdomain: sub };
}

function tenantDbName(subdomain, prefix = 'hitech_t_') {
  const name = `${prefix}${subdomain.replace(/-/g, '_')}`;
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(name)) fail('tenant_db_name_invalid', 422);
  return name;
}

/*
 * Signup -> a served shop.
 *
 *  1. write the tenant registry row the shard reads (sealed secrets, trial
 *     plan, status 'provisioning');
 *  2. ask the shard to run the Posnic installer inside that shop's scope
 *     (owner user, branch, taxes, optional industry demo data);
 *  3. mark it active - or 'install_failed' and suspended, so a half-built
 *     shop is never served to its owner.
 *
 * The installer is injected so tests (and a future queue worker) can replace
 * the HTTP call.
 */
function createTenantService({ store, config, installer, now = () => new Date() }) {
  async function availability(subdomain) {
    const n = normalizeSubdomain(subdomain);
    if (!n.ok) return { available: false, reason: n.reason };
    const taken = await store.tenants.findOne({ subdomain: n.subdomain });
    return { available: !taken, subdomain: n.subdomain, reason: taken ? 'taken' : undefined };
  }

  async function signup(input, { ownerAccountId }) {
    const n = normalizeSubdomain(input.subdomain);
    if (!n.ok) fail(`subdomain_${n.reason}`, 422);
    const industry = presets.getPreset(input.industry || 'khac');
    const businessName = String(input.businessName || '').trim();
    if (businessName.length < 2 || businessName.length > 120) fail('business_name_invalid', 422);

    const trial = getPlan('trial');
    const created = now();
    const trialEnds = new Date(created.getTime() + trial.trialDays * 86400000);
    const secrets = generateTenantSecrets();
    let tenant;
    try {
      tenant = await store.tenants.insert({
        subdomain: n.subdomain,
        tenantDb: tenantDbName(n.subdomain, config.tenantDbPrefix),
        hosts: [],
        instance: config.shardInstance || undefined,
        provisioned: true,
        suspended: false,
        status: 'provisioning',
        secrets: sealAll(secrets, config.tenantSecretKey),
        businessName,
        industry: industry.id,
        taxCode: input.taxCode || null,
        province: input.province || null,
        ownerAccountId,
        licenseId: crypto.randomBytes(12).toString('hex'),
        plan: { id: trial.id, limits: trial.limits, features: trial.features },
        subscription: { status: 'trialing', currentPeriodEnd: trialEnds.toISOString() },
        createdAt: created.toISOString(),
      });
    } catch (e) {
      if (e.code === 'duplicate') fail('subdomain_taken', 409);
      throw e;
    }

    /* The shard refuses suspended shops outright, so the row must be live
       for the installer to reach it. Until the installer has created the
       owner there is nobody who can sign in, so the brief window serves an
       empty login page and nothing else. A failed install is suspended. */
    try {
      await installer.install({ tenant, owner: input.owner, industry: presets.resolveInstallPayload(industry.id) });
      return store.tenants.update(tenant._id, { status: 'active', suspended: false, activatedAt: now().toISOString() });
    } catch (e) {
      await store.tenants.update(tenant._id, { status: 'install_failed', suspended: true, suspendedReason: 'install_failed', installError: String(e.code || e.message).slice(0, 200) });
      throw Object.assign(new Error('tenant_install_failed'), { code: 'tenant_install_failed', status: 502, cause: e });
    }
  }

  function hostsOf(tenant) {
    return [...(tenant.hosts || []), ...config.shopBaseDomains.map((d) => `${tenant.subdomain}.${d}`), tenant.webDomain].filter(Boolean);
  }

  async function setSuspended(id, suspended, reason) {
    const tenant = await store.tenants.update(id, { suspended, suspendedReason: suspended ? reason || 'manual' : null });
    if (!tenant) fail('tenant_not_found', 404);
    return tenant;
  }

  return { availability, signup, hostsOf, setSuspended };
}

/*
 * Runs upstream Posnic's installer (POST /api/install/add) for a new shop
 * through the shard. The shard picks the shop from SHARD_SHOP_HEADER, which
 * must be configured to the same header name on both sides.
 */
function createHttpInstaller({ shardUrl, shopHeader, posnicKey, posnicSecret, baseDomain, transport = globalThis.fetch, timeoutMs = 60000, retryDelayMs = 11000 }) {
  return {
    async install({ tenant, owner, industry }) {
      /* A 404 means the shard has not loaded the new registry row yet (it
         re-reads at most every 10 s on a miss). Nothing ran, so retrying is
         safe; any other failure is not retried. */
      for (let attempt = 0; ; attempt++) {
        const res = await post();
        if (res.status === 404 && attempt < 3) {
          await new Promise((r) => setTimeout(r, retryDelayMs));
          continue;
        }
        if (!res.ok) {
          const e = new Error(`installer answered ${res.status}`);
          e.code = 'installer_http_' + res.status;
          throw e;
        }
        return res.json().catch(() => ({}));
      }

      function post() {
        return transport(`${shardUrl.replace(/\/+$/, '')}/api/install/add`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'content-type': 'application/json',
          [shopHeader]: `${tenant.subdomain}.${baseDomain}`,
          'x-posnic-key': posnicKey,
          'x-posnic-secret': posnicSecret,
        },
        body: JSON.stringify({
          register_companyname: tenant.businessName,
          register_username: owner.username || owner.email,
          register_useremail: owner.email,
          register_userphone: owner.phone || '',
          register_userpassword: owner.password,
          register_firstname: owner.name || '',
          register_license: tenant.licenseId,
          register_country: 'Vietnam',
          register_countryid: 'VN',
          register_timezone: 'Asia/Ho_Chi_Minh',
          register_state: tenant.province || '',
          ...industry,
        }),
        });
      }
    },
  };
}

module.exports = { createTenantService, createHttpInstaller, normalizeSubdomain, tenantDbName, RESERVED };
