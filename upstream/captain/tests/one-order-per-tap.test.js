'use strict';
/*
 * One order per tap, and one order per cart.
 *
 * Reported from a live floor: an order sent from a handset for table 5 showed
 * up twice on the till, and cancelling one cancelled both.
 *
 * Two things had to be true for that, and both were.
 *
 * THE BUTTON STAYED LIVE while the order was being sent. A loader appeared,
 * but a second tap during the second or two this takes on a shop network
 * started a whole second checkout. On a slow connection that is not a rare
 * accident, it is what anybody does when nothing seems to be happening.
 *
 * AND THE KEY WAS MINTED PER ATTEMPT. This app has always sent an
 * idempotencyKey - the offline queue needs one - but a fresh one on every
 * call, so a QUEUED retry was recognised by the till and a second TAP was not.
 *
 * Both are fixed, because they fail differently. The latch stops a second
 * request ever leaving the handset. The key stops a request that DID leave -
 * on a dropped connection, or from a second handset at the same table - from
 * becoming a second ticket.
 *
 * Ported from Table_Order, where this was written first.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/** One function, cut out of a bundle by name and brace-matched. */
function lift(src, name) {
  const at = src.search(new RegExp('function\\s+' + name + '\\s*\\('));
  assert.ok(at !== -1, 'the bundle no longer defines ' + name);
  let i = src.indexOf('{', at);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}' && (depth -= 1) === 0) break;
  }
  return src.slice(at, i + 1);
}

/** The key functions, with a storage they can write to. */
function keyring() {
  const store = {};
  const box = {
    window: { crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2, 10) } },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    },
  };
  const src = read('indexedDB.js');
  /*
   * The two names the functions store under have to come too.
   *
   * Lifted from the bundle rather than retyped here: a test that declares its
   * own copy of a storage key still passes when the real one is renamed, and
   * then nothing is testing the thing that ships. Without them the functions
   * throw ReferenceError, fall into their own catch, and hand back a fresh
   * key every time - which looks exactly like the bug they fix.
   */
  const names = ['ORDER_KEY', 'ORDER_SHAPE']
    .map((name) => {
      const m = src.match(new RegExp("const " + name + " = '[^']+';"));
      assert.ok(m, 'indexedDB.js no longer declares ' + name);
      return m[0];
    })
    .join('\n');
  const code = ['newOrderKey', 'currentOrderKey', 'resetOrderKey', 'cartShape']
    .map((name) => lift(src, name))
    .join('\n');
  const make = new Function(
    'window',
    'localStorage',
    names + '\n' + code + '; return { currentOrderKey, resetOrderKey, cartShape };'
  );
  const kit = make(box.window, box.localStorage);

  /* What saveCartData does before it writes, which is where a changed cart
     loses its key. */
  kit.cartSaved = (cart) => {
    const shape = kit.cartShape(cart);
    if (box.localStorage.getItem('kiosk_order_shape') !== shape) {
      box.localStorage.setItem('kiosk_order_shape', shape);
      box.localStorage.removeItem('kiosk_order_key');
    }
  };
  return kit;
}

const CART = [{ id: 'a', quantity: 2, price: 100, note: '' }];

test('two taps on one cart send the same name, so the till answers with one order', () => {
  const kit = keyring();
  kit.cartSaved(CART);
  const first = kit.currentOrderKey();
  assert.strictEqual(kit.currentOrderKey(), first, 'a second tap invented a new order');
});

test('a product refresh that rewrites the cart unchanged does not mint a new key', () => {
  /*
   * syncCartSilently saves the cart back on every product refresh, with
   * fresher copies of the same items. That is not a change the waiter made,
   * and if it counted as one, a refresh landing between a dropped send and
   * its retry would print the second ticket this exists to prevent.
   */
  const kit = keyring();
  kit.cartSaved(CART);
  const first = kit.currentOrderKey();
  kit.cartSaved(JSON.parse(JSON.stringify(CART)));
  assert.strictEqual(kit.currentOrderKey(), first, 'a silent re-save split one order into two');
});

test('a dish added after a failed send is a NEW order, correctly', () => {
  /* This is why the key is not a hash of the items: a waiter who adds a dish
     after a failed send must not be handed back the order without it. */
  const kit = keyring();
  kit.cartSaved(CART);
  const first = kit.currentOrderKey();
  kit.cartSaved([...CART, { id: 'b', quantity: 1, price: 50, note: '' }]);
  assert.notStrictEqual(kit.currentOrderKey(), first, 'the added dish would have been silently dropped');
});

test('a changed quantity or a changed note is a new order too', () => {
  for (const changed of [
    [{ id: 'a', quantity: 3, price: 100, note: '' }],
    [{ id: 'a', quantity: 2, price: 100, note: 'no onion' }],
    [{ id: 'a', quantity: 2, price: 100, notes: 'Salt & pepper' }],
    [{ id: 'a', quantity: 2, price: 100, modifiers: [{ name: 'Manchurian' }] }],
  ]) {
    const kit = keyring();
    kit.cartSaved(CART);
    const first = kit.currentOrderKey();
    kit.cartSaved(changed);
    assert.notStrictEqual(kit.currentOrderKey(), first, JSON.stringify(changed));
  }
});

test('once it lands, the name is spent', () => {
  const kit = keyring();
  kit.cartSaved(CART);
  const sent = kit.currentOrderKey();
  kit.resetOrderKey();
  assert.notStrictEqual(kit.currentOrderKey(), sent, 'the next order reused the last one\'s name');
});

test('the button is latched and disabled while the order is going', () => {
  /*
   * The latch stops the second call; the disabled button says WHY nothing is
   * happening, which a silent no-op does not.
   */
  const js = read('assets', 'checkout', 'checkout.js');
  assert.match(js, /let kioskOrderInFlight = false;/);
  assert.match(js, /if \(kioskOrderInFlight\) \{/);
  assert.match(js, /kioskOrderInFlight = true;/);
  assert.match(js, /if \(button\) button\.disabled = true;/);
  /* And released in `finally`, or one failed send locks the handset out of
     ordering until it is restarted. */
  const finallyAt = js.indexOf('} finally {');
  assert.ok(finallyAt !== -1, 'there is no finally to release the latch in');
  const tail = js.slice(finallyAt);
  assert.match(tail, /kioskOrderInFlight = false;/);
  assert.match(tail, /if \(button\) button\.disabled = false;/);
});

test('the order carries the cart\'s key, not a fresh one per attempt', () => {
  const db = read('indexedDB.js');
  assert.match(db, /const orderKey = currentOrderKey\(\);/);
  assert.ok(
    !/const orderKey = OrderQueue\.newKey\(\)/.test(db),
    'the key is minted per attempt again, so a second tap writes a second ticket'
  );
  assert.match(db, /idempotencyKey: orderKey,/);
  assert.match(db, /OrderQueue\.add\(\{key: orderKey/);
  const saved = db.indexOf('OrderQueue.add({key: orderKey');
  assert.ok(saved < db.indexOf('await saveCartData([]);', saved), 'cart must not clear before the order is durable');
});
