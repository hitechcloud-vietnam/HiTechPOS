'use strict';
/*
 * A table that cannot take another order says so, before the walk.
 *
 * The shop rule is a setting: one open order per table (the default), no
 * limit, or at most N. The server enforces it - there is more than one handset
 * and two waiters can tap Send on the same table in the same second - but a
 * rule only the server knows is one a waiter meets at the END, after choosing
 * the table, adding the dishes and pressing Place Order.
 *
 * This screen greyed out every table that had an order on it, which was right
 * only because the rule happened to be one. The question has to change from
 * "does this table have an order?" to "has this table reached its limit?", and
 * that needs the count, not just the name.
 *
 * Ported from Table_Order, where it was written first. The server half is POS
 * #681; until that is merged the limit arrives undefined, the fallback is 1,
 * and this screen behaves exactly as it did before - which is the point of
 * the fallback.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/**
 * The two decisions this screen makes, lifted out of discount.html and given
 * an answer from the server to work on.
 */
function floor({ tables = [], details = null, limit } = {}) {
  const html = read('discount.html');
  /* Lifted rather than retyped, so a change to the page fails here. */
  const openOnAt = html.indexOf('const openOn = (value) =>');
  const isFullAt = html.indexOf('const isFull = (value) =>');
  assert.ok(openOnAt !== -1, 'discount.html no longer decides how many orders a table has');
  assert.ok(isFullAt !== -1, 'discount.html no longer decides whether a table is full');
  const openOnSrc = html.slice(openOnAt, html.indexOf(';', html.indexOf(': 0)', openOnAt)) + 1);
  const isFullSrc = html.slice(isFullAt, html.indexOf(';', isFullAt) + 1);

  const openPerTable = {};
  (details || []).forEach((row) => {
    openPerTable[String(row.table_number)] = Number(row.orders) || 0;
  });
  const tableOrderLimit = Number.isFinite(Number(limit)) ? Number(limit) : 1;

  const make = new Function(
    'occupiedTables',
    'openPerTable',
    'tableOrderLimit',
    openOnSrc + '\n' + isFullSrc + '\n return { openOn, isFull, tableOrderLimit };'
  );
  return make(tables, openPerTable, tableOrderLimit);
}

test('the default rule is unchanged: a busy table is a full table', () => {
  const kit = floor({ tables: ['5'], details: [{ table_number: '5', orders: 1 }], limit: 1 });
  assert.strictEqual(kit.isFull('5'), true);
  assert.strictEqual(kit.isFull('6'), false);
});

test('no limit means nothing is ever full, however busy', () => {
  /* Zero is a real answer. This is why the page reads it with
     Number.isFinite and not `||`, which would turn a shop that deliberately
     allows any number back into a one-order shop. */
  const kit = floor({ tables: ['5'], details: [{ table_number: '5', orders: 9 }], limit: 0 });
  assert.strictEqual(kit.tableOrderLimit, 0);
  assert.strictEqual(kit.isFull('5'), false, 'a shop that allows any number had a table greyed out');
});

test('at most N: busy and full are different things', () => {
  const kit = floor({
    tables: ['5', '6'],
    details: [{ table_number: '5', orders: 2 }, { table_number: '6', orders: 3 }],
    limit: 3,
  });
  assert.strictEqual(kit.openOn('5'), 2);
  assert.strictEqual(kit.isFull('5'), false, 'a table at two of three was refused');
  assert.strictEqual(kit.isFull('6'), true, 'a table at its limit was still offered');
});

test('a server that sends no per-table detail still greys a busy table', () => {
  /* One order is the safe reading of a name with no count beside it, because
     it is what greys the table out under the default rule. */
  const kit = floor({ tables: ['5'], details: null, limit: undefined });
  assert.strictEqual(kit.tableOrderLimit, 1, 'an absent limit did not fall back to one');
  assert.strictEqual(kit.openOn('5'), 1);
  assert.strictEqual(kit.isFull('5'), true);
  assert.strictEqual(kit.isFull('7'), false);
});

test('the redraw key carries the counts, not just the names', () => {
  /*
   * This screen redraws only when that key changes, and under "at most N" a
   * table going from one order to two changes no NAME at all - so the badge
   * would freeze at whatever it said when the screen opened, and a table
   * reaching its limit would stay tappable right up to the refusal.
   */
  const html = read('discount.html');
  assert.match(html, /\[\.\.\.occupiedTables\]\.sort\(\)\.map\(\(name\) => name \+ ':' \+ openOn\(name\)\)/);
  assert.match(html, /\+ '\|' \+ tableOrderLimit/, 'a changed shop rule would not redraw the floor');
});

test('the count is shown only where it changes what a waiter does', () => {
  const html = read('discount.html');
  assert.match(html, /tableOrderLimit !== 1 && openHere > 0/);
  assert.match(html, /class="table-open-count"/);
  /* And it reads against the grey on a table that is full. */
  assert.match(read('assets', 'table', 'style.css'), /\.table-item\.table-occupied \.table-open-count/);
});

test('a full table says so before the walk, not after', () => {
  const html = read('discount.html');
  assert.match(html, /isOccupied \? 'This table is full' : ''/);
  assert.match(html, /const isOccupied = isFull\(value\) \|\|/);
  assert.ok(
    !/const isOccupied = occupiedTables\.includes\(value\)/.test(html),
    'the screen asks whether the table is busy again, not whether it is full'
  );
});
