/*
 * A table calling, on the handset, and a waiter who is not taking calls.
 *
 * Owner: "he is in table 7 and wants to call waiter or captain... desktop app
 * and captain mobile apps getting notification. captain app can switch off if
 * he wants."
 *
 * The till got the call when the feature shipped; the handset did not, which
 * is the wrong way round - the waiter is the one who would walk over. And the
 * switch is not a nicety: four handsets on a floor are four people, and the
 * one running the bar has no business being buzzed by table nine.
 */

const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Requests = require('../assets/common/requests.js');

/**
 * requests-ui.js with a world of our own, including a localStorage we can
 * read back - the mute switch is per device, so the storage IS the feature.
 */
function load({ stored = {}, broken = false } = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'common', 'requests-ui.js'),
    'utf8'
  );
  const store = { ...stored };
  const context = {
    Requests,
    console,
    setInterval: () => 0,
    localStorage: broken
      ? {
          getItem() {
            throw new Error('blocked');
          },
          setItem() {
            throw new Error('blocked');
          },
          removeItem() {
            throw new Error('blocked');
          },
        }
      : {
          getItem: (k) => (k in store ? store[k] : null),
          setItem: (k, v) => {
            store[k] = String(v);
          },
          removeItem: (k) => {
            delete store[k];
          },
        },
    document: {
      readyState: 'loading',
      addEventListener() {},
      body: { appendChild() {} },
      createElement: () => ({ addEventListener() {}, style: {}, classList: { add() {} } }),
      getElementById: () => null,
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { ui: context.PosnicRequests, store };
}

const call = (over) => ({
  sale_id: 'c1',
  call_id: 'c1',
  destination: '7',
  created_date: new Date().toISOString(),
  items: [],
  ...over,
});

/* ------------------------------------------------------- reading a call */

test('a row carrying a call id is a call, not an order', () => {
  /*
   * Its own kind because there is nothing to decide. Reading it as a new
   * order would put an accept button on it that means nothing.
   */
  assert.strictEqual(Requests.kindOf(call()), 'waiter');
  assert.strictEqual(Requests.askedFor(call()), 'table_calling');
});

test('a call has no lines, because it is not about an order', () => {
  assert.deepStrictEqual(Requests.linesOf(call()), []);
});

test('the card says which table, and how long it has been waiting', () => {
  const { ui } = load();
  const html = ui.cardHtml(call({ created_date: new Date(Date.now() - 4 * 60000).toISOString() }));
  assert.match(html, /Table 7/);
  assert.match(html, /Table is calling/);
  assert.match(html, /4 minutes ago/);
});

test('one button, because there is nothing to refuse', () => {
  /* The table wants a person; the only answer is that one is coming. */
  const { ui } = load();
  const html = ui.cardHtml(call());
  assert.match(html, /Got it/);
  assert.doesNotMatch(html, /Leave it/);
  assert.doesNotMatch(html, /Do it/);
});

test('the card carries the call id, which is what the answer is posted against', () => {
  const { ui } = load();
  const html = ui.cardHtml(call());
  assert.match(html, /data-kind="waiter"/);
  assert.match(html, /data-order="c1"/);
});

/* --------------------------------------------- a waiter not taking calls */

test('muted is off until somebody says otherwise', () => {
  const { ui } = load();
  assert.strictEqual(ui.muted(), false);
});

test('the switch is remembered on this device', () => {
  /*
   * Per DEVICE and not per shop: four handsets are four people, and the shop
   * as a whole still wants the call answered by somebody. A shop-wide setting
   * would turn one person's preference into everybody's blind spot.
   */
  const { ui, store } = load();
  ui.mute(true);
  assert.strictEqual(ui.muted(), true);
  assert.strictEqual(store['posnic.calls-muted'], 'yes');

  ui.mute(false);
  assert.strictEqual(ui.muted(), false);
  assert.strictEqual('posnic.calls-muted' in store, false);
});

test('a handset with storage blocked hears calls', () => {
  /*
   * The safer way round. A waiter who cannot silence calls is inconvenienced;
   * one who is silenced without knowing it leaves a table sitting.
   */
  const { ui } = load({ broken: true });
  assert.strictEqual(ui.muted(), false);
  ui.mute(true);
  assert.strictEqual(ui.muted(), false);
});

test('muting hides calls and nothing else', () => {
  /*
   * THE LINE THAT MATTERS. A customer asking to cancel an order is a decision
   * somebody has to make, and there is no reading of "switch it off" that
   * should hide one of those.
   */
  const { ui } = load({ stored: { 'posnic.calls-muted': 'yes' } });
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'common', 'requests-ui.js'),
    'utf8'
  );
  assert.match(
    source,
    /Requests\.kindOf\(row\) !== 'waiter'/,
    'muting filters by something other than the call kind'
  );
  assert.strictEqual(ui.muted(), true);
});

test('the panel can still be opened while muted, so it can be unmuted', () => {
  /* A panel that hides itself the moment somebody silences it is a panel
     they cannot un-silence. */
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'common', 'requests-ui.js'),
    'utf8'
  );
  assert.match(source, /box\.hidden = !open;/);
  assert.doesNotMatch(source, /box\.hidden = !open \|\| waiting\.length === 0;/);
});

/* --------------------------------------------------------- the two keys */

test('calls are read from their own key, never merged into the orders', () => {
  /*
   * A handset running an older build reads `data` and is unaffected. Merging
   * would have it draw a table's call as a new order with an accept button
   * that means nothing - a regression shipped to a client by a change on the
   * server.
   */
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'common', 'requests-ui.js'),
    'utf8'
  );
  assert.match(source, /answer && answer\.calls/);
  assert.match(source, /call_id: String\(call\.call_id/);
});

test('a call is answered through its own door, not the approval machine', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'common', 'requests-ui.js'),
    'utf8'
  );
  assert.match(source, /waiterCalls\/' \+ encodeURIComponent\(id\) \+ '\/seen/);
});
