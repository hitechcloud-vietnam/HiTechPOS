'use strict';

/**
 * HiTechPOS: helpers/vn-bill.js - the Vietnamese bill's words, VAT per rate,
 * dates and tender names. Pure; no database.
 */

const fs = require('fs');
const path = require('path');
const vn = require('../../../src/helpers/vn-bill');

describe('numberToWords', () => {
  const cases = {
    0: 'không',
    1: 'một',
    5: 'năm',
    10: 'mười',
    11: 'mười một',
    14: 'mười bốn',
    15: 'mười lăm',
    19: 'mười chín',
    20: 'hai mươi',
    21: 'hai mươi mốt',
    24: 'hai mươi tư',
    25: 'hai mươi lăm',
    30: 'ba mươi',
    55: 'năm mươi lăm',
    71: 'bảy mươi mốt',
    94: 'chín mươi tư',
    100: 'một trăm',
    101: 'một trăm linh một',
    104: 'một trăm linh bốn',
    105: 'một trăm linh năm',
    110: 'một trăm mười',
    111: 'một trăm mười một',
    115: 'một trăm mười lăm',
    121: 'một trăm hai mươi mốt',
    1000: 'một nghìn',
    1001: 'một nghìn không trăm linh một',
    1010: 'một nghìn không trăm mười',
    1100: 'một nghìn một trăm',
    2021: 'hai nghìn không trăm hai mươi mốt',
    10005: 'mười nghìn không trăm linh năm',
    15000: 'mười lăm nghìn',
    25000: 'hai mươi lăm nghìn',
    120000: 'một trăm hai mươi nghìn',
    1000000: 'một triệu',
    1000001: 'một triệu không trăm linh một',
    1005005: 'một triệu không trăm linh năm nghìn không trăm linh năm',
    1250000: 'một triệu hai trăm năm mươi nghìn',
    2000500: 'hai triệu năm trăm',
    1000000000: 'một tỷ',
    1000000005: 'một tỷ không trăm linh năm',
    1000005000: 'một tỷ không trăm linh năm nghìn',
    2500000000: 'hai tỷ năm trăm triệu',
    1000000000000: 'một nghìn tỷ',
    1001000000000: 'một nghìn không trăm linh một tỷ',
    1234567891234:
      'một nghìn hai trăm ba mươi tư tỷ năm trăm sáu mươi bảy triệu tám trăm chín mươi mốt nghìn hai trăm ba mươi tư',
    1000000000000000: 'một triệu tỷ',
  };
  test.each(Object.entries(cases))('%s', (n, words) => {
    expect(vn.numberToWords(Number(n))).toBe(words);
  });

  test('BigInt and digit strings beyond 2^53 read exactly', () => {
    expect(vn.numberToWords(10n ** 18n)).toBe('một tỷ tỷ');
    expect(vn.numberToWords('9007199254740993')).toBe(
      'chín triệu không trăm linh bảy nghìn một trăm chín mươi chín tỷ hai trăm năm mươi tư triệu bảy trăm bốn mươi nghìn chín trăm chín mươi ba'
    );
    expect(vn.numberToWords('000120')).toBe('một trăm hai mươi');
  });

  test('negative numbers and options', () => {
    expect(vn.numberToWords(-21)).toBe('âm hai mươi mốt');
    expect(vn.numberToWords(105, { zeroTens: 'lẻ' })).toBe('một trăm lẻ năm');
    expect(vn.numberToWords(24, { useTu: false })).toBe('hai mươi bốn');
    expect(vn.numberToWords(5000, { thousand: 'ngàn' })).toBe('năm ngàn');
  });

  test('refuses what is not a whole number', () => {
    expect(() => vn.numberToWords(1.5)).toThrow(RangeError);
    expect(() => vn.numberToWords(NaN)).toThrow(RangeError);
    expect(() => vn.numberToWords(2 ** 60)).toThrow(RangeError);
    expect(() => vn.numberToWords('12a')).toThrow(RangeError);
    expect(() => vn.numberToWords(1, { zeroTens: 'x' })).toThrow(RangeError);
  });

  /* The HiTechPOS package (packages/vn-locale) reads money for e-invoices; the
     printed bill and the e-invoice must say the same words. */
  const pkg = path.join(__dirname, '../../../../../../packages/vn-locale/src/words.js');
  (fs.existsSync(pkg) ? test : test.skip)('agrees with @hitechpos/vn-locale', () => {
    const { numberToVietnameseWords } = require(pkg);
    const samples = [
      0, 7, 14, 21, 24, 105, 1001, 15000, 120000, 1250000, 1000000005, 1234567891234,
    ];
    for (let n = 1; n < 2000; n += 37) samples.push(n, n * 1000 + 4, n * 1000003);
    for (const n of samples) {
      const theirs = numberToVietnameseWords(n, {
        useTu: true,
        currency: false,
        capitalize: false,
      });
      expect(`${n}: ${vn.numberToWords(n)}`).toBe(`${n}: ${theirs}`);
    }
  });
});

