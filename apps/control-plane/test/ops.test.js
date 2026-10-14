'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createOps, routeLabel, safeEqual } = require('../src/ops');
const { createProviderRegistry } = require('@hitechpos/payment-core');

const quiet = { warn() {}, error() {}, log() {} };

async function start(t, { env = {}, ops = {}, store = createMemoryStore() } = {}) {
  const config = loadConfig({ STORE: 'memory', ADMIN_API_KEY: 'admin-secret-key', ...env });
  const created = createApp({ store, config, logger: quiet, installer: { async install() {} }, providers: createProviderRegistry([]), ops: { statsTtlMs: 0, ...ops } });
  const server = created.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => {
    created.ops.close();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, headers = {} } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* text body */ }
    return { status: res.status, text, json, type: res.headers.get('content-type') || '' };
  };
  return { ...created, store, config, call };
}

/* A minimal stand-in for the shard: answers every request with `status`. */
async function fakeShard(t, status) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { 'content-type': 'text/plain' });
    res.end(req.headers.host === 'readyz.invalid' ? 'ok' : 'unexpected host');
  });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

const A = { 'x-admin-key': 'admin-secret-key' };

test('ops: /readyz is 200 with the control DB reachable and leaves /healthz unchanged', async (t) => {
  const { call } = await start(t);
  const r = await call('GET', '/readyz');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.checks.controlDb.ok, true);
  assert.equal(r.json.checks.shard, undefined, 'no shard configured, no shard check');
  const h = await call('GET', '/healthz');
  assert.deepEqual(h.json, { ok: true, store: 'memory', providers: [] });
});

test('ops: /readyz is 503 when the control DB ping fails or times out, without leaking details', async (t) => {
  const failing = await start(t, { ops: { ping: async () => { throw new Error('connect ECONNREFUSED mongodb://user:pw@db.internal:27017'); } } });
  const r = await failing.call('GET', '/readyz');
  assert.equal(r.status, 503);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.checks.controlDb.error, 'unreachable');
  assert.ok(!/pw|db\.internal|27017|ECONNREFUSED/.test(r.text), 'no driver message in the response');

  const hanging = await start(t, { env: { READYZ_TIMEOUT_MS: '50' }, ops: { ping: () => new Promise(() => {}) } });
  const h = await hanging.call('GET', '/readyz');
  assert.equal(h.status, 503);
  assert.equal(h.json.checks.controlDb.error, 'timeout');
});

test('ops: /readyz probes the shard when SHARD_URL is set', async (t) => {
  const up = await start(t, { env: { SHARD_URL: await fakeShard(t, 404) } });
  const ok = await up.call('GET', '/readyz');
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.json.checks.shard.ok, ok.json.checks.shard.status], [true, 404]);

  const shardUrl = await fakeShard(t, 500);
  const broken = await start(t, { env: { SHARD_URL: shardUrl } });
  const bad = await broken.call('GET', '/readyz');
  assert.equal(bad.status, 503);
  assert.equal(bad.json.checks.shard.error, 'http_500');
  assert.equal(bad.json.checks.controlDb.ok, true);
  assert.ok(!bad.text.includes(shardUrl.split(':').pop()), 'the shard address is not echoed');

  const off = await start(t, { env: { SHARD_URL: shardUrl, READYZ_SHARD: '0' } });
  assert.equal((await off.call('GET', '/readyz')).status, 200);

  /* nothing listening: refused quickly, reported as unreachable */
  const closed = http.createServer();
  closed.listen(0, '127.0.0.1');
  await new Promise((r) => closed.once('listening', r));
  const port = closed.address().port;
  await new Promise((r) => closed.close(r));
  const gone = await start(t, { env: { SHARD_URL: `http://127.0.0.1:${port}`, READYZ_TIMEOUT_MS: '500' } });
  const g = await gone.call('GET', '/readyz');
  assert.equal(g.status, 503);
  assert.ok(['unreachable', 'timeout'].includes(g.json.checks.shard.error));
});

