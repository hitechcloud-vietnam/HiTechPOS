'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('../src');

test('static account QR has the exact NAPAS structure', () => {
  const p = q.buildVietQR({ bin: '970403', accountNumber: '0011012345678' });
  const body = '00020101021138570010A00000072701270006970403011300110123456780208QRIBFTTA53037045802VN6304';
  assert.equal(p.slice(0, -4), body);
  assert.equal(p.slice(-4), q.crc16Hex(body));
  assert.ok(q.verifyCRC(p));
});

test('dynamic QR with amount and content round-trips', () => {
  const p = q.buildVietQR({ bin: '970436', accountNumber: '1234567890', amount: 1250000, addInfo: 'Thanh toán đơn #HD0001' });
  assert.ok(p.includes('010212'));
  assert.ok(p.includes('54071250000'));
  assert.ok(p.includes('62250821Thanh toan don HD0001'));
  assert.deepEqual(q.decodeVietQR(p), {
    version: '01', dynamic: true, guid: 'A000000727', bin: '970436', accountNumber: '1234567890',
    service: 'QRIBFTTA', currency: '704', amount: 1250000, country: 'VN',
    addInfo: 'Thanh toan don HD0001', crcValid: true,
  });
});

test('parseEMV tree and tag order', () => {
  const p = q.buildVietQR({ bin: '970422', accountNumber: '0001', amount: 5000, addInfo: 'abc' });
  const tree = q.parseEMV(p);
  assert.deepEqual(tree.map((n) => n.id), ['00', '01', '38', '53', '54', '58', '62', '63']);
  assert.equal(q.findTag(tree, '38', '01', '01').value, '0001');
  assert.equal(q.findTag(tree, '62', '08').value, 'abc');
  assert.equal(q.findTag(tree, '63').length, 4);
  assert.equal(q.findTag(tree, '99'), undefined);
  assert.throws(() => q.parseEMV('0002'), SyntaxError);
  assert.throws(() => q.parseEMV('ab02xx'), SyntaxError);
});

test('options: card service, dynamic override, no addInfo', () => {
  const card = q.decodeVietQR(q.buildVietQR({ bin: '970415', accountNumber: '9704150123456789', service: 'QRIBFTTC' }));
  assert.equal(card.service, 'QRIBFTTC');
  assert.equal(card.dynamic, false);
  assert.equal(card.amount, undefined);
  assert.equal(card.addInfo, undefined);
  assert.equal(q.decodeVietQR(q.buildVietQR({ bin: '970415', accountNumber: '1', amount: 1, dynamic: false })).dynamic, false);
  assert.equal(q.decodeVietQR(q.buildVietQR({ bin: '970415', accountNumber: '1', dynamic: true })).dynamic, true);
  assert.ok(!q.buildVietQR({ bin: '970415', accountNumber: '1', addInfo: '  !!  ' }).includes('6208'));
});

test('verifyCRC detects tampering', () => {
  const p = q.buildVietQR({ bin: '970436', accountNumber: '1234567890', amount: 10000 });
  assert.ok(q.verifyCRC(p));
  assert.ok(q.verifyCRC(p.slice(0, -4) + p.slice(-4).toLowerCase()));
  assert.ok(!q.verifyCRC(p.replace('10000', '90000')));
  assert.ok(!q.verifyCRC(p.slice(0, -1)));
  assert.ok(!q.verifyCRC(''));
  assert.ok(!q.verifyCRC(null));
});

test('sanitizeAddInfo', () => {
  assert.equal(q.sanitizeAddInfo('Chuyển khoản Đơn hàng số 123 - Phở Tuệ'), 'Chuyen khoan Don hang so');
  assert.equal(q.sanitizeAddInfo('Chuyển khoản Đơn hàng số 123 - Phở Tuệ').length <= 25, true);
  assert.equal(q.sanitizeAddInfo('a@b#c'), 'a b c');
  assert.equal(q.sanitizeAddInfo(undefined), '');
});

test('input validation', () => {
  assert.throws(() => q.buildVietQR({ bin: '97043', accountNumber: '1' }), RangeError);
  assert.throws(() => q.buildVietQR({ bin: '970436', accountNumber: '' }), RangeError);
  assert.throws(() => q.buildVietQR({ bin: '970436', accountNumber: '1-2' }), RangeError);
  assert.throws(() => q.buildVietQR({ bin: '970436', accountNumber: '1', amount: 0 }), RangeError);
  assert.throws(() => q.buildVietQR({ bin: '970436', accountNumber: '1', amount: 10.5 }), RangeError);
  assert.throws(() => q.buildVietQR({ bin: '970436', accountNumber: '1', amount: 1e14 }), RangeError);
  assert.throws(() => q.buildVietQR({ bin: '970436', accountNumber: '1', service: 'X' }), RangeError);
  assert.throws(() => q.tlv('0', 'x'), RangeError);
  assert.throws(() => q.tlv('01', 'x'.repeat(100)), RangeError);
});

test('vietQrImageUrl', () => {
  assert.equal(
    q.vietQrImageUrl({ bin: '970436', accountNumber: '1234567890', amount: 50000, addInfo: 'Thanh toán HD01', accountName: 'NGUYEN VAN A' }),
    'https://img.vietqr.io/image/970436-1234567890-compact2.png?amount=50000&addInfo=Thanh%20to%C3%A1n%20HD01&accountName=NGUYEN%20VAN%20A',
  );
  assert.equal(q.vietQrImageUrl({ bin: '970436', accountNumber: '123', template: 'qr_only' }), 'https://img.vietqr.io/image/970436-123-qr_only.png');
  assert.throws(() => q.vietQrImageUrl({ bin: 'x', accountNumber: '1' }), RangeError);
});
