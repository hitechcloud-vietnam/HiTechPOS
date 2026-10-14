'use strict';

/*
 * A till that answers and says no has been FOUND.
 *
 * Owner, on his own shop: "captain app keep disconnected. i want right reason
 * with evidence."
 *
 * The evidence, when I went and measured it, was a router at 516ms round trip
 * on an empty channel with 79% signal - saturated. This is one of the things
 * saturating it.
 *
 * WHAT THE SEARCH USED TO DO
 *
 * `probe()` has always told a refusal apart from silence: REFUSED carries the
 * status, UNREACHABLE does not. But it returns `null` for both, so every
 * caller treated them the same:
 *
 *   - the sweep kept going past the till that had just answered 403, and
 *     spent another two hundred requests per attempt proving the rest of the
 *     subnet was empty;
 *   - `probe.lastFailure` is ONE variable and a sweep runs sixty-four probes
 *     at a time, so the one answer that mattered was overwritten within
 *     milliseconds by "nothing there" from an address with nothing there;
 *   - the circuit breaker cooled the till off for fifteen seconds as though
 *     it were dead, so a phone two metres from a working till routed its
 *     orders over mobile data instead;
 *   - and the waiter was told "No till found on this Wi-Fi", which sends
 *     somebody to check a router that is working perfectly.
 *
 * A dead address gives a connection error. Only a server sends back a status
 * code. So a refusal is not a miss - it is the till, found, turning this
 * phone away, usually because the shop has run out of handset slots.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');

/**
 * config.js, loaded into a fake browser.
 *
 * `answers` decides what every address says: a status number refuses with it,
 * `true` is a healthy Posnic till, anything else is silence.
 */
function load(answers) {
  const asked = [];
  const storage = new Map();

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    Promise,
    Error,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Map,
    Set,
    RegExp,
    AbortController,
    URL,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    navigator: { onLine: true },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    location: { origin: 'http://localhost', protocol: 'http:', hostname: 'localhost' },
    /* config.js starts its health loop on DOMContentLoaded and listens for
       online/offline. None of that is what this file is about, so the page
       simply never fires anything. */
    document: {
      addEventListener() {},
      removeEventListener() {},
      readyState: 'loading',
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } },
    XMLHttpRequest: undefined,
    fetch: async (url) => {
      asked.push(String(url));
      const said = answers(String(url));
      if (typeof said === 'number') {
        return { ok: false, status: said, json: async () => ({}) };
      }
      if (said === true) {
        return {
          ok: true,
          status: 200,
          /* What looksLikePosnic actually asks for: an apiSchema and an
             edition. Guessing the shape is how a fake passes a test the real
             thing would fail. */
          json: async () => ({ apiSchema: 1, edition: 'test', version: '1.0.0' }),
        };
      }
      throw new Error('connection refused');
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { POSNIC: sandbox.POSNIC, asked, sandbox };
}

const TILL = 'http://192.168.100.18:5555';

