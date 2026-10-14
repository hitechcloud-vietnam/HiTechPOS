/*
 * What a customer has asked for, read on the handset.
 *
 * Owner: "when customer aks for change. cancel then desktop or captain app
 * clearly can see the changes. what was before and what change customer
 * wahts? cancel item or cancel order."
 *
 * The desktop has had a dock for this for a while. The handset had NOTHING -
 * no queue, no card, no notification - so a waiter walking the floor could not
 * see that table nine had asked to drop a dish, and found out when the food
 * arrived and was sent back. The one member of staff standing next to the
 * customer was the one who could not be told.
 *
 * These are the judgements the card is built from, tested without a screen
 * because that is what the rest of assets/common is for.
 */

const assert = require('node:assert');
const test = require('node:test');
const Requests = require('../assets/common/requests.js');

const BIRYANI = { item_id: 'm1', name: 'Chicken Biryani', quantity: 2 };
const NAAN = { item_id: 'r1', name: 'Butter Naan', quantity: 3 };
const DAL = { item_id: 'd1', name: 'Dal Tadka', quantity: 1 };

const asking = (wants, items) => ({
  sale_id: 's1',
  items: items || [BIRYANI, NAAN, DAL],
  change_requested: { items: wants, at: new Date().toISOString() },
});

/* ------------------------------------------------------------- the kind */

test('a request to call the order off', () => {
  assert.strictEqual(Requests.kindOf({ cancel_requested: true }), 'cancel');
});

test('a request to change it', () => {
  assert.strictEqual(
    Requests.kindOf(asking([{ item_id: 'm1', name: 'Chicken Biryani', was: 2, quantity: 1 }])),
    'change'
  );
});

test('an order the customer already cancelled, which nobody decides', () => {
  /*
   * Inside the window the order simply goes - there is no yes or no to give.
   * It is in the queue anyway because a ticket may be on the pass and the
   * person carrying it has to know before they carry it.
   */
  assert.strictEqual(
    Requests.kindOf({ cancel_seen: false, customer_cancelled_at: new Date().toISOString() }),
    'gone'
  );
});

test('anything else is an order waiting to be accepted', () => {
  assert.strictEqual(Requests.kindOf({ sale_id: 's1' }), 'new');
});

/* --------------------------------------------------------- the question */

test('dropping one dish asks to remove an item', () => {
  assert.strictEqual(
    Requests.askedFor(asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 }])),
    'remove_one'
  );
});

test('dropping two asks to remove some', () => {
  assert.strictEqual(
    Requests.askedFor(
      asking([
        { item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 },
        { item_id: 'd1', name: 'Dal Tadka', was: 1, quantity: 0 },
      ])
    ),
    'remove_some'
  );
});

test('dropping every line is a cancellation in all but name', () => {
  /*
   * A waiter who reads "remove some items" carries the wrong news to the
   * kitchen: a shop that says yes to this has no order left.
   */
  assert.strictEqual(
    Requests.askedFor(
      asking([
        { item_id: 'm1', name: 'Chicken Biryani', was: 2, quantity: 0 },
        { item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 },
        { item_id: 'd1', name: 'Dal Tadka', was: 1, quantity: 0 },
      ])
    ),
    'remove_everything'
  );
});

test('asking for fewer is not asking to remove', () => {
  assert.strictEqual(
    Requests.askedFor(asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 1 }])),
    'fewer'
  );
});

test('a whole-order cancellation says so on its own', () => {
  assert.strictEqual(Requests.askedFor({ cancel_requested: true }), 'cancel_order');
});

/* ---------------------------------------------------- before and after */

test('every line of the order is described, not only the ones that moved', () => {
  /*
   * On a handset there is no second screen to go and check on. What is NOT
   * changing is half of what the waiter is being asked about.
   */
  const rows = Requests.linesOf(
    asking([{ item_id: 'm1', name: 'Chicken Biryani', was: 2, quantity: 1 }])
  );
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(
    rows.map((r) => r.state),
    ['moved', 'same', 'same']
  );
});

test('a line that moves carries what it was and what it would become', () => {
  const rows = Requests.linesOf(
    asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 1 }])
  );
  const naan = rows.find((r) => r.name === 'Butter Naan');
  assert.deepStrictEqual(naan, { name: 'Butter Naan', was: 3, now: 1, state: 'moved' });
});

test('a line going to nothing is its own state, not a quantity of zero', () => {
  /* So the card can say REMOVED in words. Zero is the single most
     skimmable-past number on a card full of numbers. */
  const rows = Requests.linesOf(
    asking([{ item_id: 'r1', name: 'Butter Naan', was: 3, quantity: 0 }])
  );
  assert.strictEqual(rows.find((r) => r.name === 'Butter Naan').state, 'gone');
});

test('a dish that was never on the order still reads correctly', () => {
  /*
   * A customer cannot ask for one any more - more food needs nobody's
   * permission and goes straight to the pass - but a request made before that
   * rule shipped is still sitting in the queue.
   */
  const rows = Requests.linesOf(asking([{ item_id: 'x9', name: 'Lime Soda', was: 0, quantity: 1 }]));
  const soda = rows.find((r) => r.name === 'Lime Soda');
  assert.deepStrictEqual(soda, { name: 'Lime Soda', was: 0, now: 1, state: 'added' });
});

test('an order with no lines at all does not throw', () => {
  /* A request made before the queue started sending the whole order. */
  assert.deepStrictEqual(Requests.linesOf({ change_requested: { items: [] } }), []);
  assert.deepStrictEqual(Requests.linesOf(null), []);
});

/* ------------------------------------------------------------ how long */

test('how long ago, in whole minutes', () => {
  const now = new Date('2026-09-16T12:00:00Z').getTime();
  assert.strictEqual(Requests.minutesSince('2026-09-16T11:49:00Z', now), 11);
  assert.strictEqual(Requests.minutesSince('2026-09-16T11:59:40Z', now), 0);
});

test('a time it cannot read is no time', () => {
  /* The card then says nothing rather than "NaN minutes ago", which is the
     one sentence guaranteed to make somebody distrust the whole screen. */
  assert.strictEqual(Requests.minutesSince('soon'), null);
  assert.strictEqual(Requests.minutesSince(null), null);
  assert.strictEqual(Requests.minutesSince(undefined), null);
});

test('a clock that is behind does not produce a negative wait', () => {
  const now = new Date('2026-09-16T12:00:00Z').getTime();
  assert.strictEqual(Requests.minutesSince('2026-09-16T12:05:00Z', now), 0);
});
