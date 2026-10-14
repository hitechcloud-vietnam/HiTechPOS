/*
 * THE BILL, ASKED FOR FROM THE FLOOR.
 *
 * Owner: "can we add option from mobile take bill from mobile. is it
 * international standard or not ? ... also i was think settlement from mobile
 * app but usually cashier / desktop person only responsible and confirm the
 * settlement not waiter i thought."
 *
 * His reading is the standard one and it is the rule these tests hold:
 *
 *   A WAITER MAY ASK FOR THE BILL. A WAITER MAY NOT SAY IT WAS PAID.
 *
 * The person who takes the order must not be the person who declares the money
 * received, or a cash bill can be closed and pocketed with nothing in the
 * system to disagree. Toast, Square, Lightspeed, MICROS and Petpooja all let
 * the floor fire the bill; none of them settle it on the waiter's word.
 *
 * So most of this is about what the handset REFUSES to do.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const floor = fs.readFileSync(path.join(root, 'assets', 'kot', 'script.js'), 'utf8');

/**
 * Just the part that asks for a bill, WITH THE PROSE TAKEN OUT.
 *
 * The first version of this read the comments too, and failed on the word
 * "settle" inside a comment explaining that it must never settle. A test that
 * reads its own explanation is testing nothing.
 */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');

/*
 * THE WHOLE FILE FIRST, then the slice.
 *
 * Slicing first cuts into the middle of the block comment above the handler,
 * which leaves no opening /* for the stripper to find - so the prose survived
 * and the test failed on the word "settle" inside the comment explaining that
 * it must never settle. A test that reads its own explanation tests nothing.
 */
const code = withoutComments(floor);
const asking = code.slice(
  code.indexOf("closest('#ask-for-bill')") - 200,
  code.indexOf("closest('#ask-for-bill')") + 1400
);

test('the floor can ask for the bill', () => {
  assert.match(floor, /id="ask-for-bill"/, 'there is no way to ask for the bill');
  assert.match(asking, /\/sales\/requestBillPrint/, 'it does not ask the till for one');
});

test('it asks, and never settles', () => {
  /*
   * THE WHOLE RULE. If the handset ever posts a payment from here, a waiter
   * can close a bill and the cashier's drawer will never know.
   */
  for (const forbidden of ['payment_status', 'payment_mode', 'settle', 'markPaid', 'paid_amount']) {
    assert.ok(
      !asking.includes(forbidden),
      `the bill request writes ${forbidden}, which is the cashier's to write`
    );
  }
});

test('it names who asked, so an uncollected bill has a person on it', () => {
  assert.match(asking, /asked_by/, 'nobody is recorded as having asked');
});

test('the table it is asking about comes from the card, not from the heading', () => {
  /* The heading is words for a person to read and gets reworded. The same
     mistake one screen over is why tapping the takeaway card found nothing. */
  assert.match(floor, /data-table="\$\{escapeFloor\(tableName\)\}"/, 'the table is not carried on the button');
  assert.match(asking, /getAttribute\('data-table'\)/, 'the table is read from somewhere else');
});

test('an unscoped takeaway queue cannot request a collective table bill', () => {
  // Numbered orders can be billed individually. The legacy queue still
  // represents several customers and must never issue a shared bill.
  assert.match(floor, /isTakeaway && \(!targetSaleId \|\| alreadyPaid\)/, 'the legacy queue offers a bill without a selected sale');
  assert.match(asking, /saleId:button\.dataset\.saleId/, 'the selected takeaway identity is omitted from printing');
});

test('the button cannot be pressed twice into two bills', () => {
  assert.match(asking, /button\.disabled = true/, 'a second tap sends a second request');
});

test('the server\'s own words are shown, not a cheerful noise of our own', () => {
  /*
   * "The bill is on its way" and "nothing is open on that table" send a waiter
   * to two different places, and only the till knows which is true.
   */
  assert.match(asking, /answer && answer\.message/, 'the answer is replaced with our own wording');
});
