/*
 * The card a waiter actually reads.
 *
 * Owner: "when customer aks for change. cancel then desktop or captain app
 * clearly can see the changes. what was before and what change customer
 * wahts? cancel item or cancel order."
 *
 * requests.js decides WHAT a request is; this is the sentence and the markup
 * built from that, which is the half the owner was actually looking at. It is
 * a string function, so it can be run without a screen - the module is loaded
 * into a context of our own making, the same way voice-order-ui is.
 */

const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Requests = require('../assets/common/requests.js');

/**
 * requests-ui.js, loaded with just enough world to exist.
 *
 * `start()` defers to DOMContentLoaded while the document says it is loading,
 * so nothing here fetches, polls or paints - the card builder is reached on
 * its own.
 */
function load() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'common', 'requests-ui.js'),
    'utf8'
  );
  const context = {
    Requests,
    console,
    setInterval: () => 0,
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
  return context.PosnicRequests;
}

const ui = load();

/**
 * The module again, with a POSNIC of our choosing and a note of what it asks
 * the server for.
 *
 * Loaded fresh each time rather than reaching into the one above: the guard
 * reads POSNIC when it runs, and a shared context would leak one test's world
 * into the next.
 */
function withPosnic({ configured = true, choosing = false, broken = false, onGet } = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'common', 'requests-ui.js'),
    'utf8'
  );
  const context = {
    Requests,
    console,
    setInterval: () => 0,
    POSNIC: broken
      ? {}
      : {
          server: { isConfigured: configured },
          net: { choosingServer: () => choosing },
          api: {
            get: async (path) => {
              if (onGet) onGet(path);
              return { data: [] };
            },
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
  global.PosnicRequests = context.PosnicRequests;
  return context.PosnicRequests;
}

const BIRYANI = { item_id: 'm1', name: 'Chicken Biryani', quantity: 2 };
const NAAN = { item_id: 'r1', name: 'Butter Naan', quantity: 3 };
const DAL = { item_id: 'd1', name: 'Dal Tadka', quantity: 1 };

const asking = (wants, extra) => ({
  sale_id: 's1',
  sales_id: 'SID7',
  token_id: '219',
  destination: '9',
  created_date: new Date().toISOString(),
  items: [BIRYANI, NAAN, DAL],
  change_requested: { items: wants, at: new Date().toISOString() },
  ...extra,
});

/* ------------------------------------------------- what it would do */

test('the card leads with the question, not with a category', () => {
  /*
   * "Asked to change" covered dropping one naan and emptying the order, which
   * are not the same decision and should not read as the same question.
   */
  const html = ui.cardHtml(asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 }]));
  assert.match(html, /Remove an item/);
});

test('emptying the order says so, because that is what it is', () => {
  const html = ui.cardHtml(
    asking([
      { item_id: 'm1', name: 'Chicken Biryani', was: 2, quantity: 0 },
      { item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 },
      { item_id: 'd1', name: 'Dal Tadka', was: 1, quantity: 0 },
    ])
  );
  assert.match(html, /Remove everything on the order/);
});

test('calling the whole order off is its own question', () => {
  const html = ui.cardHtml({
    sale_id: 's1',
    items: [BIRYANI],
    created_date: new Date().toISOString(),
    cancel_requested: true,
  });
  assert.match(html, /Cancel the whole order/);
});

/* -------------------------------------------------- before and after */

test('every line of the order is on the card', () => {
  /* On a handset there is no second screen to go and check what else is on
     the ticket. What is not changing is half of the decision. */
  const html = ui.cardHtml(
    asking([{ item_id: 'm1', name: 'Chicken Biryani', was: 2, quantity: 1 }])
  );
  assert.match(html, /Chicken Biryani/);
  assert.match(html, /Butter Naan/);
  assert.match(html, /Dal Tadka/);
});

test('the untouched lines are marked as untouched', () => {
  const html = ui.cardHtml(
    asking([{ item_id: 'm1', name: 'Chicken Biryani', was: 2, quantity: 1 }])
  );
  assert.strictEqual((html.match(/class="same"/g) || []).length, 2);
});

test('a moving line shows what it was and what it would become', () => {
  const html = ui.cardHtml(asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 1 }]));
  assert.match(html, /Butter Naan <b>3 &rarr; 1<\/b>/);
});

