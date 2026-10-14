'use strict';
const tb = require('../../../src/utils/time-billing');

// Vietnam is UTC+7: 19:05 in Ho Chi Minh City is 12:05Z.
const vn = (hhmm, day = '2026-10-14') => new Date(`${day}T${hhmm}:00+07:00`);
const config = (extra = {}) =>
  tb.normalizeConfig({
    item_id: 'a'.repeat(24),
    rate: 120000,
    block_minutes: 15,
    min_blocks: 1,
    ...extra,
  });

describe('normalizeConfig', () => {
  test('off when empty, disabled or null JSON', () => {
    expect(tb.normalizeConfig(undefined)).toBeNull();
    expect(tb.normalizeConfig('')).toBeNull();
    expect(tb.normalizeConfig('null')).toBeNull();
    expect(tb.normalizeConfig({ enabled: false, item_id: 'x' })).toBeNull();
  });
  test('defaults and JSON strings', () => {
    expect(tb.normalizeConfig(JSON.stringify({ item_id: 'A'.repeat(24), rate: '90000' }))).toEqual({
      item_id: 'a'.repeat(24),
      rate: 90000,
      block_minutes: 15,
      min_blocks: 1,
      grace_minutes: 0,
      bands: [],
    });
  });
  test('rejects fractional or out-of-range money and bad bands', () => {
    expect(() => config({ rate: 120000.5 })).toThrow(/whole number/);
    expect(() => config({ rate: 0 })).toThrow(/Hourly rate/);
    expect(() => config({ rate: 1000001 })).toThrow(/Hourly rate/);
    expect(() => config({ item_id: 'nope' })).toThrow(/item/);
    expect(() => config({ grace_minutes: 15 })).toThrow(/Grace/);
    expect(() => config({ bands: [{ start: '18:00', end: '18:00', rate: 1 }] })).toThrow(/band/);
    expect(() => config({ bands: [{ start: '25:00', end: '01:00', rate: 1 }] })).toThrow(/band/);
    expect(() =>
      config({
        bands: Array.from({ length: 7 }, () => ({ start: '01:00', end: '02:00', rate: 1 })),
      })
    ).toThrow(/6/);
  });
  test('blank band rows are ignored, 24:00 is kept', () => {
    expect(
      config({
        bands: [
          { start: '', end: '', rate: '' },
          { start: '18:00', end: '24:00', rate: 150000, label: ' Buổi tối ' },
        ],
      }).bands
    ).toEqual([{ start: '18:00', end: '24:00', rate: 150000, label: 'Buổi tối' }]);
  });
});

