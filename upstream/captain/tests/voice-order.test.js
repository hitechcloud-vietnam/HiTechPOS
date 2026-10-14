/*
 * Turning what a waiter said into an order.
 *
 * The danger here is not failing to hear. It is hearing confidently and
 * wrongly, and sending something nobody ordered to a kitchen. So the rules
 * that keep the tolerance narrow are pinned harder than the ones that make it
 * work at all.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ItemSearch = require(path.join(__dirname, '..', 'assets', 'common', 'item-search.js'));
const VoiceOrder = require(path.join(__dirname, '..', 'assets', 'common', 'voice-order.js'));

const MENU = [
  'Chicken Biryani', 'Mutton Biryani', 'Coffee', 'Toffee Pudding',
  'Masala Dosa', 'Butter Naan', 'Chicken 65', 'Paneer Butter Masala',
].map((name, id) => ({ id: String(id), name }));

const index = ItemSearch.index(MENU);
const heard = (text) => VoiceOrder.understand(text, index, ItemSearch);
const lines = (text) => heard(text).map((l) => `${l.quantity} x ${l.item ? l.item.name : '?'}`);

test('digits and spoken numbers both work', () => {
  assert.deepEqual(lines('2 chicken biryani, 3 coffee'), ['2 x Chicken Biryani', '3 x Coffee']);
  assert.deepEqual(lines('two chicken biryani and three coffee'), ['2 x Chicken Biryani', '3 x Coffee']);
});

test('"a" and "an" mean one', () => {
  assert.deepEqual(lines('a masala dosa'), ['1 x Masala Dosa']);
  assert.deepEqual(lines('an idli'), ['1 x ?']);
});

test('items separated by and, plus, or commas', () => {
  assert.equal(heard('coffee and coffee plus coffee, coffee').length, 4);
});

test('a number inside a name is part of the name', () => {
  /* "chicken 65" is a dish. Reading the 65 as a quantity is the difference
     between an order and an incident. */
  assert.deepEqual(lines('chicken 65'), ['1 x Chicken 65']);
  assert.deepEqual(lines('two chicken 65'), ['2 x Chicken 65']);
});

test('a mangled word still finds its dish', () => {
  /* What a recogniser actually returns in a loud room. */
  for (const said of ['briyani', 'biriyani', 'biryanee']) {
    const result = heard(`three ${said}`);
    assert.ok(result[0].item, `"${said}" found nothing`);
    assert.match(result[0].item.name, /Biryani/);
  }
});

test('a near match is reported as one, so the screen can say so', () => {
  assert.equal(heard('two chicken biryani')[0].exact, true);
  assert.equal(heard('two chicken briyani')[0].exact, false,
    'a corrected word must be shown differently from a certain one');
});

test('tolerance stays narrow enough to refuse a different word', () => {
  /* Coffee and Toffee Pudding are one edit apart and both on the menu. The
     exact match must win outright rather than the tolerant pass choosing. */
  const result = heard('three coffee');
  assert.equal(result[0].item.name, 'Coffee');
  assert.equal(result[0].exact, true);
});

test('something not on the menu is reported, never guessed', () => {
  const result = heard('five widgets');
  assert.equal(result[0].found, false);
  assert.equal(result[0].item, null);
  assert.equal(result[0].quantity, 5, 'the quantity is still understood, so it can be re-picked');
});

test('a short word is never corrected', () => {
  /* Three letters are too few to correct safely: almost everything is one
     edit from almost everything else. */
  const result = heard('two abc');
  assert.equal(result[0].found, false);
});

test('silence produces nothing rather than something', () => {
  assert.deepEqual(heard(''), []);
  assert.deepEqual(heard('   '), []);
  assert.deepEqual(heard('and and and'), []);
});

test('an absurd quantity is clamped, not obeyed', () => {
  assert.equal(VoiceOrder.quantityOf('99 coffee').quantity, 99);
  /* Three digits is not a quantity anybody speaks at a table. */
  assert.equal(VoiceOrder.quantityOf('500 coffee').quantity, 1);
});

test('two swapped letters count as one edit', () => {
  /* The commonest way a recogniser gets a word wrong. Plain Levenshtein
     charges two, which put the right dish outside a one-edit budget. */
  assert.equal(VoiceOrder.distance('briyani', 'biryani', 2), 1);
  assert.equal(VoiceOrder.distance('cofee', 'coffee', 2), 1);
});

/* ------------------------------------------------------------- commands */

/*
 * A waiter at a table talks in verbs. Owner: "if user say add 2 chicken
 * briyani cart needs to get added. if user says remove 2 chicken briyani
 * remove it. if user say send to kitchen. place order."
 *
 * The rules that keep a verb from being misread are pinned hardest, because
 * a misread verb is worse than a misread dish: "remove" heard as "add"
 * doubles an order instead of halving it.
 */
