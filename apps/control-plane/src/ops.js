'use strict';

const crypto = require('node:crypto');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { nodeHttpTransport } = require('./http-transport');

/*
 * Operations surface of the control plane:
 *
 *   GET /readyz          readiness: control DB ping and (optionally) the
 *                        shard, each under a short timeout. 200 or 503 with
 *                        a JSON detail of fixed codes - never a URI, host or
 *                        driver message, which may carry credentials.
 *   GET /metrics         Prometheus text exposition (0.0.4), hand-written so
 *                        the control plane needs no metrics dependency.
 *                        Authorised by `Authorization: Bearer METRICS_TOKEN`
 *                        or the admin key.
 *   GET /api/admin/ops   the same figures as JSON for the admin page.
 *
 * HTTP metrics are labelled by the Express route template ("/pos/v1/payments/
 * :orderCode"), never by the raw URL, so neither shop ids, order codes nor
 * anything a client typed reaches a label. Requests that matched no route are
 * "static" (served file) or "unmatched".
 *
 * Counts by status come from the control DB with one $group per collection
 * when a Mongo `controlDb` handle is given (server.js), otherwise from the
 * store's list() (memory store; on Mongo that list is capped, so it is only a
 * fallback). They are cached for `statsTtlMs` so a scrape every few seconds
 * does not scan `payments` every time.
 */

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
/* Periodic jobs started by server.js; always reported, 0 = never ran. */
const KNOWN_JOBS = ['expiry', 'reminders', 'einvoice_worker'];
const LAG_WINDOW_MS = 60000;

/* Label values from stored documents are our own vocabularies; anything
   else is folded into "other" rather than exposed. */
const vocab = (v) => (typeof v === 'string' && /^[a-z0-9_-]{1,40}$/i.test(v) ? v : v == null || v === '' ? 'none' : 'other');
const escapeLabel = (v) => String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const labels = (obj) => {
  const parts = Object.entries(obj).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
};
const num = (v) => (Number.isFinite(v) ? String(v) : v === Infinity ? '+Inf' : 'NaN');

/* Constant-time comparison that does not leak the secret's length. */
function safeEqual(a, b) {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return typeof a === 'string' && typeof b === 'string' && crypto.timingSafeEqual(h(a), h(b));
}

function routeLabel(req, status) {
  const route = req.route && req.route.path;
  if (typeof route === 'string') return `${req.baseUrl || ''}${route}` || '/';
  if (route) return 'other';
  return (req.method === 'GET' || req.method === 'HEAD') && status < 400 ? 'static' : 'unmatched';
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
  });
  return Promise.race([Promise.resolve().then(() => promise), timeout]).finally(() => clearTimeout(timer));
}

/*
 * options:
 *   store, config, now          as createApp
 *   controlDb                   mongodb Db of the control database (optional)
 *   ping                        async () => void, overrides the DB probe
 *   shardProbe                  async () => { status }, overrides the shard probe
 *   statsTtlMs                  cache for counts (default 15000)
 */