describe('quote', () => {
  test('1 h 35 min at 120.000 đ/h in 15-minute blocks bills 1 h 45 min = 210.000 đ', () => {
    const q = tb.quote(config(), vn('19:05'), vn('20:40'));
    expect(q).toMatchObject({
      elapsed_minutes: 95,
      blocks: 7,
      billed_minutes: 105,
      amount: 210000,
    });
    expect(q.lines).toEqual([
      expect.objectContaining({
        line_id: 'tb-base',
        rate: 120000,
        minutes: 105,
        quantity: 1.75,
        amount: 210000,
        ranges: [{ from: '19:05', to: '20:40' }],
      }),
    ]);
  });
  test('exact blocks are not rounded up; one second over starts a new block', () => {
    expect(tb.quote(config(), vn('19:00'), vn('20:00')).billed_minutes).toBe(60);
    expect(
      tb.quote(config(), vn('19:00'), new Date(vn('20:00').getTime() + 1000)).billed_minutes
    ).toBe(75);
  });
  test('minimum blocks apply to a short or zero-length session', () => {
    const c = config({ block_minutes: 30, min_blocks: 2 });
    expect(tb.quote(c, vn('19:00'), vn('19:00'))).toMatchObject({ blocks: 2, amount: 120000 });
    expect(tb.quote(c, vn('19:00'), vn('19:40'))).toMatchObject({ blocks: 2, billed_minutes: 60 });
    // An end before the start is treated as no time at all.
    expect(tb.quote(c, vn('19:00'), vn('18:00')).blocks).toBe(2);
  });
  test('grace minutes forgive a short remainder only', () => {
    const c = config({ grace_minutes: 5 });
    expect(tb.quote(c, vn('19:00'), vn('20:05')).billed_minutes).toBe(60);
    expect(tb.quote(c, vn('19:00'), vn('20:06')).billed_minutes).toBe(75);
  });
  test('per-minute billing keeps whole-đồng amounts from exact hour fractions', () => {
    const c = config({ rate: 100000, block_minutes: 1 });
    const q = tb.quote(c, vn('10:00'), vn('11:35'));
    expect(q.billed_minutes).toBe(95);
    expect(q.amount).toBe(158333); // 100000 * 95 / 60 = 158333.33
    expect(Number.isInteger(q.amount)).toBe(true);
  });
  test('evening band splits the session into two lines', () => {
    const c = config({
      rate: 80000,
      block_minutes: 30,
      bands: [{ start: '18:00', end: '24:00', rate: 150000, label: 'Buổi tối' }],
    });
    const q = tb.quote(c, vn('17:10'), vn('18:40'));
    // 90 min elapsed -> 3 blocks: 17:10-18:00 at base, 18:00-18:40 at the band
    expect(q.billed_minutes).toBe(90);
    expect(q.lines.map((l) => [l.line_id, l.minutes, l.amount])).toEqual([
      ['tb-base', 50, 66667],
      ['tb-b0', 40, 100000],
    ]);
    expect(q.amount).toBe(166667);
    expect(q.lines[1].ranges).toEqual([{ from: '18:00', to: '18:40' }]);
  });
  test('overnight band wraps midnight and the base rate resumes in the morning', () => {
    const c = config({
      rate: 60000,
      block_minutes: 60,
      bands: [{ start: '22:00', end: '06:00', rate: 90000 }],
    });
    const q = tb.quote(c, vn('21:00'), vn('07:00', '2026-10-15'));
    expect(q.billed_minutes).toBe(600);
    const base = q.lines.find((l) => l.key === 'base');
    const night = q.lines.find((l) => l.key === 'b0');
    expect(base).toMatchObject({ minutes: 120, amount: 120000 });
    expect(base.ranges).toEqual([
      { from: '21:00', to: '22:00' },
      { from: '06:00', to: '07:00' },
    ]);
    expect(night).toMatchObject({ minutes: 480, amount: 720000 });
    expect(q.amount).toBe(840000);
  });
  test('bands use Vietnam time whatever the server time zone is', () => {
    // 11:00Z is 18:00 in Vietnam but 16:30 in India (the test suite's TZ).
    const c = config({
      block_minutes: 60,
      bands: [{ start: '18:00', end: '20:00', rate: 200000 }],
    });
    const q = tb.quote(c, new Date('2026-10-14T11:00:00Z'), new Date('2026-10-14T12:00:00Z'));
    expect(q.lines).toEqual([expect.objectContaining({ key: 'b0', amount: 200000 })]);
    // Another offset can be supplied explicitly.
    const india = tb.quote(c, new Date('2026-10-14T11:00:00Z'), new Date('2026-10-14T12:00:00Z'), {
      offsetMinutes: 330,
    });
    expect(india.lines).toEqual([expect.objectContaining({ key: 'base', amount: 120000 })]);
  });
  test('rounding up into a new band charges that band, and amounts stay integers', () => {
    const c = config({ rate: 90000, bands: [{ start: '20:00', end: '23:00', rate: 130000 }] });
    const q = tb.quote(c, vn('18:52'), vn('19:58'));
    // 66 min -> 5 blocks = 75 min: 18:52-20:00 base (68), 20:00-20:07 band (7)
    expect(q.lines.map((l) => [l.key, l.minutes])).toEqual([
      ['base', 68],
      ['b0', 7],
    ]);
    q.lines.forEach((l) => expect(Number.isInteger(l.amount)).toBe(true));
    expect(q.amount).toBe(q.lines.reduce((s, l) => s + l.amount, 0));
  });
});

describe('labels', () => {
  test('Vietnamese durations', () => {
    expect(tb.formatDuration(95, 'vi')).toBe('1 giờ 35 phút');
    expect(tb.formatDuration(120, 'vi')).toBe('2 giờ');
    expect(tb.formatDuration(45)).toBe('45 phút');
    expect(tb.formatDuration(0, 'vi')).toBe('0 phút');
    expect(tb.formatDuration(95, 'en')).toBe('1 h 35 min');
  });
  test('line names carry the room, the clock times and the billed duration', () => {
    const q = tb.quote(config(), vn('19:05'), vn('20:40'));
    expect(tb.lineName('Giờ hát', 'VIP1', q.lines[0], 'vi')).toBe(
      'Giờ hát VIP1 · 19:05-20:40 · 1 giờ 45 phút'
    );
    const banded = tb.quote(
      config({ bands: [{ start: '20:00', end: '24:00', rate: 150000, label: 'Giờ vàng' }] }),
      vn('19:05'),
      vn('20:40')
    );
    expect(tb.lineName('Giờ hát', 'VIP1', banded.lines[1], 'vi')).toBe(
      'Giờ hát VIP1 · 20:00-20:40 · 50 phút (Giờ vàng)'
    );
  });
  test('time lines are recognised only by the server-written marker', () => {
    expect(tb.isTimeLine({ time_billing_line: true })).toBe(true);
    expect(tb.isTimeLine({ line_id: 'tb-base' })).toBe(false);
    expect(tb.isTimeLine(null)).toBe(false);
  });
});
