'use strict';

/*
 * scripts/backup: retention selection and archive verification are pure and
 * always tested; the shell scripts are run for their failure modes (missing
 * tool, lock held), and end to end against a real mongod only when
 * MONGO_TEST_URI is set and mongodump/mongorestore are found (PATH or
 * MONGO_TOOLS_DIR).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn, spawnSync } = require('node:child_process');
const { BSON } = require('mongodb');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BACKUP = path.join(ROOT, 'scripts', 'backup');
const { selectRetention, parseRunName, formatRunName, localKeys } = require(path.join(BACKUP, 'lib', 'retention'));
const { readArchive, createParser, checkArchive } = require(path.join(BACKUP, 'lib', 'archive'));

const tmpdir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitech-backup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/* ---- retention ------------------------------------------------------------ */

/* one run per day at 02:00 ICT (19:00 UTC the day before) */
const nightly = (from, days) => Array.from({ length: days }, (_, i) => formatRunName(new Date(Date.parse(from) + i * 86400000)));
const ict = (name) => new Date(parseRunName(name).getTime() + 7 * 3600000).toISOString().slice(0, 10);

test('retention: 7 daily + 4 weekly over a month of nightly runs', () => {
  /* 2026-09-15 .. 2026-10-14 ICT; 2026-10-14 is a Wednesday */
  const names = nightly('2026-09-14T19:00:00Z', 30);
  const { keep, remove, ignored } = selectRetention([...names].reverse(), { keepDaily: 7, keepWeekly: 4, tzOffsetMinutes: 420 });
  assert.deepEqual(keep.map((k) => ict(k.name)), [
    '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08', // daily
    '2026-10-04', // newest of ISO week 40 (Mon 28 Sep - Sun 4 Oct)
    '2026-09-27', // newest of ISO week 39
  ]);
  assert.deepEqual(keep[0].reasons, ['latest', 'daily', 'weekly']);
  assert.deepEqual(keep.find((k) => ict(k.name) === '2026-10-11').reasons, ['daily', 'weekly']);
  assert.deepEqual(keep.find((k) => ict(k.name) === '2026-10-04').reasons, ['weekly']);
  assert.equal(remove.length, 30 - 9);
  assert.equal(ignored.length, 0);
  assert.ok(remove.every((n) => !keep.some((k) => k.name === n)));
});

test('retention: days are local (UTC+7) days, newest run of a day wins', () => {
  const early = '20261013T183000Z'; // 2026-10-14 01:30 ICT
  const late = '20261014T160000Z'; //  2026-10-14 23:00 ICT
  const prev = '20261013T100000Z'; //  2026-10-13 17:00 ICT
  const ict7 = selectRetention([early, late, prev], { keepDaily: 2, keepWeekly: 0, tzOffsetMinutes: 420 });
  assert.deepEqual(ict7.keep.map((k) => k.name), [late, prev]);
  assert.deepEqual(ict7.remove, [early]);
  /* in UTC the same runs fall on three different days */
  const utc = selectRetention([early, late, prev], { keepDaily: 2, keepWeekly: 0, tzOffsetMinutes: 0 });
  assert.deepEqual(utc.keep.map((k) => k.name), [late, early]);
  assert.deepEqual(utc.remove, [prev]);
});

test('retention: only days and weeks that have a run are counted', () => {
  const names = ['20261001T000000Z', '20261005T000000Z', '20261010T000000Z'];
  const r = selectRetention(names, { keepDaily: 2, keepWeekly: 0, tzOffsetMinutes: 0 });
  assert.deepEqual(r.keep.map((k) => k.name), ['20261010T000000Z', '20261005T000000Z']);
  assert.deepEqual(r.remove, ['20261001T000000Z']);
});

test('retention: the newest run survives keep 0/0; foreign names are never removed', () => {
  const names = ['20261014T000000Z', '20261013T000000Z', '20261014T000000Z.failed', 'notes.txt', '20261340T000000Z', '20260230T000000Z', '20261014T250000Z'];
  const r = selectRetention(names, { keepDaily: 0, keepWeekly: 0 });
  assert.deepEqual(r.keep, [{ name: '20261014T000000Z', reasons: ['latest'] }]);
  assert.deepEqual(r.remove, ['20261013T000000Z']);
  assert.deepEqual(r.ignored.sort(), ['20260230T000000Z', '20261014T000000Z.failed', '20261014T250000Z', '20261340T000000Z', 'notes.txt']);
  assert.deepEqual(selectRetention([], {}), { keep: [], remove: [], ignored: [] });
});