const said = (text) =>
  VoiceOrder.commands(text, index, ItemSearch).map(
    (c) => `${c.verb}${c.lines.length ? ':' + c.lines.map((l) => `${l.quantity} x ${l.item ? l.item.name : '?'}`).join('|') : ''}`
  );

test('words with no verb are an addition, which is what reading an order is', () => {
  assert.deepEqual(said('two chicken biryani and three coffee'), ['add:2 x Chicken Biryani|3 x Coffee']);
});

test('add, in the ways people actually say it', () => {
  for (const text of ['add two coffee', 'get me two coffee', 'i want two coffee', 'we need two coffee', 'put two coffee', 'order two coffee']) {
    assert.deepEqual(said(text), ['add:2 x Coffee'], text);
  }
});

test('remove, in the ways people actually say it', () => {
  for (const text of ['remove one coffee', 'take off one coffee', 'cancel the coffee', 'delete coffee', 'minus one coffee', 'drop the coffee']) {
    assert.deepEqual(said(text), ['remove:1 x Coffee'], text);
  }
});

test('a verb starts a new command and owns every dish until the next one', () => {
  assert.deepEqual(said('two chicken biryani and take off the coffee'), [
    'add:2 x Chicken Biryani',
    'remove:1 x Coffee',
  ]);
  assert.deepEqual(said('remove the coffee and add two masala dosa and one naan'), [
    'remove:1 x Coffee',
    'add:2 x Masala Dosa|1 x Butter Naan',
  ]);
});

test('make it three means set, not add three more', () => {
  assert.deepEqual(said('make it three coffee'), ['set:3 x Coffee']);
  assert.deepEqual(said('set two coffee'), ['set:2 x Coffee']);
});

test('send to kitchen is a command of its own, carried out last wherever it was said', () => {
  assert.deepEqual(said('send to kitchen'), ['place']);
  assert.deepEqual(said('send it to the kitchen'), ['place']);
  assert.deepEqual(said('place the order'), ['place']);
  assert.deepEqual(said("that's all"), ['place']);
  /* Said in the middle, still last: both halves are meant, in the only
     order that makes sense. */
  assert.deepEqual(said('two dosa, send to kitchen, and one coffee'), [
    'add:2 x Masala Dosa|1 x Coffee',
    'place',
  ]);
});

test('"send to kitchen" is never heard as "send two kitchen"', () => {
  /* "to" is also the number two. The verb has to be seen first. */
  const result = VoiceOrder.commands('send to kitchen', index, ItemSearch);
  assert.deepEqual(result, [{ verb: 'place', lines: [] }]);
});

test('clearing the cart comes first, so what follows is added to an empty one', () => {
  assert.deepEqual(said('start over, two coffee'), ['clear', 'add:2 x Coffee']);
  assert.deepEqual(said('clear the cart'), ['clear']);
});

test('reading it back is a command with no dishes', () => {
  assert.deepEqual(said("what's in the cart"), ['show']);
  assert.deepEqual(said('read it back'), ['show']);
});

test('filler does not become a dish', () => {
  assert.deepEqual(said('can you please add two coffee for the table'), ['add:2 x Coffee']);
  assert.deepEqual(said('um so like two coffee please'), ['add:2 x Coffee']);
});

test('a number inside a name survives a verb in front of it', () => {
  assert.deepEqual(said('add two chicken 65'), ['add:2 x Chicken 65']);
  assert.deepEqual(said('remove chicken 65'), ['remove:1 x Chicken 65']);
});

test('a dish not on the menu is kept in the command, never dropped', () => {
  const [command] = VoiceOrder.commands('add five widgets', index, ItemSearch);
  assert.equal(command.verb, 'add');
  assert.equal(command.lines[0].found, false);
  assert.equal(command.lines[0].quantity, 5);
});

test('"without" and "no" are notes on a dish, not removals', () => {
  /* "biryani without onion" is one biryani with a note. Reading "without" as
     a removal would take the biryani off. */
  assert.deepEqual(said('one chicken biryani without onion'), ['add:1 x Chicken Biryani']);
});

/*
 * HOW A DISH IS WANTED, and counting in the language people count in.
 *
 * Two things a waiter says every night that the parser used to throw away.
 */

const REQ_MENU = [
  'Chicken Biryani', 'Mutton Biryani', 'Chicken 65', 'Filter Coffee', 'Tea', 'Masala Dosa',
].map((name, id) => ({ id: String(id), name }));
const REQ_INDEX = ItemSearch.index(REQ_MENU);
const asked = (text) => VoiceOrder.understand(text, REQ_INDEX, ItemSearch);

/* -------------------------------------------------------- requirements */

