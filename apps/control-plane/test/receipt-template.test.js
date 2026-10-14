'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { translateReceiptTemplate } = require('../src/onboarding');

test('receipt template labels are translated, markup and variables kept, idempotent', () => {
  const html = '<div><strong>Receipt</strong><td> Qty </td><span>Grand Total: &nbsp; &nbsp;</span><b>{{sale_total}}</b>' +
    '<p>Discount</p><p>Discount on {{item}}</p><i>My own Total note</i><td>GSTIN: &nbsp;</td></div>';
  const { html: out, changed } = translateReceiptTemplate(html);
  assert.equal(changed, 5);
  assert.equal(out, '<div><strong>Phiếu thanh toán</strong><td> SL </td><span>Tổng cộng: &nbsp; &nbsp;</span><b>{{sale_total}}</b>' +
    '<p>Chiết khấu</p><p>Discount on {{item}}</p><i>My own Total note</i><td>MST: &nbsp;</td></div>');
  assert.equal(translateReceiptTemplate(out).changed, 0);
  assert.deepEqual(translateReceiptTemplate(undefined), { html: '', changed: 0 });
});
