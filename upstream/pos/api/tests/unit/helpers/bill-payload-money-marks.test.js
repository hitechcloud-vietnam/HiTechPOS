'use strict';

/*
 * A queued bill (the waiter's table bill, printed by the desktop from this
 * payload) writes money the way the shop's country does, with the currency's
 * own precision: a Vietnamese shop prints 110.000, never 110000.00.
 */
const { buildBillPayload, moneyMarks } = require('../../../src/helpers/bill-payload');

const vnBranch = {
  branch_name: 'Quan Pho Tue',
  country_id: 'VN',
  currency: '₫',
  currency_text: 'Vietnam Dong / VND or ₫',
  currency_value: [{ currency_text: 'VND', currency_sign: '₫' }],
};

test('a Vietnamese branch prints whole dong grouped with dots', () => {
  const bill = buildBillPayload(
    { items: [], sales_sub_total: 101430.98, sales_total: 110000, tax: 8569.02 },
    vnBranch
  );
  expect(bill.currencyCode).toBe('VND');
  expect(bill.currencyDigits).toBe(0);
  expect(bill.currencyGroup).toBe('.');
  expect(bill.currencyDecimal).toBe(',');
  expect(bill.total).toBe(110000);
});

test('marks follow the country, and no country sends none', () => {
  expect(moneyMarks({ country_id: 'IN' })).toEqual({ currencyGroup: ',', currencyDecimal: '.' });
  expect(moneyMarks({ country_id: 'de' })).toEqual({ currencyGroup: '.', currencyDecimal: ',' });
  expect(moneyMarks({})).toEqual({});
  expect(moneyMarks({ country_id: 'Vietnam' })).toEqual({});
  expect(moneyMarks(null)).toEqual({});
});

test('ISO 4217 precision comes from the code inside currency_text', () => {
  const policy = require('../../../src/utils/currency').policy;
  expect(policy({ currency_text: 'Vietnam Dong / VND or ₫' }).currencyDigits).toBe(0);
  expect(policy({ currency_text: 'Japan Yen / JPY or ¥' }).currencyDigits).toBe(0);
  expect(policy({ currency_text: 'Korea Won / KRW or ₩' }).currencyDigits).toBe(0);
  expect(policy({ currency_text: 'India Rupee / INR or ₹' }).currencyDigits).toBe(2);
});
