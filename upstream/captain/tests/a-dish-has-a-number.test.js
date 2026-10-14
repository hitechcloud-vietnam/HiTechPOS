/*
 * A DISH HAS A NUMBER, AND TYPING IT FINDS THE DISH.
 *
 * Owner: "self manage number. app user itself auto assign 1 to 200 for 200
 * items. if enter 33 then it shows. i want so many real practical options to
 * make to so easy."
 *
 * The oldest trick behind a counter and still the fastest one: a waiter who
 * sells the same forty dishes learns their numbers in a week and stops reading
 * the names. Two digits beat four letters and beat scrolling outright.
 *
 * THE NUMBER IS DERIVED, NOT ASSIGNED. It is the dish's position in the menu
 * the till sends, counted straight through the sections - so every handset in
 * the building shows the same number for the same dish without agreeing about
 * anything, and a card printed from that same order matches all of them. A
 * number a phone invented for itself would be a number on one phone, which is
 * worse than none: two waiters would read different dishes off the same card.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...bits) => fs.readFileSync(path.join(ROOT, ...bits), 'utf8');

/* The module, the way a page loads it. */
const MenuView = (() => {
  const window = { document: { createElement: () => ({}) } };
  // eslint-disable-next-line no-new-func
  new Function('window', 'globalThis', read('assets', 'common', 'menu-view.js'))(window, window);
  return window.MenuView;
})();

/** A menu the way MenuView.sections hands it on: sections, each with items. */
const MENU = [
  {
    key: 'starters',
    name: 'Starters',
    items: [
      { id: 'a', name: 'Chicken 65' },
      { id: 'b', name: 'Gobi Manchurian' },
    ],
  },
  {
    key: 'mains',
    name: 'Mains',
    items: [
      { id: 'c', name: 'Chicken Biryani' },
      { id: 'd', name: 'Mutton Biryani' },
      { id: 'e', name: 'Butter Naan' },
    ],
  },
];

/* --------------------------------------------------------- the numbering */

test('every dish gets one, counted straight through the sections', () => {
  const numbers = MenuView.numbers(MENU);

  assert.strictEqual(numbers.get('a'), 1);
  assert.strictEqual(numbers.get('b'), 2);
  /* Across the section boundary rather than restarting - a waiter types one
     number, not a section and a number. */
  assert.strictEqual(numbers.get('c'), 3);
  assert.strictEqual(numbers.get('e'), 5);
  assert.strictEqual(numbers.size, 5);
});

test('the same menu gives the same numbers, on any phone, with nothing stored', () => {
  /*
   * THE REASON IT IS DERIVED. Two handsets that assigned their own numbers
   * would disagree, and a card on the wall would be right for one of them.
   */
  const first = MenuView.numbers(MENU);
  const second = MenuView.numbers(JSON.parse(JSON.stringify(MENU)));

  assert.deepStrictEqual([...first.entries()], [...second.entries()]);
});

test('a number finds its dish', () => {
  assert.strictEqual(MenuView.atNumber(MENU, 3).name, 'Chicken Biryani');
  assert.strictEqual(MenuView.atNumber(MENU, 1).name, 'Chicken 65');
  assert.strictEqual(MenuView.atNumber(MENU, 5).name, 'Butter Naan');
});

test('a number past the end of the menu finds nothing rather than something', () => {
  /* A shop with forty dishes and a waiter who typed 400 should see "nothing
     matches", not the last dish on the menu. */
  assert.strictEqual(MenuView.atNumber(MENU, 6), null);
  assert.strictEqual(MenuView.atNumber(MENU, 0), null);
  assert.strictEqual(MenuView.atNumber(MENU, -2), null);
  assert.strictEqual(MenuView.atNumber(MENU, 'abc'), null);
  assert.strictEqual(MenuView.atNumber([], 1), null);
});

/* ------------------------------------------------------------ on the row */

test('the row wears its number, which is how anybody learns it', () => {
  const html = MenuView.render(MENU, new Map(), { numbers: MenuView.numbers(MENU) });

  assert.match(html, /class="dish-no"[^>]*>1</);
  assert.match(html, /class="dish-no"[^>]*>5</);
  /* Beside the name, not somewhere else on the row. */
  assert.match(html, /<p class="dish-name"[^>]*><span class="dish-no"[^>]*>3<\/span>Chicken Biryani/);
});

test('a screen that asks for no numbers gets none', () => {
  /* The ordering screen and the bill draw the same rows; a number is useful
     where somebody is searching, and clutter where they are not. */
  const html = MenuView.render(MENU, new Map(), {});
  assert.ok(!html.includes('dish-no'));
});