describe('amountInWords', () => {
  test('the line a Vietnamese bill prints', () => {
    expect(vn.amountInWords(120000)).toBe('Một trăm hai mươi nghìn đồng chẵn.');
    expect(vn.amountInWords(1250000)).toBe('Một triệu hai trăm năm mươi nghìn đồng chẵn.');
    expect(vn.amountInWords(21000)).toBe('Hai mươi mốt nghìn đồng chẵn.');
  });
  test('zero, negatives, rounding and string amounts', () => {
    expect(vn.amountInWords(0)).toBe('Không đồng.');
    expect(vn.amountInWords(-0.2)).toBe('Không đồng.');
    expect(vn.amountInWords(-1500)).toBe('Âm một nghìn năm trăm đồng chẵn.');
    expect(vn.amountInWords(99999.6)).toBe('Một trăm nghìn đồng chẵn.');
    expect(vn.amountInWords('118000')).toBe('Một trăm mười tám nghìn đồng chẵn.');
    expect(vn.amountInWords('118000.00')).toBe('Một trăm mười tám nghìn đồng chẵn.');
  });
  test('options', () => {
    expect(vn.amountInWords(5000, { even: false, period: false })).toBe('Năm nghìn đồng');
    expect(vn.amountInWords(5000, { currency: '' })).toBe('Năm nghìn.');
  });
  test('refuses an amount that is not a number', () => {
    expect(() => vn.amountInWords(Infinity)).toThrow(RangeError);
    expect(() => vn.amountInWords('abc')).toThrow(RangeError);
  });
});

describe('isVietnamese', () => {
  test('the outlet country decides', () => {
    expect(vn.isVietnamese({ country: 'Vietnam' })).toBe(true);
    expect(vn.isVietnamese({ country_id: 'VN' })).toBe(true);
    expect(vn.isVietnamese({ country: 'Việt Nam' })).toBe(true);
    expect(vn.isVietnamese({ country: 'India', currency_value: [{ currency_text: 'VND' }] })).toBe(
      false
    );
    expect(vn.isVietnamese({ country_id: 'IN' }, { country: 'VN' })).toBe(false);
  });
  test('the currency is the fallback, then what the till knows', () => {
    expect(
      vn.isVietnamese({ currency_value: [{ currency_text: 'VND', currency_sign: '₫' }] })
    ).toBe(true);
    expect(vn.isVietnamese({ currency_value: [{ currency_text: 'INR' }] })).toBe(false);
    expect(vn.isVietnamese({}, { country: 'VN' })).toBe(true);
    expect(vn.isVietnamese({}, { currency: 'VND' })).toBe(true);
    expect(vn.isVietnamese({})).toBe(false);
    expect(vn.isVietnamese(null)).toBe(false);
  });
});

describe('billDateTime', () => {
  test('re-reads the sale API clock as written (month first) without shifting it', () => {
    expect(vn.billDateTime('10/14/2026 03:30 pm', { order: 'mdy' })).toBe('14/10/2026 15:30');
    expect(vn.billDateTime('10/14/2026 12:05 am', { order: 'mdy' })).toBe('14/10/2026 00:05');
    expect(vn.billDateTime('10/14/2026 12:05 pm', { order: 'mdy' })).toBe('14/10/2026 12:05');
  });
  test('the till preview writes day first', () => {
    expect(vn.billDateTime('14/10/2026 3:05 AM')).toBe('14/10/2026 03:05');
    expect(vn.billDateTime('03/04/2026 9:00 PM', { order: 'dmy' })).toBe('03/04/2026 21:00');
    expect(vn.billDateTime('14/10/2026')).toBe('14/10/2026');
  });
  test('a Date or ISO string is shown in Asia/Ho_Chi_Minh', () => {
    expect(vn.billDateTime(new Date('2026-10-14T08:30:00Z'))).toBe('14/10/2026 15:30');
    expect(vn.billDateTime('2026-10-14T23:30:00Z')).toBe('15/10/2026 06:30');
    expect(vn.billDateTime('2026-10-14T23:30:00Z', { timeZone: 'UTC' })).toBe('14/10/2026 23:30');
  });
  test('nothing in, nothing out; unknown text unchanged', () => {
    expect(vn.billDateTime('')).toBe('');
    expect(vn.billDateTime(null)).toBe('');
    expect(vn.billDateTime('yesterday')).toBe('yesterday');
  });
});

