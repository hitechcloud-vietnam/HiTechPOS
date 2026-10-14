/*
 * Finding an item while somebody is standing at a table waiting.
 *
 * The ranking IS the feature. A change that quietly demotes the row somebody
 * expects first is invisible in a screenshot and surfaces months later as a
 * shop saying the app "got slower to use", so the order is pinned here rather
 * than left to whatever the sort happens to do.
 *
 * Node, not Playwright: this is pure logic and deserves to be checked in
 * milliseconds without a browser.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ItemSearch = require(path.join(__dirname, '..', 'assets', 'common', 'item-search.js'));

const MENU = [
  'Chicken Biryani',
  'Chicken 65',
  'Mutton Biryani',
  'Masala Dosa',
  'Masala Dosa Paper Roast',
  'Plain Dosa',
  'Butter Chicken',
  'Crème Brûlée',
  'Cold Coffee',
].map((name, id) => ({ id: String(id), name }));

const index = ItemSearch.index(MENU);
const names = (term, options) => ItemSearch.search(index, term, options).map((i) => i.name);

test('a plain substring still works', () => {
  assert.deepEqual(names('biry'), ['Mutton Biryani', 'Chicken Biryani']);
});

test('two words narrow instead of finding nothing', () => {
  /* The old search tested one substring, so "chick biry" matched nothing:
     those two words never appear together in that order. */
  assert.deepEqual(names('chick biry'), ['Chicken Biryani']);
});

test('initials find the thing a waiter sells all day', () => {
  /* "cb" is what somebody types two hundred times a shift. */
  assert.ok(names('cb').includes('Chicken Biryani'));
  assert.deepEqual(names('mdp'), ['Masala Dosa Paper Roast']);
});

test('a single letter does not match by initials', () => {
  /* One letter would make every item an initials match and turn the list into
     noise. Prefixes still apply, which is what a single letter should do. */
  const single = names('c');
  assert.ok(single.every((n) => ItemSearch.fold(n).split(' ').some((w) => w.startsWith('c'))),
    'a single letter matched something it does not begin');
});

test('accents are not a barrier on a kitchen keyboard', () => {
  assert.deepEqual(names('creme'), ['Crème Brûlée']);
  assert.deepEqual(names('brulee'), ['Crème Brûlée']);
  assert.deepEqual(names('crème'), ['Crème Brûlée']);
});

test('numbers in a name are findable', () => {
  assert.deepEqual(names('65'), ['Chicken 65']);
});

test('an exact name outranks everything', () => {
  assert.equal(names('masala dosa')[0], 'Masala Dosa',
    'the longer name that also matches must not come first');
});

test('a prefix outranks a word in the middle', () => {
  const result = names('chicken');
  assert.equal(result[0], 'Chicken 65');
  assert.ok(result.indexOf('Butter Chicken') > result.indexOf('Chicken Biryani'),
    'a name starting with the term belongs above one merely containing it');
});

test('what the shop sells breaks a tie, and only a tie', () => {
  /* "cb" fits Chicken Biryani and Crème Brûlée equally by initials, and
     nothing in the text separates them. The shop's own sales do. */
  const cold = names('cb');
  const biryaniSells = names('cb', { popular: new Set(['0']) });
  assert.notEqual(cold[0], undefined);
  assert.equal(biryaniSells[0], 'Chicken Biryani');

  /* But popularity must never beat a better text match, or typing more
     letters would move the row somebody was aiming at. */
  assert.equal(names('creme', { popular: new Set(['0']) })[0], 'Crème Brûlée');
});

test('nothing matching returns nothing, not everything', () => {
  assert.deepEqual(names('zzz'), []);
});

test('an empty search returns the menu untouched', () => {
  assert.equal(ItemSearch.search(index, '').length, MENU.length);
  assert.equal(ItemSearch.search(index, '   ').length, MENU.length);
});

