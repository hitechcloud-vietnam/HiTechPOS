'use strict';

const { randomInt } = require('node:crypto');

/*
 * payOS requires a positive safe integer order code that is unique per
 * merchant channel. Millisecond time plus three random digits stays below
 * Number.MAX_SAFE_INTEGER (16 digits) until the year 2255 and makes a
 * collision require two checkouts in the same millisecond drawing the same
 * suffix; the journal's unique index is the final guard.
 */
function generateOrderCode(now = Date.now()) {
  const code = now * 1000 + randomInt(0, 1000);
  if (!Number.isSafeInteger(code)) throw new RangeError('order code overflow');
  return code;
}

module.exports = { generateOrderCode };