test('retention: weekly keeps reach back past the daily window', () => {
  const names = nightly('2026-08-01T19:00:00Z', 75);
  const r = selectRetention(names, { keepDaily: 3, keepWeekly: 8, tzOffsetMinutes: 420 });
  const weekly = r.keep.filter((k) => k.reasons.includes('weekly'));
  assert.equal(weekly.length, 8);
  /* each weekly keep is a Sunday (newest of its ISO week) except the current week */
  assert.ok(weekly.slice(1).every((k) => new Date(`${ict(k.name)}T00:00:00Z`).getUTCDay() === 0));
  assert.equal(r.keep.length, 3 + 7); // the current week's newest is also a daily keep
});

test('retention: ISO weeks across year ends and parameter validation', () => {
  assert.equal(localKeys(new Date('2027-01-01T05:00:00Z'), 0).week, '2026-W53');
  assert.equal(localKeys(new Date('2027-01-04T05:00:00Z'), 0).week, '2027-W01');
  assert.equal(localKeys(new Date('2024-12-30T05:00:00Z'), 0).week, '2025-W01');
  assert.equal(localKeys(new Date('2026-10-13T18:00:00Z'), 420).day, '2026-10-14');
  assert.equal(formatRunName(new Date('2026-10-14T02:03:04.567Z')), '20261014T020304Z');
  assert.equal(parseRunName('20261014T020304Z').toISOString(), '2026-10-14T02:03:04.000Z');
  assert.throws(() => selectRetention([], { keepDaily: -1 }), RangeError);
  assert.throws(() => selectRetention([], { keepWeekly: 1.5 }), RangeError);
  assert.throws(() => selectRetention([], { tzOffsetMinutes: 2000 }), RangeError);
});

/* ---- archive reader ------------------------------------------------------- */

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const TERM = u32(0xffffffff);
/* blocks: [[ns, docs]] in body order, so collections can interleave like a
   concurrent mongodump. */
function encodeArchive(db, collections, blocks, { eof = true } = {}) {
  const parts = [u32(0x8199e26d), BSON.serialize({ concurrent_collections: 4, version: '0.1', server_version: '8.0.0', tool_version: '100.13.0' })];
  for (const c of collections) parts.push(BSON.serialize({ db, collection: c, metadata: '{"indexes":[]}', size: 0, type: 'collection' }));
  parts.push(TERM);
  for (const [c, docs] of blocks) parts.push(BSON.serialize({ db, collection: c, EOF: false, CRC: BSON.Long.fromNumber(0) }), ...docs.map((d) => BSON.serialize(d)), TERM);
  if (eof) for (const c of collections) parts.push(BSON.serialize({ db, collection: c, EOF: true, CRC: BSON.Long.fromNumber(0) }), TERM);
  return Buffer.concat(parts);
}
const docs = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ i, ...extra }));

test('archive: reads collections and document counts from a gzipped archive', async (t) => {
  const dir = tmpdir(t);
  const file = path.join(dir, 'hitech_t_a.archive.gz');
  fs.writeFileSync(file, zlib.gzipSync(encodeArchive('hitech_t_a', ['sales', 'users', 'empty'], [['sales', docs(3)], ['users', docs(1)], ['sales', docs(2, { big: 'x'.repeat(70000) })]])));
  const r = await readArchive(file);
  assert.equal(r.header.tool_version, '100.13.0');
  assert.deepEqual(r.namespaces.map((n) => [n.collection, n.documents, n.complete]), [['sales', 5, true], ['users', 1, true], ['empty', 0, true]]);
  const ok = checkArchive(r, { db: 'hitech_t_a', collections: ['sales', 'users', 'empty'] });
  assert.deepEqual(ok, { ok: true, problems: [], collections: { sales: 5, users: 1, empty: 0 } });
  const missing = checkArchive(r, { db: 'hitech_t_a', collections: ['sales', 'customers'] });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.problems, ['collection customers missing from archive']);
  assert.equal(checkArchive(r, { db: 'hitech_t_b', collections: [] }).ok, false, 'another database inside is an error');
});

