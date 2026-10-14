/*
 * AN ORDER SAYS WHICH PHONE IT CAME FROM.
 *
 * Owner: "every order should have some details. example what mobile, user
 * agent, ip address, mobile type or user account whatever infromation app can
 * know do it."
 *
 * When an order goes wrong - a duplicate, a wrong table, a price nobody
 * recognises - the question is which handset and whose hands. A user agent
 * does not answer it: on an Android app it is the same WebView string for
 * every phone in the building.
 *
 * So the app says what it actually knows. The address and the waiter are the
 * till's to record, from the connection and the session, because a phone that
 * names its own user is a phone that can name somebody else's.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...bits) => fs.readFileSync(path.join(ROOT, ...bits), 'utf8');

/**
 * The module, loaded against a fake phone.
 *
 * The browser globals are HANDED IN rather than assigned somewhere, because
 * files in assets/common may only touch `root` on their export line - a house
 * rule with a test of its own - and because Node has a `navigator` of its own
 * that would otherwise answer these questions with the runtime's user agent.
 */
function load(window) {
  const source = read('assets', 'common', 'this-device.js');
  // eslint-disable-next-line no-new-func
  new Function(
    'window',
    'globalThis',
    'navigator',
    'localStorage',
    'crypto',
    'screen',
    source
  )(window, window, window.navigator, window.localStorage, window.crypto, window.screen);
  return window.POSNIC.thisDevice;
}

/** A phone, as far as this module is concerned. */
function aPhone(over = {}) {
  const store = new Map();
  return Object.assign(
    {
      navigator: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118 Mobile Safari/537.36',
        language: 'en-IN',
      },
      screen: { width: 412, height: 915 },
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
      },
      crypto: { randomUUID: () => 'fixed-uuid-1111' },
      Intl,
      POSNIC: {},
      POSNIC_BUILD: { version: '1.2.21', commit: 'abc1234' },
    },
    over
  );
}

/* ------------------------------------------------------------- the phone */

test('the model is read out of the user agent, not the browser engine', () => {
  /*
   * THE REASON THIS EXISTS. The user agent above says Chrome 118 on Android
   * 13, which is true of every handset in the shop. SM-G991B is the one fact
   * on that line that identifies a device.
   */
  const device = load(aPhone());
  assert.strictEqual(device.facts().device_model, 'SM-G991B');
});

test('the WebView marker is not mistaken for a phone', () => {
  const window = aPhone();
  window.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36';
  const device = load(window);

  assert.strictEqual(device.deviceModel(window.navigator.userAgent), '');
  /* And an empty answer is left OUT of the block rather than sent as a blank -
     a record of half empty strings is harder to read than a short one. */
  assert.ok(!('device_model' in device.facts()));
});

test('an iPhone says iPhone, because that is all Safari ever says', () => {
  const window = aPhone();
  window.navigator.userAgent =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15';
  assert.strictEqual(load(window).facts().device_model, 'iPhone');
});

test('the handset keeps one name for itself across restarts', () => {
  /*
   * The difference between "three duplicate orders" and "three duplicate
   * orders from the same handset", which is the whole question when a floor
   * reports one.
   */
  const window = aPhone();
  const device = load(window);
  const first = device.facts().device_id;
  const second = device.facts().device_id;
  assert.strictEqual(first, second);
  assert.strictEqual(first, 'fixed-uuid-1111');
});

test('a phone with storage blocked still orders, just anonymously', () => {
  const window = aPhone({
    localStorage: {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    },
  });
  const facts = load(window).facts();
  assert.ok(!('device_id' in facts), 'an empty id was sent as a field');
  assert.strictEqual(facts.app, 'captain');
});

/* ------------------------------------------------------- which door it used */

test('an order over the shop Wi-Fi says lan, one over the internet says cloud', () => {
  /*
   * Worth knowing on a report of "the order never arrived": the two doors fail
   * for entirely different reasons.
   */
  const lan = aPhone();
  lan.POSNIC = { server: { baseUrl: 'http://192.168.1.7:9000/api' } };
  assert.strictEqual(load(lan).facts().network, 'lan');

  const cloud = aPhone();
  cloud.POSNIC = { server: { baseUrl: 'https://azure.posnic.io/api' } };
  assert.strictEqual(load(cloud).facts().network, 'cloud');
});

test('the build is named, so a bug report names a version', () => {
  const facts = load(aPhone()).facts();
  assert.strictEqual(facts.app_version, '1.2.21 (abc1234)');
  assert.strictEqual(facts.app, 'captain');
});

test('a dev build says nothing rather than something untrue', () => {
  const window = aPhone({ POSNIC_BUILD: undefined });
  assert.ok(!('app_version' in load(window).facts()));
});

/* ------------------------------------------------ what it must never claim */

test('the phone never names the waiter or its own address', () => {
  /*
   * Both are read by the till - the waiter from the session, the address from
   * the connection. A phone that names its own user is a phone that can name
   * somebody else's, and one that names its own address is a phone that can
   * name another shop's.
   */
  const facts = load(aPhone()).facts();
  for (const forbidden of ['staff_id', 'staff_name', 'ip', 'user_agent']) {
    assert.ok(!(forbidden in facts), `the handset is claiming ${forbidden}`);
  }
});

test('empty answers are left out rather than sent as blanks', () => {
  /* A record somebody reads at three in the morning should not be half empty
     strings. */
  const window = aPhone();
  window.screen = {};
  window.navigator = { userAgent: '', language: '' };
  const facts = load(window).facts();
  for (const [key, value] of Object.entries(facts)) {
    assert.ok(value !== '', `${key} was sent empty`);
  }
});

/* ------------------------------------------------------------ the wiring */

test('the order payload carries it, and every ordering page loads it', () => {
  const store = read('indexedDB.js');
  assert.match(store, /client: \(POSNIC\.thisDevice && POSNIC\.thisDevice\.facts\(\)\) \|\| \{\}/,
    'the order does not carry the device block');

  for (const page of ['products.html', 'cart.html', 'kot-management.html', 'order-history.html']) {
    assert.match(read(page), /assets\/common\/this-device\.js/, `${page} does not load it`);
  }
});
