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
  /* /readyz pings and /metrics counts read the control DB through a small
     client of their own; the driver connects on first use. */
  const opsClient = config.store !== 'memory' ? new (require('mongodb').MongoClient)(config.mongoUri, { maxPoolSize: 2, serverSelectionTimeoutMS: 5000 }) : null;
  const { app, billing, einvoices, notifier, ops } = createApp({ store, config, providers, installer, onboarding, ops: { controlDb: opsClient && opsClient.db(config.controlDb) } });

  const server = app.listen(config.port, config.host, () => {
    console.log(`[control-plane] http://${config.host}:${config.port} store=${store.kind} providers=${providers.list().join(',') || 'none'}`);
  });
  ops.declareJob('expiry', 3600000);
  ops.declareJob('reminders', 3600000);
  const expiry = setInterval(() => ops.trackJob('expiry', () => billing.enforceExpiry()).then((s) => s.length && console.log('[control-plane] suspended', s)).catch((e) => console.error('[control-plane] expiry job', e)), 3600000);
  expiry.unref();
  /* Trial reminders: hourly is enough, each message is sent once per key. */
  const reminders = setInterval(() => ops.trackJob('reminders', () => notifier.runReminders()).then((r) => r.length && console.log('[control-plane] reminders', JSON.stringify(r))).catch((e) => console.error('[control-plane] reminders job', e)), 3600000);
  reminders.unref();
  let einvoiceTimer = null;
  if (einvoiceWorkerOn) {
    const worker = createEInvoiceWorker({ store, einvoices, tenantDb: (tenant) => tenantClient.db(tenant.tenantDb) });
    ops.declareJob('einvoice_worker', einvoiceInterval);
    const tick = () => ops.trackJob('einvoice_worker', () => worker.runOnce())
      .then((runs) => {
        for (const r of runs) if (r.error || r.issued || r.failed || r.blocked) console.log('[control-plane] einvoice', JSON.stringify({ shop: r.subdomain, issued: r.issued, failed: r.failed, blocked: r.blocked, stopped: r.stopped, error: r.error }));
      })
      .catch((e) => console.error('[control-plane] einvoice job', e));
    einvoiceTimer = setInterval(tick, einvoiceInterval);
    einvoiceTimer.unref();
  }
  const stop = () => {
    if (einvoiceTimer) clearInterval(einvoiceTimer);
    ops.close();
    server.close(() => Promise.all([store.close(), tenantClient && tenantClient.close(), opsClient && opsClient.close()]).finally(() => process.exit(0)));
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