test('ops: /metrics requires the admin key or METRICS_TOKEN', async (t) => {
  const { call } = await start(t, { env: { METRICS_TOKEN: 'scrape-token-123' } });
  assert.equal((await call('GET', '/metrics')).status, 401);
  assert.equal((await call('GET', '/metrics', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call('GET', '/metrics', { headers: { 'x-admin-key': 'nope' } })).status, 401);
  const viaToken = await call('GET', '/metrics', { headers: { authorization: 'Bearer scrape-token-123' } });
  assert.equal(viaToken.status, 200);
  assert.match(viaToken.type, /^text\/plain; version=0\.0\.4/);
  assert.equal((await call('GET', '/metrics', { headers: A })).status, 200);

  /* No token configured: a bearer header alone never opens it. */
  const noToken = await start(t);
  assert.equal((await noToken.call('GET', '/metrics', { headers: { authorization: 'Bearer ' } })).status, 401);
});

test('ops: /metrics exposition is well formed and labels routes by template', async (t) => {
  const { call, store } = await start(t);
  await call('GET', '/api/industries/raw-industry-xyz');            // route throws 404
  await call('GET', '/api/public/pay/tenant-777/123456789');          // param route
  await call('GET', '/definitely-not-a-route-qwe');                  // no route
  await call('GET', '/api/plans');
  await call('POST', '/api/signup', { body: { subdomain: 'photue', businessName: 'Phở Tuệ', industry: 'nha-hang-quan-an', ownerName: 'T', email: 't@p.vn', phone: '0912345678', password: 'matkhau123' } });
  await store.payments.insert({ orderCode: 1, provider: 'payos', status: 'pending', amount: 1000, createdAt: '2026-10-14T00:00:00Z' });
  await store.payments.insert({ orderCode: 2, provider: 'payos', status: 'paid', amount: 1000, createdAt: '2026-10-14T00:00:01Z' });
  await store.payments.insert({ orderCode: 3, provider: 'vietqr', status: 'paid', amount: 1000, createdAt: '2026-10-14T00:00:02Z' });
  await store.payments.insert({ orderCode: 4, provider: 'evil"}\nx', status: 'paid', amount: 1000, createdAt: '2026-10-14T00:00:03Z' });
  await store.einvoices.set('t1:r1', { state: 'unknown', updatedAt: '2026-10-14T00:00:00Z' });
  await store.einvoices.set('t1:r2', { state: 'done', updatedAt: '2026-10-14T00:00:01Z' });
  await store.einvoices.set('t1:r3', { state: 'done', updatedAt: '2026-10-14T00:00:02Z' });

  const { text } = await call('GET', '/metrics', { headers: A });
  const lines = text.trimEnd().split('\n');
  const declared = new Map();
  for (const line of lines) {
    if (line.startsWith('# HELP ')) continue;
    if (line.startsWith('# TYPE ')) {
      const [, , name, type] = line.split(' ');
      assert.ok(['counter', 'gauge', 'histogram'].includes(type), line);
      declared.set(name, type);
      continue;
    }
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(?:[a-zA-Z_][a-zA-Z0-9_]*="(?:[^"\\\n]|\\.)*",?)*\})? (-?[0-9.e+-]+|\+Inf|NaN)$/.exec(line);
    assert.ok(m, `malformed sample line: ${line}`);
    const family = m[1].replace(/_(bucket|sum|count)$/, '');
    assert.ok(declared.has(m[1]) || declared.get(family) === 'histogram', `sample without TYPE: ${line}`);
  }

  assert.match(text, /hitechpos_http_requests_total\{method="GET",route="\/api\/industries\/:id",status="404"\} 1/);
  assert.match(text, /hitechpos_http_requests_total\{method="GET",route="\/api\/public\/pay\/:tenantId\/:orderCode",status="\d+"\} 1/);
  assert.match(text, /hitechpos_http_requests_total\{method="GET",route="unmatched",status="404"\} 1/);
  assert.match(text, /hitechpos_http_requests_total\{method="POST",route="\/api\/signup",status="201"\} 1/);
  for (const raw of ['raw-industry-xyz', 'tenant-777', '123456789', 'definitely-not-a-route', 'photue']) assert.ok(!text.includes(raw), `raw value ${raw} in metrics`);

  /* histogram: cumulative buckets, +Inf equals _count */
  const bucketLines = lines.filter((l) => l.startsWith('hitechpos_http_request_duration_seconds_bucket{method="GET",route="/api/plans",status="200"'));
  const counts = bucketLines.map((l) => Number(l.split(' ').pop()));
  assert.equal(bucketLines.at(-1).includes('le="+Inf"'), true);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1]);
  assert.match(text, /hitechpos_http_request_duration_seconds_count\{method="GET",route="\/api\/plans",status="200"\} 1/);

  assert.match(text, /hitechpos_tenants\{status="active"\} 1/);
  assert.match(text, /hitechpos_tenants_suspended 0/);
  assert.match(text, /hitechpos_payments\{status="pending",provider="payos"\} 1/);
  assert.match(text, /hitechpos_payments\{status="paid",provider="payos"\} 1/);
  assert.match(text, /hitechpos_payments\{status="paid",provider="vietqr"\} 1/);
  assert.match(text, /hitechpos_payments\{status="paid",provider="other"\} 1/, 'unknown label values are folded');
  assert.match(text, /hitechpos_einvoice_jobs\{state="done"\} 2/);
  assert.match(text, /hitechpos_einvoice_jobs\{state="unknown"\} 1/);
  assert.match(text, /hitechpos_control_db_up 1/);
  assert.match(text, /process_resident_memory_bytes \d+/);
  assert.match(text, /nodejs_eventloop_lag_seconds\{quantile="0.99"\} [0-9.e+-]+/);
  assert.match(text, /hitechpos_process_uptime_seconds [0-9.]+/);
  for (const job of ['expiry', 'reminders', 'einvoice_worker']) assert.match(text, new RegExp(`hitechpos_job_last_success_timestamp_seconds\\{job="${job}"\\} 0`));
});