test('native Wi-Fi search starts near the phone and skips the phone itself', async () => {
  const { POSNIC, asked } = load(() => true);
  await POSNIC.discovery.scanSubnet('192.168.1', { ownHost: 170, concurrency: 1 });
  assert.match(asked[0], /^http:\/\/192\.168\.1\.169:5555\//);
  assert.ok(!asked.some((url) => url.includes('192.168.1.170:')));
});

test('native Wi-Fi search includes a till at host one', async () => {
  const { POSNIC, asked } = load(() => true);
  await POSNIC.discovery.scanSubnet('192.168.1', { ownHost: 2, concurrency: 1 });
  assert.match(asked[0], /^http:\/\/192\.168\.1\.1:5555\//);
});

test('cancelling an in-flight batch suppresses result and progress callbacks', async () => {
  let stopped = false;
  const { POSNIC } = load(() => { stopped = true; return true; });
  const callbacks = [];
  await POSNIC.discovery.scanSubnet('192.168.1', {
    hosts: [2, 3], shouldStop: () => stopped,
    onBatch: () => callbacks.push('batch'),
    onProgress: () => callbacks.push('progress'),
    collect: () => callbacks.push('result'),
  });
  assert.deepStrictEqual(callbacks, []);
});

/* ---------------------------------------------------- what a refusal means */

test('A REFUSAL CARRIES THE STATUS AND THE ADDRESS, not just "it failed"', async () => {
  const { POSNIC } = load(() => 403);
  const hit = await POSNIC.discovery.probe(TILL, 500);

  assert.strictEqual(hit, null, 'a refused till must not be adopted as a server');
  const why = POSNIC.discovery.probe.lastFailure;
  assert.strictEqual(why.reason, 'REFUSED');
  assert.strictEqual(why.status, 403, 'the status is what tells a manager which switch to flip');
  assert.strictEqual(why.host, TILL, 'the address is what tells them which machine');
  assert.strictEqual(why.base, TILL + '/api', 'the base is the one the app would actually call');
});

test('and silence is still told apart from it', async () => {
  const { POSNIC } = load(() => null);
  await POSNIC.discovery.probe(TILL, 500);
  const why = POSNIC.discovery.probe.lastFailure;
  assert.ok(['UNREACHABLE', 'TIMED_OUT'].includes(why.reason), 'got ' + why.reason);
  assert.strictEqual(why.status, 0, 'nothing answered, so there is no status to report');
});

/* ------------------------------------------- it stops looking, and says why */

test('A REFUSED TILL ENDS THE SEARCH RATHER THAN STARTING A SWEEP', async () => {
  /*
   * The load fix. There is one till on a shop's Wi-Fi; once it has answered,
   * every remaining address is known to be empty and sweeping them is two
   * hundred requests spent on a question already answered - on every attempt,
   * on a router already at 516ms.
   */
  const { POSNIC, asked } = load((url) => (url.includes('192.168.100.18') ? 403 : null));
  POSNIC.server.adopt(TILL);
  asked.length = 0;

  const found = await POSNIC.discovery.findOnWifi({});
  assert.strictEqual(found, null);
  assert.strictEqual(asked.length, 1, 'it kept looking after the till had answered: ' + asked.length);

  const refused = POSNIC.discovery.findOnWifi.lastRefusal;
  assert.ok(refused, 'the search forgot the one answer it got');
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(refused.host, TILL);
});

test('AND THE REFUSAL SURVIVES A SWEEP, which is what one variable could not do', async () => {
  /*
   * probe.lastFailure is a single global and a sweep runs sixty-four probes at
   * once, so it ends up holding whatever the LAST of them said. That is why a
   * refused handset was told the till could not be found: the app had found
   * it and then overwritten the fact.
   */
  const { POSNIC } = load((url) => (url.includes('.18:') ? 403 : null));

  const found = await POSNIC.discovery.findOnWifi({ skipKnown: true });
  assert.strictEqual(found, null);

  const refused = POSNIC.discovery.findOnWifi.lastRefusal;
  assert.ok(refused, 'the sweep lost the refusal');
  assert.strictEqual(refused.status, 403);
  assert.match(refused.host, /\.18:5555$/);
});

test('a search that truly finds nothing still reports nothing, not a refusal', async () => {
  const { POSNIC } = load(() => null);
  assert.strictEqual(await POSNIC.discovery.findOnWifi({ skipKnown: true }), null);
  assert.strictEqual(POSNIC.discovery.findOnWifi.lastRefusal, null);
});

test('and a till that answers properly is still adopted', async () => {
  /* The guard on all of the above: none of it may cost a working shop its
     till. */
  const { POSNIC } = load((url) => (url.includes('192.168.100.18') ? true : null));
  POSNIC.server.adopt(TILL);
  const found = await POSNIC.discovery.findOnWifi({});
  assert.ok(found, 'a healthy till was not found');
  assert.strictEqual(found.base, TILL + '/api');
  assert.strictEqual(POSNIC.discovery.findOnWifi.lastRefusal, null);
});

/* ------------------------------------------- the breaker leaves it in place */

test('A TILL THAT REFUSED IS NOT COOLED OFF AS THOUGH IT WERE DEAD', async () => {
  /*
   * The breaker exists to skip past addresses with nothing behind them. A till
   * that answered 403 has something behind it - it is up, on this Wi-Fi, and
   * deciding - and pushing it to the back of the list for fifteen seconds is
   * how a phone standing two metres from the till ends up sending every order
   * over mobile data.
   */
  const { POSNIC } = load((url) => (url.includes('192.168.100.18') ? 403 : null));
  POSNIC.server.adopt(TILL);

  await POSNIC.resolve({ allowScan: false });
  const refused = POSNIC.resolve.lastRefusal;
  assert.ok(refused, 'walking the candidates forgot the refusal');
  assert.strictEqual(refused.status, 403);

  /* Not in the cool-off list: the next request tries it first again, because
     the shop may have just allowed the device. */
  const source = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  assert.match(
    source,
    /if \(seen\.length\) \{\s*\n\s*resolve\.lastRefusal = seen\[0\];\s*\n\s*continue;/,
    'a refused candidate is being cooled off again'
  );
});

/* ------------------------------------------------- and the waiter is told */

test('THE SCREEN SAYS WHICH TILL REFUSED, not "no till found"', () => {
  /*
   * "No till found on this Wi-Fi" sends a waiter to check a router that is
   * working perfectly, and their manager after them. The till's address and
   * the status are both things somebody can act on.
   */
  const page = fs.readFileSync(path.join(ROOT, 'assets/common/onboarding.js'), 'utf8');
  assert.match(page, /const refused = seen\[0\]/);
  assert.match(page, /answered and refused this phone/);
  assert.match(page, /Ask your manager to allow this device on the till/);
  /* And the honest "nothing there" message is still there for when nothing
     is there. */
  assert.match(page, /No compatible till found/);
});

test('and the self-test reports it, because that screen exists to say why', () => {
  const selfTest = fs.readFileSync(path.join(ROOT, 'assets', 'common', 'self-test.js'), 'utf8');
  assert.match(selfTest, /report\.refused = /);
  assert.match(selfTest, /POSNIC\.resolve\.lastRefusal/);
});
