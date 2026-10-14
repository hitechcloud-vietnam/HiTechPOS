#!/usr/bin/env node
'use strict';

/*
 * Node half of scripts/backup/*.sh: everything that needs the MongoDB driver
 * or careful parsing. The shell scripts own locking, mongodump/mongorestore
 * and uploads.
 *
 *   plan    <runDir> --name <run>          write manifest.json, print "kind<TAB>db<TAB>archive" lines
 *   verify  <runDir> [--write] [--db <db>] check archives (and SHA256SUMS); --write records the result
 *   prune   <root> [--dry-run]             retention (BACKUP_KEEP_DAILY / _WEEKLY / BACKUP_TZ_OFFSET_MINUTES)
 *   find    <root> <shop> [--from <run>]   print "runDir<TAB>db<TAB>archive<TAB>subdomain" for one shop
 *   target-check <targetDb> <sourceDb> [--drop]   refuse unsafe restore targets
 *   counts  <runDir> <sourceDb> <targetDb> compare restored counts with the manifest
 *
 * URIs come from the environment only (BACKUP_MONGO_URI for the control DB,
 * BACKUP_TENANT_MONGO_URI for shop databases) and are never printed.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { selectRetention, parseRunName, NAME_RE } = require('./retention');
const { readArchive, checkArchive } = require('./archive');

const DB_NAME_RE = /^[A-Za-z0-9_-]{1,63}$/;
const log = (msg) => process.stderr.write(`${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} [${/^[a-z-]{1,20}$/.test(process.env.LOG_TAG || '') ? process.env.LOG_TAG : 'backup'}] ${msg}\n`);
const fail = (msg, code = 1) => {
  log(`ERROR ${msg}`);
  process.exit(code);
};
/* Values from the database (shop names) are printed only through this. */
const safe = (v) => String(v == null ? '' : v).replace(/[^\w.@-]/g, '?').slice(0, 80);

function args(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) opt[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) opt[k] = argv[++i];
      else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

