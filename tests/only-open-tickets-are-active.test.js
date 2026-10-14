/*
 * "ACTIVE KOTs" HAS TO MEAN THE ONES THAT ARE STILL OPEN.
 *
 * Owner: "how come 3 orders in same table. need to check and fix."
 *
 * Three tickets on a table is an ordinary thing - a table that orders three
 * times has three tickets, each printed and cooked separately, and the times on
 * the cards tell them apart. What was wrong was the word ACTIVE.
 *
 * The floor draws itself from getTablesWithActiveOrders, which matches
 * `{ sale_process: KOT, payment_status: 'Unpaid' }` - so a table appears
 * because it has ONE open ticket. Tapping it asked for the table number and
 * nothing else, so the panel answered with every KOT ever written against that
 * table name, including ones settled and paid at earlier sittings, under a
 * badge counting them as active.
 *
 * The same shape as the takeaway card an hour earlier: two queries about the
 * same orders, agreeing on one clause and not the other. That is the thing
 * being pinned here, not the strings.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const floor = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'kot', 'script.js'),
  'utf8'
);

/** Just the part that asks the till for a table's tickets. */
const asking = floor.slice(
  floor.indexOf('const stillOpen'),
  floor.indexOf('getListKot', floor.indexOf('const stillOpen')) + 200
);

test('the panel asks only for tickets that are still open', () => {
  assert.match(asking, /payment_status:\s*'Unpaid'/, 'the panel still asks for every ticket ever');
});

test('a table and the takeaway queue are filtered the same way', () => {
  /*
   * Both come off the same floor, both are counted by the same badge. One of
   * them carrying the open-ticket clause and the other not is how a screen
   * ends up disagreeing with itself - which is exactly what happened when the
   * takeaway card matched on a different spelling from the floor.
   */
  assert.match(asking, /\.\.\.stillOpen,\s*dine_type/, 'takeaway is filtered differently');
  assert.match(asking, /\.\.\.stillOpen,\s*table_number/, 'a table is filtered differently');
});

test('it agrees with the query the floor itself is drawn from', () => {
  /*
   * getTablesWithActiveOrders is the other half and lives in the POS repo. The
   * two clauses it matches on are the two this has to carry, or a table can
   * appear on the floor and show nothing inside - or show things that are not
   * active, which is this bug.
   */
  for (const clause of ["sale_process: 'KOT'", "payment_status: 'Unpaid'"]) {
    assert.ok(asking.includes(clause), `the panel does not match on ${clause}`);
  }
});

test('the whole app is not hidden while one list loads', () => {
  /*
   * Owner: "instead of hiding whole app." showLoader paints a white sheet over
   * everything, so waiting for one list took the header and the buttons with
   * it - which on a slow shop Wi-Fi reads as a crash rather than a fetch.
   */
  const opening = floor.slice(floor.indexOf('await loadTables()') - 600, floor.indexOf('await loadTables()') + 40);
  assert.ok(!/showLoader\(\);/.test(opening), 'loading the tables still covers the whole screen');
  assert.match(floor, /class="floor-loading" role="status"/, 'initial orders load needs its own nonblocking status');
});

test('cancelling shows its progress on the button, not over the app', () => {
  /* The waiter is looking at the order they have just decided to cancel.
     Taking it off the screen removes the only thing that would let them check
     they picked the right one. */
  const cancelling = floor.slice(
    floor.indexOf("confirmBtn.textContent = 'Cancelling...'") - 400,
    floor.indexOf("confirmBtn.textContent = 'Cancelling...'") + 300
  );
  assert.match(cancelling, /confirmBtn\.disabled = true/, 'the confirm button can be pressed twice');
  assert.match(cancelling, /showSectionLoader\('sliding-panel-content'\)/, 'the panel has no loader of its own');
  assert.ok(!/showLoader\(\);/.test(cancelling), 'cancelling still hides the whole app');
});

test('the button comes back whatever happened', () => {
  /* A confirm dialog left saying "Cancelling..." for ever is a waiter who
     cannot try again and cannot tell why. */
  /*
   * Anchored on something only the cancel path has. There are two
   * hideSectionLoader('sliding-panel-content') calls - one closes the panel's
   * own load - and indexOf finds the wrong one.
   */
  const at = floor.indexOf('confirmBtn.disabled = false');
  assert.ok(at > -1, 'the confirm button is never re-enabled');
  const after = floor.slice(at - 300, at + 300);
  assert.match(after, /confirmBtn\.disabled = false/, 'the button is never re-enabled');
  assert.match(after, /hideSectionLoader/, 'the panel loader is never taken down');
});

/* --------------------------------------------------------------- the look */

test('the order panel wears the app, not a template', () => {
  /*
   * Owner: "avoid usual design of claude blue gradient. match with app and
   * professional design required."
   *
   * The panel shipped with a bootstrap template's gradients - a purple-blue
   * header, green badges, a blue Modify and a red Cancel, four hues on one
   * panel each with its own light source. Everything else in this app was
   * rebuilt on design.css: ink on paper, one line weight, one accent on the
   * single thing worth pressing.
   */
  const design = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'kot', 'floor.css'),
    'utf8'
  );
  const panel = design.slice(design.indexOf('.sliding-panel-header'));

  assert.ok(!/linear-gradient/.test(panel), 'the panel is still wearing a gradient');
  for (const token of ['var(--surface)', 'var(--ink)', 'var(--accent)', 'var(--line)']) {
    assert.ok(panel.includes(token), `the panel does not use ${token}`);
  }
});

test('cancel keeps a colour of its own, and is not the filled one', () => {
  /* It is the one control here that destroys a customer's food. It has to be
     findable and must never be what a thumb lands on by habit. */
  const design = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'kot', 'floor.css'),
    'utf8'
  );
  const cancel = design.slice(design.indexOf('.btn-cancel {'), design.indexOf('.btn-cancel {') + 220);
  assert.match(cancel, /color:\s*var\(--bad\)/, 'cancel has lost its warning colour');
  assert.match(cancel, /background:\s*var\(--surface\)/, 'cancel is filled, so it reads as the main action');
});
