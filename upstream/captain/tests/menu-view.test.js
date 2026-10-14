/*
 * The rules the menu is drawn by.
 *
 * Every one of these is a decision somebody can quietly get wrong later, and
 * most of them are invisible when wrong: a struck-through price that is not a
 * discount, a stock count that double-counts the cart, a chicken dish with a
 * green mark on it. None of those throw. They just tell a customer something
 * untrue, and only a test says so.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const MenuView = require(path.join(__dirname, '..', 'assets', 'common', 'menu-view.js'));

const dishOf = (over) => ({
  id: 'a1',
  name: 'Chicken Biryani',
  price: 200,
  available_quantity: 10,
  ...over,
});

/* ------------------------------------------------------------- the veg mark */

test('"non-veg" is not veg', () => {
  /*
   * THE ONE THAT MATTERS. "non-veg" contains "veg", so a check for veg that
   * runs first marks every chicken dish on the menu green. That is not a
   * cosmetic bug - it is the app telling somebody their food is vegetarian.
   */
  assert.equal(MenuView.diet('non-veg'), 'nonveg');
  assert.equal(MenuView.diet('Non Veg'), 'nonveg');
  assert.equal(MenuView.diet('nonveg'), 'nonveg');
  assert.equal(MenuView.diet('NONVEG'), 'nonveg');
});

test('the marks a shop actually types', () => {
  assert.equal(MenuView.diet('veg'), 'veg');
  assert.equal(MenuView.diet('Vegetarian'), 'veg');
  assert.equal(MenuView.diet('egg'), 'egg');
});

test('an unrecognised mark shows nothing rather than a guess', () => {
  /* Showing the wrong mark is worse than showing none, and this field has
     been free text for years. */
  assert.equal(MenuView.diet(''), '');
  assert.equal(MenuView.diet(null), '');
  assert.equal(MenuView.diet('seasonal'), '');
});

/* ------------------------------------------------------------ what it costs */

test('no discount, no struck-through price', () => {
  const cost = MenuView.pricing(dishOf({ price: 200, discount_price: 0 }));
  assert.equal(cost.now, 200);
  assert.equal(cost.was, 0, 'a struck-through price equal to the price is noise');
  assert.equal(cost.percent, 0);
});

test('a discount says the old price and the saving', () => {
  const cost = MenuView.pricing(dishOf({ price: 200, discount_price: 50 }));
  assert.equal(cost.now, 150);
  assert.equal(cost.was, 200);
  assert.equal(cost.percent, 25);
});

test('a discount cannot make a dish cost less than nothing', () => {
  const cost = MenuView.pricing(dishOf({ price: 100, discount_price: 500 }));
  assert.equal(cost.now, 0);
});

/* ------------------------------------------------------------- what is left */

test('what is left counts what is already on the bill', () => {
  /* Four in the kitchen and three on the bill is one left, not four. The old
     search results said four and the old menu said one. */
  assert.deepEqual(MenuView.stock(dishOf({ available_quantity: 4 }), 3), { out: false, left: 1 });
});

test('plenty left is said by saying nothing', () => {
  /* "47 left" is not information a waiter needs while taking an order. */
  assert.equal(MenuView.stock(dishOf({ available_quantity: 47 }), 0).left, null);
  assert.equal(MenuView.stock(dishOf({ available_quantity: 5 }), 0).left, 5);
  assert.equal(MenuView.stock(dishOf({ available_quantity: 6 }), 0).left, null);
});

test('a shop that does not count stock is never sold out', () => {
  const always = dishOf({ available_quantity: 0, negative_stock: true });
  assert.deepEqual(MenuView.stock(always, 0), { out: false, left: null });
});

test('nothing in the kitchen is sold out', () => {
  assert.equal(MenuView.stock(dishOf({ available_quantity: 0 }), 0).out, true);
});

/* -------------------------------------------------------- the description */

