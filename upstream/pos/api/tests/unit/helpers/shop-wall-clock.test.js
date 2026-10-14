'use strict';

/*
 * E2E report: a sale rung up at ~17:00 on 14/10 in Vietnam showed in the
 * till's sales history as "15/10/2026 12:0x AM" - seven hours ahead. The till
 * sends the shop's wall clock ("2026/10/14 05:00 PM"); the server read it in
 * its own zone (UTC on a shard), stored 17:00Z, and the screen converted that
 * to Asia/Ho_Chi_Minh a second time.
 */
const { parseShopDate } = require('../../../src/helpers/shop-wall-clock');

const VN = 'Asia/Ho_Chi_Minh';

test("the till's wall clock is read in the branch's zone, whatever the server's zone", () => {
  // tests/setup-timezone.js pins the process to Asia/Kolkata: not the shop's zone.
  expect(parseShopDate('2026/10/14 05:00 PM', VN).toISOString()).toBe('2026-10-14T10:00:00.000Z');
  expect(parseShopDate('2026-10-14 17:05:30', VN).toISOString()).toBe('2026-10-14T10:05:30.000Z');
  expect(parseShopDate('2026/10/14 12:30 AM', VN).toISOString()).toBe('2026-10-13T17:30:00.000Z');
});

test('an instant stays the instant it names', () => {
  expect(parseShopDate('2026-10-14T10:00:00.000Z', VN).toISOString()).toBe('2026-10-14T10:00:00.000Z');
  expect(parseShopDate('2026-10-14T17:00:00+07:00', VN).toISOString()).toBe('2026-10-14T10:00:00.000Z');
  const d = new Date('2026-10-14T10:00:00Z');
  expect(parseShopDate(d, VN).getTime()).toBe(d.getTime());
  expect(parseShopDate(d.getTime(), VN).getTime()).toBe(d.getTime());
});

test('no usable branch zone keeps the old server-zone reading; no date means now', () => {
  expect(parseShopDate('2026/10/14 05:00 PM', '').getTime()).toBe(new Date('2026/10/14 05:00 PM').getTime());
  expect(parseShopDate('2026/10/14 05:00 PM', 'Not/AZone').getTime()).toBe(
    new Date('2026/10/14 05:00 PM').getTime()
  );
  const before = Date.now();
  expect(parseShopDate('', VN).getTime()).toBeGreaterThanOrEqual(before);
});