test('ops: periodic job runs are recorded (admin-triggered and tracked)', async (t) => {
  const fixed = new Date('2026-10-14T03:00:00Z');
  const config = loadConfig({ STORE: 'memory', ADMIN_API_KEY: 'admin-secret-key' });
  const { app, ops } = createApp({ store: createMemoryStore(), config, now: () => fixed, logger: quiet, installer: { async install() {} }, providers: createProviderRegistry([]), ops: { statsTtlMs: 0 } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => { ops.close(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/admin/jobs/enforce-expiry`, { method: 'POST', headers: A })).status, 200);
  ops.declareJob('einvoice_worker', 60000);
  await assert.rejects(ops.trackJob('einvoice_worker', async () => { throw Object.assign(new Error('boom'), { code: 'provider_down' }); }), /boom/);
  assert.deepEqual(await ops.trackJob('reminders', async () => ['x']), ['x']);

  const text = await (await fetch(`${base}/metrics`, { headers: A })).text();
  const epoch = fixed.getTime() / 1000;
  assert.match(text, new RegExp(`hitechpos_job_last_success_timestamp_seconds\\{job="expiry"\\} ${epoch}`));
  assert.match(text, new RegExp(`hitechpos_job_last_success_timestamp_seconds\\{job="reminders"\\} ${epoch}`));
  assert.match(text, /hitechpos_job_last_success_timestamp_seconds\{job="einvoice_worker"\} 0/);
  assert.match(text, new RegExp(`hitechpos_job_last_failure_timestamp_seconds\\{job="einvoice_worker"\\} ${epoch}`));
  assert.match(text, /hitechpos_job_runs_total\{job="einvoice_worker",result="failure"\} 1/);
  assert.match(text, /hitechpos_job_interval_seconds\{job="einvoice_worker"\} 60/);

  const summary = await (await fetch(`${base}/api/admin/ops`, { headers: A })).json();
  assert.equal(summary.jobs.einvoice_worker.lastError, 'provider_down');
  assert.equal(summary.jobs.expiry.lastSuccessAt, fixed.toISOString());
});

test('ops: /api/admin/ops summarises readiness, process, http, tenants, payments, jobs', async (t) => {
  const { call, store } = await start(t);
  assert.equal((await call('GET', '/api/admin/ops')).status, 401);
  await call('POST', '/api/signup', { body: { subdomain: 'tuecafe', businessName: 'Tuệ Cafe', industry: 'nha-hang-quan-an', ownerName: 'T', email: 'c@p.vn', phone: '0912345679', password: 'matkhau123' } });
  const [tenant] = await store.tenants.list();
  await store.tenants.update(tenant._id, { suspended: true });
  await store.payments.insert({ orderCode: 9, provider: 'pay2s', status: 'review', amount: 5000, createdAt: '2026-10-14T00:00:00Z' });
  const r = await call('GET', '/api/admin/ops', { headers: A });
  assert.equal(r.status, 200);
  const s = r.json;
  assert.equal(s.ready.ok, true);
  assert.equal(typeof s.process.uptimeSeconds, 'number');
  assert.ok(s.process.memory.rss > 0);
  assert.equal(typeof s.process.eventLoopLag.p99Ms, 'number');
  assert.ok(s.http.requests >= 2);
  assert.ok(s.http.topRoutes.some((x) => x.route === '/api/signup' && x.method === 'POST'));
  assert.deepEqual([s.tenants.total, s.tenants.suspended, s.tenants.byStatus.active], [1, 1, 1]);
  assert.deepEqual(s.payments.byProvider, { pay2s: { review: 1 } });
  assert.equal(s.payments.byStatus.review, 1);
  assert.deepEqual(Object.keys(s.jobs).sort(), ['einvoice_worker', 'expiry', 'reminders']);
  assert.equal(s.stats.ok, true);
  assert.ok(!r.text.includes('v1:'), 'no sealed secrets');
  assert.ok(!r.text.includes('admin-secret-key'));
});

test('ops: counts fall back to stale figures and report the DB down when a query fails', async () => {
  const store = createMemoryStore();
  await store.tenants.insert({ subdomain: 'a', status: 'active' });
  let broken = false;
  const flaky = { ...store, tenants: { ...store.tenants, list: async (q) => { if (broken) throw new Error('down'); return store.tenants.list(q); } } };
  const ops = createOps({ store: flaky, config: {}, statsTtlMs: 0 });
  try {
    assert.match(await ops.metricsText(), /hitechpos_tenants\{status="active"\} 1/);
    broken = true;
    const text = await ops.metricsText();
    assert.match(text, /hitechpos_control_db_up 0/);
    assert.match(text, /hitechpos_tenants\{status="active"\} 1/, 'last known figures kept');
  } finally {
    ops.close();
  }
});

test('ops: route labels and secret comparison helpers', () => {
  assert.equal(routeLabel({ route: { path: '/x/:id' }, baseUrl: '/api' }, 200), '/api/x/:id');
  assert.equal(routeLabel({ route: { path: /re/ } }, 200), 'other');
  assert.equal(routeLabel({ method: 'GET' }, 200), 'static');
  assert.equal(routeLabel({ method: 'GET' }, 404), 'unmatched');
  assert.equal(routeLabel({ method: 'POST' }, 200), 'unmatched');
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, 'abc'), false);
});

/* Real Mongo aggregation path; runs only when MONGO_TEST_URI is set. */
test('ops: counts and ping through a Mongo control DB', { skip: !process.env.MONGO_TEST_URI && 'MONGO_TEST_URI not set' }, async (t) => {
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.MONGO_TEST_URI, { serverSelectionTimeoutMS: 3000 });
  const db = client.db(`ops_test_ctl_${process.pid}`);
  t.after(async () => { await db.dropDatabase(); await client.close(); });
  await db.collection('tenants').insertMany([{ subdomain: 'a', status: 'active' }, { subdomain: 'b', status: 'active', suspended: true }, { subdomain: 'c', status: 'install_failed', suspended: true }]);
  await db.collection('payments').insertMany([{ orderCode: 1, status: 'paid', provider: 'payos' }, { orderCode: 2, status: 'paid', provider: 'payos' }]);
  await db.collection('einvoices').insertOne({ _id: 't:r', state: 'pending' });
  const ops = createOps({ store: createMemoryStore(), config: {}, controlDb: db, statsTtlMs: 0 });
  t.after(() => ops.close());
  assert.equal((await ops.readiness()).ok, true);
  const text = await ops.metricsText();
  assert.match(text, /hitechpos_tenants\{status="active"\} 2/);
  assert.match(text, /hitechpos_tenants\{status="install_failed"\} 1/);
  assert.match(text, /hitechpos_tenants_suspended 2/);
  assert.match(text, /hitechpos_payments\{status="paid",provider="payos"\} 2/);
  assert.match(text, /hitechpos_einvoice_jobs\{state="pending"\} 1/);
});