test('a code matches whole, never partially', () => {
  /* Half a barcode is a coincidence, not an intent. */
  const coded = ItemSearch.index([{ id: 'x', name: 'Sparkling Water', sku: '8901234' }]);
  assert.equal(ItemSearch.search(coded, '8901234').length, 1);
  assert.equal(ItemSearch.search(coded, '89012').length, 0);
});

/*
 * Quantity typed before the item.
 *
 * Adding three of something meant finding it and tapping plus three times.
 * Every till lets you say the number first, and a waiter taking a table of six
 * says "three biryani" before they say which biryani.
 */

test('a number in front is a quantity', () => {
  assert.deepEqual(ItemSearch.parseTerm('3 cb'), { quantity: 3, term: 'cb' });
  assert.deepEqual(ItemSearch.parseTerm('12 masala dosa'), { quantity: 12, term: 'masala dosa' });
});

test('a bare number is still a search', () => {
  /* "65" is Chicken 65, not an order for sixty-five of the next thing
     touched. */
  assert.deepEqual(ItemSearch.parseTerm('65'), { quantity: 1, term: '65' });
});

test('a number can be searched for after a quantity', () => {
  assert.deepEqual(ItemSearch.parseTerm('2 65'), { quantity: 2, term: '65' });
});

test('a slipped finger cannot send ninety-nine mains', () => {
  /* Three digits is not a quantity anybody means, so it stays a search. */
  assert.equal(ItemSearch.parseTerm('999 cb').quantity, 1);
  assert.equal(ItemSearch.parseTerm('999 cb').term, '999 cb');
  /* And zero is one, not nothing. */
  assert.equal(ItemSearch.parseTerm('0 cb').quantity, 1);
});

/*
 * THE SPACE IS OPTIONAL, because a thumb in a hurry does not type one.
 *
 * "2 cb" worked and "2cb" did not - a distinction nobody standing at a table
 * is making on purpose, and the kind of thing that makes an app feel like it
 * is arguing with you.
 */

test('a quantity sticks to the word it counts', () => {
  assert.deepEqual(ItemSearch.parseTerm('2cb'), { quantity: 2, term: 'cb' });
  assert.deepEqual(ItemSearch.parseTerm('2 cb'), { quantity: 2, term: 'cb' });
  assert.deepEqual(ItemSearch.parseTerm('3coffee'), { quantity: 3, term: 'coffee' });
  assert.deepEqual(ItemSearch.parseTerm('12cb'), { quantity: 12, term: 'cb' });
});

test('a number inside a name is still part of the name', () => {
  /* The rule that keeps this safe: a dish's digits are not at the front. */
  assert.deepEqual(ItemSearch.parseTerm('chicken 65'), { quantity: 1, term: 'chicken 65' });
  assert.deepEqual(ItemSearch.parseTerm('a4 paper'), { quantity: 1, term: 'a4 paper' });
});

test('a number on its own is a search, not a quantity', () => {
  /* Somebody typing "65" is looking for Chicken 65, not ordering sixty-five
     of whatever they touch next. */
  assert.deepEqual(ItemSearch.parseTerm('65'), { quantity: 1, term: '65' });
  assert.deepEqual(ItemSearch.parseTerm('2'), { quantity: 1, term: '2' });
});

test('the shortcut finds the dish it is short for', () => {
  const menu = ['Chicken Biryani', 'Coffee', 'Chicken 65'].map((name, id) => ({
    id: String(id),
    name,
  }));
  const index = ItemSearch.index(menu);
  const typed = ItemSearch.parseTerm('2cb');
  assert.equal(typed.quantity, 2);
  assert.equal(ItemSearch.search(index, typed.term)[0].name, 'Chicken Biryani');
});

/*
 * THREE ATTEMPTS, EACH ONLY IF THE ONE BEFORE FOUND NOTHING.
 *
 * The safety argument for the two new passes is that they are strictly
 * additive: a search that matched something today matches the same things in
 * the same order tomorrow, because the later passes never run for it. The only
 * searches that change are the ones that used to come back empty.
 *
 * Everything above this line is that guarantee, unchanged.
 */

