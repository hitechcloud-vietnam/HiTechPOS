'use strict';

const { searchNormalize } = require('./text');

/**
 * Common Vietnamese banks with their NAPAS BIN (used in VietQR field 38/01/00).
 * Source: NAPAS/VietQR bank list (api.vietqr.io/v2/banks); verify before adding new entries.
 */
const RAW = [
  ['970436', 'Vietcombank', 'Ngân hàng TMCP Ngoại thương Việt Nam'],
  ['970415', 'VietinBank', 'Ngân hàng TMCP Công thương Việt Nam'],
  ['970418', 'BIDV', 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam'],
  ['970405', 'Agribank', 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam'],
  ['970407', 'Techcombank', 'Ngân hàng TMCP Kỹ thương Việt Nam'],
  ['970422', 'MB', 'Ngân hàng TMCP Quân đội'],
  ['970416', 'ACB', 'Ngân hàng TMCP Á Châu'],
  ['970432', 'VPBank', 'Ngân hàng TMCP Việt Nam Thịnh Vượng'],
  ['970423', 'TPBank', 'Ngân hàng TMCP Tiên Phong'],
  ['970403', 'Sacombank', 'Ngân hàng TMCP Sài Gòn Thương Tín'],
  ['970437', 'HDBank', 'Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh'],
  ['970441', 'VIB', 'Ngân hàng TMCP Quốc tế Việt Nam'],
  ['970443', 'SHB', 'Ngân hàng TMCP Sài Gòn - Hà Nội'],
  ['970431', 'Eximbank', 'Ngân hàng TMCP Xuất Nhập khẩu Việt Nam'],
  ['970426', 'MSB', 'Ngân hàng TMCP Hàng Hải Việt Nam'],
  ['970448', 'OCB', 'Ngân hàng TMCP Phương Đông'],
  ['970440', 'SeABank', 'Ngân hàng TMCP Đông Nam Á'],
  ['970449', 'LPBank', 'Ngân hàng TMCP Lộc Phát Việt Nam'],
  ['970428', 'Nam A Bank', 'Ngân hàng TMCP Nam Á'],
  ['970409', 'Bac A Bank', 'Ngân hàng TMCP Bắc Á'],
  ['970425', 'ABBANK', 'Ngân hàng TMCP An Bình'],
  ['970433', 'VietBank', 'Ngân hàng TMCP Việt Nam Thương Tín'],
  ['970454', 'BVBank', 'Ngân hàng TMCP Bản Việt'],
  ['970452', 'KienlongBank', 'Ngân hàng TMCP Kiên Long'],
  ['970412', 'PVcomBank', 'Ngân hàng TMCP Đại Chúng Việt Nam'],
  ['970419', 'NCB', 'Ngân hàng TMCP Quốc Dân'],
  ['970438', 'BaoViet Bank', 'Ngân hàng TMCP Bảo Việt'],
  ['970400', 'Saigonbank', 'Ngân hàng TMCP Sài Gòn Công Thương'],
  ['970424', 'Shinhan Bank', 'Ngân hàng TNHH MTV Shinhan Việt Nam'],
  ['970458', 'UOB', 'Ngân hàng TNHH MTV United Overseas Bank (Việt Nam)'],
];

const BANKS = Object.freeze(RAW.map(([bin, shortName, name]) => Object.freeze({ bin, shortName, name })));

/**
 * Find a bank by BIN ("970436") or short name, case/diacritic/space-insensitive
 * ("vietcombank", "nam a bank", "NamABank"). Returns undefined when not found.
 */
function findBank(query) {
  if (query == null) return undefined;
  const q = String(query).trim();
  if (/^\d{6}$/.test(q)) return BANKS.find((b) => b.bin === q);
  const key = searchNormalize(q).replace(/[^a-z0-9]/g, '');
  if (!key) return undefined;
  return BANKS.find((b) => searchNormalize(b.shortName).replace(/[^a-z0-9]/g, '') === key);
}

module.exports = { BANKS, findBank };