async function connect(envName) {
  const uri = process.env[envName];
  if (!uri) fail(`${envName} is not set`);
  const { MongoClient } = require('mongodb');
  try {
    return await MongoClient.connect(uri, { serverSelectionTimeoutMS: Number(process.env.BACKUP_MONGO_TIMEOUT_MS || 10000), appName: 'hitechpos-backup' });
  } catch (e) {
    /* the driver message can contain the host list; the code is enough */
    return fail(`cannot connect to MongoDB (${envName}): ${safe(e.codeName || e.name)}`);
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
};

async function collectionsOf(db) {
  const list = await db.listCollections({}, { nameOnly: false, authorizedCollections: true }).toArray();
  const names = list.filter((c) => !c.name.startsWith('system.')).map((c) => c.name).sort();
  const counts = {};
  for (const c of list) {
    if (c.name.startsWith('system.') || c.type === 'view') continue;
    counts[c.name] = await db.collection(c.name).estimatedDocumentCount().catch(() => null);
  }
  return { collections: names, counts };
}

async function plan(runDir, { name }) {
  const controlDbName = process.env.CONTROL_DB || 'hitechpos_control';
  if (!DB_NAME_RE.test(controlDbName)) fail('CONTROL_DB is not a valid database name');
  const control = await connect('BACKUP_MONGO_URI');
  const sameCluster = !process.env.BACKUP_TENANT_MONGO_URI || process.env.BACKUP_TENANT_MONGO_URI === process.env.BACKUP_MONGO_URI;
  const tenantClient = sameCluster ? control : await connect('BACKUP_TENANT_MONGO_URI');
  try {
    const cdb = control.db(controlDbName);
    const existing = new Set((await tenantClient.db('admin').admin().listDatabases({ nameOnly: true })).databases.map((d) => d.name));
    const controlExists = sameCluster ? existing.has(controlDbName) : (await control.db('admin').admin().listDatabases({ nameOnly: true })).databases.some((d) => d.name === controlDbName);
    if (!controlExists) fail(`control database ${controlDbName} does not exist`);
    const databases = [{ kind: 'control', db: controlDbName, archive: `${controlDbName}.archive.gz`, ...(await collectionsOf(cdb)) }];
    const skipped = [];
    const seen = new Set([controlDbName]);
    const tenants = await cdb.collection('tenants').find({}, { projection: { subdomain: 1, tenantDb: 1, status: 1, suspended: 1 } }).sort({ subdomain: 1 }).toArray();
    for (const t of tenants) {
      const entry = { tenantId: String(t._id), subdomain: t.subdomain || null, status: t.status || null };
      if (!t.tenantDb) { skipped.push({ ...entry, reason: 'no_tenant_db' }); continue; }
      if (!DB_NAME_RE.test(t.tenantDb)) { skipped.push({ ...entry, reason: 'invalid_db_name' }); log(`WARN shop ${safe(t.subdomain)}: tenantDb is not a safe database name, skipped`); continue; }
      if (seen.has(t.tenantDb)) { skipped.push({ ...entry, tenantDb: t.tenantDb, reason: 'duplicate_db' }); log(`WARN shop ${safe(t.subdomain)}: database ${t.tenantDb} already listed, skipped`); continue; }
      if (!existing.has(t.tenantDb)) {
        skipped.push({ ...entry, tenantDb: t.tenantDb, reason: 'database_missing' });
        if (t.status !== 'install_failed' && t.status !== 'provisioning') log(`WARN shop ${safe(t.subdomain)}: database ${t.tenantDb} does not exist, skipped`);
        continue;
      }
      seen.add(t.tenantDb);
      databases.push({ kind: 'tenant', db: t.tenantDb, ...entry, archive: `${t.tenantDb}.archive.gz`, ...(await collectionsOf(tenantClient.db(t.tenantDb))) });
    }
    const manifest = {
      format: 1, name, host: os.hostname(), startedAt: new Date().toISOString(),
      controlDb: controlDbName, separateTenantCluster: !sameCluster,
      databases, skipped, ok: false,
    };
    writeJson(path.join(runDir, 'manifest.json'), manifest);
    for (const d of databases) process.stdout.write(`${d.kind}\t${d.db}\t${d.archive}\n`);
    log(`plan: control DB + ${databases.length - 1} shop database(s), ${skipped.length} shop(s) skipped`);
  } finally {
    await control.close();
    if (tenantClient !== control) await tenantClient.close();
  }
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

function readSums(runDir) {
  const file = path.join(runDir, 'SHA256SUMS');
  if (!fs.existsSync(file)) return null;
  const sums = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (m) sums[m[2]] = m[1];
  }
  return sums;
}

async function verify(runDir, { write = false, db = null } = {}) {
  const manifestFile = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) fail(`no manifest.json in ${runDir}`);
  const manifest = readJson(manifestFile);
  const targets = manifest.databases.filter((d) => !db || d.db === db);
  if (db && !targets.length) fail(`database ${safe(db)} is not in this backup`);
  const sums = write ? {} : readSums(runDir);
  if (!write && !sums) fail('SHA256SUMS missing: the backup did not finish');
  const results = {};
  let ok = true;
  for (const d of targets) {
    const file = path.join(runDir, d.archive);
    const r = { ok: false, problems: [] };
    results[d.db] = r;
    if (!fs.existsSync(file)) {
      r.problems.push('archive missing');
    } else {
      r.bytes = fs.statSync(file).size;
      r.sha256 = await sha256(file);
      if (write) sums[d.archive] = r.sha256;
      else if (sums[d.archive] !== r.sha256) r.problems.push('checksum mismatch');
      try {
        const parsed = await readArchive(file);
        const c = checkArchive(parsed, d);
        r.problems.push(...c.problems);
        r.documents = c.collections;
        /* Counts move while shops trade; a large gap is worth a line in the log. */
        for (const [name, n] of Object.entries(d.counts || {})) {
          if (Number.isInteger(n) && name in c.collections && Math.abs(c.collections[name] - n) > Math.max(100, n * 0.1)) {
            log(`WARN ${d.db}.${name}: ${c.collections[name]} documents in archive, about ${n} expected`);
          }
        }
      } catch (e) {
        r.problems.push(`unreadable: ${safe(e.code || e.message)}`);
      }
    }
    r.ok = r.problems.length === 0;
    ok = ok && r.ok;
    const docs = r.documents ? Object.values(r.documents).reduce((a, n) => a + n, 0) : 0;
    log(`${r.ok ? 'verified' : 'FAILED  '} ${d.db}: ${Object.keys(r.documents || {}).length} collection(s), ${docs} document(s)${r.ok ? '' : ` - ${r.problems.join('; ')}`}`);
  }
  if (write) {
    fs.writeFileSync(path.join(runDir, 'SHA256SUMS'), Object.entries(sums).map(([f, h]) => `${h}  ${f}\n`).join(''), { mode: 0o600 });
    manifest.verification = { at: new Date().toISOString(), results };
    manifest.finishedAt = new Date().toISOString();
    manifest.ok = ok && targets.length === manifest.databases.length;
    writeJson(manifestFile, manifest);
  }
  if (!ok) process.exit(1);
}

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n)) fail(`${name} must be an integer`);
  return n;
}