test('the number is styled, or it is not a number anybody can read', () => {
  assert.match(read('assets', 'common', 'design.css'), /\.dish-no \{/);
});

/* ------------------------------------------- what typing a number does */

test('typing a number shows that dish FIRST, and the name matches after it', () => {
  /*
   * In an Indian kitchen a number IS a dish name. Type 65 and a waiter may
   * well mean Chicken 65 - so the numbered dish is offered first, labelled,
   * and every name match follows. Both readings are given; neither is guessed
   * at on the waiter's behalf.
   */
  const picker = read('assets', 'order-history', 'script.js');

  assert.match(picker, /const byNumber = \/\^\[0-9\]\{1,4\}\$\/\.test\(term\)/,
    'a typed number is not read as a number');
  assert.match(picker, /sections\.push\(\{ key: 'number', name: 'No\. ' \+ term/,
    'the numbered dish is not offered under its own heading');
  assert.match(picker, /const rest = byNumber \? hits\.filter/,
    'the numbered dish would be listed twice');
});

test('typing a number never adds anything by itself', () => {
  /*
   * THE SAFETY THE WHOLE SCHEME RESTS ON. The number moves when the shop moves
   * a dish, so a waiter's memory of 33 can go stale between a Monday and a
   * Tuesday. Showing the dish means a stale memory costs a glance; firing it
   * blind would mean a wrong plate, cooked.
   */
  const picker = read('assets', 'order-history', 'script.js');
  const where = picker.indexOf('const byNumber =');
  const after = picker.slice(where, where + 1200);

  assert.ok(!/updateQuantity|addProductToOrder/.test(after),
    'a typed number reaches straight into the order');
});

test('a dish with nothing matching still says so, number or not', () => {
  const picker = read('assets', 'order-history', 'script.js');
  assert.match(picker, /if \(!hits\.length && !byNumber\)/,
    'a number that matches nothing would fall through to an empty screen');
  assert.match(picker, /or a dish number/,
    'the empty state does not mention the fastest way to find something');
});

/* ------------------------------------------- the till's list, as sections */

/*
 * The number a dish wears is its position in the sectioned menu, so whoever
 * builds those sections decides the numbers. That grouping used to be a loop
 * inside the picker, which meant the wall card had to grow a second copy of
 * it, and two copies is how 33 stops meaning the same dish on paper and in
 * the hand. MenuView.fromFlat is the one copy.
 */

/** What IndexedDB hands back: one flat list, category on every row. */
const FLAT = [
  { id: 'a', name: 'Chicken 65', category_name: 'Starters', category_sort: 1 },
  { id: 'c', name: 'Chicken Biryani', category_name: 'Mains', category_sort: 2 },
  { id: 'b', name: 'Gobi Manchurian', category_name: 'Starters', category_sort: 1 },
  { id: 'd', name: 'Mutton Biryani', category_name: 'Mains', category_sort: 2 },
];

test('the flat list comes back as sections, in the shop card order', () => {
  const list = MenuView.fromFlat(FLAT);

  assert.deepStrictEqual(
    list.map((s) => s.name),
    ['Starters', 'Mains']
  );
  assert.deepStrictEqual(
    list.map((s) => s.items.map((i) => i.id)),
    [['a', 'b'], ['c', 'd']]
  );
});

test('a dish keeps its number whether the list arrives flat or sectioned', () => {
  /* The property the wall card depends on: one dish, one number, whichever
     door the menu came through. */
  const fromList = MenuView.numbers(MenuView.fromFlat(FLAT));

  assert.strictEqual(fromList.get('a'), 1);
  assert.strictEqual(fromList.get('b'), 2);
  assert.strictEqual(fromList.get('c'), 3);
  assert.strictEqual(fromList.get('d'), 4);
});

test('a row the shop never filed still gets a number', () => {
  /*
   * category_name is whatever the shop typed, and a row saved before the
   * field existed has none. Dropping it would leave a gap in the numbering,
   * which is worse than an "Menu" heading nobody minds.
   */
  const list = MenuView.fromFlat([{ id: 'x', name: 'Mystery' }]);

  assert.strictEqual(list.length, 1);
  assert.strictEqual(MenuView.numbers(list).get('x'), 1);
});

test('nothing at all is no sections, not a crash', () => {
  assert.deepStrictEqual(MenuView.fromFlat(), []);
  assert.deepStrictEqual(MenuView.fromFlat([]), []);
});
