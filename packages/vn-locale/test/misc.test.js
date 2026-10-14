'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src');

test('date/time in Asia/Ho_Chi_Minh', () => {
  const d = new Date('2025-07-01T17:05:09Z'); // 00:05 on 2/7 in Vietnam (UTC+7)
  assert.equal(L.formatDateVN(d), '02/07/2025');
  assert.equal(L.formatDateTimeVN(d), '00:05 02/07/2025');
  assert.equal(L.formatDateTimeVN(d, { seconds: true }), '00:05:09 02/07/2025');
  assert.equal(L.formatDateVN(d, { timeZone: 'UTC' }), '01/07/2025');
  assert.equal(L.formatDateVN(Date.UTC(2024, 0, 5)), '05/01/2024');
  assert.throws(() => L.formatDateVN('not a date'), RangeError);
});

test('text utils', () => {
  assert.equal(L.removeDiacritics('Phở Tuệ'), 'Pho Tue');
  assert.equal(L.removeDiacritics('Đường đến Đà Lạt'), 'Duong den Da Lat');
  assert.equal(L.removeDiacritics('ẤẦẨẪẬ ữựỹỵ'), 'AAAAA uuyy');
  assert.equal(L.slugifyVN('  Cà phê sữa đá (Ly lớn)! '), 'ca-phe-sua-da-ly-lon');
  assert.equal(L.slugifyVN('Bánh mì', { separator: '_' }), 'banh_mi');
  assert.equal(L.searchNormalize('  TRÀ   Sữa  '), 'tra sua');
  assert.ok(L.matchesSearch('Trà sữa trân châu đường đen', 'tra duong'));
  assert.ok(L.matchesSearch('Trà sữa', ''));
  assert.ok(!L.matchesSearch('Trà sữa', 'cafe'));
});

test('provinces (1/7/2025)', () => {
  assert.equal(L.PROVINCES.length, 34);
  assert.equal(L.PROVINCES.filter((p) => p.type === 'city').length, 6);
  assert.equal(new Set(L.PROVINCES.map((p) => p.id)).size, 34);
  for (const p of L.PROVINCES) assert.equal(p.id, L.slugifyVN(p.name.replace(/^Thành phố /, '')));
  // every one of the 63 pre-merger provinces appears exactly once
  const old = L.PROVINCES.flatMap((p) => [p.name, ...p.mergedFrom]);
  assert.equal(new Set(old).size, 63);
  assert.equal(L.findProvince('Bình Dương').id, 'ho-chi-minh');
  assert.equal(L.findProvince('TP.HCM').id, 'ho-chi-minh');
  assert.equal(L.findProvince('Tỉnh Hà Giang').id, 'tuyen-quang');
  assert.equal(L.findProvince('hue').name, 'Huế');
  assert.equal(L.findProvince('nowhere'), undefined);
  assert.ok(Object.isFrozen(L.PROVINCES));
});

test('banks', () => {
  assert.ok(L.BANKS.length >= 20);
  assert.equal(new Set(L.BANKS.map((b) => b.bin)).size, L.BANKS.length);
  for (const b of L.BANKS) assert.match(b.bin, /^97\d{4}$/);
  assert.equal(L.findBank('970436').shortName, 'Vietcombank');
  assert.equal(L.findBank('vietcombank').bin, '970436');
  assert.equal(L.findBank('namabank').bin, '970428');
  assert.equal(L.findBank('Nam A Bank').bin, '970428');
  assert.equal(L.findBank('MB').bin, '970422');
  assert.equal(L.findBank('999999'), undefined);
  assert.equal(L.findBank(''), undefined);
});
