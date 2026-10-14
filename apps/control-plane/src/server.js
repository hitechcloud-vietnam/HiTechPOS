'use strict';

const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { createMemoryStore } = require('./store/memory');
const { providersFromConfig } = require('./providers');
const { createHttpInstaller } = require('./tenants');
const { createOnboarding, createMongoBranchPatcher } = require('./onboarding');
const { createEInvoiceWorker } = require('./einvoice-worker');

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
  /* Receipt titles have no Posnic endpoint; their one raw write needs the
     tenant databases, which live on CONTROL_URI unless TENANT_MONGO_URI says
     otherwise. Without Mongo that single step reports 'skipped'.
     The e-invoice worker reads every shop's `sales` through the same client.
     EINVOICE_WORKER_INTERVAL_MS (default 60000) = 0 turns it off; it never
     runs on the memory store (no tenant databases to read). */
  const einvoiceInterval = process.env.EINVOICE_WORKER_INTERVAL_MS === undefined ? 60000 : Number(process.env.EINVOICE_WORKER_INTERVAL_MS);
  const einvoiceWorkerOn = config.store !== 'memory' && Number.isFinite(einvoiceInterval) && einvoiceInterval > 0;
  let tenantClient = null;
  if ((config.shardUrl || einvoiceWorkerOn) && config.store !== 'memory') {
    const { MongoClient } = require('mongodb');
    tenantClient = await MongoClient.connect(process.env.TENANT_MONGO_URI || config.mongoUri);
  }
  const onboarding = config.shardUrl
    ? createOnboarding({ shardUrl: config.shardUrl, shopHeader: config.shardShopHeader, baseDomain: config.shopBaseDomains[0], branchPatcher: tenantClient && createMongoBranchPatcher({ client: tenantClient }) })
    : null;
  const providers = providersFromConfig(config);
  const { app, billing, einvoices, notifier } = createApp({ store, config, providers, installer, onboarding });

  const server = app.listen(config.port, config.host, () => {
    console.log(`[control-plane] http://${config.host}:${config.port} store=${store.kind} providers=${providers.list().join(',') || 'none'}`);
  });
  const expiry = setInterval(() => billing.enforceExpiry().then((s) => s.length && console.log('[control-plane] suspended', s)).catch((e) => console.error('[control-plane] expiry job', e)), 3600000);
  expiry.unref();
  /* Trial reminders: hourly is enough, each message is sent once per key. */
  const reminders = setInterval(() => notifier.runReminders().then((r) => r.length && console.log('[control-plane] reminders', JSON.stringify(r))).catch((e) => console.error('[control-plane] reminders job', e)), 3600000);
  reminders.unref();
  let einvoiceTimer = null;
  if (einvoiceWorkerOn) {
    const worker = createEInvoiceWorker({ store, einvoices, tenantDb: (tenant) => tenantClient.db(tenant.tenantDb) });
    const tick = () => worker.runOnce()
      .then((runs) => {
        for (const r of runs) if (r.error || r.issued || r.failed || r.blocked) console.log('[control-plane] einvoice', JSON.stringify({ shop: r.subdomain, issued: r.issued, failed: r.failed, blocked: r.blocked, stopped: r.stopped, error: r.error }));
      })
      .catch((e) => console.error('[control-plane] einvoice job', e));
    einvoiceTimer = setInterval(tick, einvoiceInterval);
    einvoiceTimer.unref();
  }
  const stop = () => {
    if (einvoiceTimer) clearInterval(einvoiceTimer);
    server.close(() => Promise.all([store.close(), tenantClient && tenantClient.close()]).finally(() => process.exit(0)));
  };
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
