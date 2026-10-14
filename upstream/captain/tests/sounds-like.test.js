/*
 * The sounds a menu is ordered in.
 *
 * Every case below is a real transcript shape: a recogniser trained on English
 * listening to somebody order food in Tamil Nadu. The spellings are not typos
 * to be corrected, they are what the machine genuinely hands back, and the
 * whole job of this module is to stop them being nine different dishes.
 *
 * The tests are in two halves, and the SECOND half is the important one.
 * Making a matcher tolerant is easy; keeping it from matching everything is
 * the part that decides whether a bill is right.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const S = require(path.join(__dirname, '..', 'assets', 'common', 'sounds-like.js'));

/** Every spelling of one dish must reduce to one sound. */
function oneSound(label, spellings) {
  const keys = spellings.map((word) => word + '=' + S.key(word));
  const distinct = new Set(spellings.map(S.key));
  assert.equal(distinct.size, 1, label + ' split into ' + distinct.size + ' sounds: ' + keys.join(', '));
}

/* ------------------------------------------------- the same word, spelled out */

test('aspiration is spelling, not sound', () => {
  /* th/t, dh/d, bh/b are one sound each to the speaker. A transcript picks
     whichever it likes, sometimes twice in the same order. */
  oneSound('dosa', ['dosa', 'dosai', 'thosai', 'dhosa', 'dosay']);
  oneSound('gobi', ['gobi', 'gobhi', 'gopi']);
  oneSound('sambar', ['sambar', 'sambhar', 'sambaar', 'saambar']);
});

test('vowels are where a recogniser errs, so they carry nothing', () => {
  oneSound('biryani', ['biryani', 'biriyani', 'briyani', 'bryani', 'biriani', 'biryaani']);
});

test('a doubled letter is a writing choice', () => {
  oneSound('paneer', ['paneer', 'panner', 'paner', 'panir']);
  oneSound('chicken', ['chicken', 'chiken', 'chikken']);
});

test('v and w are one letter', () => {
  oneSound('vada', ['vada', 'wada', 'vadai', 'wadai']);
});

test('voicing slides, because Tamil does not contrast it where English does', () => {
  oneSound('parotta', ['parotta', 'porotta', 'barotta', 'parota']);
});

test('sh and ch are single sounds, not two', () => {
  /* Done before any letter is classed on its own, or every word carrying one
     comes out a syllable too long. */
  oneSound('chapati', ['chapati', 'chapathi', 'shapati', 'chappathi']);
});

/* ----------------------------------------------------- and what must NOT fold */

test('rice is not lice, and soft c is not a K', () => {
  /*
   * "rice" came out RK before soft c was handled, which is not a sound
   * anybody makes. It put rice next to nothing and away from everything.
   */
  assert.equal(S.key('rice'), 'RS');
  assert.notEqual(S.key('rice'), S.key('lice'));
  assert.equal(S.key('juice'), S.key('juce'));
});

test('coffee is not gobi', () => {
  /*
   * THE BUG THIS TEST EXISTS FOR. f was folded in with p and b, which is
   * defensible - Tamil has no f and coffee is said "kaapi" - and it put
   * "coffee" and "gobi" in the same bucket, both KB.
   *
   * A waiter asking for a coffee and being offered Gobi Manchurian is exactly
   * the confident wrong answer this module exists to prevent. The trade is
   * that "copy" no longer reaches "coffee", which is the right way round: a
   * wrong item on a bill costs an argument at a table, a missed match costs
   * saying it again.
   */
  assert.notEqual(S.key('coffee'), S.key('gobi'));
});

test('a word that starts with a vowel is marked as one', () => {
  /* Otherwise "idli" and "dal" sit one sound apart. */
  assert.notEqual(S.key('idli'), S.key('dal'));
  assert.ok(S.key('idli').startsWith('A'));
});

test('the things a kitchen must never confuse stay apart', () => {
  const pairs = [
    ['chicken', 'mutton'], ['veg', 'non veg'], ['tea', 'coffee'],
    ['naan', 'rice'], ['sweet', 'salt'], ['half', 'full'],
  ];
  for (const [a, b] of pairs) {
    assert.notEqual(S.key(a), S.key(b), a + ' and ' + b + ' must not sound alike');
  }
});

test('a sound too short to mean anything means nothing', () => {
  /*
   * A one-sound key is most of the dictionary, and a recogniser clearing its
   * throat produces plenty of them. Anything that short has already been
   * caught by exact or prefix matching before this file is reached.
   */
  assert.equal(S.alike('tea', 'toe'), false);
  assert.deepEqual(S.words('a e i'), []);
  assert.equal(S.key(''), '');
  assert.equal(S.key('!!!'), '');
});

/* --------------------------------------------------------------- whole phrases */

test('a phrase is matched word by word, not as one run of sounds', () => {
  /* Comparing whole names lets a long name absorb a wrong word: "chicken
     biryani" would match "mutton biryani" on the half that is right. */
  assert.equal(S.score('chiken briyani', 'Chicken Biryani'), 1);
  assert.equal(S.score('chicken biryani', 'Mutton Biryani'), 0.5);
});

test('hearing part of a name is a partial match, not a miss', () => {
  /* Somebody says "biryani" and means one of the two on the menu. The screen
     asks; it does not guess silently. */
  assert.equal(S.score('briyani', 'Chicken Biryani'), 1);
  assert.equal(S.score('chicken biryani', 'Chicken Biryani Family Pack'), 1);
});

test('nothing said means nothing matched', () => {
  assert.equal(S.score('', 'Chicken Biryani'), 0);
  assert.equal(S.score('chicken', ''), 0);
});