test('archive: incremental parsing gives the same result for any chunking', () => {
  const raw = encodeArchive('d', ['a', 'b'], [['a', docs(4)], ['b', docs(2)], ['a', docs(1)]]);
  for (const size of [1, 3, 7, 64, raw.length]) {
    const p = createParser();
    for (let i = 0; i < raw.length; i += size) p.push(raw.subarray(i, i + size));
    const r = p.end();
    assert.deepEqual(r.namespaces.map((n) => [n.collection, n.documents]), [['a', 5], ['b', 2]], `chunk size ${size}`);
  }
});

test('archive: truncated, unfinished, foreign and corrupt files are rejected', async (t) => {
  const dir = tmpdir(t);
  const raw = encodeArchive('d', ['a'], [['a', docs(10)]]);
  const write = (name, buf) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, buf);
    return f;
  };
  await assert.rejects(readArchive(write('cut.archive.gz', zlib.gzipSync(raw.subarray(0, raw.length - 30)))), { code: 'archive_truncated' });
  await assert.rejects(readArchive(write('gzcut.archive.gz', zlib.gzipSync(raw).subarray(0, 40))), { code: 'archive_truncated' });
  await assert.rejects(readArchive(write('plain.archive.gz', zlib.gzipSync(Buffer.from('{"not":"an archive"}')))), { code: 'archive_not_mongodump' });
  await assert.rejects(readArchive(write('notgz.archive.gz', raw)), (e) => ['archive_corrupt', 'archive_truncated'].includes(e.code));
  const unfinished = await readArchive(write('noeof.archive', encodeArchive('d', ['a'], [['a', docs(2)]], { eof: false })));
  assert.equal(checkArchive(unfinished, { db: 'd', collections: ['a'] }).problems[0], 'collection a has no end marker');
});

/* ---- shell scripts -------------------------------------------------------- */

const run = (script, args, env) => spawnSync('bash', [path.join(BACKUP, script), ...args], {
  encoding: 'utf8',
  env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: os.tmpdir(), NODE: process.execPath, BACKUP_ENV_FILE: '/dev/null', BACKUP_CONTROL_ENV_FILE: '/dev/null', ...env },
  timeout: 120000,
});

const toolsOnPath = spawnSync('bash', ['-c', 'command -v mongodump'], { env: { PATH: '/usr/local/bin:/usr/bin:/bin' } }).status === 0;

test('backup.sh: fails clearly when mongodump is missing, before touching anything', { skip: toolsOnPath && 'mongodump is installed on PATH' }, (t) => {
  const dir = tmpdir(t);
  const r = run('backup.sh', [], { BACKUP_DIR: dir, BACKUP_MONGO_URI: 'mongodb://127.0.0.1:1/', MONGO_TOOLS_DIR: path.join(dir, 'none') });
  assert.equal(r.status, 69);
  assert.match(r.stderr, /mongodump not found/);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n !== '.lock'), []);
  const restore = run('restore-tenant.sh', ['shop'], { BACKUP_DIR: dir, BACKUP_MONGO_URI: 'mongodb://127.0.0.1:1/', MONGO_TOOLS_DIR: path.join(dir, 'none') });
  assert.equal(restore.status, 69);
  assert.match(restore.stderr, /mongorestore not found/);
});

test('backup.sh: configuration and usage errors', (t) => {
  const dir = tmpdir(t);
  const noUri = run('backup.sh', [], { BACKUP_DIR: dir });
  assert.equal(noUri.status, 64);
  assert.match(noUri.stderr, /BACKUP_MONGO_URI \(or CONTROL_URI\) is not set/);
  assert.equal(run('backup.sh', ['--bogus'], { BACKUP_DIR: dir }).status, 64);
  assert.equal(run('restore-tenant.sh', [], { BACKUP_DIR: dir }).status, 64);
  /* the URI is read from an env file without executing it as shell */
  const envFile = path.join(dir, 'backup.env');
  const marker = path.join(dir, 'pwned');
  fs.writeFileSync(envFile, `# comment\nBACKUP_MONGO_URI=mongodb://u:p@127.0.0.1:1/?replicaSet=rs0&touch ${marker}\nBACKUP_KEEP_DAILY='3'\n`);
  const r = run('backup.sh', [], { BACKUP_DIR: dir, BACKUP_ENV_FILE: envFile, MONGO_TOOLS_DIR: path.join(dir, 'none') });
  assert.notEqual(r.status, 64, 'URI was loaded from the file');
  assert.equal(fs.existsSync(marker), false);
});

