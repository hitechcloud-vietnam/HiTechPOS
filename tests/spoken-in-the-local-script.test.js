/*
 * An order said in the script it is said in.
 *
 * Owner: "multi language possible or not? i know chatgpt supports".
 *
 * The answer was "half". A waiter mixing languages already worked, because a
 * recogniser set to en-IN hands back Latin letters and the number table
 * carries rendu and teen and chaar:
 *
 *   "rendu chicken biryani and oru coffee"  ->  2 Chicken Biryani, 1 Coffee
 *
 * Set the shop's voice language to ta-IN, though, and the recogniser hands
 * back Tamil letters instead. Every normaliser in the app throws away anything
 * outside a-z, so the phrase arrived as empty space: the key was '', the
 * search matched nothing, and not one item reached the cart - while the
 * microphone, the waveform and the transcript on screen all went on looking
 * perfectly healthy. The settings screen RECOMMENDED that language, which made
 * it a trap and not a limitation.
 *
 * THE FIX IS A TABLE, NOT A MATCHER. key() drops every vowel and folds
 * aspiration and voicing, so a romanisation only has to land the consonants
 * roughly right and the existing tolerance absorbs the rest. It is on purpose
 * not a correct transliteration: where accuracy and agreeing with how the menu
 * is SPELLED disagree, spelling wins.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SoundsLike = require(path.join(__dirname, '..', 'assets', 'common', 'sounds-like.js'));
const ItemSearch = require(path.join(__dirname, '..', 'assets', 'common', 'item-search.js'));
const VoiceOrder = require(path.join(__dirname, '..', 'assets', 'common', 'voice-order.js'));

const MENU = [
  'Chicken Biryani',
  'Masala Dosa',
  'Idly',
  'Paneer Butter Masala',
  'Mutton Chukka',
  'Coffee',
].map((name, id) => ({ id: String(id), name }));

const index = ItemSearch.index(MENU);

/** What an order comes to, said however it is said. */
function heard(said) {
  return VoiceOrder.commands(said, index, ItemSearch).flatMap((command) =>
    (command.lines || []).map((line) =>
      line.found ? `${command.verb} ${line.quantity} x ${line.item.name}` : `MISS ${line.term}`
    )
  );
}

/* ------------------------------------------------------- Latin is untouched */

test('a word already in Latin comes back exactly as it went in', () => {
  /*
   * THE WHOLE SAFETY ARGUMENT. This runs on every word of every menu of every
   * shop, and all but a handful of them are already a-z. One regex test, and
   * the string is handed straight back.
   */
  for (const word of ['Chicken Biryani', 'coffee', 'Crème Brûlée', '65', "Chef's special"]) {
    assert.equal(SoundsLike.roman(word), word);
  }
});

test('nothing that worked before works differently now', () => {
  assert.deepEqual(heard('two chicken biryani'), ['add 2 x Chicken Biryani']);
  assert.deepEqual(heard('rendu chicken biryani and oru coffee'), [
    'add 2 x Chicken Biryani',
    'add 1 x Coffee',
  ]);
});

/* ------------------------------------------------------------------- Tamil */

test('an order said in Tamil is an order', () => {
  assert.deepEqual(heard('ரெண்டு சிக்கன் பிரியாணி'), ['add 2 x Chicken Biryani']);
  assert.deepEqual(heard('மூணு மசாலா தோசை'), ['add 3 x Masala Dosa']);
  assert.deepEqual(heard('நாலு இட்லி'), ['add 4 x Idly']);
  assert.deepEqual(heard('அஞ்சு மட்டன் சுக்கா'), ['add 5 x Mutton Chukka']);
});

test('the dish lands on the same key from either script', () => {
  /* Which is the whole mechanism: nothing compares scripts, they are both
     reduced to the same handful of consonants before anything is compared. */
  assert.equal(SoundsLike.key('சிக்கன்'), SoundsLike.key('chicken'));
  assert.equal(SoundsLike.key('பிரியாணி'), SoundsLike.key('biryani'));
  assert.equal(SoundsLike.key('மசாலா'), SoundsLike.key('masala'));
});

/* ------------------------------------------------------------------ Hindi */

test('an order said in Hindi is an order', () => {
  assert.deepEqual(heard('तीन पनीर बटर मसाला'), ['add 3 x Paneer Butter Masala']);
  assert.deepEqual(heard('एक चिकन बिरयानी'), ['add 1 x Chicken Biryani']);
});

test('the word-final vowel Hindi does not say is not written down', () => {
  /*
   * Devanagari spells a bare consonant with an "a" inside it, and does not
   * pronounce that "a" at the end of a word. Spell it anyway and तीन comes out
   * "teena", which is not in the table of numbers - and three quietly stops
   * being a quantity while the dish beside it still matches.
   */
  assert.equal(SoundsLike.roman('तीन'), 'teen');
  assert.equal(SoundsLike.roman('चार'), 'chaar');
  assert.equal(SoundsLike.roman('पनीर'), 'paneer');
});

test('दो is two, even though "do" is not', () => {
  /*
   * "do" is kept out of the number table on purpose: it is Hindi for two and
   * the commonest English auxiliary there is, so "do you have chicken biryani"
   * would come through as two of something called "have chicken biryani". That
   * ambiguity is a fact about LATIN LETTERS. दो cannot be anything but two, so
   * it is read before it is ever romanised into the word that has to go.
   */
  assert.deepEqual(heard('दो चिकन बिरयानी'), ['add 2 x Chicken Biryani']);
  assert.deepEqual(heard('do you have chicken biryani'), ['add 1 x Chicken Biryani']);
});

/* --------------------------------------------------------------- the digits */

test('numerals written as figures count too', () => {
  assert.equal(SoundsLike.roman('௩'), '3');
  assert.equal(SoundsLike.roman('३'), '3');
});

/* ------------------------------------------------- a menu in its own script */

test('a shop whose menu is stored in Tamil is searchable by a Latin thumb', () => {
  /*
   * Both sides of every comparison are folded through the same function, so
   * they meet whichever script each of them started in. A shop that types its
   * dish names in Tamil gets a search box that answers to English, and the
   * other way round, without storing anything twice.
   */
  const tamilMenu = ItemSearch.index([
    { id: 't1', name: 'சிக்கன் பிரியாணி' },
    { id: 't2', name: 'மசாலா தோசை' },
  ]);
  const found = ItemSearch.search(tamilMenu, 'chicken biryani', { heard: true });
  assert.equal(found.length > 0 && found[0].id, 't1');
});

/* ------------------------------------------------------------ what it cannot do */

test('the search is unchanged for a shop that never says a word of either', () => {
  /*
   * The romanisation runs BEFORE the three passes, not as a fourth one, so a
   * shop typing Latin at a Latin menu is doing exactly what it did before -
   * including the ranking, which nothing here touches.
   */
  const found = ItemSearch.search(index, 'masala', {});
  assert.ok(found.length >= 2, 'the ordinary text search stopped finding things');
  assert.ok(
    found.some((item) => item.name === 'Masala Dosa'),
    'a plain Latin search lost a plain Latin match'
  );
});

/*
 * KNOWN AND ACCEPTED: a loanword whose Latin spelling has an f.
 *
 * "Coffee" keys as KF. Tamil has no f, so காபி romanises to "kaapi" and keys
 * as KB, and the two do not meet. Folding f back into p and b would fix it and
 * would also put "coffee" and "gobi" in one bucket, which is the exact
 * collision the class table was written to end - a real dish confusion traded
 * for a loanword one. In practice a recogniser hands loanwords back in Latin
 * anyway, so this costs a case that mostly does not arise.
 */