function isOkRun(dir) {
  try {
    return readJson(path.join(dir, 'manifest.json')).ok === true;
  } catch {
    return false;
  }
}

function prune(root, { dryRun = false } = {}) {
  const keepDaily = intEnv('BACKUP_KEEP_DAILY', 7);
  const keepWeekly = intEnv('BACKUP_KEEP_WEEKLY', 4);
  const tzOffsetMinutes = intEnv('BACKUP_TZ_OFFSET_MINUTES', 420);
  const failedDays = intEnv('BACKUP_KEEP_FAILED_DAYS', 3);
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  const runs = entries.filter((e) => NAME_RE.test(e.name) && isOkRun(path.join(root, e.name))).map((e) => e.name);
  const { keep, remove } = selectRetention(runs, { keepDaily, keepWeekly, tzOffsetMinutes });
  /* .partial: left by a run that died; the caller holds the lock, so no run
     is writing it. .failed: kept a few days for diagnosis. */
  const cutoff = Date.now() - failedDays * 86400000;
  for (const e of entries) {
    const m = /^(\d{8}T\d{6}Z)\.(partial|failed)$/.exec(e.name);
    if (!m) continue;
    const at = parseRunName(m[1]);
    if (m[2] === 'partial' || (at && at.getTime() < cutoff)) remove.push(e.name);
  }
  for (const k of keep) log(`keep   ${k.name} (${k.reasons.join(', ')})`);
  for (const name of remove) {
    log(`${dryRun ? 'would remove' : 'remove'} ${name}`);
    if (!dryRun) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  log(`retention: daily=${keepDaily} weekly=${keepWeekly} tz=${tzOffsetMinutes}min kept ${keep.length}, removed ${remove.length}`);
}

function latestRun(root) {
  const names = fs.readdirSync(root).filter((n) => NAME_RE.test(n) && isOkRun(path.join(root, n))).sort();
  return names.length ? path.join(root, names[names.length - 1]) : null;
}

function find(root, shop, { from } = {}) {
  let runDir;
  if (from) runDir = fs.existsSync(path.join(String(from), 'manifest.json')) ? path.resolve(String(from)) : path.join(root, String(from));
  else runDir = latestRun(root);
  if (!runDir || !fs.existsSync(path.join(runDir, 'manifest.json'))) fail(from ? `backup ${safe(from)} not found` : `no complete backup in ${root}`);
  const manifest = readJson(path.join(runDir, 'manifest.json'));
  if (manifest.ok !== true) fail(`backup ${safe(manifest.name)} did not finish successfully`);
  const d = manifest.databases.find((x) => x.kind === 'tenant' && (x.subdomain === shop || x.tenantId === shop || x.db === shop));
  if (!d) {
    const skipped = (manifest.skipped || []).find((x) => x.subdomain === shop || x.tenantId === shop);
    fail(skipped ? `shop ${safe(shop)} was not backed up in ${manifest.name} (${skipped.reason})` : `shop ${safe(shop)} is not in backup ${manifest.name}`);
  }
  process.stdout.write(`${runDir}\t${d.db}\t${path.join(runDir, d.archive)}\t${d.subdomain || ''}\n`);
}

async function targetCheck(target, source, { drop = false } = {}) {
  if (!DB_NAME_RE.test(target)) fail('target database name may only contain letters, digits, _ and -');
  const controlDbName = process.env.CONTROL_DB || 'hitechpos_control';
  if (target === controlDbName || ['admin', 'local', 'config'].includes(target)) fail(`refusing to restore a shop into ${target}`);
  const control = await connect('BACKUP_MONGO_URI');
  const tenantClient = process.env.BACKUP_TENANT_MONGO_URI && process.env.BACKUP_TENANT_MONGO_URI !== process.env.BACKUP_MONGO_URI ? await connect('BACKUP_TENANT_MONGO_URI') : control;
  try {
    if (target !== source) {
      const owner = await control.db(controlDbName).collection('tenants').findOne({ tenantDb: target }, { projection: { subdomain: 1 } });
      if (owner) fail(`${target} is the live database of shop ${safe(owner.subdomain)}; choose another --to-db`);
    }
    const names = (await tenantClient.db(target).listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
    if (target !== source && names.length && !drop) fail(`${target} already has ${names.length} collection(s); pass --drop to overwrite them or choose another --to-db`, 3);
    log(`target ${target}: ${names.length} existing collection(s)`);
  } finally {
    await control.close();
    if (tenantClient !== control) await tenantClient.close();
  }
}

async function counts(runDir, source, target) {
  const manifest = readJson(path.join(runDir, 'manifest.json'));
  const d = manifest.databases.find((x) => x.db === source);
  if (!d) fail(`database ${safe(source)} is not in this backup`);
  const expected = (manifest.verification && manifest.verification.results[source] && manifest.verification.results[source].documents) || {};
  const client = await connect('BACKUP_TENANT_MONGO_URI');
  let ok = true;
  try {
    const db = client.db(target);
    for (const [name, n] of Object.entries(expected)) {
      const got = await db.collection(name).countDocuments({});
      if (got !== n) { ok = false; log(`MISMATCH ${target}.${name}: ${got} document(s), archive had ${n}`); }
    }
    log(`${ok ? 'restored' : 'restored with differences'} ${target}: ${Object.keys(expected).length} collection(s) checked against the archive`);
  } finally {
    await client.close();
  }
  if (!ok) process.exit(1);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = args(rest);
  switch (cmd) {
    case 'plan': return plan(pos[0], { name: opt.name || path.basename(pos[0]) });
    case 'verify': return verify(pos[0], { write: !!opt.write, db: opt.db || null });
    case 'prune': return prune(pos[0], { dryRun: !!opt['dry-run'] });
    case 'find': return find(pos[0], pos[1], { from: opt.from });
    case 'target-check': return targetCheck(pos[0], pos[1], { drop: !!opt.drop });
    case 'counts': return counts(pos[0], pos[1], pos[2]);
    default: return fail(`unknown command ${safe(cmd)}`, 64);
  }
}

if (require.main === module) {
  /* codes only: a driver message may name hosts or carry the URI */
  main().catch((e) => fail(`unexpected error: ${safe(e.code || e.codeName || e.name)}`));
}

module.exports = { prune, latestRun };
