'use strict';
/*
 * Online orders that need somebody, in the waiter's hand.
 *
 * Owner: "request should go to desktop application and captain app. let him
 * confirm. anyone can confirm about that."
 *
 * A customer may change their own order for a minute after placing it, and
 * only ASK after that. Until now the asking reached the till and nothing
 * else, which is the wrong shape for a restaurant: the person most likely to
 * be holding a screen is the one walking the floor.
 *
 * What matters here is not the polling - that is a setInterval - but that the
 * request arrives in words a person can act on while standing up, and that
 * the two buttons mean the obvious thing for each kind of request.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const MODULE = path.join(__dirname, '..', 'assets', 'common', 'online-approvals.js');

/** The module, with a POSNIC.api that answers whatever the test says. */
function load({ queue = [], fails = false } = {}) {
  delete require.cache[require.resolve(MODULE)];
  const calls = { asked: 0, decided: [] };
  globalThis.POSNIC = {
    api: {
      async get() {
        calls.asked += 1;
        if (fails) throw new Error('offline');
        return { type: 'success', data: queue };
      },
      async post(path, body) {
        calls.decided.push({ path, body });
        if (fails) throw new Error('offline');
        return { type: 'success', message: 'Done' };
      },
    },
  };
  return { approvals: require(MODULE), calls };
}

const CHANGE = {
  sale_id: 's1',
  sales_id: 'S-Q43L-000021',
  token_id: '560',
  change_requested: {
    items: [
      { item_id: 'm1', name: 'Chicken Biryani', was: 2, quantity: 3 },
      { item_id: 'd1', name: 'Gulab Jamun', was: 0, quantity: 1 },
      { item_id: 'n1', name: 'Butter Naan', was: 2, quantity: 0 },
    ],
  },
};

test('a change request arrives in words somebody can act on standing up', () => {
  const { approvals } = load();
  assert.strictEqual(approvals.asks(CHANGE), 'change');
  assert.deepStrictEqual(approvals.wording(CHANGE), [
    'Chicken Biryani: 2 → 3',
    '+ 1 × Gulab Jamun',
    'Remove Butter Naan',
  ]);
  /* Never a row of database ids: whoever reads this is holding a phone with
     a table waiting. */
  assert.ok(!approvals.wording(CHANGE).join(' ').includes('m1'));
});

test('the two buttons mean the obvious thing for each kind of request', () => {
  const { approvals } = load();
  assert.deepStrictEqual(approvals.choices(CHANGE), {
    yes: { label: 'Make the change', decision: 'accept' },
    no: { label: 'Leave it as it is', decision: 'keep' },
  });
  assert.deepStrictEqual(approvals.choices({ cancel_requested: true }), {
    yes: { label: 'Cancel it', decision: 'cancel' },
    no: { label: 'Keep the order', decision: 'keep' },
  });
  assert.deepStrictEqual(approvals.choices({ sale_id: 's9' }), {
    yes: { label: 'Accept', decision: 'accepted' },
    no: { label: 'Reject', decision: 'rejected' },
  });
});

test('a cancellation outranks a change on the same order', () => {
  /* A customer who asks to change their order and then thinks better of the
     whole thing has asked two things. Answering the bigger one answers both,
     and offering "make the change" on an order somebody wants gone is how
     the wrong food gets cooked. */
  const { approvals } = load();
  assert.strictEqual(approvals.asks({ ...CHANGE, cancel_requested: true }), 'cancel');
});

test('answering goes through the till\'s own door, and looks again afterwards', async () => {
  /*
   * /sales/:id/approval is what the desktop's buttons call, and the server
   * applies an accepted change through the same code the customer's own plus
   * and minus use - so a dish that went off the menu while the request sat in
   * the queue is still refused, whoever pressed the button.
   */
  const { approvals, calls } = load({ queue: [CHANGE] });
  const out = await approvals.decide('s1', 'accept');
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(calls.decided, [
    { path: '/sales/s1/approval', body: { decision: 'accept', reason: '' } },
  ]);
  /* Another handset or the till may have got there first; the honest thing
     is to show the queue as it now is. */
  assert.strictEqual(calls.asked, 1, 'the queue was not read back after deciding');
});

test('a shop that cannot be reached does not empty the queue on screen', async () => {
  const { approvals } = load({ queue: [CHANGE] });
  await approvals.look();
  assert.strictEqual(approvals.queue().length, 1);

  /* The next look fails. What was last known stays: a handset in a corridor
     with no signal must not tell a waiter there is nothing waiting. */
  const broken = load({ fails: true });
  globalThis.POSNIC = broken.calls ? globalThis.POSNIC : globalThis.POSNIC;
  globalThis.POSNIC.api.get = async () => {
    throw new Error('offline');
  };
  await approvals.look();
  assert.strictEqual(approvals.queue().length, 1, 'a dropped connection emptied the queue');
});

test('the screen is only redrawn when the queue actually changes', async () => {
  /*
   * A handset that redraws every twenty seconds throws away whatever the
   * waiter was in the middle of reading.
   */
  const seen = [];
  const { approvals } = load({ queue: [CHANGE] });
  approvals.watch((rows) => seen.push(rows.length));
  await approvals.look();
  await approvals.look();
  approvals.stop();
  assert.strictEqual(seen.length, 1, 'the same queue was announced twice');

  /* But the SAME order asking for something different is news. */
  globalThis.POSNIC.api.get = async () => ({
    type: 'success',
    data: [{ ...CHANGE, cancel_requested: true }],
  });
  await approvals.look();
  assert.strictEqual(seen.length, 2, 'an order that started asking for something else was missed');
});
