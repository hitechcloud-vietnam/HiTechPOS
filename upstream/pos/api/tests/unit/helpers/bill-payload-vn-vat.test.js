'use strict';

/*
 * HiTechPOS: a Vietnamese shop's bill states VAT per rate ("Thuế GTGT 8%",
 * "Thuế GTGT 10%", 0% and KCT goods listed), adding up to the tax the sale
 * recorded. Indian and other shops keep Posnic's rows exactly.
 */
const { taxRows, buildBillPayload } = require('../../../src/helpers/bill-payload');

const vnBranch = {
  branch_name: 'Quán Phố Tuệ',
  country: 'Vietnam',
  country_id: 'VN',
  currency: '₫',
  currency_value: [{ currency_text: 'VND', currency_sign: '₫' }],
};
const line = (name, rate, gross, extra = {}) => ({
  item_name: name,
  item_quantity: 1,
  item_price: gross,
  tax: rate,
  total_amount: gross,
  ...extra,
});
const sale = {
  items: [
    line('Cà phê sữa đá', 8, 54000, { item_quantity: 2 }),
    line('Bánh mì', 10, 33000),
    line('Nước suối', 0, 10000, { tax_name: 'KCT-Không chịu thuế' }),
  ],
  sales_sub_total: 90000,
  sales_total: 97000,
  tax: 7000,
};

test('VAT per rate for a Vietnamese shop, adding up to the recorded tax', () => {
  expect(taxRows(sale, vnBranch)).toEqual([
    { label: 'Thuế GTGT 8%', amount: 4000 },
    { label: 'Thuế GTGT 10%', amount: 3000 },
    { label: 'Không chịu thuế (KCT)', amount: 0 },
  ]);
});

test('the queued bill carries the same rows', () => {
  const bill = buildBillPayload(sale, vnBranch);
  expect(bill.taxes.map((t) => t.label)).toEqual([
    'Thuế GTGT 8%',
    'Thuế GTGT 10%',
    'Không chịu thuế (KCT)',
  ]);
  expect(bill.taxes.reduce((s, t) => s + t.amount, 0)).toBe(7000);
  expect(bill.taxRegistrationLabel).toBe('MST');
});

test('no tax, no rows', () => {
  expect(taxRows({ ...sale, tax: 0 }, vnBranch)).toEqual([]);
});

test('other shops are unchanged', () => {
  expect(
    taxRows(sale, { country: 'United Kingdom', currency_value: [{ currency_text: 'GBP' }] })
  ).toEqual([{ label: 'Tax', amount: 7000 }]);
  const indian = taxRows(
    { items: [{ item_quantity: 1, item_base_price: 100, item_tax: 5 }], tax: 5 },
    { country: 'India', indian_gst: 'gst_on', currency_value: [{ currency_text: 'INR' }] }
  );
  expect(indian.map((r) => r.label)).toEqual(['CGST 2.5%', 'SGST 2.5%']);
});