test('a description pasted out of Word arrives as one line of text', () => {
  /* Shops paste from Word, from WhatsApp and from their own website, so this
     arrives with tags in it - sometimes escaped once. A stray <div> rendered
     as markup would break the row it sits in. */
  assert.equal(MenuView.plain('&lt;p&gt;Served hot&lt;/p&gt;'), 'Served hot');
  assert.equal(MenuView.plain('<b>Spicy</b>&nbsp;and   rich'), 'Spicy and rich');
  assert.equal(MenuView.plain(null), '');
});

/* --------------------------------------------------------------- the rows */

test('a name with markup in it cannot become markup', () => {
  const row = MenuView.dish(dishOf({ name: '<img src=x onerror=alert(1)>' }), 0, {});
  assert.ok(!row.includes('<img src=x'), 'a shop name is escaped, not run');
  assert.ok(row.includes('&lt;img'));
});

test('no photograph means the dish icon, not a grey hole', () => {
  const row = MenuView.dish(dishOf({ img: '', icon: '🍛' }), 0, {});
  assert.ok(row.includes('dish-icon'));
  assert.ok(row.includes('🍛'));
  assert.ok(!row.includes('<img'), 'nothing to load, so nothing to fail to load');
});

test('a photograph that fails to load falls back to the same icon', () => {
  const row = MenuView.dish(dishOf({ img: 'a.jpg', icon: '🍛' }), 0, { image: (u) => '/x/' + u });
  assert.ok(row.includes('src="/x/a.jpg"'), 'the caller decides where images live');
  assert.ok(row.includes('MenuView.noPhoto(this)'));
  assert.ok(row.includes('data-icon="🍛"'));
});

test('ADD until there is one, then a stepper', () => {
  assert.ok(MenuView.dish(dishOf(), 0, {}).includes('>ADD<'));
  const two = MenuView.dish(dishOf(), 2, {});
  assert.ok(!two.includes('>ADD<'));
  assert.ok(two.includes('dish-step'));
  assert.ok(two.includes('>2<'));
});

test('sold out is dimmed and named, not hidden', () => {
  /* A waiter has to be able to TELL the table it is off. A dish that has
     silently vanished from the menu cannot be talked about. */
  const row = MenuView.dish(dishOf({ available_quantity: 0 }), 0, {});
  assert.ok(row.includes('is-out'));
  assert.ok(row.includes('Sold out'));
  assert.ok(!row.includes('>ADD<'), 'nothing to press on a dish the kitchen has run out of');
});

test('the kitchen time shows only when the shop has said one', () => {
  const rendered = MenuView.dish(dishOf({ prep_minutes: 20 }), 0, {}).replace(/<[^>]*>/g, '');
  assert.ok(rendered.includes('20 min'));
  assert.ok(!MenuView.dish(dishOf({ prep_minutes: 0 }), 0, {}).includes('min'));
});

test('a bestseller is badged from what the shop actually sold', () => {
  const opts = { popular: new Set(['a1']) };
  assert.ok(MenuView.dish(dishOf(), 0, opts).includes('Bestseller'));
  assert.ok(!MenuView.dish(dishOf({ id: 'b2' }), 0, opts).includes('Bestseller'));
});

/* ----------------------------------------------------------- the sections */

const menu = {
  biryani: [
    { id: '1', name: 'Chicken Biryani', price: 200, category_name: 'Biryani', available_quantity: 5 },
    { id: '2', name: 'Mutton Biryani', price: 260, category_name: 'Biryani', available_quantity: 0 },
  ],
  drinks: [{ id: '3', name: 'Coke', price: 40, category_name: 'Drinks', available_quantity: 99 }],
  all: [{ id: '1' }, { id: '2' }, { id: '3' }],
};

test('the "all" bucket is not a section', () => {
  /* loadProducts builds it for search and the voice matcher. Drawing it would
     put every dish on the menu twice. */
  const list = MenuView.sections(menu);
  assert.deepEqual(list.map((s) => s.key), ['biryani', 'drinks']);
});