test('a requirement after the dish is a note, not another dish', () => {
  const [line] = asked('two chicken biryani without onion');
  assert.equal(line.quantity, 2);
  assert.equal(line.item.name, 'Chicken Biryani');
  assert.equal(line.note, 'Without onion');
});

test('a requirement before the dish keeps the dish', () => {
  /* The marker takes itself and one word. Swallowing more would eat the
     dish it is describing. */
  const [line] = asked('no sugar coffee');
  assert.equal(line.item.name, 'Filter Coffee');
  assert.equal(line.note, 'No sugar');

  const [spicy] = asked('extra spicy mutton biryani');
  assert.equal(spicy.item.name, 'Mutton Biryani');
  assert.equal(spicy.note, 'Extra spicy');
});

test('a half plate is one line with a note, not half a line', () => {
  const [line] = asked('half plate chicken 65');
  assert.equal(line.quantity, 1);
  assert.equal(line.item.name, 'Chicken 65');
  assert.equal(line.note, 'Half plate');
});

test('one by two, which is ordered by the hundred every morning', () => {
  /* One drink poured into two cups. It changes what the kitchen does and not
     how many go on the bill, and it is said both ways round. */
  assert.equal(asked('one by two tea')[0].note, 'One by two');
  assert.equal(asked('tea one by two')[0].note, 'One by two');
  assert.equal(asked('one by two tea')[0].item.name, 'Tea');
});

test('a dish with no requirement carries no note', () => {
  assert.equal(asked('two chicken biryani')[0].note, '');
});

test('a requirement on its own is not a dish called onion', () => {
  /*
   * Nothing would be left to order, so nothing is split. Returning an empty
   * term would have the matcher search for nothing and hand back the first
   * thing on the menu, which is how somebody ends up with a biryani they
   * never mentioned.
   */
  assert.deepEqual(VoiceOrder.splitNote('no onion'), { term: 'no onion', note: '' });
  assert.deepEqual(VoiceOrder.splitNote('half'), { term: 'half', note: '' });
});

test('"less spicy" is a requirement, "less coffee" is a removal', () => {
  /*
   * THE SAME WORD, TWO JOBS. "less" is in the remove verbs and belongs there.
   * But "less spicy" takes nothing off anything, and reading it as a removal
   * both loses the requirement and deletes a dish nobody cancelled.
   */
  const mild = VoiceOrder.commands('one chicken biryani less spicy', REQ_INDEX, ItemSearch);
  assert.equal(mild.length, 1);
  assert.equal(mild[0].verb, 'add');
  assert.equal(mild[0].lines[0].item.name, 'Chicken Biryani');
  assert.equal(mild[0].lines[0].note, 'Less spicy');

  const fewer = VoiceOrder.commands('less coffee', REQ_INDEX, ItemSearch);
  assert.equal(fewer[0].verb, 'remove');
});

test('a requirement survives the whole command path', () => {
  const out = VoiceOrder.commands('add two chicken biryani without onion', REQ_INDEX, ItemSearch);
  assert.equal(out[0].verb, 'add');
  assert.equal(out[0].lines[0].note, 'Without onion');
  assert.equal(out[0].lines[0].quantity, 2);
});

/* ----------------------------------------------------- counting in Tamil */

test('a waiter counts plates in Tamil whatever the rest of the sentence is', () => {
  /*
   * "rendu chicken biryani" is two, and it is what gets said in a Tamil Nadu
   * dining room all evening. Spelled the way a recogniser set to English
   * transcribes the sound, because that is the only spelling that ever
   * arrives here.
   */
  assert.equal(asked('rendu chicken biryani')[0].quantity, 2);
  assert.equal(asked('moonu coffee')[0].quantity, 3);
  assert.equal(asked('naalu tea')[0].quantity, 4);
  assert.equal(asked('anju masala dosa')[0].quantity, 5);
  assert.equal(asked('onnu chicken 65')[0].quantity, 1);
});

test('and in Hindi one town over', () => {
  assert.equal(asked('teen coffee')[0].quantity, 3);
  assert.equal(asked('chaar tea')[0].quantity, 4);
  assert.equal(asked('paanch masala dosa')[0].quantity, 5);
});

test('"do" is NOT two, because it is a question', () => {
  /*
   * It is Hindi for two and also the commonest English auxiliary there is.
   * "do you have chicken biryani" would come through as two of something
   * called "have chicken biryani", which matches nothing - so a perfectly
   * good question becomes a silence. Two is the one number a waiter can
   * always say another way.
   */
  assert.equal(VoiceOrder.WORDS.do, undefined);
  const [line] = asked('do you have chicken biryani');
  assert.equal(line.quantity, 1);
});

test('the dish still has to be found after the number', () => {
  /* A number word alone changes nothing: the menu decides. */
  assert.equal(asked('rendu helicopter')[0].found, false);
});
