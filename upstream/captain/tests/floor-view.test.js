/*
 * How long a table has been waiting, and what that should look like.
 *
 * Every rule here is a judgement about when a restaurant should start
 * worrying. A judgement nobody can see is a judgement nobody can correct, so
 * they are all in one testable place with the reasoning attached.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const FloorView = require(path.join(__dirname, '..', 'assets', 'common', 'floor-view.js'));

const NOW = Date.parse('2026-09-12T20:00:00.000Z');
const agoBy = (minutes) => new Date(NOW - minutes * 60000).toISOString();

/* ------------------------------------------------------------ the clock */

test('a wait is counted in whole minutes', () => {
  assert.equal(FloorView.minutesSince(agoBy(0), NOW), 0);
  assert.equal(FloorView.minutesSince(agoBy(7), NOW), 7);
  assert.equal(FloorView.minutesSince(agoBy(90), NOW), 90);
});

test('a clock ahead of the server does not show a negative wait', () => {
  /*
   * A handset's clock can be minutes ahead. "-3 min" is the sort of thing
   * that makes somebody stop believing the rest of the screen, so the future
   * is simply now.
   */
  assert.equal(FloorView.minutesSince(new Date(NOW + 300000).toISOString(), NOW), 0);
});

test('no time known is null, never zero', () => {
  /* Zero would read as "just sat down", which is the opposite of "we were
     not told" - and it would sort to the wrong end of the floor. */
  assert.equal(FloorView.minutesSince(null, NOW), null);
  assert.equal(FloorView.minutesSince('not a date', NOW), null);
  assert.equal(FloorView.minutesSince(undefined, NOW), null);
});

/* ------------------------------------------- when to start worrying */

test('the thresholds are deliberately generous', () => {
  /*
   * A floor that turns amber at ten minutes and red at twenty is a floor
   * where everything is red by eight o'clock - and a screen that is always
   * red is one nobody looks at, which also costs the times that matter.
   */
  assert.equal(FloorView.WAITING, 20);
  assert.equal(FloorView.LATE, 45);

  assert.equal(FloorView.age(0), 'fresh');
  assert.equal(FloorView.age(19), 'fresh');
  assert.equal(FloorView.age(20), 'waiting');
  assert.equal(FloorView.age(44), 'waiting');
  assert.equal(FloorView.age(45), 'late');
  assert.equal(FloorView.age(300), 'late');
});

test('an unknown wait gets no colour rather than a reassuring one', () => {
  /* Green would be a claim. Nothing is an honest answer. */
  assert.equal(FloorView.age(null), '');
  assert.equal(FloorView.age(undefined), '');
});

/* ---------------------------------------------------- said out loud */

test('a wait is rounded the way somebody would say it', () => {
  /* Nobody reports "87 minutes". They say "an hour and a half". */
  assert.equal(FloorView.saidAs(0), 'just now');
  assert.equal(FloorView.saidAs(1), '1 min');
  assert.equal(FloorView.saidAs(45), '45 min');
  assert.equal(FloorView.saidAs(60), '1 hr');
  assert.equal(FloorView.saidAs(87), '1 hr 27 min');
});

test('past three hours the minutes have stopped meaning anything', () => {
  assert.equal(FloorView.saidAs(200), '3 hr');
  assert.equal(FloorView.saidAs(400), '6 hr');
});

/* -------------------------------------------------------- the summary */

test('a table says how many tickets and what they come to', () => {
  assert.equal(FloorView.summary({ item_count: 1, amount: 420 }), '1 item · ₹420');
  assert.equal(FloorView.summary({ item_count: 12, amount: 1250 }), '12 items · ₹1250');
});

test('a zero total is left off rather than shown as a confident zero', () => {
  /* A shop whose KOT flow carries no totals would otherwise get a column of
     wrong zeroes down the whole floor. */
  assert.equal(FloorView.summary({ item_count: 2, amount: 0 }), '2 items');
  assert.equal(FloorView.summary(null), '');
});

/* ------------------------------------------------------ THE ORDER */

test('the table waiting longest is at the top', () => {
  /*
   * THE POINT OF THE SCREEN. Alphabetical puts table 1 first whether it has
   * been waiting a minute or an hour, which is the same as no order at all.
   * The table somebody should walk to is the one at the top.
   */
  const floor = FloorView.order(
    [
      { table_number: '1', since: agoBy(5) },
      { table_number: '2', since: agoBy(70) },
      { table_number: '3', since: agoBy(25) },
    ],
    NOW
  );
  assert.deepEqual(floor.map((t) => t.table_number), ['2', '3', '1']);
  assert.deepEqual(floor.map((t) => FloorView.age(t.minutes)), ['late', 'waiting', 'fresh']);
});

test('a table with no time known sorts last, not first', () => {
  /* An unknown is not an emergency, and a null sorting to the top would put
     the least informative card where the most urgent one belongs. */
  const floor = FloorView.order(
    [
      { table_number: 'A', since: null },
      { table_number: 'B', since: agoBy(3) },
    ],
    NOW
  );
  assert.deepEqual(floor.map((t) => t.table_number), ['B', 'A']);
});

test('tables with no times at all fall back to a natural sort', () => {
  /* Which is what an older till sends, and what this screen always did. */
  const floor = FloorView.order(
    [{ table_number: '10' }, { table_number: '2' }, { table_number: '1' }],
    NOW
  );
  assert.deepEqual(floor.map((t) => t.table_number), ['1', '2', '10']);
});

test('an empty floor is an empty list, not a crash', () => {
  assert.deepEqual(FloorView.order(null, NOW), []);
  assert.deepEqual(FloorView.order([], NOW), []);
});

/* ------------------------------------------------- an older till */

test('a till that sends only names still draws a floor', () => {
  /*
   * A handset can be pointed at a till that has not been updated, and that
   * one answers with names and nothing else. Every card degrades to what this
   * screen used to be - no worse than before, rather than blank.
   */
  assert.equal(FloorView.detailFor({}, '4'), null);
  assert.equal(FloorView.detailFor({ table_details: [] }, '4'), null);
  assert.equal(FloorView.age(null), '');
  assert.equal(FloorView.saidAs(null), '');
  assert.equal(FloorView.summary(null), '');
});

test('a table is found by name whatever type the name arrived as', () => {
  /* Table numbers are typed by hand and come back as strings, but a shop
     using plain numbers can produce either. */
  const data = { table_details: [{ table_number: 4, orders: 2, amount: 100 }] };
  assert.equal(FloorView.detailFor(data, '4').orders, 2);
  assert.equal(FloorView.detailFor(data, 4).orders, 2);
});

test('item count sums quantities and excludes cancelled and returned lines',()=>{
 assert.equal(FloorView.itemCount([{item_quantity:5},{quantity:7},{quantity:3,cancelled:true},{quantity:9,status:'cancelled'},{quantity:4,return:true}]),12);
 assert.equal(FloorView.summary({orders:1,amount:100}),'₹100');
});
