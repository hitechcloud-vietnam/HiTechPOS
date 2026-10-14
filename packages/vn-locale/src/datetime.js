'use strict';

const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const cache = new Map();

function parts(date, timeZone) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new RangeError('Ngày không hợp lệ');
  let fmt = cache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    cache.set(timeZone, fmt);
  }
  const p = {};
  for (const { type, value } of fmt.formatToParts(d)) p[type] = value;
  return p;
}

/** "dd/MM/yyyy" in the given time zone (default Asia/Ho_Chi_Minh). */
function formatDateVN(date, { timeZone = DEFAULT_TIME_ZONE } = {}) {
  const p = parts(date, timeZone);
  return `${p.day}/${p.month}/${p.year}`;
}

/** "HH:mm dd/MM/yyyy" (or "HH:mm:ss dd/MM/yyyy" with seconds: true). */
function formatDateTimeVN(date, { timeZone = DEFAULT_TIME_ZONE, seconds = false } = {}) {
  const p = parts(date, timeZone);
  const time = `${p.hour}:${p.minute}${seconds ? `:${p.second}` : ''}`;
  return `${time} ${p.day}/${p.month}/${p.year}`;
}

module.exports = { DEFAULT_TIME_ZONE, formatDateVN, formatDateTimeVN };
