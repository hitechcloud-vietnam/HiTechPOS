'use strict';

const { masterKey } = require('./secrets');

/* Read inside a function, never at module scope (see upstream ARCHITECTURE.md
   "Module-scope process.env reads"). */
function loadConfig(env = process.env) {
  const list = (v, d) => String(v || d).split(',').map((s) => s.trim()).filter(Boolean);
  const required = (name) => {
    if (!env[name]) throw new Error(`${name} must be set`);
    return env[name];
  };
  const memory = env.STORE === 'memory';
  return {
    port: Number(env.PORT || 4100),
    host: env.HOST || '127.0.0.1',
    publicUrl: String(env.PUBLIC_URL || 'http://localhost:4100').replace(/\/+$/, ''),
    store: memory ? 'memory' : 'mongo',
    mongoUri: memory ? null : required('CONTROL_URI'),
    controlDb: env.CONTROL_DB || 'hitechpos_control',
    tenantSecretKey: masterKey(memory && !env.TENANT_SECRET_KEY ? '00'.repeat(32) : env.TENANT_SECRET_KEY),
    tenantDbPrefix: env.TENANT_DB_PREFIX || 'hitech_t_',
    shopBaseDomains: list(env.SHOP_BASE_DOMAINS, 'hitechpos.vn'),
    shardInstance: env.SHARD_INSTANCE || null,
    shardUrl: env.SHARD_URL || null,
    shardShopHeader: String(env.SHARD_SHOP_HEADER || 'x-hitech-shop').toLowerCase(),
    posnicKey: env.POSNIC_KEY || null,
    posnicSecret: env.POSNIC_SECRET || null,
    sessionSecret: memory && !env.SESSION_SECRET ? 'dev-only-session-secret' : required('SESSION_SECRET'),
    adminKey: env.ADMIN_API_KEY || null,
    saasVatRate: env.SAAS_VAT_RATE === undefined || env.SAAS_VAT_RATE === 'KCT' ? 'KCT' : Number(env.SAAS_VAT_RATE),
    graceDays: Number(env.GRACE_DAYS || 7),
    sourceUrl: env.SOURCE_URL || 'https://github.com/hitechcloud-vietnam/HiTechPOS',
    payos: env.PAYOS_CLIENT_ID ? { clientId: env.PAYOS_CLIENT_ID, apiKey: env.PAYOS_API_KEY, checksumKey: env.PAYOS_CHECKSUM_KEY, partnerCode: env.PAYOS_PARTNER_CODE } : null,
    pay2s: env.PAY2S_ACCESS_KEY ? { environment: env.PAY2S_ENV || 'sandbox', accessKey: env.PAY2S_ACCESS_KEY, partnerCode: env.PAY2S_PARTNER_CODE, secretKey: env.PAY2S_SECRET_KEY, partnerName: env.PAY2S_PARTNER_NAME } : null,
  };
}

module.exports = { loadConfig };
