'use strict';

/*
 * Public marketing and legal pages (public/*.html, site.css, site.js,
 * sitemap.xml, robots.txt): served, Vietnamese, self-contained under the
 * CSP, internally linked, and - for the pricing and industry pages - in
 * step with src/plans.js and @hitechpos/industry-presets, so a price,
 * limit or feature change cannot silently leave the pages behind.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory');
const { loadConfig } = require('../src/config');
const { createProviderRegistry } = require('@hitechpos/payment-core');
const { PLANS, CYCLES, quote, getPlan } = require('../src/plans');
const presets = require('@hitechpos/industry-presets');

const PUBLIC = path.join(__dirname, '..', 'public');
const PAGES = ['/bang-gia', '/tinh-nang', '/nganh-nghe', '/dieu-khoan', '/bao-mat'];
const LEGAL = ['/dieu-khoan', '/bao-mat'];
const DRAFT = 'Bản dự thảo – cần bộ phận pháp chế rà soát';
const html = Object.fromEntries(PAGES.map((p) => [p, fs.readFileSync(path.join(PUBLIC, `${p.slice(1)}.html`), 'utf8')]));
const config = loadConfig({ STORE: 'memory' });
const publicPlans = PLANS.filter((p) => p.public);

async function boot() {
  const store = createMemoryStore();
  const { app } = createApp({
    store, config, providers: createProviderRegistry(), logger: { info() {}, warn() {}, error() {} },
    installer: { async install() {} },
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, get: (p) => fetch(base + p, { redirect: 'manual' }) };
}

/* Elements carrying `attr`: their attributes and the text up to the next tag. */
function elementsWith(source, attr) {
  const out = [];
  const re = new RegExp(`<([a-z][a-z0-9]*)\\b([^>]*\\b${attr}\\b[^>]*)>([^<]*)`, 'g');
  for (const m of source.matchAll(re)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    out.push({ tag: m[1], attrs, text: m[3] });
  }
  return out;
}
const digits = (s) => Number(String(s).replace(/\D/g, ''));
const limitText = (v) => (v == null ? 'Không giới hạn' : new Intl.NumberFormat('vi-VN').format(v));
const internalRefs = (source) => [...source.matchAll(/\b(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]);

test('public pages: 200, Vietnamese, titled, shared header and footer', async (t) => {
  const { server, get } = await boot();
  t.after(() => server.close());
  for (const page of PAGES) {
    const res = await get(page);
    assert.equal(res.status, 200, page);
    assert.match(res.headers.get('content-type'), /text\/html/, page);
    assert.match(res.headers.get('content-security-policy') || '', /script-src 'self'/, page);
    const body = await res.text();
    assert.equal(body, html[page], `${page} is served from public/`);
    assert.match(body, /^<!doctype html>\s*<html lang="vi">/i, `${page} lang="vi"`);
    assert.match(body, /<meta charset="utf-8">/, page);
    assert.match(body, /<meta name="viewport"[^>]*width=device-width/, page);
    const title = body.match(/<title>([^<]+)<\/title>/);
    assert.ok(title && title[1].trim().length > 5, `${page} has a <title>`);
    assert.match(body, /<meta name="description" content="[^"]{40,}">/, `${page} has a description`);
    assert.match(body, /<link rel="stylesheet" href="\/site.css">/, page);
    for (const href of [...PAGES, '/', '/help/', '/account', '/#signup', '/source']) {
      assert.ok(body.includes(`href="${href}"`), `${page} links to ${href}`);
    }
    if (!LEGAL.includes(page)) assert.match(body, new RegExp(`<a href="${page}" aria-current="page">`), `${page} marks itself in the menu`);
    assert.match(body, /<main id="noi-dung">/, page);
  }
  for (const [file, type] of [['/site.css', /text\/css/], ['/site.js', /javascript/], ['/sitemap.xml', /xml/], ['/robots.txt', /text\/plain/]]) {
    const res = await get(file);
    assert.equal(res.status, 200, file);
    assert.match(res.headers.get('content-type'), type, file);
  }
});

test('public pages: internal links, assets and anchors resolve', async (t) => {
  const { server, get } = await boot();
  t.after(() => server.close());
  const sitemap = fs.readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8');
  const sitemapPaths = [...sitemap.matchAll(/<loc>https:\/\/app\.hitechpos\.vn(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
  const refs = new Set([...Object.values(html).flatMap(internalRefs), ...sitemapPaths]);

  /* The help center is built separately: its links are checked only once
     /help/ itself is served. */
  const helpLive = (await get('/help/')).status === 200;
  if (!helpLive) t.diagnostic('/help/ is not served yet: links under /help/ were skipped');

  for (const ref of refs) {
    assert.ok(!ref.startsWith('//'), `${ref} is same-origin`);
    const [pathAndQuery, fragment] = ref.split('#');
    const p = pathAndQuery.split('?')[0] || '/';
    if (p.startsWith('/help/') && !helpLive) continue;
    const res = await get(p);
    if (p === '/source') {
      assert.equal(res.status, 302, '/source redirects to the source code');
      assert.match(res.headers.get('location'), /^https:\/\//);
      continue;
    }
    assert.equal(res.status, 200, `${ref} resolves`);
    /* Anchors into pages of this site must exist. */
    if (fragment) {
      const target = html[p] ?? (p === '/' ? fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8') : null);
      if (target) assert.match(target, new RegExp(`id="${fragment}"`), `${ref}: #${fragment} exists`);
    }
  }
  for (const [page, body] of Object.entries(html)) {
    for (const m of body.matchAll(/href="#([^"]+)"/g)) assert.match(body, new RegExp(`id="${m[1]}"`), `${page}: #${m[1]} exists`);
  }
});

test('public pages: no external or inline scripts, styles from self only', () => {
  for (const [page, body] of Object.entries(html)) {
    for (const m of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      const src = (m[1].match(/\bsrc="([^"]*)"/) || [])[1];
      assert.ok(src, `${page}: no inline <script> (CSP)`);
      assert.match(src, /^\/[^/]/, `${page}: script ${src} is served by this origin`);
      assert.equal(m[2].trim(), '', `${page}: script element is empty`);
    }
    assert.doesNotMatch(body, /\son[a-z]+\s*=/i, `${page}: no inline event handlers`);
    assert.doesNotMatch(body, /\sstyle="/, `${page}: no inline style attributes`);
    assert.doesNotMatch(body, /<style\b/, `${page}: styles live in site.css`);
    for (const m of body.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)) assert.match(m[0], /href="\/[^/]/, `${page}: stylesheet is same-origin`);
    for (const m of body.matchAll(/<(?:img|iframe|video|audio|source|embed|object)\b[^>]*\bsrc="([^"]*)"/g)) assert.match(m[1], /^\/[^/]/, `${page}: media ${m[1]} is same-origin`);
  }
  const css = fs.readFileSync(path.join(PUBLIC, 'site.css'), 'utf8');
  assert.doesNotMatch(css, /@import|url\(\s*['"]?(?:https?:)?\/\//, 'site.css loads nothing external');
  const js = fs.readFileSync(path.join(PUBLIC, 'site.js'), 'utf8');
  assert.doesNotMatch(js, /https?:\/\/|innerHTML|eval\(|new Function/, 'site.js stays same-origin and writes text only');
});

test('pricing page: prices, cycles, limits and features match src/plans.js', async (t) => {
  const page = html['/bang-gia'];
  const trial = getPlan('trial');

  assert.deepEqual(elementsWith(page, 'data-plan-card').map((e) => e.attrs['data-plan-card']), publicPlans.map((p) => p.id), 'one card per public plan, in order');
  for (const e of elementsWith(page, 'data-plan-name')) assert.equal(e.text, getPlan(e.attrs['data-plan-name']).name);

  const prices = elementsWith(page, 'data-price');
  for (const e of prices) {
    const { 'data-plan': plan, 'data-months': months } = e.attrs;
    assert.equal(digits(e.text), quote(plan, Number(months)).net, `${plan} × ${months} tháng`);
  }
  for (const p of publicPlans) {
    for (const months of Object.keys(CYCLES)) {
      assert.ok(prices.some((e) => e.attrs['data-plan'] === p.id && e.attrs['data-months'] === months), `price of ${p.id} for ${months} months is shown`);
    }
  }
  for (const e of elementsWith(page, 'data-per-month')) {
    const months = Number(e.attrs['data-months']);
    assert.equal(digits(e.text), Math.round(quote(e.attrs['data-plan'], months).net / months));
  }
  const discounts = elementsWith(page, 'data-discount');
  for (const e of discounts) assert.equal(e.text, `${CYCLES[e.attrs['data-months']]}%`, `discount for ${e.attrs['data-months']} months`);
  for (const months of Object.keys(CYCLES)) assert.ok(discounts.some((e) => e.attrs['data-months'] === months), `discount for ${months} months is shown`);

  const limits = elementsWith(page, 'data-limit');
  for (const e of limits) {
    assert.equal(e.text, limitText(getPlan(e.attrs['data-plan']).limits[e.attrs['data-limit']]), `${e.attrs['data-plan']} ${e.attrs['data-limit']}`);
  }
  const matrixPlans = [trial, ...publicPlans];
  for (const p of matrixPlans) {
    for (const key of Object.keys(p.limits)) assert.ok(limits.some((e) => e.attrs['data-plan'] === p.id && e.attrs['data-limit'] === key), `limit ${key} of ${p.id} is shown`);
  }

  const cells = elementsWith(page, 'data-has');
  const features = new Set(PLANS.flatMap((p) => p.features));
  for (const p of matrixPlans) {
    for (const f of features) {
      const cell = cells.find((e) => e.attrs['data-plan'] === p.id && e.attrs['data-feature'] === f);
      assert.ok(cell, `matrix row ${f} has a ${p.id} cell`);
      const has = p.features.includes(f);
      assert.equal(cell.attrs['data-has'], has ? '1' : '0', `${p.id} ${has ? 'has' : 'lacks'} ${f}`);
      assert.equal(cell.text, has ? '✓' : '–');
    }
  }
  for (const e of cells) assert.ok(features.has(e.attrs['data-feature']), `${e.attrs['data-feature']} is a plan feature`);

  const description = page.match(/<meta name="description" content="([^"]*)">/)[1];
  assert.ok(description.includes(`${trial.trialDays} ngày`), 'description states the trial length');
  assert.ok(description.includes(`${Math.max(...Object.values(CYCLES))}%`), 'description states the top discount');
  for (const p of publicPlans) assert.ok(description.includes(p.name), `description names ${p.name}`);

  /* The page hydrates from the same catalogue (site.js). */
  const { server, get } = await boot();
  t.after(() => server.close());
  const api = await (await get('/api/plans')).json();
  assert.deepEqual(api.plans.map((p) => p.id), publicPlans.map((p) => p.id));
  assert.equal(api.trialDays, trial.trialDays);
});

test('public pages: trial and grace periods match the code everywhere', () => {
  for (const [page, body] of Object.entries(html)) {
    for (const e of elementsWith(body, 'data-trial-days')) assert.equal(Number(e.text), getPlan('trial').trialDays, `${page} trial days`);
    for (const e of elementsWith(body, 'data-grace-days')) assert.equal(Number(e.text), config.graceDays, `${page} grace days`);
  }
  assert.ok(elementsWith(html['/dieu-khoan'], 'data-grace-days').length > 0, 'terms state the grace period');
  assert.ok(elementsWith(html['/bang-gia'], 'data-grace-days').length > 0, 'pricing FAQ states the grace period');
});

test('industries page: one section per preset, availability matches the feature catalogue', () => {
  const page = html['/nganh-nghe'];
  const sections = [...page.matchAll(/<section class="industry" id="([^"]+)" data-preset="([^"]+)"[\s\S]*?<\/section>/g)];
  assert.deepEqual(sections.map((m) => m[2]), presets.PRESET_IDS, 'every preset, in signup order');
  /* Built by HiTechPOS although the upstream catalogue calls it an extension. */
  const built = new Set(['einvoice']);
  const expected = (key) => {
    const s = presets.FEATURE_CATALOG[key].support;
    return s === 'native' || built.has(key) ? 'ok' : s === 'partial' ? 'part' : 'dev';
  };
  for (const [section, id] of sections.map((m) => [m[0], m[2]])) {
    const preset = presets.getPreset(id);
    assert.ok(section.includes(`>${preset.name.replace(/&/g, '&amp;')}</h2>`), `${id} heading`);
    const listed = [];
    for (const ul of section.matchAll(/<ul class="feat" data-status="(ok|part|dev)">([\s\S]*?)<\/ul>/g)) {
      for (const li of ul[2].matchAll(/data-feature="([^"]+)"/g)) {
        listed.push(li[1]);
        assert.equal(ul[1], expected(li[1]), `${id}: ${li[1]} is listed as ${expected(li[1])}`);
      }
    }
    const enabled = presets.FEATURE_KEYS.filter((k) => preset.features[k].enabled);
    assert.deepEqual(listed.slice().sort(), enabled.slice().sort(), `${id}: lists exactly its enabled features`);
  }
  for (const id of presets.PRESET_IDS) assert.ok(html['/tinh-nang'].includes(`href="/nganh-nghe#${id}"`), `features page links ${id}`);
});

test('legal pages: draft banner and contact placeholders', () => {
  for (const page of LEGAL) {
    assert.ok(html[page].includes(DRAFT), `${page} shows the draft banner`);
    assert.match(html[page], /class="ph">\[MST công ty\]/, `${page} leaves the tax code as a placeholder`);
  }
  assert.match(html['/bao-mat'], /Nghị định 13\/2023\/NĐ-CP/);
  assert.match(html['/dieu-khoan'], /pháp luật nước Cộng hoà xã hội chủ nghĩa Việt Nam/);
  for (const page of PAGES) assert.doesNotMatch(html[page], /\b(TODO|lorem ipsum)\b/i, page);
});

test('sitemap.xml and robots.txt', () => {
  const sitemap = fs.readFileSync(path.join(PUBLIC, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /^<\?xml version="1.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  for (const p of ['/', ...PAGES.filter((x) => !LEGAL.includes(x)), '/help/']) assert.ok(sitemap.includes(`<loc>https://app.hitechpos.vn${p}</loc>`), `sitemap lists ${p}`);
  /* Draft legal pages stay out of search until approved. */
  for (const p of LEGAL) assert.ok(!sitemap.includes(`<loc>https://app.hitechpos.vn${p}</loc>`), `sitemap omits draft ${p}`);
  const robots = fs.readFileSync(path.join(PUBLIC, 'robots.txt'), 'utf8');
  assert.match(robots, /^Sitemap: https:\/\/app\.hitechpos\.vn\/sitemap\.xml$/m);
  for (const p of ['/account', '/admin', '/api/', '/pos/', '/webhooks/']) assert.match(robots, new RegExp(`^Disallow: ${p}$`, 'm'), `robots keeps ${p} out`);
  for (const p of PAGES) assert.doesNotMatch(robots, new RegExp(`^Disallow: ${p}$`, 'm'), `robots allows ${p}`);
});