describe('VAT per rate', () => {
  const line = (rate, gross, extra = {}) => ({
    item_name: 'x',
    item_quantity: 1,
    tax: rate,
    total_amount: gross,
    ...extra,
  });

  test('a line keeps its rate; KCT is named, not numbered', () => {
    expect(vn.vatRate(line(8, 1))).toBe(8);
    expect(vn.vatRate({ tax: 0, tax_fields: [{ tax_value: 5 }] })).toBe(5);
    expect(vn.vatRate({ tax: 0, tax_name: 'KCT-Không chịu thuế' })).toBe('KCT');
    expect(
      vn.vatRate({ tax: 0, tax_fields: [{ tax_name: 'Không chịu thuế', tax_value: 0 }] })
    ).toBe('KCT');
    expect(vn.vatRate({ tax: 0, tax_name: 'Thuế GTGT 0%' })).toBe(0);
  });

  test('groups by rate and adds up to the recorded tax exactly', () => {
    const rows = vn.vatGroups(
      [
        line(8, 108000),
        line(10, 22000, { item_quantity: 2 }),
        line(0, 5000, { tax_name: 'KCT-Không chịu thuế' }),
        line(0, 7000, { tax_name: 'Thuế GTGT 0%' }),
        line(10, 11000, { return: true }),
        line(10, 11000, { item_quantity: 0 }),
      ],
      10000
    );
    expect(rows).toEqual([
      { rate: 0, label: 'Thuế GTGT 0%', base: 7000, amount: 0 },
      { rate: 8, label: 'Thuế GTGT 8%', base: 100000, amount: 8000 },
      { rate: 10, label: 'Thuế GTGT 10%', base: 20000, amount: 2000 },
      { rate: 'KCT', label: 'Không chịu thuế (KCT)', base: 5000, amount: 0 },
    ]);
  });

  test('rounding is shared out so the rows never disagree with the total', () => {
    const rows = vn.vatGroups([line(8, 33333), line(10, 33333), line(5, 33333)], 6551);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(6551);
    rows.forEach((r) => expect(Number.isInteger(r.amount)).toBe(true));
    const cents = vn.vatGroups([line(8, 10.01), line(10, 10.01)], 1.65, { digits: 2 });
    expect(Math.round(cents.reduce((s, r) => s + r.amount, 0) * 100)).toBe(165);
  });

  test('no tax, no VAT section; tax with no rated line is still one honest row', () => {
    expect(vn.vatGroups([line(0, 5000)], 0)).toEqual([]);
    expect(vn.vatGroups([line(8, 5000)], undefined)).toEqual([]);
    expect(vn.vatGroups([line(0, 5000)], 400)).toEqual([
      { rate: null, label: 'Thuế GTGT', base: 0, amount: 400 },
    ]);
  });
});

describe('payments', () => {
  test('tenders read in Vietnamese, with the change handed back', () => {
    expect(vn.paymentLines([{ method: 'Cash', amount: 200000 }], 118000)).toEqual([
      { label: 'Tiền mặt', amount: 200000 },
      { label: 'Tiền thừa trả khách', amount: 82000, change: true },
    ]);
    expect(
      vn.paymentLines(
        [
          { method: 'Card', amount: 50000 },
          { method: 'QR chuyển khoản', amount: 68000 },
        ],
        118000
      )
    ).toEqual([
      { label: 'Thẻ', amount: 50000 },
      { label: 'QR chuyển khoản', amount: 68000 },
    ]);
    expect(vn.paymentLines([], 1000)).toEqual([]);
  });
});
