#!/usr/bin/env node
/*
 * End-to-end smoke test of the whole HiTechPOS stack:
 *   MongoDB replica set -> Posnic shard (upstream/pos/api/shard.js)
 *   -> control plane (apps/control-plane) -> Posnic till API.
 *
 * signup -> install + Vietnamese onboarding -> VietQR settings -> QR from the
 * till's own endpoint -> cashier confirms -> sale -> automatic e-invoice.
 *
 * Needs `npm ci` at the root and in upstream/pos/api (dev deps, for
 * mongodb-memory-server). Offline machines can point MONGOMS_SYSTEM_BINARY at
 * a local mongod. Exit code 0 = everything held.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'upstream/pos/api');
const require = createRequire(path.join(apiDir, 'package.json'));
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const hex = (n) => randomBytes(n).toString('hex');
const port = () => 20000 + Math.floor(Math.random() * 20000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
let failed = false;

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

async function json(method, url, body, headers = {}) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
try {
  const mongo = replSet.getUri();
  const uri = (db) => mongo.replace(/\/(\?|$)/, `/${db}$1`);
  const shardPort = port();
  const cpPort = shardPort + 1;
  const shard = `http://127.0.0.1:${shardPort}`;
  const cp = `http://127.0.0.1:${cpPort}`;
  const common = { TENANT_SECRET_KEY: hex(32), POSNIC_KEY: hex(8), POSNIC_SECRET: hex(16), SHOP_BASE_DOMAINS: 'hitechpos.test', SHARD_SHOP_HEADER: 'x-hitech-shop', CONTROL_DB: 'hitechpos_control' };

  step('start Posnic shard and control plane');
  start('shard', process.execPath, ['shard.js'], { cwd: apiDir, env: { ...process.env, ...common, NODE_ENV: 'production', CONTROL_URI: mongo, MONGODB_URI: uri('hitech_bootstrap'), SESSION_SECRET: hex(16), SHARD_HOST: '127.0.0.1', SHARD_PORT: String(shardPort), HITECH_PAY_URL: cp } });
  start('control-plane', process.execPath, ['apps/control-plane/src/server.js'], { cwd: root, env: { ...process.env, ...common, HOST: '127.0.0.1', PORT: String(cpPort), PUBLIC_URL: cp, CONTROL_URI: mongo, SESSION_SECRET: hex(16), ADMIN_API_KEY: hex(12), SHARD_URL: shard, EINVOICE_WORKER_INTERVAL_MS: '2000' } });
  await waitFor(async () => (await fetch(`${cp}/healthz`)).ok, { what: 'control plane' });
  await waitFor(async () => (await fetch(`${shard}/`, { headers: { host: 'nobody.hitechpos.test' } })).status === 404, { what: 'shard' });
  check(true, 'both services answer');

  step('signup installs and onboards a Vietnamese cafe');
  const email = `owner-${hex(3)}@e2e.vn`;
  const password = 'MatKhau@123';
  const signup = await json('POST', `${cp}/api/signup`, { subdomain: `e2e${hex(3)}`, businessName: 'Cà phê E2E', industry: 'cafe-tra-sua', ownerName: 'Chủ quán', email, phone: '0912345678', password });
  check(signup.status === 201, 'signup succeeded', signup.data);
  const shop = signup.data.tenant;
  check(shop.status === 'active', 'shop is active');
  const owner = { authorization: `Bearer ${signup.data.token}` };
  const shopHeader = { 'x-hitech-shop': `${shop.subdomain}.hitechpos.test` };

  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(mongo);
  const tenant = await client.db('hitechpos_control').collection('tenants').findOne({ subdomain: shop.subdomain });
  const failedSteps = Object.entries(tenant.onboarding || {}).filter(([k, v]) => !['at', 'preset'].includes(k) && v !== 'ok');
  check(failedSteps.length === 0, 'every onboarding step is ok', tenant.onboarding);
  const shopDb = client.db(tenant.tenantDb);
  const taxes = (await shopDb.collection('grouptax').find().toArray()).map((t) => t.name).sort();
  check(taxes.includes('Thuế GTGT 8%') && taxes.includes('KCT-Không chịu thuế'), 'Vietnamese VAT taxes exist', taxes);
  check((await shopDb.collection('items').countDocuments()) >= 5, 'Vietnamese sample items exist');
  check(!!(await shopDb.collection('app_limits').findOne({ _id: 'limits' })), 'plan limits were written to the shop');

  step('owner enables VietQR and automatic e-invoices');
  const settings = await json('PUT', `${cp}/api/shop/payment-settings`, { vietqr: { bank: 'MB', accountNumber: '0912345678', accountName: 'Ca phe E2E' } }, owner);
  check(settings.status === 200 && settings.data.methods.includes('vietqr'), 'VietQR configured', settings.data);
  const yy = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Ho_Chi_Minh', year: '2-digit' }).format(new Date());
  const ei = await json('PUT', `${cp}/api/shop/einvoice-settings`, { provider: 'mock', seller: { taxCode: '0100109106', name: 'Công ty TNHH E2E', address: '1 Tràng Tiền, Hà Nội' }, series: `1C${yy}MAA`, autoIssue: true }, owner);
  check(ei.status === 200, 'e-invoice settings saved', ei.data);

  step('cashier signs in to the till and takes a QR payment');
  const login = await json('POST', `${shard}/api/users/verify`, { username: email, password }, shopHeader);
  check(login.status === 200 && login.data.data && login.data.data.jwt_token, 'till login', login.data);
  const till = { ...shopHeader, authorization: `Bearer ${login.data.data.jwt_token}` };
  /* The shard reloads shop secrets every 60 s; HITECH_POS_KEY was just added. */
  const qr = await waitFor(async () => {
    const r = await json('GET', `${shard}/api/sales/generateQrCode?amount=58000`, undefined, till);
    return r.status === 200 && r.data.type === 'success' ? r.data.data : null;
  }, { timeoutMs: 90000, everyMs: 3000, what: 'QR from the till (shard secret reload)' });
  check(/^htp_\d+$/.test(qr.id) && String(qr.image_url).startsWith('data:image/svg+xml'), 'till shows a HiTechPOS VietQR', qr);
  let status = await json('GET', `${shard}/api/sales/getQrStatus?id=${qr.id}`, undefined, till);
  check(status.data.data.payment !== 'captured', 'not paid before confirmation');
  const confirm = await json('GET', `${shard}/api/sales/hitechQrConfirm?id=${qr.id}`, undefined, till);
  check(confirm.status === 200, 'cashier confirms the transfer', confirm.data);
  status = await json('GET', `${shard}/api/sales/getQrStatus?id=${qr.id}`, undefined, till);
  check(status.data.data.payment === 'captured' && status.data.data.qr_code === 'closed', 'till sees the payment captured', status.data);

  step('a sale on the till is invoiced automatically');
  const item = await shopDb.collection('items').findOne({ name: 'Cà phê sữa đá' });
  const walkIn = await shopDb.collection('customers').findOne({});
  const sale = await json('POST', `${shard}/api/sales`, {
    items: [{ item_id: String(item._id), item_quantity: 2, item_status: 'Add', item_price_total: 29000, item_unit: item.unit || 'qty', sale_inline_discount_value: 0 }],
    customer_id: walkIn ? String(walkIn._id) : '', customer_name: walkIn ? walkIn.customer_name || walkIn.name || '' : '',
    payment_mode: 'Cash', unpaid: 'false', partial_check: 'false', extra_discount: 0, extra_discount_type: 'price', sale_process: 'Add', multi_payment: { Cash: 58000 },
  }, till);
  check(sale.status === 200 && sale.data.type === 'success', 'sale saved on the till', sale.data);
  const invoices = await waitFor(async () => {
    const r = await json('GET', `${cp}/api/shop/einvoices`, undefined, owner);
    return Array.isArray(r.data) && r.data.length ? r.data : null;
  }, { timeoutMs: 30000, everyMs: 1000, what: 'automatic e-invoice' });
  check(invoices.length === 1 && invoices[0].state === 'done' && invoices[0].invoiceNo, 'one e-invoice issued for the sale', invoices);

  await client.close();
  console.log('\n✅ end-to-end flow held');
} catch (e) {
  failed = true;
  console.error(`\n❌ ${e.message}`);
  for (const { name, log } of children) console.error(`\n----- ${name} (last lines) -----\n${log.join('').split('\n').slice(-40).join('\n')}`);
} finally {
  for (const { child } of children) child.kill('SIGTERM');
  await sleep(500);
  await replSet.stop();
  process.exit(failed ? 1 : 0);
}
