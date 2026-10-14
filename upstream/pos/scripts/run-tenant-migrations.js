#!/usr/bin/env node
'use strict';
/*
 * HiTechPOS: run the versioned migrations (api/src/db/migrations) against
 * every shop database a shard serves.
 *
 * server.js runs the registry at boot against its one database. A shard
 * (api/shard.js) serves many shops, one database each, and runs nothing at
 * boot - "the deploy pipeline runs these per tenant database instead". This is
 * that step: it reads the shops from the control plane's `tenants` collection
 * (the same query shard.js uses) and runs every migration a shop's own
 * schema_migrations ledger has not recorded yet.
 *
 * Reports before it touches anything; --apply is required to run.
 *
 *   node scripts/run-tenant-migrations.js --uri-file .uri --control-db hitechpos
 *   node scripts/run-tenant-migrations.js --uri-file .uri --control-db hitechpos --apply
 *   node scripts/run-tenant-migrations.js --uri-file .uri --db shop_abc --apply
 *
 * Env fallbacks: CONTROL_URI or MONGODB_URI, CONTROL_DB, SHARD_INSTANCE.
 */

const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..', 'api');

function parseArgs(argv) {
  const args = { apply: false, dbs: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--uri') args.uri = argv[++i];
    else if (argv[i] === '--uri-file') args.uriFile = argv[++i];
    else if (argv[i] === '--control-db') args.controlDb = argv[++i];
    else if (argv[i] === '--db') args.dbs.push(argv[++i]);
    else if (argv[i] === '--only') args.only = argv[++i];
    else if (argv[i] === '--apply') args.apply = true;
  }
  if (args.uriFile && !args.uri) args.uri = fs.readFileSync(args.uriFile, 'utf8').trim();
  args.uri = args.uri || process.env.CONTROL_URI || process.env.MONGODB_URI;
  args.controlDb = args.controlDb || process.env.CONTROL_DB;
  return args;
}

/** The shop databases the control plane lists, as shard.js reads them. */
async function tenantDatabases(client, controlDb, instance) {
  const query = { provisioned: true, subdomain: { $exists: true, $nin: [null, ''] } };
  if (instance) query.instance = instance;
  const rows = await client
    .db(controlDb)
    .collection('tenants')
    .find(query)
    .project({ subdomain: 1, tenantDb: 1 })
    .toArray();
  return rows.filter((t) => t.tenantDb).map((t) => ({ name: t.tenantDb, label: t.subdomain }));
}

/** Registry entries this database has not applied. */
async function pending(db, registry) {
  const done = new Set(
    (await db.collection('schema_migrations').find({}, { projection: { _id: 1 } }).toArray()).map((r) =>
      String(r._id)
    )
  );
  return registry.filter((m) => !done.has(String(m.id)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.uri || (!args.controlDb && !args.dbs.length)) {
    console.error('Usage: node scripts/run-tenant-migrations.js (--control-db <db> | --db <shop db> ...) [options]');
    console.error('  --uri <mongodb-uri> | --uri-file <path>   connection (or CONTROL_URI / MONGODB_URI)');
    console.error('  --only <migration id>                     run just this one');
    console.error('  --apply                                   run them (default: report only)');
    process.exit(2);
  }

  let MongoClient;
  try {
    ({ MongoClient } = require(path.join(API, 'node_modules', 'mongodb')));
  } catch (e) {
    ({ MongoClient } = require('mongodb'));
  }
  const { runMigrations } = require(path.join(API, 'src', 'db', 'migrations'));
  let registry = require(path.join(API, 'src', 'db', 'migrations', 'index'));
  if (args.only) registry = registry.filter((m) => m.id === args.only);
  if (!registry.length) throw new Error('no migration matches ' + args.only);

  const client = new MongoClient(args.uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  let failed = 0;
  try {
    const targets = args.dbs.length
      ? args.dbs.map((name) => ({ name, label: name }))
      : await tenantDatabases(client, args.controlDb, process.env.SHARD_INSTANCE);
    console.log(`\n  ${targets.length} shop database(s)` + (args.apply ? '   (APPLYING)' : '   (report only)'));
    for (const t of targets) {
      const db = client.db(t.name);
      try {
        const todo = await pending(db, registry);
        if (!todo.length) {
          console.log(`  ${t.label}: up to date`);
          continue;
        }
        if (!args.apply) {
          console.log(`  ${t.label}: pending ${todo.map((m) => m.id).join(', ')}`);
          continue;
        }
        const { applied } = await runMigrations(db, registry);
        console.log(`  ${t.label}: applied ${applied.join(', ') || 'nothing'}`);
      } catch (e) {
        /* One shop failing must not stop the rest; its ledger records nothing
           for the failed migration, so the next run retries it. */
        failed++;
        console.error(`  ${t.label}: FAILED - ${e.message}`);
      }
    }
    if (!args.apply) console.log('\n  Nothing was run. Re-run with --apply.');
  } finally {
    await client.close();
  }
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('  failed: ' + err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, tenantDatabases, pending };
