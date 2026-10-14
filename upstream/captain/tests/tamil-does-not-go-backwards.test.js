'use strict';

/*
 * TAMIL DOES NOT GO BACKWARDS.
 *
 * A sentence with no translation shows English. That is the right failure and
 * an invisible one: a screen half in English looks like a screen, not like a
 * bug. Left alone, a bilingual app becomes an English app one button at a
 * time, and nobody can say which change did it.
 *
 * So this counts what is still English in the markup and refuses a commit that
 * adds to it. It is a ratchet, not a bar: raise ALLOWED only by translating
 * something, never to get a commit through.
 *
 * WHAT IS ALLOWED TO STAY ENGLISH is listed by hand below, because "five are
 * missing" is a number somebody will eventually satisfy with the wrong five.
 */

const test = require('node:test');
const assert = require('node:assert');

const { fromMarkup, pack } = require('../scripts/tamil-gaps');

/*
 * English on purpose:
 *   Captain is the product name;
 *   the address line is sample text showing the SHAPE of an address;
 *   and "English" is the name of a language in its own language, which is how
 *     every language picker in the world writes it.
 */
const ENGLISH_ON_PURPOSE = [
  'Captain',
  'http://192.168.0.12:5555/api','https://azure.posnic.io/api','azure.posnic.io',
  'English',
];

test('every sentence on a screen has Tamil, or is one of the few that should not', () => {
  const words = pack();
  const missing = [...fromMarkup().keys()].filter((said) => !words[said]);

  const unexpected = missing.filter((said) => !ENGLISH_ON_PURPOSE.includes(said));

  assert.deepStrictEqual(
    unexpected,
    [],
    'These are on a screen with no Tamil. Add them to assets/common/locales/ta.json, ' +
      'or to ENGLISH_ON_PURPOSE here with a reason:\n  ' +
      unexpected.join('\n  ')
  );
});

test('the allowed list does not outlive what it allows', () => {
  /*
   * A list of exceptions nobody prunes is how the next person learns the rule
   * is decorative. If a sentence here has since been translated or deleted,
   * this says so rather than letting the list grow stale.
   */
  const words = pack();
  const onScreen = fromMarkup();

  const stale = ENGLISH_ON_PURPOSE.filter((said) => !onScreen.has(said) || words[said]);

  assert.deepStrictEqual(
    stale,
    [],
    'No longer needed in ENGLISH_ON_PURPOSE (translated or gone):\n  ' + stale.join('\n  ')
  );
});

test('the pack is words, not keys', () => {
  /*
   * The whole design rests on the key being the English sentence. An entry
   * like lang_move_table_2 would mean somebody started inventing names, and a
   * waiter would eventually read one on a screen.
   */
  const keys = Object.keys(pack());

  /*
   * An invented key looks like an identifier: a lang_ prefix, or snake_case.
   * A plain lowercase word is not one - "person" is a word a screen says, and
   * flagging it would make this test something people learn to work around.
   */
  const invented = keys.filter((key) => /^lang_/.test(key) || /^[a-z]+(_[a-z]+)+$/.test(key));

  assert.deepStrictEqual(invented, [], 'These read like invented keys, not sentences');
  assert.ok(keys.length > 100, 'the pack should hold the app, not a sample of it');
});
