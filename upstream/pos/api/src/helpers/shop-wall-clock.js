'use strict';

/*
 * A sale date the till sends ("2026/10/14 05:00 PM" from #time-format) is the
 * shop's wall clock. `new Date(text)` read it in the SERVER's zone, so a shard
 * running in UTC stored a 17:00 Vietnamese sale as 17:00Z - and every screen
 * that converts back to the shop's zone then showed it seven hours ahead
 * ("15/10/2026 12:05 AM"). Read it in the branch's own time zone instead.
 *
 * A value that already names its zone (an ISO stamp with Z or an offset), a
 * Date, or a timestamp is an instant and is kept as it is. With no valid
 * branch zone the old server-zone parse is kept.
 */
const moment = require('moment-timezone');

const SHAPES = [
  'YYYY/MM/DD hh:mm A',
  'YYYY/MM/DD h:mm A',
  'YYYY/MM/DD HH:mm',
  'YYYY/MM/DD HH:mm:ss',
  'YYYY-MM-DD hh:mm A',
  'YYYY-MM-DD HH:mm',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DDTHH:mm',
  'YYYY-MM-DDTHH:mm:ss',
  'YYYY-MM-DDTHH:mm:ss.SSS',
  'MM/DD/YYYY hh:mm A',
  'YYYY/MM/DD',
  'YYYY-MM-DD',
];

function parseShopDate(input, timeZone) {
  if (input === undefined || input === null || input === '') return new Date();
  if (input instanceof Date || typeof input === 'number') return new Date(input);
  const text = String(input).trim();
  const zone = typeof timeZone === 'string' && moment.tz.zone(timeZone) ? timeZone : '';
  if (!zone || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return new Date(text);
  const local = moment.tz(text, SHAPES, true, zone);
  return local.isValid() ? local.toDate() : new Date(text);
}

module.exports = { parseShopDate };
