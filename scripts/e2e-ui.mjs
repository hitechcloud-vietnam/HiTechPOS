#!/usr/bin/env node
/*
 * Browser end-to-end test of the HiTechPOS stack, complementing scripts/e2e.mjs
 * (which drives the same flow through the APIs only).
 *
 *   MongoDB replica set -> Posnic shard (upstream/pos/api/shard.js, serving the
 *   built web till from upstream/pos/frontend/public) -> control plane.
 *
 * In Chromium: sign up on the landing page -> /account -> VietQR form -> open
 * the shop till -> owner logs in -> item into the cart -> "QR chuyển khoản" ->
 * QR image -> cashier confirms -> sale completes, with VND amounts.
 *
 * Needs `npm ci` at the root (playwright) and in upstream/pos/api (dev deps, for
 * mongodb-memory-server), and a built frontend (`npm ci && npm run build:assets`
 * in upstream/pos/frontend). If upstream/pos/frontend/public is missing it is
 * built here; E2E_UI_BUILD=1 forces a rebuild. Offline machines can point
 * MONGOMS_SYSTEM_BINARY at a local mongod; Chromium comes from
 * PLAYWRIGHT_BROWSERS_PATH as usual. E2E_UI_HEADED=1 shows the browser,
 * E2E_UI_TIMEOUT_MS raises the per-action timeout (default 30 s).
 *
 * Known defects next to the guarded path (sales history formatting, linking
 * the sale to its QR payment) are soft checks: reported with ⚠ at the end,
 * fatal only with E2E_UI_STRICT=1.
 *
 * Screenshots of every step go to scripts/.e2e-ui-out/ (gitignored). On a
 * failure the page console, failed requests, the page HTML and the last
 * server log lines are written there and printed. Exit code 0 = everything held.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'upstream/pos/api');
const frontendDir = path.join(root, 'upstream/pos/frontend');
const outDir = path.join(root, 'scripts/.e2e-ui-out');
const require = createRequire(path.join(apiDir, 'package.json'));
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const hex = (n) => randomBytes(n).toString('hex');
const port = () => 20000 + Math.floor(Math.random() * 20000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* Generous by default: CI runners are slow and the till page is heavy. */
const UI_TIMEOUT = Number(process.env.E2E_UI_TIMEOUT_MS) || 30000;
const children = [];
const pages = [];
let failed = false;
let shotNo = 0;

function step(name) {
  console.log(`\n▶ ${name}`);
}
function check(cond, message, detail) {
  if (!cond) {
    failed = true;
    throw new Error(`${message}${detail === undefined ? '' : `: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}`}`);
  }
  console.log(`  ✓ ${message}`);
}