const SPOKEN_MENU = [
  'Chicken Biryani', 'Mutton Biryani', 'Chicken 65', 'Masala Dosa',
  'Paneer Butter Masala', 'Filter Coffee', 'Gobi Manchurian', 'Medhu Vada',
].map((name, id) => ({ id: String(id), name }));

const HEARD = ItemSearch.index(SPOKEN_MENU);
const top = (term, opts) => {
  const hits = ItemSearch.search(HEARD, term, opts || {});
  return hits.length ? hits[0].name : null;
};

test('a dish whose name is a number is findable by saying the number', () => {
  /*
   * THE DISH IS CALLED CHICKEN 65. It is written with digits on every board in
   * Tamil Nadu and nobody says "chicken six five", so a recogniser hands back
   * "sixty five" and the old search looked for a dish spelled that way.
   */
  assert.equal(top('chicken sixty five', { numbers: true }), 'Chicken 65');
  assert.equal(top('sixty five', { numbers: true }), 'Chicken 65');
  /* And through the speech path, which turns numbers on as well. */
  assert.equal(top('chicken sixty five', { heard: true }), 'Chicken 65');
  assert.equal(ItemSearch.numerals('chicken sixty five'), 'chicken 65');
  assert.equal(ItemSearch.numerals('twenty one'), '21');
  assert.equal(ItemSearch.numerals('sixty'), '60');
});

test('a word that is not a number is left alone', () => {
  assert.equal(ItemSearch.numerals('masala dosa'), 'masala dosa');
});

test('TYPING IS UNCHANGED: no phonetic help unless it was spoken', () => {
  /*
   * The deliberate decision at the top of this file. A waiter who types has
   * seen what they typed and can fix it; the same keystrokes must always
   * produce the same order, or typing another letter moves the row they were
   * aiming at.
   */
  assert.equal(top('briyani'), null);
  assert.equal(top('chiken'), null);
  assert.equal(top('panner'), null);
});

test('but a recogniser gets the benefit of the doubt', () => {
  assert.equal(top('chiken briyani', { heard: true }), 'Chicken Biryani');
  assert.equal(top('masala thosai', { heard: true }), 'Masala Dosa');
  assert.equal(top('panner butter masala', { heard: true }), 'Paneer Butter Masala');
  assert.equal(top('gopi manchurian', { heard: true }), 'Gobi Manchurian');
  assert.equal(top('medhu wada', { heard: true }), 'Medhu Vada');
});

test('every word said has to land somewhere in the name', () => {
  /*
   * Scoring a fraction and taking the best would match "chicken biryani" to
   * Mutton Biryani on the strength of the half that is right, which is the one
   * mistake nobody would forgive at a table.
   */
  assert.equal(top('chiken briyani', { heard: true }), 'Chicken Biryani');
  assert.equal(top('mutton briyani', { heard: true }), 'Mutton Biryani');
  assert.equal(top('zzzz briyani', { heard: true }), null);
});

test('a name with fewer spare words wins', () => {
  const menu = [
    { id: 'a', name: 'Chicken Biryani Family Pack' },
    { id: 'b', name: 'Chicken Biryani' },
  ];
  const ix = ItemSearch.index(menu);
  assert.equal(ItemSearch.search(ix, 'chiken briyani', { heard: true })[0].name, 'Chicken Biryani');
});

test('sounding like nothing on the menu finds nothing', () => {
  /* The failure that matters: silence beats a confident wrong dish. */
  assert.equal(top('helicopter', { heard: true }), null);
  assert.equal(top('uh a the', { heard: true }), null);

  /* An empty box is not a failed search: it is the whole menu, which is what
     the screen shows when nobody has typed anything. */
  assert.equal(ItemSearch.search(HEARD, '', { heard: true }).length, SPOKEN_MENU.length);
});

test('an exact match is never displaced by a phonetic one', () => {
  /* The later passes run only when the earlier ones came back empty, so this
     holds by construction - and this is the test that says so out loud. */
  assert.equal(top('filter coffee', { heard: true }), 'Filter Coffee');
  assert.equal(top('chicken 65', { heard: true }), 'Chicken 65');
});
