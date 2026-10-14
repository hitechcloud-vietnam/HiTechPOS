/*
 * TAPPING THE TAKEAWAY CARD HAS TO OPEN THE TAKEAWAY QUEUE.
 *
 * Owner: "one order show as take away, when tap, inside shows no active
 * orders."
 *
 * The floor drew that card with the words "Take away". selectTable asked
 * whether the name was "Takeaway". One space apart, and nothing anywhere said
 * so - so the check failed, the else branch ran, and it went looking for a
 * table literally called "Take away". No sale has one: a takeaway carries a
 * dine_type, not a table number. The card was right, the queue was real, and
 * tapping it reported nothing there.
 *
 * Two strings that have to match, written four hundred lines apart, is the
 * thing being tested here - not the strings themselves.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'kot', 'script.js'),
  'utf8'
);

test('the card says what it is, rather than being known by its label', () => {
  /* A label is written for a person to read and gets reworded; a marker is
     written for the code and does not. */
  assert.match(source, /data-takeaway="true"/, 'the takeaway card carries no marker');
  assert.match(
    source,
    /selectTable\(card\.getAttribute\('data-table-number'\), card\.hasAttribute\('data-takeaway'\),\s*\{saleId: card\.dataset\.saleId\}\)/,
    'the marker is not passed on when the card is tapped'
  );
});

test('nothing decides this by comparing against one exact spelling', () => {
  /*
   * `tableName === 'Takeaway'` was the whole bug. order-history.js has always
   * had to accept both spellings because the data uses both, so a single
   * exact comparison was never going to hold.
   */
  assert.ok(
    !/tableName === 'Takeaway'/.test(source),
    'the exact-spelling comparison is back'
  );
  assert.match(source, /function isTakeawayName/, 'there is no tolerant check');
});

test('both spellings, and any spacing, are read as takeaway', () => {
  /* Exercised rather than eyeballed. */
  const body = source.slice(source.indexOf('function isTakeawayName'));
  const fn = new Function('return ' + body.slice(0, body.indexOf('\n}') + 2))();

  for (const said of ['Takeaway', 'Take away', 'take away', 'TAKEAWAY', ' Take  Away ']) {
    assert.equal(fn(said), true, `${JSON.stringify(said)} was not read as takeaway`);
  }
  for (const said of ['T1', 'Table 4', '', null, 'Takeaway counter']) {
    assert.equal(fn(said), false, `${JSON.stringify(said)} was read as takeaway`);
  }
});

test('the takeaway queue is asked for by dine_type, not by table number', () => {
  /* Which is the reason the wrong branch found nothing: a takeaway has no
     table number to be found by. */
  const fn = source.slice(source.indexOf('async function selectTable'));
  assert.match(fn, /if \(isTakeaway\) \{[^}]*dine_type: 'Take away'/s, 'the queue is not asked for by dine_type');
  assert.match(fn, /table_number: tableName/, 'a real table is no longer asked for by number');
});

test('an empty takeaway queue says so in its own words', () => {
  /* "No active orders for this table" under a heading that says Takeaway is
     the screen disagreeing with itself. */
  assert.match(source, /No active takeaway orders/, 'the empty takeaway queue still talks about a table');
});