test('a line going to nothing says REMOVED, not a zero', () => {
  const html = ui.cardHtml(asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 }]));
  assert.match(html, /Butter Naan <b>REMOVED<\/b>/);
});

/* --------------------------------------------------------- the rest */

test('the card says which table, which bill and how long ago', () => {
  /*
   * How long ago is the whole decision: "cancel this?" is a different
   * question at forty seconds and at eleven minutes, and a waiter should not
   * be doing that arithmetic while a customer watches.
   */
  const html = ui.cardHtml(
    asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 }], {
      created_date: new Date(Date.now() - 11 * 60000).toISOString(),
    })
  );
  assert.match(html, /Table 9/);
  assert.match(html, /SID7/);
  assert.match(html, /Token 219/);
  assert.match(html, /11 minutes ago/);
});

test('an order already cancelled gets one button that says what it does', () => {
  /*
   * Nobody is deciding anything - the order went inside the window the shop
   * leaves open. Two buttons on something with no decision in it is two ways
   * to be confused.
   */
  const html = ui.cardHtml({
    sale_id: 's1',
    items: [BIRYANI],
    created_date: new Date().toISOString(),
    cancel_seen: false,
    customer_cancelled_at: new Date().toISOString(),
  });
  assert.match(html, /Got it/);
  assert.doesNotMatch(html, /Leave it/);
  assert.match(html, /Customer cancelled this/);
});

test('a request to decide gets both answers, worded as actions', () => {
  const html = ui.cardHtml(asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 }]));
  assert.match(html, /Leave it/);
  assert.match(html, /Do it/);
});

test('a dish name with markup in it cannot reach the card as markup', () => {
  /* Shop-typed text, drawn into a string by hand. */
  const html = ui.cardHtml({
    sale_id: 's1',
    created_date: new Date().toISOString(),
    items: [{ item_id: 'x', name: '<img src=x onerror=1>', quantity: 1 }],
    change_requested: {
      items: [{ item_id: 'x', name: '<img src=x onerror=1>', was: 1, quantity: 0 }],
    },
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('a card carries the id and the kind the answer needs', () => {
  /*
   * The two buttons post a decision that depends on the kind - a new order
   * moves to a STATE, a request answers the customer's wish - so both travel
   * on the element rather than being worked out again at click time.
   */
  const html = ui.cardHtml(asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 }]));
  assert.match(html, /data-order="s1"/);
  assert.match(html, /data-kind="change"/);
});

/* ------------------------------------------- when it is allowed to look */

/*
 * The poller dialled from the moment the page loaded, whatever else was
 * happening. On the CONNECT screen that meant dialling the OLD address while
 * somebody typed a new one - and a failed request wakes resolution, so the app
 * ran a discovery sweep against the address being corrected.
 *
 * The health loop has always held off for exactly that reason. This is the
 * same rule, borrowed rather than reinvented.
 */

test('it does not dial a shop that has not been chosen yet', async () => {
  const asked = [];
  withPosnic({ configured: false, choosing: false, onGet: (path) => asked.push(path) });

  await PosnicRequests.look();

  assert.deepEqual(asked, []);
});

test('it does not dial while somebody is editing the address', async () => {
  /* THE ONE THAT MATTERS. Dialling the old address mid-edit is what drags the
     resolver into a sweep against a server the user is halfway through
     replacing. */
  const asked = [];
  withPosnic({ configured: true, choosing: true, onGet: (path) => asked.push(path) });

  await PosnicRequests.look();

  assert.deepEqual(asked, []);
});

test('and it looks the moment the editor closes', async () => {
  const asked = [];
  withPosnic({ configured: true, choosing: false, onGet: (path) => asked.push(path) });

  await PosnicRequests.look();

  assert.deepEqual(asked, ['/sales/pendingOnlineOrders']);
});

test('a POSNIC that cannot answer either question is not dialled at', async () => {
  /* A page where the connection module has not loaded is not the place to
     find that out by firing requests into it. */
  const asked = [];
  withPosnic({ broken: true, onGet: (path) => asked.push(path) });

  await PosnicRequests.look();

  assert.deepEqual(asked, []);
});
