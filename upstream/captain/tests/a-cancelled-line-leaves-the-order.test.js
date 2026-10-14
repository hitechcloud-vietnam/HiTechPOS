/*
 * A CANCELLED LINE ACTUALLY LEAVES THE ORDER.
 *
 * From a live floor at Azure, 14-09-2026: "item cancel is not working. i
 * cancel one item and updated button. it closed. i dont see any print is
 * printed. also i went again inside same order its not cancelled."
 *
 * Three symptoms, one cause. A cancelled line is KEPT on the screen with
 * quantity 0 so it can be shown struck through - that is deliberate, it is how
 * a waiter sees what was taken off. But the line still carries `item_quantity`
 * from the till, its quantity before the strike, and the payload read
 * `item.quantity || item.item_quantity`.
 *
 * Zero is falsy. So the cancelled dish went back to the till at its ORIGINAL
 * quantity, the till saw an order identical to the one it already had,
 * cancelled nothing, wrote no cancellation into the order's history, and
 * therefore sent no new ticket to the kitchen. The modal closed on success
 * because the save genuinely succeeded - it just said nothing had changed.
 *
 * A reduction from 2 to 1 was never affected, because 1 is truthy. Only
 * cancelling was, which is exactly why it shipped.
 *
 * The till rebuilds an order from the lines it receives, so what is ABSENT is
 * what is cancelled. These pin that.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HISTORY = fs.readFileSync(
  path.join(ROOT, 'assets', 'order-history', 'script.js'),
  'utf8'
);

/** Lift one `function name(...) {...}` out by brace matching. */
function lift(source, name) {
  const from = source.indexOf(`function ${name}(`);
  assert.notStrictEqual(from, -1, `${name} is gone - renamed, or inlined back?`);
  let depth = 0;
  for (let i = source.indexOf('{', from); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  throw new Error(`${name} never closes`);
}

// eslint-disable-next-line no-new-func
const { lineQuantity, linesForSave } = new Function(
  `${lift(HISTORY, 'lineIsCancelled')}\n` +
  `${lift(HISTORY, 'lineQuantity')}\n${lift(HISTORY, 'linesForSave')}\n` +
    'return { lineQuantity, linesForSave };'
)();

/* The shape a line really has in the edit screen: `item_quantity` straight
   from the till, `quantity` the number the waiter is moving. */
const ordered = (over = {}) => ({
  item_id: '68b0f1c2d3e4f5a6b7c8d9e0',
  item_name: 'Mutton Ghee Roast',
  name: 'Mutton Ghee Roast',
  item_quantity: 1,
  quantity: 1,
  price: 330,
  ...over,
});

/* What confirmRemoveItem does to a line the kitchen already knows about. */
const struckOff = (over = {}) =>
  ordered({ quantity: 0, cancelled: true, cancelled_quantity: 1, ...over });

test('a cancellation flag excludes a line even when its original quantity remains', () => {
  assert.deepStrictEqual(linesForSave([ordered({ cancelled: true })]), []);
  assert.deepStrictEqual(linesForSave([ordered({ status: 'cancelled' })]), []);
});

/* ------------------------------------------------------- one line's number */

test('a struck-off line counts as none, whatever the till said before', () => {
  /* THE BUG, in one assertion. This returned 1. */
  assert.strictEqual(lineQuantity(struckOff()), 0);
});

test('an untouched line keeps the number it arrived with', () => {
  assert.strictEqual(lineQuantity(ordered()), 1);
  assert.strictEqual(lineQuantity(ordered({ quantity: 3, item_quantity: 3 })), 3);
});

test('a reduction is the new number, not the old one', () => {
  /* Never broken - 1 is truthy - and pinned so a fix for the zero cannot
     quietly cost the reduction. */
  assert.strictEqual(lineQuantity(ordered({ item_quantity: 2, quantity: 1 })), 1);
});

test('a line that only ever had item_quantity still counts', () => {
  /* Straight from the till, before the edit screen normalises anything. */
  const raw = { item_id: 'x', item_name: 'Coffee', item_quantity: 2 };
  assert.strictEqual(lineQuantity(raw), 2);
});

test('nonsense counts as none rather than as one', () => {
  assert.strictEqual(lineQuantity(null), 0);
  assert.strictEqual(lineQuantity({}), 0);
  assert.strictEqual(lineQuantity({ quantity: '' }), 0);
  assert.strictEqual(lineQuantity({ quantity: 'two' }), 0);
  assert.strictEqual(lineQuantity({ quantity: -1 }), 0);
});

/* --------------------------------------------------- the payload as a whole */

test('the cancelled dish is ABSENT, which is how the till cancels it', () => {
  /*
   * Not sent as a zero: the till rebuilds the order from what arrives, writes
   * what did not arrive into the order's history as a cancellation, and that
   * is the same event that puts a fresh ticket in the kitchen. A zero in the
   * list would be an item it keeps.
   */
  const lines = linesForSave([
    struckOff(),
    ordered({ item_id: 'b2', item_name: 'Karaikudi Mutton Uppu Kari' }),
  ]);

  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].item_name, 'Karaikudi Mutton Uppu Kari');
  assert.ok(
    !lines.some((l) => l.item_name === 'Mutton Ghee Roast'),
    'the cancelled dish was sent back to the till'
  );
});

test('the surviving line carries an id the till can match', () => {
  /* The till matches on item_id; without one it cannot tell an edit from a
     brand new dish, and the order grows a duplicate. */
  const [line] = linesForSave([ordered()]);
  assert.strictEqual(line.product_id, '68b0f1c2d3e4f5a6b7c8d9e0');
  assert.strictEqual(line.quantity, 1);
  assert.strictEqual(line.price, 330);
});

test('a dish added in this session is sent, id and all', () => {
  const added = {
    product_id: 'new-1',
    name: 'Filter Coffee',
    quantity: 2,
    price: 40,
  };
  const lines = linesForSave([struckOff(), added]);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].product_id, 'new-1');
  assert.strictEqual(lines[0].quantity, 2);
});

test('striking everything off leaves nothing to send', () => {
  /*
   * Which the till refuses, correctly: an order with no lines is not the same
   * request as "cancel this order". The screen says so in words and points at
   * the button that does mean that.
   */
  assert.deepStrictEqual(linesForSave([struckOff(), struckOff({ item_id: 'b2' })]), []);
});

test('the screen says which button to use instead of showing a server error', () => {
  assert.match(HISTORY, /Nothing left on this order\. Use Cancel order instead\./);
  assert.match(
    HISTORY,
    /if \(lines\.length === 0\)/,
    'an empty list is still posted and refused by the till'
  );
});

test("nothing else builds the payload behind this function's back", () => {
  /*
   * The old expression, in any form, would bring the bug straight back.
   * Scanned with the comments removed, because the function that replaced it
   * quotes the bad line in its own explanation - and that explanation is worth
   * more than a regex that cannot tell code from prose.
   */
  const code = HISTORY.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  assert.ok(
    !/item\.quantity \|\| item\.item_quantity/.test(code),
    'the falsy-zero read is back in the file'
  );
  assert.match(code, /items: lines,/, 'the save no longer sends linesForSave output');
});
