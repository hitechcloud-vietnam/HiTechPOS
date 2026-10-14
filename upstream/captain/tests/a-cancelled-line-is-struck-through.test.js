/*
 * A CANCELLED LINE IS STRUCK THROUGH.
 *
 * Owner: "whenever order cancel or item cancel those line item name should be
 * strick in the middle. it symbolic that we cancelled it. i want that."
 *
 * A rule through the name is what that has meant on paper for as long as there
 * have been kitchens, and it says it ON THE LINE - a badge at the top of a card
 * makes a waiter hold a status in their head while reading down the dishes.
 *
 * Four places show an order's lines and they have to agree: a dish struck
 * through in one view and plain in another is worse than neither. So the
 * decision lives in one function per screen, and this pins both of them plus
 * the stylesheet that makes the class mean something.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...bits) => fs.readFileSync(path.join(ROOT, ...bits), 'utf8');

const HISTORY = read('assets', 'order-history', 'script.js');
const HISTORY_CSS = read('assets', 'order-history', 'style.css');
const FLOOR = read('assets', 'kot', 'script.js');
const FLOOR_CSS = read('assets', 'kot', 'style.css');

/** Lift one `function name(...) {...}` out by brace matching. */
function lift(source, name) {
  const from = source.indexOf(`function ${name}(`);
  assert.notStrictEqual(from, -1, `${name} is gone`);
  let depth = 0;
  for (let i = source.indexOf('{', from); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  throw new Error(`${name} never closes`);
}

/* The real functions, run against real shapes. */
// eslint-disable-next-line no-new-func
const lineIsCancelled = new Function(
  `${lift(HISTORY, 'lineIsCancelled')}\nreturn lineIsCancelled;`
)();
// eslint-disable-next-line no-new-func
const itemIsCancelled = new Function(
  `${lift(FLOOR, 'itemIsCancelled')}\nreturn itemIsCancelled;`
)();
// eslint-disable-next-line no-new-func
const kotIsCancelled = new Function(`${lift(FLOOR, 'kotIsCancelled')}\nreturn kotIsCancelled;`)();

/* --------------------------------------------------- a cancelled ORDER */

test('every line of a cancelled order is struck', () => {
  const order = { status: 'cancelled', items: [{ name: 'Chicken Biryani', quantity: 2 }] };
  assert.equal(lineIsCancelled(order.items[0], order), true);
});

test('a live order strikes nothing', () => {
  const order = { status: 'pending', items: [{ name: 'Chicken Biryani', quantity: 2 }] };
  assert.equal(lineIsCancelled(order.items[0], order), false);
});

test('the status is read whatever case it arrives in', () => {
  /* The till has written it both ways. */
  for (const status of ['cancelled', 'Cancelled', 'CANCELLED']) {
    assert.equal(lineIsCancelled({ name: 'X' }, { status }), true, status);
  }
});

/* ---------------------------------------------------- a cancelled ITEM */

test('one line taken off a live order is struck, and its neighbours are not', () => {
  const order = {
    status: 'pending',
    items: [
      { name: 'Chicken Biryani', quantity: 2 },
      { name: 'Coffee', quantity: 1, cancelled: true },
    ],
  };
  assert.equal(lineIsCancelled(order.items[0], order), false, 'a live dish was struck');
  assert.equal(lineIsCancelled(order.items[1], order), true, 'a cancelled dish was not struck');
});

test('every spelling the till has used is accepted', () => {
  /*
   * Accepted in one place rather than at each of the four that draw a line,
   * because the one that gets missed is the one a shop notices.
   */
  const live = { status: 'pending' };
  assert.equal(lineIsCancelled({ cancelled: true }, live), true, 'cancelled');
  assert.equal(lineIsCancelled({ is_cancelled: true }, live), true, 'is_cancelled');
  assert.equal(lineIsCancelled({ status: 'cancelled' }, live), true, 'status');
  assert.equal(
    lineIsCancelled({ quantity: 2, cancelled_quantity: 2 }, live),
    true,
    'the whole quantity taken off'
  );
});

test('a partly cancelled line is NOT struck', () => {
  /*
   * One of three taken off still leaves two being cooked. Striking the name
   * would tell a waiter the dish is off when it is coming.
   */
  assert.equal(
    lineIsCancelled({ quantity: 3, cancelled_quantity: 1 }, { status: 'pending' }),
    false
  );
});

test('a missing item or order is not a cancellation', () => {
  assert.equal(lineIsCancelled(null, null), false);
  assert.equal(lineIsCancelled({ name: 'X' }, null), false);
  assert.equal(lineIsCancelled({ name: 'X' }, {}), false);
});

test('an edited remaining serving is live even when more portions were cancelled', () => {
  for (const removed of [1, 2, 4]) {
    assert.equal(lineIsCancelled({ quantity: 1, cancelled_quantity: removed, cancelled: false }, { status: 'pending' }), false);
  }
  assert.equal(lineIsCancelled({ quantity: 1, cancelled_quantity: 1, cancelled: false }, { status: 'cancelled' }), true);
});

/* ----------------------------------------------------- the floor screen */

test('the floor strikes a cancelled ticket and a cancelled line', () => {
  assert.equal(kotIsCancelled({ status: 'cancelled' }), true);
  assert.equal(kotIsCancelled({ status: 'pending' }), false);
  assert.equal(kotIsCancelled(null), false);

  assert.equal(itemIsCancelled({ cancelled: true }), true);
  assert.equal(itemIsCancelled({ status: 'Cancelled' }), true);
  assert.equal(itemIsCancelled({ item_quantity: 2, cancelled_quantity: 2 }), true);
  assert.equal(itemIsCancelled({ item_quantity: 3, cancelled_quantity: 1 }), false);
  assert.equal(itemIsCancelled({ item_quantity: 2 }), false);
  assert.equal(itemIsCancelled(null), false);
});

/* ------------------------------------------- the class reaches the screen */

test('all four places that draw a line ask', () => {
  /*
   * A rule that is decided and never applied is the commonest way this kind
   * of change ships looking done.
   */
  assert.match(HISTORY, /class="item-preview\$\{struck\(item, order\)\}"/,
    'the card preview does not strike');
  assert.match(HISTORY, /<(?:tr|div) class="\$\{struck\(item,\s*order\)\.trim\(\)\}">/,
    'the details table does not strike');
  assert.match(HISTORY, /class="order-item-card\$\{struck\(item, editingOrder\)\}"/,
    'the modify list does not strike');
  const view = read('assets', 'kot', 'order-view.js');
  assert.match(view, /root\.kotIsCancelled\(order\)\|\|root\.itemIsCancelled\(item\)\?' is-cancelled'/, 'the compact floor does not strike');
});

test('the class is styled, on both screens', () => {
  /* Without this the markup carries a class nothing draws. */
  assert.match(HISTORY_CSS, /\.item-preview\.is-cancelled/);
  assert.match(HISTORY_CSS, /text-decoration:\s*line-through/);
  assert.match(FLOOR_CSS, /\.kot-item\.is-cancelled \.item-name/);
  assert.match(FLOOR_CSS, /text-decoration:\s*line-through/);
});

test('the rule goes through the name, not through the price', () => {
  /*
   * Striking the numbers as well makes them hard to read at exactly the
   * moment somebody is working out what is still owed.
   */
  const block = HISTORY_CSS.slice(HISTORY_CSS.indexOf('.item-preview.is-cancelled'));
  const rule = block.slice(0, block.indexOf('}'));
  assert.ok(/\.line-name/.test(rule), 'the whole row is struck, not the name');
});

test('compact floor strikes cancelled names and keeps quantities readable without actions', () => {
  const vm = require('node:vm');
  const context = { document: { addEventListener() {} }, window: {
    kotIsCancelled: order => order.status === 'cancelled',
    itemIsCancelled,
    CaptainMoney: { html: value => String(value) },
    FloorLineActions: { render: () => '<button>Item action</button>' }
  }};
  vm.runInNewContext(read('assets','kot','order-view.js'), context);
  const render = context.window.CaptainOrderView.render;
  const order = {_id:'test',sales_total:10,items:[{name:'Tea',item_quantity:2,cancelled_quantity:2}]};
  const html = render([order], {takeaway:false,financialActions:''});
  assert.match(html, /order-legacy-line is-cancelled/);
  assert.match(html, /<strong translate="no">Tea<\/strong><span translate="no">×2<\/span>/);
  assert.doesNotMatch(html, /Item action/);
  const partial = {...order, items:[{name:'Tea',item_quantity:2,cancelled_quantity:1}]};
  assert.doesNotMatch(render([partial], {financialActions:''}), /order-legacy-line is-cancelled/);
  assert.match(render([{...partial,status:'cancelled'}], {financialActions:''}), /order-legacy-line is-cancelled/);
  assert.match(read('assets','kot','order-view.css'), /\.order-legacy-line\.is-cancelled > strong\{text-decoration:line-through/);
  const noted = render([{...order,items:[{name:'Tea',quantity:1,notes:'No sugar <script>alert(1)</script>'}]}],{financialActions:''});
  assert.match(noted,/class="order-legacy-note"/);
  assert.match(noted,/No sugar &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const cleared = render([{...order,items:[{name:'Tea',quantity:1,item_description:'',notes:'Old note'}]}],{financialActions:''});
  assert.doesNotMatch(cleared,/Old note/);
});
