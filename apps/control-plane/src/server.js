'use strict';

const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { createMemoryStore } = require('./store/memory');
const { providersFromConfig } = require('./providers');
const { createHttpInstaller } = require('./tenants');

/* Without a shard (local development) shops are registered but no Posnic
   installer runs; the log says so rather than pretending. */
function devInstaller() {
  return { async install({ tenant }) { console.warn(`[control-plane] SHARD_URL not set: ${tenant.subdomain} registered without running the Posnic installer`); } };
}

async function main() {
  const config = loadConfig();
  const store = config.store === 'memory'
    ? createMemoryStore()
    : await require('./store/mongo').createMongoStore({ uri: config.mongoUri, dbName: config.controlDb });
  const installer = config.shardUrl
    ? createHttpInstaller({ shardUrl: config.shardUrl, shopHeader: config.shardShopHeader, posnicKey: config.posnicKey, posnicSecret: config.posnicSecret, baseDomain: config.shopBaseDomains[0] })
    : devInstaller();
  const providers = providersFromConfig(config);
  const { app, billing } = createApp({ store, config, providers, installer });

  const server = app.listen(config.port, config.host, () => {
    console.log(`[control-plane] http://${config.host}:${config.port} store=${store.kind} providers=${providers.list().join(',') || 'none'}`);
  });
  const expiry = setInterval(() => billing.enforceExpiry().then((s) => s.length && console.log('[control-plane] suspended', s)).catch((e) => console.error('[control-plane] expiry job', e)), 3600000);
  expiry.unref();
  const stop = () => server.close(() => store.close().finally(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[control-plane] fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { main };
