/*
 * A TABLE HAS NO PHONE NUMBER.
 *
 * Owner, holding a bill from Azure: "The captain app sends +910000000000
 * because something has to fill the field. why sendnig like this? i see that
 * in billig. why?"
 *
 * Because this app posts to an endpoint built for a customer ordering from
 * their OWN phone, where that field is the guest's number. A waiter at a table
 * has none, so the app invented one - and it printed on a customer's bill
 * under the customer line.
 *
 * The till has since learned to hide a number that is one repeated digit, so
 * nothing reaches paper any more. But the sale still STORED it: the phone
 * column of every sales report, and every lookup by number, carrying a number
 * nobody can ring. Empty is the truth, and nothing requires otherwise.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'indexedDB.js'), 'utf8');
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

test('no phone number is invented for a table order', () => {
  /*
   * Any repeated-digit number, not just the one that was there: 9999999999 and
   * 1111111111 are the same lie, and the till hides them for the same reason.
   */
  const invented = code.match(/customerMobile:\s*['"]([^'"]*)['"]/);
  assert.ok(invented, 'customerMobile is no longer sent at all - the till expects the field');
  const digits = invented[1].replace(/\D/g, '');
  assert.ok(
    digits === '' || !/^(\d)\1+$/.test(digits.slice(-10)),
    `a placeholder number is being sent: ${invented[1]}`
  );
});

test('the field is still sent, so the shape matches the storefront', () => {
  /* Dropping it would make this app post something subtly different from the
     customer page, and both go through one function on the till. */
  assert.match(code, /customerMobile:\s*''/);
});

test('nothing else in the app carries a made-up number', () => {
  const stray = code.match(/\+?91?0{8,}/g) || [];
  assert.deepStrictEqual(stray, [], 'a placeholder number is still hard-coded somewhere');
});