test('a section is named the way the shop named it', () => {
  assert.equal(MenuView.sections(menu)[0].name, 'Biryani');
});

test('sold out sinks within its section and never out of it', () => {
  /* Under its own heading, so a waiter can say "the mutton is finished".
     Moved to the bottom of the whole menu it would look taken off the card. */
  const biryani = MenuView.sections(menu)[0];
  assert.deepEqual(biryani.items.map((i) => i.id), ['1', '2']);
  assert.equal(biryani.key, 'biryani');
});

test('every dish is drawn exactly once', () => {
  const html = MenuView.render(MenuView.sections(menu), new Map(), {});
  for (const name of ['Chicken Biryani', 'Mutton Biryani', 'Coke']) {
    assert.equal(html.split(name).length - 1, 1, name + ' appears once');
  }
});

test('what is on the bill is drawn on the bill', () => {
  const cart = new Map([['1', { id: '1', quantity: 3 }]]);
  const html = MenuView.render(MenuView.sections(menu), cart, {});
  assert.ok(html.includes('id="qty-1">3<'));
  assert.ok(html.includes('is-in'), 'a row already on the bill says so at a glance');
});

test('the rail carries one chip per section, in menu order', () => {
  const html = MenuView.rail(MenuView.sections(menu));
  assert.equal(html.split('menu-chip').length - 1, 2);
  assert.ok(html.indexOf('Biryani') < html.indexOf('Drinks'));
  assert.equal(html.split('is-here').length - 1, 1, 'exactly one chip starts lit');
});

test('an empty menu says so rather than showing nothing', () => {
  /* A blank screen is indistinguishable from a broken one, and that
     difference matters most to the person least able to tell. */
  assert.equal(MenuView.render([], new Map(), {}), '');
  const said = MenuView.nothing('No items yet', 'Ask the till.');
  assert.ok(said.includes('No items yet'));
  assert.ok(said.includes('Ask the till.'));
});

test('an item saved before categories existed still reaches a section', () => {
  /* `category_name` is whatever the shop typed, and rows predate the field.
     The old loader called .toLowerCase() on it and threw, which stopped the
     menu drawing at that item and hid every dish after it. */
  const list = MenuView.sections({ uncategorised: [{ id: '9', name: 'Water', price: 20 }] });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'uncategorised');
});

test('price display switches tax treatment without mutating discounted catalogue values', () => {
  const inclusive = dishOf({price:210, discount_price:21, tax:5, tax_type:'inclusive', tax_price:0});
  const snapshot = JSON.stringify(inclusive);
  assert.equal(MenuView.displayPricing(inclusive, 'including').now,189);
  assert.equal(MenuView.displayPricing(inclusive, 'excluding').now,180);
  assert.equal(MenuView.displayPricing(inclusive, 'excluding').was,200);
  assert.equal(MenuView.displayPricing(inclusive, 'excluding').tax,9);
  const exclusive=dishOf({price:200,discount_price:20,tax:5,tax_type:'exclusive',tax_price:9});
  assert.equal(MenuView.displayPricing(exclusive,'including').now,189);
  assert.equal(MenuView.displayPricing(exclusive,'including').was,210);
  assert.equal(MenuView.displayPricing(exclusive,'excluding').now,180);
  assert.equal(JSON.stringify(inclusive),snapshot);
  assert.equal(MenuView.displayPricing(dishOf({tax:0}),'excluding').label,'');
});
test('menu uses image aliases and never adds a price-details action',()=>{
  const row=MenuView.dish(dishOf({image:'dish.jpg',tax:5,tax_type:'inclusive'}),0,{image:u=>'/photos/'+u});
  assert.ok(row.includes('/photos/dish.jpg'));
  assert.ok(row.includes('Including tax'));
  assert.ok(!row.includes('Price details'));
});