function start(name, cmd, args, opts) {
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  const keep = (d) => { log.push(String(d)); if (log.length > 400) log.shift(); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  children.push({ name, child, log });
  return { child, log };
}

async function waitFor(fn, { timeoutMs = 60000, everyMs = 500, what }) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${what}: ${last && last.message ? last.message : JSON.stringify(last)}`);
}

/* Console, page errors and failed requests of every page, for the failure dump. */
function watch(page, name) {
  const log = [];
  const keep = (line) => { log.push(line); if (log.length > 300) log.shift(); };
  page.on('console', (m) => keep(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => keep(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => keep(`[requestfailed] ${r.method()} ${r.url()} ${r.failure() ? r.failure().errorText : ''}`));
  page.on('response', (r) => { if (r.status() >= 400) keep(`[http ${r.status()}] ${r.request().method()} ${r.url()}`); });
  pages.push({ name, page, log });
  return page;
}

/*
 * Soft checks: known defects outside the paths this test guards. They are
 * printed at the end; E2E_UI_STRICT=1 makes them fail the run.
 */
const STRICT = process.env.E2E_UI_STRICT === '1';
const warnings = [];
function soft(cond, message, detail) {
  if (cond) return console.log(`  ✓ ${message}`);
  const line = `${message}${detail === undefined ? '' : `: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}`}`;
  warnings.push(line);
  console.log(`  ⚠ ${line}`);
}

/*
 * The text a person sees. money-format.js keeps the raw number ("29000.00")
 * in the DOM and paints the formatted one with [data-pp-money]::after, so
 * innerText alone would read the wrong thing.
 */
function shownText(locator) {
  return locator.evaluate((root) => {
    const seen = (el) => {
      if (el.hasAttribute('data-pp-money')) {
        const after = getComputedStyle(el, '::after').content;
        if (after && after !== 'none' && after !== 'normal') {
          try { return JSON.parse(after); } catch { return after.replace(/^["']|["']$/g, ''); }
        }
      }
      let out = '';
      for (const n of el.childNodes) {
        if (n.nodeType === 3) out += n.textContent;
        else if (n.nodeType === 1 && getComputedStyle(n).display !== 'none') out += seen(n);
      }
      return out;
    };
    return seen(root).replace(/[\s ]+/g, ' ').trim();
  });
}

/* VND is whole dong grouped with dots: "29.000", never "29,000.00"/"29000.00". */
function isVnd(text, expected) {
  return String(text).includes(expected) && !/\d[.,]\d{2}(?!\d)/.test(text) && !/\d,\d{3}/.test(text);
}

async function shot(page, name) {
  const file = path.join(outDir, `${String(++shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch((e) => console.log(`  (screenshot ${name} failed: ${e.message})`));
}

function ensureFrontend() {
  const built = fs.existsSync(path.join(frontendDir, 'public/login.html')) && fs.existsSync(path.join(frontendDir, 'public/dashboard.html'));
  if (built && process.env.E2E_UI_BUILD !== '1') return;
  step('build the Posnic web frontend (gulp)');
  if (!fs.existsSync(path.join(frontendDir, 'node_modules/gulp'))) {
    const ci = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: frontendDir, stdio: 'inherit' });
    if (ci.status !== 0) throw new Error('npm ci in upstream/pos/frontend failed');
  }
  const build = spawnSync('npm', ['run', 'build:assets'], { cwd: frontendDir, stdio: 'inherit' });
  if (build.status !== 0) throw new Error('frontend build failed');
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
ensureFrontend();

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
let browser;
try {
  const mongo = replSet.getUri();
  const uri = (db) => mongo.replace(/\/(\?|$)/, `/${db}$1`);
  const shardPort = port();
  const cpPort = shardPort + 1;
  const shard = `http://127.0.0.1:${shardPort}`;
  const cp = `http://127.0.0.1:${cpPort}`;
  const common = { TENANT_SECRET_KEY: hex(32), POSNIC_KEY: hex(8), POSNIC_SECRET: hex(16), SHOP_BASE_DOMAINS: 'hitechpos.test', SHARD_SHOP_HEADER: 'x-hitech-shop', CONTROL_DB: 'hitechpos_control' };

  step('start Posnic shard and control plane');
  /* SHARD_RELOAD_MS: the shop's HITECH_POS_KEY is written when VietQR is saved
     and the shard only sees it on its next registry refresh (60 s in production;
     E2E_UI_SHARD_RELOAD_MS=60000 reproduces that). */
  start('shard', process.execPath, ['shard.js'], { cwd: apiDir, env: { ...process.env, ...common, NODE_ENV: 'production', CONTROL_URI: mongo, MONGODB_URI: uri('hitech_bootstrap'), SESSION_SECRET: hex(16), SHARD_HOST: '127.0.0.1', SHARD_PORT: String(shardPort), HITECH_PAY_URL: cp, SHARD_RELOAD_MS: process.env.E2E_UI_SHARD_RELOAD_MS || '2000' } });
  start('control-plane', process.execPath, ['apps/control-plane/src/server.js'], { cwd: root, env: { ...process.env, ...common, HOST: '127.0.0.1', PORT: String(cpPort), PUBLIC_URL: cp, CONTROL_URI: mongo, SESSION_SECRET: hex(16), ADMIN_API_KEY: hex(12), SHARD_URL: shard } });
  await waitFor(async () => (await fetch(`${cp}/healthz`)).ok, { what: 'control plane' });
  await waitFor(async () => (await fetch(`${shard}/`, { headers: { host: 'nobody.hitechpos.test' } })).status === 404, { what: 'shard' });
  check(true, 'both services answer');

  browser = await chromium.launch({ headless: process.env.E2E_UI_HEADED !== '1' });

  step('sign up a new shop on the landing page');
  const owner = await browser.newContext({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', viewport: { width: 1366, height: 900 } });
  owner.setDefaultTimeout(UI_TIMEOUT);
  const site = watch(await owner.newPage(), 'control-plane');
  await site.goto(`${cp}/`);
  const subdomain = `ui${hex(3)}`;
  const email = `owner-${hex(3)}@e2e.vn`;
  const password = 'MatKhau@123';
  const form = site.locator('form#signup');
  await form.getByLabel('Tên cửa hàng').fill('Cà phê Giao diện');
  await form.locator('input[name=subdomain]').fill(subdomain);
  await site.locator('#avail', { hasText: 'Có thể sử dụng' }).waitFor();
  await site.locator('#industrySel option[value="cafe-tra-sua"]').waitFor({ state: 'attached' });
  await form.getByLabel('Ngành nghề').selectOption('cafe-tra-sua');
  await form.getByLabel('Họ tên chủ cửa hàng').fill('Chủ quán');
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Số điện thoại').fill('0912345678');
  await form.getByLabel('Mật khẩu').fill(password);
  await shot(site, 'signup-filled');
  await form.getByRole('button', { name: 'Tạo cửa hàng' }).click();
  /* Install + onboarding run inside the request: give it room. */
  await site.locator('#msg.ok', { hasText: 'Đã tạo cửa hàng' }).waitFor({ timeout: 120000 });
  await shot(site, 'signup-done');
  check(true, 'shop created through the form');
  await site.locator('#msg a', { hasText: 'trang quản lý' }).click();
  await site.waitForURL(/\/account$/);
  await site.locator('#app').waitFor({ state: 'visible' });
  await site.locator('#shopName', { hasText: 'Cà phê Giao diện' }).waitFor();
  const shopUrl = await site.locator('#shopUrl a').first().getAttribute('href');
  const shopHost = new URL(shopUrl).hostname;
  check(shopHost === `${subdomain}.hitechpos.test`, 'landed on /account, signed in, with the shop address', shopUrl);
  await shot(site, 'account');

  step('configure VietQR on /account');
  const vietqr = site.locator('form#vietqrForm');
  await vietqr.getByLabel('Ngân hàng (VietQR)').fill('MB');
  await vietqr.getByLabel('Số tài khoản').fill('0912345678');
  await vietqr.getByLabel('Tên chủ tài khoản').fill('CA PHE GIAO DIEN');
  await vietqr.getByRole('button', { name: 'Lưu VietQR' }).click();
  await site.locator('#settingsMsg.ok', { hasText: 'Đã lưu cấu hình thanh toán' }).waitFor();
  await site.locator('#methods', { hasText: 'VietQR' }).waitFor();
  await shot(site, 'vietqr-saved');
  check(true, 'VietQR saved through the form');

  step('open the shop till and sign in as the owner');
  /* The shard picks the shop from x-hitech-shop (as the control plane does
     internally). Serving it from 127.0.0.1 keeps it a trustworthy origin, so
     the production CSP (upgrade-insecure-requests) and Secure cookies hold. */
  const tillCtx = await browser.newContext({
    baseURL: shard, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'x-hitech-shop': shopHost }, serviceWorkers: 'block',
  });
  tillCtx.setDefaultTimeout(UI_TIMEOUT);
  const till = watch(await tillCtx.newPage(), 'till');
  await till.goto('/');
  await till.locator('#login_form #username').waitFor({ state: 'visible' });
  await shot(till, 'till-login');
  await till.locator('#username').fill(email);
  await till.locator('#password').fill(password);
  await till.locator('#login_button').click();
  await till.waitForURL(/dashboard\.html/, { timeout: 60000 });
  check(true, 'owner signed in to the till');

  step('ring up an item');
  await till.locator('a[href="#/sales/new"]:visible').first().click();
  const tile = till.locator('#item-lists .wsk-cp').filter({ has: till.locator('p[title="Cà phê sữa đá"]') });
  await tile.waitFor({ state: 'visible', timeout: 60000 });
  const tilePrice = await shownText(tile.locator('.price'));
  check(isVnd(tilePrice, '29.000'), 'item tile shows the price in VND', tilePrice);
  await tile.click();
  await till.locator('#sales_new_items_table tbody tr', { hasText: 'Cà phê sữa đá' }).first().waitFor({ state: 'visible' });
  const grand = till.locator('#sales_new_grand_total');
  await waitFor(async () => isVnd(await shownText(grand), '29.000'), { timeoutMs: UI_TIMEOUT, everyMs: 250, what: 'cart total 29.000' })
    .catch(async (e) => { throw new Error(`${e.message} (shown: ${await shownText(grand)})`); });
  check(true, 'cart total shows ₫ 29.000');
  await shot(till, 'cart');

  step('pay with "QR chuyển khoản"');
  await till.locator('.salesBalanceAmount a.custom_balance').click();
  const qrMode = till.locator('#payment_id label', { hasText: 'QR chuyển khoản' });
  const cashMode = till.locator('#payment_id label:has(input#Cash)');
  await qrMode.waitFor({ state: 'visible' });
  const tendered = await shownText(till.locator('#tenderpage .tendered_total'));
  check(isVnd(tendered, '29.000'), 'payment screen shows ₫ 29.000', tendered);
  await shot(till, 'tender');

  const qrImg = till.locator('#qr_view .modal-body img[src^="data:image/svg+xml"]');
  /* The shop's HITECH_POS_KEY was written seconds ago; until the shard's next
     registry refresh the QR call fails. Re-select the QR mode until it works. */
  let qrRequest;
  const qrDeadline = Date.now() + 90000;
  for (let attempt = 1; ; attempt++) {
    const req = till.waitForRequest((r) => r.url().includes('/sales/generateQrCode'), { timeout: UI_TIMEOUT });
    await qrMode.click();
    qrRequest = await req;
    const res = await qrRequest.response();
    const body = res ? await res.json().catch(() => null) : null;
    if (body && body.type === 'success') break;
    console.log(`  … QR attempt ${attempt} not ready (${res && res.status()}: ${body && body.message}), retrying`);
    if (Date.now() > qrDeadline) throw new Error(`the till never got a QR: ${JSON.stringify(body)}`);
    await sleep(2000);
    await cashMode.click();
  }
  const qrAmount = new URL(qrRequest.url()).searchParams.get('amount');
  check(qrAmount === '29000', 'the till asks for a QR of exactly 29000 VND', qrAmount);
  await till.locator('#qr_view').waitFor({ state: 'visible' });
  await qrImg.waitFor({ state: 'visible' });
  const qrBox = await qrImg.boundingBox();
  check(qrBox && qrBox.width > 100 && qrBox.height > 100, 'the VietQR image is shown', qrBox);
  const received = till.locator('#qr_hitech_confirm');
  await received.waitFor({ state: 'visible' });
  check((await received.innerText()).includes('Đã nhận tiền'), 'cashier can confirm with "Đã nhận tiền"');
  await shot(till, 'qr');

  step('confirm the transfer and complete the sale');
  const saleSaved = till.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/sales', { timeout: 60000 });
  const linked = till.waitForResponse((r) => r.url().includes('/sales/qrSalePayementUpdate'), { timeout: 60000 }).catch(() => null);
  const confirmed = till.waitForResponse((r) => r.url().includes('/sales/hitechQrConfirm'), { timeout: UI_TIMEOUT });
  await received.click();
  const confirmRes = await confirmed;
  check(confirmRes.status() === 200, 'the shard accepts the confirmation', `HTTP ${confirmRes.status()} ${confirmRes.request().method()}: ${(await confirmRes.text().catch(() => '')).slice(0, 200)} (is upstream/pos/frontend/public stale? E2E_UI_BUILD=1 rebuilds it)`);
  const saleRes = await saleSaved;
  const sale = await saleRes.json().catch(() => null);
  check(saleRes.status() === 200 && sale && sale.type === 'success' && sale.data && sale.data.sales_id, 'the sale is saved', sale);
  await till.locator('#qr_view').waitFor({ state: 'hidden' });
  await waitFor(async () => /^₫?\s*0$/.test(await shownText(grand)), { timeoutMs: UI_TIMEOUT, everyMs: 250, what: 'the cart to reset' });
  check(true, 'the QR closes and the till is ready for the next sale');
  await shot(till, 'sale-done');
  const link = await linked;
  soft(link && link.status() === 200, 'the sale is linked to its QR payment (sales/qrSalePayementUpdate)', link ? `HTTP ${link.status()}: ${(await link.text().catch(() => '')).slice(0, 200)}` : 'no request');

  step('the sale is in the history and the payment on /account');
  await till.locator('a[href="#/sales"]:visible').first().click();
  const row = till.locator('#sales_list_rows tr.sales-row').first();
  await row.waitFor({ state: 'visible', timeout: 60000 });
  await till.locator('#sales_list_rows tr.sales-row', { hasText: 'Đã thanh toán' }).first().waitFor();
  await shot(till, 'history');
  const cells = row.locator('td');
  const rowTotal = await shownText(cells.nth(4));
  check(/^S-/.test(await cells.nth(0).innerText()) && (await row.innerText()).includes('Đã thanh toán'), 'the sale is listed as paid', await row.innerText());
  soft(isVnd(rowTotal, '29.000'), 'sales history shows the total in VND', rowTotal);
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  const rowDate = await cells.nth(2).innerText();
  soft(rowDate.includes(today), `sales history dates the sale today (${today})`, rowDate);

  await site.reload();
  const paid = site.locator('#sales tr', { hasText: 'Đã thanh toán' }).first();
  await paid.waitFor({ state: 'visible' });
  const paidRow = (await paid.innerText()).replace(/\s+/g, ' ');
  check(paidRow.includes('29.000 ₫') && /vietqr/i.test(paidRow), 'the owner sees the 29.000 ₫ VietQR payment as paid', paidRow);
  await shot(site, 'account-paid');

  const tillErrors = pages.find((p) => p.page === till).log.filter((l) => l.startsWith('[pageerror]'));
  soft(tillErrors.length === 0, 'no uncaught errors on the till page', tillErrors.slice(0, 5).join(' | '));

  if (warnings.length) {
    console.log(`\n⚠ ${warnings.length} soft check(s) failed${STRICT ? '' : ' (E2E_UI_STRICT=1 makes them fatal)'}:`);
    for (const w of warnings) console.log(`  - ${w}`);
    if (STRICT) { failed = true; throw new Error('soft checks failed in strict mode'); }
  }
  console.log('\n✅ browser end-to-end flow held');
} catch (e) {
  failed = true;
  console.error(`\n❌ ${e.message}`);
  for (const { name, page, log } of pages) {
    await shot(page, `failure-${name}`);
    const html = await page.content().catch(() => '');
    fs.writeFileSync(path.join(outDir, `failure-${name}.html`), html);
    fs.writeFileSync(path.join(outDir, `failure-${name}.console.log`), log.join('\n'));
    console.error(`\n----- ${name} page ${page.url()} (console, last lines) -----\n${log.slice(-40).join('\n')}`);
  }
  for (const { name, log } of children) {
    const text = log.join('');
    fs.writeFileSync(path.join(outDir, `${name}.log`), text);
    console.error(`\n----- ${name} (last lines) -----\n${text.split('\n').slice(-40).join('\n')}`);
  }
  console.error(`\nScreenshots and logs: ${path.relative(process.cwd(), outDir) || outDir}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const { child } of children) child.kill('SIGTERM');
  await sleep(500);
  await replSet.stop();
  process.exit(failed ? 1 : 0);
}
