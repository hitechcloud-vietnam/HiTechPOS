/*
 * The "Other" box on the table screen, and why its text was invisible.
 *
 * Owner: "table number to enter in others input box 'others' text not
 * visible. 'RS' text not visible."
 *
 * Nothing was hiding it. #manual_table_input is written for the full-width box
 * a shop with no tables laid out gets - 16px of padding on each side, centred,
 * max-width 320px. The SAME id also appears inside the last chip of the table
 * grid, and a chip is 78px wide: 8px of label padding and 16px of the input's
 * own padding on each side leave about 26px of content box. The placeholder
 * "Other", and every table number typed after it, was being drawn outside the
 * input and clipped.
 *
 * An id beats a class, so the chip's own rules have to be at least as specific
 * to undo it. That is the thing this file pins: a rule weak enough to lose
 * puts the text back outside the box, and nothing on screen says so.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'table', 'seat.css'), 'utf8');

/** Just the block that styles the input inside the chip. */
const chip = css.slice(css.indexOf('.table-list .manual-label #manual_table_input'));

test('the chip rule is specific enough to beat the bare id', () => {
  /*
   * `#manual_table_input { padding: var(--s3) var(--s4) }` is one id. A rule
   * that is only `.manual-table-input` is one class and loses to it silently -
   * which is how style.css's own attempt at this had no effect at all.
   */
  assert.match(
    css,
    /\.table-list \.manual-label #manual_table_input\s*\{/,
    'the chip input is not styled through a selector that outranks the bare id'
  );
});

test('the side padding that was eating the word is gone', () => {
  const block = chip.slice(0, chip.indexOf('}'));
  assert.match(block, /padding:\s*0 var\(--s2/, 'the input keeps the full-width box padding');
  assert.match(block, /max-width:\s*none/, 'the 320px cap is still on a 78px chip');
});

test('the chip is wide enough for a word rather than a number', () => {
  /* Every other cell holds "T1". This one holds "Other" and then whatever is
     typed over it, so it takes two cells of the grid. */
  assert.match(
    css,
    /\.table-list \.manual-table\s*\{[^}]*grid-column:\s*span 2/,
    'the Other chip is still one 78px cell'
  );
});

test('the text follows the chip, which is white until it is picked', () => {
  /*
   * A picked chip is painted with the accent and its ink goes white. A fixed
   * colour on the input is legible in exactly one of those two states, and
   * which one depends on which the waiter is looking at.
   */
  const block = chip.slice(0, chip.indexOf('}'));
  assert.match(block, /color:\s*inherit/, 'the typed number does not follow the chip it sits in');
  assert.match(chip, /::placeholder\s*\{[^}]*color:\s*currentColor/, 'the placeholder does not either');
});

test('the focus ring is on the chip, not on a box inside it', () => {
  /* The input has no border of its own in here, so a ring drawn on it would
     appear inside the chip's own outline. */
  assert.match(css, /\.table-list \.manual-label:focus-within\s*\{[^}]*outline:/, 'nothing shows focus');
});
