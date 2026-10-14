/*
 * Time-based billing for rooms and tables: karaoke rooms, billiard tables,
 * courts, game rooms. Pure functions only; also bundled in the UI so the
 * running clock can show the same estimate the server will charge.
 *
 * A session is billed in whole blocks (for example 15 minutes), with a
 * minimum number of blocks and an optional grace period for the last,
 * partial block. The billed window [start, start + billed) is then split by
 * the shop's local time of day into the base rate and optional rate bands
 * (daytime/evening, "giờ vàng"). Each rate becomes one order line whose
 * quantity is hours and whose unit price is the hourly rate.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PosnicTimeBilling = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 1440;
  // Asia/Ho_Chi_Minh has been UTC+7 all year since 1975 (no daylight saving),
  // so a fixed offset is exact and does not depend on the host's time zone.
  const VIETNAM_OFFSET_MINUTES = 420;
  const MAX_RATE = 1000000; // the variable-price ceiling of the pricing authority
  const MAX_BANDS = 6;
  const LINE_PREFIX = 'tb-';

  function fail(message) {
    throw new Error(message);
  }
  function integer(value, label, min, max, fallback) {
    if (value === undefined || value === null || value === '') {
      if (fallback !== undefined) return fallback;
      fail(label + ' is required.');
    }
    const n = Number(value);
    if (typeof value === 'boolean' || !Number.isInteger(n) || n < min || n > max)
      fail(label + ' must be a whole number from ' + min + ' to ' + max + '.');
    return n;
  }
  /** 'HH:MM' -> minutes after midnight (0..1440), or NaN. */
  function clock(value) {
    const m = /^([01]?\d|2[0-4]):([0-5]\d)$/.exec(String(value == null ? '' : value).trim());
    if (!m) return NaN;
    const minutes = Number(m[1]) * 60 + Number(m[2]);
    return minutes > DAY ? NaN : minutes;
  }
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }
  /** Local minute index -> 'HH:MM'. */
  function formatClock(localMinute) {
    const m = ((Math.floor(localMinute) % DAY) + DAY) % DAY;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  /**
   * Validate a table's time-billing settings. Returns null when time billing
   * is off. Accepts a JSON string (form posts) or an object.
   */
  function normalizeConfig(input) {
    if (input === undefined || input === null || input === '' || input === false) return null;
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input);
      } catch (_) {
        fail('Time billing settings are not valid.');
      }
      if (input === null) return null;
    }
    if (typeof input !== 'object' || Array.isArray(input))
      fail('Time billing settings are not valid.');
    if (input.enabled === false || input.enabled === 'false' || input.enabled === 0) return null;
    const itemId = String(input.item_id == null ? '' : input.item_id).trim();
    if (!/^[a-f0-9]{24}$/i.test(itemId)) fail('Choose the item that time is billed as.');
    const rate = integer(input.rate, 'Hourly rate', 1, MAX_RATE);
    const block = integer(input.block_minutes, 'Block length', 1, 240, 15);
    const minBlocks = integer(input.min_blocks, 'Minimum blocks', 1, 96, 1);
    const grace = integer(input.grace_minutes, 'Grace minutes', 0, block - 1, 0);
    const rawBands = input.bands == null || input.bands === '' ? [] : input.bands;
    if (!Array.isArray(rawBands)) fail('Rate bands are not valid.');
    const bands = rawBands
      .filter(function (b) {
        return b && (String(b.start || '').trim() || String(b.end || '').trim() || b.rate);
      })
      .map(function (b) {
        const start = clock(b.start),
          end = clock(b.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start === end || start === DAY)
          fail('Enter each rate band as a start and end time, for example 18:00 to 23:00.');
        const label = String(b.label == null ? '' : b.label).trim();
        if (
          label.length > 30 ||
          Array.from(label).some(function (ch) {
            return ch.charCodeAt(0) < 32;
          })
        )
          fail('Enter a band name of up to 30 characters.');
        return {
          start: formatClock(start),
          end: end === DAY ? '24:00' : formatClock(end),
          rate: integer(b.rate, 'Band rate', 1, MAX_RATE),
          label: label,
        };
      });
    if (bands.length > MAX_BANDS) fail('Use up to ' + MAX_BANDS + ' rate bands.');
    return {
      item_id: itemId.toLowerCase(),
      rate: rate,
      block_minutes: block,
      min_blocks: minBlocks,
      grace_minutes: grace,
      bands: bands,
    };
  }

  /** Which band (index) applies at a local minute of the day, or -1 for the base rate. */
  function bandAt(bands, minuteOfDay) {
    for (let i = 0; i < bands.length; i++) {
      const s = clock(bands[i].start),
        e = clock(bands[i].end);
      if (s < e ? minuteOfDay >= s && minuteOfDay < e : minuteOfDay >= s || minuteOfDay < e)
        return i;
    }
    return -1;
  }
  function time(value) {
    const ms =
      value instanceof Date
        ? value.getTime()
        : typeof value === 'number'
          ? value
          : Date.parse(value);
    if (!Number.isFinite(ms)) fail('A valid time is required.');
    return ms;
  }
  function roundTo(value, digits) {
    const f = Math.pow(10, digits || 0);
    return Math.round(value * f) / f;
  }

  /**
   * Price a session.
   *
   * @param {Object} config  normalized settings (normalizeConfig)
   * @param {Date|number|string} startedAt
   * @param {Date|number|string} endedAt
   * @param {Object} [options] { offsetMinutes = 420 (Asia/Ho_Chi_Minh), digits = 0 }
   * @returns {{elapsed_minutes, blocks, billed_minutes, lines, amount}}
   *   lines: [{ key, line_id, rate, label, band, minutes, quantity, amount, ranges }]
   *   quantity is hours (minutes / 60); amount = round(rate * quantity).
   */
  function quote(config, startedAt, endedAt, options) {
    options = options || {};
    const offset = options.offsetMinutes == null ? VIETNAM_OFFSET_MINUTES : options.offsetMinutes;
    const digits = options.digits || 0;
    const start = time(startedAt),
      end = Math.max(start, time(endedAt));
    const blockMs = config.block_minutes * 60000,
      graceMs = (config.grace_minutes || 0) * 60000,
      elapsedMs = end - start;
    const full = Math.floor(elapsedMs / blockMs);
    let blocks = full + (elapsedMs - full * blockMs > graceMs ? 1 : 0);
    blocks = Math.max(blocks, config.min_blocks || 1);
    const billed = blocks * config.block_minutes;
    const bands = config.bands || [];
    const startLocal = Math.floor(start / 60000) + offset;
    const endLocal = Math.floor(end / 60000) + offset;
    const lines = [],
      byKey = {};
    let run = null;
    for (let i = 0; i < billed; i++) {
      const minute = startLocal + i;
      const band = bandAt(bands, ((minute % DAY) + DAY) % DAY);
      const key = band < 0 ? 'base' : 'b' + band;
      let line = byKey[key];
      if (!line) {
        line = byKey[key] = {
          key: key,
          line_id: LINE_PREFIX + key,
          band: band,
          rate: band < 0 ? config.rate : bands[band].rate,
          label: band < 0 ? '' : bands[band].label || '',
          minutes: 0,
          ranges: [],
        };
        lines.push(line);
      }
      line.minutes++;
      if (!run || run.key !== key) {
        run = { key: key, from: minute, to: minute + 1 };
        line.ranges.push(run);
      } else run.to = minute + 1;
    }
    let amount = 0;
    lines.forEach(function (l) {
      l.quantity = l.minutes / 60;
      l.amount = roundTo(l.rate * l.quantity, digits);
      amount += l.amount;
      l.ranges = l.ranges.map(function (r) {
        // Show the real leaving time when it falls inside this stretch; the
        // rest of the block is still charged, as the duration says.
        const to = endLocal > r.from && endLocal < r.to ? endLocal : r.to;
        return { from: formatClock(r.from), to: formatClock(to) };
      });
    });
    return {
      elapsed_minutes: Math.floor(elapsedMs / 60000),
      blocks: blocks,
      billed_minutes: billed,
      lines: lines,
      amount: roundTo(amount, digits),
    };
  }

  function vietnamese(lang) {
    return !lang || /^vi\b/i.test(String(lang));
  }
  /** 95 -> '1 giờ 35 phút' (vi) or '1 h 35 min'. */
  function formatDuration(minutes, lang) {
    minutes = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(minutes / 60),
      m = minutes % 60;
    const vi = vietnamese(lang);
    const parts = [];
    if (h) parts.push(h + (vi ? ' giờ' : ' h'));
    if (m || !h) parts.push(m + (vi ? ' phút' : ' min'));
    return parts.join(' ');
  }
  /** 'Giờ hát VIP1 · 19:05-20:40 · 1 giờ 45 phút (Giờ vàng)' */
  function lineName(itemName, tableLabel, line, lang) {
    const head = [String(itemName || '').trim(), String(tableLabel || '').trim()]
      .filter(Boolean)
      .join(' ');
    const ranges = line.ranges
      .map(function (r) {
        return r.from + '-' + r.to;
      })
      .join(', ');
    let name = [head, ranges, formatDuration(line.minutes, lang)].filter(Boolean).join(' · ');
    if (line.label) name += ' (' + line.label + ')';
    return name.slice(0, 200);
  }
  function isTimeLine(line) {
    return !!line && line.time_billing_line === true;
  }

  return {
    VIETNAM_OFFSET_MINUTES: VIETNAM_OFFSET_MINUTES,
    MAX_RATE: MAX_RATE,
    LINE_PREFIX: LINE_PREFIX,
    normalizeConfig: normalizeConfig,
    quote: quote,
    bandAt: bandAt,
    clock: clock,
    formatClock: formatClock,
    formatDuration: formatDuration,
    lineName: lineName,
    isTimeLine: isTimeLine,
  };
});
