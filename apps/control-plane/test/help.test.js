'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createProviderRegistry } = require('@hitechpos/payment-core');

const HELP_DIR = path.join(__dirname, '..', 'public', 'help');

/* Every help page and the heading it must open with. */
const PAGES = {
  '/help/': 'Trung tâm trợ giúp',
  '/help/bat-dau': 'Bắt đầu với HiTechPOS',
  '/help/ban-hang': 'Bán hàng tại quầy',
  '/help/thanh-toan-qr': 'Thanh toán QR chuyển khoản',
  '/help/cau-hinh-thanh-toan': 'Cấu hình thanh toán QR',
  '/help/hoa-don-dien-tu': 'Hoá đơn điện tử',
  '/help/goi-cuoc': 'Gói cước và thanh toán phí',
  '/help/ten-mien-rieng': 'Tên miền riêng',
  '/help/tai-khoan': 'Mật khẩu, khoá API và dữ liệu',
  '/help/cau-hoi-thuong-gap': 'Câu hỏi thường gặp',
};

async function boot(t) {
  const { app } = createApp({
    store: createMemoryStore(), config: loadConfig({ STORE: 'memory' }), providers: createProviderRegistry([]),
    installer: { async install() {} }, logger: { warn() {}, error() {}, info() {} },
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const cache = new Map();
  /* GET once per path; returns { status, type, body }. */
  const get = async (p) => {
    if (!cache.has(p)) {
      const res = await fetch(base + p);
      cache.set(p, { status: res.status, type: res.headers.get('content-type') || '', csp: res.headers.get('content-security-policy') || '', body: await res.text() });
    }
    return cache.get(p);
  };
  return { get };
}

const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const hrefs = (html) => [...html.matchAll(/\shref="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
/* Heading text for comparison: tags dropped until none are left. */
const decode = (s) => {
  let prev;
  do { prev = s; s = s.replace(/<[^>]*>/g, ''); } while (s !== prev);
  return s.replace(/&amp;/g, '&').trim();
};

test('every help page is served with its heading, assets and no inline script', async (t) => {
  const { get } = await boot(t);
  const files = fs.readdirSync(HELP_DIR).filter((f) => f.endsWith('.html')).map((f) => (f === 'index.html' ? '/help/' : `/help/${f.slice(0, -5)}`));
  assert.deepEqual(files.sort(), Object.keys(PAGES).sort(), 'PAGES lists every help page on disk');

  for (const [route, heading] of Object.entries(PAGES)) {
    const res = await get(route);
    assert.equal(res.status, 200, route);
    assert.match(res.type, /text\/html/, route);
    assert.match(res.body, /<html lang="vi">/, route);
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(res.body);
    assert.ok(h1, `${route} has an h1`);
    assert.equal(decode(h1[1]), heading, route);
    assert.equal((res.body.match(/<h1[\s>]/g) || []).length, 1, `${route} has one h1`);
    /* CSP-friendly: scripts only from files, no inline handlers. */
    for (const tag of res.body.match(/<script\b[^>]*>/gi) || []) assert.match(tag, /\ssrc="\/help\/help\.js"/, `${route}: ${tag}`);
    assert.doesNotMatch(res.body, /\son[a-z]+="/, `${route} has no inline event handlers`);
    assert.match(res.body, /href="\/help\/help\.css"/, route);
    assert.match(res.csp, /script-src 'self'/, route);
  }
  assert.equal((await get('/help')).status, 200, '/help redirects to the index');
  const css = await get('/help/help.css');
  assert.equal(css.status, 200);
  assert.match(css.type, /text\/css/);
  assert.match(css.body, /prefers-color-scheme: dark/);
  const js = await get('/help/help.js');
  assert.equal(js.status, 200);
  assert.match(js.type, /javascript/);
});

test('every internal link between help pages resolves, anchors included', async (t) => {
  const { get } = await boot(t);
  let checked = 0;
  for (const route of Object.keys(PAGES)) {
    const page = await get(route);
    const own = ids(page.body);
    for (const href of hrefs(page.body)) {
      if (/^(https?:|mailto:)/.test(href)) continue;
      const target = new URL(href, `http://x${route}`);
      if (target.pathname === '/source') continue; /* redirect to the external repository */
      const res = await get(target.pathname);
      assert.equal(res.status, 200, `${route} -> ${href}`);
      if (target.hash) {
        const anchor = decodeURIComponent(target.hash.slice(1));
        const set = target.pathname === new URL(route, 'http://x').pathname ? own : ids(res.body);
        assert.ok(set.has(anchor), `${route} -> ${href}: #${anchor} exists`);
      }
      checked += 1;
    }
  }
  assert.ok(checked > 100, `checked ${checked} links`);
});

test('the search index points at real pages and sections', async (t) => {
  const { get } = await boot(t);
  const res = await get('/help/search-index.json');
  assert.equal(res.status, 200);
  assert.match(res.type, /application\/json/);
  const rows = JSON.parse(res.body);
  assert.ok(rows.length >= Object.keys(PAGES).length - 1);
  const pages = new Set();
  for (const row of rows) {
    assert.equal(typeof row.t, 'string');
    assert.ok(row.t.length > 0);
    assert.equal(typeof row.x, 'string');
    const target = new URL(row.u, 'http://x');
    assert.match(target.pathname, /^\/help\/[a-z-]+$/, row.u);
    const page = await get(target.pathname);
    assert.equal(page.status, 200, row.u);
    if (target.hash) assert.ok(ids(page.body).has(target.hash.slice(1)), `${row.u} anchor exists`);
    pages.add(target.pathname);
  }
  assert.deepEqual([...pages].sort(), Object.keys(PAGES).filter((p) => p !== '/help/').sort(), 'every topic page is searchable');
  assert.ok(rows.some((r) => r.t === 'Ký hiệu mẫu số và ký hiệu hoá đơn' && r.x.includes('1C26MAA')));
});

test('the signup and account pages link to the help center', async (t) => {
  const { get } = await boot(t);
  for (const route of ['/', '/account']) {
    const res = await get(route);
    assert.equal(res.status, 200, route);
    assert.match(res.body, /href="\/help\/"[^>]*>Trợ giúp</, route);
  }
});

test('the gateway returnUrl /billing/return lands on a page that leads back to /account', async (t) => {
  const { get } = await boot(t);
  const res = await get('/billing/return?orderCode=1791966752534703');
  assert.equal(res.status, 200);
  assert.match(res.body, /href="\/account"/);
  assert.match(res.body, /<script src="\/billing\/return\.js"><\/script>/);
  assert.equal((await get('/billing/return.js')).status, 200);
});