function createOps({ store, config = {}, now = () => new Date(), controlDb = null, ping, shardProbe, statsTtlMs = 15000 } = {}) {
  const opsConfig = config.ops || {};
  const timeoutMs = opsConfig.readyzTimeoutMs || 1500;
  const startedAt = Date.now() - process.uptime() * 1000;

  /* ---- HTTP request metrics -------------------------------------------- */
  const series = new Map();
  function observe(method, route, status, seconds) {
    const key = `${method}\u0000${route}\u0000${status}`;
    let s = series.get(key);
    if (!s) {
      s = { method, route, status, count: 0, sum: 0, buckets: new Array(BUCKETS.length).fill(0) };
      series.set(key, s);
    }
    s.count += 1;
    s.sum += seconds;
    for (let i = 0; i < BUCKETS.length; i++) if (seconds <= BUCKETS[i]) s.buckets[i] += 1;
  }
  function httpMetrics(req, res, next) {
    const start = process.hrtime.bigint();
    res.once('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const status = res.statusCode;
      observe(METHODS.has(req.method) ? req.method : 'OTHER', routeLabel(req, status), String(status), seconds);
    });
    next();
  }

  /* ---- event loop lag ---------------------------------------------------- */
  const LAG_RESOLUTION_MS = 20;
  const lag = monitorEventLoopDelay({ resolution: LAG_RESOLUTION_MS });
  lag.enable();
  let lagResetAt = Date.now();
  /* The histogram records the time between samples; the lag is what exceeds
     the sampling interval. */
  function eventLoop() {
    const ms = (ns) => (lag.count > 0 && Number.isFinite(ns) ? Math.max(0, Math.round((ns / 1e6 - LAG_RESOLUTION_MS) * 1000) / 1000) : 0);
    const out = {
      meanMs: ms(lag.mean), maxMs: ms(lag.max),
      p50Ms: ms(lag.percentile(50)), p90Ms: ms(lag.percentile(90)), p99Ms: ms(lag.percentile(99)),
    };
    /* A rolling window: figures cover at least the last minute. */
    if (Date.now() - lagResetAt >= LAG_WINDOW_MS) {
      lag.reset();
      lagResetAt = Date.now();
    }
    return out;
  }

  /* ---- periodic jobs ----------------------------------------------------- */
  const jobs = new Map();
  const job = (name) => {
    if (!jobs.has(name)) jobs.set(name, { intervalMs: null, running: false, runs: 0, failures: 0, lastSuccessAt: null, lastFailureAt: null, lastDurationMs: null, lastError: null });
    return jobs.get(name);
  };
  for (const name of KNOWN_JOBS) job(name);
  function declareJob(name, intervalMs) {
    job(name).intervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : null;
  }
  /* Runs fn and records the outcome; the result or error passes through. */
  async function trackJob(name, fn) {
    const j = job(name);
    const t0 = Date.now();
    j.running = true;
    try {
      const result = await fn();
      j.runs += 1;
      j.lastSuccessAt = now().toISOString();
      return result;
    } catch (e) {
      j.runs += 1;
      j.failures += 1;
      j.lastFailureAt = now().toISOString();
      j.lastError = e && typeof e.code === 'string' && /^[a-z0-9_]{1,64}$/.test(e.code) ? e.code : 'error';
      throw e;
    } finally {
      j.running = false;
      j.lastDurationMs = Date.now() - t0;
    }
  }

  /* ---- readiness --------------------------------------------------------- */
  const pingDb = ping || (controlDb
    ? () => controlDb.command({ ping: 1 })
    : () => store.tenants.findOne({ _id: '__readyz__' }));
  const shardUrl = config.shardUrl || null;
  const shardEnabled = !!shardUrl && opsConfig.readyzShard !== false;
  /* The shard answers 404 for a host it does not serve after consulting its
     registry, and 500 when that lookup fails; any answer below 500 is ready. */
  const probeShard = shardProbe || (async () => {
    const res = await nodeHttpTransport(`${shardUrl}/`, { headers: { host: 'readyz.invalid' }, signal: AbortSignal.timeout(timeoutMs) });
    await res.arrayBuffer().catch(() => null);
    return { status: res.status };
  });
  async function check(fn, interpret = () => ({ ok: true })) {
    const t0 = Date.now();
    try {
      const value = await withTimeout(fn(), timeoutMs);
      return { ...interpret(value), ms: Date.now() - t0 };
    } catch (e) {
      const code = e && (e.code === 'timeout' || e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'unreachable';
      return { ok: false, error: code, ms: Date.now() - t0 };
    }
  }
  let dbUp = null;
  async function readiness() {
    const [db, shard] = await Promise.all([
      check(pingDb),
      shardEnabled
        ? check(probeShard, (r) => (r && r.status < 500 ? { ok: true, status: r.status } : { ok: false, error: `http_${vocab(String(r && r.status))}`, status: r && r.status }))
        : Promise.resolve(null),
    ]);
    dbUp = db.ok;
    const checks = { controlDb: db, ...(shard ? { shard } : {}) };
    return { ok: Object.values(checks).every((c) => c.ok), checks };
  }

  /* ---- counts from the control DB --------------------------------------- */
  async function countsFromDb() {
    const group = (name, id) => controlDb.collection(name).aggregate([{ $group: { _id: id, n: { $sum: 1 } } }], { maxTimeMS: 5000 }).toArray();
    const [t, p, e] = await Promise.all([
      group('tenants', { status: '$status', suspended: '$suspended' }),
      group('payments', { status: '$status', provider: '$provider' }),
      group('einvoices', { state: '$state' }),
    ]);
    return {
      tenants: t.map((r) => ({ status: r._id.status, suspended: !!r._id.suspended, n: r.n })),
      payments: p.map((r) => ({ status: r._id.status, provider: r._id.provider, n: r.n })),
      einvoices: e.map((r) => ({ state: r._id.state, n: r.n })),
    };
  }
  async function countsFromStore() {
    const tally = (rows, keyOf) => {
      const m = new Map();
      for (const r of rows) {
        const k = keyOf(r);
        const id = JSON.stringify(k);
        if (!m.has(id)) m.set(id, { ...k, n: 0 });
        m.get(id).n += 1;
      }
      return [...m.values()];
    };
    const [t, p, e] = await Promise.all([
      store.tenants.list(),
      store.payments && store.payments.list ? store.payments.list() : [],
      store.einvoices && store.einvoices.list ? store.einvoices.list() : [],
    ]);
    return {
      tenants: tally(t, (r) => ({ status: r.status, suspended: !!r.suspended })),
      payments: tally(p, (r) => ({ status: r.status, provider: r.provider })),
      einvoices: tally(e, (r) => ({ state: r.state })),
    };
  }
  let cache = null;
  let inflight = null;
  async function counts() {
    if (cache && Date.now() - cache.at < statsTtlMs) return cache;
    if (!inflight) {
      inflight = withTimeout(controlDb ? countsFromDb() : countsFromStore(), 10000)
        .then((c) => {
          dbUp = true;
          cache = { ...c, ok: true, at: Date.now(), generatedAt: now().toISOString() };
          return cache;
        })
        .catch(() => {
          dbUp = false;
          /* Stale figures are better than none, but say they are stale. */
          return cache ? { ...cache, ok: false } : { tenants: [], payments: [], einvoices: [], ok: false, at: 0, generatedAt: null };
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  /* ---- views ------------------------------------------------------------- */
  const sumBy = (rows, key) => rows.reduce((acc, r) => {
    const k = vocab(r[key]);
    acc[k] = (acc[k] || 0) + r.n;
    return acc;
  }, {});

  function processInfo() {
    const mem = process.memoryUsage();
    return {
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: new Date(startedAt).toISOString(),
      node: process.version,
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external },
      eventLoopLag: eventLoop(),
    };
  }

  function jobsView() {
    const out = {};
    for (const [name, j] of jobs) out[name] = { ...j };
    return out;
  }

  async function summary() {
    const [ready, c] = await Promise.all([readiness(), counts()]);
    let requests = 0;
    let errors = 0;
    const byRoute = new Map();
    for (const s of series.values()) {
      requests += s.count;
      if (Number(s.status) >= 500) errors += s.count;
      const k = `${s.method} ${s.route}`;
      const r = byRoute.get(k) || { method: s.method, route: s.route, count: 0, errors5xx: 0, sumSeconds: 0 };
      r.count += s.count;
      r.sumSeconds += s.sum;
      if (Number(s.status) >= 500) r.errors5xx += s.count;
      byRoute.set(k, r);
    }
    const routes = [...byRoute.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .map(({ sumSeconds, ...r }) => ({ ...r, avgMs: r.count ? Math.round((sumSeconds / r.count) * 10000) / 10 : 0 }));
    const suspended = c.tenants.filter((r) => r.suspended).reduce((a, r) => a + r.n, 0);
    const payments = {};
    for (const r of c.payments) {
      const p = vocab(r.provider);
      payments[p] = payments[p] || {};
      payments[p][vocab(r.status)] = (payments[p][vocab(r.status)] || 0) + r.n;
    }
    return {
      generatedAt: now().toISOString(),
      ready,
      process: processInfo(),
      http: { requests, errors5xx: errors, topRoutes: routes },
      stats: { ok: c.ok, generatedAt: c.generatedAt },
      tenants: { total: c.tenants.reduce((a, r) => a + r.n, 0), suspended, byStatus: sumBy(c.tenants, 'status') },
      payments: { total: c.payments.reduce((a, r) => a + r.n, 0), byStatus: sumBy(c.payments, 'status'), byProvider: payments },
      einvoices: { byState: sumBy(c.einvoices, 'state') },
      jobs: jobsView(),
    };
  }

  async function metricsText() {
    const c = await counts();
    const lines = [];
    const metric = (name, type, help, rows) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      for (const [l, v] of rows) lines.push(`${name}${labels(l)} ${num(v)}`);
    };
    const mem = process.memoryUsage();
    const el = eventLoop();
    metric('hitechpos_process_uptime_seconds', 'gauge', 'Seconds since the control plane process started.', [[{}, Math.round(process.uptime() * 1000) / 1000]]);
    metric('process_start_time_seconds', 'gauge', 'Start time of the process since unix epoch in seconds.', [[{}, Math.round(startedAt / 1000)]]);
    metric('process_resident_memory_bytes', 'gauge', 'Resident memory size in bytes.', [[{}, mem.rss]]);
    metric('nodejs_heap_used_bytes', 'gauge', 'V8 heap used in bytes.', [[{}, mem.heapUsed]]);
    metric('nodejs_heap_total_bytes', 'gauge', 'V8 heap total in bytes.', [[{}, mem.heapTotal]]);
    metric('nodejs_external_memory_bytes', 'gauge', 'Memory of C++ objects bound to JavaScript in bytes.', [[{}, mem.external]]);
    metric('nodejs_eventloop_lag_seconds', 'gauge', 'Event loop delay over the last minute or more, by quantile.', [
      [{ quantile: '0.5' }, el.p50Ms / 1000], [{ quantile: '0.9' }, el.p90Ms / 1000], [{ quantile: '0.99' }, el.p99Ms / 1000],
    ]);
    metric('nodejs_eventloop_lag_max_seconds', 'gauge', 'Maximum event loop delay over the same window.', [[{}, el.maxMs / 1000]]);
    metric('nodejs_version_info', 'gauge', 'Node.js version.', [[{ version: process.version }, 1]]);

    const http = [...series.values()].sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : a.method < b.method ? -1 : a.status < b.status ? -1 : 1));
    metric('hitechpos_http_requests_total', 'counter', 'HTTP requests by method, route template and status.',
      http.map((s) => [{ method: s.method, route: s.route, status: s.status }, s.count]));
    lines.push('# HELP hitechpos_http_request_duration_seconds HTTP request duration by method, route template and status.', '# TYPE hitechpos_http_request_duration_seconds histogram');
    for (const s of http) {
      const base = { method: s.method, route: s.route, status: s.status };
      BUCKETS.forEach((le, i) => lines.push(`hitechpos_http_request_duration_seconds_bucket${labels({ ...base, le: String(le) })} ${s.buckets[i]}`));
      lines.push(`hitechpos_http_request_duration_seconds_bucket${labels({ ...base, le: '+Inf' })} ${s.count}`);
      lines.push(`hitechpos_http_request_duration_seconds_sum${labels(base)} ${num(Math.round(s.sum * 1e6) / 1e6)}`);
      lines.push(`hitechpos_http_request_duration_seconds_count${labels(base)} ${s.count}`);
    }

    metric('hitechpos_control_db_up', 'gauge', 'Whether the last control DB query or ping succeeded.', [[{}, dbUp === false || !c.ok ? 0 : 1]]);
    metric('hitechpos_stats_generated_timestamp_seconds', 'gauge', 'When the counts below were read from the control DB.', [[{}, c.at ? Math.round(c.at / 1000) : 0]]);
    metric('hitechpos_tenants', 'gauge', 'Shops by status.', Object.entries(sumBy(c.tenants, 'status')).map(([status, n]) => [{ status }, n]));
    metric('hitechpos_tenants_suspended', 'gauge', 'Shops currently suspended.', [[{}, c.tenants.filter((r) => r.suspended).reduce((a, r) => a + r.n, 0)]]);
    const pay = new Map();
    for (const r of c.payments) {
      const k = `${vocab(r.status)}\u0000${vocab(r.provider)}`;
      pay.set(k, (pay.get(k) || 0) + r.n);
    }
    metric('hitechpos_payments', 'gauge', 'Payments in the journal by status and provider.',
      [...pay].map(([k, n]) => {
        const [status, provider] = k.split('\u0000');
        return [{ status, provider }, n];
      }));
    metric('hitechpos_einvoice_jobs', 'gauge', 'E-invoice issue guard rows by state (pending, done, unknown).', Object.entries(sumBy(c.einvoices, 'state')).map(([state, n]) => [{ state }, n]));

    const ts = (iso) => (iso ? Math.round(Date.parse(iso) / 1000) : 0);
    const js = [...jobs];
    metric('hitechpos_job_last_success_timestamp_seconds', 'gauge', 'Last successful run of a periodic job (0 = never since start).', js.map(([job, j]) => [{ job }, ts(j.lastSuccessAt)]));
    metric('hitechpos_job_last_failure_timestamp_seconds', 'gauge', 'Last failed run of a periodic job (0 = never since start).', js.map(([job, j]) => [{ job }, ts(j.lastFailureAt)]));
    metric('hitechpos_job_last_duration_seconds', 'gauge', 'Duration of the last run of a periodic job.', js.map(([job, j]) => [{ job }, (j.lastDurationMs || 0) / 1000]));
    metric('hitechpos_job_interval_seconds', 'gauge', 'Configured interval of a periodic job (0 = not scheduled in this process).', js.map(([job, j]) => [{ job }, (j.intervalMs || 0) / 1000]));
    metric('hitechpos_job_runs_total', 'counter', 'Runs of a periodic job by result.', js.flatMap(([job, j]) => [[{ job, result: 'success' }, j.runs - j.failures], [{ job, result: 'failure' }, j.failures]]));
    return `${lines.join('\n')}\n`;
  }

  /* ---- routes ------------------------------------------------------------ */
  function mount(app, { admin }) {
    const metricsAuth = (req, res, next) => {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (opsConfig.metricsToken && token && safeEqual(token, opsConfig.metricsToken)) return next();
      return admin(req, res, next);
    };
    app.get('/readyz', async (_req, res) => {
      const r = await readiness();
      res.set('cache-control', 'no-store').status(r.ok ? 200 : 503).json(r);
    });
    app.get('/metrics', metricsAuth, async (_req, res) => {
      res.set('cache-control', 'no-store').type('text/plain; version=0.0.4; charset=utf-8').send(await metricsText());
    });
    app.get('/api/admin/ops', admin, async (_req, res) => res.set('cache-control', 'no-store').json(await summary()));
  }

  return { httpMetrics, mount, readiness, metricsText, summary, trackJob, declareJob, close: () => lag.disable() };
}

module.exports = { createOps, routeLabel, safeEqual, BUCKETS };