test('backup.sh: a second run exits 75 while the lock is held', async (t) => {
  const dir = tmpdir(t);
  const holder = spawn('bash', ['-c', `exec 9>>"${dir}/.lock"; flock 9; echo locked; exec sleep 30`], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => holder.kill());
  await new Promise((resolve) => holder.stdout.once('data', resolve));
  const r = run('backup.sh', [], { BACKUP_DIR: dir, BACKUP_MONGO_URI: 'mongodb://127.0.0.1:1/' });
  assert.equal(r.status, 75);
  assert.match(r.stderr, /another backup or restore holds/);
});

test('cli prune: applies retention to complete runs and clears stale partial/failed runs', (t) => {
  const dir = tmpdir(t);
  const runs = nightly('2026-09-14T19:00:00Z', 30);
  for (const name of runs) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'manifest.json'), JSON.stringify({ ok: true }));
  }
  const unfinished = '20261014T200000Z'; // newer, but its manifest says not ok: never counted, never removed
  fs.mkdirSync(path.join(dir, unfinished));
  fs.writeFileSync(path.join(dir, unfinished, 'manifest.json'), JSON.stringify({ ok: false }));
  fs.mkdirSync(path.join(dir, '20200101T000000Z.failed'));
  fs.mkdirSync(path.join(dir, `${formatRunName(new Date())}.failed`));
  fs.mkdirSync(path.join(dir, '20261014T210000Z.partial'));
  fs.mkdirSync(path.join(dir, 'keep-me'));
  const cli = (args, env = {}) => spawnSync(process.execPath, [path.join(BACKUP, 'lib', 'cli.js'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

  const dry = cli(['prune', dir, '--dry-run'], { BACKUP_KEEP_DAILY: '7', BACKUP_KEEP_WEEKLY: '4' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stderr, /would remove/);
  assert.equal(fs.readdirSync(dir).length, 30 + 5);

  const r = cli(['prune', dir], { BACKUP_KEEP_DAILY: '7', BACKUP_KEEP_WEEKLY: '4' });
  assert.equal(r.status, 0, r.stderr);
  const left = fs.readdirSync(dir).sort();
  assert.equal(left.filter((n) => runs.includes(n)).length, 9);
  assert.ok(left.includes(unfinished));
  assert.ok(left.includes('keep-me'));
  assert.ok(!left.includes('20200101T000000Z.failed'));
  assert.ok(left.some((n) => n.endsWith('.failed')), 'a recent failed run is kept for diagnosis');
  assert.ok(!left.some((n) => n.endsWith('.partial')));
  assert.match(r.stderr, /retention: daily=7 weekly=4 tz=420min kept 9, removed 23/);

  assert.notEqual(cli(['prune', dir], { BACKUP_KEEP_DAILY: 'many' }).status, 0);
});

/* ---- end to end against a real mongod ------------------------------------- */

function findTool(name) {
  if (process.env.MONGO_TOOLS_DIR && fs.existsSync(path.join(process.env.MONGO_TOOLS_DIR, name))) return true;
  return spawnSync('bash', ['-c', `command -v ${name}`]).status === 0;
}
const e2eSkip = !process.env.MONGO_TEST_URI ? 'MONGO_TEST_URI not set' : !(findTool('mongodump') && findTool('mongorestore')) ? 'mongodump/mongorestore not found (PATH or MONGO_TOOLS_DIR)' : false;

test('backup.sh + restore-tenant.sh end to end', { skip: e2eSkip, timeout: 300000 }, async (t) => {
  const { MongoClient } = require('mongodb');
  const uri = process.env.MONGO_TEST_URI;
  const client = await MongoClient.connect(uri);
  const p = `ops_test_${process.pid}`;
  const names = { control: `${p}_control`, a: `${p}_t_alpha`, b: `${p}_t_beta`, restore: `${p}_restore` };
  t.after(async () => {
    for (const db of Object.values(names)) await client.db(db).dropDatabase().catch(() => {});
    await client.close();
  });
  await client.db(names.control).collection('tenants').insertMany([
    { subdomain: 'alpha', tenantDb: names.a, status: 'active' },
    { subdomain: 'beta', tenantDb: names.b, status: 'active' },
    { subdomain: 'ghost', tenantDb: `${p}_t_ghost`, status: 'install_failed' },
  ]);
  await client.db(names.control).collection('accounts').insertOne({ email: 'x@y.vn' });
  await client.db(names.a).collection('sales').insertMany(docs(120, { shop: 'alpha' }));
  await client.db(names.a).collection('users').insertOne({ name: 'admin' });
  await client.db(names.a).createCollection('cashregister');
  await client.db(names.b).collection('sales').insertMany(docs(7, { shop: 'beta' }));

  const dir = tmpdir(t);
  const env = { BACKUP_DIR: dir, BACKUP_MONGO_URI: uri, CONTROL_DB: names.control, ...(process.env.MONGO_TOOLS_DIR ? { MONGO_TOOLS_DIR: process.env.MONGO_TOOLS_DIR } : {}) };
  const b = run('backup.sh', [], env);
  assert.equal(b.status, 0, b.stderr);
  assert.ok(!b.stderr.includes(uri), 'the URI is never logged');
  const [runName] = fs.readdirSync(dir).filter((n) => /^\d{8}T\d{6}Z$/.test(n));
  const runDir = path.join(dir, runName);
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.ok, true);
  assert.deepEqual(manifest.databases.map((d) => d.db), [names.control, names.a, names.b]);
  assert.deepEqual(manifest.skipped.map((s) => [s.subdomain, s.reason]), [['ghost', 'database_missing']]);
  assert.deepEqual(manifest.verification.results[names.a].documents, { cashregister: 0, sales: 120, users: 1 });
  assert.equal((fs.statSync(runDir).mode & 0o777), 0o700);
  assert.match(fs.readFileSync(path.join(runDir, 'SHA256SUMS'), 'utf8'), new RegExp(`^[0-9a-f]{64}  ${names.a}\\.archive\\.gz$`, 'm'));

  /* side by side */
  const r = run('restore-tenant.sh', ['alpha', '--to-db', names.restore], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(await client.db(names.restore).collection('sales').countDocuments(), 120);
  assert.deepEqual((await client.db(names.restore).listCollections().toArray()).map((c) => c.name).sort(), ['cashregister', 'sales', 'users']);
  /* the target now has data: refused without --drop, and never onto another shop */
  assert.equal(run('restore-tenant.sh', ['alpha', '--to-db', names.restore], env).status, 3);
  assert.equal(run('restore-tenant.sh', ['alpha', '--to-db', names.b, '--drop'], env).status, 1);
  assert.equal(run('restore-tenant.sh', ['alpha', '--to-db', names.control, '--drop'], env).status, 1);
  /* in place needs --yes, then puts back what was deleted */
  assert.equal(run('restore-tenant.sh', ['alpha'], env).status, 64);
  await client.db(names.a).collection('sales').deleteMany({ i: { $gte: 20 } });
  const inPlace = run('restore-tenant.sh', [names.a, '--yes', '--from', runName], env);
  assert.equal(inPlace.status, 0, inPlace.stderr);
  assert.equal(await client.db(names.a).collection('sales').countDocuments(), 120);
  assert.equal(await client.db(names.b).collection('sales').countDocuments(), 7, 'other shops untouched');

  /* a damaged archive is caught before anything is written */
  fs.appendFileSync(path.join(runDir, `${names.b}.archive.gz`), 'x');
  const damaged = run('restore-tenant.sh', ['beta', '--to-db', `${names.restore}_b`], env);
  assert.equal(damaged.status, 1);
  assert.match(damaged.stderr, /checksum mismatch/);
  assert.equal((await client.db('admin').admin().listDatabases({ nameOnly: true })).databases.some((d) => d.name === `${names.restore}_b`), false);
});
